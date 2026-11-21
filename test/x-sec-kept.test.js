// @ts-check
// What another machine's agents never read in a folder they read — a repository's own `.git`, whose config may hold a
// remote's token, and a credentials folder — is one rule, judged where the filesystem resolves the path, at every door
// their reads go through (the security re-read of 11-11): a command read as only reading (bash's reader and
// PowerShell's, so their exec and their chats' gates), the file route's refusal, a coding agent's read or search judged
// by the session's switch, the loop's own read, grep and glob, and Filament's MCP Glob and Grep, which also stay inside
// the chat's folders. This machine's person reads as before.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execRoutes } from "../src/http/admin/exec.js";
import { createRouter } from "../src/http/router.js";
import { agentFileRefusal } from "../src/http/admin/remote.js";
import { McpToolServer } from "../src/http/mcp.js";
import { SHELL } from "../src/adapters/tools/shell.js";
import { runHand } from "../src/adapters/tools/hands.js";
import { readOnlyCommand } from "../src/adapters/tools/read-only-commands.js";
import { readOnlyPowerShell } from "../src/adapters/tools/read-only-powershell.js";
import { createAgentPermits } from "../src/app/agent-permits.js";

const BASH = ["git-bash", "bash", "sh"].includes(SHELL.kind);
/** The PATH a command is read with: the system's own folders, none relative to the folder it runs in. */
const ENV = process.platform === "win32" ? {} : { PATH: "/usr/local/bin:/usr/bin:/bin" };
/** What a repository's config can hold, and no agent of another machine is to see. */
const TOKEN = "tok-in-config-91";
const KEPT = /repository's own \.git folder|credentials folder/;

let base = "";
/** The chat's folder: a repository's `.git` and a credentials folder in it, a link to each, and its own files. */
let root = "";
/** A folder the chat adds for reading. */
let added = "";
/** A folder beside them, which the chat does not read. */
let outside = "";
/** A git worktree as a chat's folder: its `.git` a file that names its git folder. */
let worktree = "";

before(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), "filament-x-kept-")));
  root = join(base, "project");
  added = join(base, "shared");
  outside = join(base, "elsewhere");
  for (const d of [join(root, ".git"), join(root, ".ssh"), join(root, "src"), join(root, "vendor", "google", "chrome"), added, outside]) mkdirSync(d, { recursive: true });
  writeFileSync(join(root, ".git", "config"), `[remote "origin"]\n\turl = https://me:${TOKEN}@example.test/r.git\n`);
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(root, ".ssh", "id_rsa"), `key ${TOKEN}\n`);
  writeFileSync(join(root, "vendor", "google", "chrome", "Cookies.txt"), `cookie ${TOKEN}\n`);
  writeFileSync(join(root, "src", "a.js"), "export const a = 1; // needle\n");
  writeFileSync(join(root, ".gitignore"), "node_modules\n");
  writeFileSync(join(root, ".env"), "NAME=x\n");
  writeFileSync(join(added, "notes.md"), "needle in the added folder\n");
  writeFileSync(join(outside, "far.txt"), "needle far away\n");
  worktree = join(base, "worktree");
  mkdirSync(join(worktree, "src"), { recursive: true });
  writeFileSync(join(worktree, ".git"), "gitdir: /somewhere/else/.git/worktrees/worktree\n");
  writeFileSync(join(worktree, "src", "b.js"), "// needle\n");
  const kind = process.platform === "win32" ? "junction" : "dir";
  symlinkSync(join(root, ".git"), join(root, "meta"), kind);
  symlinkSync(join(root, ".ssh"), join(root, "keys"), kind);
});

after(() => {
  if (base) rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

// (fails before: yes — `cat .git/config` read as only reading for another machine's agents, as any path inside their
// folder did: their exec ran it unasked in Ask mode, and their chat's gate in every mode)
test("a command that names a repository's .git or a credentials folder, by its name or through a link, or searches a folder that holds one, is no read for another machine's agents; this machine's person's reads stay reads", { skip: BASH ? false : `${SHELL.name} is not a bash` }, () => {
  /** @param {string} c @param {boolean} agentsDevice */
  const reads = (c, agentsDevice) => readOnlyCommand(c, { root, shell: SHELL, env: ENV, agentsDevice });
  for (const c of [
    "cat .git/config",
    "head -n 5 .git/config",
    "grep url .git/config",
    "sed -n 1,5p .git/config",
    "ls .git",
    "cat .git/*",
    "cat meta/config",
    "cat .ssh/id_rsa",
    "cat keys/id_rsa",
    "cat vendor/google/chrome/Cookies.txt",
    "cd .git && cat config",
    "grep -r url .",
    "grep -rn url",
    "grep --recursive url vendor",
    "rg --hidden url",
    "rg -uu url .",
  ]) {
    const theirs = reads(c, true);
    assert.equal(theirs.ok, false, `theirs: ${c}`);
    assert.match(/** @type {{ why: string }} */ (theirs).why, KEPT, c);
    assert.match(/** @type {{ why: string }} */ (theirs).why, /another machine's agents/, c);
    assert.deepEqual(reads(c, false), { ok: true }, `the person's: ${c}`);
  }
  // What holds neither stays a read for them: their own files, a search of a folder with none, rg's own walk, which
  // passes over hidden names, and a name that only looks like git's. A secret's file by its name (`.env`) is no part of
  // this rule: the file route reads it them too, under privacy.redact (x-sec-exec.test.js).
  for (const c of ["cat src/a.js", "grep -rn needle src", "rg needle", "ls", "cat .gitignore", "wc -l src/a.js", "cat .env"]) assert.deepEqual(reads(c, true), { ok: true }, c);
  assert.equal(agentFileRefusal(root, ".env"), "", "the file route's rule names no .env either");
  // A worktree's `.git` is a file that names its git folder and holds no config: a search of one — a copy of theirs, a
  // sub-agent's worktree — stays a read, where its repository's own folder does not.
  assert.deepEqual(readOnlyCommand("grep -rn needle .", { root: worktree, shell: SHELL, env: ENV, agentsDevice: true }), { ok: true });
  assert.deepEqual(readOnlyCommand("rg --hidden needle", { root: worktree, shell: SHELL, env: ENV, agentsDevice: true }), { ok: true });
});

/** A response as the admin rows write to it, its SSE events read back. */
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
    /** @returns {any[]} */
    events: () => res.body.split("\n\n").filter((f) => f.startsWith("data: ")).map((f) => JSON.parse(f.slice(6))),
  });
  return res;
};
/** Wait until `fn` holds. @param {() => boolean} fn */
const waitFor = async (fn, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((res) => setTimeout(res, 20));
  }
  return fn();
};

// (fails before: yes — the agents' device's `cat .git/config` ran at once in Ask mode, its output the remote's token)
test("through the exec route in Ask mode: an agents' device's command that reads .git waits on an ask, by its name and through a link; its own file's read runs, and so does the person's read of .git", { skip: BASH ? false : `${SHELL.name} is not a bash` }, async () => {
  const config = { agentLoop: { permissions: "ask", roots: [tmpdir(), base] }, server: { host: "127.0.0.1" }, sessions: { defaults: {} } };
  const a = { config: { get: () => config }, memory: null, dataDir: join(base, "no-data"), devices: null, sseClients: new Set(), log: () => {} };
  const route = createRouter(execRoutes(/** @type {any} */ (a)));
  /** @param {string} command @param {any} who */
  const exec = async (command, who) => {
    const res = standIn();
    const url = new URL("http://127.0.0.1/api/exec");
    const m = route("POST", "/exec");
    if (!m) throw new Error("no exec row");
    const done = Promise.resolve(m.handler({ req: {}, res, url, path: "/exec", method: "POST", params: m.params, json: async () => ({ cwd: root, command }), who }, a));
    assert.ok(await waitFor(() => res.events().some((e) => e.type === "exec")), res.body);
    const state = res.events().find((e) => e.type === "exec")?.state;
    if (state === "asking") res.emit("close");
    await done;
    return { state, body: res.body };
  };
  const theirs = { kind: "device", scope: "agent", device: { id: "phone", name: "Filament agents on phone", grants: { agents: true } } };
  for (const command of ["cat .git/config", "cat meta/config", "grep -r url ."]) {
    const x = await exec(command, theirs);
    assert.equal(x.state, "asking", command);
    assert.ok(!x.body.includes(TOKEN), `${command}: nothing of the config went out`);
  }
  assert.equal((await exec("cat src/a.js", theirs)).state, "running");
  const mine = await exec("cat .git/config", { kind: "local" });
  assert.equal(mine.state, "running");
  assert.ok(mine.body.includes(TOKEN), "the person reads their own repository's config");
});

// (fails before: yes — PowerShell's reader had no word of whose script it read: `Get-Content .git/config` ran unasked in
// another machine's agents' chat)
test("PowerShell's reader keeps the same rule for another machine's agents: a path in .git or a credentials folder, a link to one, a listing of a tree that holds one piped on", () => {
  /** @param {string} s @param {boolean} agentsDevice */
  const reads = (s, agentsDevice) => readOnlyPowerShell(s, { root, env: {}, agentsDevice });
  for (const s of ["Get-Content .git/config", "Get-Content meta/config", "Get-Content -Path .ssh/id_rsa", "Select-String -Pattern url -Path .git/config", "Get-ChildItem .git", "Get-ChildItem -Recurse -Force | Select-String url"]) {
    const theirs = reads(s, true);
    assert.equal(theirs.ok, false, `theirs: ${s}`);
    assert.match(/** @type {{ why: string }} */ (theirs).why, KEPT, s);
    assert.deepEqual(reads(s, false), { ok: true }, `the person's: ${s}`);
  }
  for (const s of ["Get-Content src/a.js", "Get-ChildItem -Recurse src | Select-String needle", "Get-ChildItem -Recurse", "Get-Content .gitignore"]) assert.deepEqual(reads(s, true), { ok: true }, s);
});

// (fails before: yes — the switch refused a credentials folder by the path's letters and knew no `.git`: a coding
// agent's Read of .git/config ran, a link to .ssh read through, and a glob's pattern from the folder was not read)
test("a coding agent's read or search in another machine's agents' chat: .git, a credentials folder through a link, and a glob's own pattern into either or out of the folder are refused; under Auto, and in the person's chat, as before", () => {
  const theirs = (/** @type {any} */ mode = "edit") => createAgentPermits({ rules: [], modeNow: () => mode, learned: null, agentsDevice: true, reads: [added] });
  for (const [call, why] of /** @type {[any, RegExp][]} */ ([
    [{ name: "read", input: { path: ".git/config" } }, /\.git\/config is in a repository's own \.git folder/],
    [{ name: "read", input: { path: join(root, ".git", "config") } }, /repository's own \.git folder/],
    [{ name: "read", input: { path: "meta/config" } }, /repository's own \.git folder/],
    [{ name: "read", input: { path: "keys/id_rsa" } }, /credentials folder \(\.ssh\)/],
    [{ name: "grep", input: { pattern: "url", path: ".git" } }, /repository's own \.git folder/],
    [{ name: "glob", input: { pattern: "*", path: "meta" } }, /repository's own \.git folder/],
    [{ name: "glob", input: { pattern: ".git/*" } }, /repository's own \.git folder/],
    [{ name: "glob", input: { pattern: ".ssh/id_*" } }, /credentials folder \(\.ssh\)/],
    [{ name: "glob", input: { pattern: "../elsewhere/*" } }, /outside the folder this chat of another machine's agents works in/],
    [{ name: "glob", input: { pattern: "../*.txt", path: "src/.." } }, /outside the folder this chat of another machine's agents works in/],
  ])) {
    const v = theirs().judge([call], root);
    assert.equal(v.verdict, "refuse", JSON.stringify(call));
    assert.match(String(v.why), why, JSON.stringify(call));
    assert.equal(theirs("auto").judge([call], root).verdict, "run", `Auto: ${JSON.stringify(call)}`);
    assert.equal(createAgentPermits({ rules: [], modeNow: () => /** @type {const} */ ("edit"), learned: null }).judge([call], root).verdict, "run", `the person's: ${JSON.stringify(call)}`);
  }
  for (const call of [
    { name: "read", input: { path: "src/a.js" } },
    { name: "read", input: { path: ".gitignore" } },
    { name: "glob", input: { pattern: "src/**/*.js" } },
    { name: "glob", input: { pattern: "**/*.md", path: added } },
    { name: "grep", input: { pattern: "needle" } },
  ])
    assert.equal(theirs().judge([call], root).verdict, "run", JSON.stringify(call));
});

// (fails before: yes — the loop's read hand read .git/config in another machine's agents' chat, and its glob listed the
// credentials folder's files)
test("the loop's own read, grep and glob in another machine's agents' chat: no path in .git or a credentials folder, by its name or a link, and no file of one in what a search or a listing finds; without the fence (Auto), and for the person, as before", async () => {
  const theirs = { root, theirs: true };
  for (const [name, input] of /** @type {[string, any][]} */ ([
    ["read", { path: ".git/config" }],
    ["read", { path: "meta/config" }],
    ["read", { path: ".ssh/id_rsa" }],
    ["read", { path: "keys/id_rsa" }],
    ["grep", { pattern: "url", path: ".git" }],
    ["grep", { pattern: "url", path: "meta" }],
    ["glob", { pattern: "*", path: ".git" }],
    ["glob", { pattern: "*", path: "keys" }],
  ])) {
    await assert.rejects(() => runHand(name, input, theirs), (/** @type {any} */ e) => KEPT.test(e.message) && /another machine's agents/.test(e.message), `${name} ${JSON.stringify(input)}`);
    const mine = String(await runHand(name, input, { root }));
    assert.ok(mine.length > 0, `the person's ${name} ${JSON.stringify(input)}`);
  }
  assert.match(String(await runHand("read", { path: ".git/config" }, { root })), new RegExp(TOKEN), "the person reads it");
  assert.match(String(await runHand("read", { path: ".git/config" }, { root, theirs: true, fenced: false })), new RegExp(TOKEN), "Auto: no fence, as the person's");
  // A search's walk, by rg and by Filament's own: a credentials folder named without a dot is walked into, and its
  // files are not theirs to see.
  for (const noRg of [false, true]) {
    const found = String(await runHand("grep", { pattern: TOKEN, output: "files" }, { ...theirs, noRg }));
    assert.ok(!/Cookies|id_rsa|config/.test(found), `theirs (noRg ${noRg}): ${found}`);
    assert.match(String(await runHand("grep", { pattern: TOKEN, output: "files" }, { root, noRg })), /vendor\/google\/chrome\/Cookies\.txt/, `the person's (noRg ${noRg})`);
    assert.match(String(await runHand("grep", { pattern: "needle", output: "files" }, { ...theirs, noRg })), /src\/a\.js/, "their own files are found");
  }
  const listed = String(await runHand("glob", { pattern: "**/*" }, theirs));
  assert.match(listed, /src\/a\.js/);
  assert.ok(!/id_rsa|Cookies|config/.test(listed), listed);
  assert.match(String(await runHand("glob", { pattern: "**/*" }, { root })), /\.ssh\/id_rsa/, "the person's listing has them");
});

/** Filament's MCP server over stand-ins: no client tools, so its own hands answer. */
const mcp = () => new McpToolServer({ bridge: { askClient: async () => "", permitLocal: async () => null, contextForMcpToken: () => null } });
/** Where a call stands: `theirs`, a turn of another machine's agents' chat without Full control. @param {{ theirs?: boolean, resting?: boolean }} [o] */
const at = ({ theirs = false, resting = false } = {}) => ({
  turn: resting ? null : { done: false, clientTools: { has: () => false }, toolsAt: { ...(theirs ? { agentsChat: true } : {}), dirs: [added] } },
  conv: { opened: theirs ? { fenced: true } : {} },
  cwd: root,
  upstream: { id: "u", acp: {} },
  native: true,
});

// (fails before: yes — Glob walked any absolute path and Grep ran with no fence: a fenced chat's coding agent listed and
// searched this machine's folders past its own, and its repository's .git)
test("Filament's MCP Glob and Grep in another machine's agents' chat stay in its folder and the folders added to it, and under the same rule; the person's chats search where they say", async () => {
  const srv = mcp();
  const theirs = at({ theirs: true });
  for (const [name, args, why] of /** @type {[string, any, RegExp][]} */ ([
    ["Glob", { pattern: "**/*", path: outside }, /outside/],
    ["Glob", { pattern: "*", path: join(root, ".git") }, KEPT],
    ["Glob", { pattern: "*", path: join(root, "meta") }, KEPT],
    ["Glob", { pattern: "*", path: join(root, "keys") }, KEPT],
    ["Grep", { pattern: "needle", path: outside }, /outside/],
    ["Grep", { pattern: "url", path: join(root, ".git") }, KEPT],
    ["Grep", { pattern: "url", path: join(root, "meta", "config") }, KEPT],
  ])) {
    await assert.rejects(() => srv.call(name, args, theirs, {}), why, `${name} ${JSON.stringify(args)}`);
    // A chat at rest between turns is fenced as it was opened.
    await assert.rejects(() => srv.call(name, args, at({ theirs: true, resting: true }), {}), why, `at rest: ${name} ${JSON.stringify(args)}`);
    const mine = String(await srv.call(name, args, at(), {}));
    assert.ok(mine && mine !== "No files found", `the person's ${name} ${JSON.stringify(args)}: ${mine}`);
    // Under Auto, which their chat runs in only where their device may run without asking, as the person's.
    assert.equal(await srv.call(name, args, { ...theirs, modeNow: () => "auto" }, {}), mine, `Auto: ${name} ${JSON.stringify(args)}`);
    await assert.rejects(() => srv.call(name, args, { ...theirs, modeNow: () => "edit" }, {}), why, `Edit: ${name} ${JSON.stringify(args)}`);
  }
  // In its folder and the one added to it: its own files, none of a credentials folder.
  const listed = String(await srv.call("Glob", { pattern: "**/*" }, theirs, {}));
  assert.ok(listed.includes(join(root, "src", "a.js")), listed);
  assert.ok(!/id_rsa|Cookies/.test(listed), listed);
  assert.ok(String(await srv.call("Glob", { pattern: "**/*" }, at(), {})).includes(join(root, ".ssh", "id_rsa")), "the person's listing has them");
  assert.equal(await srv.call("Glob", { pattern: "*.md", path: added }, theirs, {}), join(added, "notes.md"));
  assert.equal(await srv.call("Grep", { pattern: "needle", path: added }, theirs, {}), join(added, "notes.md"));
  const found = String(await srv.call("Grep", { pattern: TOKEN }, theirs, {}));
  assert.ok(!/Cookies|id_rsa|config/.test(found), found);
  assert.equal(await srv.call("Grep", { pattern: "needle" }, theirs, {}), join(root, "src", "a.js"));
});

// (fails before: yes — the file route's rule read `.git` in the path's letters: a link inside the folder passed)
test("the file a device of another machine's agents reads is judged where the filesystem resolves it: a link to .git or to a credentials folder is refused as the folder itself", () => {
  assert.match(agentFileRefusal(root, "meta/config"), /never read a repository's own \.git folder; meta\/config is in one/);
  assert.match(agentFileRefusal(root, "keys/id_rsa"), /never read a credentials folder; keys\/id_rsa is in \.ssh/);
  assert.match(agentFileRefusal(root, ".git/config"), /never read a repository's own \.git folder/);
  assert.equal(agentFileRefusal(root, "src/a.js"), "");
  assert.equal(agentFileRefusal(root, ".gitignore"), "");
  // A worktree Filament keeps inside its repository's .git is a folder like any other, read below itself.
  const worktree = join(root, ".git", "filament-worktrees", "sa_1");
  mkdirSync(join(worktree, "src"), { recursive: true });
  writeFileSync(join(worktree, "src", "b.js"), "b\n");
  writeFileSync(join(worktree, ".git"), "gitdir: ../../worktrees/sa_1\n");
  assert.equal(agentFileRefusal(worktree, "src/b.js"), "");
  assert.match(agentFileRefusal(worktree, ".git"), /never read a repository's own \.git folder/);
});

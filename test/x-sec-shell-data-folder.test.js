// @ts-check
// Filament's data folder kept from another machine's agents (s0d, the plan's phase 3): it holds the owner key, which makes
// whoever reads it this computer's owner, with secret.key, the config, the devices paired and the machines reached. In
// a chat their agents started, without Full control, a call that names it or a folder that holds it — a command by its
// path in any way a shell says one, a file tool's, an MCP tool's, a command sent through the exec route — is refused in
// words in every mode, by the loop's gate and a coding agent's; a command that only reads it no longer passes as
// reading; their reads and searches never land in it, under Auto too. The person's own chats are as they were: their
// programs run as the person, who may read it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { FILAMENT_KEPT, filamentBelow, inFilamentFolder, keepFromAgents, keptFromAgents, keptRefusal, keptWords, resolveInside } from "../src/adapters/tools/fs-fence.js";
import { FILAMENT_FOLDER_WORDS, createAgentPermits, filamentFolderNamed } from "../src/app/agent-permits.js";
import { readOnlyCommand } from "../src/adapters/tools/read-only-commands.js";
import { SHELL } from "../src/adapters/tools/shell.js";
import { runHand, safeEnv } from "../src/adapters/tools/hands.js";
import { McpToolServer } from "../src/http/mcp.js";
import { execRoutes } from "../src/http/admin/exec.js";
import { createRouter } from "../src/http/router.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";

/** A folder that holds a project and, below it, Filament's data folder, as a home folder holds AppData. */
let top = "";
let proj = "";
let data = "";
/** @type {() => void} */
let unkeep = () => {};
before(() => {
  top = mkdtempSync(join(tmpdir(), "filament-s0d-"));
  proj = join(top, "proj");
  data = join(top, "AppData", "Roaming", "Filament");
  mkdirSync(proj, { recursive: true });
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, "owner.key"), "fok_secret");
  writeFileSync(join(data, "secret.key"), "k");
  writeFileSync(join(proj, "a.js"), "x");
  unkeep = keepFromAgents(data);
});
after(() => {
  unkeep();
  rmSync(top, { recursive: true, force: true });
});

/** A bash call. @param {string} command @param {string} [cwd] */
const bash = (command, cwd) => ({ name: "bash", input: { command, ...(cwd ? { cwd } : {}) } });

// (fails before: yes — the data folder was kept from no one: a reader there was this computer's owner)
test("the data folder is kept from another machine's agents' reads: by its path and where a link leads, in words", (t) => {
  assert.equal(keptFromAgents(join(data, "owner.key"), [top]), FILAMENT_KEPT);
  assert.equal(keptFromAgents(join(proj, "a.js"), [top]), "");
  assert.equal(keptWords(FILAMENT_KEPT), "Filament's data folder");
  assert.equal(keptRefusal('"x/owner.key"', FILAMENT_KEPT), `another machine's agents never read Filament's data folder, which holds its owner key; "x/owner.key" is in it`);
  assert.throws(() => resolveInside(top, "AppData/Roaming/Filament/owner.key", { theirs: true }), /never read Filament's data folder/);
  assert.equal(resolveInside(top, "AppData/Roaming/Filament/owner.key", { theirs: false }), join(data, "owner.key"), "the person's own chat reads it");
  const link = join(proj, "lnk");
  try {
    symlinkSync(data, link, "junction");
  } catch {
    return t.skip("no link can be made here");
  }
  assert.equal(keptFromAgents(join(link, "owner.key"), [proj]), FILAMENT_KEPT, "through a link");
});

// (fails before: yes — the folder was let go of at the first of two stops, and a read under Auto went where it said)
test("the data folder is kept while any server of the process keeps it, and from their reads and searches under Auto too", () => {
  const again = keepFromAgents(data);
  again();
  again();
  assert.ok(inFilamentFolder(join(data, "owner.key")), "kept while the first teller holds it, however often the second lets go");
  const last = keepFromAgents(join(top, "other-data"));
  last();
  assert.ok(!inFilamentFolder(join(top, "other-data", "x")), "a folder let go of");
  assert.throws(() => resolveInside(proj, join(data, "owner.key"), { fenced: false, theirs: true }), /never read Filament's data folder/, "theirs under Auto");
  assert.equal(resolveInside(proj, join(data, "owner.key"), { fenced: false }), join(data, "owner.key"), "the person's own chat under Auto");
  assert.equal(resolveInside(proj, join(top, "AppData", "Roaming"), { fenced: false, theirs: true }), join(top, "AppData", "Roaming"), "a folder that holds it may be searched: its files are left out");
  const below = filamentBelow(top);
  assert.equal(below(join(data, "owner.key")), true);
  assert.equal(below(join(proj, "a.js")), false);
});

// (fails before: yes — `cat <data>/owner.key` named nothing any fence read, and a search of a folder that holds it read it whole)
test("a call names the data folder: by its path in any way a shell says one, a variable, a climb, a wildcard, the folder it runs in, a folder that holds it; a file tool's and an MCP tool's", () => {
  process.env.S0D_TOP = top;
  try {
    const owner = join(data, "owner.key");
    for (const c of [
      bash(`cat "${owner}"`),
      bash(`type ${owner}`),
      bash(`cat ${owner.split(sep).join("/")}`),
      bash("cat ../AppData/Roaming/Filament/owner.key"),
      bash("cat $S0D_TOP/AppData/Roaming/Filament/secret.key"),
      bash("type %S0D_TOP%\\AppData\\Roaming\\Filament\\secret.key"),
      bash("Get-Content $env:S0D_TOP/AppData/Roaming/Filament/owner.key"),
      bash("Get-Content ${env:S0D_TOP}/AppData/Roaming/Filament/owner.key"),
      bash("gc (Join-Path $env:S0D_TOP 'AppData\\Roaming\\Filament\\owner.key')"),
      bash("Get-ChildItem -Recurse $env:S0D_TOP | Select-String fok_"),
      bash("cat ${S0D_TOP}/AppData/Roaming/Fil*/owner.key"),
      bash("cat ../AppData/Roaming/Fil{,}ament/owner.key"),
      bash("cat ../AppData/Roaming/Fil${S0D_NOPE}ament/owner.key"),
      bash("cat $PWD/../AppData/Roaming/Filament/owner.key"),
      bash("cat ../*/*/*/owner.key"),
      bash("grep -r fok_ ../**"),
      bash("grep -r fok_ .."),
      bash("ls ../*"),
      bash("cd ../AppData/Roaming && cat Filament/owner.key"),
      bash("tar -cf out.tar --directory=../AppData ."),
      bash("ls", data),
      bash("rg fok_", top),
      { name: "read", input: { path: "../AppData/Roaming/Filament/owner.key" } },
      { name: "grep", input: { path: data, pattern: "fok" } },
      { name: "grep", input: { path: "..", pattern: "fok" } },
      { name: "glob", input: { path: "../AppData", pattern: "**/*.key" } },
      { name: "delegate_read", input: { question: "what is in it?", paths: ["src", "../AppData/Roaming/Filament"] } },
      { name: "mcp__files__read", input: { file: owner } },
      { name: "mcp__files__search", input: { root: top, pattern: "fok_" } },
    ])
      assert.equal(filamentFolderNamed(c, proj), data, JSON.stringify(c));
    for (const c of [
      bash("cat a.js"),
      bash("ls sub/*"),
      bash("cat ../AppData/Roaming/other.txt"),
      bash("grep -r fok_ ."),
      { name: "read", input: { path: "a.js" } },
      { name: "grep", input: { pattern: "fok_" } },
      { name: "delegate_read", input: { question: "q", paths: ["a.js"] } },
      bash("echo $S0D_NOT_SET/owner.key"),
    ])
      assert.equal(filamentFolderNamed(c, proj), "", JSON.stringify(c));
  } finally {
    delete process.env.S0D_TOP;
  }
});

// (fails before: yes — a share's path was looked up, a look that goes out to its host, and this computer's own share named nothing)
test("a share's path: this computer's own drive share names the data folder, another host's is judged by its words alone", { skip: process.platform === "win32" ? false : "shares are Windows' paths" }, () => {
  const drive = data.slice(0, 1);
  const rest = data.slice(2);
  for (const c of [bash(`type \\\\localhost\\${drive}$${rest}\\owner.key`), bash(`type \\\\127.0.0.1\\${drive}$${rest}\\owner.key`), bash(`type \\\\?\\${data}\\owner.key`), bash(`type \\\\?\\UNC\\localhost\\${drive}$${rest}\\owner.key`), bash("type \\\\localhost\\users\\x")])
    assert.equal(filamentFolderNamed(c, proj), data, JSON.stringify(c));
  assert.equal(filamentFolderNamed(bash("type \\\\s0d-nohost.invalid\\share\\x~1\\owner.key"), proj), "");
});

test("a command that reads the data folder from a folder that holds it passes as reading no more, in their chat", () => {
  const reads = (/** @type {boolean} */ agentsDevice) => readOnlyCommand("cat AppData/Roaming/Filament/owner.key", { root: top, shell: SHELL, env: safeEnv(), reads: [], agentsDevice }).ok;
  assert.equal(reads(false), true, "the person's own chat: it only reads, in its folder");
  assert.equal(reads(true), false, "theirs: it reads what they never read");
});

// (fails before: yes — under Auto, or with their device's grant to run without asking, it ran)
test("a coding agent's call in their chat into the data folder is refused in words in every mode; the person's own chat is judged by its mode", () => {
  for (const mode of /** @type {const} */ (["read-only", "ask", "edit", "auto"])) {
    const theirs = createAgentPermits({ rules: [], modeNow: () => mode, learned: null, agentsDevice: true });
    const v = /** @type {any} */ (theirs.judge([bash(`type "${join(data, "owner.key")}"`)], proj));
    assert.equal(v.verdict, "refuse", mode);
    assert.equal(v.why, `Filament, as ${FILAMENT_FOLDER_WORDS}`);
    assert.equal(/** @type {any} */ (theirs.allowed([bash(`cat ${join(data, "secret.key")}`)], proj)).verdict, "refuse", `${mode}: no yes lets it through`);
  }
  const mine = createAgentPermits({ rules: [], modeNow: () => "auto", learned: null });
  assert.equal(/** @type {any} */ (mine.judge([bash(`type "${join(data, "owner.key")}"`)], proj)).verdict, "run", "the person's own, under Auto");
});

/**
 * Filament's own loop over one bash call and then words, in `mode`; what the hand ran and what the model was told.
 * @param {{ agentsChat: boolean, mode: string, command: string }} o
 */
const loopOver = async ({ agentsChat, mode, command }) => {
  /** @type {string[]} */
  const ran = [];
  /** @type {any[]} */
  const told = [];
  let n = 0;
  await runAgentTurn(
    /** @type {any} */ ({
      model: "m",
      messages: [{ role: "user", content: "look" }],
      system: "s",
      tools: toolSetFor({ delegateRead: false }),
      modeNow: () => mode,
      root: proj,
      readerModel: "",
      maxTokens: 100,
      agentsChat,
      asker: async () => ({ text: "yes" }),
      call: async (/** @type {any} */ req) => {
        if (n++ > 0) told.push(...req.body.messages.at(-1).content);
        const content = n === 1 ? [{ type: "tool_use", id: "b1", name: "bash", input: { command } }] : [{ type: "text", text: "Done." }];
        return { ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null };
      },
      costOf: () => 0,
      runHand: async (/** @type {string} */ _name, /** @type {any} */ input) => {
        ran.push(String(input.command));
        return "fok_secret";
      },
      delegateRead: null,
      mailbox: null,
      permissions: null,
      rules: [],
      tree: null,
      onEvent: () => {},
      previewChars: 0,
      sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() {}, count() { return 0; } },
      signal: null,
      resume: null,
    }),
  );
  return { ran, said: told.filter((b) => b?.type === "tool_result").map((b) => (typeof b.content === "string" ? b.content : JSON.stringify(b.content))).join("\n") };
};

// (fails before: yes — Filament's own loop ran it in their chat under Auto, and its words came back to the model)
test("Filament's own loop in their chat: a command into the data folder is not run, in words, under Auto too; the person's own chat runs it", async () => {
  const command = `cat "${join(data, "owner.key")}"`;
  for (const mode of ["auto", "edit"]) {
    const theirs = await loopOver({ agentsChat: true, mode, command });
    assert.deepEqual(theirs.ran, [], mode);
    assert.match(theirs.said, new RegExp(`Not run: ${FILAMENT_FOLDER_WORDS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), mode);
    assert.doesNotMatch(theirs.said, /fok_secret/);
  }
  const mine = await loopOver({ agentsChat: false, mode: "auto", command });
  assert.deepEqual(mine.ran, [command], "the person's own chat, under Auto");
  const search = await loopOver({ agentsChat: true, mode: "auto", command: "grep -r fok_ .." });
  assert.deepEqual(search.ran, [], "a search of a folder that holds it");
});

// (fails before: yes — under Auto their hands were not fenced: a read of the owner key, or a search of a folder that holds it, gave it back)
test("the loop's own read, grep and glob in their chat under Auto: nothing of the data folder, by its path or in what a search of a folder that holds it finds; the person's own finds it", async () => {
  const theirs = { root: proj, fenced: false, theirs: true };
  const mine = { root: proj, fenced: false };
  await assert.rejects(() => runHand("read", { path: join(data, "owner.key") }, theirs), /never read Filament's data folder/);
  await assert.rejects(() => runHand("grep", { pattern: "fok_", path: data }, theirs), /never read Filament's data folder/);
  for (const noRg of [false, true]) {
    const found = String(await runHand("grep", { pattern: "fok_", path: top, output: "files" }, { ...theirs, noRg, fullPaths: true }));
    assert.ok(!found.includes("owner.key"), `theirs (noRg ${noRg}): ${found}`);
    assert.match(String(await runHand("grep", { pattern: "fok_", path: top, output: "files" }, { ...mine, noRg, fullPaths: true })), /owner\.key/, `the person's (noRg ${noRg})`);
  }
  assert.ok(!String(await runHand("glob", { pattern: "**/*.key", path: top }, theirs)).includes("owner.key"));
  assert.match(String(await runHand("glob", { pattern: "**/*.key", path: top }, mine)), /owner\.key/);
});

// (fails before: yes — under Auto Filament's MCP Glob and Grep had no fence in their chat: a search of a folder that holds it listed the owner key)
test("Filament's MCP Glob and Grep in their chat under Auto: nothing of the data folder; the person's chat finds it", async () => {
  const srv = new McpToolServer({ bridge: { askClient: async () => "", permitLocal: async () => null, contextForMcpToken: () => null } });
  const turn = (/** @type {boolean} */ theirs) => ({ done: false, clientTools: { has: () => false }, toolsAt: { ...(theirs ? { agentsChat: true } : {}), dirs: [] } });
  const theirs = { turn: turn(true), conv: { opened: { fenced: true } }, cwd: proj, upstream: { id: "u", acp: {} }, native: true, modeNow: () => "auto" };
  const mine = { ...theirs, turn: turn(false), conv: { opened: {} } };
  assert.ok(!String(await srv.call("Grep", { pattern: "fok_", path: top }, theirs, {})).includes("owner.key"));
  assert.ok(!String(await srv.call("Glob", { pattern: "**/*.key", path: top }, theirs, {})).includes("owner.key"));
  await assert.rejects(() => srv.call("Glob", { pattern: "*", path: data }, theirs, {}), /never read Filament's data folder/);
  await assert.rejects(() => srv.call("Grep", { pattern: "fok_", path: data }, theirs, {}), /never read Filament's data folder/);
  assert.match(String(await srv.call("Grep", { pattern: "fok_", path: top }, mine, {})), /owner\.key/);
  assert.match(String(await srv.call("Glob", { pattern: "**/*.key", path: top }, mine, {})), /owner\.key/);
});

// (fails before: yes — the exec route judged their command by its mode alone: with their grant to run without asking, it ran)
test("their command through the exec route that names the data folder is refused in words, under Auto with their grant to run without asking too", async () => {
  const config = { agentLoop: { permissions: "auto", roots: [tmpdir(), top] }, server: { host: "127.0.0.1" }, sessions: { defaults: {} } };
  const devices = { get: (/** @type {string} */ id) => ({ id, scope: "agent", grants: { agents: true, unasked: true }, revokedAt: null }) };
  const a = { config: { get: () => config }, memory: null, dataDir: data, devices, sseClients: new Set(), log: () => {} };
  const route = createRouter(execRoutes(/** @type {any} */ (a)));
  const m = route("POST", "/exec");
  if (!m) throw new Error("no exec row");
  const who = { kind: "device", scope: "agent", device: { id: "phone", name: "Filament agents on phone", grants: { agents: true, unasked: true } } };
  for (const command of [`cat "${join(data, "owner.key")}"`, "grep -r fok_ ..", "cat $PWD/../AppData/Roaming/Filament/secret.key"]) {
    /** @type {any} */
    const res = { status: 0, body: "", headersSent: false, writableEnded: false, setHeader() {}, writeHead(/** @type {number} */ s) { res.status = s; return res; }, end(/** @type {any} */ c) { res.body += c ?? ""; res.writableEnded = true; }, on() {}, once() {}, write() { return true; }, flushHeaders() {} };
    await m.handler({ req: {}, res, url: new URL("http://127.0.0.1/api/exec"), path: "/exec", method: "POST", params: m.params, json: async () => ({ cwd: proj, command }), who }, a);
    assert.equal(res.status, 403, `${command}: ${res.body}`);
    assert.equal(JSON.parse(res.body).error, `Not run: ${FILAMENT_FOLDER_WORDS}.`, command);
  }
});

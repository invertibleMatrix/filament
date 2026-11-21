// @ts-check
// HarnessV4_Overnight_Plan batch 2 (E10 + E5): what an agent may reach. The chat's own MCP servers (`plugins.mcp`)
// for whichever engine answers, beside its upstream's own, and the folders it may read besides its working folder
// (`loop.addedFolders`). Pure pieces first, then Filament's own agent and a coding agent's session end to end.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mcpServerProblem, mergeFolders, reachOf, resolveSettings, scopeOf, validateLayer, valueProblems } from "../src/services/session-settings.js";
import { acpServers, chatKeyOf, codexServers, cursorServers, serversFor } from "../src/adapters/agents/chat-servers.js";
import { resolveInside } from "../src/adapters/tools/fs-fence.js";
import { runHand } from "../src/adapters/tools/hands.js";
import { addedFoldersOf } from "../src/app/agent/turn.js";
import { systemPromptFor } from "../src/app/agent/prompt.js";
import { planToolset } from "../src/adapters/agents/acp/toolset.js";
import { readProfile } from "../src/adapters/agents/acp/profile.js";
import { confirmedOf } from "../src/core/catalogues.js";
import { CodexBridge } from "../src/adapters/agents/codex/bridge.js";
import { CursorSdkBridge } from "../src/adapters/agents/cursor-sdk.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { startOAuthMcp, pressAllow } from "./helpers/oauth-mcp-fake.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, "fixtures", "fake-acp-agent.mjs");
const MCP_FIXTURE = join(HERE, "fixtures", "mcp-server.mjs");
/** The same folder, as Windows may write it in another case. @param {string} a @param {string} b */
const same = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

/**
 * Where in a document a test's secret (`s3cret`) stands, as paths: none, where nothing may keep it.
 * @param {unknown} v @param {string} [at] @returns {string[]}
 */
const secretsIn = (v, at = "$") =>
  typeof v === "string"
    ? v.includes("s3cret") ? [at] : []
    : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => secretsIn(x, `${at}.${k}`)) : [];
/** A chat's own servers: one over stdio, one over HTTP, each with a secret the record must never show. */
const CHAT = [
  { name: "files", command: "node", args: ["files.mjs"], env: { TOKEN: "s3cret-env" }, cwd: "/srv/files" },
  { name: "web", url: "http://127.0.0.1:9/mcp", headers: { Authorization: "Bearer s3cret-header" } },
];
/** An upstream's own servers (its card's `mcpServers`), one of the same name as the chat's. */
const CARD = { mcpServers: [{ name: "files", command: "card-files", args: ["--x"], env: [{ name: "CARD", value: "1" }] }, { name: "git", command: "git-mcp", env: { G: "2" } }] };

describe("the two settings (OV-D15, OV-D19, OV-D20)", () => {
  // (fails before: yes — Filament was a server's name like any other, and loop.addedFolders did not exist)
  test("a server may not take Filament's own name; added folders are whole paths, sixteen at most, a repo fact Filament's agents obey", () => {
    assert.match(String(mcpServerProblem({ name: "filament", command: "node" })), /cannot be named "filament": that is Filament's own server's name/);
    assert.equal(mcpServerProblem({ name: "files", command: "node" }), null);
    assert.match(valueProblems("plugins.mcp", [{ name: "filament", url: "http://x/mcp" }]).join(), /"plugins\.mcp\[0\]" cannot be named "filament"/);
    const abs = join(tmpdir(), "notes");
    assert.deepEqual(valueProblems("loop.addedFolders", [abs]), []);
    assert.deepEqual(valueProblems("loop.addedFolders", [join(tmpdir(), "not-there-at-all")]), [], "a folder that is not there yet is judged at each turn, not refused when set");
    assert.match(valueProblems("loop.addedFolders", ["rel/x"]).join(), /^"loop\.addedFolders\[0\]" must be a whole path \(rel\/x is relative\)$/);
    assert.equal(valueProblems("loop.addedFolders", [""]).length, 1, "an empty path");
    assert.equal(valueProblems("loop.addedFolders", [3]).length, 1, "a non-string");
    assert.equal(valueProblems("loop.addedFolders", abs).length, 1, "a list, not one path");
    assert.match(valueProblems("loop.addedFolders", Array.from({ length: 17 }, (_, i) => join(abs, String(i)))).join(), /"loop\.addedFolders" holds at most 16 folders/);
    assert.deepEqual([scopeOf("loop.addedFolders"), reachOf("loop.addedFolders")], ["repo", "filament"]);
    assert.equal(validateLayer({ loop: { addedFolders: [abs] } }, { at: "project" }).errors.length, 0, "the project holds it, as it holds the rules");
  });

  // (fails before: yes — a project's or a chat's list replaced yours whole, so adding one there dropped yours)
  test("the folders of all chats, the project and the chat add up by path, the broadest first, each once (HS-D7)", () => {
    const notes = join(tmpdir(), "notes"), docs = join(tmpdir(), "docs"), mine = join(tmpdir(), "mine");
    const r = resolveSettings({ global: { loop: { addedFolders: [notes] } }, project: { loop: { addedFolders: [docs, `${notes}/`] } }, session: { loop: { addedFolders: [mine, docs] } } });
    assert.deepEqual(r.flat["loop.addedFolders"], [notes, docs, mine]);
    assert.equal(r.sources["loop.addedFolders"], "session", "the narrowest layer that names any stays its source");
    assert.deepEqual(r.layers.project.loop.addedFolders, [docs, `${notes}/`], "each layer keeps its own list");
    if (process.platform === "win32") assert.deepEqual(mergeFolders([[notes], [notes.toUpperCase()]]), [notes], "Windows reads a path in either case");
    assert.deepEqual(resolveSettings({}).flat["loop.addedFolders"], [], "none anywhere: the default");
    assert.deepEqual(resolveSettings({ global: { loop: { addedFolders: [notes] } } }).flat["loop.addedFolders"], [notes]);
  });
});

describe("one list for every engine (OV-D15, OV-D16)", () => {
  // (fails before: yes — the chat's servers reached Filament's own agent only, and no engine's field was built from one list)
  test("the card's servers, then the chat's, one name the chat's; the words name a server and its transport, never a value", () => {
    const { servers, words, key } = serversFor(CARD, CHAT, { title: "Claude Code", http: true, cwd: false });
    assert.deepEqual(servers.map((s) => s.name), ["git", "files", "web"]);
    assert.deepEqual(words, [
      "mcp: the chat's MCP servers given to Claude Code: files (stdio), web (http)",
      "mcp: the chat's server files is given in place of Claude Code's own of that name (its upstream's mcpServers)",
      "mcp: the chat's server files starts where Claude Code starts it: its folder (/srv/files) has no place in what Claude Code is given",
    ]);
    assert.doesNotMatch(words.join("\n") + key, /s3cret/);
    assert.equal(key, chatKeyOf(CHAT));
    assert.deepEqual([chatKeyOf([]), chatKeyOf(null), chatKeyOf(undefined)], ["", "", ""]);
    assert.notEqual(chatKeyOf(CHAT), chatKeyOf([CHAT[0]]), "a change of the list is a change of its key");
    assert.deepEqual(serversFor(CARD, [], { title: "x", http: true, cwd: true }).words, [], "no chat's list, nothing said");
  });

  // (fails before: yes — the same)
  test("an agent that takes MCP over stdio only is not given the chat's HTTP server, and is told why", () => {
    const stdioOnly = serversFor({}, CHAT, { title: "Gemini CLI", http: false, cwd: false });
    assert.deepEqual(stdioOnly.servers.map((s) => s.name), ["files"]);
    assert.equal(stdioOnly.words[0], "mcp: the chat's MCP server given to Gemini CLI: files (stdio)");
    assert.ok(stdioOnly.words.includes("mcp: the chat's server web is not given to Gemini CLI: it is reached over HTTP, and Gemini CLI takes MCP over stdio only (mcpCapabilities.http)"), stdioOnly.words.join("\n"));
  });

  // (fails before: yes — Codex and Cursor's SDK were given no server but Filament's own)
  test("each engine's own field: ACP's session params, Codex's config keys, Cursor's SDK option", () => {
    const { servers } = serversFor(CARD, CHAT, { title: "Codex", http: true, cwd: true });
    assert.deepEqual(acpServers(servers), [
      { name: "git", command: "git-mcp", args: [], env: [{ name: "G", value: "2" }] },
      { name: "files", command: "node", args: ["files.mjs"], env: [{ name: "TOKEN", value: "s3cret-env" }] },
      { type: "http", name: "web", url: "http://127.0.0.1:9/mcp", headers: [{ name: "Authorization", value: "Bearer s3cret-header" }] },
    ]);
    assert.deepEqual(codexServers(servers), {
      "mcp_servers.git": { command: "git-mcp", args: [], env: { G: "2" } },
      "mcp_servers.files": { command: "node", args: ["files.mjs"], env: { TOKEN: "s3cret-env" }, cwd: "/srv/files" },
      "mcp_servers.web": { url: "http://127.0.0.1:9/mcp", http_headers: { Authorization: "Bearer s3cret-header" } },
    });
    assert.deepEqual(cursorServers(servers), {
      git: { command: "git-mcp", args: [], env: { G: "2" } },
      files: { command: "node", args: ["files.mjs"], env: { TOKEN: "s3cret-env" }, cwd: "/srv/files" },
      web: { type: "http", url: "http://127.0.0.1:9/mcp", headers: { Authorization: "Bearer s3cret-header" } },
    });
  });

  // (fails before: yes — no session plan carried the chat's servers or folders)
  test("an ACP session's plan: the chat's servers beside Filament's own, its folders where the agent takes them, said either way", () => {
    /** @param {Record<string, unknown>} sessionCapabilities @param {any} [mcpCapabilities] */
    const init = (sessionCapabilities, mcpCapabilities = { http: true, sse: false }) => ({ protocolVersion: 1, agentCapabilities: { loadSession: true, mcpCapabilities, sessionCapabilities }, agentInfo: { name: "fake", version: "1.0.0" } });
    const upstream = { id: "claude-code", name: "Claude", acp: { command: "claude-agent-acp" } };
    /** @param {any} initResult @param {any} toolsAt */
    const plan = (initResult, toolsAt) =>
      planToolset({ acp: upstream.acp, upstream, proc: { initResult }, profile: readProfile(initResult, confirmedOf(upstream)), turn: { bridge: "prompts", toolsAt }, fullBridge: false, cwd: "/w", mcpBase: null, memoryWanted: false, existingToken: null, notes: [] });
    const takes = plan(init({ additionalDirectories: {}, resume: {} }), { mcp: CHAT, dirs: ["/x/notes", "/x/more"] });
    assert.deepEqual(takes.dirs, ["/x/notes", "/x/more"]);
    assert.deepEqual(takes.mcpServers.map((/** @type {any} */ s) => s.name), ["files", "web"]);
    assert.match(takes.chatWords.join("\n"), /is given the chat's added folders to read: \/x\/notes, \/x\/more$/m);
    const none = plan(init({ resume: {} }), { dirs: ["/x/notes"] });
    assert.deepEqual(none.dirs, []);
    assert.match(none.chatWords.join("\n"), /takes no added folders \(sessionCapabilities\.additionalDirectories\), so the chat's are not given: it reads them only as its own rules let it/);
    const stdio = plan(init({}, { http: false, sse: false }), { mcp: CHAT });
    assert.deepEqual(stdio.mcpServers.map((/** @type {any} */ s) => s.name), ["files"]);
    assert.match(stdio.chatWords.join("\n"), /the chat's server web is not given to .*: it is reached over HTTP/);
    assert.deepEqual(plan(init({ additionalDirectories: {} }), {}).chatWords, [], "nothing the chat adds, nothing said");
  });
});

describe("a folder added for reading (OV-D21, OV-D22)", () => {
  let base = "";
  let root = "";
  let added = "";
  before(() => {
    // base/work is the working folder, holding to-notes: a link to base/notes, the added folder, which holds a note
    // and away: a link to base/outside.
    base = mkdtempSync(join(tmpdir(), "filament-reach-"));
    root = join(base, "work");
    added = join(base, "notes");
    for (const d of [root, added, join(base, "outside")]) mkdirSync(d);
    writeFileSync(join(root, "a.txt"), "a\n");
    writeFileSync(join(added, "note.md"), "the added note\n");
    writeFileSync(join(base, "outside", "secret.txt"), "s\n");
    symlinkSync(join(base, "outside"), join(added, "away"), "junction");
    symlinkSync(added, join(root, "to-notes"), "junction");
  });
  after(() => removeDirs(base));

  // (fails before: yes — the fence knew one folder)
  test("the fence: a read may land in an added folder, a link is judged where it leads, a write never lands there", () => {
    const reads = [added];
    assert.equal(resolveInside(root, join(added, "note.md"), { reads }), join(added, "note.md"));
    assert.equal(resolveInside(root, "../notes/note.md", { reads }), join(added, "note.md"));
    assert.throws(() => resolveInside(root, "../notes/note.md"), /"\.\.\/notes\/note\.md" resolves outside the allowed task folder$/);
    assert.throws(() => resolveInside(root, "../outside/secret.txt", { reads }), /resolves outside the allowed task folder and the folders added to it$/);
    assert.throws(() => resolveInside(root, join(added, "away", "secret.txt"), { reads }), /reaches outside the allowed task folder through a link/);
    assert.equal(resolveInside(root, "to-notes/note.md", { reads }), join(root, "to-notes", "note.md"), "a link from the working folder into an added folder leads where a read may go");
    assert.throws(() => resolveInside(root, "to-notes/note.md"), /through a link/, "without the folder added, it leads out");
  });

  // (fails before: yes — read, grep and glob refused a path outside the working folder)
  test("Filament's hands: read, grep and glob reach an added folder, grep naming its files whole; write and edit never", async () => {
    const o = { root, reads: [added] };
    assert.match(String(await runHand("read", { path: join(added, "note.md") }, o)), /the added note/);
    const found = String(await runHand("grep", { pattern: "added note", path: added, output: "files" }, o));
    assert.ok(found.includes(join(added, "note.md")), found);
    assert.match(String(await runHand("glob", { pattern: "*.md", path: added }, o)), /note\.md/);
    await assert.rejects(runHand("write", { path: join(added, "new.md"), content: "x" }, o), /resolves outside the allowed task folder$/);
    await assert.rejects(runHand("edit", { path: join(added, "note.md"), edits: [{ oldText: "added", newText: "x" }] }, o), /resolves outside the allowed task folder$/);
    await assert.rejects(runHand("read", { path: join(added, "note.md") }, { root }), /resolves outside the allowed task folder$/, "not added, not read");
    assert.equal(readFileSync(join(added, "note.md"), "utf8"), "the added note\n");
    assert.equal(existsSync(join(added, "new.md")), false);
  });

  // (fails before: yes — addedFoldersOf did not exist)
  test("which added folders pass as the working folder does — one gone, outside the roots, or on an exposed listener is left out, said why", () => {
    const cfg = { server: { host: "127.0.0.1" }, agentLoop: { roots: [] } };
    const gone = join(base, "gone");
    const v = addedFoldersOf(cfg, [added, added, "", 3, gone]);
    assert.equal(v.folders.length, 1, "once, however often it is listed");
    assert.ok(same(v.folders[0], realpathSync.native(added)), v.folders[0]);
    assert.deepEqual(v.left, [`${gone} (it does not exist on this machine)`]);
    assert.deepEqual(addedFoldersOf({ ...cfg, agentLoop: { roots: [root] } }, [added]).left, [`${added} (it is not under any folder agentLoop.roots lists)`]);
    assert.equal(addedFoldersOf({ ...cfg, agentLoop: { roots: [base] } }, [added]).folders.length, 1, "under a listed root");
    assert.deepEqual(addedFoldersOf({ server: { host: "0.0.0.0" }, agentLoop: { roots: [] } }, [added]).left, [`${added} (agentLoop.roots is empty while Filament listens beyond this machine)`]);
    assert.deepEqual(addedFoldersOf(cfg, null), { folders: [], left: [] });
  });

  // (fails before: yes — the prompt named the working folder alone)
  test("Filament's agent's prompt names the added folders in one line after the working folder's, only when there are some (OC-58)", () => {
    const at = { root, delegateRead: false };
    const none = systemPromptFor(at);
    assert.equal(systemPromptFor({ ...at, added: [] }), none, "with none, the same bytes");
    const more = join(base, "more");
    const line = `Folders added to it, which your file tools and commands that only read reach too (a change there is as anywhere outside the working folder): ${added}, ${more}`;
    const some = systemPromptFor({ ...at, added: [added, more] });
    assert.ok(some.includes(`Working folder: ${root}\n${line}`), some);
    assert.equal(some.replace(`\n${line}`, ""), none, "and nothing else moves");
  });
});

describe("end to end: Filament's own agent and a coding agent's session (OC-38 to OC-63)", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  const root = mkdtempSync(join(tmpdir(), "filament-reach-e2e-"));
  const projDir = join(root, "project");
  const added = join(root, "notes");
  const gone = join(root, "gone");
  /** The session methods each fake agent is sent. */
  const calls = join(root, "claudeish-calls.jsonl");
  const olderCalls = join(root, "older-calls.jsonl");
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  /** The chat's servers: a real stdio server, and one over HTTP no one answers at. */
  const FILES = { name: "files", command: process.execPath, args: [MCP_FIXTURE], env: { TOKEN: "s3cret-env" } };
  const WEB = { name: "web", url: "http://127.0.0.1:9/mcp", headers: { Authorization: "Bearer s3cret-header" } };
  before(async () => {
    for (const d of [projDir, added]) mkdirSync(d);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    writeFileSync(join(added, "note.md"), "the added note\n");
    up = await fakeUpstream(async (call) => brain(call));
    /** @param {Record<string, string>} env */
    const acp = (env) => ({ command: process.execPath, args: [FAKE], env, cwdDefault: projDir, permissions: "allow-all", hints: false });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
          { id: "claudeish", name: "claudeish", type: "acp", acp: acp({ FAKE_ACP_CALLS: calls, FAKE_ACP_ALLOW_LOAD: "1", FAKE_ACP_SESSION_CAPS: "additionalDirectories,resume", FAKE_ACP_MCP_CAPS: "http" }) },
          { id: "older", name: "older", type: "acp", acp: acp({ FAKE_ACP_CALLS: olderCalls, FAKE_ACP_NO_LOAD: "1" }) },
        ];
        cfg.routes = [
          { match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          ...["claudeish", "older"].map((id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true })),
        ];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root, shim.dataDir);
  });

  /** A harness session on a model, with settings of its own. @param {string} model @param {any} settings */
  const session = async (model, settings) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain", settings } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** @param {string} id @param {any} patch */
  const change = async (id, patch) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /**
   * A harness turn, ended, and its record once written. `page`: sent as the page sends one, its run's events on —
   * the session's switch answers a coding agent's requests only then. `asIs`: the card's Send it as it is, the answer
   * where what the chat gives the agent changed since its session opened (the owner's of 11-06).
   * @param {string} id @param {string} content
   */
  const turn = async (id, content, page = false, asIs = false, allow = false) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { ...(page ? { content, stream: true, runEvents: true } : { content, stream: false }), ...(asIs ? { sendAsIs: true } : {}), ...(allow ? { allow: true } : {}) } });
    assert.equal(r.status, 200, await r.clone().text());
    const runId = String(r.headers.get("x-filament-request-id"));
    const json = page ? (await r.text(), null) : await r.json();
    const rec = await until(async () => {
      const x = await shim.record(runId);
      return Array.isArray(x?.changes) ? x : null;
    }, "the record");
    return { json, rec, changes: /** @type {string[]} */ (rec.changes) };
  };
  /** The session methods a fake agent was sent, in order. @param {string} file @returns {any[]} */
  const sent = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  /** The opens (new, load, resume) a fake agent was sent. @param {string} file */
  const opens = (file) => sent(file).filter((c) => ["session/new", "session/load", "session/resume"].includes(c.method));
  const text = (/** @type {any[]} */ blocks) => (blocks || []).filter((b) => b?.type === "text").map((b) => b.text).join("");
  /** @param {any} c */
  const resultText = (c) => (typeof c.content === "string" ? c.content : (c.content || []).map((/** @type {any} */ b) => b.text || "").join(""));
  const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });

  // (fails before: yes — the loop's file tools and its command judge refused a folder outside the working folder)
  test("Filament's agent in Read-only reads an added folder with its tools and a command that only reads; a gone folder is said; the prompt names the folder", async () => {
    const id = await session("agent/brain-model", { loop: { permissions: "read-only", addedFolders: [added, gone] } });
    /** @type {any[]} */
    let results = [];
    let system = "";
    let round = 0;
    brain = (call) => {
      round++;
      if (round === 1) {
        const s = call.body.system;
        system = Array.isArray(s) ? s.map((/** @type {any} */ b) => b.text || "").join("\n") : String(s || "");
        return reply([
          toolUse("r1", "read", { path: join(added, "note.md") }),
          toolUse("g1", "grep", { pattern: "added note", path: added, output: "files" }),
          toolUse("b1", "bash", { command: "cat ../notes/note.md" }),
        ], "tool_use");
      }
      const m = call.body.messages.at(-1);
      results = Array.isArray(m?.content) ? m.content.filter((/** @type {any} */ c) => c?.type === "tool_result") : [];
      return reply([{ type: "text", text: "Read it." }]);
    };
    const { json, changes } = await turn(id, "read the added note");
    assert.equal(text(json.content), "Read it.");
    const byId = Object.fromEntries(results.map((r) => [r.tool_use_id, r]));
    assert.match(resultText(byId.r1), /the added note/);
    assert.notEqual(byId.r1.is_error, true);
    assert.ok(resultText(byId.g1).includes("note.md"), resultText(byId.g1));
    assert.match(resultText(byId.b1), /the added note/, "the command that only reads ran, in Read-only");
    assert.ok(changes.some((c) => c.startsWith("agent: an added folder is left out — ") && c.includes(gone) && c.endsWith("(it does not exist on this machine)")), changes.join("\n"));
    assert.match(system, /Folders added to it, which your file tools and commands that only read reach too \(a change there is as anywhere outside the working folder\): /);
    assert.ok(system.includes(realpathSync.native(added)) || system.toLowerCase().includes(realpathSync.native(added).toLowerCase()), system);
    assert.equal(system.includes(gone), false, "a folder left out is not named");
  });

  // (fails before: yes — HarnessV4_SpacesPlugins_Plan A2b, SP-D5: a write outside the working folder was refused flatly
  // in Edit, which pushed people into Full access)
  test("Filament's agent in Edit asks before it writes in an added folder; a yes writes that file alone, and the next write there asks again", async () => {
    const id = await session("agent/brain-model", { loop: { permissions: "edit", addedFolders: [added] } });
    /** @type {any[]} */
    let results = [];
    let round = 0;
    brain = (call) => {
      round++;
      if (round === 1) return reply([toolUse("w1", "write", { path: join(added, "new.md"), content: "x\n" })], "tool_use");
      const m = call.body.messages.at(-1);
      results = Array.isArray(m?.content) ? m.content.filter((/** @type {any} */ c) => c?.type === "tool_result") : [];
      if (round === 2) return reply([toolUse("w2", "write", { path: join(added, "two.md"), content: "y\n" })], "tool_use");
      return reply([{ type: "text", text: "Done." }]);
    };
    const first = await turn(id, "write a note there");
    assert.match(JSON.stringify(first.json), /May I write [^?]*new\.md\? It is outside this chat's folder/);
    assert.equal(existsSync(join(added, "new.md")), false, "nothing written before the yes");
    const second = await turn(id, "yes", false, false, true);
    assert.equal(results.length, 1);
    assert.notEqual(results[0].is_error, true, resultText(results[0]));
    assert.equal(readFileSync(join(added, "new.md"), "utf8"), "x\n");
    assert.ok(second.changes.includes("agent: the developer allowed a write outside this chat's folder, this once"), second.changes.join("\n"));
    assert.match(JSON.stringify(second.json), /May I write [^?]*two\.md\?/, "the yes was for that write alone");
    assert.equal(existsSync(join(added, "two.md")), false);
  });

  // (fails before: yes — a coding agent's session opened with its upstream's servers and Filament's own alone)
  test("a coding agent is given the chat's servers and folders as its session opens; a change opens it again; nothing secret is kept", async () => {
    const id = await session("claudeish/fake-a", { plugins: { mcp: [FILES, WEB] }, loop: { addedFolders: [added] } });
    const first = await turn(id, "hello");
    const opened = opens(calls).at(-1);
    assert.equal(opened?.method, "session/new");
    assert.deepEqual(opened.servers, ["files:stdio", "web:http"]);
    assert.ok(typeof opened.mcpUrl === "string" && /\/mcp\//.test(opened.mcpUrl), "Filament's own server beside them");
    assert.equal(opened.dirs?.length, 1);
    assert.ok(same(opened.dirs[0], realpathSync.native(added)), opened.dirs[0]);
    assert.ok(first.changes.includes("mcp: the chat's MCP servers given to claudeish: files (stdio), web (http)"), first.changes.join("\n"));
    assert.ok(first.changes.some((c) => /^acp: claudeish is given the chat's added folder to read: /.test(c)), first.changes.join("\n"));
    assert.deepEqual(secretsIn(first.rec), [], "the turn's record");
    const file = join(shim.dataDir, "acp-sessions.json");
    const kept = JSON.parse(String(await until(() => (existsSync(file) && readFileSync(file, "utf8").includes('"toolsMcp"') ? readFileSync(file, "utf8") : null), "the sessions' record on disk")));
    assert.deepEqual(secretsIn(kept), [], "the chat's servers' env and headers are never written to disk");
    const conv = /** @type {any} */ (Object.values(kept.conversations)).find((c) => c.sessionId === opened.sessionId);
    assert.deepEqual(conv.opened.mcpServers.map((/** @type {any} */ s) => s.name), ["filament"], "its open's record leaves the chat's servers out");
    assert.equal(conv.toolsMcp, "", "so a session opened again from it after a restart is given them at the chat's next turn");
    assert.equal(conv.toolsDirs.toLowerCase(), realpathSync.native(added).toLowerCase(), "the folders, which carry no secret, kept as they are");

    // The same list: the session goes on as it was.
    const again = await turn(id, "again");
    assert.equal(opens(calls).length, 1, "no open");
    assert.equal(again.changes.some((c) => /opened again|resumed again|loaded again/.test(c)), false, again.changes.join("\n"));

    // A server less: the message asks first, the session going on (the owner's of 11-06); sent as it is, the session is
    // opened again with the list as it is now.
    await change(id, { plugins: { mcp: [FILES] } });
    const asked = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "fewer", stream: false } });
    assert.equal(asked.status, 409);
    assert.deepEqual((await asked.json()).resumeQuestion?.changes, ["MCP server web removed"]);
    const fewer = await turn(id, "fewer", false, true);
    const reopened = opens(calls).at(-1);
    assert.match(String(reopened?.method), /^session\/(resume|load)$/);
    assert.deepEqual(reopened.servers, ["files:stdio"]);
    assert.equal(reopened.dirs?.length, 1, "the folders, whole at every open");
    assert.ok(fewer.changes.some((c) => /(resumed|loaded) again: the chat's own MCP servers or added folders changed what it opens with$/.test(c)), fewer.changes.join("\n"));
    assert.notEqual(reopened.mcpUrl, opened.mcpUrl, "at a new address: Claude's adapter keeps a session's query while its servers stay as they were");

    // No folder: opened again, with none.
    await change(id, { loop: { addedFolders: [] } });
    await turn(id, "no folders");
    const bare = opens(calls).at(-1);
    assert.match(String(bare?.method), /^session\/(resume|load)$/);
    assert.equal(bare.dirs, undefined);
    assert.equal(opens(calls).length, 3);
  });

  // (fails before: yes — HC-149: a signed-in server went to a coding agent as written, with no token, so it met a 401;
  // then with its token as its header, so a renewal opened the session again — the owner's of 11-07)
  test("HC-149: the chat's signed-in server is given to a coding agent at Filament's door, said by name; a renewal there keeps the session; nothing keeps the token", async () => {
    const f = await startOAuthMcp();
    try {
      const id = await session("claudeish/fake-a", { plugins: { mcp: [{ name: "linear", url: f.url }] } });
      const st = await (await shim.api("/api/mcp-servers/sign-in", { method: "POST", body: { scope: `chat:${id}`, name: "linear" } })).json();
      assert.equal((await fetch(await pressAllow(st.url))).status, 200);
      const first = await turn(id, "hello");
      const opened = opens(calls).at(-1);
      assert.deepEqual([opened.method, opened.servers, opened.authed], ["session/new", ["linear:http"], undefined]);
      const door = String(opened.doors?.[0]);
      assert.match(door, new RegExp(`^${shim.url}/mcp/c/[^/]+/linear/[\\w-]{32}$`));
      assert.ok(first.changes.includes(`mcp: the chat's server linear is given through Filament, with its sign-in on ${new URL(f.url).host}`), first.changes.join("\n"));
      /** What the agent asks at the address it was given. @returns {Promise<[number, string]>} */
      const whoami = async () => {
        const r = await fetch(door, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } }) });
        return [r.status, JSON.stringify(await r.json())];
      };
      const [status, said] = await whoami();
      assert.equal(status, 200);
      assert.ok(said.includes("signed in as test-user (grant 1)"), said);
      f.expireAll();
      assert.equal((await whoami())[0], 200, "run out: renewed at the door");
      const count = opens(calls).length;
      const again = await turn(id, "again");
      assert.equal(opens(calls).length, count, "renewed: no open");
      const kept = readFileSync(join(shim.dataDir, "acp-sessions.json"), "utf8");
      for (const x of [JSON.stringify(first.rec), JSON.stringify(again.rec), kept]) assert.doesNotMatch(x, /\bat-\d+-\d+\b/);
    } finally {
      await f.close();
    }
  });

  // (fails before: yes — the same; an agent that cannot reopen said nothing of a list it kept)
  test("an agent that takes no added folders is told so; one that cannot open its session again keeps its list and says so once", async () => {
    const id = await session("older/fake-a", { plugins: { mcp: [FILES] }, loop: { addedFolders: [added] } });
    const first = await turn(id, "hello");
    const opened = opens(olderCalls).at(-1);
    assert.equal(opened?.method, "session/new");
    assert.deepEqual(opened.servers, ["files:stdio"]);
    assert.equal(opened.dirs, undefined);
    assert.ok(first.changes.some((c) => /^acp: older takes no added folders \(sessionCapabilities\.additionalDirectories\)/.test(c)), first.changes.join("\n"));
    await change(id, { plugins: { mcp: [FILES, WEB] } });
    const moved = await turn(id, "moved", false, true);
    const said = "acp: the chat's own MCP servers or added folders changed, and older cannot open its session again (session/load or session/resume): it keeps what it opened with until a new session";
    assert.ok(moved.changes.includes(said), moved.changes.join("\n"));
    assert.equal(opens(olderCalls).length, 1, "the session it has goes on");
    const next = await turn(id, "next");
    assert.equal(next.changes.includes(said), false, "said once for the change");
  });

  // (fails before: yes — memory's tools switched off or on for a session older cannot open again was said nowhere, and
  // with them on again the record claimed memory's tools the session was never given)
  test("one that cannot open its session again says so once for a switch of Filament's own tools too, and its record claims no memory tool it was not given", async () => {
    const st = await (await shim.api("/api/state")).json();
    /** Memory's tools on or off for every chat (`memory.autopilot.tools`), as the person's settings switch them. @param {boolean} on */
    const tools = async (on) => assert.equal((await shim.api("/api/config", { method: "PUT", body: { ...st.config, memory: { ...st.config.memory, autopilot: { ...st.config.memory.autopilot, tools: on } } } })).status, 200);
    const offered = /^memory: the agent can use Filament's memory tools/;
    const said = "acp: Filament's tools for it (memory's tools) changed, and older cannot open its session again (session/load or session/resume): it keeps what it opened with until a new session";
    try {
      const id = await session("older/fake-a", {});
      const first = await turn(id, "hello");
      const opened = opens(olderCalls).length;
      assert.ok(first.changes.some((c) => offered.test(c)), first.changes.join("\n"));
      await tools(false);
      const off = await turn(id, "memory off");
      assert.ok(off.changes.includes(said), off.changes.join("\n"));
      assert.equal(opens(olderCalls).length, opened, "the session it has goes on");
      const still = await turn(id, "still off");
      assert.equal(still.changes.includes(said), false, "said once for the change");
      await tools(true);
      const back = await turn(id, "memory on");
      assert.equal(back.changes.some((c) => /cannot open its session again/.test(c)), false, "it has them, as it opened with them");
      assert.ok(back.changes.some((c) => offered.test(c)), back.changes.join("\n"));
      await tools(false);
      const again = await turn(id, "off again");
      assert.ok(again.changes.includes(said), `a change made again is said again: ${again.changes.join("\n")}`);

      // A session opened with them off is given none: switched on, it says it goes on without them, and claims none.
      const bare = await session("older/fake-a", {});
      const none = await turn(bare, "hello");
      assert.equal(none.changes.some((c) => offered.test(c)), false, none.changes.join("\n"));
      await tools(true);
      const on = await turn(bare, "memory on");
      assert.ok(on.changes.includes(said), on.changes.join("\n"));
      assert.equal(on.changes.some((c) => offered.test(c)), false, `no memory tool it was never given: ${on.changes.join("\n")}`);
    } finally {
      assert.equal((await shim.api("/api/config", { method: "PUT", body: st.config })).status, 200);
    }
  });

  // (fails before: yes — the session's switch judged a command by the working folder alone)
  test("a coding agent's command that only reads in an added folder passes as reading in Read-only; without the folder it does not", async () => {
    const withIt = await session("claudeish/fake-a", { loop: { permissions: "read-only", addedFolders: [added] } });
    const ran = await turn(withIt, "~permbash cat ../notes/note.md", true);
    assert.ok(ran.changes.includes("permission: claudeish asked to run `cat ../notes/note.md` — ran without asking: it only reads"), ran.changes.join("\n"));
    const without = await session("claudeish/fake-a", { loop: { permissions: "read-only" } });
    const refused = await turn(without, "~permbash cat ../notes/note.md", true);
    const judged = refused.changes.filter((c) => c.startsWith("permission: "));
    assert.equal(judged.length, 1, refused.changes.join("\n"));
    assert.doesNotMatch(judged[0], /ran without asking/);
  });

  // (fails before: no — an outside client's request never carried the chat's settings; pinned so it stays so)
  test("an outside client's request on the same agent is given only its upstream's servers, and no folder", async () => {
    const before = opens(calls).length;
    const r = await shim.api("/v1/chat/completions", {
      method: "POST",
      headers: { "x-filament-conversation": "outside-reach" },
      body: { model: "claudeish/fake-a", messages: [{ role: "system", content: `Working directory: ${projDir}` }, { role: "user", content: "hi" }] },
    });
    assert.equal(r.status, 200, await r.clone().text());
    await r.text();
    const opened = opens(calls).slice(before).at(-1);
    assert.equal(opened?.method, "session/new");
    assert.equal(opened.servers, undefined);
    assert.equal(opened.dirs, undefined);
  });
});

describe("Codex and Cursor's SDK, each given the chat's servers and folders its own way (OC-43, OC-44, OC-61, OC-62)", () => {
  /** @type {string} */ let dir;
  /** @type {string} */ let added;
  /** JSON lines of a file, oldest first. @param {string} file @returns {any[]} */
  const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  /** @param {string} text */
  const body = (text) => ({ model: "m", max_tokens: 100, messages: [{ role: "user", content: text }] });
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-reach-engines-"));
    added = join(dir, "notes");
    mkdirSync(added);
    process.env.FAKE_SDK_LOG = join(dir, "sdk.jsonl");
  });
  after(async () => {
    delete process.env.FAKE_SDK_LOG;
    await removeDirs(dir);
  });

  // (fails before: yes — Codex's thread was given Filament's server alone)
  test("Codex: a config key for each server, its upstream's and the chat's; the folders said, not given; a changed list opens the thread again", async () => {
    const calls = join(dir, "cx.jsonl");
    const bridge = new CodexBridge({ log: () => {}, stateFile: join(dir, "codex-sessions.json") });
    const up = { id: "cx", name: "cx", type: "codex", acp: { command: process.execPath, args: [join(HERE, "fixtures", "fake-codex-app-server.mjs")], env: { FAKE_CODEX_CALLS: calls }, cwdDefault: dir, permissions: "allow-all", mcpServers: [{ name: "git", command: "git-mcp" }] } };
    const heard = (/** @type {string} */ method) => lines(calls).filter((m) => m.method === method);
    /** @param {string} text @param {any} toolsAt */
    const run = (text, toolsAt) => bridge.run({ upstream: up, modelId: "gpt-6-astra", format: "anthropic", body: body(text), conversationId: "chat", onEvent: () => {}, toolsAt: { chain: "c1", turn: "t1", ...toolsAt } });
    try {
      const first = await run("hello", { mcp: CHAT, dirs: [added] });
      const [start] = heard("thread/start");
      assert.deepEqual(start.params.config["mcp_servers.git"], { command: "git-mcp", args: [] });
      assert.deepEqual(start.params.config["mcp_servers.files"], { command: "node", args: ["files.mjs"], env: { TOKEN: "s3cret-env" }, cwd: "/srv/files" });
      assert.deepEqual(start.params.config["mcp_servers.web"], { url: "http://127.0.0.1:9/mcp", http_headers: { Authorization: "Bearer s3cret-header" } });
      assert.ok(first.notes.includes("mcp: the chat's MCP servers given to cx: files (stdio), web (http)"), first.notes.join("\n"));
      assert.ok(first.notes.includes(`codex: the chat's added folders are readable to Codex as they stand: its sandbox reads anywhere, and Filament's judge of its commands takes ${added} as readable`), first.notes.join("\n"));
      assert.deepEqual(secretsIn(first.notes), []);

      await run("same", { mcp: CHAT, dirs: [added] });
      assert.equal(heard("thread/resume").length, 0, "the same list leaves the thread as it is");

      const fewer = await run("fewer", { mcp: [CHAT[0]], dirs: [added] });
      const [resumed] = heard("thread/resume");
      assert.ok(resumed, "opened again");
      assert.equal(resumed.params.config["mcp_servers.web"], undefined);
      assert.ok(resumed.params.config["mcp_servers.files"]);
      assert.ok(fewer.notes.some((/** @type {string} */ n) => /opened again: the chat's own MCP servers changed the tools it takes$/.test(n)), fewer.notes.join("\n"));
      const file = join(dir, "codex-sessions.json");
      const kept = await until(() => (existsSync(file) && readFileSync(file, "utf8").includes('"toolsMcp"') ? JSON.parse(readFileSync(file, "utf8")) : null), "the threads' record on disk");
      assert.deepEqual(secretsIn(kept), [], "the thread's record on disk holds the list's hash");
    } finally {
      bridge.shutdown();
    }
  });

  // (fails before: yes — Cursor's agent was given no MCP server, not even its upstream's, and no folder)
  test("Cursor's SDK: its mcpServers option holds its upstream's and the chat's, local.dirs the folders; a change loads the agent again", async () => {
    const bridge = new CursorSdkBridge(/** @type {any} */ ({ log: () => {}, loader: () => import(pathToFileURL(join(HERE, "fixtures", "fake-cursor-sdk.mjs")).href) }));
    const up = { id: "csdk", name: "csdk", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: dir, mcpServers: [{ name: "git", command: "git-mcp" }] } };
    const log = () => lines(join(dir, "sdk.jsonl")).filter((e) => e.event === "create" || e.event === "resume");
    /** @param {string} text @param {any} toolsAt */
    const run = (text, toolsAt) => bridge.run({ upstream: up, modelId: "grok-4.6", format: "anthropic", body: body(text), conversationId: "sdk-reach", onEvent: () => {}, toolsAt: { chain: "c1", turn: "t1", ...toolsAt } });
    try {
      const first = await run("hello", { mcp: CHAT, dirs: [added] });
      const made = log().at(-1);
      assert.equal(made?.event, "create");
      assert.deepEqual(made.mcpServers, ["git", "files", "web"]);
      assert.deepEqual(made.dirs, [added]);
      assert.ok(first.notes.includes("mcp: the chat's MCP servers given to Cursor: files (stdio), web (http)"), first.notes.join("\n"));
      assert.ok(first.notes.includes(`sdk: Cursor is given the chat's added folder to read: ${added}`), first.notes.join("\n"));
      const opened = log().length;
      await run("same", { mcp: CHAT, dirs: [added] });
      assert.equal(log().length, opened, "the same list, the same agent");
      const none = await run("no folders", { mcp: CHAT, dirs: [] });
      const again = log().at(-1);
      assert.equal(log().length, opened + 1);
      assert.equal(again.dirs, undefined);
      assert.deepEqual(again.mcpServers, ["git", "files", "web"]);
      assert.ok(none.notes.some((/** @type {string} */ n) => /what agent .* was opened with changed \(its tool ban, the chat's own MCP servers or added folders, or another machine's agents' fence\); loading it again/.test(n)), none.notes.join("\n"));
    } finally {
      bridge.shutdown?.();
    }
  });
});

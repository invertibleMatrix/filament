// @ts-check
// The owner's of 11-09: Filament's Reviewer only reads, and was refused plain reading commands on the repository's own
// worktrees — `git -C <worktree> status`, `du` — so it could not size or status them. A run that only reads for the
// whole of its turn (its request names read-only, as a Reviewer's does) reads the top folders `git worktree list` names
// for its repository, Filament's helper copies among them: its read, grep and glob, and its commands that only read.
// A run whose mode may let it write gets none. The reader's own rules are read-only-commands.test.js's; here, the list
// and how a turn hands it on — Filament's own agent's, and a coding agent's session's.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { worktreeReadsOf } from "../src/app/agent/turn.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, "fixtures", "fake-acp-agent.mjs");
/** A path as a bash command names it: forward slashes. */
const fw = (/** @type {string} */ p) => p.replaceAll("\\", "/");
/** The same folders, as Windows may write them in another case. @param {string[]} xs */
const folders = (xs) => xs.map((x) => (process.platform === "win32" ? x.toLowerCase() : x)).sort();
/** git as the test's own setup runs it, with the few settings a commit needs. @param {string} cwd @param {...string} a */
const gitIn = (cwd, ...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...a], { cwd, stdio: "pipe" });

/**
 * top/main, a repository with a commit; top/side, a worktree of it; main/.git/filament-worktrees/sa_h, a helper copy
 * where Filament makes them. Each by its real path.
 * @param {string} top
 */
function repository(top) {
  const main = join(top, "main");
  mkdirSync(join(main, "sub"), { recursive: true });
  gitIn(main, "init", "-q", "-b", "main");
  writeFileSync(join(main, "a.txt"), "the main note\n");
  writeFileSync(join(main, "sub", "b.txt"), "b\n");
  gitIn(main, "add", "-A");
  gitIn(main, "commit", "-q", "-m", "one");
  const side = join(top, "side");
  const helper = join(main, ".git", "filament-worktrees", "sa_h");
  gitIn(main, "worktree", "add", "-q", "-b", "side", side);
  gitIn(main, "worktree", "add", "-q", "--detach", helper);
  writeFileSync(join(side, "a.txt"), "the side note\n");
  return { main: realpathSync(main), side: realpathSync(side), helper: realpathSync(helper) };
}

describe("worktreeReadsOf: the repository's other worktrees, as git lists them (the owner's of 11-09)", () => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "filament-wtreads-")));
  const far = realpathSync(mkdtempSync(join(tmpdir(), "filament-wtreads-far-")));
  /** @type {ReturnType<typeof repository>} */
  let r;
  before(() => {
    r = repository(top);
  });
  after(() => removeDirs(top, far));
  const cfg = { agentLoop: { roots: [top] }, server: { host: "127.0.0.1" } };

  // (fails before: yes — worktreeReadsOf did not exist)
  test("from any of them, the others' top folders, the helper copy among them, the working folder itself left out", async () => {
    assert.deepEqual(folders(await worktreeReadsOf(cfg, r.main)), folders([r.side, r.helper]));
    assert.deepEqual(folders(await worktreeReadsOf(cfg, r.helper)), folders([r.main, r.side]));
    assert.deepEqual(folders(await worktreeReadsOf(cfg, r.side)), folders([r.main, r.helper]));
  });

  test("one outside agentLoop.roots is left out, as an added folder is; a folder in no repository has none", async () => {
    const away = join(far, "away");
    gitIn(r.main, "worktree", "add", "-q", "--detach", away);
    assert.deepEqual(folders(await worktreeReadsOf(cfg, r.main)), folders([r.side, r.helper]), "away is under no listed root");
    assert.deepEqual(folders(await worktreeReadsOf({ agentLoop: { roots: [top, far] }, server: { host: "127.0.0.1" } }, r.main)), folders([r.side, r.helper, realpathSync(away)]));
    const plain = join(far, "plain");
    mkdirSync(plain);
    assert.deepEqual(await worktreeReadsOf({ agentLoop: { roots: [far] }, server: { host: "127.0.0.1" } }, plain), []);
  });
});

describe("end to end: a run that only reads, and one that may write (the owner's of 11-09)", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  const top = realpathSync(mkdtempSync(join(tmpdir(), "filament-wtreads-e2e-")));
  /** @type {ReturnType<typeof repository>} */
  let r;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    r = repository(top);
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
          { id: "claudeish", name: "claudeish", type: "acp", acp: { command: process.execPath, args: [FAKE], env: {}, cwdDefault: r.main, permissions: "allow-all", hints: false } },
        ];
        cfg.routes = [
          { match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "claudeish/*", upstream: "claudeish", upstreamModel: "{1}", enabled: true },
        ];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [top], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(top, shim.dataDir);
  });

  /** A harness session in the main folder. @param {string} model @param {any} settings */
  const session = async (model, settings) => {
    const res = await shim.api("/api/sessions", { method: "POST", body: { cwd: r.main, model, preset: "plain", settings } });
    assert.equal(res.status, 200, await res.clone().text());
    return String((await res.json()).id);
  };
  /**
   * A harness turn, ended, and its record once written. `permissions`: the mode the turn names, as a Reviewer's request
   * does (none: the session's, which may switch). `page`: sent as the page sends one — the session's switch answers a
   * coding agent's requests only then.
   * @param {string} id @param {string} content @param {{ permissions?: string, page?: boolean }} [o]
   */
  const turn = async (id, content, { permissions = "", page = false } = {}) => {
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, ...(page ? { stream: true, runEvents: true } : { stream: false }), ...(permissions ? { permissions } : {}) } });
    assert.equal(res.status, 200, await res.clone().text());
    const runId = String(res.headers.get("x-filament-request-id"));
    page ? await res.text() : await res.json();
    const rec = await until(async () => {
      const x = await shim.record(runId);
      return Array.isArray(x?.changes) ? x : null;
    }, "the record");
    return /** @type {string[]} */ (rec.changes);
  };
  const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
  /** @param {any} c */
  const resultText = (c) => (typeof c.content === "string" ? c.content : (c.content || []).map((/** @type {any} */ b) => b.text || "").join(""));
  /**
   * One round of calls, then the results it got, by id. @param {any[]} calls
   * @returns {() => Record<string, any>}
   */
  const scripted = (calls) => {
    /** @type {Record<string, any>} */
    let byId = {};
    let round = 0;
    brain = (call) => {
      if (++round === 1) return reply(calls, "tool_use");
      const m = call.body.messages.at(-1);
      byId = Object.fromEntries((Array.isArray(m?.content) ? m.content : []).filter((/** @type {any} */ c) => c?.type === "tool_result").map((/** @type {any} */ c) => [c.tool_use_id, c]));
      return reply([{ type: "text", text: "Looked." }]);
    };
    return () => byId;
  };
  const S = () => fw(r.side);
  const H = () => fw(r.helper);
  const calls = () => [
    toolUse("st", "bash", { command: `git -C ${S()} status --short` }),
    toolUse("du", "bash", { command: `du -s ${S()} ${H()}` }),
    toolUse("rd", "read", { path: join(r.side, "a.txt") }),
    toolUse("gp", "grep", { pattern: "b", path: H(), output: "files" }),
    toolUse("nt", "bash", { command: "node --test" }),
  ];

  // (fails before: yes — its commands and its file tools reached the working folder and the chat's added folders alone)
  test("Filament's agent on a turn that names read-only: git's reading forms and du on a worktree, read and grep there and in a helper copy, run; node --test does not", async () => {
    const id = await session("agent/brain-model", {});
    const got = scripted(calls());
    const changes = await turn(id, "status and size the worktrees", { permissions: "read-only" });
    const byId = got();
    for (const k of ["st", "du", "rd", "gp"]) {
      assert.notEqual(byId[k]?.is_error, true, `${k}: ${resultText(byId[k] || {})}`);
      assert.doesNotMatch(resultText(byId[k]), /Not run|outside the allowed task folder/, k);
    }
    assert.match(resultText(byId.du), /side/);
    assert.match(resultText(byId.rd), /the side note/);
    assert.ok(resultText(byId.gp).includes("b.txt"), resultText(byId.gp));
    assert.match(resultText(byId.nt), /Not run: this session is read-only, and Filament cannot tell that this command only reads inside the working folder: of node, only `node -v` and `node --version` are known to only read/);
    assert.ok(changes.includes("agent: bash ran without asking — it only reads"), changes.join("\n"));
  });

  // (fails before: no — pinned: a session in Read-only may be switched while its turn works, so its run is handed none)
  test("Filament's agent on a turn under the session's Read-only, which may switch: none of them, as before", async () => {
    const id = await session("agent/brain-model", { loop: { permissions: "read-only" } });
    const got = scripted(calls());
    await turn(id, "status and size the worktrees");
    const byId = got();
    assert.match(resultText(byId.st), /Not run: this session is read-only, and Filament cannot tell that this command only reads inside the working folder: git -C before its form: .+ is outside the working folder\./);
    assert.match(resultText(byId.du), /Not run: this session is read-only, .+ is outside the working folder\./);
    assert.match(resultText(byId.rd), /resolves outside the allowed task folder/);
    // The helper copy lies inside the main folder: read there as it was.
    assert.ok(resultText(byId.gp).includes("b.txt"), resultText(byId.gp));
  });

  // (fails before: yes — the session's switch judged a coding agent's command by the working folder and the chat's
  // added folders alone)
  test("a coding agent on a turn that names read-only: git -C on a worktree passes as reading; under the session's Read-only it does not", async () => {
    const command = `git -C ${S()} status`;
    const reads = await turn(await session("claudeish/fake-a", {}), `~permbash ${command}`, { permissions: "read-only", page: true });
    assert.ok(reads.includes(`permission: claudeish asked to run \`${command}\` — ran without asking: it only reads`), reads.join("\n"));
    const writes = await turn(await session("claudeish/fake-a", { loop: { permissions: "read-only" } }), `~permbash ${command}`, { page: true });
    const judged = writes.filter((c) => c.startsWith("permission: "));
    assert.equal(judged.length, 1, writes.join("\n"));
    assert.doesNotMatch(judged[0], /ran without asking/);
  });
});

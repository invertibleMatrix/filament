// @ts-check
// A builder's patch workspace moves to a git worktree at the same folder (the owner's plan of 11-09 for big repos,
// Phase 1) once it needs a checkout: its work captured first, its files where they were — what git ignores too —, its
// record gone. A move that cannot be made puts the overlay back as it was; a capture that fails moves nothing. Through
// the app: a command the session's rules refuse never moves it; one that runs moves it first, and its result says so.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskRefs } from "../src/adapters/git/worktree.js";
import { openPatch, patchRecordOf, promotePatch } from "../src/adapters/git/patch.js";
import { patchHand } from "../src/adapters/tools/patch-hands.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";
import { fakeLfs, useFakeLfs } from "./helpers/fake-lfs.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
/** @type {string[]} */
const made = [];
after(async () => {
  for (const d of made.reverse()) await rm(d, { recursive: true, force: true }).catch(() => {});
});
/** A project under `top` (else a folder of its own): a.txt, an ignored build folder. @param {string} [top] */
const repo = (top) => {
  const dir = join(top || realpathSync.native(mkdtempSync(join(tmpdir(), "filament-patch-move-"))), "proj");
  if (!top) made.push(dir);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, ".gitignore"), "build/\n");
  writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** @param {string} p */
const read = (p) => readFileSync(p, "utf8");
/** A hold over a workspace that never moves. @param {any} ws */
const holdOf = (ws) => ({ now: () => ws, settled: async () => {}, move: async () => ({ ok: /** @type {const} */ (false), error: "not in this test" }) });
/** A patch with an edit, a new file and what git ignores. @param {string} dir @param {string} id */
const worked = async (dir, id) => {
  const o = await openPatch(dir, { id });
  assert.ok(o.ok, o.ok ? "" : o.error);
  const hands = (/** @type {string} */ name, /** @type {any} */ input) => patchHand(name, input, holdOf(o.wt), { root: o.wt.workdir, fenced: true });
  await hands("edit", { path: "a.txt", edits: [{ oldText: "two", newText: "TWO" }] });
  await hands("write", { path: "src/new.js", content: "export const n = 1;\n" });
  await hands("write", { path: "build/out.log", content: "built\n" });
  return o.wt;
};

// (fails before: yes — there was no patch workspace, nor a move of one)
test("a move keeps its files at the same paths in a worktree checked out at its capture — what git ignores copied in —, its record and its set-aside folder gone", async () => {
  const dir = repo();
  const ws = await worked(dir, "sa_0000a001");
  const r = await promotePatch(ws, dir, { id: "sa_0000a001" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(r.wt.dest, ws.dest, "at the same folder");
  assert.equal(existsSync(join(ws.dest, ".git")), true, "a checkout now");
  assert.deepEqual([read(join(ws.dest, "a.txt")), read(join(ws.dest, "src", "new.js")), read(join(ws.dest, "build", "out.log"))], ["one\nTWO\n", "export const n = 1;\n", "built\n"]);
  assert.equal(git(ws.dest, "status", "--porcelain"), "", "nothing beyond its capture: the checkout is its work");
  assert.equal(git(ws.dest, "rev-parse", "HEAD"), r.head);
  assert.deepEqual(r.files.map((f) => f.path), ["a.txt", "src/new.js"]);
  assert.equal((await taskRefs(dir, "sa_0000a001"))?.head, r.head, "its work on its refs");
  assert.equal(patchRecordOf(join(dir, ".git", "filament-worktrees"), "sa_0000a001"), null, "no patch record");
  assert.deepEqual(readdirSync(join(dir, ".git", "filament-worktrees")).filter((n) => n.includes(".moving")), [], "nothing set aside left");
});

// (fails before: yes — the same)
test("a move whose copy cannot be taken puts the overlay back as it was, its record with it", async () => {
  const dir = repo();
  const ws = await worked(dir, "sa_0000a002");
  const r = await promotePatch(ws, dir, { id: "sa_0000a002", allowed: () => false });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /outside/);
  assert.deepEqual([existsSync(join(ws.dest, ".git")), read(join(ws.dest, "a.txt")), read(join(ws.dest, "build", "out.log"))], [false, "one\nTWO\n", "built\n"], "its overlay where it was");
  assert.equal(patchRecordOf(join(dir, ".git", "filament-worktrees"), "sa_0000a002")?.state, "busy", "still its patch");
  assert.deepEqual(readdirSync(join(dir, ".git", "filament-worktrees")).filter((n) => n.includes(".moving")), []);
});

// (fails before: yes — the same)
test("a move whose capture fails moves nothing: the overlay stays, marked unsaved", async () => {
  const dir = repo();
  const ws = await worked(dir, "sa_0000a003");
  // Its work's ref held by another git.
  const refs = join(dir, ".git", "refs", "filament", "subagents", "sa_0000a003");
  mkdirSync(refs, { recursive: true });
  writeFileSync(join(refs, "work.lock"), "");
  const r = await promotePatch(ws, dir, { id: "sa_0000a003" });
  assert.deepEqual([r.ok, !r.ok && r.unsaved], [false, true]);
  assert.equal(existsSync(join(ws.dest, ".git")), false);
  assert.equal(read(join(ws.dest, "a.txt")), "one\nTWO\n");
  assert.match(String(patchRecordOf(join(dir, ".git", "filament-worktrees"), "sa_0000a003")?.unsaved?.error), /update-ref/);
});

describe("through the app: a sub-agent's commands in its patch", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  const top = realpathSync.native(mkdtempSync(join(tmpdir(), "filament-patch-move-e2e-")));
  /** @type {string} */
  let dir;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    dir = repo(top);
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [top], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(top, shim.dataDir);
  });
  const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
  const systemOf = (/** @type {any} */ body) => JSON.stringify(body?.system ?? "");
  /** The tool results in the request's newest message, by tool_use id, as text. @param {any} body */
  const resultsOf = (body) => {
    const last = (body?.messages || []).at(-1);
    /** @type {Map<string, string>} */
    const out = new Map();
    for (const b of Array.isArray(last?.content) ? last.content : []) if (b?.type === "tool_result") out.set(String(b.tool_use_id), typeof b.content === "string" ? b.content : (b.content || []).map((/** @type {any} */ c) => c.text || "").join(""));
    return out;
  };

  // (fails before: yes — every builder worked in a full checkout: there was nothing to move)
  test("a command the session's rules refuse leaves the patch as it is; the next, which runs, moves it to a worktree at the same folder first, and its result says so", async () => {
    const home = join(dir, ".git", "filament-worktrees");
    const own = () => readdirSync(home).filter((n) => /^sa_[0-9a-f]{8}$/.test(n));
    /** @type {Record<string, string>} */
    const got = {};
    /** @type {Record<string, boolean>} */
    const checkout = {};
    brain = (call) => {
      if (call.kind !== "anthropic") return undefined;
      const r = resultsOf(call.body);
      if (systemOf(call.body).includes("You are a sub-agent")) {
        for (const [k, v] of r) got[k] = v;
        if (r.has("b2")) return reply([{ type: "text", text: "Wrote c.txt." }]);
        if (r.has("b1")) {
          checkout.afterRefused = own().some((n) => existsSync(join(home, n, ".git")));
          return reply([toolUse("b2", "bash", { command: "git rev-parse --show-toplevel" })], "tool_use");
        }
        if (r.has("w1")) {
          checkout.afterWrite = own().some((n) => existsSync(join(home, n, ".git")));
          return reply([toolUse("b1", "bash", { command: "echo denied here" })], "tool_use");
        }
        return reply([toolUse("w1", "write", { path: "c.txt", content: "sea\n" })], "tool_use");
      }
      if (r.has("a1")) return reply([{ type: "text", text: "Done." }]);
      return reply([toolUse("a1", "agent", { description: "add c", prompt: "Write c.txt holding sea.", run_in_background: false })], "tool_use");
    };
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: dir, model: "agent/brain-model", preset: "plain", settings: { loop: { rules: [{ tool: "bash", pattern: "echo denied*", verdict: "deny" }] } } } });
    assert.equal(created.status, 200, await created.clone().text());
    const id = String((await created.json()).id);
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "have a sub-agent add c.txt", stream: false } });
    assert.equal(res.status, 200, await res.clone().text());
    await res.json();
    assert.ok(got.w1 != null && got.b1 != null && got.b2 != null, `its calls all came back: ${JSON.stringify(got)}`);
    assert.deepEqual([checkout.afterWrite, checkout.afterRefused], [false, false], "a patch through its write and the refused command");
    assert.match(got.b1, /^Not run/);
    assert.doesNotMatch(got.b1, /became a git worktree/);
    const [sa] = own();
    assert.ok(sa, "its folder");
    assert.equal(existsSync(join(home, sa, ".git")), true, "a worktree now");
    assert.equal(got.b2.split("\n")[0].replaceAll("\\", "/").toLowerCase(), join(home, sa).replaceAll("\\", "/").toLowerCase(), "the command ran in it");
    assert.ok(got.b2.includes("[Filament: your workspace became a git worktree at the same folder, with your 1 changed file; the command ran there.]"), got.b2);
    assert.equal(read(join(home, sa, "c.txt")), "sea\n", "its write where it was");
    assert.equal(patchRecordOf(home, sa), null, "no patch record");
  });

  // (fails before: yes — the Changes tab asked git's status of a patch's folder, which is no work tree: its place said
  // "not in a git repository", and none of its files)
  test("the Changes tab reads a patch's folder as a place: the files its overlay changes, its sub-agent's", async () => {
    const pDir = join(top, "changes-proj");
    mkdirSync(pDir, { recursive: true });
    git(pDir, "init", "-q", "-b", "main");
    git(pDir, "config", "core.autocrlf", "false");
    writeFileSync(join(pDir, "a.txt"), "one\ntwo\n");
    git(pDir, "add", "-A");
    git(pDir, "commit", "-qm", "init");
    brain = (call) => {
      if (call.kind !== "anthropic") return undefined;
      const r = resultsOf(call.body);
      if (systemOf(call.body).includes("You are a sub-agent")) {
        if (r.has("e1")) return reply([{ type: "text", text: "Edited." }]);
        if (r.has("w1")) return reply([toolUse("e1", "edit", { path: "a.txt", edits: [{ oldText: "two", newText: "TWO" }] })], "tool_use");
        return reply([toolUse("w1", "write", { path: "c.txt", content: "sea\n" })], "tool_use");
      }
      if (r.has("a1")) return reply([{ type: "text", text: "Done." }]);
      return reply([toolUse("a1", "agent", { description: "edit", prompt: "Write c.txt and shout two in a.txt.", run_in_background: false })], "tool_use");
    };
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: pDir, model: "agent/brain-model", preset: "plain" } });
    assert.equal(created.status, 200, await created.clone().text());
    const id = String((await created.json()).id);
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "have a sub-agent edit", stream: false } });
    assert.equal(res.status, 200, await res.clone().text());
    await res.json();
    const home = join(pDir, ".git", "filament-worktrees");
    const sa = readdirSync(home).find((n) => /^sa_[0-9a-f]{8}$/.test(n));
    assert.ok(sa && patchRecordOf(home, sa), "it worked in a patch");
    const a = await (await shim.api(`/api/git/changes?cwd=${encodeURIComponent(pDir)}&chain=${encodeURIComponent(id)}&fresh=1`)).json();
    const place = (a.places || []).find((/** @type {any} */ p) => p.kind === "copy");
    assert.ok(place, JSON.stringify(a.places));
    assert.deepEqual([place.ok, place.error ?? null, place.sub], [true, null, sa], JSON.stringify(place));
    assert.deepEqual(place.files.map((/** @type {any} */ f) => [f.path, f.status, f.added, f.removed]), [["a.txt", "M", 1, 1], ["c.txt", "A", 1, 0]]);
    assert.deepEqual([...new Set(place.files.flatMap((/** @type {any} */ f) => f.by.map((/** @type {any} */ w) => w.agent)))], [sa], "its sub-agent's");
  });

  // (fails before: yes — once a move checks LFS files out as their pointers (the review of d65a984a9): the turn handed its
  // patch's reads no fetch, so a read after a move in the same turn showed the pointer's three lines)
  test("a read after its patch moved, in the same turn, fetches an LFS file as a worktree's read does", async () => {
    const lfsDir = join(top, "lfs-proj");
    mkdirSync(lfsDir, { recursive: true });
    git(lfsDir, "init", "-q", "-b", "main");
    git(lfsDir, "config", "core.autocrlf", "false");
    useFakeLfs(lfsDir, fakeLfs(made));
    writeFileSync(join(lfsDir, ".gitattributes"), "*.bin filter=lfs -text\n");
    writeFileSync(join(lfsDir, "asset.bin"), "the real asset\n");
    git(lfsDir, "add", "-A");
    git(lfsDir, "commit", "-qm", "init");
    /** @type {Record<string, string>} */
    const got = {};
    brain = (call) => {
      if (call.kind !== "anthropic") return undefined;
      const r = resultsOf(call.body);
      if (systemOf(call.body).includes("You are a sub-agent")) {
        for (const [k, v] of r) got[k] = v;
        if (r.has("r1")) return reply([{ type: "text", text: "Read it." }]);
        if (r.has("b1")) return reply([toolUse("r1", "read", { path: "asset.bin" })], "tool_use");
        return reply([toolUse("b1", "bash", { command: "git rev-parse --show-toplevel" })], "tool_use");
      }
      if (r.has("a1")) return reply([{ type: "text", text: "Done." }]);
      return reply([toolUse("a1", "agent", { description: "read the asset", prompt: "Read asset.bin.", run_in_background: false })], "tool_use");
    };
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: lfsDir, model: "agent/brain-model", preset: "plain" } });
    assert.equal(created.status, 200, await created.clone().text());
    const id = String((await created.json()).id);
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "have a sub-agent read asset.bin", stream: false } });
    assert.equal(res.status, 200, await res.clone().text());
    await res.json();
    assert.ok(got.b1 != null && got.r1 != null, `its calls all came back: ${JSON.stringify(got)}`);
    assert.ok(got.b1.includes("[Filament: your workspace became a git worktree at the same folder"), got.b1);
    assert.match(got.r1, /^\s+1\tthe real asset$/m, "fetched in the worktree it moved to");
  });
});

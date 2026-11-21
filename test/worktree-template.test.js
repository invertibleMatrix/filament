// @ts-check
// A worktree template per project (HarnessV4_Four_Plan E19). The list's paths judged (FOC-68) and held by the project's
// setting; what a list can hold, measured (FO-D32); the copy (FO-D33): a link copied as a link and pointed into the
// worktree, a file git put there left, a path not here skipped, the disk full or Filament stopping cutting it. Against a
// real app: the template's read and save, the project made where it is new; a chat made in a new worktree gets the
// list, or the paths its line left on, and its row (FO-D37); a move to a new worktree too (FOC-67); the first turn
// waits for the copy, Send without it goes on, Stop ends the wait and never the copy (FO-D36, FOC-63, FOC-73).
// (fails before: yes — nothing was ever copied into a new worktree, and no list existed)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { copyPath, copyPathProblem, COPY_MAX } from "../src/core/worktree-copy.js";
import { copyCandidates, copyInto, measure } from "../src/adapters/git/template.js";
import { copiedBoundary, createWorktreeCopies, COPY_CUT } from "../src/app/sessions/copies.js";
import { settingsHash, valueProblems } from "../src/services/session-settings.js";
import { moveNote } from "../src/core/move-note.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { gate, removeDirs, until } from "./helpers/wait.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();
/** @type {string[]} */
const made = [];
// A git or agent process just stopped may still hold a folder a moment (EPERM, seen at the full suite's concurrency).
after(() => removeDirs(...made.reverse()));
/** A fresh folder under the system's temp, as the filesystem spells it. @param {string} prefix */
const fresh = (prefix) => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
};
/**
 * A folder's link: a junction on Windows, which needs no right of its own.
 * @param {string} target @param {string} at
 */
const linkDir = (target, at) => symlinkSync(target, at, process.platform === "win32" ? "junction" : "dir");
/**
 * A Unity-like repository on `main`: `Assets/a.cs` and `Library/keep.txt` committed, `Library/` and `.env` ignored,
 * an ignored Library of three files, `.env`, and `notes.txt` git does not have yet.
 * @param {string} dir
 */
const unityIn = (dir) => {
  mkdirSync(join(dir, "Assets"), { recursive: true });
  mkdirSync(join(dir, "Library", "cache"), { recursive: true });
  run(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "Assets", "a.cs"), "class A {}\n");
  writeFileSync(join(dir, "Library", "keep.txt"), "git's\n");
  run(dir, ["add", "."]);
  run(dir, ["commit", "-q", "-m", "init"]);
  writeFileSync(join(dir, ".gitignore"), "Library/*\n!Library/keep.txt\n.env\n");
  run(dir, ["add", ".gitignore"]);
  run(dir, ["commit", "-q", "-m", "ignore"]);
  writeFileSync(join(dir, "Library", "big.bin"), Buffer.alloc(3000, 1));
  writeFileSync(join(dir, "Library", "cache", "c.bin"), Buffer.alloc(500, 2));
  writeFileSync(join(dir, ".env"), "KEY=1\n");
  writeFileSync(join(dir, "notes.txt"), "draft notes\n");
  return dir;
};

describe("a list's paths", () => {
  // (fails before: yes — no rule existed)
  test("kept with / between parts; inside the repository only, never git's own folder (FOC-68)", () => {
    assert.equal(copyPath(" .\\Library\\cache\\ "), "Library/cache");
    assert.equal(copyPath("./.env"), ".env");
    assert.equal(copyPathProblem("Library"), null);
    assert.equal(copyPathProblem("Assets/Plugins/x.dll"), null);
    assert.equal(copyPathProblem(""), "a path is needed");
    assert.match(String(copyPathProblem("../x")), /inside the repository only/);
    assert.match(String(copyPathProblem("a/../../x")), /inside the repository only/);
    assert.match(String(copyPathProblem("C:\\x")), /not a whole one/);
    assert.match(String(copyPathProblem("/etc/x")), /not a whole one/);
    assert.match(String(copyPathProblem(".git/config")), /git's own folder/);
    assert.match(String(copyPathProblem("a//b")), /not a path/);
  });

  // (fails before: yes — no such setting)
  test("the project's setting takes such paths and refuses the rest in words", () => {
    assert.deepEqual(valueProblems("worktree.copy", ["Library", ".env"]), []);
    assert.deepEqual(valueProblems("worktree.copy", ["../x", 3]), [`"worktree.copy[0]" ../x: inside the repository only`, `"worktree.copy[1]" a path is needed`]);
    assert.deepEqual(valueProblems("worktree.copy", Array.from({ length: COPY_MAX + 1 }, (_, i) => `p${i}`)), [`"worktree.copy" holds at most ${COPY_MAX} paths`]);
  });

  // (fails before: yes — the golden's hash moved with the new knob, and a list edited marked every chat of the project)
  test("a list shapes nothing a turn sends: no chat's settings hash moves with it (turns: false)", () => {
    assert.equal(settingsHash({ "worktree.copy": ["Library", ".env"] }), settingsHash({}));
  });
});

describe("the copy", () => {
  // (fails before: yes — nothing copied a worktree's ignored files)
  test("files and folders copied, a link as a link pointed into the worktree, git's file left, a path not here said (FO-D33, FOC-62, FOC-65, FOC-66)", async () => {
    const root = fresh("filament-wtcopy-");
    const from = join(root, "from");
    const to = join(root, "to");
    mkdirSync(join(from, "Library", "deep"), { recursive: true });
    mkdirSync(join(from, "store", "pkg"), { recursive: true });
    mkdirSync(join(to, "Library"), { recursive: true });
    writeFileSync(join(from, "store", "pkg", "index.js"), "x");
    writeFileSync(join(from, "Library", "a.bin"), Buffer.alloc(1000));
    writeFileSync(join(from, "Library", "deep", "b.bin"), Buffer.alloc(500));
    linkDir(join(from, "store", "pkg"), join(from, "Library", "pkg"));
    writeFileSync(join(from, ".env"), "K=1");
    writeFileSync(join(to, "Library", "a.bin"), "git's");
    assert.deepEqual(await measure(from, "Library"), { path: "Library", dir: true, link: false, bytes: 1500, files: 3, missing: false });
    /** @type {any[]} */
    const progress = [];
    const r = await copyInto({ from, to, paths: ["Library", ".env", "gone", "../x", "Library/deep"], onProgress: (p) => progress.push(p) });
    assert.deepEqual(r.copied, ["Library", ".env"], "a path inside another on the list goes with it");
    assert.deepEqual(r.skipped, [{ path: "gone", why: "not here" }, { path: "../x", why: "../x: inside the repository only" }]);
    assert.deepEqual([r.files, r.bytes, r.kept, r.total, r.totalFiles, r.cut, r.failed.length], [3, 503, 1, 1503, 4, null, 0]);
    assert.equal(readFileSync(join(to, "Library", "a.bin"), "utf8"), "git's", "the checkout's file stays as git put it");
    assert.equal(readFileSync(join(to, "Library", "deep", "b.bin")).length, 500);
    assert.equal(readFileSync(join(to, ".env"), "utf8"), "K=1");
    assert.ok(lstatSync(join(to, "Library", "pkg")).isSymbolicLink(), "the link is copied as a link");
    assert.equal(readlinkSync(join(to, "Library", "pkg")).replace(/[\\/]+$/, ""), join(to, "store", "pkg"), "pointed at the same path in the worktree");
    const { entry, ...last } = progress.at(-1);
    assert.deepEqual(last, { done: 1503, total: 1503, files: 4, totalFiles: 4 });
    assert.ok(["Library", ".env"].includes(entry), "the entry being copied, whichever of the pool ends last");
    assert.ok(progress.every((p, i) => i === 0 || p.done >= progress[i - 1].done), "the progress only goes up");
  });

  // (fails before: yes)
  test("a stop cuts it with its reason, and what was copied stays (FOC-70)", async () => {
    const root = fresh("filament-wtcut-");
    mkdirSync(join(root, "from", "Library"), { recursive: true });
    mkdirSync(join(root, "to"));
    for (let i = 0; i < 30; i++) writeFileSync(join(root, "from", "Library", `f${i}.bin`), Buffer.alloc(100));
    const stop = new AbortController();
    const r = await copyInto({ from: join(root, "from"), to: join(root, "to"), paths: ["Library"], signal: stop.signal, onProgress: (p) => p.files === 3 && stop.abort(new Error(COPY_CUT)) });
    assert.equal(r.cut, COPY_CUT);
    assert.ok(r.files >= 3 && r.files < 30, `${r.files} copied before the stop`);
  });

  // (fails before: yes)
  test("the copies service keeps a record on the chat, said on the feed, and a record with no job reads as cut (FO-D37)", async () => {
    /** @type {Map<string, any>} */
    const metas = new Map([["c1", {}]]);
    const archive = {
      getChain: (/** @type {string} */ id) => (metas.has(id) ? { id, meta: metas.get(id) } : null),
      mergeMeta: (/** @type {string} */ id, /** @type {any} */ patch) => metas.set(id, { ...metas.get(id), ...patch }),
      newestTurnN: () => 2,
    };
    const open = gate();
    /** @type {any[]} */
    const said = [];
    const copies = createWorktreeCopies({
      memory: { archive },
      publish: (id, e) => said.push({ id, ...e }),
      now: () => 1000,
      copy: async ({ onProgress = () => {} }) => {
        onProgress({ done: 5, total: 10, files: 1, totalFiles: 2, entry: "Library" });
        await open.promise;
        return { copied: ["Library"], skipped: [], failed: [], failedMore: 0, bytes: 10, files: 2, kept: 0, total: 10, totalFiles: 2, cut: null };
      },
    });
    assert.equal(copies.start("c1", { from: "/a", to: "/b-x", paths: [] }), null, "an empty list copies nothing (FOC-71)");
    const job = /** @type {any} */ (copies.start("c1", { from: "/a", to: "/b-x", paths: ["Library"] }));
    assert.equal(copies.running("c1"), job);
    assert.deepEqual(job.progress, { done: 5, total: 10, files: 1, totalFiles: 2, entry: "Library" });
    assert.equal(metas.get("c1").copies[0].state, "running");
    assert.deepEqual(said[0].boundary, { type: "copied", id: job.id, at: 1000, afterTurn: 2, into: "b-x", paths: ["Library"], state: "running", result: null, ms: null });
    open.open();
    await job.done;
    assert.equal(copies.running("c1"), null);
    assert.equal(metas.get("c1").copies.length, 1, "one record per copy");
    assert.equal(said.at(-1).boundary.state, "done");
    assert.equal(said.at(-1).boundary.result.files, 2);
    const left = { ...metas.get("c1").copies[0], state: "running", result: null };
    assert.deepEqual([copiedBoundary(left, false).state, copiedBoundary(left, false).why], ["cut", COPY_CUT]);
  });

  // (fails before: yes — a copy ended only with Filament)
  test("one chat's copy stopped with its reason, the others' left running", async () => {
    const archive = { getChain: (/** @type {string} */ id) => ({ id, meta: {} }), mergeMeta: () => {}, newestTurnN: () => 0 };
    const copies = createWorktreeCopies({
      memory: { archive },
      copy: ({ signal }) =>
        new Promise((done) => {
          const end = () => done({ copied: [], skipped: [], failed: [], failedMore: 0, bytes: 0, files: 0, kept: 0, total: 1, totalFiles: 1, cut: signal?.reason?.message || "?" });
          if (signal?.aborted) end();
          else signal?.addEventListener("abort", end);
        }),
    });
    await copies.stop("none", "nothing runs");
    const a = /** @type {any} */ (copies.start("a", { from: "/r", to: "/r-a", paths: ["Library"] }));
    const b = /** @type {any} */ (copies.start("b", { from: "/r", to: "/r-b", paths: ["Library"] }));
    await copies.stop("a", "the chat moved back");
    assert.equal((await a.done).cut, "the chat moved back");
    assert.deepEqual([copies.running("a"), copies.running("b")], [null, b]);
    await copies.stopAll();
    assert.equal((await b.done).cut, COPY_CUT);
  });
});

describe("what a list can hold, and the app", { skip: !hasGit && "git is not on PATH" }, () => {
  /** @type {string} */
  let base;
  /** @type {string} */
  let repo;
  /** @type {any} */
  let up;
  /** @type {any} */
  let shim;
  before(async () => {
    base = fresh("filament-wttpl-");
    repo = unityIn(join(base, "game"));
    up = await fakeUpstream(() => anthropicReply("Done.", { model: "brain-model" }));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [base], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });
  const enc = encodeURIComponent;
  /** @param {string} q */
  const read = async (q) => (await shim.api(`/api/git/places/template?${q}`)).json();
  /** @param {any} body */
  const save = (body) => shim.api("/api/git/places/template", { method: "POST", body });

  // (fails before: yes — nothing listed what git leaves out)
  test("what git leaves out of a worktree, measured, biggest first; git's own files not offered (FO-D32)", async () => {
    const c = await copyCandidates(repo);
    assert.ok(c.ok);
    if (!c.ok) return;
    assert.deepEqual(c.items.map((i) => [i.path, i.ignored, i.files]), [
      ["Library/big.bin", true, 1],
      ["Library/cache", true, 1],
      ["notes.txt", false, 1],
      [".env", true, 1],
    ]);
    assert.equal(c.items[0].bytes, 3000);
  });

  // (fails before: yes — no such address)
  test("the template read and saved: none at first, the project made, each entry measured or said not here (FO-D40, FOC-54, FOC-56, FOC-61, FOC-68)", async () => {
    const first = await read(`cwd=${enc(repo)}&all=1`);
    assert.deepEqual([first.ok, first.copy, first.from, first.entries], [true, [], "default", []]);
    assert.equal(first.candidates.items.length, 4);
    const bad = await save({ cwd: repo, copy: ["../x"] });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /inside the repository only/);
    const ok = await (await save({ cwd: repo, copy: ["Library\\", ".env", "gone.txt"] })).json();
    assert.deepEqual([ok.ok, ok.copy, ok.from], [true, ["Library", ".env", "gone.txt"], "project"]);
    const again = await read(`cwd=${enc(join(repo, "Assets"))}`);
    assert.deepEqual(again.entries.map((/** @type {any} */ e) => [e.path, e.files, e.missing]), [["Library", 3, false], [".env", 1, false], ["gone.txt", 0, true]]);
    assert.equal(again.candidates, null, "the picker's list only when asked");
    await save({ cwd: repo, copy: ["Library", ".env"] });
  });

  // (fails before: yes — a new worktree held only what git checks out)
  test("a chat made in a new worktree gets the project's list copied, and its row says so (FOC-57, FOC-58, FOC-59)", async () => {
    const r = await shim.post("/api/sessions", { model: "agent/brain-model", cwd: repo, worktree: { name: "jump" } });
    assert.equal(r.status, 200);
    const s = await r.json();
    const job = shim.app.copies.running(s.id);
    assert.ok(job, "the copy runs beside the new chat");
    const result = await job.done;
    const wt = s.worktree.folder;
    assert.equal(readFileSync(join(wt, ".env"), "utf8"), "KEY=1\n");
    assert.equal(readFileSync(join(wt, "Library", "big.bin")).length, 3000);
    assert.equal(readFileSync(join(wt, "Library", "keep.txt"), "utf8").replace(/\r\n/g, "\n"), "git's\n", "git's own file stays");
    assert.deepEqual([result.copied, result.kept, result.cut], [["Library", ".env"], 1, null]);
    const tr = await (await shim.api(`/api/sessions/${s.id}/transcript`)).json();
    const row = (tr.boundaries || []).find((/** @type {any} */ b) => b.type === "copied");
    assert.deepEqual([row.state, row.into, row.afterTurn, row.paths], ["done", "game-jump", 0, ["Library", ".env"]]);
    const fromWt = await read(`cwd=${enc(wt)}`);
    assert.deepEqual([fromWt.copy, fromWt.from], [["Library", ".env"], "project"], "a worktree reads its repository's list");
  });

  // (fails before: yes)
  test("the paths the line left on, for this worktree alone; the list stays (FOC-59)", async () => {
    const s = await (await shim.post("/api/sessions", { model: "agent/brain-model", cwd: repo, worktree: { name: "only-env", copy: [".env"] } })).json();
    await shim.app.copies.running(s.id)?.done;
    assert.ok(existsSync(join(s.worktree.folder, ".env")));
    assert.ok(!existsSync(join(s.worktree.folder, "Library", "big.bin")), "Library left off for this one");
    assert.deepEqual((await read(`cwd=${enc(repo)}`)).copy, ["Library", ".env"]);
  });

  // (fails before: yes)
  test("a move to a new worktree copies the list after the move (FOC-67)", async () => {
    const s = await (await shim.post("/api/sessions", { model: "agent/brain-model", cwd: repo })).json();
    const r = await shim.api(`/api/sessions/${s.id}/move`, { method: "POST", body: { to: { name: "moved", copy: [".env", "notes.txt"] } } });
    assert.equal(r.status, 200, await r.clone().text());
    const job = shim.app.copies.running(s.id);
    assert.ok(job);
    const result = await job.done;
    assert.deepEqual(result.copied, [".env", "notes.txt"]);
    assert.equal(readFileSync(join(base, "game-moved", "notes.txt"), "utf8"), "draft notes\n");
    const rec = shim.app.memory.archive.getChain(s.id).meta.moves.at(-1);
    assert.deepEqual(rec.copy, [".env", "notes.txt"], "the move keeps what the template brings");
    assert.match(String(moveNote(shim.app.memory.archive.getChain(s.id).meta)?.text), /but for what Filament copies into the new worktree from the project's list: \.env, notes\.txt\./, "and its agent is told");
  });

  // (fails before: yes — Move back took the worktree while its copy still wrote into it)
  test("Move back ends a copy still running into the worktree it takes back", async () => {
    const s = await (await shim.post("/api/sessions", { model: "agent/brain-model", cwd: repo })).json();
    const copies = shim.app.copies;
    const real = copies.start;
    /** @type {any} */
    let job = null;
    copies.start = (/** @type {string} */ id, /** @type {any} */ o) => (job = real(id, { ...o, paths: [".env"] }));
    try {
      const moved = await (await shim.api(`/api/sessions/${s.id}/move`, { method: "POST", body: { to: { name: "back-out", copy: [".env"] } } })).json();
      assert.ok(job);
      const stop = copies.stop;
      /** @type {string[]} */
      const why = [];
      copies.stop = async (/** @type {string} */ id, /** @type {string} */ w) => {
        why.push(w);
        return stop(id, w);
      };
      try {
        const back = await shim.api(`/api/sessions/${s.id}/move/back`, { method: "POST", body: { id: moved.move.id } });
        assert.equal(back.status, 200, await back.clone().text());
      } finally {
        copies.stop = stop;
      }
      assert.deepEqual(why, ["the chat moved back"]);
      assert.equal(copies.running(s.id), null);
      assert.ok(!existsSync(join(base, "game-back-out")), "the worktree went");
    } finally {
      copies.start = real;
    }
  });

  // (fails before: yes — no turn waited on a copy)
  test("the first turn waits on the copy, said with its progress; Send without it goes on; Stop ends the wait, never the copy (FO-D36, FOC-63, FOC-73)", async () => {
    const copies = shim.app.copies;
    const real = copies.running;
    const open = gate();
    const job = { id: "j", chainId: "", progress: { done: 3, total: 9, files: 1, totalFiles: 3, entry: "Library" }, done: open.promise, on: () => () => {} };
    copies.running = () => job;
    try {
      const s = await (await shim.post("/api/sessions", { model: "agent/brain-model", cwd: repo })).json();
      const holder = async () => (await (await shim.api("/api/sessions/holders")).json()).holders.find((/** @type {any} */ h) => h.chainId === s.id);
      const turn = shim.api(`/api/sessions/${s.id}/turns`, { method: "POST", body: { content: "go", stream: false } });
      const h = await until(async () => {
        const x = await holder();
        return x?.phase?.kind === "copying" ? x : null;
      }, "the turn to wait on the copy");
      assert.deepEqual([h.phase.skippable, h.phase.copy], [true, { done: 3, total: 9, entry: "Library" }]);
      assert.equal((await shim.api(`/api/sessions/${s.id}/wait/skip`, { method: "POST" })).status, 200);
      assert.equal((await turn).status, 200, "Send without it: the turn goes on while the copy carries on");
      const second = shim.api(`/api/sessions/${s.id}/turns`, { method: "POST", body: { content: "again", stream: false } });
      await until(async () => (await holder())?.phase?.kind === "copying", "the second turn to wait");
      assert.equal((await shim.api(`/api/sessions/${s.id}/stop`, { method: "POST", body: {} })).status, 200);
      const stopped = await second;
      assert.equal(stopped.status, 409);
      assert.match((await stopped.json()).error, /stopped from the harness/);
      assert.equal(open.opened, false, "the copy was not touched");
    } finally {
      copies.running = real;
      open.open();
    }
  });
});

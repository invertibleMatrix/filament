// @ts-check
// Filament reads a chat's waiting sub-agent work against its folder by itself — every 30 s the chat runs no turn, as
// its Agents list is read, at a turn's end — for work brought in there whole (`settleFound`). A read where nothing it
// read moved since starts no git (the slowness of 11-02: a chat with four helpers' 426 files waiting started thousands
// of git processes every 30 s, each holding Filament's loop on Windows while it started, and Filament crawled); one
// where anything moved reads again, and finds what the last could not — a file, a folder's attributes, git's config
// wherever git reads it. Work found whole is read from the folder once.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RACY_MS, foundWhole, taskRefs } from "../src/adapters/git/worktree.js";
import { patchHand } from "../src/adapters/tools/patch-hands.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { sessionRoutes } from "../src/http/admin/sessions.js";
import { createRouter } from "../src/http/router.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { gitRuns } from "./helpers/git-runs.js";

/** The stats a pass asks of the folder `lookedIn` without git, by path. */
let lookedIn = "";
/** @type {string[]} */
let lookedAt = [];
const lstat = fsp.lstat;
/** @this {any} @param {any[]} a */
/** @type {any} */ (fsp).lstat = function (...a) {
  if (lookedIn && String(a[0]).startsWith(lookedIn)) lookedAt.push(String(a[0]));
  return /** @type {any} */ (lstat).apply(this, a);
};
syncBuiltinESMExports();
/**
 * One pass `go` starts, read to its end: the git it started (`gitRuns`), how many sub-agents' waiting work it asked to
 * be read (`settleWaiting`'s answer), and the stats it asked of `dir`.
 * @param {string} dir @param {() => Promise<number>} go
 */
const passOf = async (dir, go) => {
  const at = (lookedAt = []);
  lookedIn = dir;
  try {
    const { out: asked, runs } = await gitRuns(go);
    return { runs, asked, looked: at.length, at };
  } finally {
    lookedIn = "";
  }
};
/** A read of the folder, which ends with git's hash of the developer's files. @param {string[][]} runs */
const readFolder = (runs) => runs.some((r) => r[0] === "hash-object");
/** A pass that asked the one sub-agent's work to be read, read it by the folder's stats, and started no git. @param {Awaited<ReturnType<typeof passOf>>} p @param {string} why */
const quiet = (p, why) => {
  assert.deepEqual([p.asked, p.runs], [1, []], `${why}: its work asked, no git`);
  assert.ok(p.looked > 0, `${why}: read by the folder's stats`);
};

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
const TEN = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n";
/** A folder of its own, gone after the tests. @param {string} what */
const folder = (what) => {
  const dir = mkdtempSync(join(tmpdir(), `filament-settle-moved-${what}-`));
  made.push(dir);
  return dir;
};
/** A repository with `files` committed — a.txt alone where none are named. @param {Record<string, string>} [files] */
const repo = (files = { "a.txt": TEN }) => {
  const dir = folder("repo");
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** The folder left a while: its files' stats are old enough to stand for them (worktree.js `RACY_MS`). */
const aWhile = () => new Promise((r) => setTimeout(r, 3_100));
/** A minute ago. */
const AGO = () => new Date(Date.now() - 60_000);

/**
 * A registry over a real folder whose sub-agent works in its own copy as `work` says, handed its folder and its host;
 * `now`, its clock. `pass()`: the last pass its `settleWaiting` began, whoever asked it — the Agents list's route too.
 * `workspace`: the session's `subagents.workspace` — a worktree, whose disk `work` writes and deletes in, unless a test
 * says otherwise.
 * @param {string} dir @param {(cwd: string, host: any) => void | Promise<void>} work @param {() => number} [now] @param {string} [workspace]
 */
const working = (dir, work, now = Date.now, workspace = "worktree") => {
  const cards = createAgentCardStore({ dataDir: null });
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    now,
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      card: (tag) => cards.find(tag),
      settings: () => ({ subagents: { ask: [], workspace }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: dir, model: "m", projectId: null }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
      exchangeEnded: () => {},
      saveThread: () => {},
      loadThreads: () => [],
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      const host = registry.hostOf(id);
      const cwd = host?.workdir || String(headers["x-filament-cwd"]);
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      await work(cwd, host);
      registry.relay(id, { type: "tool-end", name: "write", ok: true });
      registry.finish(id, { status: "done", error: null, report: "done", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "done" }] }], rounds: 1, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "done" }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  /** @type {Promise<number>} */
  let last = Promise.resolve(0);
  const settle = registry.settleWaiting;
  registry.settleWaiting = (/** @type {string} */ chainId, /** @type {{ person?: boolean } | undefined} */ o) => (last = settle(chainId, o));
  return Object.assign(registry, { pass: () => last });
};
/** @param {ReturnType<typeof working>} registry */
const launched = async (registry) => {
  const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "change a.txt" }));
  assert.equal(r.ok, true, String(r.error || ""));
  await r.done;
  return String(r.id);
};
/**
 * A sub-agent at work on `dir`, its work waiting, and the clock its passes read: `next()` moves it past the 30 s between
 * two and runs one, read to its end.
 * @param {string} dir @param {Parameters<typeof working>[1]} work @param {string} [workspace]  as `working` takes it
 */
const waiting = async (dir, work, workspace) => {
  let shift = 0;
  const registry = working(dir, work, () => Date.now() + shift, workspace);
  const id = await launched(registry);
  const next = () => {
    shift += 31_000;
    return passOf(dir, () => registry.settleWaiting("c1"));
  };
  const pending = () => /** @type {any} */ (registry.get(id))?.work?.pending;
  const found = () => /** @type {any} */ (registry.get(id))?.work?.lastApplied?.by === "found";
  return { registry, id, next, pending, found, later: () => void (shift += 31_000) };
};
/**
 * The Agents list's route over a registry, read as the page reads it. @param {ReturnType<typeof createSubagentRegistry>} registry
 * @returns {(path: string) => Promise<any>}
 */
const listRoute = (registry) => {
  const call = createRouter(sessionRoutes(/** @type {any} */ ({ memory: {}, usage: {}, ops: {}, sessions: {}, subagents: registry, config: { get: () => ({}) } })));
  return async (path) => {
    const url = new URL(`http://127.0.0.1${path}`);
    const m = call("GET", url.pathname);
    assert.ok(m, "the route has a row");
    let body = "";
    let status = 0;
    const res = { headersSent: false, writableEnded: false, setHeader() {}, getHeader() {}, writeHead: (/** @type {number} */ s) => void (status = s), write: (/** @type {string} */ c) => void (body += c), end: (/** @type {string} */ c = "") => void (body += c), on() {} };
    await m.handler(/** @type {any} */ ({ req: { headers: {}, method: "GET", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url, path: url.pathname, method: "GET", params: m.params }), /** @type {any} */ ({}));
    assert.equal(status, 200, body);
    return JSON.parse(body);
  };
};
/** Its change: line 3 as X — the file's size as it was. @param {string} cwd */
const ex = (cwd) => writeFileSync(join(cwd, "a.txt"), TEN.replace("3\n", "X\n"));
/** Its change brought in with Windows' line endings: git adds it as it is, unless something says it is text. */
const EX_CRLF = TEN.replace("3\n", "X\n").replace(/\n/g, "\r\n");

// (fails before: yes — the slowness of 11-02: every read of the Agents list, 30 s after the last, read every waiting
// file of every helper against the folder again, a git process or six each, though nothing had moved)
test("the Agents list read while nothing moved looks at the folder's stats and starts no git; its change brought in — the file's size and time as they were — is read again, and found", async () => {
  const dir = repo();
  const w = await waiting(dir, ex);
  const read = listRoute(w.registry);
  await aWhile();
  w.later();
  const first = await passOf(dir, async () => (await read("/sessions/c1/subagents"), w.registry.pass()));
  assert.ok(first.asked === 1 && readFolder(first.runs), "the first read reads the folder");
  assert.equal(w.pending(), 1, "not in the folder: it waits");
  w.later();
  quiet(await passOf(dir, async () => (await read("/sessions/c1/subagents"), w.registry.pass())), "the list read again");
  quiet(await w.next(), "the clock's pass");

  // Brought in by hand: the same size, and its time put back as it was — only its change time says it moved.
  const t = statSync(join(dir, "a.txt")).mtime;
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "X\n"));
  utimesSync(join(dir, "a.txt"), t, t);
  assert.ok(readFolder((await w.next()).runs), "read again");
  assert.ok(w.found());
});

// (fails before: yes — the same)
test("a change of the folder's attributes alone, or of git's config, is read again: what git adds the developer's file as moved with it", async () => {
  const dir = repo();
  const w = await waiting(dir, ex);
  writeFileSync(join(dir, "a.txt"), EX_CRLF);
  await aWhile();
  await w.next();
  quiet(await w.next(), "nothing moved");
  assert.equal(w.pending(), 1, "its line endings differ: it waits");
  writeFileSync(join(dir, ".gitattributes"), "a.txt text\n");
  await w.next();
  assert.ok(w.found(), "the folder says it is text");

  const dir2 = repo();
  const w2 = await waiting(dir2, ex);
  writeFileSync(join(dir2, "a.txt"), EX_CRLF);
  await aWhile();
  await w2.next();
  quiet(await w2.next(), "nothing moved");
  git(dir2, "config", "core.autocrlf", "true");
  await w2.next();
  assert.ok(w2.found(), "git's config says it is text");
});

// (fails before: yes — the review of 11-02: a pass that found its files moved looked at each of them twice, once to
// find it and once more for its read)
test("a pass that finds a file moved looks at each of its files once", async () => {
  const dir = repo();
  const w = await waiting(dir, ex);
  await aWhile();
  await w.next();
  // What the first stood on was kept: with nothing kept, a pass looks once whatever it does.
  quiet(await w.next(), "nothing moved");
  writeFileSync(join(dir, "a.txt"), TEN.replace("1\n", "one\n"));
  const p = await w.next();
  assert.ok(readFolder(p.runs), "read again");
  assert.equal(p.at.filter((x) => x === join(dir, "a.txt")).length, 1);
});

/**
 * A read of the sub-agent's work made within RACY_MS of `touch` changing the folder's file — the moment its stat cannot
 * stand for it —: what it left to stand on. Asked with the read before's stamp, its first look at the folder is made as
 * it is asked, before any git, and stands for the read where it looks at the same files (`foundWhole`).
 * @param {(file: string) => void} touch
 */
const readJustAfter = async (touch) => {
  const { dir, refs } = await refsOfWork();
  const before = await foundWhole(refs.repo, refs);
  assert.ok(before.stamp, "the read before stands");
  const t0 = Date.now();
  touch(join(dir, "a.txt"));
  const read = foundWhole(refs.repo, refs, { since: before.stamp });
  assert.ok(Date.now() - t0 < RACY_MS, "asked within the moment");
  return (await read).stamp;
};

test("a file written a moment before the read leaves the read nothing to stand on, though its stat is the same: its next write may keep it", async () => {
  assert.equal(await readJustAfter((f) => writeFileSync(f, TEN.replace("1\n", "one\n"))), null);
});

// (fails before: yes — the review of 11-02: the racy check read a file's written time alone)
test("a file whose written time is old but which changed a moment ago — copied keeping its time — leaves the read nothing to stand on", async () => {
  assert.equal(
    await readJustAfter((f) => {
      writeFileSync(f, TEN.replace("1\n", "one\n"));
      utimesSync(f, AGO(), AGO());
    }),
    null,
  );
});

// (fails before: yes — the slowness of 11-02: work found whole was read from the folder whole twice, once to find it
// and once more under its hold)
test("work found in the folder whole is read from the folder once: the read under its hold stands on the first, where nothing moved", async () => {
  const dir = repo();
  const w = await waiting(dir, ex);
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "X\n"));
  await aWhile();
  const { runs } = await w.next();
  assert.ok(w.found());
  assert.equal(runs.filter((r) => r[0] === "diff" && r.includes("--raw")).length, 1, "its files listed once");
  assert.equal(runs.filter((r) => r[0] === "hash-object").length, 1, "the folder read once");
  assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), TEN.replace("3\n", "X\n"), "nothing written");
});

test("its change found beside the developer's own edits — a merge that comes out as their file — is found, through one read of the three versions", async () => {
  const dir = repo();
  const w = await waiting(dir, ex);
  writeFileSync(join(dir, "a.txt"), TEN.replace("1\n", "ONE, yours\n").replace("3\n", "X\n"));
  await aWhile();
  const { runs } = await w.next();
  assert.ok(w.found(), "found");
  const kinds = runs.map((r) => r.filter((a) => !/^[0-9a-f]{40}$/.test(a)).join(" "));
  for (const k of ["hash-object --stdin-paths", "hash-object -w --stdin-paths", "cat-file --batch"]) assert.equal(kinds.filter((x) => x === k).length, 1, k);
  assert.equal(runs.filter((r) => r[0] === "merge-file").length, 1);
  assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), TEN.replace("1\n", "ONE, yours\n").replace("3\n", "X\n"), "nothing written");
});

test("a file it added, once it stands at its path in the folder, is read again and found", async () => {
  const dir = repo();
  const w = await waiting(dir, (cwd) => writeFileSync(join(cwd, "c.txt"), "sea\n"));
  await aWhile();
  await w.next();
  quiet(await w.next(), "nothing moved");
  writeFileSync(join(dir, "c.txt"), "sea\n");
  await w.next();
  assert.ok(w.found());
});

test("a file it deleted, once deleted from the folder too, is read again and found", async () => {
  const dir = repo({ "a.txt": TEN, "b.txt": "bee\n" });
  const w = await waiting(dir, (cwd) => rmSync(join(cwd, "b.txt")));
  await aWhile();
  await w.next();
  quiet(await w.next(), "nothing moved");
  assert.equal(w.pending(), 1, "its delete waits");
  rmSync(join(dir, "b.txt"));
  await w.next();
  assert.ok(w.found());
});

test("a .gitattributes in a folder on a file's way, once written, is read again: the file comes in as text", async () => {
  const dir = repo({ "sub/deep/a.txt": TEN });
  const w = await waiting(dir, (cwd) => writeFileSync(join(cwd, "sub", "deep", "a.txt"), TEN.replace("3\n", "X\n")));
  writeFileSync(join(dir, "sub", "deep", "a.txt"), EX_CRLF);
  await aWhile();
  await w.next();
  quiet(await w.next(), "nothing moved");
  writeFileSync(join(dir, "sub", ".gitattributes"), "*.txt text\n");
  await w.next();
  assert.ok(w.found());
});

// (fails before: no — the counterpart of the one above for a patch, whose folder holds none of the project's folders
// until it reads or writes a file there: its change made through its own tools. A patch deletes nothing without moving
// to a worktree first: the delete above is a worktree's.)
test("a patch's change to a file in a folder, made through its own tools: a .gitattributes on its way, once written, is read again and the file comes in as text", async () => {
  const dir = repo({ "sub/deep/a.txt": TEN });
  /** @type {boolean[]} */
  const patched = [];
  const w = await waiting(dir, async (_, host) => {
    patched.push(!!host.workspace);
    const o = { root: host.workdir, fenced: true, seen: new Map() };
    await patchHand("read", { path: "sub/deep/a.txt" }, host.workspace, o);
    await patchHand("write", { path: "sub/deep/a.txt", content: TEN.replace("3\n", "X\n") }, host.workspace, o);
  }, "patch");
  assert.deepEqual([patched, w.pending()], [[true], 1], "it worked in a patch, and its change waits");
  writeFileSync(join(dir, "sub", "deep", "a.txt"), EX_CRLF);
  await aWhile();
  await w.next();
  quiet(await w.next(), "nothing moved");
  writeFileSync(join(dir, "sub", ".gitattributes"), "*.txt text\n");
  await w.next();
  assert.ok(w.found());
});

// (fails before: yes — the review of 11-02: a file an include names was not watched unless it held a setting already)
test("a file git's config includes, empty until now, is read again once it says something", async () => {
  const dir = repo();
  const inc = join(folder("include"), "inc.cfg");
  writeFileSync(inc, "");
  git(dir, "config", "include.path", inc);
  const w = await waiting(dir, ex);
  writeFileSync(join(dir, "a.txt"), EX_CRLF);
  await aWhile();
  await w.next();
  quiet(await w.next(), "nothing moved");
  writeFileSync(inc, "[core]\n\tautocrlf = true\n");
  await w.next();
  assert.ok(w.found(), "the included config says it is text");
});

/** What turns the developer's CRLF file into text for git, written into a config file. */
const AUTOCRLF = "[core]\n\tautocrlf = true\n";
/**
 * The sub-agent's change brought in with Windows' line endings, which git reads as text once `say` writes core.autocrlf
 * where git reads it: a pass where nothing moved starts no git, and the pass after `say` finds the work. The test's
 * environment for git — `envOf`'s, over the system's and the user's config put in a folder of the test's own (`at`),
 * so neither the machine's nor the user's says anything meanwhile — holds for the test alone, and the repository's
 * own word on line endings, which would stand over theirs, goes.
 * @param {(at: string) => Record<string, string>} envOf @param {(at: string, dir: string) => void} say
 */
const configSays = async (envOf, say) => {
  const at = folder("config");
  const env = { GIT_CONFIG_SYSTEM: join(at, "system.cfg"), GIT_CONFIG_GLOBAL: join(at, "global.cfg"), ...envOf(at) };
  const was = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    const dir = repo();
    git(dir, "config", "--unset", "core.autocrlf");
    const w = await waiting(dir, ex);
    writeFileSync(join(dir, "a.txt"), EX_CRLF);
    await aWhile();
    await w.next();
    quiet(await w.next(), "nothing moved");
    say(at, dir);
    await w.next();
    assert.ok(w.found(), "its config says it is text");
  } finally {
    for (const [k, v] of Object.entries(was))
      if (v == null) delete process.env[k];
      else process.env[k] = v;
  }
};
// (fails before: yes — the same: a system config not there yet was not watched)
test("the system's config, not there yet where git looks for it, is read again once written", () =>
  configSays(() => ({}), (at) => writeFileSync(join(at, "system.cfg"), AUTOCRLF)));
// (fails before: yes — the same: the user's config where GIT_CONFIG_GLOBAL puts it was not watched)
test("the user's config where GIT_CONFIG_GLOBAL puts it, not there yet, is read again once written", () =>
  configSays(() => ({}), (at) => writeFileSync(join(at, "global.cfg"), AUTOCRLF)));

// (fails before: yes — the round-2 review of 11-02: a config file that is a link was stamped by the link alone, and git
// writes through it)
test("the user's config as a link — to a dotfiles folder — is read again once what it leads to is written", async (t) => {
  const at = folder("dotfiles");
  writeFileSync(join(at, "gitconfig"), "");
  const link = join(at, "linked.cfg");
  try {
    symlinkSync(join(at, "gitconfig"), link, "file");
  } catch (/** @type {any} */ e) {
    return t.skip(`no file links here (${e.code})`);
  }
  await configSays(() => ({ GIT_CONFIG_GLOBAL: link }), () => writeFileSync(join(at, "gitconfig"), AUTOCRLF));
});

// (fails before: yes — the same: a GIT_CONFIG_GLOBAL named .gitconfig was taken for git's home, and `~/` in an include
// was followed from there)
test("an include under `~/` is followed from git's own home, wherever GIT_CONFIG_GLOBAL puts the user's config", () =>
  configSays(
    (at) => {
      mkdirSync(join(at, "home"));
      mkdirSync(join(at, "elsewhere"));
      writeFileSync(join(at, "elsewhere", ".gitconfig"), "[include]\n\tpath = ~/from-home.cfg\n");
      return { HOME: join(at, "home"), GIT_CONFIG_GLOBAL: join(at, "elsewhere", ".gitconfig") };
    },
    (at) => writeFileSync(join(at, "home", "from-home.cfg"), AUTOCRLF),
  ));

// (fails before: yes — the same: a relative path git names was read from Filament's own folder)
test("the user's config at a relative GIT_CONFIG_GLOBAL is watched where git reads it: from the repository's top", () =>
  configSays(() => ({ GIT_CONFIG_GLOBAL: "relative-global.cfg" }), (_at, dir) => writeFileSync(join(dir, "relative-global.cfg"), AUTOCRLF)));

// (fails before: yes — the same: an include git is handed in its environment comes from no file, and was not followed)
test("an include git is handed in its environment (GIT_CONFIG_COUNT) is followed", () =>
  configSays(
    (at) => {
      writeFileSync(join(at, "handed.cfg"), "");
      return { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "include.path", GIT_CONFIG_VALUE_0: join(at, "handed.cfg") };
    },
    (at) => writeFileSync(join(at, "handed.cfg"), AUTOCRLF),
  ));

// (fails before: yes — the same: what was kept under one GIT_CONFIG_GLOBAL stood on after it pointed elsewhere)
test("git's environment changed — the user's config put elsewhere — is a read again", () =>
  configSays(
    (at) => {
      writeFileSync(join(at, "other.cfg"), AUTOCRLF);
      return {};
    },
    (at) => void (process.env.GIT_CONFIG_GLOBAL = join(at, "other.cfg")),
  ));

/** A sub-agent's waiting work, and its commits on its refs. */
const refsOfWork = async () => {
  const dir = repo();
  const w = await waiting(dir, ex);
  await aWhile();
  const refs = await taskRefs(dir, w.id);
  assert.ok(refs);
  return { dir, refs };
};
// (fails before: yes — the same: the system's attributes were not watched)
test("the system's attributes are among what a read stands on", async () => {
  const { dir, refs } = await refsOfWork();
  const system = resolve(execFileSync("git", ["var", "GIT_ATTR_SYSTEM"], { cwd: dir, encoding: "utf8" }).trim());
  const r = await foundWhole(refs.repo, refs);
  assert.ok(r.stamp?.watched.includes(system), `${system} watched`);
});
// (fails before: yes — the same: attributes read from a tree kept a stamp, which no commit moved)
test("attributes read from a tree (attr.tree) leave a read nothing to stand on: every read reads again", async () => {
  const { dir, refs } = await refsOfWork();
  git(dir, "config", "attr.tree", "HEAD");
  await aWhile();
  assert.equal((await foundWhole(refs.repo, refs)).stamp, null);
});

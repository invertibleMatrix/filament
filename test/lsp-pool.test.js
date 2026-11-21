// @ts-check
// Language servers kept warm (src/adapters/lsp/pool.js; the owner's LSP of 11-04): one per real folder and server,
// started at the first ask and shared; held by an ask until it lets go, and never closed under it; closed once idle, or
// past the most at once; held back with a growing wait once one fails to start or ends by itself; a worker's own closed
// with its run once its asks let go, a start there stopped, none starting there meanwhile; every one closed at the end,
// a start under way stopped there and at Filament's exit, none starting after.
// (fails before: yes — Filament had no pool of language servers)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startLsp } from "../src/adapters/lsp/client.js";
import { LSP_FAILED_WAIT_MAX_MS, LSP_FAILED_WAIT_MS, LSP_IDLE_MS, createLspPool, rootKey } from "../src/adapters/lsp/pool.js";
import { removeDirs, until } from "./helpers/wait.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-lsp.mjs", import.meta.url));
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** A folder with a file the fake server knows. @param {string} tag @param {string} [at] */
const folder = (tag, at) => {
  const d = at || mkdtempSync(join(tmpdir(), `filament-lsp-pool-${tag}-`));
  mkdirSync(d, { recursive: true });
  if (!at) made.push(d);
  writeFileSync(join(d, "app.js"), "function helper() {}\n");
  return d;
};
/** The fake server's spec. @param {Record<string, string>} [env] */
const fake = (env = {}) => ({ name: "fake", command: process.execPath, args: [FAKE], env, languages: { ".js": "javascript" } });
/** A pool on a clock of the test's, counting the folders each start was for. */
const poolOf = (/** @type {{ most?: number }} */ o = {}) => {
  const clock = { t: 1_000_000 };
  /** @type {string[]} */
  const starts = [];
  const pool = createLspPool({
    now: () => clock.t,
    start: (spec, opts) => {
      starts.push(rootKey(opts.root));
      return startLsp(spec, opts);
    },
    ...o,
  });
  after(() => pool.closeAll());
  return { pool, clock, starts };
};
/** The methods a fake server's log names, of those given. @param {string} log @param {string[]} of */
const told = (log, of) => readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l).method).filter((m) => of.includes(m));
/** The process of the fake server that logs to `log`, once it has been asked to initialize. @param {string} log */
const pidOf = async (log) => {
  const read = () => {
    try {
      return Number(JSON.parse(readFileSync(log, "utf8").split("\n")[0]).pid) || 0;
    } catch {
      return 0;
    }
  };
  await until(() => read() > 0, "its initialize logged");
  return read();
};
/** Whether a process runs. @param {number} pid */
const running = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (/** @type {any} */ e) {
    return e?.code === "EPERM";
  }
};

describe("one server per folder and server", () => {
  test("two asks at once share one start, a later ask the server running; the folder by its real path, a link to it too; another folder its own", async () => {
    const a = folder("a");
    const b = folder("b");
    const link = join(b, "link-to-a");
    symlinkSync(a, link, "junction");
    const { pool, starts } = poolOf();
    const [one, two] = await Promise.all([pool.server(fake(), a), pool.server(fake(), a)]);
    assert.ok(one.server && one.server === two.server, "shared");
    assert.deepEqual([one.fresh, two.fresh], [true, false]);
    for (const spelling of [link, process.platform === "win32" ? a.toUpperCase() : `${a}/`]) {
      const again = await pool.server(fake(), spelling);
      assert.deepEqual([again.server === one.server, again.fresh], [true, false], spelling);
    }
    assert.equal(one.server.root, a, "it works in the folder as the first ask named it");
    const other = await pool.server(fake(), b);
    assert.ok(other.server && other.server !== one.server);
    const changed = await pool.server({ ...fake(), args: [FAKE, "--other"] }, a);
    assert.ok(changed.server && changed.server !== one.server, "another spec is another server");
    assert.deepEqual(starts, [rootKey(a), rootKey(b), rootKey(a)]);
  });

  // (fails before: the review of 11-04 — past the most, the least used went though an ask was working with it)
  test("held by an ask, a server is never closed under it: idle past its time, or the least used past the most — once let go, it is", async () => {
    const a = folder("idle");
    const { pool, clock, starts } = poolOf();
    const ask = await pool.server(fake(), a);
    clock.t += LSP_IDLE_MS + 1;
    pool.sweep();
    assert.equal(ask.server?.alive(), true, "held");
    ask.release();
    ask.release();
    assert.deepEqual(pool.running().map((r) => r.held), [0], "let go once");
    clock.t += LSP_IDLE_MS - 1;
    pool.sweep();
    assert.equal(ask.server?.alive(), true, "not idle long enough yet");
    clock.t += 2;
    pool.sweep();
    await until(() => ask.server?.alive() === false, "closed once idle");
    assert.equal(pool.size(), 0);
    const next = await pool.server(fake(), a);
    assert.ok(next.server && next.server !== ask.server && next.fresh);
    next.release();
    assert.equal(starts.length, 2);
    const two = poolOf({ most: 2 });
    const [x, y, z, w] = [folder("x"), folder("y"), folder("z"), folder("w")];
    const hx = await two.pool.server(fake(), x);
    two.clock.t += 10;
    const hy = await two.pool.server(fake(), y);
    hy.release();
    two.clock.t += 10;
    const hz = await two.pool.server(fake(), z);
    await until(() => hy.server?.alive() === false, "the least used of those let go is closed");
    assert.equal(hx.server?.alive(), true, "the least used of all, but held");
    const hw = await two.pool.server(fake(), w);
    assert.equal(two.pool.size(), 3, "past the most while every other is held");
    hx.release();
    hz.release();
    hw.release();
    two.pool.sweep();
    await until(() => hx.server?.alive() === false, "trimmed to the most once let go");
    assert.deepEqual(two.pool.running().map((r) => rootKey(r.root)).sort(), [rootKey(z), rootKey(w)].sort());
  });
});

describe("one that fails", () => {
  test("a server that ends by itself is held back, its end said, then tried again; each failure more waits twice as long, to the most", async () => {
    const a = folder("crash");
    const { pool, clock, starts } = poolOf();
    const crashing = fake({ FAKE_LSP_CRASH: "1", FAKE_LSP_LOG: join(a, "crash.log") });
    const s = (await pool.server(crashing, a)).server;
    s?.sync("app.js");
    await until(() => s?.alive() === false, "it ends at its first open");
    await until(() => pool.size() === 0, "out of the pool");
    const held = await pool.server(crashing, a);
    assert.deepEqual([held.server, held.fresh], [null, false]);
    assert.match(String(held.problem), new RegExp(`^language server fake exited \\(code 3\\).* — tried again in ${LSP_FAILED_WAIT_MS / 1000} s$`));
    assert.equal(starts.length, 1, "nothing started while held back");
    clock.t += LSP_FAILED_WAIT_MS;
    const back = await pool.server(crashing, a);
    assert.ok(back.server && back.fresh, "tried again once its wait is over");
    back.server.sync("app.js");
    await until(() => pool.size() === 0, "ended again");
    assert.match(String((await pool.server(crashing, a)).problem), new RegExp(`tried again in ${(2 * LSP_FAILED_WAIT_MS) / 1000} s$`));
    // A failure long past is forgotten: the next one starts from the first wait.
    clock.t += 2 * LSP_FAILED_WAIT_MS + LSP_FAILED_WAIT_MAX_MS + 1;
    pool.sweep();
    (await pool.server(crashing, a)).server?.sync("app.js");
    await until(() => pool.size() === 0, "ended a third time");
    assert.match(String((await pool.server(crashing, a)).problem), new RegExp(`tried again in ${LSP_FAILED_WAIT_MS / 1000} s$`));
    // A program that does not start is held back the same way, to the most.
    const none = { name: "nope", command: join(a, "no-such-server.exe"), languages: { ".js": "javascript" } };
    const first = await pool.server(none, a);
    assert.match(String(first.problem), /^language server nope could not start/);
    for (let wait = LSP_FAILED_WAIT_MS, i = 0; i < 6; i++, wait = Math.min(LSP_FAILED_WAIT_MAX_MS, wait * 2)) {
      assert.match(String((await pool.server(none, a)).problem), new RegExp(`tried again in ${wait / 1000} s$`));
      clock.t += wait;
      await pool.server(none, a);
    }
    assert.match(String((await pool.server(none, a)).problem), new RegExp(`tried again in ${LSP_FAILED_WAIT_MAX_MS / 1000} s$`), "never past the most");
  });
});

describe("closing", () => {
  // (fails before: the review of 11-04 — an ask while a worker's servers closed, or once Filament's had, started one
  // that nothing closed)
  test("a worker's own close with its run, a start under way there too, none starting there meanwhile; a folder beside it stays; every one closes at the end, none after", async () => {
    const project = folder("project");
    const worktrees = join(project, ".worktrees");
    const worktree = folder("w1", join(worktrees, "w1"));
    const beside = folder("beside", `${worktrees}-beside`);
    const log = join(beside, "beside.log");
    const exits = process.listenerCount("exit");
    const { pool } = poolOf();
    assert.equal(process.listenerCount("exit"), exits, "a pool that started nothing adds nothing to the process");
    const held = await pool.server(fake(), worktree);
    const mine = held.server;
    assert.equal(process.listenerCount("exit"), exits + 1);
    const theirs = (await pool.server(fake({ FAKE_LSP_LOG: log }), beside)).server;
    const starting = pool.server(fake({ FAKE_LSP_LOG: join(project, "late.log") }), worktrees);
    const closing = pool.close(worktrees);
    const meanwhile = await pool.server(fake(), worktree);
    assert.deepEqual([meanwhile.server, meanwhile.problem], [null, `the language servers of ${worktree} are closing with the run that worked there`]);
    const late = await starting;
    assert.deepEqual([late.server, late.problem], [null, "language server fake was stopped as it started"], "a start under way there is stopped");
    held.release();
    await closing;
    assert.deepEqual([mine?.alive(), theirs?.alive()], [false, true]);
    assert.ok((await pool.server(fake(), worktree)).server, "a later ask there starts one again, the stopped start held back for nothing");
    await pool.closeAll();
    assert.equal(theirs?.alive(), false);
    assert.deepEqual(told(log, ["shutdown", "exit"]), ["shutdown", "exit"]);
    assert.deepEqual([pool.size(), process.listenerCount("exit")], [0, exits]);
    const afterAll = await pool.server(fake(), beside);
    assert.deepEqual([afterAll.server, afterAll.problem, pool.size()], [null, "Filament's language servers are closing", 0]);
  });

  // (fails before: the review of 11-04 — a worker's close ended a server an ask was still working with)
  test("a worker's close waits for the ask that holds its server to let go, then closes it", async () => {
    const w = folder("held");
    const { pool } = poolOf();
    const ask = await pool.server(fake(), w);
    let done = false;
    const closing = pool.close(w).then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual([done, ask.server?.alive()], [false, true], "not closed under its ask");
    ask.release();
    await closing;
    assert.equal(ask.server?.alive(), false);
  });

  // (fails before: lsp-pool-exit of 11-04 — Filament's exit killed the servers running and left one starting, its
  // process orphaned; closing every one waited out its start, up to its 30 s)
  test("a start under way is stopped, its process ended, at Filament's exit and when every one closes — neither waits for it to answer", async () => {
    const before = process.listeners("exit");
    const one = poolOf();
    const a = folder("exit");
    const log = join(a, "exit.log");
    const asking = one.pool.server(fake({ FAKE_LSP_INIT_MS: "60000", FAKE_LSP_LOG: log }), a);
    const onExit = process.listeners("exit").find((l) => !before.includes(l));
    assert.ok(onExit);
    const pid = await pidOf(log);
    // What Filament's exit runs, with no turn of the event loop after it.
    onExit.call(process, 0);
    await until(() => !running(pid), "its process ended");
    assert.deepEqual([(await asking).server, (await asking).problem], [null, "language server fake was stopped as it started"]);
    const two = poolOf();
    const b = folder("all");
    const log2 = join(b, "all.log");
    const asking2 = two.pool.server(fake({ FAKE_LSP_INIT_MS: "60000", FAKE_LSP_LOG: log2 }), b);
    const pid2 = await pidOf(log2);
    const t = Date.now();
    await two.pool.closeAll();
    assert.ok(Date.now() - t < 5000, `closed in ${Date.now() - t} ms`);
    await until(() => !running(pid2), "its process ended");
    assert.equal((await asking2).problem, "language server fake was stopped as it started");
  });

  test("killed at once, nothing asked: what an exit handler can do", async () => {
    const a = folder("kill");
    const log = join(a, "kill.log");
    const s = await startLsp(fake({ FAKE_LSP_LOG: log }), { root: a });
    await s.kill();
    await until(() => s.alive() === false, "ended");
    assert.deepEqual(told(log, ["shutdown"]), []);
  });
});

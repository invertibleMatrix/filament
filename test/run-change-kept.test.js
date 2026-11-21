// @ts-check
// An edit card's change (`GET /runs/:id/changes?patch=1&path=…&round=N`, http/admin/runs.js) kept while its turn goes
// on (the slowness of 11-02): a round's snapshot is a commit, so what the round changed never moves; the answers were
// kept only while the run's rounds stayed as they were, and every round that landed threw every card's answer away,
// each asked again of git. A round's answer now stands while later rounds land; the run's whole change still follows
// them. Every repository is a throwaway under the temp folder — never this one.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { snapshotTree } from "../src/adapters/git/snapshot.js";
import { createRunLog } from "../src/services/runs.js";
import { createEventBus } from "../src/services/events.js";
import { runRoutes } from "../src/http/admin/runs.js";
import { createRouter } from "../src/http/router.js";
import { removeDirs } from "./helpers/wait.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made.reverse()));

class FakeRes {
  status = 0;
  body = "";
  headersSent = false;
  writableEnded = false;
  setHeader() {}
  getHeader() {}
  /** @param {number} s */
  writeHead(s) {
    this.status = s;
    this.headersSent = true;
    return this;
  }
  /** @param {string} c */
  write(c) {
    this.body += c;
  }
  end(c = "") {
    this.body += c;
    this.writableEnded = true;
  }
  on() {}
}

/**
 * A throwaway repository with two rounds' snapshots, a run log, and the changes route over it; only round 1 is on the
 * log until the test lands round 2.
 */
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "filament-kept-change-"));
  const data = mkdtempSync(join(tmpdir(), "filament-kept-runs-"));
  made.push(dir, data);
  git(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);
  const head = git(dir, ["rev-parse", "HEAD"]);
  const place = git(dir, ["rev-parse", "--show-toplevel"]);
  writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\n");
  const s1 = await snapshotTree(dir, { name: "k1/1-1" });
  writeFileSync(join(dir, "b.txt"), "b\n");
  const s2 = await snapshotTree(dir, { name: "k1/1-2", previous: String(s1.commit) });
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: data, config: () => ({}) });
  runs.startRun({ id: "run-k1", kind: "agent-turn", meta: { root: dir } });
  /** @param {number} round @param {string} before @param {string} after @param {string} own */
  const snap = (round, before, after, own) => bus.publish("run:run-k1", { type: "snapshot", place, round, agent: "", before, after, base: "round", own: [own], command: false });
  snap(1, head, String(s1.commit), "a.txt");
  /** Another run whose one round is round 1's. @param {string} id */
  const another = (id) => {
    runs.startRun({ id, kind: "agent-turn", meta: { root: dir } });
    bus.publish(`run:${id}`, { type: "snapshot", place, round: 1, agent: "", before: head, after: String(s1.commit), base: "round", own: ["a.txt"], command: false });
  };
  const route = createRouter(runRoutes(/** @type {any} */ ({ runs, sseClients: new Set() })));
  /** @param {string} query @param {string} [id] */
  const ask = async (query, id = "run-k1") => {
    const path = `/runs/${id}/changes`;
    const m = route("GET", path);
    assert.ok(m);
    const res = new FakeRes();
    const url = new URL(`http://127.0.0.1${path}?${query}`);
    await m.handler(/** @type {any} */ ({ req: { headers: {}, method: "GET", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url, path, method: "GET", params: m.params }), /** @type {any} */ ({}));
    assert.equal(res.status, 200, res.body);
    return JSON.parse(res.body);
  };
  /** git cannot be asked in the repository while `fn` runs. @param {() => Promise<void>} fn */
  const gitAway = async (fn) => {
    renameSync(join(dir, ".git"), join(dir, ".git-away"));
    try {
      await fn();
    } finally {
      renameSync(join(dir, ".git-away"), join(dir, ".git"));
    }
  };
  return { ask, gitAway, another, landRound2: () => snap(2, String(s1.commit), String(s2.commit), "b.txt"), close: () => runs.close() };
}

const CARD = "patch=1&path=a.txt&round=1";

// (fails before: yes — the round's answer was asked of git again once a later round landed)
test("a round's change stands while later rounds land; the run's whole change follows them", async () => {
  const t = await setup();
  try {
    const first = await t.ask(CARD);
    assert.match(String(first.rounds?.[0]?.files?.[0]?.patch), /\+three/, JSON.stringify(first));
    // A later round lands; git cannot be asked now, so an answer asked of it again would hold no patch.
    t.landRound2();
    await t.gitAway(async () => {
      assert.deepEqual(await t.ask(CARD), first, "the round's change, as it was read");
      const whole = await t.ask("patch=1");
      assert.ok(!JSON.stringify(whole).includes("+three"), "the run's whole change is read again: it follows the rounds");
    });
  } finally {
    t.close();
  }
});

// (fails before: no — it holds what the store's bound by rows leaves, Fable 5.2's of 11-19: Find asks the whole of every
// files card it holds, and a bound of a few runs would have walked each again at each drawing; kept-answers.test.js
// holds the bound itself)
test("many runs' small wholes stay kept, with their rounds', files' and first rows: the store is bounded by the rows it holds, not by a few runs", async () => {
  const t = await setup();
  try {
    assert.equal((await t.ask("")).whole.files.length, 1);
    const card = await t.ask(CARD);
    const file = await t.ask("patch=1&path=a.txt");
    const firstRows = await t.ask("first=3");
    const others = Array.from({ length: 4 }, (_, i) => `run-o${i}`);
    for (const id of others) {
      t.another(id);
      assert.equal((await t.ask("", id)).whole.files.length, 1);
    }
    await t.gitAway(async () => {
      assert.deepEqual(await t.ask(CARD), card, "the round's, kept");
      assert.deepEqual(await t.ask("patch=1&path=a.txt"), file, "the file's, kept");
      assert.deepEqual(await t.ask("first=3"), firstRows, "the first rows, kept");
      for (const id of ["run-k1", ...others]) assert.deepEqual((await t.ask("", id)).whole.errors, [], `${id}'s whole, kept`);
    });
  } finally {
    t.close();
  }
});

// (fails before: yes — the review of 11-02: a round's answer that said git could not read it was kept for the whole run)
test("a round's change git could not read is read again at the next ask", async () => {
  const t = await setup();
  try {
    await t.gitAway(async () => {
      const failed = await t.ask(CARD);
      assert.ok(failed.rounds?.[0]?.error, `git could not be asked: ${JSON.stringify(failed)}`);
    });
    const again = await t.ask(CARD);
    assert.match(String(again.rounds?.[0]?.files?.[0]?.patch), /\+three/, JSON.stringify(again));
  } finally {
    t.close();
  }
});

// @ts-check
// A Space's buttons' runs outlive a restart, and one running shows in Now (the owner's of 10-29: "finish the space work
// fully"): each run kept on disk as it starts, while it says something and as it ends; read back by the next Filament —
// one that was going said stopped, with what it said until then —; the newest ten of each kept; and every button running
// now a row of Now's own, which opens its tab.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CUT_WORDS, createAppRuns } from "../src/services/app-runs.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { APP_GONE_WORDS, JOBS_KEPT, RUN_KEEP_MS, SPACE_GONE_WORDS, TAKEN_OUT_WORDS, createDashboardRunner } from "../src/services/dashboard-runner.js";
import { runActionCommand } from "../src/adapters/tools/source-command.js";
import { artifactCall } from "../src/app/agent/artifacts.js";
import { nowRows } from "../src/ui/harness/lib/now.js";

const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), "filament-app-runs-"));
  dirs.push(d);
  return d;
};

const APP = {
  type: "app",
  title: "Pipeline",
  html: "<!doctype html><title>Pipeline</title><main></main>",
  sources: { repo: { command: ["node", "reads/repo.mjs"], rows: "repo", key: "key" } },
  actions: { build: { label: "Build…", on: "repo", command: ["node", "actions/build.mjs"], says: "Build {row.version}?" } },
};
const NAME = "pipeline-ab12";

/**
 * A runner whose buttons' runs are kept in `runsDir`, its button's command held until `release` — saying `says` as it
 * goes, a piece each time the clock moves past the keep's every.
 * Stopped, it ends as a command does: "you stopped it". `checks`: where an agent's check of a run starts.
 * @param {string} runsDir @param {{ artifactsDir?: string, spaces?: any, checks?: any }} [o]
 */
function worldOf(runsDir, o = {}) {
  const clock = { at: Date.UTC(2026, 9, 29, 15, 0) };
  const now = () => clock.at;
  const artifactsDir = o.artifactsDir || fresh();
  const artifacts = createArtifactStore({ dataDir: artifactsDir, log: () => {}, now, four: () => "ab12" });
  const spaces = o.spaces || createSpaceStore({ dir: null, now });
  /** @type {(v: import("../src/core/dashboard-sources.js").ActionOut) => void} */
  let release = () => {};
  /** @type {((s: string) => void) | null} */
  let say = null;
  /** @type {import("../src/core/dashboard-sources.js").RunAction} */
  const act = (_argv, _cwd, signal, onData) =>
    new Promise((r) => {
      release = r;
      say = (s) => onData?.(s);
      signal?.addEventListener("abort", () => r({ ok: false, error: "you stopped it", said: "" }));
    });
  const run = async () => ({ ok: /** @type {const} */ (true), out: JSON.stringify({ repo: [{ key: "here", version: "0.1.2" }] }) });
  const runs = createAppRuns({ dir: runsDir, kept: JOBS_KEPT, now });
  const runner = createDashboardRunner({ spaces, artifacts, folderOf: () => "/work/app", projectOfChain: () => "p1", now, run, act, runs, ...(o.checks ? { checks: o.checks } : {}) });
  const publish = () => artifactCall({ action: "publish", ...APP }, { who: "c1", by: { chain: "c1", model: "m", folder: "/work/app", helper: null }, within: [], port: 20300, maxBytes: 1_000_000 }, artifacts);
  return { clock, artifacts, artifactsDir, spaces, runner, publish, runs, release: (/** @type {any} */ v) => release(v), say: (/** @type {string} */ s) => say?.(s) };
}

describe("a button's runs kept across a restart", () => {
  // (fails before: yes — the runs lived in the runner alone, and a restart lost them)
  test("kept as it starts, while it says something, and as it ends; the next Filament reads them back, its log whole", async () => {
    const runsDir = join(fresh(), "app-runs");
    const w = worldOf(runsDir);
    w.publish();
    assert.equal(w.runner.keep("p1", NAME, 1).ok, true);
    await w.runner.read(NAME, 1, "repo");
    const going = w.runner.act("p1", NAME, "build", "here", {});
    await new Promise((r) => setImmediate(r));
    const [started] = w.runner.jobsOf(NAME);
    const file = join(runsDir, NAME, `${started.id}.json`);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).run.state, "running", "kept as it starts");
    w.say("Typecheck…\n");
    assert.equal(JSON.parse(readFileSync(file, "utf8")).run.log, "", "not at each piece");
    w.clock.at += RUN_KEEP_MS;
    w.say("Tests…\n");
    assert.equal(JSON.parse(readFileSync(file, "utf8")).run.log, "Typecheck…\nTests…\n", "every few seconds while it says something");
    assert.deepEqual(w.runner.running(), [{ project: "p1", name: NAME, title: "Pipeline", label: "Build…", action: "build", by: null, startedAt: started.startedAt }], "Now's row");
    w.release({ ok: true, said: "Typecheck…\nTests…\nBuilt\n" });
    await going;
    assert.deepEqual(w.runner.running(), [], "none once it ended");
    const ended = JSON.parse(readFileSync(file, "utf8")).run;
    assert.deepEqual([ended.state, ended.said], ["done", "Built"]);
    // The next Filament, on the same data.
    const next = worldOf(runsDir, { artifactsDir: w.artifactsDir, spaces: w.spaces });
    assert.deepEqual(next.runner.jobsOf(NAME).map((j) => [j.id, j.state, j.said]), [[started.id, "done", "Built"]]);
    assert.equal(next.runner.jobOf(NAME, started.id)?.log, "Typecheck…\nTests…\n");
  });

  // (fails before: yes — the same)
  test("a run going when Filament stopped comes back stopped, with what it said until then; the newest ten kept, the rest removed", async () => {
    const runsDir = join(fresh(), "app-runs");
    const w = worldOf(runsDir);
    w.publish();
    w.runner.keep("p1", NAME, 1);
    await w.runner.read(NAME, 1, "repo");
    void w.runner.act("p1", NAME, "build", "here", {});
    await new Promise((r) => setImmediate(r));
    w.clock.at += RUN_KEEP_MS;
    w.say("Half way\n");
    const at = w.clock.at;
    const [cut] = w.runner.jobsOf(NAME);
    // Filament stops here: the next one reads what was kept.
    const next = worldOf(runsDir, { artifactsDir: w.artifactsDir, spaces: w.spaces });
    const [back] = next.runner.jobsOf(NAME);
    assert.deepEqual([back.id, back.state, back.said, back.endedAt], [cut.id, "stopped", CUT_WORDS, at]);
    assert.equal(next.runner.jobOf(NAME, cut.id)?.log, "Half way\n");
    assert.deepEqual(next.runner.running(), [], "nothing runs in the new one");
    // What happened says it was cut — once: a third Filament says nothing more of it (found driving it: a cut run left
    // no line, where every run that ends has one).
    const cutLines = () => w.spaces.get("p1").log.filter((e) => e.text.includes("was running when Filament stopped"));
    assert.deepEqual(cutLines().map((e) => e.text), ["“Build…” on Pipeline was running when Filament stopped: it was cut, and what it said until then is kept."]);
    worldOf(runsDir, { artifactsDir: w.artifactsDir, spaces: w.spaces });
    assert.equal(cutLines().length, 1, "said once");
    // Ten more: the newest ten stay, on disk too.
    await next.runner.read(NAME, 1, "repo");
    for (let i = 0; i < JOBS_KEPT; i++) {
      next.clock.at += 1000;
      const p = next.runner.act("p1", NAME, "build", "here", {});
      await new Promise((r) => setImmediate(r));
      next.release({ ok: true, said: `run ${i}\n` });
      await p;
    }
    const kept = next.runner.jobsOf(NAME).map((j) => j.id);
    assert.equal(kept.length, JOBS_KEPT);
    assert.ok(!kept.includes(cut.id), "the oldest went");
    assert.deepEqual(readdirSync(join(runsDir, NAME)).filter((f) => f.endsWith(".json")).sort(), kept.map((id) => `${id}.json`).sort());
  });

  test("the store reads only what is a run, under an artifact's name; with no folder it keeps nothing", () => {
    const dir = fresh();
    mkdirSync(join(dir, "pipeline-ab12"), { recursive: true });
    mkdirSync(join(dir, "..evil"), { recursive: true });
    writeFileSync(join(dir, "pipeline-ab12", "jx1.json"), JSON.stringify({ at: 5, run: { id: "jx1", action: "build", state: "done", startedAt: 1, endedAt: 2, said: "ok", label: "B", key: "k", by: null, log: "" } }));
    writeFileSync(join(dir, "pipeline-ab12", "jx2.json"), "{ not json");
    writeFileSync(join(dir, "pipeline-ab12", "jx3.json"), JSON.stringify({ at: 5, run: { id: "../x", action: "build", state: "done", startedAt: 1, log: "" } }));
    writeFileSync(join(dir, "..evil", "jx1.json"), "{}");
    const warned = /** @type {string[]} */ ([]);
    const store = createAppRuns({ dir, kept: 10, log: (_l, m) => warned.push(m) });
    assert.deepEqual([...store.load().runs].map(([n, l]) => [n, l.map((j) => j.id)]), [["pipeline-ab12", ["jx1"]]]);
    assert.equal(warned.length, 1, "the file that does not read is said");
    const none = createAppRuns({ dir: null, kept: 10 });
    none.save("pipeline-ab12", /** @type {any} */ ({ id: "jx9", action: "b", state: "done", startedAt: 1, log: "" }), ["jx9"]);
    assert.deepEqual([...none.load().runs], []);
    createAppRuns({ dir, kept: 10 }).save("../evil", /** @type {any} */ ({ id: "jx9", action: "b", state: "done", startedAt: 1, log: "" }), []);
    assert.equal(existsSync(join(dir, "..", "evil")), false, "no name outside its folder");
  });
});

describe("a Space deleted while its button runs (found by the Hunter on apps)", () => {
  /** A world whose app is kept in p1, its rows read. @param {any} [checks] */
  const keptWorld = async (checks) => {
    const w = worldOf(join(fresh(), "app-runs"), { checks });
    w.publish();
    w.runner.keep("p1", NAME, 1);
    await w.runner.read(NAME, 1, "repo");
    return w;
  };

  // (fails before: yes — the run went on to its end, and its press was answered 404 "This project has no Space")
  test("Delete Space stops its run, and the press answers how it ended: stopped, its Space deleted", async () => {
    const w = await keptWorld();
    const going = w.runner.act("p1", NAME, "build", "here", {});
    await new Promise((r) => setImmediate(r));
    w.spaces.remove("p1");
    // As the Delete route does once the Space is gone (`afterMove`).
    w.runner.reschedule();
    // Where nothing stops it, it ends by itself — done.
    setImmediate(() => w.release({ ok: true, said: "Built\n" }));
    const got = /** @type {any} */ (await going);
    assert.deepEqual([got.ok, got.done, got.error, got.outcome], [true, false, "you stopped it", SPACE_GONE_WORDS]);
    const [job] = w.runner.jobsOf(NAME);
    assert.deepEqual([job.state, job.said], ["stopped", SPACE_GONE_WORDS]);
    assert.deepEqual(w.runner.running(), []);
  });

  // (fails before: yes — its verdict was written into the Space deleted, which threw where nothing caught it)
  test("a check that ends after its Space was deleted lands nowhere, and throws nothing", async () => {
    /** @type {Map<string, (end: any) => void>} */
    const ends = new Map();
    const w = await keptWorld({
      start: () => ({ ok: true, chain: "c1", agent: "sa-1" }),
      ended: (/** @type {string} */ _c, /** @type {string} */ agent) => new Promise((r) => void ends.set(agent, r)),
    });
    const going = w.runner.act("p1", NAME, "build", "here", {}, { check: { model: "brain-checker" } });
    await new Promise((r) => setImmediate(r));
    w.release({ ok: true, said: "Built\n" });
    assert.deepEqual(/** @type {any} */ (await going).check, { chain: "c1", agent: "sa-1" });
    w.spaces.remove("p1");
    w.runner.reschedule();
    const unhandled = /** @type {unknown[]} */ ([]);
    const heard = (/** @type {unknown} */ e) => void unhandled.push(e);
    process.on("unhandledRejection", heard);
    try {
      ends.get("sa-1")?.({ status: "done", report: "3. Verdict: it worked", error: null });
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      process.off("unhandledRejection", heard);
    }
    assert.deepEqual(unhandled.map(String), []);
  });
});

describe("a button running as Filament stops, or as its app is taken out or deleted (found reviewing the Space work)", () => {
  /** A world whose app is kept in p1, its rows read. @param {string} runsDir */
  const keptWorld = async (runsDir) => {
    const w = worldOf(runsDir);
    w.publish();
    w.runner.keep("p1", NAME, 1);
    await w.runner.read(NAME, 1, "repo");
    return w;
  };

  // (fails before: yes — Filament's stop stopped no button: its command ran on past Filament, and the next Filament
  // said it cut while it still ran)
  test("Filament's stop stops a button running: its press answers it was cut, and its run is kept so — the next Filament cuts it not again", async () => {
    const runsDir = join(fresh(), "app-runs");
    const w = await keptWorld(runsDir);
    const going = w.runner.act("p1", NAME, "build", "here", {});
    await new Promise((r) => setImmediate(r));
    // Where nothing stops it, it ends by itself — done.
    setTimeout(() => w.release({ ok: true, said: "Built\n" }), 200);
    await w.runner.stop();
    const got = /** @type {any} */ (await going);
    assert.deepEqual([got.ok, got.done, got.outcome], [true, false, CUT_WORDS]);
    const [job] = w.runner.jobsOf(NAME);
    assert.deepEqual([job.state, job.said], ["stopped", CUT_WORDS]);
    const next = worldOf(runsDir, { artifactsDir: w.artifactsDir, spaces: w.spaces });
    assert.deepEqual(next.runner.jobsOf(NAME).map((j) => [j.id, j.state, j.said]), [[job.id, "stopped", CUT_WORDS]]);
    assert.equal(w.spaces.get("p1").log.filter((e) => e.text.includes("was running when Filament stopped")).length, 0, "not said cut again");
  });

  // (fails before: yes — the same: the command's process lived on)
  test("…its command's process with it", async () => {
    const folder = fresh();
    const pidFile = join(folder, "pid");
    const artifacts = createArtifactStore({ dataDir: fresh(), log: () => {}, four: () => "ab12" });
    const spaces = createSpaceStore({ dir: null });
    const run = async () => ({ ok: /** @type {const} */ (true), out: JSON.stringify({ repo: [{ key: "here", version: "0.1.2" }] }) });
    const runner = createDashboardRunner({ spaces, artifacts, folderOf: () => folder, projectOfChain: () => "p1", run, act: runActionCommand });
    const hang = { label: "Hang", on: "repo", says: "Hang on {row.version}?", command: ["node", "-e", `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1e9)`] };
    const made = artifactCall({ action: "publish", ...APP, actions: { hang } }, { who: "c1", by: { chain: "c1", model: "m", folder, helper: null }, within: [], port: 20300, maxBytes: 1_000_000 }, artifacts);
    assert.ok(made.ok, made.ok ? "" : made.error);
    assert.equal(runner.keep("p1", NAME, 1).ok, true);
    await runner.read(NAME, 1, "repo");
    const going = runner.act("p1", NAME, "hang", "here", {});
    /** @param {number} pid */
    const alive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    let pid = 0;
    try {
      for (let i = 0; i < 200 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 25));
      pid = Number(readFileSync(pidFile, "utf8"));
      assert.ok(alive(pid), "it runs");
      await runner.stop();
      assert.equal(alive(pid), false, "its process ended with Filament's stop");
      assert.equal(/** @type {any} */ (await going).outcome, CUT_WORDS);
    } finally {
      // Ours alone, where the stop left it.
      if (pid && alive(pid)) process.kill(pid);
      await going;
    }
  });

  // (fails before: yes — it ran on, out of Now, and its Stop answered that nothing ran)
  test("taken out of its Space, its button running stops, said so", async () => {
    const w = await keptWorld(join(fresh(), "app-runs"));
    const going = w.runner.act("p1", NAME, "build", "here", {});
    await new Promise((r) => setImmediate(r));
    w.runner.change("p1", NAME, { removed: true });
    setImmediate(() => w.release({ ok: true, said: "Built\n" }));
    const got = /** @type {any} */ (await going);
    assert.deepEqual([got.done, got.outcome], [false, TAKEN_OUT_WORDS]);
    assert.deepEqual([w.runner.jobsOf(NAME)[0].state, w.runner.jobsOf(NAME)[0].said], ["stopped", TAKEN_OUT_WORDS]);
  });

  // (fails before: yes — it ran on with its secrets, its Stop answered that nothing ran, and its runs stayed on disk)
  test("its app deleted, its button running stops, said so, and its runs are forgotten with it", async () => {
    const runsDir = join(fresh(), "app-runs");
    const w = await keptWorld(runsDir);
    const going = w.runner.act("p1", NAME, "build", "here", {});
    await new Promise((r) => setImmediate(r));
    assert.ok(existsSync(join(runsDir, NAME)));
    // As server.js does as the app is deleted.
    w.artifacts.remove(NAME);
    w.runner.forget(NAME);
    setImmediate(() => w.release({ ok: true, said: "Built\n" }));
    const got = /** @type {any} */ (await going);
    assert.deepEqual([got.done, got.outcome], [false, APP_GONE_WORDS]);
    assert.deepEqual([w.runner.jobsOf(NAME), existsSync(join(runsDir, NAME))], [[], false]);
    assert.match(readFileSync(new URL("../src/server.js", import.meta.url), "utf8"), /if \(change === "deleted"\) \{[\s\S]{0,900}dashboards\.forget\(name\);/, "server.js forgets it as the app is deleted");
  });

  // (fails before: yes — a write cut between its tmp and its rename left the tmp for good)
  test("a run's write a stop cut leaves nothing behind for the next Filament", () => {
    const dir = fresh();
    mkdirSync(join(dir, NAME), { recursive: true });
    writeFileSync(join(dir, NAME, "jx1.json.99999.tmp"), "{");
    writeFileSync(join(dir, NAME, "notes.txt"), "not a run's");
    createAppRuns({ dir, kept: 10 }).load();
    assert.deepEqual(readdirSync(join(dir, NAME)), ["notes.txt"]);
  });
});

describe("a button running in Now", () => {
  // (fails before: yes — Now had chats' rows alone, and an app's build ran with nothing in it)
  test("a row of its own under Working: its app, its project, the press and who made it; it opens its tab", () => {
    const g = nowRows({
      runs: [], folds: new Map(), threads: new Map(), chats: () => null, unread: new Set(), holders: new Map(), now: 1_000,
      apps: [{ project: "p1", projectName: "webshop", name: NAME, title: "Build pipeline", label: "Check…", by: "Release", startedAt: 400 }],
    });
    assert.equal(g.works.length, 1);
    const [r] = g.works;
    assert.deepEqual(
      { key: r.key, chain: r.chain, thread: r.thread, title: r.title, project: r.project, fact: r.fact, icon: r.icon, at: r.at, space: r.space },
      { key: `app:${NAME}`, chain: "", thread: null, title: "Build pipeline", project: "webshop", fact: "“Check…” is running · pressed by Release", icon: "play", at: 400, space: { project: "p1", name: NAME } },
    );
  });

  test("the bar keeps it whatever chats it places, and opening it opens its Space at its app's page (pinned in the source)", () => {
    const list = readFileSync(new URL("../src/ui/harness/now-list.js", import.meta.url), "utf8");
    assert.match(list, /const here = \(\/\*\* @type \{NowRow\} \*\/ r\) => !!r\.thread \|\| !!r\.space \|\| placed\.has\(r\.chain\);/);
    assert.match(list, /apps: o\.apps\?\.\(\) \|\| \[\]/);
    const bar = readFileSync(new URL("../src/ui/harness/sidebar.js", import.meta.url), "utf8");
    assert.match(bar, /if \(r\.space\) \{\n      cb\.onSpace\?\.\(r\.space\.project, r\.space\.name\);\n      return;\n    \}/);
    assert.match(bar, /state\.appRuns = r\.appRuns\.filter/);
    const route = readFileSync(new URL("../src/http/admin/sessions.js", import.meta.url), "utf8");
    assert.match(route, /appRuns = \(a\.dashboards\?\.running\?\.\(\) \|\| \[\]\)/);
  });
});

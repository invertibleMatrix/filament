// @ts-check
// The memory engine installs itself (HarnessV3-AtHome AH-D2): armed by the process that owns the port, memory installs
// its engine whenever memory is on and the engine is missing, once per run; one engine job at a time; a half-built
// engine is never started; where the engine stands is said to the pages (`engineNow`, the `engine` topic, the alert
// when an install nobody pressed for fails). The installer is a stand-in whose promises each test settles.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { MemoryService as Service } from "../src/services/memory/index.js";
import { MemoryService } from "../src/memory-service.js";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";
import { DEFAULT_VERSION, engineIsBundles, engineSource } from "../src/adapters/sidecar/install.js";
import { FAKE_SIDECAR } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const WIN = process.platform === "win32";
const tmp = () => mkdtempSync(join(tmpdir(), "filament-autoinst-"));
const tick = () => new Promise((r) => setImmediate(r));
// A stand-in engine would make memory's start spawn one: these tests are about the missing one.
let hook;
before(() => {
  hook = process.env.FILAMENT_MEMORY_SIDECAR;
  delete process.env.FILAMENT_MEMORY_SIDECAR;
});
after(() => {
  if (hook !== undefined) process.env.FILAMENT_MEMORY_SIDECAR = hook;
});

/**
 * The installer as the service sees it, its jobs held until the test settles them. The engine installed is `engine`
 * (where it came from, the bundle it came from, its Mnemosyne); the bundle here is `bundle`, or none (`bundled` off).
 * `order` says what happened in turn: a backup, an engine's stop and its process's end, an install.
 */
function stubSidecar(dataDir) {
  /** @type {{ o: any, resolve: () => void, reject: (e: Error) => void }[]} */
  const pending = [];
  /** @type {string[]} */
  const order = [];
  const sc = {
    installed: false,
    engine: { source: "bundle", bundleId: "b1", mnemosyne: "3.15.1" },
    bundled: true,
    bundle: { id: "b1", mnemosyne: "3.15.1" },
    error: /** @type {string | null} */ (null),
    calls: { install: /** @type {any[]} */ ([]), uninstall: 0 },
    pending,
    order,
    /** Each engine memory started. @type {any[]} */
    engines: [],
    MemoryEngine: class {
      /** @param {any} o */
      constructor(o) {
        this.o = o;
        sc.engines.push(this);
      }
      ensure() {
        return Promise.reject(new Error("a stand-in engine"));
      }
      /** Closed for good, as memory leaves every engine it drops. */
      close() {
        this.closed = true;
        return this.stop();
      }
      /** Its process ends a moment after it is asked to, as a real one's does. */
      stop() {
        if (this.stopping) return this.stopping;
        order.push("stop");
        return (this.stopping = new Promise((r) => setTimeout(() => { order.push("ended"); r(undefined); }, 20)));
      }
      status() {
        return { state: "stopped" };
      }
    },
    sidecarEnv: () => ({}),
    /** @param {string} d */
    engineDir: (d) => join(d, "memory-engine"),
    /** @param {string} d */
    engineState: (d) => ({
      installed: sc.installed,
      dir: join(d, "memory-engine"),
      venvPython: join(d, "memory-engine", "venv", "python"),
      source: sc.installed ? sc.engine.source : "",
      bundle: sc.installed && sc.engine.source === "bundle" ? { id: sc.engine.bundleId, mnemosyne: sc.engine.mnemosyne } : null,
      mnemosyneVersion: sc.installed ? sc.engine.mnemosyne : "",
      error: sc.error,
      log: [],
    }),
    bundleRoot: () => join(dataDir, "bundles"),
    /** What each look was handed. @type {any[]} */
    looks: [],
    /** @param {string} root @param {any} [o] */
    bundleFor: (root, o) => {
      sc.looks.push([root, o]);
      return sc.bundled
        ? { bundle: { dir: join(root, "here"), id: sc.bundle.id, manifest: { mnemosyne: sc.bundle.mnemosyne } }, why: "" }
        : { bundle: null, why: `this Filament has no memory engine bundle for win32-x64 in ${root}: reinstall Filament, or in a checkout build it with npm run engine:bundle` };
    },
    engineIsBundles,
    /** @param {any} o */
    installEngine: (o) =>
      new Promise((resolve, reject) => {
        order.push("install");
        sc.calls.install.push(o);
        pending.push({
          o,
          resolve: () => {
            sc.installed = true;
            sc.error = null;
            sc.engine = { source: "bundle", bundleId: sc.bundle.id, mnemosyne: sc.bundle.mnemosyne };
            resolve(sc.engineState(o.dataDir));
          },
          // As the installer does: one stopped before it touched anything (the bundle's check) leaves an engine installed.
          reject: (/** @type {any} */ e) => {
            if (!(e.untouched && sc.installed)) {
              sc.installed = false;
              sc.error = e.message;
            }
            reject(e);
          },
        });
      }),
    uninstallEngine: async () => {
      sc.calls.uninstall++;
      sc.installed = false;
      return { ok: true, removed: true };
    },
  };
  return sc;
}

/** A service on the stand-in installer; `memory` is merged into memory's settings; `logged` holds what it logged. */
function make(memory = {}) {
  const dir = tmp();
  const sc = stubSidecar(dir);
  /** @type {{ memory: Record<string, any> }} */
  const cfg = { memory: { enabled: true, folder: join(dir, "m"), privacy: { encryptArchive: false }, ...memory } };
  /** @type {[string, string][]} */
  const logged = [];
  const svc = new Service(/** @type {any} */ ({ getConfig: () => cfg, dataDir: dir, log: (/** @type {string} */ level, /** @type {string} */ msg) => void logged.push([level, msg]), sidecar: sc }));
  return { dir, sc, cfg, svc, logged, async done() { try { await svc.shutdown(); } catch {} rmSync(dir, { recursive: true, force: true }); } };
}
/** @param {any} svc */
const engineJobs = (svc) => [...svc.jobs.values()].filter((j) => j.kind === "install");

test("armed, with memory on and its engine missing, memory installs it: one job, from the bundles' folder, marked its own; where the engine stands follows it", async () => {
  const t = make();
  try {
    /** @type {any[]} */
    const said = [];
    t.svc.onEngine = (now) => said.push(now);
    t.svc.start();
    assert.equal(t.sc.calls.install.length, 0, "not armed: nothing installs");
    assert.deepEqual(t.svc.engineNow(), { state: "missing", error: null });
    t.svc.armAutoInstall();
    assert.equal(t.sc.calls.install.length, 1);
    assert.equal(t.sc.calls.install[0].bundle, t.sc.bundleRoot(), "the bundles' folder is handed in");
    const [job] = engineJobs(t.svc);
    assert.equal(job.auto, true);
    const progress = t.sc.calls.install[0].onProgress;
    progress({ step: "uv", status: "start", percent: 0, message: "checking uv", source: "bundle" });
    assert.deepEqual(t.svc.engineNow(), { state: "installing", percent: 0, source: "bundle", auto: true });
    progress({ step: "uv", status: "progress", message: "checking the bundle's 7 files" });
    progress({ step: "python", status: "start", percent: 15, message: "installing Python 3.12.11 from the bundle" });
    t.sc.pending[0].resolve();
    await job.done;
    await tick();
    assert.deepEqual(t.svc.engineNow(), { state: "ready", source: "bundle" });
    assert.ok(t.svc.store, "the engine it installed is started");
    // said whenever what it says changes, never twice the same
    assert.deepEqual(said, [
      { state: "installing", percent: 0, source: null, auto: true },
      { state: "installing", percent: 0, source: "bundle", auto: true },
      { state: "installing", percent: 15, source: "bundle", auto: true },
      { state: "ready", source: "bundle" },
    ]);
    assert.equal(t.sc.calls.install.length, 1);
  } finally {
    await t.done();
  }
});

test("nothing installs by itself unless armed, memory is on, memory.engine.autoInstall is on, and no engine runs or is installed", async () => {
  // autoInstall off: armed all the same, nothing
  const off = make({ engine: { autoInstall: false } });
  try {
    off.svc.start();
    off.svc.armAutoInstall();
    assert.equal(off.sc.calls.install.length, 0);
  } finally {
    await off.done();
  }
  // memory off: nothing, until it is switched on; then its start installs
  const later = make({ enabled: false });
  try {
    later.svc.start();
    later.svc.armAutoInstall();
    assert.equal(later.sc.calls.install.length, 0);
    assert.deepEqual(later.svc.engineNow(), { state: "off" });
    later.cfg.memory.enabled = true;
    later.svc.start();
    assert.equal(later.sc.calls.install.length, 1, "switched on: its engine comes");
    assert.equal(engineJobs(later.svc)[0].auto, true);
  } finally {
    await later.done();
  }
  // already installed
  const have = make();
  try {
    have.sc.installed = true;
    have.svc.start();
    have.svc.armAutoInstall();
    assert.equal(have.sc.calls.install.length, 0);
    assert.deepEqual(have.svc.engineNow(), { state: "ready", source: "bundle" });
  } finally {
    await have.done();
  }
  // a stand-in engine runs
  const stand = make();
  try {
    process.env.FILAMENT_MEMORY_SIDECAR = JSON.stringify({ command: process.execPath, args: [FAKE_SIDECAR], env: { FAKE_SIDECAR_STATE: join(stand.dir, "fake.json") } });
    writeFileSync(join(stand.dir, "fake.json"), JSON.stringify({ memories: [], canonical: [], seq: 1 }));
    stand.svc.start();
    stand.svc.armAutoInstall();
    assert.equal(stand.sc.calls.install.length, 0);
  } finally {
    delete process.env.FILAMENT_MEMORY_SIDECAR;
    await stand.done();
  }
  // (fails before: no — added for the mutants that dropped the guard's two halves) an engine installed since memory
  // started (another Filament on the same data folder finished its install first) is not installed again
  const meanwhile = make();
  try {
    meanwhile.svc.start();
    meanwhile.sc.installed = true;
    meanwhile.svc.armAutoInstall();
    assert.equal(meanwhile.sc.calls.install.length, 0);
  } finally {
    await meanwhile.done();
  }
  // a pressed Install running when memory comes on: that one job only, and memory's own try is still to come
  const pressed = make({ enabled: false });
  try {
    pressed.svc.start();
    pressed.svc.armAutoInstall();
    const job = pressed.svc.install();
    pressed.cfg.memory.enabled = true;
    pressed.svc.start();
    assert.equal(pressed.sc.calls.install.length, 1, "the pressed one only");
    pressed.sc.pending[0].reject(new Error("no network"));
    await job.done.catch(() => {});
    await tick();
    pressed.svc.openedWith = null;
    pressed.svc.start(); // memory reopened (a settings save)
    assert.equal(pressed.sc.calls.install.length, 2, "the pressed one failed: memory tries once by itself");
    assert.equal(engineJobs(pressed.svc).at(-1).auto, true);
  } finally {
    await pressed.done();
  }
});

test("an install by itself that fails is not tried again in the run, and comes to find you as an alert; a pressed Install that fails raises none", async () => {
  const t = make();
  try {
    /** @type {any[]} */
    const alerts = [];
    t.svc.onAlert = (kind, text, key) => alerts.push({ kind, text, key });
    t.svc.start();
    t.svc.armAutoInstall();
    const [job] = engineJobs(t.svc);
    t.sc.pending[0].reject(new Error("memory engine uv: download failed: getaddrinfo ENOTFOUND github.com\nmore lines"));
    await job.done.catch(() => {});
    await tick();
    assert.deepEqual(alerts, [{ kind: "memory", text: "the memory engine did not install: memory engine uv: download failed: getaddrinfo ENOTFOUND github.com; memory runs on the archive alone (Install on the Memory page tries again)", key: `memory-install:${job.id}` }]);
    assert.deepEqual(t.svc.engineNow(), { state: "missing", error: "memory engine uv: download failed: getaddrinfo ENOTFOUND github.com" });
    t.svc.openedWith = null;
    t.svc.start(); // memory reopened (a settings save)
    assert.equal(t.sc.calls.install.length, 1, "not tried again in this run");
    const pressed = t.svc.install();
    t.sc.pending[1].reject(new Error("boom"));
    await pressed.done.catch(() => {});
    await tick();
    assert.equal(alerts.length, 1, "the person who pressed it watches it fail");
  } finally {
    await t.done();
  }
});

// (fails before: yes — an engine job had no stop, and its steps a clock instead: HarnessV3-FailurePoints FP-D3)
test("the person stops an engine install under way: its steps are told, the job fails where it stopped, and one by itself raises no alert", async () => {
  const t = make();
  try {
    /** @type {any[]} */
    const alerts = [];
    t.svc.onAlert = (kind, text, key) => alerts.push({ kind, text, key });
    t.svc.start();
    t.svc.armAutoInstall();
    const [job] = engineJobs(t.svc);
    const { signal } = t.sc.calls.install[0];
    assert.equal(signal.aborted, false);
    // (fails before: yes — HarnessV4_Tasks U1: the job's record said neither, so no panel could offer the stop, and a
    // stopped job read as a failed one)
    assert.deepEqual([job.stoppable, job.stopped], [true, undefined], "its record says it can be stopped");
    assert.equal(t.svc.stopJob("install-nope"), false, "no such job");
    assert.equal(t.svc.stopJob(job.id), true);
    assert.equal(signal.aborted, true, "the install's steps are told");
    t.sc.pending[0].reject(Object.assign(new Error("memory engine install aborted during python"), { aborted: true }));
    await job.done.catch(() => {});
    await tick();
    assert.deepEqual([job.status, job.error, job.stopped], ["error", "memory engine install aborted during python", true], "and that the person stopped it");
    assert.deepEqual(alerts, [], "the person stopped it: no alert comes to find them");
    assert.equal(t.svc.stopJob(job.id), false, "it runs no longer");
    // A job that fails by itself, and one of another kind: neither says stopped, nor that it can be.
    const own = t.svc.startJob("learn-backfill", async () => { throw new Error("boom"); });
    await own.done.catch(() => {});
    assert.deepEqual([own.status, own.error, own.stoppable, own.stopped], ["error", "boom", undefined, undefined]);
  } finally {
    await t.done();
  }
});

test("one engine job at a time: Install while one runs gives that one, Uninstall refuses; an Uninstall is respected for the rest of the run", async () => {
  const t = make();
  try {
    t.svc.start();
    t.svc.armAutoInstall();
    const [job] = engineJobs(t.svc);
    assert.equal(t.svc.install(), job);
    await assert.rejects(t.svc.uninstall(), /the memory engine is installing: wait for it to finish/);
    assert.equal(t.sc.calls.uninstall, 0);
    assert.equal(t.sc.calls.install.length, 1);
    t.sc.pending[0].resolve();
    await job.done;
  } finally {
    await t.done();
  }
  // installed at start, removed by the person: the run installs nothing by itself
  const u = make();
  try {
    u.sc.installed = true;
    u.svc.start();
    u.svc.armAutoInstall();
    await u.svc.uninstall();
    assert.equal(u.sc.calls.uninstall, 1);
    assert.equal(u.sc.calls.install.length, 0, "the Uninstall stands until the next start");
  } finally {
    await u.done();
  }
});

// (fails before: yes — the status said only whether a bundle served the settings' engine, and an Install without one
// downloaded; an engine could be updated)
test("the status says whether the bundle that came with Filament is here, why not, and whether the engine installed is its own; with none, an Install is refused before anything is touched; nothing updates an engine", async () => {
  const t = make();
  try {
    assert.equal("update" in t.svc, false, "no engine is ever updated");
    t.sc.bundled = false;
    t.svc.start();
    const none = (await t.svc.status()).engine.bundle;
    assert.deepEqual(none, { ready: false, why: `this Filament has no memory engine bundle for win32-x64 in ${join(t.dir, "bundles")}: reinstall Filament, or in a checkout build it with npm run engine:bundle`, current: false });
    assert.equal(t.sc.looks.at(-1)[0], join(t.dir, "bundles"), "the bundles' folder is the one looked in");
    const refused = t.svc.install();
    await assert.rejects(refused.done, (/** @type {any} */ e) => e.message === none.why);
    assert.equal(t.sc.calls.install.length, 0, "the installer is never reached");
    assert.deepEqual(t.svc.engineNow(), { state: "missing", error: null, why: none.why }, "and why none can be installed");
    t.sc.bundled = true;
    assert.deepEqual((await t.svc.status()).engine.bundle, { ready: true, why: null, current: false });
    const job = t.svc.install();
    assert.equal(t.sc.calls.install[0].bundle, join(t.dir, "bundles"));
    t.sc.pending[0].resolve();
    await job.done;
    assert.deepEqual((await t.svc.status()).engine.bundle, { ready: true, why: null, current: true }, "the engine installed is the bundle's");
    t.sc.bundle = { id: "b2", mnemosyne: "3.15.1" };
    assert.deepEqual((await t.svc.status()).engine.bundle, { ready: true, why: null, current: false }, "a new release's bundle: the engine installed is another's");
  } finally {
    await t.done();
  }
});

// (fails before: yes — an engine installed was never touched again: a new release's bundle went unused, and the engine a
// download put in ran on)
test("armed, an engine this release's bundle did not put in gives way to it: stopped, its process ended before the install, memory on the archive alone meanwhile, the release's started after; the same Mnemosyne needs no backup", async () => {
  const t = make();
  try {
    t.sc.installed = true;
    t.sc.engine = { source: "download", bundleId: "", mnemosyne: "3.15.1" };
    t.svc.start();
    const old = t.svc.store;
    assert.ok(old, "the engine installed runs");
    /** @type {any[]} */
    const backups = [];
    t.svc.backups.run = async (o) => (backups.push(o), { dir: "x" });
    t.svc.armAutoInstall();
    const [job] = engineJobs(t.svc);
    assert.equal(job.auto, true);
    await until(() => t.sc.calls.install.length === 1, "the install");
    assert.deepEqual(t.sc.order, ["stop", "ended", "install"], "the old engine's process ended before the install began");
    assert.equal(old.closed, true, "closed for good: nothing that still holds it starts it again");
    assert.equal(t.svc.store, null, "memory runs on the archive alone while its engine is replaced");
    assert.ok(t.svc.archive && t.svc.brain, "the archive and recall stay open");
    assert.deepEqual(backups, [], "the same Mnemosyne: no backup");
    assert.deepEqual(t.svc.engineNow(), { state: "installing", percent: 0, source: null, auto: true });
    t.svc.openedWith = null;
    t.svc.start(); // memory reopened meanwhile (a settings save) does not start the engine being replaced
    assert.equal(t.svc.store, null);
    assert.equal(t.sc.engines.length, 1, "no engine was made for it");
    t.sc.pending[0].resolve();
    await job.done;
    assert.ok(t.svc.store && t.svc.store !== old, "the release's engine is started");
    assert.deepEqual(t.svc.engineNow(), { state: "ready", source: "bundle" });
    t.svc.openedWith = null;
    t.svc.start();
    assert.equal(engineJobs(t.svc).length, 1, "once: the release's engine is its own");
  } finally {
    await t.done();
  }
  // Another release's bundle put it in: the same.
  const other = make();
  try {
    other.sc.installed = true;
    other.sc.engine = { source: "bundle", bundleId: "b0", mnemosyne: "3.15.1" };
    other.svc.start();
    other.svc.backups.run = async () => ({ dir: "x" });
    other.svc.armAutoInstall();
    assert.equal(engineJobs(other.svc).length, 1);
    await until(() => other.sc.calls.install.length === 1, "the install");
    other.sc.pending[0].resolve();
    await engineJobs(other.svc)[0].done;
  } finally {
    await other.done();
  }
  // No bundle here (a checkout that has not built one), the engine is the release's own, or memory.engine.autoInstall is
  // off: the engine installed stays as it is.
  for (const [what, set] of /** @type {[string, (t: any) => void][]} */ ([
    ["no bundle", (x) => (x.sc.bundled = false)],
    ["the release's own", (x) => (x.sc.engine = { source: "bundle", bundleId: "b1", mnemosyne: "3.15.1" })],
    ["autoInstall off", (x) => (x.cfg.memory.engine = { autoInstall: false })],
  ])) {
    const s = make();
    try {
      s.sc.installed = true;
      s.sc.engine = { source: "download", bundleId: "", mnemosyne: "3.15.1" };
      set(s);
      s.svc.start();
      s.svc.armAutoInstall();
      assert.deepEqual([engineJobs(s.svc).length, s.sc.order], [0, []], what);
      assert.ok(s.svc.store, `${what}: the engine runs on`);
    } finally {
      await s.done();
    }
  }
});

// (fails before: yes — a release's first start began making the vectors again on the engine its install, armed seconds
// later once the server listened, replaced: the install stopped it part way, and the log said the reindex failed)
test("an engine about to give way to this release's makes no vectors at its start; the release's own makes them at its own", async () => {
  for (const [what, set, made] of /** @type {[string, (t: any) => void, number][]} */ ([
    ["another release's, the bundle here", () => {}, 0],
    ["the release's own", (x) => (x.sc.engine = { source: "bundle", bundleId: "b1", mnemosyne: "3.15.1" }), 1],
    ["no bundle", (x) => (x.sc.bundled = false), 1],
    ["autoInstall off", (x) => (x.cfg.memory.engine = { autoInstall: false }), 1],
  ])) {
    const t = make();
    try {
      t.sc.installed = true;
      t.sc.engine = { source: "bundle", bundleId: "b0", mnemosyne: "3.15.1" };
      set(t);
      let reindexed = 0;
      const engine = /** @type {any} */ (t.sc.MemoryEngine.prototype);
      engine.ensure = () => Promise.resolve({});
      engine.status = () => ({ state: "ready", hello: { embeddings: true, embeddingModel: "M", counts: { working: 2 } } });
      engine.reindex = async () => (reindexed++, {});
      t.svc.start(); // not armed yet, as at a real start
      await t.svc.engineStart;
      await t.svc.reembedEngine();
      assert.equal(reindexed, made, what);
      if (made) continue;
      t.svc.backups.run = async () => ({ dir: "x" });
      t.svc.armAutoInstall();
      await until(() => t.sc.calls.install.length === 1, "the install");
      t.sc.pending[0].resolve();
      await engineJobs(t.svc)[0].done;
      await t.svc.engineStart;
      await t.svc.reembedEngine();
      assert.equal(reindexed, 1, "the release's engine makes them at its start");
      assert.equal(t.svc.archive?.schemaMetaGet("engineVectors")?.model, "M");
    } finally {
      await t.done();
    }
  }
});

// (fails before: yes — nothing stood between a new Mnemosyne and the database it may change as it opens)
test("an engine that changes Mnemosyne version backs memory up first, to memory's backups folder or the data folder's; a backup that fails leaves the engine as it was, running, and says so", async () => {
  const t = make();
  try {
    t.sc.installed = true;
    t.sc.engine = { source: "bundle", bundleId: "b0", mnemosyne: "3.14.0" };
    t.svc.start();
    /** @type {any[]} */
    const backups = [];
    t.svc.backups.run = async (o) => (t.sc.order.push("backup"), backups.push(o), { dir: join(t.dir, "memory-backups", "b") });
    t.svc.armAutoInstall();
    const [job] = engineJobs(t.svc);
    await until(() => t.sc.calls.install.length === 1, "the install");
    assert.deepEqual(backups, [{ reason: "engine-change", folder: join(t.dir, "memory-backups") }], "no backups folder set: the data folder's");
    assert.deepEqual(t.sc.order, ["backup", "stop", "ended", "install"]);
    assert.ok(job.progress.some((/** @type {any} */ p) => p.step === "backup" && /from mnemosyne 3\.14\.0 to 3\.15\.1/.test(p.message)));
    t.sc.pending[0].resolve();
    await job.done;
  } finally {
    await t.done();
  }
  const f = make({ backups: { folder: "Z:/mine" } });
  try {
    /** @type {any[]} */
    const alerts = [];
    f.svc.onAlert = (kind, text) => alerts.push(text);
    f.sc.installed = true;
    f.sc.engine = { source: "download", bundleId: "", mnemosyne: "3.14.0" };
    f.svc.start();
    const old = f.svc.store;
    /** @type {any[]} */
    const asked = [];
    f.svc.backups.run = async (o) => {
      asked.push(o?.folder);
      throw new Error("Z:/mine is not there");
    };
    f.svc.armAutoInstall();
    const [job] = engineJobs(f.svc);
    await assert.rejects(job.done, /memory was not backed up before its engine changed, so the engine was left as it is: Z:\/mine is not there/);
    await tick();
    assert.deepEqual(asked, ["Z:/mine"], "memory's backups folder, where one is set");
    assert.deepEqual([f.sc.order, f.sc.calls.install.length], [[], 0], "nothing stopped, nothing installed");
    assert.equal(f.svc.store, old, "the engine installed runs on");
    assert.deepEqual(alerts, ["the memory engine this Filament came with did not go in: memory was not backed up before its engine changed, so the engine was left as it is: Z:/mine is not there; the one installed before keeps running (Install on the Memory page tries again)"]);
  } finally {
    await f.done();
  }
  // (fails before: yes — the Hunter's find) The new bundle is found damaged before anything is touched: the old engine,
  // still whole, is started again, and the alert says it runs on.
  const d = make();
  try {
    /** @type {any[]} */
    const alerts = [];
    d.svc.onAlert = (kind, text) => alerts.push(text);
    d.sc.installed = true;
    d.sc.engine = { source: "download", bundleId: "", mnemosyne: "3.15.1" };
    d.svc.start();
    const old = d.svc.store;
    d.svc.armAutoInstall();
    const [job] = engineJobs(d.svc);
    await until(() => d.sc.calls.install.length === 1, "the install");
    assert.equal(d.svc.store, null);
    const damaged = "memory engine uv: the memory engine bundle at C:\\b is damaged: uv.exe is missing; reinstall Filament, or in a checkout build it again with npm run engine:bundle";
    d.sc.pending[0].reject(Object.assign(new Error(damaged), { untouched: true }));
    await job.done.catch(() => {});
    await tick();
    assert.ok(d.svc.store && d.svc.store !== old, "the engine installed is started again");
    assert.deepEqual(d.svc.engineNow(), { state: "ready", source: "download", kept: true }, "the one before runs on: the install over it did not go in");
    assert.deepEqual(alerts, [`the memory engine this Filament came with did not go in: ${damaged}; the one installed before keeps running (Install on the Memory page tries again)`]);
  } finally {
    await d.done();
  }
  // The install itself fails once the old engine is gone: memory goes on, on the archive alone, and says so.
  const g = make();
  try {
    /** @type {any[]} */
    const alerts = [];
    g.svc.onAlert = (kind, text) => alerts.push(text);
    g.sc.installed = true;
    g.sc.engine = { source: "download", bundleId: "", mnemosyne: "3.15.1" };
    g.svc.start();
    g.svc.armAutoInstall();
    const [job] = engineJobs(g.svc);
    await until(() => g.sc.calls.install.length === 1, "the install");
    g.sc.pending[0].reject(new Error("memory engine venv: uv exited with code 2"));
    await job.done.catch(() => {});
    await tick();
    assert.equal(g.svc.store, null);
    assert.ok(g.svc.archive && g.svc.brain);
    assert.deepEqual(alerts, ["the memory engine did not install: memory engine venv: uv exited with code 2; memory runs on the archive alone (Install on the Memory page tries again)"]);
  } finally {
    await g.done();
  }
});

test("a half-built engine is never started: a venv whose install did not finish is no engine", async () => {
  // The real installer's state: the venv's Python is there (it is made at 40%), engine.json says the install failed.
  const dir = tmp();
  const eng = join(dir, "memory-engine");
  const py = WIN ? join(eng, "venv", "Scripts", "python.exe") : join(eng, "venv", "bin", "python");
  mkdirSync(dirname(py), { recursive: true });
  writeFileSync(py, "");
  writeFileSync(join(eng, "engine.json"), JSON.stringify({ installed: false, error: "memory engine package: uv pip exited with code 1\nlast lines" }));
  const svc = new MemoryService({ getConfig: () => ({ memory: { enabled: true, folder: join(dir, "m"), privacy: { encryptArchive: false } } }), dataDir: dir, log: () => {} });
  try {
    svc.start();
    assert.equal(svc.store, null, "nothing is started from a venv with no Mnemosyne in it");
    const now = /** @type {any} */ (svc.engineNow());
    assert.deepEqual([now.state, now.error], ["missing", "memory engine package: uv pip exited with code 1"]);
  } finally {
    try { await svc.shutdown(); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

test("through the server: armed only once it listens and only when asked; the engine's state on the events feed and its own route; the alert in the banner", async () => {
  const dataDir = tmp();
  const cfg = defaultConfig();
  assert.equal(cfg.memory.engine.autoInstall, true, "a fresh config installs memory's engine by itself");
  cfg.server.port = 0;
  cfg.server.inboundKeys = ["k"];
  cfg.observability.logFile = "";
  cfg.memory.folder = join(dataDir, "mem");
  cfg.memory.privacy = { ...(cfg.memory.privacy || {}), encryptArchive: false };
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  // A bundle for this machine, by its manifest (all memory reads before an install): what the checkout holds or not
  // is no part of this test.
  const savedBundle = process.env.FILAMENT_MEMORY_BUNDLE;
  const bundles = join(dataDir, "bundles");
  mkdirSync(join(bundles, `${process.platform}-${process.arch}`), { recursive: true });
  const sum = "0".repeat(64);
  writeFileSync(join(bundles, `${process.platform}-${process.arch}`, "manifest.json"), JSON.stringify({ format: 1, platform: process.platform, arch: process.arch, uv: "0.8.17", python: "3.12.11", mnemosyne: DEFAULT_VERSION, source: engineSource(DEFAULT_VERSION), embeddings: true, files: { [WIN ? "uv.exe" : "uv"]: sum, "requirements.txt": sum, "python/a.tar.gz": sum, "wheels/a.whl": sum, "fastembed/m.onnx": sum } }));
  process.env.FILAMENT_MEMORY_BUNDLE = bundles;
  /** @type {any} */
  let app = createApp(/** @type {any} */ ({ dataDir, overrides: { port: 0 }, autoInstall: true, onShutdown: () => {} }));
  try {
    /** @type {any[]} */
    const calls = [];
    app.memory.install = (/** @type {any} */ o) => (calls.push(o), null);
    assert.equal(calls.length, 0, "nothing before the server listens");
    const started = await app.start();
    assert.deepEqual(calls, [{ auto: true }], "armed at listen: memory is on and its engine missing");
    assert.deepEqual(started.engine, { state: "missing", error: null }, "start says where the engine stands");
    const url = `http://127.0.0.1:${started.port}`;
    const H = { "x-api-key": "k" };
    assert.deepEqual(await (await fetch(`${url}/api/memory/engine`, { headers: H })).json(), { state: "missing", error: null });
    // the events feed carries the engine's state
    const ctl = new AbortController();
    const res = await fetch(`${url}/api/events`, { headers: H, signal: ctl.signal });
    const reader = /** @type {ReadableStream<Uint8Array>} */ (res.body).getReader();
    let buf = "";
    const dec = new TextDecoder();
    const until = async (/** @type {(s: string) => boolean} */ ok) => {
      for (let i = 0; i < 50 && !ok(buf); i++) buf += dec.decode((await reader.read()).value, { stream: true });
    };
    await until((s) => s.includes('"hello"'));
    app.memory.onEngine({ state: "installing", percent: 40, source: "download", auto: true });
    await until((s) => s.includes('"engine"'));
    ctl.abort();
    const frame = buf.split("\n\n").map((f) => f.replace(/^data: /, "")).find((f) => f.includes('"engine"'));
    assert.deepEqual(JSON.parse(/** @type {string} */ (frame)), { type: "engine", engine: { state: "installing", percent: 40, source: "download", auto: true } });
    // an install by itself that failed is an alert
    app.memory.onAlert("memory", "the memory engine did not install: offline", "memory-install:x");
    const { alerts } = await (await fetch(`${url}/api/alerts`, { headers: H })).json();
    assert.ok(alerts.some((/** @type {any} */ a) => a.kind === "memory" && a.text === "the memory engine did not install: offline"), JSON.stringify(alerts));
    // (fails before: yes — no route stopped an engine job: HarnessV3-FailurePoints FP-D3) The person's stop, by the job's id.
    app.memory.job = (/** @type {string} */ id) => (id === "install-x" ? { id } : null);
    /** @type {string[]} */
    const stops = [];
    app.memory.stopJob = (/** @type {string} */ id) => (stops.push(id), true);
    const stop = (/** @type {string} */ id) => fetch(`${url}/api/memory/jobs/${id}/stop`, { method: "POST", headers: H });
    assert.deepEqual(await (await stop("install-x")).json(), { stopped: true });
    assert.equal((await stop("nope")).status, 404);
    assert.deepEqual(stops, ["install-x"]);
    // (fails before: yes — HarnessV4_Tasks U1: no route restarted the engine) The person's restart: what it cut, or
    // 409 with why there is none to restart.
    const restart = () => fetch(`${url}/api/memory/engine/restart`, { method: "POST", headers: H, body: "{}" });
    app.memory.restartEngine = async () => ({ restarted: true, cut: 2, state: "ready" });
    assert.deepEqual(await (await restart()).json(), { restarted: true, cut: 2, state: "ready" });
    app.memory.restartEngine = async () => ({ restarted: false, why: "memory is off: no engine runs" });
    const refused = await restart();
    assert.deepEqual([refused.status, await refused.json()], [409, { error: "memory is off: no engine runs" }]);
    app.memory.restartEngine = async () => { throw new Error("hello failed: no module named mnemosyne"); };
    const failed = await restart();
    assert.deepEqual([failed.status, await failed.json()], [500, { error: "hello failed: no module named mnemosyne" }], "one that does not come back says why");
  } finally {
    await app.stop();
  }
  // not asked: nothing is armed
  app = createApp(/** @type {any} */ ({ dataDir, overrides: { port: 0 }, onShutdown: () => {} }));
  try {
    /** @type {any[]} */
    const calls = [];
    app.memory.install = (/** @type {any} */ o) => (calls.push(o), null);
    await app.start();
    assert.equal(calls.length, 0);
  } finally {
    await app.stop();
  }
  // (fails before: yes — the second Hunter's find: with no bundle, a job that could only fail ran at every start, and its
  // alert sent the person to an Install no page offers) Nothing to install from: no job; the alert and the engine say why.
  process.env.FILAMENT_MEMORY_BUNDLE = join(dataDir, "no-bundles");
  app = createApp(/** @type {any} */ ({ dataDir, overrides: { port: 0 }, autoInstall: true, onShutdown: () => {} }));
  try {
    /** @type {any[]} */
    const calls = [];
    app.memory.install = (/** @type {any} */ o) => (calls.push(o), null);
    const started = await app.start();
    const why = `this Filament has no memory engine bundle for ${process.platform}-${process.arch} in ${join(dataDir, "no-bundles")}: reinstall Filament, or in a checkout build it with npm run engine:bundle`;
    assert.deepEqual(calls, [], "no job that can only fail");
    assert.deepEqual(started.engine, { state: "missing", error: null, why });
    const { alerts } = await (await fetch(`http://127.0.0.1:${started.port}/api/alerts`, { headers: { "x-api-key": "k" } })).json();
    assert.deepEqual(alerts.filter((/** @type {any} */ a) => a.kind === "memory").map((/** @type {any} */ a) => [a.id, a.text]), [["memory-no-bundle", `memory's engine isn't installed, and can't be: ${why}; memory runs on the archive alone`]]);
  } finally {
    await app.stop();
    if (savedBundle === undefined) delete process.env.FILAMENT_MEMORY_BUNDLE;
    else process.env.FILAMENT_MEMORY_BUNDLE = savedBundle;
    await removeDirs(dataDir);
  }
  // (fails before: no — written after the CLI's lines) The CLI is the one maker that asks, and says so as it starts.
  const bin = readFileSync("bin/filament.js", "utf8");
  // (the call sits in a try since HarnessV3-Native NA2: a config that does not read fails in one line)
  // (telemetry: true since the usage stats: the CLI is also the one maker that sends them, test/telemetry.test.js)
  assert.match(bin, /\bapp = createApp\(\{ dataDir, overrides: \{[^}]*\}, autoInstall: true, supervisor(?:, telemetry: true)? \}\);/, "the CLI arms the install");
  assert.match(bin, /if \(engine\?\.state === "installing"\) console\.log\("  memory      : installing its engine in the background; the console shows how far it is"\);/);
});

// (fails before: yes — HarnessV4_Tasks U1; HarnessV3-FailurePoints §14.4: the route stood since FP-D3 and no page
// called it — an install with no clock, stuck on a download, could be ended only from a terminal)
test("the dashboard's job panel: Stop while an engine job that can be stopped runs, and one the person stopped reads stopped, never failed (source contract)", () => {
  const app = readFileSync("src/ui/app.js", "utf8");
  const panel = app.slice(app.indexOf("function memJobPanel(job, onDone) {"), app.indexOf("// Get started's facts"));
  assert.match(panel, /const stop = async \(\) => \{ stopping = true; draw\(shown\); try \{ const r = await api\(`\/memory\/jobs\/\$\{encodeURIComponent\(job\.id\)\}\/stop`, \{ method: "POST" \}\); if \(!r\?\.stopped\) \{ stopping = false; toast\("It had ended already"\); \} \} catch \(e\) \{ stopping = false; draw\(shown\); toast\(e\.message, "err"\); \} \};/);
  assert.match(panel, /!done && !err && j\.stoppable \? h\("button", \{ class: "sm", disabled: stopping \? "" : null, title: "[^"]+", onclick: stop \}, stopping \? "Stopping…" : "Stop"\) : null\)/);
  assert.match(panel, /stopped = err && !!j\.stopped;/);
  assert.match(panel, /: stopped \? h\("span", \{ class: "pill" \}, "stopped"\) : err \? h\("span", \{ class: "pill err" \}, "failed"\)/);
  assert.match(panel, /stopped \? h\("span", \{ class: "muted" \}, `You stopped it\$\{cur \? ` at its \$\{cur\} step` : ""\}\. Start it again when you want\.`\) : err \|\| refused \?/);
  assert.match(panel, /: j\.stopped \? `\$\{titleFor\(j\.kind\)\}: stopped` : `\$\{titleFor\(j\.kind\)\} failed: /);
});

// (fails before: yes — HarnessV4_Tasks U1: the service had no restart of its engine)
test("the person restarts the engine: its calls in flight are cut and it is back; none to restart says why — an install running, no engine, memory off", async () => {
  const t = make();
  try {
    t.svc.start();
    assert.deepEqual(await t.svc.restartEngine(), { restarted: false, why: "the memory engine is not installed: there is none to restart" });
    /** @type {string[]} */
    const did = [];
    t.svc.store = /** @type {any} */ ({ restart: async () => (did.push("restart"), { cut: 2, pid: 41 }), status: () => ({ state: "ready" }), stop() {} });
    assert.deepEqual(await t.svc.restartEngine(), { restarted: true, cut: 2, state: "ready" });
    t.svc.armAutoInstall();
    const job = t.svc.install();
    assert.deepEqual(await t.svc.restartEngine(), { restarted: false, why: "the memory engine is installing: its job's Stop ends that" });
    assert.deepEqual(did, ["restart"], "never under an install");
    t.sc.pending[t.sc.pending.length - 1].reject(Object.assign(new Error("memory engine install aborted during uv"), { aborted: true }));
    await job.done.catch(() => {});
    t.svc.store = null;
    t.cfg.memory.enabled = false;
    assert.deepEqual(await t.svc.restartEngine(), { restarted: false, why: "memory is off: no engine runs" });
  } finally {
    await t.done();
  }
});

// (fails before: yes — HarnessV4_Tasks U1: no page offered it)
test("the pages offer Restart where the engine shows: Memory's engine controls while it is on and installed, and the Live tab's engine panel (source contract)", async () => {
  const { RESTART_WORDS, restartEngine } = await import("../src/ui/lib/engine.js");
  assert.match(RESTART_WORDS, /^End the engine's process and start it again — for an engine that hangs: /);
  /** @type {any[]} */
  const said = [];
  const toast = (/** @type {string} */ words, kind = "ok") => { said.push([words, kind]); };
  /** @type {any[]} */
  const asked = [];
  assert.equal(await restartEngine({ api: async (path, init) => (asked.push([path, init.method]), { restarted: true, cut: 2, state: "ready" }), toast }), true);
  assert.equal(await restartEngine({ api: async () => ({ restarted: true, cut: 1 }), toast }), true);
  assert.equal(await restartEngine({ api: async () => ({ restarted: true, cut: 0 }), toast }), true);
  assert.equal(await restartEngine({ api: async () => { throw new Error("memory is off: no engine runs"); }, toast }), false);
  assert.deepEqual([asked, said], [[["/memory/engine/restart", "POST"]], [
    ["Memory engine restarted — 2 calls in flight ended", "ok"],
    ["Memory engine restarted — 1 call in flight ended", "ok"],
    ["Memory engine restarted", "ok"],
    ["The memory engine was not restarted: memory is off: no engine runs", "err"],
  ]]);
  const page = readFileSync("src/ui/pages/memory.js", "utf8");
  assert.match(page, /e\.installed && st\.enabled \? h\("button", \{ class: "sm", disabled: running \? "" : null, title: RESTART_WORDS, onclick: async \(\/\*\* @type \{any\} \*\/ ev\) => \{ const b = ev\.currentTarget; b\.disabled = true; b\.textContent = "Restarting…"; await restartEngine\(\{ api, toast \}\); state\.memStatus = null; drawCtl\(\); \} \}, "Restart"\) : null,/);
  const app = readFileSync("src/ui/app.js", "utf8");
  assert.match(app, /const restart = async \(\) => \{ state\.engineRestarting = true; draw\(\); await restartEngine\(\{ api, toast \}\); state\.engineRestarting = false; draw\(\); \};/);
  assert.match(app, /h\("button", \{ class: "sm", style: "margin-left:8px", disabled: state\.engineRestarting \? "" : null, title: RESTART_WORDS, onclick: restart \}, state\.engineRestarting \? "Restarting…" : "Restart engine"\)/);
});

// (fails before: yes — a fresh install's first chat, 10-27: the engine's install finishing started memory again, which
// closed the archive under the running turn, and the turn failed at its save with "database is not open")
test("the engine's install finishing mid-turn keeps the archive open: a turn that holds it saves; a new folder still opens anew", async () => {
  const t = make();
  try {
    t.svc.start();
    t.svc.armAutoInstall();
    const held = t.svc.archive; // what a turn running now holds
    assert.ok(held);
    const before = held.counts().chains;
    const [job] = engineJobs(t.svc);
    t.sc.pending[0].resolve();
    await job.done;
    await tick();
    assert.ok(t.svc.store, "the engine it installed is started");
    assert.equal(t.svc.archive, held, "the same archive, still open");
    assert.equal(held.counts().chains, before, "the turn that holds it reads and writes on");
    // Another folder is another archive: that one opens anew.
    t.cfg.memory.folder = join(t.dir, "elsewhere");
    t.svc.start();
    assert.notEqual(t.svc.archive, held);
    assert.throws(() => held.counts(), /not open/i, "the old one closed");
  } finally {
    await t.done();
  }
});

// (fails before: yes — the hunt of 10-28, likely the Claude Code chat whose permission requests failed while its engine
// was removed that day: Remove closed the archive every running turn holds while the engine's folder went, so the turn's
// next permission lookup read a closed database, "database is not open", and nothing was archived meanwhile)
test("Remove stops the engine alone: the archive a running turn holds stays open throughout, requests are archived meanwhile, and the engine's process has ended before its folder goes", async () => {
  const t = make();
  try {
    t.sc.installed = true;
    t.svc.start();
    const held = /** @type {any} */ (t.svc.archive); // what a turn running now holds: its permits read it, its saves write it
    const old = t.svc.store;
    assert.ok(held && old);
    /** @type {any[]} */
    const during = [];
    t.sc.uninstallEngine = async () => {
      t.sc.calls.uninstall++;
      t.sc.order.push("remove");
      during.push({ chains: held.counts().chains, brain: !!t.svc.brain, store: t.svc.store });
      t.sc.installed = false;
      return { ok: true, removed: true };
    };
    await t.svc.uninstall();
    assert.equal(old.closed, true, "the old engine is closed for good");
    assert.deepEqual(t.sc.order, ["stop", "ended", "remove"], "its process ended before its folder went");
    assert.deepEqual(during, [{ chains: 0, brain: true, store: null }], "the archive read and requests archived while the folder went, on the archive alone");
    assert.equal(t.svc.archive, held, "the same archive, open after");
    assert.equal(held.counts().chains, 0);
    assert.ok(t.svc.brain);
    assert.ok(t.logged.some(([, m]) => m === "memory: its engine is being removed; memory runs on the archive alone"), "said while it goes");
    assert.equal(t.logged.some(([, m]) => /being replaced/.test(m)), false, "a removal is no replacement");
  } finally {
    await t.done();
  }
});

// (fails before: yes — the hunt of 10-28: a removal that failed left memory stopped, archive closed, until a restart)
test("a Remove that fails leaves memory open on the same archive, saying why", async () => {
  const t = make();
  try {
    t.sc.installed = true;
    t.svc.start();
    const held = /** @type {any} */ (t.svc.archive);
    t.sc.uninstallEngine = async () => {
      throw new Error("EBUSY: resource busy or locked, rmdir 'memory-engine'");
    };
    await assert.rejects(t.svc.uninstall(), /EBUSY/);
    assert.equal(t.svc.archive, held);
    assert.equal(held.counts().chains, 0, "still open");
    assert.ok(t.svc.brain, "memory opened again");
  } finally {
    await t.done();
  }
});

// (fails before: yes — the hunt of 10-28: a same-version replacement at start stops the old engine while it still says
// hello, and memory logged "engine start failed …; it retries on the next request" for an engine nothing will retry)
test("an engine stopped as it starts is no failed start: nothing is logged as one", async () => {
  const t = make();
  try {
    t.sc.MemoryEngine.prototype.ensure = () => Promise.reject(Object.assign(new Error("memory engine stopped before it was ready"), { stopped: true }));
    t.sc.installed = true;
    t.svc.start();
    await t.svc.engineStart;
    assert.deepEqual(t.logged.filter(([, m]) => /engine start failed/.test(m)), []);
    // one that did fail still says so
    t.sc.MemoryEngine.prototype.ensure = () => Promise.reject(new Error("hello failed: boom"));
    t.svc.openedWith = null;
    t.svc.start();
    await t.svc.engineStart;
    assert.equal(t.logged.filter(([, m]) => /engine start failed \(hello failed: boom\); it retries on the next request/.test(m)).length, 1);
  } finally {
    await t.done();
  }
});

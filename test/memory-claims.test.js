// Claims that can't drift (HarnessV3-Memory M2): the unit-level proofs — an archive another build wrote refused, the outbox to
// the engine, every served line a claim, one port that knows who is asking, slots, provenance guardrails. Run through
// the real service, brain and archive, on the fake engine where an engine is involved.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as sqlite from "node:sqlite";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive, SCHEMA_VERSION } from "../src/archive.js";
import { EngineOutbox, OUTBOX_MAX_ATTEMPTS } from "../src/services/memory/outbox.js";
import { executeMemoryTool, deferMemoryResults, callAgentMemoryTool } from "../src/memory-tools.js";
import { memoryToolCtx, agentMemoryMcpTools, MEMORY_STARTING } from "../src/app/memory-tools.js";
import { memoryHandle } from "../src/services/memory/port.js";
import { slotOf, holdsValue } from "../src/services/memory/slots.js";
import { MemoryBrain } from "../src/services/memory/brain.js";
import { MemoryLearner, LEARN_PROMPT } from "../src/services/memory/learn.js";
import { memoryCommand } from "../src/app/commands/mem.js";
import { Assistant } from "../src/app/assistant.js";
import { MemoryService } from "../src/memory-service.js";
import { world } from "./fixtures/memory-world.mjs";
import { startApp, fakeUpstream } from "./helpers/app.js";

/** A temp folder whose handles are closed and which is removed even when an assertion fails (Windows locks open files). */
async function folder(prefix, body) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const open = [];
  const keep = (h) => (open.push(h), h);
  try {
    return await body(dir, keep);
  } finally {
    for (const h of open) h.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
const raw = (file, keep) => {
  const db = new sqlite.DatabaseSync(file);
  keep({ close: () => db.isOpen && db.close() });
  return db;
};
const versionOf = (db) => db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get().value;

// (fails before: yes — an older archive was copied aside and migrated in place; HarnessV3-AtHome AH-C1: this build
// reads its own version only)
test("AH-C1: an archive another build wrote is refused before anything in it is touched, in words that name npm run reset; this build's own opens", () =>
  folder("filament-otherbuild-", (dir, keep) => {
    const file = join(dir, "archive.db");
    const a0 = keep(new Archive({ file, key: null }));
    a0.items.add({ projectId: "p", kind: "fact", text: "Use tabs, not spaces.", status: "confirmed" });
    a0.close();
    const a1 = keep(new Archive({ file, key: null }));
    assert.deepEqual(a1.items.list({}).map((it) => it.text), ["Use tabs, not spaces."], "this build's own archive opens");
    a1.close();
    for (const other of [SCHEMA_VERSION - 1, SCHEMA_VERSION + 1]) {
      const db = raw(file, keep);
      db.exec(`UPDATE schema_meta SET value = '${other}' WHERE key = 'version'`);
      db.close();
      assert.throws(
        () => keep(new Archive({ file, key: null })),
        (/** @type {any} */ e) =>
          e.message.includes(`archive version ${other}; this build reads version ${SCHEMA_VERSION}`) &&
          e.message.includes("`npm run reset`") &&
          e.message.includes("it keeps how Filament is reached, your upstreams and your routes"),
      );
      const after = raw(file, keep);
      assert.equal(versionOf(after), String(other), "the version row is as it was");
      assert.deepEqual(after.prepare("SELECT text FROM items").all().map((r) => r.text), ["Use tabs, not spaces."], "nothing in the file was touched");
      after.close();
    }
    assert.ok(!existsSync(join(dir, "migrations")), "no copy is made");
    assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith(".bak")), [], "nor a copy beside it");
  }));

/** An archive at `version` holding one item, closed. @param {string} file @param {number} version @param {(h: any) => any} keep */
const archiveAt = (file, version, keep) => {
  const a = keep(new Archive({ file, key: null }));
  a.items.add({ projectId: "p", kind: "fact", text: "Use tabs, not spaces.", status: "confirmed" });
  a.close();
  const db = raw(file, keep);
  db.exec(`UPDATE schema_meta SET value = '${version}' WHERE key = 'version'`);
  db.close();
};

// (fails before: yes — the owner's of 11-05: every archive of another version was refused, so an update to Filament
// that changed the archive's layout cost a person their history: "start over")
test("an older archive its steps lead from opens upgraded: a copy of it as it was beside it, every step's change kept, this build's version on it", () =>
  folder("filament-upgrade-", (dir, keep) => {
    const file = join(dir, "archive.db");
    archiveAt(file, SCHEMA_VERSION - 2, keep);
    /** @type {number[]} */
    const ran = [];
    const upgrades = [SCHEMA_VERSION - 2, SCHEMA_VERSION - 1].map((from) => ({
      from,
      up: (/** @type {any} */ db) => {
        ran.push(from);
        db.prepare("INSERT INTO schema_meta (key, value) VALUES (?, ?)").run(`step-${from}`, "ran");
      },
    }));
    const a = keep(new Archive({ file, key: null, upgrades }));
    assert.deepEqual(ran, [SCHEMA_VERSION - 2, SCHEMA_VERSION - 1], "each step once, oldest first");
    assert.deepEqual(a.upgraded, { from: SCHEMA_VERSION - 2, copy: `${file}.v${SCHEMA_VERSION - 2}.bak` });
    assert.deepEqual(a.items.list({}).map((it) => it.text), ["Use tabs, not spaces."], "what it held opens");
    a.close();
    const after = raw(file, keep);
    assert.equal(versionOf(after), String(SCHEMA_VERSION));
    assert.equal(after.prepare("SELECT COUNT(*) AS n FROM schema_meta WHERE key LIKE 'step-%'").get().n, 2);
    after.close();
    const copy = raw(`${file}.v${SCHEMA_VERSION - 2}.bak`, keep);
    assert.equal(versionOf(copy), String(SCHEMA_VERSION - 2), "the copy is the file as it was");
    assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM schema_meta WHERE key LIKE 'step-%'").get().n, 0);
    copy.close();
    const again = keep(new Archive({ file, key: null, upgrades }));
    assert.equal(again.upgraded, null, "opened again, it is this build's: nothing runs");
    assert.equal(ran.length, 2);
  }));

test("a step that fails leaves the archive as it was, and the refusal says which upgrade failed and why; with a step missing it is refused as another build's", () =>
  folder("filament-upgrade-fails-", (dir, keep) => {
    const file = join(dir, "archive.db");
    archiveAt(file, SCHEMA_VERSION - 2, keep);
    const upgrades = [
      { from: SCHEMA_VERSION - 2, up: (/** @type {any} */ db) => db.exec("UPDATE items SET text = 'changed'") },
      { from: SCHEMA_VERSION - 1, up: () => { throw new Error("the step's own fault"); } },
    ];
    assert.throws(
      () => keep(new Archive({ file, key: null, upgrades })),
      (/** @type {any} */ e) => e.message.includes(`is archive version ${SCHEMA_VERSION - 2}, and its upgrade to version ${SCHEMA_VERSION} failed (the step's own fault): nothing of it was kept, and the file is as it was.`) && e.message.includes("`npm run reset`"),
    );
    const after = raw(file, keep);
    assert.equal(versionOf(after), String(SCHEMA_VERSION - 2), "the version row is as it was");
    assert.deepEqual(after.prepare("SELECT text FROM items").all().map((r) => r.text), ["Use tabs, not spaces."], "the first step's change went with the failed one");
    after.close();
    assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith(".bak")), [], "and no copy is left beside a file that is as it was");
    // No step from its version: refused as before, untouched.
    assert.throws(() => keep(new Archive({ file, key: null, upgrades: upgrades.slice(1) })), (/** @type {any} */ e) => e.message.includes(`archive version ${SCHEMA_VERSION - 2}; this build reads version ${SCHEMA_VERSION}`));
    assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith(".bak")), []);
  }));

// (fails before: yes — the refusal reached the log alone, and the Memory page could only say the archive "could not be
// opened")
test("AH-C1: memory with a refused archive runs without one, and its status says why in the archive's own words", () =>
  folder("filament-otherbuild-svc-", async (dir, keep) => {
    const memFolder = join(dir, "memory");
    mkdirSync(memFolder);
    const file = join(memFolder, "archive.db");
    keep(new Archive({ file, key: null })).close();
    const db = raw(file, keep);
    db.exec(`UPDATE schema_meta SET value = '${SCHEMA_VERSION - 1}' WHERE key = 'version'`);
    db.close();
    const cfg = { server: { port: 20398, inboundKeys: ["k"] }, memory: { enabled: true, folder: memFolder, engine: { autoInstall: false }, privacy: { encryptArchive: false } } };
    /** @type {[string, string][]} */
    const logged = [];
    const svc = new MemoryService({ getConfig: () => cfg, dataDir: dir, log: (level, msg) => logged.push([level, msg]), selfBase: () => "http://127.0.0.1:20398" });
    keep({ close: () => svc.stop() });
    svc.start();
    const st = await svc.status();
    assert.equal(st.archive, null, "no archive is open");
    assert.ok(
      st.archiveError?.includes(`archive version ${SCHEMA_VERSION - 1}; this build reads version ${SCHEMA_VERSION}`) && st.archiveError.includes("`npm run reset`"),
      String(st.archiveError),
    );
    assert.ok(logged.some(([level, msg]) => level === "error" && msg.includes(st.archiveError)), "the log says it too");
  }));

// (fails before: yes — the bug hunt of 10-30, MEMC-3: an archive another build wrote said to run `npm run reset`
// wherever Filament ran, and the installed app ships no scripts/ to run it with)
test("AH-C1: the refusal names a way to start over that exists where Filament runs: npm run reset from a checkout, memory's folder in the installed app", () =>
  folder("filament-startover-", async (dir, keep) => {
    const { startOverWords } = await import("../src/services/memory/archive.js");
    const app = join(dir, "resources", "app");
    mkdirSync(join(app, "src"), { recursive: true });
    const installed = startOverWords(app);
    assert.ok(!installed.includes("npm"), installed);
    assert.ok(installed.includes("Memory → Settings → Engine and folder"), installed);
    const checkout = join(dir, "checkout");
    mkdirSync(join(checkout, "scripts"), { recursive: true });
    writeFileSync(join(checkout, "scripts", "reset.mjs"), "");
    assert.match(startOverWords(checkout), /^Run `npm run reset` for a clean slate: it keeps how Filament is reached, your upstreams and your routes/);
    assert.equal(startOverWords(), startOverWords(checkout), "the checkout these tests run in has the script");
    const file = join(dir, "archive.db");
    keep(new Archive({ file, key: null })).close();
    const db = raw(file, keep);
    db.exec(`UPDATE schema_meta SET value = '${SCHEMA_VERSION - 1}' WHERE key = 'version'`);
    db.close();
    assert.throws(() => keep(new Archive({ file, key: null })), (/** @type {any} */ e) => e.message.endsWith(`this build reads version ${SCHEMA_VERSION}). ${startOverWords()}`));
  }));

// (fails before: yes — the bug hunt of 10-30: a secret.key that does not read threw out of memory's start before the try
// that keeps why the archive is shut, so the Memory page gave its generic hint and never the key's words)
test("AH-C1: a secret.key that does not read keeps the archive shut, and memory's status says why in the key's own words", () =>
  folder("filament-badkey-", async (dir, keep) => {
    writeFileSync(join(dir, "secret.key"), "not a key\n");
    const cfg = { server: { port: 20398, inboundKeys: ["k"] }, memory: { enabled: true, folder: join(dir, "memory"), engine: { autoInstall: false } } };
    /** @type {[string, string][]} */
    const logged = [];
    const svc = new MemoryService({ getConfig: () => cfg, dataDir: dir, log: (level, msg) => logged.push([level, msg]), selfBase: () => "http://127.0.0.1:20398" });
    keep({ close: () => svc.stop() });
    svc.start();
    const st = await svc.status();
    assert.equal(st.archive, null, "no archive is open");
    assert.match(String(st.archiveError), /secret\.key exists but is not a valid key \(expected 32 base64 bytes\)\. Restore it from a backup/);
    assert.ok(logged.some(([level, msg]) => level === "error" && msg.includes(st.archiveError)), "the log says it too");
  }));

// (fails before: yes — the clean slate kept the archive at version 16, so an archive an earlier build wrote at 16 opened
// and was read as this build writes, whatever its rows held; HarnessV3-AtHome AH-C1)
test("AH-C1: an archive written before the clean slate (version 16) is refused in words, whatever its rows hold", () =>
  folder("filament-otherbuild-16-", async (dir, keep) => {
    const memFolder = join(dir, "memory");
    mkdirSync(memFolder);
    const file = join(memFolder, "archive.db");
    keep(new Archive({ file, key: null })).close();
    const db = raw(file, keep);
    db.exec("UPDATE schema_meta SET value = '16' WHERE key = 'version'");
    // What an earlier build left behind: a pass a killed Filament never ended, from before a pass named its owner.
    db.prepare("INSERT INTO curator_runs (project_id, reason, model, started_at, detail_json) VALUES (?, ?, ?, ?, ?)").run(null, "nightly", "m", 1, "{}");
    db.close();
    const cfg = { server: { port: 20398, inboundKeys: ["k"] }, memory: { enabled: true, folder: memFolder, engine: { autoInstall: false }, privacy: { encryptArchive: false } } };
    const svc = new MemoryService({ getConfig: () => cfg, dataDir: dir, log: () => {}, selfBase: () => "http://127.0.0.1:20398" });
    keep({ close: () => svc.stop() });
    svc.start();
    const st = await svc.status();
    assert.equal(st.archive, null, "no archive is open");
    assert.ok(
      st.archiveError?.includes(`archive version 16; this build reads version ${SCHEMA_VERSION}`) && st.archiveError.includes("`npm run reset`"),
      String(st.archiveError),
    );
    const after = raw(file, keep);
    assert.equal(versionOf(after), "16", "the version row is as it was");
    assert.equal(after.prepare("SELECT COUNT(*) AS n FROM curator_runs WHERE ended_at IS NULL").get().n, 1, "nothing in the file was touched");
    after.close();
  }));

// (fails before: yes — with the archive refused, the commands and routes that need it said memory's folder "did not
// open (see the log)": the person was sent to the log, never told to run `npm run reset`)
test("AH-C1: with the archive refused, the commands and routes that need it say why in the archive's own words", async () => {
  const up = await fakeUpstream();
  const shim = await startApp({
    configure: (cfg, { dataDir }) => {
      cfg.upstreams = [{ id: "u", name: "u", type: "anthropic", baseUrl: up.url, apiKey: "k", enabled: true }];
      cfg.routes = [{ match: "m", upstream: "u", upstreamModel: "m", enabled: true }];
      const file = join(dataDir, "memory", "archive.db");
      new Archive({ file, key: null }).close();
      const db = new sqlite.DatabaseSync(file);
      db.exec("UPDATE schema_meta SET value = '16' WHERE key = 'version'");
      db.close();
    },
  });
  try {
    const why = (await (await shim.api("/api/memory/status")).json()).archiveError;
    assert.ok(why?.includes(`(archive version 16; this build reads version ${SCHEMA_VERSION}). Run \`npm run reset\``), String(why));
    // (fails before: yes — /goal said to send a normal message first, which makes no session while the archive is
    // refused) Memory's command, which an outside client's chat keeps; its others go to its model as typed.
    const r = await shim.post("/v1/messages", { model: "m", max_tokens: 64, messages: [{ role: "user", content: "/goal ship it" }] }, { "x-session-id": "refused" });
    const text = ((await r.json()).content || []).map((/** @type {any} */ b) => b.text || "").join("");
    assert.ok(text.endsWith(` ${why}`), `/goal ship it: ${text}`);
    // (fails before: no — a guard: in a chat Filament runs, here a call of its own on the loop's name, the commands
    // that need the archive say why in the archive's words)
    for (const command of ["/set loop.maxRounds 5", "/settings", "/subagent list", "/autofit"]) {
      const r = await shim.house("/v1/messages", { model: "agent/m", max_tokens: 64, messages: [{ role: "user", content: command }] }, { "x-session-id": "refused" });
      const text = ((await r.json()).content || []).map((/** @type {any} */ b) => b.text || "").join("");
      assert.ok(text.endsWith(` ${why}`), `${command}: ${text}`);
    }
    assert.equal(up.received.length, 0, "no command reached the model");
    for (const [method, path, body] of /** @type {[string, string, any][]} */ ([
      ["POST", "/api/sessions", { cwd: shim.dataDir, model: "m" }],
      ["GET", "/api/sessions/s1/requests", undefined],
      ["GET", "/api/memory/outcomes", undefined],
      // the harness sidebar's list and Home's "Where you left off"
      ["GET", "/api/memory/sessions?limit=5", undefined],
    ])) {
      const r = await shim.api(path, { method, body });
      const { error } = await r.json();
      assert.ok(r.status >= 500 && String(error).endsWith(why), `${method} ${path}: ${r.status} ${error}`);
    }
    // (fails before: yes — the memory routes that check for the archive themselves said "memory has not started")
    for (const [method, path, body] of /** @type {[string, string, any][]} */ ([
      ["GET", "/api/memory/claims/stream", undefined],
      ["POST", "/api/memory/items/i1/correct", { text: "The queue drains hourly." }],
      ["GET", "/api/memory/sessions/s1/turns/1/memory", undefined],
      ["GET", "/api/memory/inbox", undefined],
      ["GET", "/api/memory/curator/runs", undefined],
      ["GET", "/api/memory/claims/scopes", undefined],
      ["GET", "/api/memory/claims", undefined],
      ["GET", "/api/memory/claims/i1", undefined],
      ["GET", "/api/memory/dossier?project=p1", undefined],
    ])) {
      const r = await shim.api(path, { method, body });
      assert.deepEqual([r.status, (await r.json()).error], [503, why], `${method} ${path}`);
    }
  } finally {
    await shim.stop();
    await up.close();
  }
});


// ---------------------------------------------------------------------------------------------------
// M2-2 the outbox
// ---------------------------------------------------------------------------------------------------
/** A stand-in engine that records what it is sent and fails on cue: `down` (no kind: unreachable), `mnemosyne`
 * (it raised), `args` (it refuses the write as malformed). */
function stubEngine() {
  const sent = [];
  const fail = new Map();
  const call = async (op, args) => {
    sent.push({ op, args });
    const f = fail.get(op);
    if (f) {
      if (--f.times <= 0) fail.delete(op);
      throw Object.assign(new Error(`${op} failed`), f.kind === "down" ? {} : { kind: f.kind });
    }
    return op === "remember" ? { id: `m${sent.length}` } : { ok: true };
  };
  return {
    sent,
    fail,
    remember: (a) => call("remember", a),
    invalidate: (id, replacement_id) => call("invalidate", { id, replacement_id }),
    restore: (id) => call("restore", { id }),
  };
}

// (fails before: each writer called the engine itself, once; a write made while the engine was down was lost)
test("M2-2: the outbox sends one item's writes in order; an engine that is down stops the pass and is tried again after a backoff; a write it refuses, or keeps failing, is set aside and the rest go on", () =>
  folder("filament-outbox-", async (dir, keep) => {
    let t = 1_000_000;
    const a = keep(new Archive({ file: join(dir, "a.db"), key: null, now: () => t }));
    const store = stubEngine();
    const ob = new EngineOutbox({ archive: a, getStore: () => store, now: () => t });
    keep({ close: () => ob.stop() });
    const one = a.items.add({ projectId: "p", kind: "fact", text: "The API listens on 8080.", status: "confirmed", origin: "person" }).id;
    const two = a.items.add({ projectId: "p", kind: "rule", text: "Never push to main.", origin: "learner" }).id;
    store.fail.set("remember", { kind: "down", times: 1 });
    ob.enqueue(one, "mirror", { via: "test" });
    ob.enqueue(one, "invalidate", { replacement: two });
    ob.enqueue(two, "mirror", { via: "test" });
    await ob.drain();
    assert.deepEqual(store.sent.map((x) => x.op), ["remember"], "the engine was down: nothing after the first write was tried");
    assert.deepEqual(ob.status().waiting, 3);
    assert.equal(ob.status().retrying, 1);
    await ob.drain();
    assert.equal(store.sent.length, 1, "the backoff holds");
    t += 1_500;
    await ob.drain();
    assert.deepEqual(store.sent.map((x) => x.op).sort(), ["invalidate", "remember", "remember", "remember"]);
    const copyOf = (id) => store.sent.findLastIndex((x) => x.op === "remember" && x.args.metadata.item === id);
    const inv = store.sent.findIndex((x) => x.op === "invalidate");
    assert.ok(copyOf(one) > 0 && inv > copyOf(one), "one item's writes in the order they were made");
    const m1 = a.items.get(one).memory_id;
    assert.ok(m1 && a.items.get(two).memory_id);
    assert.deepEqual(store.sent[inv].args, { id: m1, replacement_id: `filament:i${two}` });
    assert.equal(store.sent[copyOf(one)].args.valid, true);
    assert.equal(store.sent[copyOf(one)].args.pin, true, "the user's word is pinned");
    assert.equal(store.sent[copyOf(two)].args.veracity, "inferred");
    assert.equal(ob.status().waiting, 0);
    // A write the engine refuses as malformed is set aside at once; the queue goes on.
    store.fail.set("restore", { kind: "args", times: 1 });
    ob.enqueue(one, "restore");
    ob.enqueue(two, "invalidate");
    await ob.drain();
    assert.equal(ob.status().dead, 1);
    assert.deepEqual(store.sent.slice(-2).map((x) => x.op), ["restore", "invalidate"]);
    // An engine that raises on one item's write holds that item back, not the others; past the last try, set aside.
    store.fail.set("invalidate", { kind: "mnemosyne", times: Infinity });
    ob.enqueue(one, "invalidate");
    ob.enqueue(one, "restore");
    ob.enqueue(two, "restore");
    await ob.drain();
    assert.deepEqual(store.sent.slice(-2).map((x) => x.op), ["invalidate", "restore"], "the other item went on");
    for (let i = 1; i < OUTBOX_MAX_ATTEMPTS; i++) {
      t += 700_000;
      await ob.drain();
    }
    assert.equal(store.sent.filter((x) => x.op === "invalidate").length, 2 + OUTBOX_MAX_ATTEMPTS, JSON.stringify(store.sent.map((x) => x.op)));
    assert.equal(ob.status().dead, 2, "set aside after its last try");
    assert.match(ob.status().lastError, /invalidate failed/);
    assert.equal(store.sent.at(-1).op, "restore", "and the item's next write went out after it");
    assert.equal(ob.status().waiting, 0);
  }));

// (fails before: a write the engine answered after memory stopped was recorded into the closed archive, and the pass
// rejected with "database is not open")
test("M2-2: an engine answer that comes after memory stops touches nothing; the write stays queued and goes out on the next start", async () => {
  // Each way the engine can answer late: a copy stored, a write it raised on, a restore of a copy it no longer has.
  for (const late of ["stored", "raised", "gone"]) {
    await folder("filament-outbox-stop-", async (dir, keep) => {
      const file = join(dir, "a.db");
      const a = new Archive({ file, key: null });
      let answer;
      const wait = () => new Promise((ok, no) => (answer = { ok, no }));
      const slow = { remember: wait, restore: wait };
      const ob = new EngineOutbox({ archive: a, getStore: () => slow });
      const id = a.items.add({ projectId: "p", kind: "fact", text: "The queue drains every minute.", status: "confirmed", origin: "person" }).id;
      if (late === "gone") a.items.setMemoryId(id, "m-old");
      a.outbox.add(id, late === "gone" ? "restore" : "mirror", { via: "filament-test" });
      const pass = ob.drain();
      await new Promise((r) => setImmediate(r));
      assert.ok(answer, `${late}: the write is in flight`);
      ob.stop();
      a.close();
      if (late === "stored") answer.ok({ id: "m-late" });
      else if (late === "raised") answer.no(Object.assign(new Error("remember failed"), { kind: "mnemosyne" }));
      else answer.ok({ ok: false });
      await assert.doesNotReject(pass, `${late}: the pass ends quietly`);
      const b = keep(new Archive({ file, key: null }));
      assert.equal(b.items.get(id).memory_id, late === "gone" ? "m-old" : null, `${late}: nothing recorded after the stop`);
      assert.deepEqual(b.outbox.status(), { waiting: 1, retrying: 0, dead: 0, oldestAt: b.outbox.status().oldestAt, lastError: null }, `${late}: the write is still queued, untried`);
      const store = stubEngine();
      const again = new EngineOutbox({ archive: b, getStore: () => store });
      keep({ close: () => again.stop() });
      await again.drain();
      assert.ok(b.items.get(id).memory_id, `${late}: sent on the next start`);
      assert.equal(b.outbox.status().waiting, 0);
    });
  }
});

// (fails before: an archive that failed under a running outbox rejected the background drain, an unhandled rejection
// that takes the proxy down)
test("M2-2: an archive that fails under the outbox is logged; the drain never rejects", () =>
  folder("filament-outbox-archive-", async (dir) => {
    const a = new Archive({ file: join(dir, "a.db"), key: null });
    const id = a.items.add({ projectId: "p", kind: "fact", text: "The cron runs at noon.", status: "confirmed", origin: "person" }).id;
    a.outbox.add(id, "mirror", {});
    const logged = [];
    const ob = new EngineOutbox({ archive: a, getStore: () => stubEngine(), log: (level, msg) => logged.push([level, msg]) });
    a.close(); // not stopped: the archive is gone under it
    try {
      await assert.doesNotReject(ob.drain());
      assert.equal(logged.length, 1, JSON.stringify(logged));
      assert.equal(logged[0][0], "warn");
      assert.match(logged[0][1], /the engine outbox stopped on an archive error \(database is not open\)/);
    } finally {
      ob.stop();
    }
  }));

// (fails before: the old engine copy of a retired item stayed valid when the engine was down at the retirement)
test("M2-2: a retirement made while the engine fails reaches it once it works again", () =>
  world({}, async (w) => {
    const { brain, archive } = w.svc;
    const a = await brain.remember("The staging database is postgres 15.", { kind: "fact", projectId: "q1", by: "person" });
    await w.settle();
    const engineId = archive.items.get(a.itemId).memory_id;
    assert.ok(engineId);
    w.failOps(["invalidate"]);
    assert.equal((await brain.forget(a.id, { by: "person", reason: "we moved to 16" })).ok, true);
    await w.settle();
    const row = () => w.engineRows().find((r) => r.id === engineId);
    assert.ok(!row().valid_until, "the engine failed: its copy is still valid");
    assert.equal(brain.outbox.status().waiting, 1);
    w.failOps([]);
    archive.db.prepare("UPDATE engine_outbox SET next_at = 0 WHERE done_at IS NULL").run(); // the backoff has passed
    await w.settle();
    assert.ok(row().valid_until, "the invalidate arrived");
    assert.equal(brain.outbox.status().waiting, 0);
  }));

// (fails before: the engine dedupes on content even onto a row it was told to invalidate, so a new claim with the text
// of a retired one got an engine copy that recall never serves)
test("M2-2: a copy that lands on an invalidated row of the same text makes that row valid", () =>
  world({}, async (w) => {
    const { brain, archive } = w.svc;
    const text = "The cache is redis on port 6380.";
    const a = await brain.remember(text, { kind: "fact", projectId: "q2", by: "person" });
    await w.settle();
    await brain.forget(a.id, { by: "person" });
    await w.settle();
    const b = await brain.remember(text, { kind: "fact", projectId: "q3", by: "person" });
    await w.settle();
    const row = archive.items.get(b.itemId).memory_id;
    assert.equal(row, archive.items.get(a.itemId).memory_id, "the engine deduped onto the old row");
    assert.ok(!w.engineRows().find((r) => r.id === row).valid_until, "and that row is valid again");
    const r = await brain.retrieve({ query: "cache redis port", projectId: "q3", mode: "search" });
    assert.ok(r.items.some((x) => x.id === b.id), JSON.stringify(r.items));
  }));

// (fails before: each writer wrote its own metadata, and none named the item, so a hit mapped back only by twin id)
test("M2-2: every copy Filament writes names its item: capture, the person's and the model's remember, a correction", () =>
  world({}, async (w) => {
    const { brain, archive } = w.svc;
    await w.session("a").remember("the release branch is cut every Monday");
    const p = await brain.remember("Logs live in var/log/app.", { kind: "fact", projectId: "q4", by: "person" });
    const m = JSON.parse(await executeMemoryTool(w.svc.scope({ role: "model", project: "q4" }), "filament_memory_remember", { text: "The repo uses pnpm workspaces.", kind: "fact" }));
    await w.settle();
    const c = await brain.correct(p.id, { text: "Logs live in var/log/filament.", reason: "renamed", by: "person" });
    await w.settle();
    const items = archive.items.list({ limit: 50 }).filter((it) => it.memory_id);
    assert.ok(items.length >= 4, JSON.stringify(items.map((i) => i.text)));
    const sent = w.ops().filter((o) => o.op === "remember");
    for (const it of items) {
      const copy = sent.find((o) => o.args.content === it.text);
      assert.ok(copy, `no copy sent for ${it.text}`);
      assert.equal(copy.args.metadata.item, it.id, it.text);
    }
    assert.ok([m.id, c.id].every(Boolean));
  }));

const num = (ref) => Number(String(ref).slice(1));

// (fails before: an engine row with no item behind it was served as `e:<id>`, with no status, so nothing Filament
// knew could retire it, and no trust but a guess)
test("M2-3: an engine row no claim stands behind is served as an imported claim, adopted once", () =>
  world({}, async (w) => {
    const { brain, archive, store } = w.svc;
    const row = await store.remember({ content: "The release train leaves every second Tuesday.", source: "fact", importance: 0.9, metadata: { kind: "fact" } });
    const search = () => brain.retrieve({ query: "release train every second Tuesday", projectId: null, mode: "search" });
    const hit = (await search()).items.find((x) => /release train/.test(x.text));
    assert.match(String(hit?.id), /^i\d+$/, "served as a claim");
    assert.equal(hit.trust, "imported");
    const it = archive.items.get(num(hit.id));
    assert.equal(it.origin, "import");
    assert.equal(it.status, "inferred");
    assert.equal(it.memory_id, row.id, "the row is its copy");
    assert.equal((await search()).items.find((x) => /release train/.test(x.text)).id, hit.id, "the same claim the next time");
    assert.equal(archive.items.list({ limit: 100 }).filter((x) => /release train/.test(x.text)).length, 1, "adopted once");
    const { seen } = await w.session("a").send("when does the release train leave?");
    assert.match(seen, new RegExp(`\\[${hit.id} fact · imported`), "the line a session sees");
  }));

// (fails before: a copy whose answer was never written down — memory stopped while it was with the engine — was served
// as an engine row with no status; and nothing checked that the item a row names is the one it copies)
test("M2-3: a copy whose id was never written down is its item's, by its text, and is served in the claim's words; an item a row names from another archive is not taken", () =>
  world({}, async (w) => {
    const { brain, archive, store } = w.svc;
    const own = archive.items.add({ projectId: "p1", kind: "rule", text: "Never force-push to main.", status: "confirmed", origin: "person" }).id;
    const copy = await store.remember({ content: "Never force-push to main.", source: "filament-rule", importance: 0.9, metadata: { item: own, kind: "rule", project: "p1" } });
    const foreign = await store.remember({ content: "Deploys freeze on Fridays.", source: "filament-rule", importance: 0.9, metadata: { item: own, kind: "rule", project: "p1" } });
    // A copy from before M2-2, whose metadata names no item, and whose item never had its id written down.
    const old = archive.items.add({ projectId: "p1", kind: "convention", text: "Branch names start with the ticket id.", status: "inferred", origin: "learner" }).id;
    const oldCopy = await store.remember({ content: "branch names start with the ticket ID", source: "filament-convention", importance: 0.7, metadata: { kind: "convention", project: "p1" } });
    const found = [];
    for (const query of ["never force-push to main", "deploys freeze on fridays", "branch names start with the ticket id"])
      found.push(...(await brain.retrieve({ query, projectId: "p1", mode: "search" })).items);
    const line = (re) => found.find((x) => re.test(x.text));
    assert.equal(line(/force-push/)?.id, `i${own}`, JSON.stringify(found));
    assert.equal(line(/force-push/).trust, "user said");
    assert.equal(archive.items.get(own).memory_id, copy.id, "the link is written down now");
    const f = line(/freeze/);
    assert.notEqual(f?.id, `i${own}`, "not the item it names");
    assert.equal(archive.items.get(num(f.id)).origin, "import");
    assert.equal(archive.items.get(num(f.id)).memory_id, foreign.id);
    assert.equal(line(/branch names/i)?.id, `i${old}`, "an old copy is its item's, by its text");
    assert.equal(line(/branch names/i).text, "Branch names start with the ticket id.", "and the claim's words are served, not the row's");
    assert.equal(archive.items.get(old).memory_id, oldCopy.id);
  }));

// (fails before: rows the engine held before Filament had claims stayed claimless until a search happened to hit them,
// and a copy a dismissal before M1 left valid stayed valid in the engine for good)
test("M2-3: at the first start every row the engine can serve gets a claim, once; a valid copy of a retired claim is invalidated", () =>
  world(
    {
      engineRows: [
        { id: "f1", content: "The office wifi is guest-5G.", source: "fact", importance: 0.5, scope: "global" },
        { id: "e1", content: "The staging database is restored nightly.", source: "fact", tier: "episodic", importance: 0.5, scope: "global" },
        { id: "s1", content: "Assistant runs in project 'test'.", source: "sleep_consolidation", tier: "episodic", importance: 0.6, scope: "global" },
        { id: "mm1", content: "[MEMORIA memoria_instructions] must not restart the runner", source: "memoria_memoria_instructions", importance: 0.5, scope: "global" },
      ],
    },
    async (w) => {
      const { archive } = w.svc;
      for (const id of ["f1", "e1"]) {
        const [it] = archive.items.byMemoryId(id);
        assert.equal(it?.origin, "import", id);
        assert.equal(it.status, "inferred");
      }
      assert.deepEqual(archive.items.byMemoryId("s1"), [], "the engine's own row is fenced, not adopted");
      assert.deepEqual(archive.items.byMemoryId("mm1"), [], "nor one it wrote that the fence leaves (recall never serves it)");
      const rec = archive.schemaMetaGet("engineAdoption");
      assert.equal(rec.rows, 3);
      assert.equal(rec.engineWritten, 1);
      assert.equal(rec.adopted, 2);
      assert.deepEqual(w.ops().filter((o) => o.op === "rows").map((o) => o.args.table), ["working", "episodic"]);
      assert.equal(await w.svc.adoptEngine(), null, "once");
      // A copy the dashboard dismissed before M1, in the archive alone: the next adoption (after an import) retires it.
      const a = await w.svc.brain.remember("The cache lives in redis on port 6380.", { kind: "fact", projectId: "p2", by: "person" });
      await w.settle();
      const engineId = archive.items.get(a.itemId).memory_id;
      archive.items.setStatus(a.itemId, "dismissed");
      archive.schemaMetaSet("engineAdoption", null);
      const again = await w.svc.adoptEngine();
      assert.equal(again.retired, 1, JSON.stringify(again));
      await w.settle();
      assert.ok(w.ops().some((o) => o.op === "invalidate" && o.args.id === engineId), "its copy invalidated, by its own id");
      assert.ok(w.engineRows().every((r) => !r.forgotten), "nothing deleted");
    },
  ));

// (fails before: an imported engine's rows had no claims, and the import said nothing of them)
test("M2-3: after an engine import, the restart adopts what was imported and the import says how many", () =>
  world({}, async (w) => {
    const src = join(w.dir, "other.db");
    const db = new sqlite.DatabaseSync(src);
    db.exec("CREATE TABLE working_memory (id TEXT PRIMARY KEY, content TEXT)");
    db.close();
    await w.withEngine(async () => {
      await w.svc.store.stop();
      w.setEngineRows([...w.engineRows(), { id: "x1", content: "The design system lives in packages/ui.", source: "fact", importance: 0.6, scope: "global" }]);
      const job = w.svc.import({ source: "mnemosyne", srcFile: src });
      await job.done;
      assert.equal(job.status, "done", String(job.error));
      assert.equal(job.result.adopted?.adopted, 1, JSON.stringify(job.result));
    });
    const [it] = w.svc.archive.items.byMemoryId("x1");
    assert.equal(it?.origin, "import");
  }));

// (fails before: yes — the bug hunt of 10-30, MEMR-2: the import stopped the engine without closing it, so a call that
// still held it — a turn's recall, the outbox — started it again over the database being replaced: "answered")
test("an engine import closes the engine it replaces: a call that still holds it is refused, and no process starts for it", () =>
  world({}, async (w) => {
    const src = join(w.dir, "other.db");
    const db = new sqlite.DatabaseSync(src);
    db.exec("CREATE TABLE working_memory (id TEXT PRIMARY KEY, content TEXT)");
    db.close();
    const old = w.svc.store;
    /** @type {Promise<string> | null} */
    let raced = null;
    const stop = old.stop.bind(old);
    // A turn's recall that comes in once the engine has stopped for the copy, while the copy goes on.
    old.stop = () => stop().then(() => void (raced ??= old.recall("anything").then(() => "answered", (/** @type {any} */ e) => e.message)));
    await w.withEngine(async () => {
      const job = w.svc.import({ source: "mnemosyne", srcFile: src, replace: true });
      await job.done;
      assert.equal(job.status, "done", String(job.error));
    });
    assert.match(String(await raced), /^memory engine closed/);
    assert.equal(old.status().pid, null, "no process started for it");
    assert.notEqual(w.svc.store, old, "memory runs on the engine opened after the copy");
  }));

// (fails before: the engine keeps one row per text, so two claims with the same words in two projects share it, and
// retiring one invalidated the row the other still stood on)
test("M2-3: an engine row two claims share stays valid while either stands, and is served as the one that stands", () =>
  world({}, async (w) => {
    const { brain, archive } = w.svc;
    const text = "The changelog is generated from commit messages.";
    const a = await brain.remember(text, { kind: "fact", projectId: "pa", by: "person" });
    const b = await brain.remember(text, { kind: "fact", projectId: "pb", by: "person" });
    await w.settle();
    const row = archive.items.get(a.itemId).memory_id;
    assert.equal(archive.items.get(b.itemId).memory_id, row, "one engine row for both");
    await brain.setItemStatus(a.itemId, "dismissed", { by: "owner" });
    await w.settle();
    assert.ok(!w.ops().some((o) => o.op === "invalidate" && o.args.id === row), "kept: the other claim stands on it");
    // From a third project only the engine's row can bring it (the archive's pass reads the project's own items).
    const r = await brain.retrieve({ query: "changelog generated from commit messages", projectId: "pc", mode: "search" });
    assert.equal(r.items.find((x) => /changelog/.test(x.text))?.id, `i${b.itemId}`, "served as the claim that stands");
    await brain.setItemStatus(b.itemId, "dismissed", { by: "owner" });
    await w.settle();
    assert.ok(w.ops().some((o) => o.op === "invalidate" && o.args.id === row), "invalidated once neither stands");
  }));

// (fails before: the bulk adoption read one page per table)
test("M2-3: an engine bigger than a page is adopted whole", () =>
  world({ engineRows: Array.from({ length: 501 }, (_, i) => ({ id: `b${i}`, content: `Bulk row number ${i} of the old store.`, source: "fact", importance: 0.5, scope: "global" })) }, async (w) => {
    const rec = w.svc.archive.schemaMetaGet("engineAdoption");
    assert.equal(rec.rows, 501);
    assert.equal(rec.adopted, 501);
    assert.equal(w.svc.archive.items.byMemoryId("b500")[0]?.origin, "import");
    assert.deepEqual(w.ops().filter((o) => o.op === "rows").map((o) => [o.args.table, o.args.after]), [["working", 0], ["working", 500], ["episodic", 0]]);
  }));

// ---- M2-4: one port that knows who is asking ----

// (fails before: every brain verb defaulted `by` to the owner, so a caller that forgot to say wrote in the owner's word)
test("M2-4: a write that does not say who asks is refused before it writes", () =>
  world({}, async (w) => {
    const { brain, archive } = w.svc;
    const who = /a write needs who is asking/;
    await assert.rejects(brain.remember("The deploy key rotates monthly.", { kind: "fact" }), who);
    await assert.rejects(brain.remember("The deploy key rotates monthly.", { kind: "fact", by: "admin" }), who);
    assert.equal(archive.items.list({ limit: 1000 }).length, 0, "nothing was written");
    const it = await brain.remember("The deploy key rotates monthly.", { kind: "fact", projectId: "q5", by: "owner" });
    await assert.rejects(brain.correct(it.id, { text: "The deploy key rotates weekly.", reason: "r" }), who);
    await assert.rejects(brain.confirm(it.id), who);
    await assert.rejects(brain.forget(it.id), who);
    await assert.rejects(brain.forget("s:c_x:3"), who, "refused before the id is even read");
    await assert.rejects(brain.setItemStatus(it.itemId, "dismissed"), who);
    assert.equal(archive.items.list({ limit: 1000 }).length, 1, "only the owner's remember wrote");
    assert.deepEqual(archive.items.events(it.itemId).map((e) => e.action), ["created"], "and nothing changed it");
    assert.throws(() => w.svc.scope({ role: "admin" }), /memory.scope needs a role/);
    assert.throws(() => w.svc.scope(/** @type {any} */ ({})), /memory.scope needs a role/);
  }));

test("M2-4: the handle's role is who asks: the person's word stands, an agent's is a note, the learner's is its own", () =>
  world({}, async (w) => {
    const { archive } = w.svc;
    const person = w.svc.scope({ role: "person", project: "q6" });
    const agent = w.svc.scope({ role: "agent", project: "q6", client: "agent:qoder" });
    const p = await person.remember("Integration tests need the docker daemon running.");
    const a = await agent.remember("The e2e suite takes about nine minutes.");
    const row = (r) => archive.items.get(r.itemId);
    assert.deepEqual([row(p).status, row(p).origin, row(p).project_id], ["confirmed", "person", "q6"]);
    assert.deepEqual([row(a).status, row(a).origin, row(a).project_id], ["inferred", "model", "q6"]);
    assert.equal(archive.items.events(a.itemId)[0].by, "model", "its claim is an assistant's note");
    await agent.confirm(a.id);
    assert.equal(row(a).status, "inferred", "an agent's confirm is a use, not the user's word");
    assert.equal(archive.items.events(a.itemId).at(-1).by, "agent");
    await person.confirm(a.id);
    assert.equal(row(a).status, "confirmed");
    const fix = await agent.correct(a.id, { text: "The e2e suite takes about twelve minutes.", reason: "timed it" });
    assert.deepEqual([archive.items.get(num(fix.id)).status, archive.items.get(num(fix.id)).origin], ["inferred", "model"], "an agent's correction is a note");
    await agent.forget(p.id, { reason: "the daemon is not needed any more" });
    const ev = archive.items.events(p.itemId).at(-1);
    assert.deepEqual([ev.action, ev.by, ev.reason], ["status", "agent", "the daemon is not needed any more"]);
    const l = await w.svc.scope({ role: "learner" }).remember("Builds run on node 22.");
    assert.deepEqual([row(l).status, row(l).origin], ["inferred", "learner"]);
  }));

test("M2-4: only the owner sets a status directly; the others confirm, correct or forget", () =>
  world({}, async (w) => {
    const owner = w.svc.scope({ role: "owner" });
    const it = await owner.remember("The staging database is read-only on weekends.");
    for (const role of ["person", "model", "agent", "learner"])
      await assert.rejects(w.svc.scope({ role }).setStatus(it.itemId, "dismissed"), /only the owner sets a memory's status directly/);
    assert.equal(w.svc.archive.items.get(it.itemId).status, "confirmed");
    assert.equal((await owner.setStatus(it.itemId, "dismissed")).ok, true);
    const ev = w.svc.archive.items.events(it.itemId).at(-1);
    assert.deepEqual([ev.by, ev.reason], ["owner", "set in the console"]);
  }));

test("M2-4: a claim's history says who changed it, when and why, and what replaced what; @mem shows it", () =>
  world({}, async (w) => {
    const person = w.svc.scope({ role: "person", project: "q7" });
    const model = w.svc.scope({ role: "model", project: "q7" });
    const old = await person.remember("The API docs are generated with typedoc.");
    const fix = await model.correct(old.id, { text: "The API docs are generated with api-extractor.", reason: "the docs script calls api-extractor" });
    const h = person.history(old.id);
    assert.deepEqual([h.id, h.status, h.trust, h.project, h.replacedBy], [old.id, "superseded", "user said", "q7", fix.id]);
    assert.match(h.created, /^\d{4}-\d\d-\d\dT/);
    assert.deepEqual(person.claim(old.id), { id: old.id, kind: "fact", text: "The API docs are generated with typedoc.", status: "superseded", trust: "user said", project: "q7", created: h.created });
    assert.deepEqual(h.events.map((e) => [e.action, e.by]), [["created", "person"], ["status", "model"]]);
    assert.equal(h.events[1].reason, "the docs script calls api-extractor");
    assert.deepEqual(h.events[1].detail, { from: "confirmed", to: "superseded", replacement: Number(fix.id.slice(1)) });
    assert.match(h.events[0].at, /^\d{4}-\d\d-\d\dT/);
    const n = person.history(fix.id);
    assert.deepEqual([n.replaces, n.replacedBy, n.trust], [[old.id], null, "assistant noted"]);
    assert.match(person.history("s:c_x:3").error, /quote from a past session/);
    assert.match(person.history("canon:name").error, /no memory stands behind canon:name/, "no id form of its own since f5");
    assert.match(person.history("i999999").error, /no memory i999999/);
    assert.match(person.history("e:nothing-here").error, /no memory stands behind e:nothing-here/);
    const { sit } = await w.session("h").send("hello");
    const out = await memoryCommand(w.svc, `@mem history ${old.id}`, sit);
    assert.match(out.text, new RegExp(`History of \`${old.id}\``));
    assert.match(out.text, /— status by model: the docs script calls api-extractor/);
    assert.match(out.text, new RegExp(`Replaced by \`${fix.id}\``));
    assert.match((await memoryCommand(w.svc, "@mem history", sit)).text, /Usage: @mem history <id>/);
    // @mem is the person's door: what it stores is their word, filed in their project
    await memoryCommand(w.svc, "@mem remember The lint step runs eslint with the strict config.", sit);
    const said = w.svc.archive.items.list({ limit: 100 }).find((it) => /eslint with the strict config/.test(it.text));
    assert.deepEqual([said.origin, said.status, said.project_id], ["person", "confirmed", sit.project.id]);
    // a chat with no folder has no project: what it stores is global, not filed under the placeholder "none"
    await memoryCommand(w.svc, "@mem remember Prefer short commit subjects.", { ...sit, project: { id: "none", name: "none" } });
    const global = w.svc.archive.items.list({ limit: 100 }).find((it) => /short commit subjects/.test(it.text));
    assert.equal(global.project_id, null);
  }));

test("M2-4: a handle outlives a reopen; while memory is closed its verbs refuse", () =>
  world({}, async (w) => {
    const owner = w.svc.scope({ role: "owner" });
    const { sit } = await w.session("s").send("hello");
    const offered = agentMemoryMcpTools(w.svc);
    assert.ok(offered.length >= 7, "an agent is offered the tools while memory is open");
    await w.svc.store.stop();
    w.svc.stop();
    // A session's list is fixed for its life: the tools stay listed while memory is on, open or not; a call is told to come back.
    assert.deepEqual(agentMemoryMcpTools(w.svc), offered, "the same while it is closed");
    assert.equal(await callAgentMemoryTool(w.svc, "filament_memory_search", { query: "queue" }), MEMORY_STARTING);
    // An archive that would not open is no wait: the call answers with its own words.
    w.svc.archiveError = "the archive is locked by another build";
    assert.equal(await callAgentMemoryTool(w.svc, "filament_memory_search", { query: "queue" }), '{"error":"no archive: The archive is locked by another build."}');
    w.svc.archiveError = null;
    assert.equal(await memoryCommand(w.svc, "@mem status", sit), null, "@mem is not answered by a closed memory: the message goes on");
    assert.deepEqual([owner.isOpen(), w.svc.isOpen()], [false, false]);
    await assert.rejects(owner.remember("The queue drains every minute."), /^Error: no archive: Memory has not started\.$/);
    assert.throws(() => owner.history("i1"), /^Error: no archive: Memory has not started\.$/);
    await w.withEngine(async () => w.svc.start());
    await w.svc.engineStart;
    assert.deepEqual([owner.isOpen(), w.svc.isOpen()], [true, true]);
    assert.match((await owner.remember("The queue drains every minute.")).id, /^i\d+$/);
  }));

// (fails before: retiredBy named only the model an assistant, so an agent's retirement was told as the user's)
test("M2-4: an erratum names who retired the claim: an agent is an assistant, the owner the user, the learner Filament", () =>
  world({}, async (w) => {
    const { archive } = w.svc;
    const s = w.session("s");
    const { sit } = await s.send("hello");
    const person = w.svc.scope({ role: "person", project: sit.project.id });
    const texts = ["The staging server is in region eu-west-2.", "The staging server runs postgres 16.", "The staging server reboots every sunday night."];
    const claims = [];
    for (const t of texts) claims.push(await person.remember(t));
    const { seen, prep } = await s.send("what do we know about the staging server?");
    for (const t of texts) assert.ok(seen.includes(t), `shown: ${t}`);
    await w.svc.scope({ role: "agent" }).forget(claims[0].id);
    await w.svc.scope({ role: "owner" }).forget(claims[1].id);
    await w.svc.scope({ role: "learner" }).forget(claims[2].id);
    const errata = JSON.parse(archive.getChain(prep.chain).meta_json || "{}").errata || [];
    assert.deepEqual(errata.map((e) => [e.ref, e.by]), [[claims[0].id, "an assistant"], [claims[1].id, "the user"], [claims[2].id, "Filament"]]);
  }));

// A handle that stands in a session files its writes there, and that session is not told of a change it made itself.
test("M2-4: the model's writes are filed in its session and turn; the session that changed a claim hears no erratum of it", () =>
  world({}, async (w) => {
    const { archive } = w.svc;
    const s = w.session("s");
    const t = w.session("t");
    const { sit } = await s.send("hello");
    await t.send("hello");
    const person = w.svc.scope({ role: "person", project: sit.project.id });
    const a = await person.remember("The search index is rebuilt nightly at 03:00.");
    const b = await person.remember("The search index lives on the db-2 host.");
    const seenS = await s.send("tell me about the search index");
    const seenT = await t.send("tell me about the search index");
    for (const x of [seenS, seenT]) assert.ok(x.seen.includes("rebuilt nightly") && x.seen.includes("db-2 host"), "both sessions were shown both");
    const model = memoryToolCtx(w.svc, seenS.sit, seenS.prep).scope;
    const note = await model.remember("The search index uses 4 shards.");
    assert.deepEqual([archive.items.get(note.itemId).chain_id, archive.items.get(note.itemId).turn_id], [seenS.prep.chain, seenS.prep.turn]);
    const fix = await model.correct(a.id, { text: "The search index is rebuilt nightly at 04:00.", reason: "the cron moved" });
    assert.equal(archive.items.get(num(fix.id)).chain_id, seenS.prep.chain, "the replacement is filed in the session that made it");
    await model.forget(b.id, { reason: "moved to db-3" });
    assert.equal(archive.items.events(b.itemId).at(-1).by, "model", "a request's tools ask as the model");
    const errata = (chain) => (JSON.parse(archive.getChain(chain).meta_json || "{}").errata || []).map((e) => e.ref);
    assert.deepEqual(errata(seenS.prep.chain), [], "the session that changed them was there");
    assert.deepEqual(errata(seenT.prep.chain), [a.id, b.id]);
  }));

test("M2-4: the recall tool reads the session record through the model's handle", () =>
  world({}, async (w) => {
    const s = w.session("s");
    await s.send("the deploy failed on step four, look at it", { reply: "Step four needs the staging key." });
    const second = await s.send("ok, and now?");
    const scope = memoryToolCtx(w.svc, second.sit, second.prep).scope;
    const out = await executeMemoryTool(scope, "filament_recall", { turn: 1 });
    assert.match(out, /## Turn 1/);
    assert.match(out, /the deploy failed on step four/);
    assert.match(out, /Step four needs the staging key\./);
  }));

test("M2-4: the dashboard's assistant acts as the owner: its remember is the owner's word, its recall and forget reach memory", () =>
  world({}, async (w) => {
    const a = new Assistant({ getConfig: () => w.cfg, memory: w.svc });
    const s = a.session();
    const r = await a.runTool(s, "memory_remember", { text: "The owner wants releases cut on Tuesdays.", kind: "preference" });
    const it = w.svc.archive.items.get(r.itemId);
    assert.deepEqual([it.origin, it.status, it.kind], ["owner", "confirmed", "preference"]);
    await w.settle();
    const found = await a.runTool(s, "memory_recall", { query: "releases cut Tuesdays" });
    assert.ok(found.results.some((x) => x.id === r.id), JSON.stringify(found));
    assert.equal((await a.runTool(s, "memory_forget", { id: r.id })).ok, true);
    const ev = w.svc.archive.items.events(r.itemId).at(-1);
    assert.deepEqual([ev.by, ev.reason], ["owner", "the owner asked the assistant to forget it"]);
  }));

// An agent over MCP: its writes are an agent's, filed in the project of its folder.
test("M2-4: an agent's memory tool call over MCP is the agent's, in its folder's project", () =>
  world({}, async (w) => {
    const r = JSON.parse(await callAgentMemoryTool(w.svc, "filament_memory_remember", { text: "The monorepo uses turborepo for builds." }, { cwd: "C:\\work\\mono", upstream: "qoder" }));
    const it = w.svc.archive.items.get(num(r.id));
    assert.deepEqual([it.status, it.origin], ["inferred", "model"]);
    assert.ok(it.project_id && it.project_id !== "none", "filed in the folder's project");
    await callAgentMemoryTool(w.svc, "filament_memory_forget", { id: r.id, reason: "moved to nx" }, { cwd: "C:\\work\\mono", upstream: "qoder" });
    assert.deepEqual(w.svc.archive.items.events(it.id).at(-1).by, "agent");
  }));

test("M2-4, M7-1: a sub-agent's brief holds its project's own claims, where the engine has no copy too, and the global ones; never another project's", () =>
  world({}, async (w) => {
    await w.svc.scope({ role: "owner" }).remember("Webhooks are signed with HMAC-SHA256 everywhere.");
    await w.settle();
    w.failOps(["remember"]); // no engine copy of the project's claim: only the archive's pass for the project finds it
    const own = (await w.svc.scope({ role: "owner", project: "q8" }).remember("The billing service retries webhooks five times.")).id;
    const brief = (/** @type {string} */ project) => w.svc.scope({ role: "agent", project }).brief({ purpose: "subagent", task: "webhooks retries signed" });
    const got = await brief("q8");
    assert.ok(!got.text.includes("\nProject:"), `a project with no folder has no project line: ${got.text}`);
    assert.match(got.text, /\n- \[i\d+ fact · user said · [^\]]+\] Webhooks are signed with HMAC-SHA256 everywhere\./);
    assert.match(got.text, new RegExp(`\\n- \\[${own} fact · user said · [^\\]]+\\] The billing service retries webhooks five times\\.`));
    const elsewhere = await brief("q9");
    assert.ok(!elsewhere.text.includes("The billing service retries webhooks five times."), elsewhere.text);
    assert.ok(elsewhere.text.includes("Webhooks are signed with HMAC-SHA256 everywhere."), elsewhere.text);
  }));

// (memory closed mid-request: the model's results have nowhere to wait, and the reply goes on without them)
test("M2-4: deferred tool results while memory is closed are dropped, and the reply is not failed", async () => {
  const ctx = { scope: memoryHandle({ brain: null, archiveWhy: () => "Memory has not started." }, { role: "model", chain: "c1" }), trace: null };
  assert.equal(await deferMemoryResults([{ id: "a", name: "filament_memory_search", input: { query: "x" } }], ctx, { because: "mixed" }), null, "it ran nothing");
});

// A request with no session has no next request for results to wait on: the calls are not run at all.
test("M2-4: deferred tool calls of a request with no session are not run", async () => {
  const ran = [];
  const brain = { remember: async (t) => (ran.push(t), { id: "i1" }), setDeferred: () => assert.fail("nowhere to defer to") };
  const ctx = { scope: memoryHandle({ brain }, { role: "model" }), trace: null };
  await deferMemoryResults([{ id: "a", name: "filament_memory_remember", input: { text: "x" } }], ctx, { because: "mixed" });
  assert.deepEqual(ran, []);
});

// ---------------------------------------------------------------------------------------------------
// M2-5 slots
// ---------------------------------------------------------------------------------------------------
/** What the learner's model found in a session, filed the way a learning run files it. */
const learnIn = (w, chainId, items) => w.svc.learner.ingest({ items }, w.svc.archive.getChain(chainId), chainId, { reason: "manual", advance: false });
/** A learned convention giving the project's package manager. */
const pm = (value, text, turn = 1) => ({ kind: "convention", text, importance: 0.7, turn, slot: { subject: "the Repo", attribute: "Package manager", value } });

test("M2-5: the learner's model is asked for each item's slot", () => {
  assert.ok(LEARN_PROMPT.includes('"slot": {"subject": "what it is about", "attribute": "what about it", "value": "its value as said", "multi": false}'));
  assert.match(LEARN_PROMPT, /Rules for slots: give an item a slot only when it states the current value of one thing/);
});

test("M2-5: a slot is keyed the same however the model words it; a value is held by the claim's own value or, unkeyed, by its words", () => {
  assert.deepEqual(slotOf({ subject: "The Repo", attribute: " Package  Manager.", value: " bun " }), { slot: "project · package manager", value: "bun", multi: false });
  assert.equal(slotOf({ subject: "codebase", attribute: "package manager", value: "bun" }).slot, "project · package manager");
  assert.deepEqual(slotOf({ subject: "“API gateway”", attribute: "the region", value: "eu-west-2", multi: true }), { slot: "api gateway · region", value: "eu-west-2", multi: true });
  assert.equal(slotOf({ subject: "user", attribute: "editor", value: "vim", multi: "yes" }).multi, false, "only true holds several");
  for (const bad of [null, "project · x", { subject: "", attribute: "x", value: "v" }, { subject: "s", attribute: "the", value: "v" }, { subject: "s", attribute: "x", value: " . " }, { subject: "s".repeat(61), attribute: "x", value: "v" }, { subject: "s", attribute: "x".repeat(61), value: "v" }])
    assert.equal(slotOf(bad), null, JSON.stringify(bad));
  assert.equal(slotOf({ subject: "s".repeat(60), attribute: "x".repeat(60), value: "v" })?.slot, `${"s".repeat(60)} · ${"x".repeat(60)}`);
  assert.equal(slotOf({ subject: "s", attribute: "x", value: "v".repeat(200) }).value.length, 120);
  assert.equal(holdsValue({ slot_value: "Bun", text: "x" }, "bun"), true);
  assert.equal(holdsValue({ slot_value: "bun", text: "We use pnpm, not bun." }, "pnpm"), false, "its own value, not its words");
  assert.equal(holdsValue({ slot_value: null, text: "We moved to Bun." }, "bun"), true);
  assert.equal(holdsValue({ slot_value: null, text: "We bundle with esbuild." }, "bun"), false, "a whole word");
  assert.equal(holdsValue({ slot_value: "", text: "tests: node --test" }, "node --test"), true);
});

// (fails before: the learner filed "uses bun" beside "uses pnpm" — or dropped it, the engine holding words that
// overlap — and both stood, so sessions were told two package managers)
test("M2-5: a learned value in a slot replaces the one there, with history and errata; said again elsewhere it is evidence for that claim, not a second claim", () =>
  world({}, async (w) => {
    const { archive } = w.svc;
    const a = await w.session("a").send("we install dependencies with pnpm");
    const project = a.sit.project.id;
    assert.equal((await learnIn(w, a.prep.chain, [pm("pnpm", "The project uses pnpm as its package manager.")])).items, 1);
    const old = archive.items.withText(project, "convention", "The project uses pnpm as its package manager.");
    assert.deepEqual([old.slot, old.slot_value, old.slot_multi, old.origin, old.status], ["project · package manager", "pnpm", 0, "learner", "inferred"]);
    assert.deepEqual(archive.items.events(old.id)[0].detail, { status: "inferred", kind: "convention", slot: "project · package manager", value: "pnpm" });
    await w.settle();
    const b = w.session("b");
    await b.send("hello");
    assert.ok((await b.send("which package manager does the project use, pnpm?")).seen.includes(`[i${old.id} convention`), "session b was shown the old value");
    const c = await w.session("c").send("we moved to bun last week");
    const moved = await learnIn(w, c.prep.chain, [pm("bun", "The project now uses bun as its package manager.")]);
    assert.deepEqual([moved.items, moved.dedupedItems], [1, 0], "the engine's copy of the old value is not taken for the new one");
    const now = archive.items.withText(project, "convention", "The project now uses bun as its package manager.");
    const was = archive.items.get(old.id);
    assert.deepEqual([was.status, was.superseded_by, now.status, now.slot_value], ["superseded", now.id, "inferred", "bun"]);
    const ev = archive.items.events(old.id).at(-1);
    assert.deepEqual([ev.by, ev.reason], ["learner", "a newer value in its slot (project · package manager): bun"]);
    await w.settle();
    assert.ok(w.engineRows().find((r) => r.id === was.memory_id).valid_until, "its engine copy is invalidated");
    const told = await b.send("ok, and how do I add a dependency?");
    assert.ok(
      told.seen.includes(`Memory correction: [i${old.id}] "The project uses pnpm as its package manager." no longer holds — now [i${now.id}] "The project now uses bun as its package manager." (Filament, `),
      "the session shown the old value hears of the new one",
    );
    // said again in another session: evidence for the claim that stands, once per session, none from its own
    const d = await w.session("d").send("bun install is fast");
    const again = await learnIn(w, d.prep.chain, [pm("Bun", "Bun is the package manager here.")]);
    assert.deepEqual([again.items, again.dedupedItems], [0, 1]);
    await learnIn(w, d.prep.chain, [pm("bun", "Bun is the package manager here.")]);
    await learnIn(w, c.prep.chain, [pm("bun", "We use bun.")]);
    assert.equal(archive.items.list({ limit: 100 }).filter((it) => it.slot === "project · package manager").length, 2, "the old value and the new one, no third");
    // a switch back, in other words, is a new value: the retired claim holding it is not its record
    const e = await w.session("e").send("we are back on pnpm");
    assert.equal((await learnIn(w, e.prep.chain, [pm("pnpm", "The project is back on pnpm for packages.")])).items, 1);
    const back = archive.items.withText(project, "convention", "The project is back on pnpm for packages.");
    assert.deepEqual([archive.items.get(now.id).status, archive.items.get(now.id).superseded_by, back.status], ["superseded", back.id, "inferred"]);
    assert.equal(archive.items.events(old.id).filter((x) => x.action === "evidence").length, 0, "the retired claim gained no evidence");
    const said = archive.items.events(now.id).filter((e) => e.action === "evidence");
    assert.deepEqual(
      said.map((e) => [e.by, e.detail]),
      [["learner", { chain: d.prep.chain, turn: archive.getTurns(d.prep.chain)[0].id, text: "Bun is the package manager here." }]],
    );
    const h = w.svc.scope({ role: "person" }).history(`i${now.id}`);
    assert.deepEqual([h.slot, h.value, h.replaces], ["project · package manager", "bun", [`i${old.id}`]]);
    assert.equal("slot" in w.svc.scope({ role: "person" }).claim(`i${(await w.svc.scope({ role: "person" }).remember("Unkeyed words.")).itemId}`), false, "a claim with no slot shows none");
    const out = (await memoryCommand(w.svc, `@mem history i${now.id}`, d.sit)).text;
    assert.ok(out.includes("Slot: project · package manager = bun"), out);
    assert.ok(out.includes(`said again in session ${d.prep.chain} by learner`), out);
  }));

// (fails before: whichever session was learned last won, so a backlog learned out of order put an old value back)
test("M2-5: a session learned late does not overrule a newer one: its older value is filed superseded by the value said after it", () =>
  folder("filament-slot-order-", async (dir, keep) => {
    const DAY = 86_400_000;
    let now = 1_000 * DAY;
    const a = keep(new Archive({ file: join(dir, "a.db"), key: null, now: () => now }));
    const brain = new MemoryBrain({ archive: a, now: () => now });
    keep({ close: () => brain.stop() });
    let next = [];
    const learner = new MemoryLearner({ archive: a, brain, now: () => now, callModel: async () => JSON.stringify({ items: next }), getConfig: () => ({ capture: { learn: true, idleMinutes: 30, dailyCap: 200 } }) });
    const say = (key, text) => {
      const ch = a.chainForKey(key, { cwd: "C:\\proj", client: "claude-code", model: "m" });
      const t = a.beginTurn(ch.id, { requestId: `${key}-${now}`, userMessage: { role: "user", content: text } });
      a.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: "ok" }, requestId: `${key}-${now}` });
      return ch;
    };
    const older = say("k-old", "we use pnpm"); // day 0
    const early = say("k-early", "we tried rush once"); // day 0
    now += DAY / 2;
    const npm = say("k-npm", "we used npm back then"); // day 0.5
    now += DAY / 2;
    const newer = say("k-new", "we moved to bun"); // day 1
    now += DAY;
    say("k-old", "unrelated follow-up"); // day 2: the older session went on after the newer one
    const yarn = say("k-yarn", "we switched to yarn"); // day 2
    now += DAY;
    const text = (value) => `The project uses ${value} as its package manager.`;
    const claim = (value) => a.items.withText(newer.project_id, "convention", text(value));
    next = [pm("bun", text("bun"))];
    await learner.learnChain(newer.id, { reason: "idle" });
    next = [pm("pnpm", text("pnpm"), 1)];
    const r = await learner.learnChain(older.id, { reason: "idle" });
    assert.equal(claim("bun").status, "inferred", "the newer value stands");
    assert.deepEqual([claim("pnpm").status, claim("pnpm").superseded_by, claim("pnpm").slot_value], ["superseded", claim("bun").id, "pnpm"], "the value said on day 0 is history, though learned last");
    assert.equal(a.items.events(claim("pnpm").id).at(-1).reason, `an older value in its slot (project · package manager): i${claim("bun").id} was said later`);
    assert.equal(a.outbox.forItem(claim("pnpm").id).length, 0, "it never stood: nothing to copy to the engine");
    assert.deepEqual([r.items, r.dedupedItems], [0, 1]);
    // said on day 2, after bun's turn though before bun was filed: the time a claim was said is its turn's
    next = [pm("yarn", text("yarn"))];
    await learner.learnChain(yarn.id, { reason: "idle" });
    assert.deepEqual([claim("yarn").status, claim("bun").status, claim("bun").superseded_by], ["inferred", "superseded", claim("yarn").id]);
    // an item the model gave no turn for was said when its session last spoke
    next = [{ ...pm("npm", text("npm")), turn: undefined }];
    await learner.learnChain(npm.id, { reason: "idle" });
    assert.deepEqual([claim("npm").status, claim("npm").superseded_by, claim("yarn").status], ["superseded", claim("yarn").id, "inferred"]);
    // the owner brought bun back beside yarn: an older value is history to the latest of them
    await brain.setItemStatus(claim("bun").id, "inferred", { by: "owner", reason: "both are in use" });
    next = [pm("rush", text("rush"))];
    await learner.learnChain(early.id, { reason: "idle" });
    assert.deepEqual([claim("rush").status, claim("rush").superseded_by], ["superseded", claim("yarn").id]);
  }));

// (fails before: the learner dropped a claim when the engine held similar words in ANY project — another project's
// claim silenced this one's — and a retired claim's words silenced a new one without saying which)
test("M2-5: a near-duplicate the engine serves is evidence when its claim stands here or globally, is not this project's when it is another's, and names the retired claim it repeats", () =>
  world({}, async (w) => {
    const { brain, archive } = w.svc;
    const owner = w.svc.scope({ role: "owner", project: "p1" });
    const file = (projectId, text, slot = null, chainId = "c_learn") => brain.fileLearned({ projectId, chainId, kind: "fact", text, importance: 0.6, slot });
    const ci = await owner.remember("The CI pipeline runs on GitHub Actions runners.");
    const style = await w.svc.scope({ role: "owner" }).remember("Commit messages follow the conventional commits format.");
    await w.settle();
    const elsewhere = await file("p2", "The CI pipeline runs on GitHub Actions runners only.");
    assert.equal(elsewhere.filed, "added", "another project's claim is not this one's");
    assert.deepEqual([archive.items.get(elsewhere.id).project_id, archive.items.get(elsewhere.id).status], ["p2", "inferred"]);
    assert.deepEqual(await file("p1", "The CI pipeline runs on GitHub Actions runners only."), { id: ci.itemId, filed: "evidence" });
    assert.equal((await file("p1", "The CI pipeline runs nightly on self-hosted machines.")).filed, "added", "half the words in common is another claim");
    // what the engine wrote by itself is no claim, and no record to be evidence for
    await w.svc.store.remember({ content: "The staging cluster scales down every weekend.", source: "sleep_consolidation", importance: 0.9, metadata: { project: "p1" } });
    const scaled = await file("p1", "The staging cluster scales down every weekend now.");
    assert.equal(scaled.filed, "added");
    assert.equal(archive.items.list({ limit: 200 }).filter((it) => /staging cluster scales down/.test(it.text)).length, 1, "the engine's own row was not adopted");
    assert.deepEqual(await file("p3", "Commit messages follow the conventional commits format strictly."), { id: style.itemId, filed: "evidence" }, "a global claim holds in every project");
    // an unkeyed claim is evidence for a slot's value only when its words name that value
    const bunWords = await owner.remember("We use bun for installs in this repo.");
    const pnpmWords = await owner.remember("We use pnpm for scripts in this repo.");
    await w.settle();
    const key = (value) => ({ slot: "project · package manager", value, multi: false });
    assert.deepEqual(await file("p1", "We use bun for all installs in this repo.", key("bun")), { id: bunWords.itemId, filed: "evidence" });
    const yarn = await file("p1", "We use yarn for scripts in this repo.", key("yarn"));
    assert.equal(yarn.filed, "added", "near words with another value are not this value");
    assert.equal(archive.items.get(pnpmWords.itemId).status, "confirmed", "an unkeyed claim is not superseded through a slot");
    const runtime = await file("p1", "The project uses deno as its runtime.", { slot: "project · runtime", value: "deno", multi: false });
    await w.settle();
    assert.equal((await file("p1", "The project uses deno as its formatter.", { slot: "project · formatter", value: "deno", multi: false })).filed, "added", "a claim of another slot with the same value is not this one");
    assert.equal(archive.items.get(runtime.id).status, "inferred");
    // a quote of a past session, and what an ability held before abilities went, are not the project's claims
    await w.svc.store.remember({ content: "The deploy script tags every release with the date.", source: "turn", importance: 0.6, metadata: { kind: "turn", project: "p1" } });
    await w.svc.store.remember({ content: "The release checklist starts with the changelog entry.", source: "ability", importance: 0.6, metadata: { kind: "ability:release", project: "p1" } });
    assert.equal((await file("p1", "The deploy script tags every release with the date now.")).filed, "added");
    assert.equal((await file("p1", "The release checklist starts with the changelog entry always.")).filed, "added");
    // (fails before: no — a guard for the abilities' going: once only a session that loaded one recalled what it held)
    const checklist = (await brain.retrieve({ query: "release checklist changelog entry", projectId: "p1", mode: "search" })).items;
    assert.ok(checklist.some((x) => /entry always/.test(x.text)), JSON.stringify(checklist));
    assert.ok(!checklist.some((x) => x.text === "The release checklist starts with the changelog entry."), "what an ability held is recalled nowhere");
    // a retired claim the engine still serves: the same words are left as they are; near words are filed dismissed, naming it
    const old = await owner.remember("The nightly build publishes to the staging bucket.");
    await w.settle();
    w.failOps(["invalidate"]);
    await owner.forget(old.id, { reason: "the nightly build was retired" });
    await w.settle();
    assert.deepEqual(await file("p1", "The nightly build publishes to the staging bucket."), { id: old.itemId, filed: "known" });
    assert.equal(archive.items.get(old.itemId).status, "dismissed", "the learner never brings it back");
    const near = await file("p1", "The nightly build publishes to the staging bucket daily.");
    assert.equal(near.filed, "dismissed");
    assert.deepEqual([archive.items.get(near.id).status, archive.items.get(near.id).invalid_reason], ["dismissed", `${old.id} says this and is dismissed`]);
    assert.equal(archive.outbox.forItem(near.id).length, 0, "a dismissed claim gets no engine copy");
    // the same words standing in another claim too: that one is the record
    const twin = await owner.remember("The nightly build publishes artifacts to the staging bucket.");
    await w.settle();
    assert.deepEqual(await file("p1", "The nightly build publishes to the staging bucket nightly."), { id: twin.itemId, filed: "evidence" });
    w.failOps([]);
  }));

test("M2-5: a slot that holds several values keeps each; a correction's replacement takes the slot, and its value said again is evidence for it", () =>
  world({}, async (w) => {
    const { brain, archive } = w.svc;
    const file = (text, slot, chainId = "c_l") => brain.fileLearned({ projectId: "p", chainId, kind: "fact", text, importance: 0.6, slot });
    const langs = (value, multi = true) => ({ slot: "user · languages", value, multi });
    const ts = await file("The user writes TypeScript.", langs("TypeScript"));
    const rs = await file("The user writes Rust.", langs("Rust"));
    assert.deepEqual([ts.filed, rs.filed], ["added", "added"]);
    const go = await file("The user writes only Go.", langs("Go", false));
    assert.deepEqual(archive.items.inSlot("p", "user · languages").map((c) => c.id), [ts.id, rs.id, go.id], "a value said to stand alone does not retire values said to stand together");
    const py = await file("The user writes Python.", langs("Python"));
    assert.deepEqual(archive.items.inSlot("p", "user · languages").map((c) => c.id), [ts.id, rs.id, go.id, py.id], "nor the other way round");
    const t = await file("Tests run with npm test.", { slot: "project · test command", value: "npm test", multi: false });
    const person = w.svc.scope({ role: "person", project: "p" });
    const fix = await person.correct(`i${t.id}`, { text: "Tests run with node --test.", reason: "the script changed" });
    const now = archive.items.get(num(fix.id));
    assert.deepEqual([now.slot, now.slot_value, now.slot_multi], ["project · test command", null, 0]);
    assert.deepEqual(await file("The tests are run with node --test now.", { slot: "project · test command", value: "node --test", multi: false }, "c_m"), { id: now.id, filed: "evidence" });
    // a correction onto words already on file without a slot keys them
    const loose = await person.remember("Lint runs with biome.");
    const l = await file("Lint runs with eslint.", { slot: "project · lint", value: "eslint", multi: true });
    const fix2 = await person.correct(`i${l.id}`, { text: "Lint runs with biome.", reason: "we switched" });
    assert.equal(fix2.id, loose.id);
    assert.deepEqual([archive.items.get(loose.itemId).slot, archive.items.get(loose.itemId).slot_multi], ["project · lint", 1]);
    // ...and its history says so (HarnessV3-Memory M7-D33).
    const keyed = archive.items.events(loose.itemId).find((e) => e.action === "slot");
    assert.deepEqual([keyed?.by, keyed?.detail], ["person", { from: null, to: { slot: "project · lint", value: null, multi: true } }]);
  }));

// ---------------------------------------------------------------------------------------------------
// M2-6 provenance guardrails
// ---------------------------------------------------------------------------------------------------
// (fails before: a learned value superseded whatever stood in its slot, the user's own word included)
test("M2-6: a learned value never replaces one the user said, corrected or confirmed: it is filed dismissed, naming it", () =>
  world({}, async (w) => {
    const { brain, archive } = w.svc;
    const file = (text, slot, chainId = "c_l") => brain.fileLearned({ projectId: "p", chainId, kind: "fact", text, importance: 0.6, slot: { slot, value: text.split(" ").at(-1).replace(/\.$/, ""), multi: false } });
    const person = w.svc.scope({ role: "person", project: "p" });
    const owner = w.svc.scope({ role: "owner", project: "p" });
    // confirmed
    const west1 = await file("The deploy region is eu-west-1.", "project · deploy region");
    await person.confirm(`i${west1.id}`);
    const west2 = await file("The deploy region is eu-west-2.", "project · deploy region", "c_m");
    assert.equal(west2.filed, "dismissed");
    assert.deepEqual([archive.items.get(west2.id).status, archive.items.get(west2.id).invalid_reason], ["dismissed", `the user's word holds its slot (project · deploy region): i${west1.id}, user confirmed`]);
    assert.equal(archive.items.get(west1.id).status, "confirmed", "the user's value stands");
    assert.equal(archive.outbox.forItem(west2.id).length, 0, "a dismissed claim gets no engine copy");
    const west3 = await brain.fileLearned({ projectId: "p", chainId: "c_old", saidAt: 1, kind: "fact", text: "The deploy region is eu-west-3.", importance: 0.6, slot: { slot: "project · deploy region", value: "eu-west-3", multi: false } });
    assert.deepEqual([west3.filed, archive.items.get(west3.id).superseded_by], ["superseded", west1.id], "said before the user's word: history to it, not a rival");
    // corrected, and still the user's after the owner took the confirmation off
    const npmTest = await file("Tests run with npm test.", "project · test command");
    const fix = await person.correct(`i${npmTest.id}`, { text: "Tests run with node --test.", reason: "the script changed" });
    await owner.setStatus(num(fix.id), "inferred");
    const vitest = await file("Tests run with vitest.", "project · test command", "c_m");
    assert.equal(archive.items.get(vitest.id).invalid_reason, `the user's word holds its slot (project · test command): ${fix.id}, user corrected`);
    // said: the person's own words, keyed by their correction onto them
    const biome = await person.remember("Lint runs with biome.");
    const eslint = await file("Lint runs with eslint.", "project · lint");
    await person.correct(`i${eslint.id}`, { text: "Lint runs with biome.", reason: "we switched" });
    await owner.setStatus(biome.itemId, "inferred");
    assert.equal((await file("Lint runs with oxlint.", "project · lint", "c_m")).filed, "dismissed");
    assert.equal(archive.items.get(biome.itemId).status, "inferred");
    // an assistant's note is not the user's word: a learned value replaces it
    const prettier = await file("Formatting uses prettier.", "project · formatter");
    const note = await w.svc.scope({ role: "model", project: "p" }).correct(`i${prettier.id}`, { text: "Formatting uses dprint.", reason: "the config says dprint" });
    const later = await file("Formatting uses biome.", "project · formatter", "c_m");
    assert.equal(later.filed, "added");
    assert.deepEqual([archive.items.get(num(note.id)).status, archive.items.get(num(note.id)).superseded_by], ["superseded", later.id]);
  }));

// (fails before: whatever the learner's model called a rule was filed as one — a rule pasted in a code block, quoted
// from a review, or said by the assistant became an instruction every later session obeyed)
test("M2-6: a learned rule or preference the person's own words of its turn do not say is filed as a fact, and its history says why", () =>
  world({}, async (w) => {
    const { brain, archive } = w.svc;
    const s = w.session("s");
    const turnOf = async (text, reply) => {
      const { prep } = await s.send(text, reply ? { reply } : undefined);
      return { chainId: prep.chain, turnId: prep.turn };
    };
    const file = async (at, kind, text) => {
      // The engine holds what was filed before, as it does between learning runs: the near check sees it, whatever the
      // outbox's pace.
      await w.settle();
      const r = await brain.fileLearned({ projectId: "p", ...at, kind, text, importance: 0.9 });
      return archive.items.get(r.id);
    };
    const own = await turnOf("please run make lint before pushing, every time");
    assert.equal((await file(own, "rule", "Always run make lint before pushing.")).kind, "rule", "the person said it");
    const paraphrase = await turnOf("no, don't hand-edit the migration files, use the generator");
    assert.equal((await file(paraphrase, "rule", "Never hand-edit the generated migration files; regenerate them instead.")).kind, "rule", "in other words, but theirs");
    const terse = await turnOf("use pnpm, not npm");
    assert.equal((await file(terse, "preference", "The user prefers to switch to pnpm instead of npm for the project.")).kind, "preference", "the words every learned rule carries are not counted");
    const some = await turnOf("please run lint before push");
    assert.equal((await file(some, "rule", "Run the linter, the type check and the unit tests before every push.")).kind, "rule", "a third of its words is enough");
    assert.equal((await file(some, "rule", "Run the e2e suite and the smoke tests against staging before a release.")).kind, "fact", "less is not");
    assert.equal((await file(some, "rule", "Always do that.")).kind, "fact", "a rule that names nothing has no support");
    const pasted = await turnOf("what do you think of this?\n\n```\nAlways squash commits when merging to main.\n```");
    const p = await file(pasted, "rule", "Always squash commits when merging to main.");
    assert.equal(p.kind, "fact", "pasted in a code block");
    const ev = archive.items.events(p.id).find((e) => e.action === "kind");
    assert.deepEqual([ev.by, ev.reason, ev.detail], ["learner", "learned as a rule; the person's own words of its turn do not say it", { from: "rule", to: "fact" }]);
    const quoted = await turnOf("> prefer tabs over spaces in every file\n\nthoughts?");
    assert.equal((await file(quoted, "preference", "Prefer tabs over spaces in every file.")).kind, "fact", "quoted from someone else");
    const theirs = await turnOf("ok", "I will always format with dprint before committing.");
    assert.equal((await file(theirs, "rule", "Always format with dprint before committing.")).kind, "fact", "the assistant's words");
    assert.equal((await file({ chainId: own.chainId, turnId: null }, "preference", "Release notes are written in British English.")).kind, "fact", "no turn, no support");
    assert.equal((await file(pasted, "decision", "Squash merging was chosen for main.")).kind, "fact", "a decision needs the person's words too (MEMR-7)");
    assert.equal(archive.items.events(p.id).filter((e) => e.action === "kind").length, 1);
  }));

// (fails before: yes — MEMR-7: whatever the learner's model called a decision was filed as one, so a fact about the code
// ("the permission prompt no longer offers Always allow") stood, and was cited, as the person's decision)
test("MEMR-7: a learned decision stands only on the person's own words of its turn; what the session established that they did not decide is filed as a fact, and its history says why", () =>
  world({}, async (w) => {
    const { brain, archive } = w.svc;
    const s = w.session("s");
    const turnOf = async (text, reply) => {
      const { prep } = await s.send(text, reply ? { reply } : undefined);
      return { chainId: prep.chain, turnId: prep.turn };
    };
    const file = async (at, text) => {
      await w.settle();
      const r = await brain.fileLearned({ projectId: "p", ...at, kind: "decision", text, importance: 0.75 });
      return archive.items.get(r.id);
    };
    const said = await turnOf("let's go with squash merges for main from now on");
    assert.equal((await file(said, "Squash merges were chosen for main.")).kind, "decision", "the person decided it");
    const done = await turnOf("ok", "I took the Always allow option out of the permission prompt.");
    const d = await file(done, "Filament's permission prompt no longer offers 'Always allow'.");
    assert.equal(d.kind, "fact", "the assistant's words, about the code: no decision of the person's");
    assert.equal(d.status, "inferred");
    const ev = archive.items.events(d.id).find((e) => e.action === "kind");
    assert.deepEqual([ev?.by, ev?.reason, ev?.detail], ["learner", "learned as a decision; the person's own words of its turn do not say it", { from: "decision", to: "fact" }]);
    assert.equal((await file({ chainId: said.chainId, turnId: null }, "The nightly build was moved to the arm64 runners.")).kind, "fact", "no turn, no support");
  }));

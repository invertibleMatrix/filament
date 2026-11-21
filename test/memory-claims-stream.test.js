// @ts-check
// The claims stream and the fan-out (HarnessV3-Memory M7-D35, M7-D36): every change to a claim as it happens, its id
// `<epoch>:<n>`, never its words; resumable after `Last-Event-ID` or `?since=`, a gap said when it cannot be; one
// project's changes; never a change skipped, the reader waited for; a reset when memory opens another store. And each
// page of changes on the events fan-out, `prev` chained to the `last` before.
// First on the real route over a scripted response (the reader's pace is the test's), then end to end over HTTP.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRouter } from "../src/http/router.js";
import { memoryRoutes } from "../src/http/admin/memory.js";
import { MemoryService } from "../src/memory-service.js";
import { world } from "./fixtures/memory-world.mjs";
import { startApp } from "./helpers/app.js";

/** One SSE block as `{ sse, data }`: the id it carried, its data parsed; a heartbeat is none. @param {string} block */
const frameOf = (block) => {
  if (!block || block.startsWith(":")) return null;
  const data = /^data: (.*)$/m.exec(block)?.[1];
  return data == null ? null : { sse: /^id: (.*)$/m.exec(block)?.[1] ?? null, data: JSON.parse(data) };
};
/** @param {string} text */
const framesIn = (text) => /** @type {{ sse: string | null, data: any }[]} */ (text.split("\n\n").map(frameOf).filter(Boolean));
const settle = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};
/** @param {() => boolean} ok @param {string} what */
const until = async (ok, what, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

/**
 * The stream route opened as the router would, on a scripted request and response: the test says when the reader is
 * slow (`writableNeedDrain`) and when it is back (`drain`), and when it leaves (`close`).
 * @param {any} memory @param {string} [query] @param {Record<string, string>} [headers]
 */
async function openStream(memory, query = "", headers = {}) {
  const sseClients = new Set();
  const hit = createRouter(memoryRoutes({ memory, usage: {}, sseClients }))("GET", "/memory/claims/stream");
  assert.ok(hit, "the stream's row");
  const req = Object.assign(new EventEmitter(), { headers });
  /** @type {string[]} */
  const writes = [];
  const res = Object.assign(new EventEmitter(), {
    status: 0,
    writableEnded: false,
    destroyed: false,
    writableNeedDrain: false,
    /** @param {number} s */
    writeHead(s) {
      res.status = s;
    },
    /** @param {string} chunk */
    write(chunk) {
      writes.push(chunk);
      return true;
    },
    /** @param {string} [chunk] */
    end(chunk) {
      if (chunk) writes.push(chunk);
      res.writableEnded = true;
    },
  });
  await hit.handler({ req, res, url: new URL(`http://x/api/memory/claims/stream${query}`), params: hit.params }, {});
  await settle();
  return {
    res,
    sseClients,
    raw: () => writes.join(""),
    frames: () => framesIn(writes.join("")),
    changes: () => framesIn(writes.join("")).filter((f) => f.data.type === "change"),
    leave: () => req.emit("close"),
  };
}

/** A session in a project, and a claim filed in it. @param {any} svc @param {string} key @param {string} project @param {string} text */
function claimIn(svc, key, project, text) {
  const ch = svc.archive.chainForKey(key, { project });
  return { ch, id: svc.archive.items.add({ projectId: project, chainId: ch.id, kind: "fact", text, origin: "learner" }).id };
}
/** @param {any} svc @param {number} id */
const said = (svc, id) => svc.archive.items.note(id, "evidence", { by: "learner", reason: "said again", detail: { chain: "x" } });
/** A memory service on a fresh folder, switched off (the archive opens all the same, with no engine), not started. */
function bare() {
  const dir = mkdtempSync(join(tmpdir(), "filament-fan-"));
  const cfg = { memory: { enabled: false, folder: join(dir, "memory"), privacy: { encryptArchive: false } } };
  const svc = /** @type {any} */ (new MemoryService({ getConfig: () => cfg, dataDir: dir }));
  return {
    svc,
    dir,
    cfg,
    done: async () => {
      await svc.shutdown();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("hello says where the stream starts; then each change, its id in the store's epoch, who and where, never its words", async () => {
  await world({}, async (w) => {
    const svc = w.svc;
    const { epoch, last } = svc.claimFeed();
    const s = await openStream(svc);
    assert.equal(s.res.status, 200);
    assert.deepEqual(s.frames(), [{ sse: `${epoch}:${last}`, data: { type: "hello", last: `${epoch}:${last}`, gap: false } }]);
    assert.equal(s.sseClients.size, 1, "shutdown can end it");
    const A = claimIn(svc, "k1", "p1", "The api listens on port 3000, said in a secret.");
    said(svc, A.id);
    await settle();
    const [created, again] = s.changes();
    assert.deepEqual(created.data, { type: "change", id: `${epoch}:${last + 1}`, claim: `i${A.id}`, action: "created", at: created.data.at, by: "learner", project: "p1", session: A.ch.id });
    assert.equal(created.sse, created.data.id, "the SSE id is the change's");
    assert.match(created.data.at, /^\d{4}-\d\d-\d\dT/);
    assert.deepEqual([again.data.id, again.data.action], [`${epoch}:${last + 2}`, "evidence"]);
    assert.ok(!s.frames().some((f) => JSON.stringify(f).includes("secret") || JSON.stringify(f).includes("said again")), "never a claim's words or a reason");
    // A dossier is a change with no claim, in its project.
    svc.archive.dossiers.add({ projectId: "p1", sections: [], cites: [], basis: "test" });
    await settle();
    assert.deepEqual(s.changes().at(-1)?.data, { type: "change", id: `${epoch}:${last + 3}`, claim: null, action: "dossier", at: s.changes().at(-1)?.data.at, by: "curator", project: "p1", session: null });
    s.leave();
    let reads = 0;
    const read = svc.claimChanges;
    svc.claimChanges = (/** @type {any} */ o) => (reads++, read.call(svc, o));
    said(svc, A.id);
    await settle();
    assert.deepEqual([s.changes().length, s.sseClients.size, reads], [3, 0, 0], "a reader gone: nothing read for it, nothing written, and shutdown has nothing to end");
  });
});

test("it resumes after Last-Event-ID or ?since=, each change once; an id it cannot resume from is a gap, and it starts after the newest", async () => {
  await world({}, async (w) => {
    const svc = w.svc;
    const A = claimIn(svc, "k1", "p1", "The queue drains every minute.");
    said(svc, A.id);
    said(svc, A.id);
    const { epoch } = svc.claimFeed();
    const from = svc.claimFeed().last;
    assert.ok(from >= 3, "rows before it, for the prune below to take");
    said(svc, A.id);
    said(svc, A.id);
    const newest = svc.claimFeed().last;
    for (const [how, query, headers] of /** @type {[string, string, Record<string, string>][]} */ ([
      ["Last-Event-ID", "", { "last-event-id": `${epoch}:${from}` }],
      ["since", `?since=${encodeURIComponent(`${epoch}:${from}`)}`, {}],
      ["Last-Event-ID over the since its URL still carries", `?since=${encodeURIComponent(`${epoch}:${newest}`)}`, { "last-event-id": `${epoch}:${from}` }],
    ])) {
      const s = await openStream(svc, query, headers);
      assert.deepEqual(s.frames()[0], { sse: `${epoch}:${from}`, data: { type: "hello", last: `${epoch}:${newest}`, gap: false } }, how);
      assert.deepEqual(s.changes().map((f) => f.data.id), [`${epoch}:${from + 1}`, `${epoch}:${from + 2}`], `${how}: the two made while away, each once`);
      s.leave();
    }
    const atNewest = await openStream(svc, "", { "last-event-id": `${epoch}:${newest}` });
    assert.deepEqual([atNewest.frames()[0].data.gap, atNewest.changes().length], [false, 0], "a reconnect at the newest missed nothing");
    atNewest.leave();
    // Pruned up to the rows before `from`: an id before them is a gap; the newest pruned is not.
    svc.archive.db.prepare("UPDATE claim_feed SET at = 0 WHERE id <= ?").run(from - 1);
    svc.archive.feed.prune(1);
    const pruned = svc.claimFeed().pruned;
    assert.equal(pruned, from - 1);
    const kept = await openStream(svc, `?since=${epoch}:${pruned}`);
    assert.equal(kept.frames()[0].data.gap, false, "from the newest pruned: nothing is lost");
    assert.equal(kept.changes().length, newest - pruned);
    kept.leave();
    for (const [why, since] of /** @type {[string, (top: number) => string][]} */ ([
      ["older than the oldest kept", () => `${epoch}:${pruned - 1}`],
      ["past the newest", (top) => `${epoch}:${top + 5}`],
      ["another store's", () => `0123456789ab:${from}`],
      ["no epoch", () => String(from)],
      ["no id", () => "nonsense"],
    ])) {
      const top = svc.claimFeed().last;
      const s = await openStream(svc, "", { "last-event-id": since(top) });
      assert.deepEqual(s.frames(), [{ sse: `${epoch}:${top}`, data: { type: "hello", last: `${epoch}:${top}`, gap: true } }], why);
      said(svc, A.id);
      await settle();
      assert.deepEqual(s.changes().map((f) => f.data.id), [`${epoch}:${svc.claimFeed().last}`], `${why}: on from the newest`);
      s.leave();
    }
  });
});

test("?project= gives that project's changes, the global ones and a claim moved out of it; an unknown project is 404, memory closed 503", async () => {
  await world({}, async (w) => {
    const svc = w.svc;
    claimIn(svc, "k2", "p2", "Elsewhere.");
    const A = claimIn(svc, "k1", "p1", "The queue drains every minute.");
    const s = await openStream(svc, "?project=p1");
    const B = claimIn(svc, "k3", "p2", "Another project's.");
    said(svc, B.id);
    const G = svc.archive.items.add({ projectId: null, chainId: A.ch.id, kind: "rule", text: "Answer in British English.", origin: "learner" }).id;
    said(svc, A.id);
    svc.archive.moveChain(A.ch.id, "p2");
    said(svc, A.id);
    await settle();
    assert.deepEqual(
      s.changes().map((f) => [f.data.claim, f.data.action, f.data.project, f.data.from ?? null]),
      [
        [`i${G}`, "created", null, null],
        [`i${A.id}`, "evidence", "p1", null],
        [`i${A.id}`, "moved", "p2", "p1"],
      ],
      "p2's claims are not p1's; a claim moved out is, the once; after, it is p2's",
    );
    s.leave();
    const unknown = await openStream(svc, "?project=nope");
    assert.deepEqual([unknown.res.status, unknown.sseClients.size], [404, 0]);
    const closed = await openStream({ isOpen: () => false, archiveWhy: () => "Memory has not started." });
    assert.deepEqual([closed.res.status, JSON.parse(closed.raw()).error], [503, "Memory has not started."]);
  });
});

test("a slow reader is waited for, never skipped: nothing is written until it drains, then every change, in order, each once", async () => {
  await world({}, async (w) => {
    const svc = w.svc;
    const A = claimIn(svc, "k1", "p1", "The queue drains every minute.");
    const s = await openStream(svc);
    s.res.writableNeedDrain = true;
    for (let i = 0; i < 450; i++) said(svc, A.id);
    await settle();
    assert.equal(s.changes().length, 0, "the reader is slow: nothing written");
    s.res.writableNeedDrain = false;
    // It drains a page at a time: the next wait comes after one change, and more land meanwhile.
    let drains = 0;
    const write = s.res.write;
    s.res.write = (/** @type {string} */ chunk) => {
      const r = write(chunk);
      s.res.writableNeedDrain = true;
      setImmediate(() => {
        drains++;
        s.res.writableNeedDrain = false;
        s.res.emit("drain");
      });
      return r;
    };
    s.res.emit("drain");
    for (let i = 0; i < 50; i++) said(svc, A.id);
    await until(() => s.changes().length >= 500, "every change");
    await settle();
    const ns = s.changes().map((f) => Number(String(f.data.id).split(":")[1]));
    assert.equal(ns.length, 500, "each once");
    assert.ok(ns.every((n, i) => i === 0 || n === ns[i - 1] + 1), "in order, none skipped");
    assert.ok(drains >= 499, `waited for the reader before each write (${drains})`);
    s.leave();
  });
});

test("memory reopened: the same store goes on where it was; another store says reset and goes on from its newest, and so does the first again", async () => {
  await world({}, async (w) => {
    const svc = w.svc;
    const A = claimIn(svc, "k1", "p1", "The queue drains every minute.");
    for (let i = 0; i < 4; i++) said(svc, A.id);
    const home = w.cfg.memory.folder;
    const s = await openStream(svc);
    const { epoch } = svc.claimFeed();
    svc.stop();
    svc.start();
    said(svc, A.id);
    await settle();
    assert.deepEqual(s.frames().slice(1).map((f) => f.data.type), ["change"], "the same store: no reset");
    assert.equal(svc.claimFeed().epoch, epoch);
    // Another folder: another store.
    w.cfg.memory.folder = join(w.dir, "elsewhere");
    svc.start();
    await settle();
    const next = svc.claimFeed();
    assert.notEqual(next.epoch, epoch);
    const reset = s.frames().at(-1);
    assert.deepEqual(reset, { sse: `${next.epoch}:${next.last}`, data: { type: "reset", last: `${next.epoch}:${next.last}` } });
    const B = claimIn(svc, "k1", "p1", "In the new store.");
    await settle();
    assert.deepEqual(s.changes().at(-1)?.data.id, `${next.epoch}:${next.last + 1}`);
    assert.equal(s.changes().at(-1)?.data.claim, `i${B.id}`);
    // Back to the first store, further on than this one: a reset to its newest, and nothing of it replayed.
    w.cfg.memory.folder = home;
    svc.start();
    await settle();
    const back = svc.claimFeed();
    assert.equal(back.epoch, epoch);
    assert.ok(back.last > next.last + 1, "the first store holds more rows than the stream read in the second");
    assert.deepEqual(s.frames().at(-1), { sse: `${epoch}:${back.last}`, data: { type: "reset", last: `${epoch}:${back.last}` } });
    said(svc, A.id);
    await settle();
    assert.deepEqual(s.changes().at(-1)?.data.id, `${epoch}:${back.last + 1}`, "then only what is new there");
    s.leave();
  });
});

test("the fan-out: each page of changes, its prev the last before, a burst read once; a rolled-back write tells nothing; a reset on another store, and none without changes", async () => {
  await world({}, async (w) => {
    const svc = w.svc;
    /** @type {any[]} */
    const told = [];
    svc.onClaims = (/** @type {any} */ m) => told.push(m);
    let wakes = 0;
    const unwatch = svc.watchClaims(() => wakes++);
    const A = claimIn(svc, "k1", "p1", "The queue drains every minute.");
    await settle();
    wakes = 0;
    for (let i = 0; i < 230; i++) said(svc, A.id);
    await settle();
    assert.equal(wakes, 1, "a burst wakes the streams once");
    const first = svc.claimFeed();
    assert.deepEqual(told.map((m) => m.changes.length), [1, 200, 30], "a page at a time");
    for (let i = 1; i < told.length; i++) assert.equal(told[i].prev, told[i - 1].last, `message ${i} chains`);
    assert.equal(told.at(-1).last, `${first.epoch}:${first.last}`);
    // A write rolled back: its row never was, and nobody is told of it.
    const n = told.length;
    assert.throws(() =>
      svc.archive.transaction(() => {
        said(svc, A.id);
        throw new Error("rolled back");
      }),
    );
    await settle();
    assert.deepEqual([told.length, svc.claimFeed().last], [n, first.last], "nothing told, no id spent");
    // A session deleted: its claims' rows go, the deleted ones are said; the next message chains all the same.
    const B = claimIn(svc, "k2", "p1", "Gone soon.");
    await settle();
    const before = told.length;
    svc.archive.deleteChain(B.ch.id);
    said(svc, A.id);
    await settle();
    assert.ok(told.length > before);
    for (let i = before; i < told.length; i++) assert.equal(told[i].prev, told[i - 1].last, `message ${i} chains`);
    const was = svc.claimFeed();
    // Another store: a reset; the wake it brings tells nothing more, and the next message chains on from it.
    const home = w.cfg.memory.folder;
    w.cfg.memory.folder = join(w.dir, "elsewhere");
    svc.start();
    const next = svc.claimFeed();
    const reset = { type: "claims", reset: true, last: `${next.epoch}:${next.last}` };
    assert.deepEqual(told.at(-1), reset);
    await settle();
    assert.deepEqual(told.at(-1), reset, "no message without changes");
    claimIn(svc, "k1", "p1", "In the new store.");
    await settle();
    assert.equal(told.at(-1).prev, `${next.epoch}:${next.last}`);
    // Back to the first store: a reset to where it stands, and then only what is new there.
    w.cfg.memory.folder = home;
    svc.start();
    assert.deepEqual(told.at(-1), { type: "claims", reset: true, last: `${was.epoch}:${was.last}` });
    said(svc, A.id);
    await settle();
    assert.deepEqual(told.at(-1).changes.map((/** @type {any} */ c) => c.id), [`${was.epoch}:${was.last + 1}`]);
    unwatch();
  });
});

test("the feed keeps 30 days: older rows are pruned when memory opens, newer ones stay", async () => {
  await world({}, async (w) => {
    const svc = w.svc;
    const A = claimIn(svc, "k1", "p1", "The queue drains every minute.");
    said(svc, A.id);
    said(svc, A.id);
    const { last } = svc.claimFeed();
    const day = 86_400_000;
    svc.archive.db.prepare("UPDATE claim_feed SET at = ? WHERE id <= ?").run(svc.archive.now() - 31 * day, last - 1);
    svc.archive.db.prepare("UPDATE claim_feed SET at = ? WHERE id = ?").run(svc.archive.now() - 29 * day, last);
    svc.stop();
    svc.start();
    assert.equal(svc.claimFeed().pruned, last - 1);
    assert.deepEqual(svc.claimChanges({ after: 0 }).changes.map((c) => c.id), [`${svc.claimFeed().epoch}:${last}`]);
  });
});

test("the feed is pruned once a day while memory is open, by a timer stop() clears", async (t) => {
  const timers = t.mock.method(globalThis, "setInterval");
  const clears = t.mock.method(globalThis, "clearInterval");
  const b = bare();
  try {
    b.svc.start();
    const daily = timers.mock.calls.filter((c) => c.arguments[1] === 86_400_000);
    assert.equal(daily.length, 1, "one timer, a day");
    const A = claimIn(b.svc, "k1", "p1", "The queue drains every minute.");
    said(b.svc, A.id);
    said(b.svc, A.id);
    const { last } = b.svc.claimFeed();
    b.svc.archive.db.prepare("UPDATE claim_feed SET at = ? WHERE id < ?").run(b.svc.archive.now() - 31 * 86_400_000, last);
    daily[0].arguments[0]();
    assert.equal(b.svc.claimFeed().pruned, last - 1, "a day on: the rows older than 30 days went");
    b.svc.stop();
    assert.ok(clears.mock.calls.some((c) => c.arguments[0] === daily[0].result), "closed: its timer is cleared");
  } finally {
    await b.done();
  }
});

test("every open says reset on the fan-out: the first, so a page that could not read meanwhile reads all; the same store after an open that failed; a reset's wake says nothing more", async () => {
  const b = bare();
  /** @type {any[]} */
  const told = [];
  b.svc.onClaims = (/** @type {any} */ m) => told.push(m);
  const reset = () => {
    const p = b.svc.claimFeed();
    return { type: "claims", reset: true, last: `${p.epoch}:${p.last}` };
  };
  try {
    // (fails before: yes — every reply without an archive said its folder "did not open", started or not)
    assert.equal(b.svc.archiveWhy(), "Memory has not started.");
    b.svc.start();
    assert.deepEqual(told, [reset()]);
    const { epoch } = b.svc.claimFeed();
    const home = b.cfg.memory.folder;
    writeFileSync(join(b.dir, "a-file"), "");
    b.cfg.memory.folder = join(b.dir, "a-file", "memory");
    b.svc.start();
    assert.equal(b.svc.isOpen(), false, "a folder that cannot be made: memory did not open");
    // (fails before: yes — the folder's failure reached the log alone, so a reply could only send the person there)
    assert.match(b.svc.archiveWhy(), /^Cannot create the memory folder .*a-file.*\.$/s, "and says why");
    assert.equal(told.length, 1, "nothing opened, nothing said");
    b.cfg.memory.folder = home;
    b.svc.start();
    assert.equal(b.svc.claimFeed().epoch, epoch, "the same store");
    assert.deepEqual(told.slice(1), [reset()], "a page that read while it was not open shows the failure: it reads all");
    await settle();
    assert.equal(told.length, 2);
    const A = claimIn(b.svc, "k1", "p1", "The queue drains every minute.");
    await settle();
    assert.deepEqual([told.length, told[2].prev, told[2].changes.map((/** @type {any} */ c) => c.claim)], [3, told[1].last, [`i${A.id}`]], "and goes on from it");
  } finally {
    await b.done();
  }
});

test("a fan-out or a watcher that throws is logged; the other watchers still hear, and the next message chains on from the one lost", async () => {
  await world({}, async (w) => {
    const svc = w.svc;
    /** @type {string[]} */
    const logs = [];
    svc.log = (/** @type {string} */ level, /** @type {string} */ msg) => logs.push(`${level} ${msg}`);
    let broken = true;
    /** @type {any[]} */
    const told = [];
    svc.onClaims = (/** @type {any} */ m) => {
      if (broken) throw new Error("the socket fell over");
      told.push(m);
    };
    let heard = 0;
    const offBroken = svc.watchClaims(() => {
      throw new Error("a watcher that breaks");
    });
    const off = svc.watchClaims(() => heard++);
    const A = claimIn(svc, "k1", "p1", "The queue drains every minute.");
    await settle();
    const lost = svc.claimFeed();
    assert.equal(heard, 1, "the watcher after the broken one heard");
    assert.deepEqual(logs.filter((l) => l.includes("claims")), ["warn memory: the claims fan-out failed: the socket fell over", "warn memory: a claims watcher failed: a watcher that breaks"]);
    broken = false;
    said(svc, A.id);
    await settle();
    assert.equal(told[0].prev, `${lost.epoch}:${lost.last}`, "the message lost said up to here: a page that missed it hears a prev it did not, and reads all");
    assert.equal(heard, 2);
    offBroken();
    off();
  });
});

test("a change made while the stream waits for its reader goes out once it drains, with no other wake", async () => {
  await world({}, async (w) => {
    const svc = w.svc;
    const A = claimIn(svc, "k1", "p1", "The queue drains every minute.");
    await settle();
    const s = await openStream(svc);
    s.res.writableNeedDrain = true;
    said(svc, A.id);
    await settle();
    said(svc, A.id);
    await settle();
    assert.equal(s.changes().length, 0, "the reader is slow");
    s.res.writableNeedDrain = false;
    s.res.emit("drain");
    await settle();
    const { epoch, last } = svc.claimFeed();
    assert.deepEqual(s.changes().map((f) => f.data.id), [`${epoch}:${last - 1}`, `${epoch}:${last}`], "the one it waited to write, and the one made meanwhile");
    s.leave();
  });
});

test("the stream pings every 25 s while its reader stays, and never once it left; a ping that cannot be written closes it", async (t) => {
  await world({}, async (w) => {
    const svc = w.svc;
    const A = claimIn(svc, "k1", "p1", "The queue drains every minute.");
    await settle();
    t.mock.timers.enable({ apis: ["setInterval"] });
    const s = await openStream(svc);
    const pings = () => s.raw().split(": ping\n\n").length - 1;
    t.mock.timers.tick(24_999);
    assert.equal(pings(), 0);
    t.mock.timers.tick(1);
    t.mock.timers.tick(25_000);
    assert.equal(pings(), 2);
    s.leave();
    t.mock.timers.tick(75_000);
    assert.equal(pings(), 2, "gone: no more");
    const dead = await openStream(svc);
    dead.res.destroyed = true;
    t.mock.timers.tick(25_000);
    let reads = 0;
    svc.claimChanges = () => (reads++, { changes: [], through: 0 });
    try {
      said(svc, A.id);
      await settle();
      assert.deepEqual([dead.sseClients.size, reads], [0, 0], "closed: off the shutdown list, and no longer woken");
    } finally {
      delete svc.claimChanges;
    }
  });
});

test("a read that fails ends the stream with an error frame, unwatched; a change while memory is closed waits for it to open", async () => {
  await world({}, async (w) => {
    const svc = w.svc;
    const A = claimIn(svc, "k1", "p1", "The queue drains every minute.");
    await settle();
    const s = await openStream(svc);
    said(svc, A.id);
    svc.stop();
    await settle();
    assert.equal(s.res.writableEnded, false, "memory closed before the wake: the stream waits");
    await w.withEngine(async () => svc.start());
    said(svc, A.id);
    await settle();
    const { epoch, last } = svc.claimFeed();
    assert.deepEqual(s.changes().map((f) => f.data.id), [`${epoch}:${last - 1}`, `${epoch}:${last}`], "open again: the change made before it closed, and the next");
    svc.claimChanges = () => {
      throw new Error("the disk fell over");
    };
    try {
      said(svc, A.id);
      await settle();
      assert.deepEqual(s.frames().at(-1), { sse: null, data: { type: "error", error: "the disk fell over" } });
      assert.deepEqual([s.res.writableEnded, s.sseClients.size], [true, 0]);
    } finally {
      delete svc.claimChanges;
    }
    let reads = 0;
    const read = svc.claimChanges;
    svc.claimChanges = (/** @type {any} */ o) => (reads++, read.call(svc, o));
    try {
      said(svc, A.id);
      await settle();
      assert.equal(reads, 0, "no longer woken");
    } finally {
      delete svc.claimChanges;
    }
  });
});

test("end to end: a confirm through the route reaches a reader with its id; a reconnect resumes after it; the events fan-out carries the same", async () => {
  const shim = await startApp({ memory: true });
  /** @type {AbortController[]} */
  const open = [];
  /** A stream over HTTP, read as it comes. @param {string} path @param {Record<string, string>} [more] */
  const listen = async (path, more = {}) => {
    const ctl = new AbortController();
    open.push(ctl);
    const res = await fetch(shim.url + path, { headers: { ...shim.headers, ...more }, signal: ctl.signal });
    /** @type {{ sse: string | null, data: any }[]} */
    const frames = [];
    const reader = /** @type {ReadableStream<Uint8Array>} */ (res.body).getReader();
    const dec = new TextDecoder();
    let buf = "";
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buf += dec.decode(value, { stream: true });
          for (let i; (i = buf.indexOf("\n\n")) >= 0; ) {
            const f = frameOf(buf.slice(0, i));
            buf = buf.slice(i + 2);
            if (f) frames.push(f);
          }
        }
      } catch {}
    })();
    return { status: res.status, frames, close: () => ctl.abort() };
  };
  try {
    const mem = /** @type {any} */ (shim.app).memory;
    await mem.engineStart;
    const ch = mem.archive.chainForKey("k1", { project: "p1" });
    const id = mem.archive.items.add({ projectId: "p1", chainId: ch.id, kind: "fact", text: "The api listens on port 3000.", origin: "learner" }).id;
    const fan = await listen("/api/events");
    const s = await listen("/api/memory/claims/stream");
    await until(() => s.frames.length >= 1 && fan.frames.length >= 1, "both hellos");
    assert.equal(s.status, 200);
    const confirmed = await shim.api(`/api/memory/items/${id}`, { method: "POST", body: { status: "confirmed" } });
    assert.equal(confirmed.status, 200);
    await until(() => s.frames.some((f) => f.data.action === "status"), "the confirm on the stream");
    const status = /** @type {any} */ (s.frames.find((f) => f.data.action === "status"));
    assert.deepEqual([status.data.claim, status.data.by, status.data.project, status.data.session, status.sse], [`i${id}`, "owner", "p1", ch.id, status.data.id]);
    await until(() => fan.frames.some((f) => f.data.type === "claims" && f.data.changes.some((/** @type {any} */ c) => c.id === status.data.id)), "the confirm on the fan-out");
    // Away, two changes; back with the last id it had: those two, each once, then live.
    s.close();
    const lastSeen = /** @type {string} */ (s.frames.at(-1)?.sse);
    for (let i = 0; i < 2; i++) mem.archive.items.note(id, "evidence", { by: "learner", detail: { chain: "x" } });
    const back = await listen("/api/memory/claims/stream", { "last-event-id": lastSeen });
    await until(() => back.frames.filter((f) => f.data.type === "change").length >= 2, "the two made while away");
    assert.deepEqual(back.frames[0].data, { type: "hello", last: `${mem.claimFeed().epoch}:${mem.claimFeed().last}`, gap: false });
    mem.archive.items.note(id, "evidence", { by: "learner", detail: { chain: "x" } });
    await until(() => back.frames.filter((f) => f.data.type === "change").length >= 3, "the live one");
    const ns = back.frames.filter((f) => f.data.type === "change").map((f) => Number(String(f.data.id).split(":")[1]));
    assert.deepEqual(ns, [1, 2, 3].map((k) => Number(lastSeen.split(":")[1]) + k), "after the id it had, each once");
    // The fan-out's messages chain.
    const msgs = fan.frames.filter((f) => f.data.type === "claims").map((f) => f.data);
    for (let i = 1; i < msgs.length; i++) assert.equal(msgs[i].prev, msgs[i - 1].last);
  } finally {
    for (const c of open) c.abort();
    await shim.stop();
  }
});

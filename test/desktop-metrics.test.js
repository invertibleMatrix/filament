// @ts-check
// Filament's memory, written as it goes (the owner's of 11-17): each minute the app reads its processes, and every ten
// it writes one line to memory.log, always — each process's private memory now and its most since the last line, the
// windows named, the server's own census while it is fresh, and "absent" where there is none; a process that went is
// let go of; a reading that fails is said; and what was seen of a process last is there for a crash's line.
// (fails before: yes — nothing in the app read its own memory)
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CENSUS_STALE_MS, LINE_EVERY, createMemorySampler } from "../desktop/lib/metrics.js";

/** @param {number} pid @param {string} type @param {number} privMB @param {Record<string, string>} [more] */
const proc = (pid, type, privMB, more = {}) => ({ pid, type, ...more, memory: { privateBytes: privMB * 1024, workingSetSize: (privMB - 100) * 1024 } });

/** A sampler over processes the test moves. */
function sampled() {
  /** @type {string[]} */
  const lines = [];
  let t = Date.parse("2026-11-17T10:00:00Z");
  /** @type {any[]} */
  let procs = [proc(1, "Browser", 120), proc(2, "Utility", 1900, { name: "Filament server", serviceName: "node.mojom.NodeService" }), proc(3, "Tab", 2400), proc(4, "GPU", 300)];
  const s = createMemorySampler({ metrics: () => procs, windows: () => [{ name: "the harness window", pid: 3 }], write: (l) => lines.push(l), now: () => t });
  return { s, lines, set: (/** @type {any[]} */ p) => void (procs = p), at: (/** @type {number} */ ms) => void (t += ms) };
}

describe("the memory log", () => {
  test("the first reading writes a line: each process named, its private memory, the windows by name, no census yet", () => {
    const { s, lines } = sampled();
    s.sample();
    assert.equal(lines.length, 1);
    const l = JSON.parse(lines[0]);
    assert.equal(l.at, "2026-11-17T10:00:00.000Z");
    assert.deepEqual(
      l.procs.map((/** @type {any} */ p) => [p.kind, p.name ?? null, p.pid, p.mb, p.peakMB]),
      [
        ["app", null, 1, 120, 120],
        ["server", null, 2, 1900, 1900],
        ["window", "the harness window", 3, 2400, 2400],
        ["gpu", null, 4, 300, 300],
      ],
    );
    assert.equal(l.totalMB, 4720);
    assert.match(l.server, /^absent/);
  });

  test("a line every ten readings, each process's most since the last line in it: a spike between lines is kept", () => {
    const { s, lines, set, at } = sampled();
    s.sample();
    for (let i = 1; i < LINE_EVERY; i++) {
      at(60_000);
      set([proc(1, "Browser", 120), proc(3, "Tab", i === 4 ? 13084 : 2500)]);
      s.sample();
    }
    assert.equal(lines.length, 1, "nine readings in between write nothing");
    at(60_000);
    set([proc(1, "Browser", 120), proc(3, "Tab", 2600)]);
    s.sample();
    assert.equal(lines.length, 2);
    const w = JSON.parse(lines[1]).procs.find((/** @type {any} */ p) => p.pid === 3);
    assert.deepEqual([w.mb, w.peakMB], [2600, 13084], "the 13 GB spike between lines is in the line");
    assert.equal(JSON.parse(lines[1]).procs.some((/** @type {any} */ p) => p.pid === 2), false, "a process that went is gone from it");
    assert.equal(s.lastOf(2), null);
    assert.deepEqual(s.lastOf(3)?.peakMB, 2600, "the most starts again from now after a line");
  });

  // (fails before: yes — the review of step 1: a census older than three minutes was dropped as "absent", so a server
  // that hung or died lost exactly the numbers that mattered, and its end wrote nothing)
  test("the server's last census is in each line with its age, marked stale once it stops coming; absent only where none was heard", () => {
    const { s, lines, at } = sampled();
    s.serverStarted(2);
    s.heard({ heapUsedMB: 800, subagents: { kept: 12, keptCharsM: 135 } });
    s.sample();
    assert.deepEqual(JSON.parse(lines[0]).server, { heapUsedMB: 800, subagents: { kept: 12, keptCharsM: 135 }, ageS: 0 });
    for (let i = 0; i < LINE_EVERY; i++) {
      at(Math.ceil(CENSUS_STALE_MS / LINE_EVERY) + 1000);
      s.sample();
    }
    const stale = JSON.parse(lines[1]).server;
    assert.deepEqual([stale.heapUsedMB, stale.ageS, stale.stale], [800, 190, true], "the hung server's last numbers stand, with their age");
    s.heard(null);
    s.heard("not a census");
    assert.equal(JSON.parse(lines[1]).server.heapUsedMB, 800, "nothing that is no census replaces it");
    const fresh = sampled();
    fresh.s.serverStarted(2);
    fresh.s.sample();
    assert.match(JSON.parse(fresh.lines[0]).server, /^absent: no census heard from this server/);
  });

  test("the server is the fork's own process, whatever Electron names it; its end writes its last numbers at once and forgets it", () => {
    const { s, lines, at } = sampled();
    s.sample();
    assert.equal(JSON.parse(lines[0]).procs.find((/** @type {any} */ p) => p.pid === 2).kind, "server", "before its pid is known: by Electron's name for it");
    s.serverStarted(2);
    s.heard({ heapUsedMB: 1500 });
    at(30_000);
    s.sample();
    s.serverEnded(-1073741571);
    const end = JSON.parse(lines[1]).serverEnded;
    assert.deepEqual([end.exitCode, end.pid, end.last.mb, end.census.heapUsedMB, end.census.ageS], [-1073741571, 2, 1900, 1500, 30]);
    s.serverStarted(77);
    for (let i = 0; i < LINE_EVERY - 1; i++) s.sample();
    const next = JSON.parse(lines[2]);
    assert.equal(next.procs.find((/** @type {any} */ p) => p.pid === 2).kind, "utility", "the old process is no longer the server");
    assert.match(next.server, /^absent/, "the next server's census is its own");
  });

  test("two windows on one process are both named; off Windows the measure is the working set, and says so", () => {
    /** @type {string[]} */
    const lines = [];
    const s = createMemorySampler({
      metrics: () => [{ pid: 5, type: "Tab", memory: { workingSetSize: 512 * 1024 } }],
      windows: () => [{ name: "the harness window", pid: 5 }, { name: "a window a page opened", pid: 5 }],
      write: (l) => lines.push(l),
      now: () => 1,
    });
    s.sample();
    assert.equal(JSON.parse(lines[0]).procs[0].name, "the harness window + a window a page opened");
    assert.deepEqual(s.lastOf(5), { mb: 512, peakMB: 512, at: 1, measure: "working set" });
  });

  test("a reading that fails is said and keeps nothing; what was seen last of a process is there for a crash's line", () => {
    /** @type {string[]} */
    const lines = [];
    let fail = false;
    const s = createMemorySampler({
      metrics: () => {
        if (fail) throw new Error("no metrics");
        return [proc(9, "Tab", 3000)];
      },
      windows: () => [],
      write: (l) => lines.push(l),
      now: () => 5_000,
    });
    s.sample();
    assert.deepEqual(s.lastOf(9), { mb: 3000, peakMB: 3000, at: 5_000, measure: "private" });
    fail = true;
    s.sample();
    assert.match(JSON.parse(lines[1]).error, /the processes could not be read: no metrics/);
    assert.deepEqual(s.lastOf(9)?.mb, 3000);
  });
});

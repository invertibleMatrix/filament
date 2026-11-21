// @ts-check
// An app's glance on Home (the Space Apps plan of 10-29, phase 3): up to four status lines over its own sources, each a
// dashboard's status tile, which Home's At a glance shows once the person switches Show on Home on — the app's page
// draws everything else. Words, not part of a Keep: a version that changes only its glance is live at once.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GLANCE_MAX, appOf } from "../src/core/artifact-content.js";
import { grantOf, sameGrant } from "../src/core/dashboard-sources.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createDashboardRunner } from "../src/services/dashboard-runner.js";
import { artifactCall } from "../src/app/agent/artifacts.js";
import { glanceMenuWords } from "../src/ui/harness/lib/space-dashboards.js";
import { glanceWords } from "../src/ui/harness/lib/your-space.js";

const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function fresh() {
  const d = mkdtempSync(join(tmpdir(), "filament-app-glances-"));
  dirs.push(d);
  return d;
}

const RUNS = { command: ["node", "runs.mjs"], rows: "runs", key: "id", columns: { id: "id", conclusion: "conclusion", title: "title", updated: "updated" } };
const LINE = { title: "CI", from: "runs", field: "conclusion", words: "{title}", age: "updated", bad: { conclusion: "failure" }, good: { conclusion: "success" } };
const APP = { type: "app", title: "Pipeline", html: "<!doctype html><title>Pipeline</title><main></main>", sources: { runs: RUNS }, glance: [LINE] };
const NAME = "pipeline-ab12";
const NOW = Date.UTC(2026, 9, 29, 16, 0);
const at = () => ({ who: "c1", by: { chain: "c1", model: "m", folder: "/work/app", helper: null }, within: [], port: 20300, maxBytes: 1_000_000 });

describe("what an app may declare", () => {
  // (fails before: yes — glance was refused as no field of an app's, and an app had nothing for At a glance)
  test("status lines over its own sources, each checked as a dashboard's status tile; another's source, a missing field or too many refused in words", () => {
    const r = appOf(APP);
    assert.deepEqual(r.ok && r.content.glance, [{ ...LINE, kind: "status" }], "kept as a status tile");
    assert.match(/** @type {any} */ (appOf({ ...APP, glance: [] })).error, /^glance is a list of status lines over its own sources, 4 at most/);
    assert.match(/** @type {any} */ (appOf({ ...APP, glance: Array.from({ length: GLANCE_MAX + 1 }, () => LINE) })).error, /4 at most/);
    assert.equal(/** @type {any} */ (appOf({ ...APP, glance: [{ ...LINE, from: "usage-by-day" }] })).error, "glance's line 1 (CI) reads usage-by-day, which is none of its own sources (runs)");
    assert.equal(/** @type {any} */ (appOf({ ...APP, glance: [{ ...LINE, field: "colour" }] })).error, 'glance\'s line 1 (CI) shows the field "colour", which runs does not have: its columns are id, conclusion, title, updated');
    assert.match(/** @type {any} */ (appOf({ ...APP, glance: [{ from: "runs", field: "conclusion" }] })).error, /^glance's line 1 has no title/);
    assert.match(/** @type {any} */ (appOf({ ...APP, sources: undefined, glance: [LINE] })).error, /reads runs, which is none of its own sources: an app with a glance reads a source/);
  });

  test("words, not part of a Keep; a page's publish is refused it", () => {
    const a = appOf(APP);
    const b = appOf({ ...APP, glance: [{ ...LINE, title: "Main's CI" }] });
    assert.ok(a.ok && b.ok && sameGrant(grantOf(a.content), grantOf(b.content)));
    const art = createArtifactStore({ dataDir: fresh(), log: () => {}, now: () => NOW, four: () => "ab12" });
    const page = /** @type {any} */ (artifactCall({ action: "publish", type: "page", title: "P", html: "<p>x</p>", glance: [LINE] }, at(), art));
    assert.equal(page.ok, false);
    assert.match(page.text || page.error, /glance is for an app/);
  });
});

describe("on Home's At a glance", () => {
  /** A runner whose Pipeline app is published by c1 and kept in p1; its source answers `says.out`. */
  function world() {
    const artifacts = createArtifactStore({ dataDir: fresh(), log: () => {}, now: () => NOW, four: () => "ab12" });
    const spaces = createSpaceStore({ dir: null, now: () => NOW });
    const says = { out: JSON.stringify({ runs: [{ id: 7, conclusion: "failure", title: "Fix login", updated: new Date(NOW - 12 * 60_000).toISOString() }] }) };
    const run = async () => ({ ok: /** @type {const} */ (true), out: says.out });
    const runner = createDashboardRunner({ spaces, artifacts, folderOf: () => "/work/app", projectOfChain: () => "p1", now: () => NOW, run });
    const publish = (/** @type {any} */ input) => artifactCall({ action: "publish", ...input }, at(), artifacts);
    assert.ok(publish(APP).ok);
    assert.equal(runner.keep("p1", NAME, 1).ok, true);
    return { runner, spaces, publish, says };
  }

  // (fails before: yes — an app had no status tile, so Show on Home stayed off and At a glance had nothing of it)
  test("kept, its glance counts as its status lines; switched on, At a glance reads its source and says each line as a status tile", async () => {
    const w = world();
    const d = /** @type {any} */ (w.runner.shown("p1")[0]);
    assert.deepEqual([d.type, d.statuses, d.reads.glance], ["app", 1, ["CI"]]);
    assert.equal(glanceMenuWords(d, d.statuses), "Its glance in Home's At a glance: CI");
    assert.deepEqual(w.runner.glance(), [], "off until you switch it on");
    w.runner.setGlance("p1", NAME, true);
    await w.runner.read(NAME, 1, "runs", { force: true });
    const [card] = w.runner.glance();
    assert.deepEqual([card.name, card.title, card.paused, card.tiles.length], [NAME, "Pipeline", false, 1]);
    const t = card.tiles[0];
    assert.deepEqual([t.title, t.from, t.read, t.stale], ["CI", "runs", true, false]);
    assert.deepEqual(glanceWords(/** @type {any} */ (t), NOW), { value: "failure", tone: "bad", under: "Fix login · 12 min ago", faint: "" });
  });

  test("a version that changes only its glance is live at once; one with none has nothing to show, said so", () => {
    const w = world();
    assert.ok(w.publish({ ...APP, id: NAME, glance: [{ ...LINE, title: "Main's CI" }, { title: "Last run", from: "runs", field: "id" }] }).ok);
    const d = /** @type {any} */ (w.runner.shown("p1")[0]);
    assert.deepEqual([d.draft, d.liveV, d.statuses, d.reads.glance], [false, 2, 2, ["Main's CI", "Last run"]]);
    assert.ok(w.publish({ ...APP, id: NAME, glance: undefined }).ok);
    const none = /** @type {any} */ (w.runner.shown("p1")[0]);
    assert.equal(none.statuses, 0);
    assert.equal(glanceMenuWords(none, 0), "It has no glance: an agent adds one (glance, status lines over its sources)");
    assert.equal(glanceMenuWords(/** @type {any} */ ({ type: "dashboard" }), 2), "Its 2 status tiles in Home's At a glance, in this tab's words", "a dashboard's words as before");
  });
});

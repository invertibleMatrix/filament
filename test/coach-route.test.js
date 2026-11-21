// @ts-check
// The first-run tips' file and route (the owner's FTUE of 11-09): the steps are src/ui/harness/coach/coach.json, edited
// by hand and read at each ask; the steps seen are the data folder's (`ui.coach.seen`); `replayOnRestart` forgets them —
// and that the welcome tour was seen — once per start of Filament.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp } from "./helpers/app.js";
import { COACH_FILE, readCoach } from "../src/http/admin/coach.js";
import { CONFIG_SCHEMA } from "../src/core/schema.js";

// (fails before: yes — there was no tips' file nor its reader)
test("the tips' file reads as the page draws it: a step's defaults filled, a broken one left out and said why", () => {
  const c = readCoach(JSON.stringify({
    steps: [
      { id: "a", target: ".x", title: "A", text: "Words" },
      { id: "b", target: ".y", enabled: false, group: "g", when: "subagent", after: "a", place: "left" },
      { target: ".z" },
      { id: "a", target: ".w" },
      { id: "c" },
      { id: "d", target: ".d", place: "middle", after: "nope" },
    ],
  }));
  assert.ok(c.ok);
  if (!c.ok) return;
  assert.equal(c.enabled, true, "on unless the file says enabled: false");
  assert.equal(c.replayOnRestart, false, "replay only where the file says so");
  assert.deepEqual(c.steps.map((s) => s.id), ["a", "b", "d"]);
  assert.deepEqual(c.steps[0], { id: "a", enabled: true, group: "", target: ".x", when: "", after: "", place: "bottom", title: "A", text: "Words", dim: null });
  assert.deepEqual([c.steps[1].enabled, c.steps[1].group, c.steps[1].when, c.steps[1].after, c.steps[1].place], [false, "g", "subagent", "a", "left"]);
  assert.equal(c.steps[2].place, "bottom", "a place it does not know is the default");
  assert.deepEqual(c.problems, [
    "step 3 has no id: it is left out",
    "a is named twice: the second is left out",
    "c names no target: it is left out",
    "d: place is one of top, bottom, left, right, not middle",
    "d comes after nope, which is no step: it never shows",
  ]);
  const bad = readCoach("{ steps: [ }");
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /^coach\.json is not JSON: /);
  assert.equal(readCoach("[]").ok, false, "a list is no file of tips");
  assert.equal(readCoach("﻿{\"enabled\": false, \"steps\": []}").ok, true, "a file saved with a byte-order mark reads");
});

// (fails before: yes — the owner's of 11-09: "dim the background"; the file had no shade)
test("dim: how dark the page goes behind a tip, the file's or a step's own; one out of bounds is said and not used", () => {
  const c = readCoach(JSON.stringify({ dim: 0.6, steps: [{ id: "a", target: ".a" }, { id: "b", target: ".b", dim: 0 }, { id: "c", target: ".c", dim: 2 }, { id: "n", target: ".n", dim: null }] }));
  assert.ok(c.ok);
  if (!c.ok) return;
  assert.equal(c.dim, 0.6);
  assert.deepEqual(c.steps.map((s) => s.dim), [null, 0, null, null], "b's own: none; c's out of bounds and n's null: the file's");
  assert.deepEqual(c.problems, ["c: dim is a number from 0 to 0.9, not 2: the file's is used"]);
  const off = readCoach(JSON.stringify({ dim: "dark", steps: [] }));
  assert.ok(off.ok);
  if (!off.ok) return;
  assert.equal(off.dim, 0.7, "the default where the file's is none");
  assert.deepEqual(off.problems, ['coach.json: dim is a number from 0 to 0.9, not "dark": 0.7 is used']);
  const unsaid = readCoach(JSON.stringify({ steps: [] }));
  assert.equal(unsaid.ok && unsaid.dim, 0.7);
});

// (fails before: yes — no file)
test("the tips Filament ships read clean, each with its words, and never replay on restart", () => {
  const c = readCoach(readFileSync(COACH_FILE, "utf8"));
  assert.ok(c.ok, c.ok ? "" : c.error);
  if (!c.ok) return;
  assert.deepEqual(c.problems, []);
  assert.ok(c.steps.length >= 5);
  for (const s of c.steps) assert.ok(s.title && s.text, `${s.id} has a title and words`);
  assert.equal(c.replayOnRestart, false, "replayOnRestart is the owner's switch while trying tips out: what ships has it off, or every person sees every tip after each restart");
  assert.deepEqual(/** @type {any} */ (CONFIG_SCHEMA).ui.coach.seen.default, []);
});

// (fails before: yes — 404: no /coach route)
test("the page reads the tips and the steps seen, and a step seen is kept for the data folder", async () => {
  const shim = await startApp({});
  try {
    const first = await (await shim.api("/api/coach")).json();
    assert.equal(first.enabled, true);
    assert.deepEqual(first.seen, []);
    assert.equal(first.replayed, false);
    assert.equal(first.dim, 0.7, "the page is told how dark to go");
    assert.ok(first.steps.some((/** @type {any} */ s) => s.id === "start-folder" && s.target === ".chooser-chip"));
    const w = await shim.api("/api/coach/seen", { method: "POST", body: { ids: ["start-folder", " start-folder ", "agents-tab"] } });
    assert.equal(w.status, 200, await w.clone().text());
    assert.deepEqual((await w.json()).seen, ["start-folder", "agents-tab"]);
    assert.deepEqual((await (await shim.api("/api/coach")).json()).seen, ["start-folder", "agents-tab"]);
    assert.deepEqual((await (await shim.api("/api/state")).json()).config?.ui?.coach?.seen, ["start-folder", "agents-tab"]);
    const none = await shim.api("/api/coach/seen", { method: "POST", body: { ids: [] } });
    assert.equal(none.status, 400);
    assert.match((await none.json()).error, /name the tips seen/);
    // Show tips again: every tip to see once more.
    const reset = await shim.api("/api/coach/reset", { method: "POST", body: {} });
    assert.equal(reset.status, 200);
    assert.deepEqual((await reset.json()).seen, []);
    assert.deepEqual((await (await shim.api("/api/coach")).json()).seen, []);
  } finally {
    await shim.stop();
  }
});

// (fails before: yes — 404)
test("replayOnRestart: the first ask after a start forgets the tips seen and the tour seen, once; a broken file is said in words", async () => {
  const dir = mkdtempSync(join(tmpdir(), "coach-"));
  const file = join(dir, "coach.json");
  const had = process.env.FILAMENT_COACH_FILE;
  process.env.FILAMENT_COACH_FILE = file;
  const shim = await startApp({});
  try {
    writeFileSync(file, JSON.stringify({ steps: [{ id: "a", target: ".a", title: "A", text: "a" }] }));
    await shim.api("/api/coach/seen", { method: "POST", body: { ids: ["a"] } });
    await shim.api("/api/config/fields", { method: "PATCH", body: { set: { "ui.welcome.seen": true } } });
    // Off: nothing is forgotten.
    const off = await (await shim.api("/api/coach")).json();
    assert.deepEqual([off.replayed, off.seen], [false, ["a"]]);
    // On, edited while Filament runs: this start has not replayed yet, so the first ask does — once.
    writeFileSync(file, JSON.stringify({ replayOnRestart: true, steps: [{ id: "a", target: ".a", title: "A", text: "a" }] }));
    const on = await (await shim.api("/api/coach")).json();
    assert.deepEqual([on.replayed, on.replayWelcomeTour, on.seen], [true, true, []]);
    assert.equal((await (await shim.api("/api/state")).json()).config?.ui?.welcome?.seen, false, "the tour opens by itself again");
    await shim.api("/api/coach/seen", { method: "POST", body: { ids: ["a"] } });
    const again = await (await shim.api("/api/coach")).json();
    assert.deepEqual([again.replayed, again.seen], [false, ["a"]], "a reload of the page is no restart");
    // A file not JSON: no tips, and why.
    writeFileSync(file, "{ nope");
    const broken = await (await shim.api("/api/coach")).json();
    assert.equal(broken.enabled, false);
    assert.match(broken.error, /^coach\.json is not JSON: /);
  } finally {
    await shim.stop();
    if (had === undefined) delete process.env.FILAMENT_COACH_FILE;
    else process.env.FILAMENT_COACH_FILE = had;
  }
  // A new start replays again.
  process.env.FILAMENT_COACH_FILE = file;
  writeFileSync(file, JSON.stringify({ replayOnRestart: true, replayWelcomeTour: false, steps: [{ id: "a", target: ".a", title: "A", text: "a" }] }));
  const next = await startApp({});
  try {
    await next.api("/api/coach/seen", { method: "POST", body: { ids: ["a"] } });
    // Its first ask came after the write above: this start's replay forgets it.
    const r = await (await next.api("/api/coach")).json();
    assert.deepEqual([r.replayed, r.replayWelcomeTour, r.seen], [true, false, []]);
  } finally {
    await next.stop();
    if (had === undefined) delete process.env.FILAMENT_COACH_FILE;
    else process.env.FILAMENT_COACH_FILE = had;
  }
});

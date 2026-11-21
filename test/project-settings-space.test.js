// @ts-check
// A project's settings read with the Space that shows it (a Hunter's find on the skills feature, HarnessV4_Skills_Plan §
// As built, "Left"). GET /api/projects/:id/settings resolved the project's layer against your defaults alone, so the
// skills, plugins and connectors a Space of yours passes down were missing from what it said is in force there — though
// every chat of the project got them (session-settings.js `resolveChainSettings`).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp } from "./helpers/app.js";

/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let dir;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), "filament-project-space-"));
  shim = await startApp({ memory: true });
});
after(async () => {
  await shim.stop();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});

/** A plain chat in a folder of its own; its project's id. @param {string} name */
const projectIn = async (name) => {
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: mkdtempSync(join(dir, `${name}-`)), model: "any-model", preset: "plain" } });
  assert.equal(r.status, 200, await r.clone().text());
  const id = String((await r.json()).id);
  return String((await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`)).json()).projectId);
};

// (fails before: yes — the project's settings said skills.on [] from the default, the Space's skill missing)
test("a project's settings say what the Space that shows it passes down, as the project's; what the project sets itself stays over it", async () => {
  const api = await projectIn("api");
  const work = await projectIn("work");
  const a = shim.app.memory.archive;
  assert.ok(a, "memory's archive is open");
  a.spaceOf = (/** @type {string} */ id) => (id === api ? work : null);
  a.setProjectSettings(work, { skills: { on: [{ name: "books" }, { name: "grids" }] } });
  a.setProjectSettings(api, { skills: { on: [{ name: "grids", enabled: false }, { name: "pdf" }] } });
  const r = await shim.api(`/api/projects/${encodeURIComponent(api)}/settings`);
  assert.equal(r.status, 200, await r.clone().text());
  const { resolved } = await r.json();
  assert.deepEqual([resolved.flat["skills.on"], resolved.sources["skills.on"]], [[{ name: "books" }, { name: "pdf" }], "project"], "the Space's books with the project's pdf; grids, which the project turned off, is not there");
  const own = await (await shim.api(`/api/projects/${encodeURIComponent(work)}/settings`)).json();
  assert.deepEqual(own.resolved.flat["skills.on"], [{ name: "books" }, { name: "grids" }], "the Space's own project says its own");
});

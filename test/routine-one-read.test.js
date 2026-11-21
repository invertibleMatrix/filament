// @ts-check
// One routine's read (the owner's of 11-12: a watcher is proposed in the chat, whose card draws it): GET
// /space/:project/routines/:id answers the routine row as the Space's own read builds it — its words, the model it
// runs on, its chat's name — and the project's name its sheet says, so the card under the call reads the one it
// proposed, not the whole Space; one that is not there, or a project with no Space, is a 404. It only reads: no press.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeDirs } from "./helpers/wait.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { routineFields } from "../src/core/routines.js";
import { spaceRoutes } from "../src/http/admin/spaces.js";
import { createRouter } from "../src/http/router.js";
import { NO_PRESS, pressClass } from "../src/http/admin/press.js";

const dirs = /** @type {string[]} */ ([]);
after(() => removeDirs(...dirs));

function world() {
  const dir = mkdtempSync(join(tmpdir(), "filament-r1-"));
  dirs.push(dir);
  const spaces = createSpaceStore({ dir, madeOnly: true, now: () => new Date(2026, 10, 12, 9).getTime() });
  spaces.make("p1");
  const f = routineFields({ title: "Main moved", text: "Main has new commits.", trigger: { kind: "commit", branch: "main" } }, { create: true });
  assert.ok(f.ok, JSON.stringify(f));
  const r = spaces.routinePropose("p1", f.fields, { chain: "c1", byName: "Release", model: "m-1", nameOf: () => "Release" });
  const rows = spaceRoutes(/** @type {any} */ ({
    config: { get: () => ({ agentLoop: { roots: [tmpdir()] }, server: {} }) },
    memory: { archive: { getProject: (/** @type {string} */ id) => (id === "p1" || id === "p2" ? { id, name: id === "p1" ? "app" : "site", cwd: "/work/app" } : null) } },
    spaces,
  }));
  /** @param {string} method @param {string} path @param {any} [json] */
  const call = async (method, path, json) => {
    const m = createRouter(rows)(method, path);
    assert.ok(m, `${method} ${path} matched a row`);
    const got = { status: 0, body: /** @type {any} */ (null) };
    const res = { headersSent: false, writableEnded: false, writeHead: (/** @type {number} */ s) => Object.assign(got, { status: s }), end: (/** @type {string} */ b) => void Object.assign(got, { body: JSON.parse(String(b)) }) };
    await m.handler({ res, req: { headers: {} }, url: new URL(`http://localhost/api${path}`), params: m.params, json: async () => json }, {});
    return got;
  };
  return { spaces, r, call };
}

describe("one routine's read", () => {
  // (fails before: yes — no row answered it)
  test("the row as the Space's read builds it, with its project's name; switched on, it says so; none there, or no Space, a 404", async () => {
    const w = world();
    const one = await w.call("GET", `/space/p1/routines/${w.r.id}`);
    assert.equal(one.status, 200, JSON.stringify(one.body));
    const all = await w.call("GET", "/space/p1");
    const row = all.body.runs.routines.find((/** @type {any} */ x) => x.id === w.r.id);
    assert.deepEqual(one.body, { routine: row, place: "app" });
    assert.equal(one.body.routine.state, "proposed");
    assert.equal(one.body.routine.madeName, "c1");
    const on = await w.call("POST", `/space/p1/routines/${w.r.id}/on`, { at: w.r.at });
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.equal((await w.call("GET", `/space/p1/routines/${w.r.id}`)).body.routine.state, "on");
    const none = await w.call("GET", "/space/p1/routines/r99");
    assert.deepEqual([none.status, none.body.error], [404, "This Space has no routine r99."]);
    const bare = await w.call("GET", `/space/p2/routines/${w.r.id}`);
    assert.deepEqual([bare.status, bare.body.none], [404, true]);
  });

  // (fails before: yes — a row nobody classed is a press)
  test("it only reads: no press", () => {
    assert.deepEqual(pressClass("GET /space/:project/routines/:id"), { press: "no", why: NO_PRESS.reads });
  });
});

// @ts-check
// HarnessV4_SpacesPlugins_Plan A7: a Space of your own shows projects, as a view. The store keeps which (a project in
// one Space at most: shown in a second, it leaves the first; its refusals in words); the route adds and drops one; the
// Space's answer carries each shown project's Needs you rows, its dashboards' chips and its tiles; a row done through
// the project's own route is done in both. The page's side is in space.test.js.
// (fails before: yes — a Space of your own showed nothing of a project)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { reproFields } from "../src/core/space.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { spaceRoutes } from "../src/http/admin/spaces.js";
import { createRouter } from "../src/http/router.js";

/** The projects the archive knows: two of yours, two Spaces of your own. @type {Record<string, { name: string, cwd: string }>} */
const KNOWN = { p1: { name: "app", cwd: "/work/app" }, p2: { name: "web", cwd: "/work/web" }, w1: { name: "Work", cwd: "/s/Work" }, w2: { name: "Personal", cwd: "/s/Personal" } };

/** A store in memory with the Spaces Work and Personal, what it published, and the routes over it. */
function world() {
  /** @type {[string, any][]} */
  const heard = [];
  const store = createSpaceStore({ dir: null, events: { publish: (topic, p) => void heard.push([topic, p]) } });
  store.makeOwn("w1", { name: "Work", folder: "/s/Work" });
  store.makeOwn("w2", { name: "Personal", folder: "/s/Personal" });
  const rows = spaceRoutes({
    config: { get: () => ({ agentLoop: { roots: [tmpdir()] }, server: {} }) },
    memory: { archive: { getProject: (/** @type {string} */ id) => (KNOWN[id] ? { id, ...KNOWN[id] } : null) } },
    spaces: store,
  });
  return { store, rows, heard };
}

/**
 * One row through the real router: its status and its JSON body.
 * @param {any[]} rows @param {string} method @param {string} path @param {any} [json]
 */
async function call(rows, method, path, json) {
  const m = createRouter(rows)(method, path.split("?")[0]);
  assert.ok(m, `${method} ${path} matched a row`);
  const got = { status: 0, body: /** @type {any} */ (null) };
  const res = {
    headersSent: false,
    writableEnded: false,
    writeHead: (/** @type {number} */ s) => void (got.status = s),
    end: (/** @type {string} */ b) => void (got.body = JSON.parse(String(b))),
  };
  await m.handler({ res, url: new URL(`http://localhost/api${path}`), params: m.params, json: async () => json }, {});
  assert.ok(got.status, `${method} ${path} answered`);
  return got;
}

describe("the projects a Space of your own shows (store)", () => {
  test("added and dropped; shown in a second Space, it leaves the first, each told; refused for a project's Space, itself, or a Space of yours", () => {
    const { store, heard } = world();
    assert.deepEqual(store.ownShows("w1", { add: "p1" }), ["p1"]);
    assert.deepEqual(store.ownShows("w1", { add: "p2" }), ["p1", "p2"]);
    assert.deepEqual(store.ownShows("w1", { add: "p1" }), ["p1", "p2"], "once");
    heard.length = 0;
    assert.deepEqual(store.ownShows("w2", { add: "p1" }), ["p1"]);
    assert.deepEqual([store.get("w1").own?.shows, store.get("w2").own?.shows], [["p2"], ["p1"]], "a project in one Space at most");
    assert.deepEqual(heard.map(([, p]) => p.project), ["w1", "w2"], "both pages read again");
    // The Space above each, whose connectors and plugins its chats get: read again as a Space changes.
    assert.deepEqual(["p1", "p2", "w1", "nope", null].map((p) => store.ownAbove(p)), ["w2", "w1", null, null, null]);
    assert.deepEqual(store.ownShows("w1", { drop: "p2" }), []);
    assert.equal(store.ownAbove("p2"), null, "dropped: nothing above it");
    assert.equal(store.get("w1").own?.shows, undefined, "none: nothing kept");
    assert.equal(store.get("p1").own, undefined, "the project itself is as it was");
    assert.throws(() => store.ownShows("p1", { add: "p2" }), { status: 409, message: "Only a Space of your own shows projects." });
    assert.throws(() => store.ownShows("w1", { add: "w1" }), { status: 400, message: "A Space does not show itself." });
    assert.throws(() => store.ownShows("w1", { add: "w2" }), { status: 400, message: "A Space of your own is not a project to show." });
  });
});

describe("the projects a Space of your own shows (routes)", () => {
  test("{ add } and { drop } answer the Space; its answer carries each one's rows, chips and tiles; a row done in its project is done here", async () => {
    const { store, rows } = world();
    const f = /** @type {any} */ (reproFields({ title: "PLAY-91 Sign-in loops on Safari", reproduced: true, test: "tests/safari.spec.ts", run: "npx playwright test safari" })).fields;
    const n = store.writeRepro("p1", f, { chain: "c1", byName: "Tester", cwd: "/work/app-wt/repro" });
    let r = await call(rows, "GET", "/space/w1");
    assert.deepEqual([r.status, r.body.own.name, r.body.shows], [200, "Work", []]);
    assert.equal((await call(rows, "GET", "/space/p1")).body.shows, undefined, "a project's Space shows none");
    r = await call(rows, "POST", "/space/w1/own/shows", { add: "p1" });
    assert.deepEqual([r.status, r.body.ok, r.body.shows], [200, true, ["p1"]]);
    // The project's own page names the Space that shows it: its "In Work" chip (the owner's word of 10-26).
    assert.deepEqual([(await call(rows, "GET", "/space/p1")).body.shownIn, (await call(rows, "GET", "/space/p2")).body.shownIn, r.body.space.shownIn], [{ id: "w1", name: "Work" }, undefined, undefined]);
    const shown = r.body.space.shows;
    assert.deepEqual(shown.map((/** @type {any} */ s) => [s.id, s.name, s.cwd, s.dashboards, s.glance]), [["p1", "app", "/work/app", [], []]], "no runner wired: no chips, no tiles");
    assert.deepEqual(shown[0].needs.map((/** @type {any} */ x) => [x.id, x.kind, x.state, x.project]), [[n.id, "repro", "open", "p1"]]);
    // Home names the Space that shows it, on its chip: "Work › app".
    assert.deepEqual((await call(rows, "GET", "/your-space?glance=0")).body.projects, [{ id: "p1", name: "app", cwd: "/work/app", space: { id: "w1", name: "Work" } }]);
    // Done through the project's own route: done in its Space, and so here.
    assert.equal((await call(rows, "POST", `/space/p1/needs/${n.id}`, { done: true })).status, 200);
    r = await call(rows, "GET", "/space/w1");
    assert.deepEqual(r.body.shows[0].needs.map((/** @type {any} */ x) => [x.id, x.state]), [[n.id, "done"]]);
    // Moved to Personal: it leaves Work.
    await call(rows, "POST", "/space/w2/own/shows", { add: "p1" });
    assert.deepEqual([(await call(rows, "GET", "/space/w1")).body.shows, (await call(rows, "GET", "/space/w2")).body.shows.map((/** @type {any} */ s) => s.id)], [[], ["p1"]]);
    r = await call(rows, "POST", "/space/w2/own/shows", { drop: "p1" });
    assert.deepEqual([r.body.shows, r.body.space.shows], [[], []]);
    // Refusals, in words; nothing written.
    assert.deepEqual(await call(rows, "POST", "/space/w1/own/shows", {}), { status: 400, body: { error: "say which project: { add } or { drop }, its id" } });
    assert.deepEqual(await call(rows, "POST", "/space/w1/own/shows", { add: "p1", drop: "p2" }), { status: 400, body: { error: "say which project: { add } or { drop }, its id" } });
    assert.deepEqual(await call(rows, "POST", "/space/w1/own/shows", { add: "nope" }), { status: 404, body: { error: "There is no such project to show." } });
    assert.deepEqual(await call(rows, "POST", "/space/p2/own/shows", { add: "p1" }), { status: 409, body: { error: "Only a Space of your own shows projects." } });
    assert.deepEqual(await call(rows, "POST", "/space/w1/own/shows", { add: "w2" }), { status: 400, body: { error: "A Space of your own is not a project to show." } });
    // A project the archive no longer knows is left out of the answer.
    store.ownShows("w1", { add: "p9" });
    assert.deepEqual((await call(rows, "GET", "/space/w1")).body.shows, []);
  });
});

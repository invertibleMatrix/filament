// @ts-check
// A project with no Space (the owner's of 10-29: none until the person makes one) has none anywhere: no space tool for
// its chats' agents — the loop's, a coding agent's, the New Task board's count —, no What happened lines at a turn's
// end, and its page answers that it has none, as does every write that is no add of the person's (an add makes it: by
// need, 11-12, test/space-by-need.test.js). Made from its menu, deleted, brought back, end to end.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSpaceStore } from "../src/services/spaces.js";
import { createSpaceNews } from "../src/app/space-news.js";
import { spaceProjectOf } from "../src/app/agent/space.js";
import { startAnatomy } from "../src/app/sessions/draft-start.js";
import { defaultConfig } from "../src/config.js";
import { startApp } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-space-gates-${tag}-`));
  made.push(d);
  return d;
};

const P = "0123456789ab";

describe("no Space, no space tool", () => {
  // (fails before: yes — every project's chat was offered the tool)
  test("a chat's agent is offered its project's Space only once it was made; deleted, no longer", () => {
    const store = createSpaceStore({ dir: null, madeOnly: true });
    const deps = /** @type {any} */ ({ store, projectOf: () => P });
    assert.equal(spaceProjectOf(deps, "c1"), null);
    store.make(P);
    assert.equal(spaceProjectOf(deps, "c1"), P);
    store.remove(P);
    assert.equal(spaceProjectOf(deps, "c1"), null);
    assert.equal(spaceProjectOf(/** @type {any} */ ({ store, projectOf: () => "none" }), "c1"), null, "a chat of no project never");
  });

  // (fails before: yes — the board counted the space tool in every project's chat)
  test("the New Task board leaves it out where the project has no Space, as the turn does", () => {
    const cfg = defaultConfig();
    cfg.upstreams = [{ id: "api", name: "api", type: "anthropic", baseUrl: "http://127.0.0.1:9", apiKey: "s", enabled: true }];
    cfg.routes = [{ match: "brain-*", upstream: "api", upstreamModel: "{model}", enabled: true }];
    cfg.agentLoop = { ...cfg.agentLoop, enabled: true, readerModel: "" };
    const of = (/** @type {boolean} */ has) => startAnatomy({ cfg, eff: { model: { name: "brain-model" } }, cwd: tmpdir(), projectId: P, spaceMade: () => has }).tools.offered;
    assert.ok(of(true).includes("space"));
    assert.ok(!of(false).includes("space"));
  });
});

describe("no Space, no lines", () => {
  // (fails before: yes — a turn's end wrote Filament's line into every project's Space, and made its file)
  test("a turn's end in a project with no Space writes nothing and makes no file; once made, its line", async () => {
    const dir = fresh("news");
    const store = createSpaceStore({ dir, madeOnly: true });
    const news = createSpaceNews({
      store,
      chat: () => ({ project: P, name: "login", listed: true }),
      folderOf: () => null,
      places: async () => ({ ok: false, error: "no git" }),
      chatsIn: () => new Map(),
      settleMs: 0,
    });
    news.ended("c1");
    await news.settled();
    assert.equal(existsSync(join(dir, `${P}.json`)), false);
    store.make(P);
    news.ended("c1");
    await news.settled();
    assert.equal(store.get(P).log.at(-1)?.text, "“login” finished a turn");
  });
});

describe("end to end", () => {
  // (fails before: yes — every project's page opened, and a write made its Space)
  test("no Space until made from its menu; delete it, its page says so and when; bring it back", async (t) => {
    const shim = await startApp({ memory: true });
    t.after(() => shim.stop());
    const call = async (/** @type {string} */ path, /** @type {any} */ o = {}) => {
      const res = await shim.api(path, o);
      return { status: res.status, body: await res.json() };
    };
    const p = (await call("/api/memory/projects", { method: "POST", body: { cwd: fresh("proj") } })).body;
    assert.ok(p.id, JSON.stringify(p));
    const none = await call(`/api/space/${p.id}`);
    assert.deepEqual([none.status, none.body.none, none.body.deletedAt], [404, true, null]);
    // A task changed, a setting: no add of the person's, so the store's to refuse (a task added makes the Space: by need).
    assert.equal((await call(`/api/space/${p.id}/tasks/t1`, { method: "PATCH", body: { title: "Ship it" } })).status, 404, "a write that adds nothing makes no Space");
    assert.equal((await call(`/api/space/${p.id}/settings`, { method: "PATCH", body: { asks: "ask" } })).status, 404, "nor a setting");
    assert.equal(existsSync(join(shim.dataDir, "spaces", `${p.id}.json`)), false);
    assert.deepEqual((await call("/api/spaces")).body.open, {});

    const make = await call(`/api/space/${p.id}`, { method: "POST" });
    assert.deepEqual([make.status, make.body.made, make.body.tasks], [200, true, 0]);
    assert.equal((await call(`/api/space/${p.id}/tasks`, { method: "POST", body: { title: "Ship it" } })).status, 200);
    assert.deepEqual((await call("/api/spaces")).body.open, { [p.id]: 1 });

    const del = await call(`/api/space/${p.id}`, { method: "DELETE" });
    assert.equal(del.status, 200, JSON.stringify(del.body));
    const gone = await call(`/api/space/${p.id}`);
    assert.deepEqual([gone.status, gone.body.deletedAt], [404, del.body.at]);
    const bar = (await call("/api/spaces")).body;
    assert.deepEqual([bar.open, bar.back], [{}, { [p.id]: del.body.at }]);
    assert.ok(readdirSync(join(shim.dataDir, "spaces")).some((f) => f.startsWith(`${p.id}.json.deleted-`)));

    const back = await call(`/api/space/${p.id}/back`, { method: "POST" });
    assert.equal(back.status, 200, JSON.stringify(back.body));
    assert.deepEqual(back.body.space.tasks.map((/** @type {any} */ x) => x.title), ["Ship it"]);
    assert.deepEqual((await call("/api/spaces")).body.back, {});
  });
});

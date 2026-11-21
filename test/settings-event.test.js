// A session's settings document moved somewhere else — the dashboard's editor, another tab, a `/set` — and an open
// page went on drawing the old one until its next turn ended: the Agents panel's "Every sub-agent runs on …" line
// stayed stale (BUG-10 P9; HarnessV3-FixRound F1 item 10). The one writer (memory's `patchSessionSettings`) now says so
// on the events feed every page holds, `{ type: "settings", chainId, hash }`; the page reads the document again unless
// it holds that hash already (it wrote it), one read at a time.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until, readEvents } from "./helpers/wait.js";
import { settingsFollower } from "../src/ui/harness/live-topic.js";

describe("the page's follower", () => {
  // (fails before: n/a — new)
  test("reads again for a hash it does not hold, never for its own, and folds a burst into one more read", async () => {
    let held = "h1";
    let reads = 0;
    /** @type {(() => void)[]} */
    const pending = [];
    const want = settingsFollower({
      held: () => held,
      read: () => {
        reads++;
        return new Promise((res) => pending.push(() => res(undefined)));
      },
    });
    want("h1");
    await new Promise((r) => setImmediate(r));
    assert.equal(reads, 0, "the page wrote it: it holds that hash");
    want("h2");
    want("h3");
    want("h4");
    await new Promise((r) => setImmediate(r));
    assert.equal(reads, 1, "one read in flight; the burst waits");
    held = "h2";
    pending.shift()?.();
    await until(() => reads === 2, "the owed read after the first");
    held = "h4";
    pending.shift()?.();
    await new Promise((r) => setImmediate(r));
    assert.equal(reads, 2, "nothing owed after it");
    want(null);
    await new Promise((r) => setImmediate(r));
    assert.equal(reads, 3, "no hash said: read");
    pending.shift()?.();
  });

  test("a failed read is no stuck follower", async () => {
    let reads = 0;
    const want = settingsFollower({ held: () => null, read: async () => { reads++; throw new Error("offline"); } });
    want("a");
    await until(() => reads === 1, "the first read");
    await new Promise((r) => setImmediate(r));
    want("b");
    await until(() => reads === 2, "the next read still happens");
  });
});

describe("the server says it on the events feed", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */ let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */ let shim;
  /** @type {string} */ let root;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-settings-event-"));
    up = await fakeUpstream(() => anthropicReply("ok", { model: "brain-model" }));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true });
  });

  // (fails before: yes — no settings message ever reached the feed)
  test("a settings write and a /set each send the session's id and the document's new hash", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model", preset: null } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    const feed = readEvents(await shim.api("/api/events"));
    const said = () => feed.events.filter((e) => e.data?.type === "settings" && e.data.chainId === id).map((e) => e.data);
    try {
      await until(() => feed.events.some((e) => e.data?.type === "hello"), "the feed to open");
      const w = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { subagents: { pool: [{ model: "brain-small", seats: 4 }] } } } });
      assert.equal(w.status, 200, await w.clone().text());
      await until(() => said().length === 1, "the write to be said");
      const doc = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`)).json();
      assert.equal(said()[0].hash, doc.hash, "the hash is the document's, as the page holds it");
      const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: '/set subagents.pool [{"model":"brain-tiny","seats":4}]', stream: false } });
      assert.equal(t.status, 200, await t.clone().text());
      await until(() => said().length === 2, "the /set to be said");
      const after = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`)).json();
      assert.deepEqual(after.flat["subagents.pool"], [{ model: "brain-tiny", seats: 4 }]);
      assert.equal(said()[1].hash, after.hash);
      assert.notEqual(said()[1].hash, said()[0].hash);
      const same = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { subagents: { pool: [{ model: "brain-tiny", seats: 4 }] } } } });
      assert.equal(same.status, 200);
      await new Promise((res) => setTimeout(res, 150));
      assert.equal(said().length, 2, "a write that changes nothing says nothing");
    } finally {
      await feed.stop();
    }
  });
});

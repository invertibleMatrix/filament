// A session's Spend moved only when its turn ended: the page read the ledger again then, though the server books each
// of a turn's model calls as it returns (finish.js: an agent turn's ticks book themselves). The owner's report of 10-27:
// a long turn on an Anthropic key showed the same cost from its start to its end. Each booking now says the session's
// ledger on the events feed every page holds, `{ type: "spend", chainId, usage }`, and the page puts it in the view.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until, readEvents } from "./helpers/wait.js";

const reply = (/** @type {any[]} */ blocks, stop = "end_turn") =>
  anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });

describe("a session's spend on the events feed", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */ let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */ let shim;
  /** @type {string} */ let root;
  /** @type {(call: any) => any} */ let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-spend-event-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true });
  });

  // (fails before: yes — nothing said a booking: the feed carried no spend message, and the page's Spend waited for
  // the turn's end)
  test("each model call of a running turn says the session's ledger as it is booked, before the turn goes on", async () => {
    const created = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } })).json();
    const id = String(created.id);
    const feed = readEvents(await shim.api("/api/events"));
    const said = () => feed.events.filter((e) => e.data?.type === "spend" && e.data.chainId === id).map((e) => e.data);
    try {
      await until(() => feed.events.some((e) => e.data?.type === "hello"), "the feed to open");
      let heardBeforeRound2 = -1;
      brain = async (call) => {
        // A call with no tools is Filament's own (a title): not the turn's.
        if (!(call.body.tools || []).length) return reply([{ type: "text", text: "A title" }]);
        const last = call.body.messages.at(-1);
        const answered = Array.isArray(last?.content) && last.content.some((/** @type {any} */ c) => c.type === "tool_result");
        if (!answered) return reply([{ type: "tool_use", id: "p1", name: "plan", input: { items: [{ text: "Look", status: "in_progress" }] } }], "tool_use");
        // Round two waits until round one's booking reached the feed: the turn is still running.
        await until(() => said().some((s) => s.usage.output >= 7), "round one's spend while the turn runs");
        heardBeforeRound2 = said().length;
        return reply([{ type: "text", text: "Done." }]);
      };
      up.reset();
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "plan it", stream: false } });
      assert.equal(r.status, 200, await r.clone().text());
      assert.ok(heardBeforeRound2 >= 1, "round one's booking was said before round two's call returned");
      await until(() => said().some((s) => s.usage.output >= 14), "round two's spend");
      // The newest message is the ledger the settings document holds: the page's view reads the same figures — all but
      // the count of finished turns, said while this one still ran.
      const doc = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`)).json();
      const { turns: _running, ...newest } = said().at(-1).usage;
      const { turns: _finished, ...held } = doc.usage;
      assert.deepEqual(newest, held);
      assert.ok(said().every((s, i, all) => i === 0 || s.usage.requests > all[i - 1].usage.requests), "each message is a booking, in order");
    } finally {
      await feed.stop();
    }
  });

  // (fails before: yes — the owner's of 11-05: a team beside the chat spent in a chat of its own, and the chat's Spend
  // counted none of it)
  test("a team beside a chat books in its own chat, and the chat's ledger is said again with the teams' share; its settings count it", async () => {
    const make = async () => String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } })).json()).id);
    const main = await make();
    const team = await make();
    const a = /** @type {any} */ (shim.app).memory.archive;
    a.link(team, main, "beside", 1);
    a.mergeMeta(main, { spend: { usd: 2, listUsd: 2, requests: 3 } });
    const feed = readEvents(await shim.api("/api/events"));
    const said = () => feed.events.filter((e) => e.data?.type === "spend" && e.data.chainId === main).map((e) => e.data.usage);
    try {
      await until(() => feed.events.some((e) => e.data?.type === "hello"), "the feed to open");
      brain = async (call) => (!(call.body.tools || []).length ? reply([{ type: "text", text: "A title" }]) : reply([{ type: "text", text: "Done." }]));
      const r = await shim.api(`/api/sessions/${encodeURIComponent(team)}/turns`, { method: "POST", body: { content: "hunt", stream: false } });
      assert.equal(r.status, 200, await r.clone().text());
      const spent = Number((await (await shim.api(`/api/sessions/${encodeURIComponent(team)}/settings`)).json()).usage.usd);
      await until(() => said().some((u) => u.teams.runs === 1 && u.teams.usd === spent), "the main chat's ledger, with its team's spend");
      const u = said().at(-1);
      assert.deepEqual([u.usd, u.requests, u.teams.runs, u.teams.usd], [2, 3, 1, spent], "the chat's own ledger as it was, its team's beside it");
      const doc = await (await shim.api(`/api/sessions/${encodeURIComponent(main)}/settings`)).json();
      assert.deepEqual(doc.usage.teams, u.teams, "the settings answer counts the team too");
      assert.deepEqual(doc.usage.agents, { usd: 0, listUsd: 0, requests: 0, before: 2 }, "a ledger from before sub-agents were counted apart: all of it the chat's");
    } finally {
      await feed.stop();
    }
  });

  test("the page puts the ledger in the open chat's view, so Spend repaints from it", () => {
    const app = readFileSync(join(import.meta.dirname, "../src/ui/harness/app.js"), "utf8");
    assert.match(app, /if \(msg\?\.type !== "spend" \|\| !msg\.chainId \|\| !msg\.usage\) return;\n\s+const chat = chatByChain\(String\(msg\.chainId\)\);\n\s+if \(chat\?\.view\?\.settings\) applySessionView\(chat, \{ settings: \{ usage: msg\.usage \} \}\);/);
  });
});

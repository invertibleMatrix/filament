// @ts-check
// Deleting from the Agents tab, through a throwaway Filament (the owner's ask of 10-23: "i should be able to right click
// threads in Agents tab and be able to delete those for cleanup"): a thread's route and a team on the side's, each
// refused in words while it works and gone once it ended — from the list, from its address, and after a restart.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

/** A door a fake reply waits at until the test opens it. */
const door = () => {
  /** @type {() => void} */
  let open = () => {};
  const shut = new Promise((r) => (open = () => r(undefined)));
  return { shut, open };
};

describe("deleting from the Agents tab, through a throwaway Filament", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  /** @type {string} */ let sid;
  const subDoor = door();
  const teamDoor = door();
  /** What the fake was asked that waits at a door. */
  const at = { sub: false, team: false };
  /** @param {any} cfg */
  const configure = (cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1"] }];
    cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-delete-"));
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
      const text = JSON.stringify(call.body?.messages || []);
      if (text.includes("HOLD-SUB")) {
        at.sub = true;
        await subDoor.shut;
        return anthropicReply("The folder holds a parser.", { model: "m-1" });
      }
      if (text.includes("<main-chat") && text.includes("HOLD-TEAM")) {
        at.team = true;
        await teamDoor.shut;
        return anthropicReply("Found: parse.js:3 reads a field of null.", { model: "m-1" });
      }
      if (text.includes("KEEP-SUB")) return anthropicReply("Kept: the lexer is fine.", { model: "m-1" });
      return anthropicReply("The parser is built.", { model: "m-1" });
    });
    shim = await startApp({ memory: true, keep: true, configure });
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    sid = String((await made.json()).id);
    const first = await shim.api(`/api/sessions/${sid}/turns`, { method: "POST", body: { content: "build the parser", stream: false } });
    assert.equal(first.status, 200, await first.clone().text());
  });
  after(async () => {
    const dir = shim?.dataDir;
    await shim?.stop();
    if (dir) await removeDirs(dir);
    await up?.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const subagents = async () => /** @type {any[]} */ ((await (await shim.api(`/api/sessions/${sid}/subagents`)).json()).subagents || []);
  /** The reports kept aside for the person, as the chat's transcript names them (`agentId:exchange`). */
  const keptAside = async () => /** @type {string[]} */ ((await (await shim.api(`/api/sessions/${sid}/transcript`)).json()).subagentHeld || []);
  const besideList = async () => /** @type {any[]} */ ((await (await shim.api(`/api/sessions/${sid}/beside`)).json()).teams || []);
  /** @param {string} path */
  const del = async (path) => {
    const r = await shim.api(path, { method: "DELETE" });
    return { status: r.status, body: await r.json() };
  };

  // (fails before: yes — the owner's ask of 10-23: no thread could be deleted)
  test("a thread: refused while it works; deleted once it reported — off the list, its address and its kept report gone; another thread stays", async () => {
    for (const [prompt, description] of [["HOLD-SUB read the folder", "Held look"], ["KEEP-SUB read the lexer", "Kept look"]]) {
      const r = await shim.api(`/api/sessions/${sid}/subagents`, { method: "POST", body: { prompt, description, model: "m-1", deliver: false } });
      assert.equal(r.status, 200, await r.clone().text());
    }
    await until(async () => at.sub, "the held thread's request");
    const held = (await subagents()).find((s) => s.description === "Held look");
    assert.equal(held?.status, "running");
    const busy = await del(`/api/sessions/${sid}/subagents/${held.id}`);
    assert.deepEqual([busy.status, busy.body.error], [409, "it is at work: stop it first"]);
    subDoor.open();
    await until(async () => (await subagents()).every((s) => s.status !== "running"), "both threads to report");
    assert.equal((await subagents()).find((s) => s.id === held.id)?.exchanges.at(-1)?.delivery, "held", "its report waits for you");
    assert.ok((await keptAside()).some((k) => k.startsWith(`${held.id}:`)), "kept aside for you");
    const gone = await del(`/api/sessions/${sid}/subagents/${held.id}`);
    assert.deepEqual([gone.status, gone.body], [200, { ok: true, files: 0 }]);
    assert.deepEqual((await subagents()).map((s) => s.description), ["Kept look"]);
    assert.equal((await keptAside()).some((k) => k.startsWith(`${held.id}:`)), false, "its kept report went with it");
    assert.equal((await keptAside()).length, 1, "the other's stays");
    assert.equal((await shim.api(`/api/sessions/${sid}/subagents/${held.id}`)).status, 404);
    const again = await del(`/api/sessions/${sid}/subagents/${held.id}`);
    assert.deepEqual([again.status, again.body.error], [404, "no such sub-agent in this session"]);
    assert.equal((await del(`/api/sessions/other-chat/subagents/${(await subagents())[0].id}`)).status, 404, "a thread of another chat is no thread of this one");
  });

  // (fails before: yes — the owner's ask of 10-23)
  test("a team on the side: refused while it works; deleted once done — off the list, its own chat gone, its marks in the main chat left alone", async () => {
    const r = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ask: "HOLD-TEAM find bugs in the parser", model: "m-1" } });
    const fired = await r.json();
    assert.equal(r.status, 200, JSON.stringify(fired));
    const tid = String(fired.team.id);
    await until(async () => at.team, "the lead's request");
    const busy = await del(`/api/sessions/${sid}/beside/${tid}`);
    assert.deepEqual([busy.status, busy.body.error], [409, "it is at work: stop it first"]);
    teamDoor.open();
    await until(async () => (await besideList()).find((t) => t.id === tid)?.state === "done", "the hunt's result");
    const gone = await del(`/api/sessions/${sid}/beside/${tid}`);
    assert.deepEqual([gone.status, gone.body], [200, { ok: true, id: tid }]);
    assert.equal((await besideList()).some((t) => t.id === tid), false);
    assert.notEqual((await shim.api(`/api/sessions/${tid}/transcript`)).status, 200, "its own chat is gone");
    const main = await (await shim.api(`/api/sessions/${sid}/transcript`)).json();
    assert.deepEqual(main.boundaries.filter((/** @type {any} */ b) => b.type === "team" && b.id === tid).map((/** @type {any} */ b) => b.event), ["fired", "result"], "the page draws them as a team that was sent");
    assert.equal((await del(`/api/sessions/${sid}/beside/${tid}`)).status, 404);
  });

  // (fails before: yes — the owner's ask of 10-23)
  test("after a restart the deleted thread stays deleted, and the one kept comes back", async () => {
    const dataDir = shim.dataDir;
    await shim.stop();
    shim = await startApp({ memory: true, keep: true, dataDir, configure });
    assert.deepEqual((await subagents()).map((s) => s.description), ["Kept look"]);
    assert.equal((await keptAside()).length, 1, "only the kept thread's report waits");
  });
});

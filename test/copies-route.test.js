// @ts-check
// Copies over the wire (the remote plan's cp-root): another machine's agents start a chat in their own copy here
// without Full control, agentLoop.roots listed or not; the device list says what their machine keeps; Clear, by this
// machine's person alone, takes the copies and the chats their agents worked in there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTwoMachines } from "./helpers/two-machines.js";
import { anthropicReply, fakeUpstream } from "./helpers/app.js";
import { pinnedFetch } from "../src/cli/pinned.js";

const JSON_TYPE = { "content-type": "application/json" };

/**
 * Requests to `m` over the network, pinned to its certificate, with `token` as their Bearer: as another machine's
 * Filament sends them. @param {import("./helpers/two-machines.js").Machine} m @param {string} token
 */
const as = (m, token) => {
  const pinned = pinnedFetch(m.lan.fingerprint);
  /** @param {string} path @param {{ method?: string, body?: unknown }} [o] @returns {Promise<Response>} */
  return (path, { method = "GET", body } = {}) =>
    pinned(`${m.far}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : JSON_TYPE) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
};

/** @param {() => unknown | Promise<unknown>} fn @param {string} what */
const until = async (fn, what, ms = 15_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (await fn()) return;
  assert.fail(`waited ${ms} ms for ${what}`);
};

// (fails before: yes — no copies folder, no fence for it, no copies on the device list, no Clear; then, the review of
// cp-root: Clear removed the folders before the chat and the command in them were stopped, and answered before the chat went)
test("their copy: a chat of theirs starts in it without Full control, roots listed elsewhere; the device list says it; Clear is the person's, stops the chat and the command in it, then takes the copy", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "filament-copies-route-"));
  const was = process.env.FILAMENT_COPIES_DIR;
  process.env.FILAMENT_COPIES_DIR = join(base, "copies");
  t.after(() => {
    if (was === undefined) delete process.env.FILAMENT_COPIES_DIR;
    else process.env.FILAMENT_COPIES_DIR = was;
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const up = await fakeUpstream((/** @type {any} */ call) => (call.kind === "anthropic" ? anthropicReply("ok", { model: "brain-model" }) : undefined));
  const two = await startTwoMachines({
    there: {
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, permissions: "auto", roots: [join(base, "work")], readerModel: "" };
      },
    },
  });
  const { there } = two;
  try {
    const m = await (await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: JSON.stringify({ from: "Laptop" }) })).json();
    const id = String(m.device.id);
    assert.equal((await there.api(`/api/remote/devices/${encodeURIComponent(id)}`, { method: "PATCH", body: { grants: { agents: true, unasked: true } } })).status, 200);
    const agents = as(there, m.token);

    const taken = there.app.remoteCopies.take(id, "widgets");
    assert.ok(taken.ok);
    assert.equal(taken.copy.folder, join(base, "copies", "From Laptop", "widgets", "1"));
    const made = await agents("/api/sessions", { method: "POST", body: { cwd: taken.copy.folder, model: "agent/brain-model", preset: "plain" } });
    const chat = await made.json();
    assert.equal(made.status, 200, JSON.stringify(chat));
    // (fails before: yes — the review of s2a: their chat's project here was named "1", its copy's number folder)
    assert.equal(there.app.memory.archive?.getProject(chat.projectId)?.name, "widgets (from Laptop)");
    // Beside their copy, nothing of the person's opened: a folder of the copies folder that is no copy of theirs.
    const beside = await agents("/api/sessions", { method: "POST", body: { cwd: join(base, "copies"), model: "agent/brain-model", preset: "plain" } });
    assert.equal(beside.status, 403);
    // (fails before: yes — the security re-read of 11-11: with roots listed, the copies folder was one more root for
    // every chat, and this machine's person's own was made in a copy)
    // The copies folder is a root for their agents' chats alone: a chat of this machine's person is not made there…
    const own = await there.api("/api/sessions", { method: "POST", body: { cwd: taken.copy.folder, model: "agent/brain-model" } });
    assert.equal(own.status, 403, await own.clone().text());
    assert.match(String((await own.json()).error), /is not under any folder listed in agentLoop\.roots/);
    // …and their chat's turn runs in it all the same.
    const turn = await agents(`/api/sessions/${encodeURIComponent(chat.id)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
    assert.equal(turn.status, 200, await turn.clone().text());
    assert.match(await turn.text(), /"ok"|\bok\b/);

    const listed = await (await there.api("/api/remote/devices")).json();
    assert.deepEqual(listed.devices.find((/** @type {any} */ d) => d.id === id)?.copies, { count: 1, bytes: 0, folder: join(base, "copies", "From Laptop"), chats: [] });
    const full = listed.devices.find((/** @type {any} */ d) => d.scope === "full");
    assert.equal(full.copies, undefined, "a full device keeps none");

    // Clear: never theirs, never a full device's; the person's takes the copy, its folder and the chat.
    const theirs = await agents(`/api/remote/devices/${encodeURIComponent(id)}/copies/clear`, { method: "POST" });
    assert.equal(theirs.status, 403);
    const fullClear = await there.api(`/api/remote/devices/${encodeURIComponent(full.id)}/copies/clear`, { method: "POST" });
    assert.equal(fullClear.status, 400);
    // A command of theirs runs in the copy, its folder its working folder, which Windows will not remove under it.
    const ran = await agents("/api/exec", { method: "POST", body: { cwd: taken.copy.folder, command: `node -e "require('fs').writeFileSync('pid.txt', String(process.pid)); setInterval(() => {}, 1000)"` } });
    assert.equal(ran.status, 200);
    const execId = String(ran.headers.get("x-filament-exec"));
    const reading = ran.text().catch(() => "");
    await until(() => existsSync(join(taken.copy.folder, "pid.txt")), "the command to start in the copy");

    // The chat, its command and the folders are gone by the time Clear answers: each stopped before its folder went.
    const cleared = await there.api(`/api/remote/devices/${encodeURIComponent(id)}/copies/clear`, { method: "POST" });
    assert.deepEqual(await cleared.json(), { cleared: 1, bytes: 0, failed: [] });
    assert.equal(existsSync(join(base, "copies", "From Laptop")), false);
    assert.equal(existsSync(join(base, "copies")), true);
    assert.equal((await there.api(`/api/sessions/${encodeURIComponent(chat.id)}`)).status, 404, "the chat in the copy went with it");
    assert.ok(there.app.memory.archive && !there.app.memory.archive.getProject(chat.projectId), "and its project");
    /** @type {any} */
    let x = null;
    await until(async () => (x = await (await there.api(`/api/exec/${execId}`)).json()).state === "ended", "the command's end to be read");
    assert.equal(x.ended, "stopped", JSON.stringify(x));
    assert.match(String(x.reason), /the copy it ran in was let go/);
    await reading;
    const after = await (await there.api("/api/remote/devices")).json();
    assert.equal(after.devices.find((/** @type {any} */ d) => d.id === id)?.copies, undefined);
  } finally {
    await two.stop();
    await up.close();
  }
});

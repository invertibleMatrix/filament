// @ts-check
// Memory in another machine's agents' chat under Full control (the owner's YOLO mode of 11-09, fc-memory): their chat's
// memory is read at each turn from their device's grants, never written into the chat as it starts — under Full control
// memory's tools are on and answer as the person's own chat's do; switched off, the same chat's next turn runs with them
// off. Two real Filaments (helpers/two-machines.js), `there` with memory on (the fake engine): `here`'s full device mints
// its machine's agents a device on `there`, its Agents on.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTwoMachines } from "./helpers/two-machines.js";
import { anthropicReply, fakeUpstream } from "./helpers/app.js";
import { pinnedFetch } from "../src/services/machines/pinned.js";

const JSON_TYPE = { "content-type": "application/json" };
const MODEL = "agent/m-1";

/** @param {any} m */
const textOfMessage = (m) => (typeof m?.content === "string" ? m.content : (Array.isArray(m?.content) ? m.content : []).map((/** @type {any} */ b) => (b?.type === "text" ? b.text : "")).join(""));
/** @param {any} m */
const resultsOf = (m) =>
  (Array.isArray(m?.content) ? m.content : [])
    .filter((/** @type {any} */ b) => b?.type === "tool_result")
    .map((/** @type {any} */ b) => (typeof b.content === "string" ? b.content : (b.content || []).map((/** @type {any} */ x) => x?.text ?? "").join("")));
/** Each call the model took: the newest words it was sent and the results it was handed. @type {{ said: string, results: string[] }[]} */
const calls = [];
/**
 * The model: `LOAD<<id>>` in the newest message loads that session through memory's tool, then answers; anything else
 * is answered in words. @param {any} call
 */
const brain = async (call) => {
  if (call.kind !== "anthropic") return undefined;
  const msgs = call.body.messages || [];
  const said = textOfMessage([...msgs].reverse().find((/** @type {any} */ m) => m.role === "user" && textOfMessage(m).includes("<<")));
  calls.push({ said, results: resultsOf(msgs.at(-1)) });
  const now = textOfMessage(msgs.at(-1));
  const at = now.indexOf("LOAD<<");
  if (at >= 0 && !resultsOf(msgs.at(-1)).length) {
    const session = now.slice(at + 6, now.indexOf(">>", at));
    return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: `c${calls.length}`, name: "filament_memory_load", input: { session } }] });
  }
  return anthropicReply("Done.", { model: "m-1" });
};

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startTwoMachines>>} */
let two;
/** @type {import("./helpers/two-machines.js").Machine} */
let there;
const base = mkdtempSync(join(tmpdir(), "filament-full-memory-"));
const project = join(base, "project");
let deviceId = "";
/** @type {(path: string, o?: { method?: string, body?: unknown }) => Promise<Response>} */
let agents;
/** @param {Record<string, boolean>} grants */
const grant = async (grants) => {
  const r = await there.api(`/api/remote/devices/${encodeURIComponent(deviceId)}`, { method: "PATCH", body: { grants } });
  assert.equal(r.status, 200, await r.clone().text());
};
/**
 * A turn in `id`, sent by `send`, that loads `session` through memory's tool: what the tool answered.
 * @param {(path: string, o: { method: string, body: unknown }) => Promise<Response>} send @param {string} id @param {string} session @param {string} mark
 */
const loaded = async (send, id, session, mark) => {
  const r = await send(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: `${mark} LOAD<<${session}>>`, stream: false } });
  assert.equal(r.status, 200, await r.clone().text());
  return String(calls.findLast((c) => c.said.includes(mark) && c.results.length)?.results[0]);
};

before(async () => {
  mkdirSync(project, { recursive: true });
  up = await fakeUpstream(brain);
  two = await startTwoMachines({
    there: {
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [], readerModel: "" };
        // Memory's tools ride its autopilot, which a test app keeps off.
        cfg.memory.autopilot = { ...cfg.memory.autopilot, enabled: true };
      },
    },
  });
  there = two.there;
  const minted = await (await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: "{}" })).json();
  deviceId = String(minted.device.id);
  await grant({ agents: true });
  // The person's own chat in the project: with no roots listed, their chat starts in a folder of the person's chats.
  const own = await there.api("/api/sessions", { method: "POST", body: { cwd: project, model: "m-1" } });
  assert.equal(own.status, 200, await own.clone().text());
  const pinned = pinnedFetch(there.lan.fingerprint);
  agents = (path, { method = "GET", body } = {}) =>
    pinned(`${there.far}${path}`, { method, headers: { authorization: `Bearer ${minted.token}`, ...(body === undefined ? {} : JSON_TYPE) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
});

after(async () => {
  await two?.stop();
  await up?.close();
  // A file a stopped machine's child still holds on Windows leaves the temp folder behind: nothing this test reads.
  try {
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {}
});

// (fails before: yes — their chat's memory was written off as it started, whatever their device held)
test("Full control: their chat's memory tools are on and answer as the person's chat's do; switched off, the same chat's next turn runs with them off", async () => {
  const made = await agents("/api/sessions", { method: "POST", body: { cwd: project, model: MODEL, preset: "plain" } });
  assert.equal(made.status, 200, await made.clone().text());
  const id = String((await made.json()).id);
  // The person's own chat in the same project: memory's tools on, every session theirs to load.
  const own = String((await (await there.api("/api/sessions", { method: "POST", body: { cwd: project, model: MODEL } })).json()).id);
  const person = await loaded(there.api, own, "no-such-chat", "PERSONMEM");
  assert.match(person, /"no such session"/, person);
  await grant({ full: true });
  try {
    const said = await loaded(agents, id, "no-such-chat", "FULLMEM");
    assert.equal(said, person, "as the person's chat's");
  } finally {
    await grant({ full: false });
  }
  const fenced = await loaded(agents, id, "no-such-chat", "FENCEDMEM");
  assert.match(fenced, /memory's tools are off in this chat/, fenced);
});

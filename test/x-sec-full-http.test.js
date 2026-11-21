// @ts-check
// Full control at the door (the owner's YOLO mode of 11-09, fc-http): another machine's agents' device whose Full control
// is on starts a chat and runs a command in any folder of this machine's but in Filament's data folder — a credentials
// folder and the home folder around the data folder too —, and its commands are judged in this machine's Auto as the
// person's are. Its fence on the body, the headers and a file's read stays: the client there sends no more. Two real
// Filaments (helpers/two-machines.js): `here` paired with `there` as a full device, which mints its machine's agents a
// device on `there` with Agents alone on.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { startTwoMachines } from "./helpers/two-machines.js";
import { pinnedFetch } from "../src/cli/pinned.js";
import { agentFolderRefusal } from "../src/http/admin/remote.js";

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

/** A path as a command's words name it: forward slashes, which every shell and Node take. @param {string} p */
const slashed = (p) => p.split("\\").join("/");

// (fails before: yes — Full control was no fence of the folder's: a folder around the data folder, a credentials folder
// and the home folder were refused it)
test("Full control lifts the folder fence but for Filament's data folder, a folder named by its own names and another computer's share", () => {
  const home = join(tmpdir(), "filament-full-home");
  const dataDir = join(home, "Library", "Filament");
  const o = { dataDir, home, roots: [], folders: [] };
  assert.match(String(agentFolderRefusal(home, o)), /is around it/, "fenced: the home folder around the data folder");
  assert.match(String(agentFolderRefusal(join(home, "app", ".ssh"), { ...o, roots: [home] })), /a credentials folder/);
  assert.match(String(agentFolderRefusal(join(home, "app"), o)), /in none of them/);
  const full = { ...o, full: true };
  assert.equal(agentFolderRefusal(home, full), null);
  assert.equal(agentFolderRefusal(join(home, "app", ".ssh"), full), null);
  assert.equal(agentFolderRefusal(join(home, "app"), full), null);
  assert.match(String(agentFolderRefusal(dataDir, full)), /never start a chat in Filament's data folder; .* is in it/);
  assert.match(String(agentFolderRefusal(join(dataDir, "accounts"), full)), /is in it/);
  assert.match(String(agentFolderRefusal(join(home, "SSH~1"), full)), /a short name/);
  assert.match(String(agentFolderRefusal("\\\\server\\share\\app", full)), /another computer's share/);
});

/** @type {Awaited<ReturnType<typeof startTwoMachines>>} */
let two;
/** @type {import("./helpers/two-machines.js").Machine} */
let there;
let root = "";
/** Their agents' device on there, Agents alone on. @type {{ id: string, call: ReturnType<typeof as> }} */
let agents;
/** @param {Record<string, boolean>} grants */
const grant = async (grants) => {
  const r = await there.api(`/api/remote/devices/${encodeURIComponent(agents.id)}`, { method: "PATCH", body: { grants } });
  assert.equal(r.status, 200, await r.clone().text());
};
/**
 * Their command in `cwd` that writes `file`, as JSON at its end: one that asks ends unanswered at `timeoutMs`.
 * @param {string} cwd @param {string} file
 */
const exec = async (cwd, file, timeoutMs = 15_000) => {
  const r = await agents.call("/api/exec?stream=0", { method: "POST", body: { cwd, command: `node -e "require('fs').writeFileSync('${slashed(file)}','ran')"`, timeoutMs } });
  return { status: r.status, body: /** @type {any} */ (await r.json()) };
};

before(async () => {
  root = mkdtempSync(join(tmpdir(), "filament-full-http-"));
  mkdirSync(join(root, ".ssh"));
  two = await startTwoMachines({
    there: {
      configure: (cfg) => {
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [tmpdir()], readerModel: "" };
      },
    },
  });
  there = two.there;
  const minted = await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: "{}" });
  assert.equal(minted.status, 200, await minted.clone().text());
  const { device, token } = await minted.json();
  agents = { id: String(device.id), call: as(there, token) };
  await grant({ agents: true });
  const auto = await there.api("/api/defaults/settings", { method: "PATCH", body: { patch: { loop: { permissions: "auto" } } } });
  assert.equal(auto.status, 200, await auto.clone().text());
});

after(async () => {
  await two?.stop();
  // A file a stopped machine's child still holds on Windows leaves the temp folder behind: nothing this test reads.
  try {
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {}
});

// (fails before: yes — Full control opened no folder, and their command was judged in Auto as Edit without Without asking)
test("Full control: their command runs in Auto, in a credentials folder and around the data folder, never in it; their chat starts there too; off, the fence again", async () => {
  const keys = join(root, ".ssh");
  const around = dirname(there.dataDir);
  const off = await exec(keys, join(keys, "off.txt"));
  assert.equal(off.status, 403, JSON.stringify(off.body));
  assert.match(off.body.error, /a credentials folder/);
  const edit = await exec(root, join(root, "edit.txt"), 1000);
  assert.equal(edit.body.mode, "edit", "Auto is Edit for them without Without asking");
  await grant({ full: true });
  try {
    const auto = await exec(root, join(root, "auto.txt"));
    assert.deepEqual([auto.status, auto.body.mode, auto.body.code], [200, "auto", 0], JSON.stringify(auto.body));
    assert.equal(existsSync(join(root, "auto.txt")), true, "ran without asking");
    const inKeys = await exec(keys, join(keys, "full.txt"));
    assert.deepEqual([inKeys.status, inKeys.body.code], [200, 0], JSON.stringify(inKeys.body));
    assert.equal(existsSync(join(keys, "full.txt")), true);
    const marker = join(root, "around.txt");
    const outer = await exec(around, marker);
    assert.deepEqual([outer.status, outer.body.code], [200, 0], JSON.stringify(outer.body));
    assert.equal(existsSync(marker), true);
    const inData = await exec(there.dataDir, join(root, "data.txt"));
    assert.equal(inData.status, 403, JSON.stringify(inData.body));
    assert.match(inData.body.error, /never run a command in Filament's data folder/);
    const chat = await agents.call("/api/sessions", { method: "POST", body: { cwd: keys, preset: "plain" } });
    assert.equal(chat.status, 200, await chat.clone().text());
  } finally {
    await grant({ full: false });
  }
  const again = await exec(keys, join(keys, "again.txt"));
  assert.equal(again.status, 403, JSON.stringify(again.body));
  const chat = await agents.call("/api/sessions", { method: "POST", body: { cwd: keys, preset: "plain" } });
  assert.equal(chat.status, 403, await chat.clone().text());
});

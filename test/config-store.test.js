// @ts-check
// The live configuration store: one object read through get(), replaced whole by set(), subscribers told in order,
// the first-run seed handed in as data. server.js used to hold a reassigned `cfg` variable and poke four services
// from setConfig; a reader that captured the variable kept a stale copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createConfigStore,
  defaultConfig,
  loadConfig,
  normalizeConfig,
  portOption,
} from "../src/services/config/store.js";
import { globalLayer, resolveSettings } from "../src/services/session-settings.js";
import { workspaceSetting } from "../src/app/agent/workspace-kind.js";

const tempDir = () => mkdtempSync(join(tmpdir(), "filament-cfgstore-"));
const seed = [
  {
    upstream: { id: "seeded-agent", type: "acp", enabled: false, acp: { command: "agent" } },
    route: { match: "seeded/*", upstream: "seeded-agent", upstreamModel: "{model}" },
  },
];

test("a first run writes the defaults with the agents the caller seeded, as a list or lazily", () => {
  const dir = tempDir();
  try {
    let asked = 0;
    const store = createConfigStore({
      dataDir: dir,
      agents: () => {
        asked++;
        return seed;
      },
    });
    assert.equal(store.loaded.created, true);
    assert.equal(asked, 1, "the seed is asked for exactly once, on the first run");
    assert.equal(store.get().upstreams[0]?.id, "seeded-agent");
    assert.equal(store.get().routes[0]?.match, "seeded/*");
    assert.ok(existsSync(join(dir, "config.json")), "the seeded config is on disk");
    const again = createConfigStore({ dataDir: dir, agents: () => assert.fail("a file exists: no seed") });
    assert.equal(again.loaded.created, false);
    assert.equal(again.get().upstreams[0]?.id, "seeded-agent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("defaultConfig without a seed stays empty, and loadConfig seeds only when the file is missing", () => {
  assert.equal(defaultConfig().upstreams.length, 0);
  assert.equal(defaultConfig({ agents: seed }).upstreams.length, 1);
  const dir = tempDir();
  try {
    assert.equal(loadConfig(dir, { agents: seed }).config.upstreams.length, 1);
    assert.equal(
      loadConfig(dir, { agents: [] }).config.upstreams.length,
      1,
      "the file, not the seed, wins after that",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("set() normalises, replaces the object whole, and tells every subscriber in registration order", () => {
  const dir = tempDir();
  try {
    const store = createConfigStore({ dataDir: dir, overrides: { port: 4321, host: "127.0.0.9" } });
    assert.equal(store.get().server.port, 4321, "command-line overrides apply to the loaded config");
    assert.equal(store.get().server.host, "127.0.0.9");
    const first = store.get();
    /** @type {string[]} */
    const order = [];
    store.onChange(() => order.push("memory"));
    const off = store.onChange((c) => order.push(`knobs:${c.server.logLevel}`));
    store.onChange(() => order.push("health"));
    const next = structuredClone(first);
    next.server.logLevel = "debug";
    next.upstreams = [{ id: "u", type: "anthropic", apiKey: "k" }];
    const set = store.set(next);
    assert.equal(set, store.get(), "set returns what get() now answers");
    assert.notEqual(store.get(), first, "the object is replaced, never mutated in place");
    assert.equal(first.server.logLevel, "info", "a reader holding the old object keeps the old values");
    assert.equal(
      store.get().upstreams[0].enabled,
      normalizeConfig(next).upstreams[0].enabled,
      "normalised on the way in",
    );
    assert.deepEqual(order, ["memory", "knobs:debug", "health"]);
    off();
    store.set(structuredClone(store.get()));
    assert.deepEqual(
      order,
      ["memory", "knobs:debug", "health", "memory", "health"],
      "an unsubscribed listener is not told",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("save() writes the current object and reload() reads the file back, telling subscribers", () => {
  const dir = tempDir();
  try {
    const store = createConfigStore({ dataDir: dir });
    const next = structuredClone(store.get());
    next.server.logLevel = "warn";
    store.set(next);
    store.save();
    assert.equal(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).server.logLevel, "warn");
    const onDisk = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    onDisk.server.logLevel = "error";
    writeFileSync(join(dir, "config.json"), JSON.stringify(onDisk));
    let told = 0;
    store.onChange(() => told++);
    assert.equal(store.reload().server.logLevel, "error");
    assert.equal(told, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — HarnessV4_Tasks C2: `if (overrides.port)` read 0 as "not given", so `--port 0` started on the
// config's port without a word)
test("a port given on the command line is the port, 0 included; what is not a port is refused in words", () => {
  const dir = tempDir();
  try {
    assert.equal(createConfigStore({ dataDir: dir }).get().server.port, defaultConfig().server.port, "nothing given: the config's port");
    assert.equal(createConfigStore({ dataDir: dir, overrides: { port: 0 } }).get().server.port, 0, "0 asks for a free port");
    assert.equal(portOption("0"), 0);
    assert.equal(portOption(" 8080 "), 8080);
    assert.equal(portOption("65535"), 65535);
    for (const bad of ["65536", "abc", "-1", "80.5", "", undefined, "1e3"])
      assert.throws(() => portOption(bad), /--port takes a number from 0 to 65535 \(0 picks a free port\); it was given/, String(bad));
    assert.throws(() => portOption(undefined), /it was given nothing$/);
    assert.throws(() => portOption("abc"), /it was given "abc"$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the owner's of 11-09: the Worktree switch is no row of Agent loop now, so a stored off read as
// Auto on Where they edit while the chats' sub-agents worked in the session's folder)
test("a stored Worktree off loads as Where they edit's Session folder; a chat's sub-agents work where they did, and a later pick of Auto holds", () => {
  /** Where a chat's sub-agents work, as a chat reads the config and its own layer. @param {any} cfg @param {any} [session] */
  const where = (cfg, session = {}) => workspaceSetting(resolveSettings({ global: globalLayer(cfg), session }).effective.subagents);
  const off = normalizeConfig({ agentLoop: { subagents: { worktree: false } } });
  assert.deepEqual([off.agentLoop.subagents.workspace, off.agentLoop.subagents.worktree], ["folder", true], "the page's own choice says it");
  assert.deepEqual([where(off), where(off, { subagents: { worktree: true } }), where(off, { subagents: { workspace: "patch" } })], ["folder", "auto", "patch"], "a chat's own say over it, as the older switch had");
  const auto = normalizeConfig({ ...off, agentLoop: { ...off.agentLoop, subagents: { ...off.agentLoop.subagents, workspace: "auto" } } });
  assert.deepEqual([auto.agentLoop.subagents.workspace, where(auto)], ["auto", "auto"], "Auto picked later holds");
  const chosen = normalizeConfig({ agentLoop: { subagents: { worktree: false, workspace: "patch" } } });
  assert.deepEqual([chosen.agentLoop.subagents.workspace, chosen.agentLoop.subagents.worktree, where(chosen)], ["patch", true, "patch"], "a choice of its own beside it stands");
});

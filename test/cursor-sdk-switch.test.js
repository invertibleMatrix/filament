// @ts-check
// The re-read of 11-11 of Cursor's SDK behind its switch (Settings › Experimental, the owner's of 11-10, off by default):
// - a config from before the switch, whose person runs an account on the SDK, reads as on — the account went from the
//   pickers on upgrade with no word; starting writes nothing, and turned off it stays off;
// - while it is off each place says words that are true there ("or pick a model of Cursor's" only where a model was
//   picked), a route with backups says where the switch is, and the SDK is neither loaded nor installed;
// - Cursor's refusal of a pasted key shows no part of the key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CURSOR_SDK, agentRoute, catalogueUpstream, cursorSdkOn } from "../src/core/catalogues.js";
import { loadConfig, saveConfig } from "../src/services/config/store.js";
import { upstreamsOffProblem } from "../src/app/engine.js";
import { startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const FAKE_SDK = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-cursor-sdk.mjs")).href;
/** An account on Cursor's SDK, as its template adds it. @param {any} [more] */
const sdk = (more = {}) => ({ ...catalogueUpstream(CURSOR_SDK, { enabled: true }), apiKey: "ck-test", models: ["composer-2.5"], ...more });
/** What each place says while the switch is off, and what a place where a model was picked adds. */
const OFF = "Cursor through its SDK is off: Cursor is its CLI here. Turn it on in Settings › Experimental (Cursor through its SDK)";
const OR_A_MODEL = ", or pick a model of Cursor's";
/** @param {Awaited<ReturnType<typeof startApp>>} shim */
const accounts = async (shim) => (await (await shim.api("/api/agent-accounts")).json()).agents.map((/** @type {any} */ a) => a.upstream);
/** @param {Awaited<ReturnType<typeof startApp>>} shim @param {string} text */
const turn = (shim, text) => shim.api("/v1/messages", { method: "POST", body: { model: "cursor-sdk/composer-2.5", max_tokens: 20, messages: [{ role: "user", content: text }] } });

// (fails before: yes — the switch read `experimental.cursorSdk === true` alone: an account from before it was out of
// Coding agents and the pickers, and a turn on it refused, with nothing said of why on upgrade)
test("a config from before the switch with an account on Cursor's SDK: the account is there and a turn answers, starting wrote nothing; turned off, it is written so and stays off", async () => {
  /** @type {any} */
  let written;
  const shim = await startApp({
    overrides: { cursorSdkLoader: () => import(FAKE_SDK) },
    configure: (cfg, { dataDir }) => {
      delete cfg.experimental.cursorSdk;
      // Nothing to seal, so a start has nothing of its own to write.
      cfg.server.encryptSecrets = false;
      cfg.upstreams.push(sdk({ acp: { ...sdk().acp, cwdDefault: dataDir, hints: false } }));
      cfg.routes.push(agentRoute(CURSOR_SDK, { enabled: true }));
      written = cfg;
    },
  });
  const file = join(shim.dataDir, "config.json");
  const stored = () => JSON.parse(readFileSync(file, "utf8"));
  const shown = async () => (await (await shim.api("/api/state")).json()).config.experimental.cursorSdk;
  try {
    assert.equal(readFileSync(file, "utf8"), JSON.stringify(written), "starting wrote nothing to the person's settings");
    assert.ok((await accounts(shim)).includes(CURSOR_SDK.id), "its account, as before the switch");
    assert.equal(await shown(), true, "Settings shows the switch as it counts");
    const res = await turn(shim, "hi");
    const said = await res.text();
    assert.equal(res.status, 200, said);
    assert.match(said, /echo\(1\): hi/);
    assert.equal(stored().experimental?.cursorSdk, undefined, "a turn wrote none either");
    // The person turns it off: written beside the account, though off is the default, so the next read takes it as set.
    const off = await shim.api("/api/config/fields", { method: "PATCH", body: { set: { "experimental.cursorSdk": false } } });
    assert.equal(off.status, 200, await off.clone().text());
    assert.equal(stored().experimental?.cursorSdk, false, "off, in the file");
    assert.equal((await shim.api("/api/config/reload", { method: "POST" })).status, 200);
    assert.deepEqual([await shown(), (await accounts(shim)).includes(CURSOR_SDK.id)], [false, false], "read again, still off");
    const refused = await turn(shim, "hi");
    assert.ok(refused.status >= 400 && (await refused.text()).includes(OFF), "a turn on it says where it goes on");
  } finally {
    await shim.stop();
  }
});

// (fails before: yes — the first row: never set read as off whatever the config held. The fourth guards the fix: a
// switch turned off, left out of the file as every default is, would read as never set)
test("the switch as a stored config reads: never set beside an account on the SDK that is on, on; set, as it is set; no such account, off — reading writes nothing, and a save keeps it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-sdk-switch-"));
  const file = join(dir, "config.json");
  try {
    for (const [set, account, says] of /** @type {[boolean | undefined, boolean | null, boolean][]} */ ([
      [undefined, true, true],
      [undefined, false, false],
      [undefined, null, false],
      [false, true, false],
      [true, null, true],
      [true, true, true],
    ])) {
      const row = `switch ${set}, account ${account === null ? "none" : account ? "on" : "off"}`;
      const text = JSON.stringify({
        server: { inboundKeys: ["k"], encryptSecrets: false },
        ...(set === undefined ? {} : { experimental: { cursorSdk: set } }),
        upstreams: account === null ? [] : [sdk({ enabled: account })],
        routes: [],
      });
      writeFileSync(file, text);
      const { config } = loadConfig(dir);
      assert.equal(cursorSdkOn(config), says, row);
      assert.equal(readFileSync(file, "utf8"), text, `${row}: reading wrote nothing`);
      saveConfig(dir, config);
      assert.equal(cursorSdkOn(loadConfig(dir).config), says, `${row}: saved and read again`);
    }
    // A read that saves by itself — a secret typed into the file, sealed as it is read — keeps the switch as it counts.
    const plain = JSON.stringify({ server: { inboundKeys: ["k"] }, upstreams: [sdk()], routes: [] });
    writeFileSync(file, plain);
    assert.equal(cursorSdkOn(loadConfig(dir).config), true, "never set, read and sealed");
    assert.notEqual(readFileSync(file, "utf8"), plain, "the read sealed its secrets");
    assert.equal(cursorSdkOn(loadConfig(dir).config), true, "and read again: not written off by the read's own save");
  } finally {
    await removeDirs(dir);
  }
});

// (fails before: yes — one sentence for every place: a sign-in, Check now and Test ended "or pick a model of Cursor's",
// where no model was picked; and a route with backups said the account "is switched off … on the Upstreams page", whose
// card shows it on)
test("off, each place says what is true there: where it goes on, and another model only where a model was picked", async () => {
  const off = await startApp({
    overrides: { cursorSdkLoader: () => import(FAKE_SDK) },
    configure: (cfg) => {
      cfg.experimental.cursorSdk = false;
      cfg.upstreams.push(sdk());
      cfg.routes.push(agentRoute(CURSOR_SDK, { enabled: true }));
    },
  });
  try {
    for (const [path, body] of /** @type {[string, any][]} */ ([
      [`/api/agent-accounts/${CURSOR_SDK.id}/sign-in`, { way: "api-key", key: "ck-test" }],
      [`/api/agent-accounts/${CURSOR_SDK.id}/check`, undefined],
      ["/api/upstreams/test", { upstream: sdk() }],
    ])) {
      const r = await off.api(path, { method: "POST", ...(body ? { body } : {}) });
      assert.equal((await r.json()).error, `${OFF}.`, path);
    }
    const res = await turn(off, "hi");
    const said = await res.text();
    assert.ok(res.status >= 400 && said.includes(`${OFF}${OR_A_MODEL}`), `a turn on a model of its: ${said}`);
  } finally {
    await off.stop();
  }
  const name = sdk().name;
  /** @param {any[]} more @param {any[]} fallbacks */
  const cfg = (more, fallbacks) => ({
    experimental: { cursorSdk: false },
    rules: { resilience: { failover: true } },
    upstreams: [sdk(), ...more],
    routes: [{ match: "m", upstream: CURSOR_SDK.id, fallbacks }],
  });
  assert.equal(upstreamsOffProblem(cfg([], []), "m"), `${OFF}${OR_A_MODEL}.`, "alone: the switch's words, a model picked");
  assert.equal(
    upstreamsOffProblem(cfg([{ id: "spare", name: "Spare", enabled: false }], ["spare"]), "m"),
    `none of its upstreams can answer: "${name}" is off in Settings › Experimental (Cursor through its SDK), "Spare" is switched off. Switch one on on the Upstreams page, or turn that switch on.`,
  );
  assert.equal(
    upstreamsOffProblem(cfg([sdk({ id: "cursor-sdk-work", name: "Cursor · Work" })], ["cursor-sdk-work", "lost"]), "m"),
    `none of its upstreams can answer: "${name}" is off in Settings › Experimental (Cursor through its SDK), "Cursor · Work" is off in Settings › Experimental (Cursor through its SDK), "lost" is gone. Turn that switch on.`,
  );
});

// (fails before: yes — the page's install ran `npm install -g @cursor/sdk`, and its status loaded the SDK into
// Filament, with the switch off)
test("off, the SDK is neither loaded nor installed: its status with a load and its install are refused in the switch's words; its plain status still answers", async () => {
  let loads = 0;
  /** @type {any[]} */
  const npms = [];
  /** An npm that ends at once. @param {any[]} a */
  const fakeNpm = (...a) => {
    const child = /** @type {any} */ (new EventEmitter());
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    npms.push(a);
    setImmediate(() => child.emit("close", 1));
    return child;
  };
  const off = await startApp({
    overrides: { cursorSdkLoader: () => (loads++, import(FAKE_SDK)), sdkInstallSpawn: fakeNpm },
    configure: (cfg) => {
      cfg.experimental.cursorSdk = false;
      cfg.upstreams.push(sdk());
      cfg.routes.push(agentRoute(CURSOR_SDK, { enabled: true }));
    },
  });
  try {
    const plain = await off.api("/api/sdk/status");
    assert.deepEqual([plain.status, typeof (await plain.json()).installed], [200, "boolean"], "whether it is on the disk, read from the disk");
    const loaded = await off.api("/api/sdk/status?load=1");
    assert.deepEqual([loaded.status, (await loaded.json()).error], [400, `${OFF}.`]);
    const install = await off.api("/api/sdk/install", { method: "POST", body: {} });
    assert.deepEqual([install.status, (await install.json()).error], [400, `${OFF}.`]);
    assert.deepEqual([loads, npms.length], [0, 0], "nothing loaded, no npm run");
  } finally {
    await off.stop();
  }
});

// (fails before: yes — the bridge kept the first 160 characters of Cursor's words, then the sign-in masked the key: one
// that Cursor's words broke off in was whole no longer, and its start stood in the account's row)
test("Cursor's refusal of a pasted key shows no part of the key, wherever its words break off", async () => {
  const on = await startApp({
    overrides: { cursorSdkLoader: () => import(FAKE_SDK) },
    configure: (cfg) => {
      cfg.upstreams.push(sdk({ apiKey: "" }));
      cfg.routes.push(agentRoute(CURSOR_SDK, { enabled: true }));
    },
  });
  try {
    // The fake echoes such a key from its refusal's 151st character on.
    const key = "ck-echoed-0123456789abcdef";
    const r = await on.api(`/api/agent-accounts/${CURSOR_SDK.id}/sign-in`, { method: "POST", body: { way: "api-key", key } });
    assert.equal(r.status, 200, await r.clone().text());
    const row = await until(async () => {
      const a = (await (await on.api("/api/agent-accounts")).json()).agents.find((/** @type {any} */ x) => x.upstream === CURSOR_SDK.id);
      return a?.lastSignIn && !a.signingIn ? a : null;
    }, "the sign-in to end");
    assert.equal(row.lastSignIn.outcome, "failed");
    assert.ok(!row.lastSignIn.error.includes("ck-e"), row.lastSignIn.error);
    assert.match(row.lastSignIn.error, /^Cursor refused the key \(Invalid API key: the request was refused as it came, \.+••••\)$/);
  } finally {
    await on.stop();
  }
});

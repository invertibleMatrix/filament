// @ts-check
// Cursor is one agent here, its CLI (the owner's of 11-10: "we need to either choose Cursor CLI or Cursor SDK … keep that
// and just rename that to Cursor and move the other behind an Experimental switch inside settings and keep it off by
// default"): the CLI's permission questions come to the chat's switch, Filament's tools reach it over MCP and it signs
// in with the person's Cursor login, where the SDK approves its own tools and takes an API key. Its SDK is offered only
// while Settings › Experimental's switch for it is on; off, an upstream on it stays in the settings, its models out of
// the pickers, and a turn sent to it says where it goes on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CURSOR_SDK, CURSOR_SDK_OFF, agentCatalogue, agentRoute, agentTitle, catalogueUpstream, cursorSdkHeld, cursorSdkOn, KNOWN_AGENTS } from "../src/core/catalogues.js";
import { aggregateModels, findUpstream, offWhy, upstreamOff } from "../src/core/routing.js";
import { templatesFor } from "../src/services/config/templates.js";
import { upstreamsOffProblem } from "../src/app/engine.js";
import { startApp } from "./helpers/app.js";

const FAKE_SDK = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-cursor-sdk.mjs")).href;
const sdk = () => ({ ...catalogueUpstream(CURSOR_SDK, { enabled: true }), apiKey: "ck-test", models: ["composer-2.5"] });
const cfgOf = (/** @type {boolean | undefined} */ on) => ({ ...(on === undefined ? {} : { experimental: { cursorSdk: on } }), upstreams: [sdk()], routes: [agentRoute(CURSOR_SDK, { enabled: true })] });

// (fails before: yes — the SDK stood in the catalogue, the templates and the pickers with no switch)
test("off by default: the catalogue, the templates, the upstream and its models; on, all of them", async () => {
  assert.equal(agentTitle(KNOWN_AGENTS.find((a) => a.id === "cursor")), "Cursor", "the CLI is Cursor");
  for (const [on, says] of /** @type {const} */ ([[undefined, false], [false, false], [true, true]])) {
    const cfg = cfgOf(on);
    assert.equal(cursorSdkOn(cfg), says);
    assert.equal(cursorSdkHeld(cfg, cfg.upstreams[0]), !says);
    assert.equal(cursorSdkHeld(cfg, { type: "acp", acp: { command: "agent" } }), false, "Cursor's CLI never");
    assert.equal(agentCatalogue(cfg).some((a) => a.id === CURSOR_SDK.id), says, `the catalogue, switch ${on}`);
    assert.ok(agentCatalogue(cfg).some((a) => a.id === "cursor"), "Cursor's CLI either way");
    assert.equal(templatesFor(cfg).some((t) => t.id === CURSOR_SDK.id), says, `the templates, switch ${on}`);
    assert.equal(upstreamOff(cfg, cfg.upstreams[0]), !says);
    assert.equal(!!findUpstream(cfg, CURSOR_SDK.id), says);
    // Why a model of its does not run: the switch's words, and the other way out there, another model (the re-read of 11-11).
    assert.equal(offWhy(cfg, CURSOR_SDK.id), says ? null : `${CURSOR_SDK_OFF}, or pick a model of Cursor's`);
    const names = (await aggregateModels(cfg, { discover: async () => ({ names: ["composer-2.5"], source: "live" }) })).models.map((m) => m.id);
    assert.equal(names.some((n) => n.startsWith("cursor-sdk/")), says, `its models in the pickers, switch ${on}: ${names}`);
  }
  // An upstream switched off by its own switch is said as before, not as the Experimental one's.
  const off = cfgOf(true);
  off.upstreams[0].enabled = false;
  assert.equal(offWhy(off, CURSOR_SDK.id), null);
  assert.equal(offWhy(cfgOf(false), "nobody"), null);
  // (fails before: yes — the second read of 11-10: a sub-agent or a summary on its model was told to switch the upstream
  // on on the Upstreams page, whose card shows it on) Why a call on it would end, in the switch's words.
  assert.equal(upstreamsOffProblem(cfgOf(false), "cursor-sdk/composer-2.5"), `${CURSOR_SDK_OFF}, or pick a model of Cursor's.`);
  assert.equal(upstreamsOffProblem(cfgOf(true), "cursor-sdk/composer-2.5"), null);
  assert.match(String(upstreamsOffProblem(off, "cursor-sdk/composer-2.5")), /is switched off\. Switch it on on the Upstreams page\.$/);
});

// (fails before: yes — Settings › Coding agents listed Cursor's SDK beside its CLI, and a turn on it ran)
test("through the app: Coding agents and the templates leave it out, and a turn sent to it says where it goes on", async () => {
  const off = await startApp({ configure: (cfg) => {
    cfg.experimental.cursorSdk = false;
    cfg.upstreams.push(sdk());
    cfg.routes.push(agentRoute(CURSOR_SDK, { enabled: true }));
  } });
  try {
    const entries = (await (await off.api("/api/coding-agents")).json()).entries.map((/** @type {any} */ e) => e.id);
    assert.ok(entries.includes("cursor") && !entries.includes(CURSOR_SDK.id), String(entries));
    const templates = (await (await off.api("/api/templates")).json()).templates.map((/** @type {any} */ t) => t.id);
    assert.ok(!templates.includes(CURSOR_SDK.id), String(templates));
    for (const action of ["preview", "apply"]) {
      const applied = await off.api(`/api/templates/${CURSOR_SDK.id}/${action}`, { method: "POST" });
      assert.equal(applied.status, 409, `its template by its id, ${action}`);
      assert.equal((await applied.json()).error, `${CURSOR_SDK_OFF}.`);
    }
    // (fails before: yes — the second read of 11-10: its Test reached Cursor through the SDK with the switch off)
    const tested = await (await off.api("/api/upstreams/test", { method: "POST", body: { upstream: sdk() } })).json();
    assert.deepEqual([tested.ok, tested.error], [false, `${CURSOR_SDK_OFF}.`]);
    const res = await off.api("/v1/messages", { method: "POST", body: { model: "cursor-sdk/composer-2.5", max_tokens: 20, messages: [{ role: "user", content: "hi" }] } });
    const said = await res.text();
    assert.ok(res.status >= 400, `refused: ${res.status}`);
    assert.ok(said.includes(CURSOR_SDK_OFF), said);
  } finally {
    await off.stop();
  }
  const on = await startApp({ configure: (cfg) => {
    cfg.upstreams.push(sdk());
    cfg.routes.push(agentRoute(CURSOR_SDK, { enabled: true }));
  } });
  try {
    const entries = (await (await on.api("/api/coding-agents")).json()).entries.map((/** @type {any} */ e) => e.id);
    assert.ok(entries.includes(CURSOR_SDK.id), String(entries));
    const templates = (await (await on.api("/api/templates")).json()).templates.map((/** @type {any} */ t) => t.id);
    assert.ok(templates.includes(CURSOR_SDK.id), String(templates));
  } finally {
    await on.stop();
  }
});

// (fails before: yes — the bug hunt of 5d57bbe8a: with the switch off, Check now asked Cursor who the key's owner is, a
// sign-in signed in through the SDK and asked for its models, and an account was added beside it)
test("off, its account reaches no Cursor: not listed, and Check now, a sign-in, an account added and a sign-out refused in the switch's words", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-cursor-off-"));
  const sdkLog = join(dir, "sdk.jsonl");
  const was = process.env.FAKE_SDK_LOG;
  process.env.FAKE_SDK_LOG = sdkLog;
  let loads = 0;
  const off = await startApp({
    overrides: { cursorSdkLoader: () => (loads++, import(FAKE_SDK)) },
    configure: (cfg) => {
      cfg.experimental.cursorSdk = false;
      cfg.upstreams.push(sdk());
      cfg.routes.push(agentRoute(CURSOR_SDK, { enabled: true }));
    },
  });
  try {
    const rows = (await (await off.api("/api/agent-accounts")).json()).agents.map((/** @type {any} */ a) => a.upstream);
    assert.equal(rows.includes(CURSOR_SDK.id), false, String(rows));
    const said = `${CURSOR_SDK_OFF}.`;
    for (const [path, body] of /** @type {[string, any][]} */ ([
      [`/api/agent-accounts/${CURSOR_SDK.id}/check`, undefined],
      [`/api/agent-accounts/${CURSOR_SDK.id}/sign-in`, { way: "api-key", key: "ck-test" }],
      [`/api/agent-accounts/${CURSOR_SDK.id}/sign-in`, { way: "browser" }],
      ["/api/agent-accounts", { from: CURSOR_SDK.id, name: "Work" }],
      [`/api/agent-accounts/${CURSOR_SDK.id}/sign-out`, undefined],
    ])) {
      const r = await off.api(path, { method: "POST", ...(body ? { body } : {}) });
      assert.deepEqual([r.status, (await r.json()).error], [400, said], `${path} ${JSON.stringify(body || {})}`);
    }
    assert.equal(off.app.config.upstreams.filter((/** @type {any} */ u) => u.type === "cursor-sdk").length, 1, "no account added");
    assert.deepEqual([loads, existsSync(sdkLog) ? readFileSync(sdkLog, "utf8") : ""], [0, ""], "the SDK never loaded, Cursor never asked");
  } finally {
    await off.stop();
    if (was === undefined) delete process.env.FAKE_SDK_LOG;
    else process.env.FAKE_SDK_LOG = was;
    rmSync(dir, { recursive: true, force: true });
  }
});

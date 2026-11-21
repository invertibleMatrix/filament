// @ts-check
// The review of 11-10: Cursor's SDK runs inside Filament's process and approves Cursor's own tools itself, so a chat set
// to Read only or Ask on `cursor-sdk/…` still had Cursor edit files and run commands, unasked. A chat with a switch now
// runs Cursor's own shell, read, edit and delete off, Filament's hands in their place — each call judged by the chat's
// switch — and says so once in the turn's notes. Since the re-read of 11-11 (test/cursor-sdk-strict.test.js) that is
// every chat with a switch, Auto too — the switch may move while the turn runs —, by the names the SDK knows (it has
// no `write`), and one stricter than Auto runs Cursor's sub-agents off as well.
// (fails before: yes — the card's `prompts` bridge ran whatever the switch said)
import "./helpers/clean-env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CursorSdkBridge } from "../src/adapters/agents/cursor-sdk.js";
import { createAgentPermits } from "../src/app/agent-permits.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = pathToFileURL(join(HERE, "fixtures", "fake-cursor-sdk.mjs")).href;
const dir = mkdtempSync(join(tmpdir(), "filament-sdk-permits-"));
const log = join(dir, "sdk.jsonl");
/** @param {string} file */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

before(() => {
  process.env.FAKE_SDK_LOG = log;
});
after(() => {
  delete process.env.FAKE_SDK_LOG;
  rmSync(dir, { recursive: true, force: true });
});

test("a chat with a switch runs Cursor's own tools off, Filament's hands in their place; stricter than Auto, its sub-agents too", async () => {
  const bridge = new CursorSdkBridge(/** @type {any} */ ({ log: () => {}, loader: () => import(FAKE) }));
  const up = { id: "csdk", name: "csdk", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: dir, clientBridge: "prompts", hints: false } };
  /** @param {string} text @param {any} mode @param {string} conv */
  const run = (text, mode, conv) =>
    bridge.run({
      upstream: up,
      modelId: "grok-4.6",
      format: "anthropic",
      body: { model: "m", max_tokens: 100, messages: [{ role: "user", content: text }] },
      conversationId: conv,
      onEvent: () => {},
      permits: createAgentPermits({ rules: [], modeNow: () => mode, learned: null }),
    });
  const opened = () => lines(log).filter((e) => e.event === "create" || e.event === "resume").at(-1);
  try {
    for (const mode of ["read-only", "edit", "ask"]) {
      const r = await run("hello", mode, `strict-${mode}`);
      assert.deepEqual(opened()?.disallowedTools, ["shell", "read", "edit", "delete", "task"], `${mode}: Cursor's own tools off`);
      assert.ok(
        r.notes.includes(`sdk: Cursor's own shell, read, edit and delete are off in a chat with a permission switch: Filament's hands do that work, each call judged by the switch as it stands then (${mode} as the turn began)`),
        r.notes.join("\n"),
      );
    }
    const auto = await run("hello", "auto", "free");
    assert.deepEqual(opened()?.disallowedTools, ["shell", "read", "edit", "delete"], "Auto: Cursor's own hands off too, its sub-agents kept");
    assert.ok(auto.notes.includes("sdk: Cursor's own shell, read, edit and delete are off in a chat with a permission switch: Filament's hands do that work, each call judged by the switch as it stands then (auto as the turn began)"), auto.notes.join("\n"));
    assert.ok(!auto.notes.some((/** @type {string} */ n) => n.includes("the chat's permission is")), `nothing else kept from it in Auto: ${auto.notes.join("\n")}`);
  } finally {
    bridge.shutdown?.();
  }
});

// (fails before: yes — the SDK found outside Filament was imported from dist/esm/index.js whatever its package.json said:
// a release that moves its entry stopped loading)
test("the SDK's entry is the file its package.json gives an import, else dist/esm/index.js", async () => {
  const { sdkEntry } = await import("../src/adapters/agents/cursor-sdk.js");
  assert.equal(sdkEntry({ exports: { ".": { import: "./build/index.mjs", require: "./build/index.cjs" } } }), "build/index.mjs");
  assert.equal(sdkEntry({ exports: { ".": { node: { import: "./n/esm.js" }, default: "./d.js" } } }), "n/esm.js");
  assert.equal(sdkEntry({ exports: { import: "./top.js" } }), "top.js");
  assert.equal(sdkEntry({ exports: "./only.js" }), "only.js");
  assert.equal(sdkEntry({ module: "./esm/main.js", main: "./cjs/main.cjs" }), "esm/main.js");
  assert.equal(sdkEntry({ exports: { ".": { require: "./x.cjs" } }, main: "./x.cjs" }), "dist/esm/index.js");
  assert.equal(sdkEntry({ exports: "../elsewhere.js" }), "dist/esm/index.js");
  // (fails before: yes — the review of 11-10: a CommonJS file under `node` hid the `import` beside it)
  assert.equal(sdkEntry({ exports: { ".": { node: "./x.cjs", import: "./esm.js" } } }), "esm.js");
  assert.equal(sdkEntry({ exports: "..\\elsewhere.js" }), "dist/esm/index.js");
  assert.equal(sdkEntry({ main: "/abs/index.js" }), "dist/esm/index.js");
  assert.equal(sdkEntry({}), "dist/esm/index.js");
});

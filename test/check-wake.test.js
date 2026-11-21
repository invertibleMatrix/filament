// @ts-check
// A task check's end wakes an idle chat (the owner's of 11-06): a coding agent's turn holds for none of its graph's
// checks, so a check that ends after the turn did is told in a turn Filament starts by itself — the check's verdict
// ahead of Filament's line, a flaky one with the end of what its first run printed — never left for the person's next
// message. Through the app, on the fake coding agent over the bridge, in a git folder Filament's check copies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWakeMessage } from "../src/app/sessions/wake.js";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { until } from "./helpers/wait.js";

// A check that outlasts its turn, and fails its first run where its second passes: the first leaves a mark in the copy.
const FLAKY = `const fs = require("fs");
setTimeout(() => {
  if (fs.existsSync("ran-once")) process.exit(0);
  fs.writeFileSync("ran-once", "");
  console.log("ok 1 - parses");
  console.log("not ok 2 - the lock was held");
  process.exit(1);
}, 1500);
`;

// (fails before: yes — the hunt of check-wake: the wake was pinned on a fake registry alone, never through a turn)
test("a coding agent's check that ends after its turn wakes the chat: the woken turn carries the verdict, a flaky one with its first run's output", async () => {
  const folder = mkdtempSync(join(tmpdir(), "filament-check-wake-"));
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: folder, stdio: "pipe" });
  writeFileSync(join(folder, "flaky.cjs"), FLAKY);
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "one");
  const up = await fakeUpstream(async (call) => anthropicReply("", { model: String(call.body?.model || ""), stop: "end_turn", blocks: [{ type: "text", text: "MODEL" }], usage: { input_tokens: 5, output_tokens: 3 } }));
  const shim = await startApp({
    memory: true,
    configure: (cfg, { dataDir }) => {
      cfg.upstreams = [
        { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
        { id: "coder", name: "coder", type: "acp", enabled: true, acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_MCP_CAPS: "http" }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" } },
      ];
      cfg.routes = [{ match: "coder-*", upstream: "coder", upstreamModel: "{model}", enabled: true }, { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
      cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
    },
  });
  try {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "coder-1", preset: "plain", settings: {} } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    const say = async (/** @type {string} */ content) => {
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
      const json = await r.json();
      assert.equal(r.status, 200, JSON.stringify(json));
      return (json.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("");
    };
    const transcript = async () => /** @type {any} */ (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json());
    const add = { action: "add", goal: "Fix the lock", tasks: [{ id: "t1", name: "Fix the lock", check: ["node flaky.cjs"] }] };
    assert.match(await say(`~mcpcall tasks ${JSON.stringify(add)}`), /mcp:Added t1/);
    assert.match(await say(`~mcpcall tasks {"action":"start","ids":["t1"]}`), /mcp:Started t1/);
    const done = await say(`~mcpcall tasks {"action":"done","id":"t1","summary":"Held the lock"}`);
    assert.match(done, /mcp:[^]*t1/);
    assert.equal((await transcript()).turns.length, 3, "the turn that marked it done ended before its check did");
    const tr = await until(async () => {
      const t = await transcript();
      return (t.turns || []).length >= 4 && t.turns[3].final ? t : null;
    }, "the chat going on by itself as the check ends", { timeoutMs: 30_000 });
    const woken = tr.turns[3];
    assert.equal(woken.woke, true, "Filament's own turn");
    assert.ok(isWakeMessage(woken.user), "its message ends with Filament's line");
    const user = JSON.stringify(woken.user);
    assert.match(user, /task t1 \\"Fix the lock\\" passed its check, flaky: `node flaky\.cjs` failed \(exit 1, [^)]*\), then passed \(exit 0, [^)]*\) on a second run\. It is done\./, user);
    assert.match(user, /The end of its first run's output:\\nok 1 - parses\\nnot ok 2 - the lock was held/, "what failed, named");
    const shown = await say(`~mcpcall tasks {"action":"show","id":"t1"}`);
    assert.match(shown, /Checked, flaky: `node flaky\.cjs` failed[^]*The end of its first run's output:\nok 1 - parses\nnot ok 2 - the lock was held/, shown);
  } finally {
    await shim.stop();
    await up.close();
    rmSync(shim.dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

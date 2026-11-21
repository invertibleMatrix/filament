// @ts-check
// HarnessV4_Tasks C33, the line where the person wants it: the page lets it sit under half the window (400K of a 1M
// window is 40%), and a coding agent's own word for where it makes room (`/autocompact 400k`, Claude Code's) typed in
// a harness chat is kept as the session's line, so it lasts.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_ACP_AGENT, startApp } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";
import { compactionSettingsOf } from "../src/app/sessions/compactor.js";
import { linePercentOf, usableWindow, LINE_MIN as LOWEST, LINE_MAX as HIGHEST } from "../src/app/sessions/compaction.js";
import { compactPointOf, parseAgentCommand } from "../src/app/commands/acp.js";
import { LINE_MIN, LINE_MAX } from "../src/ui/harness/widgets/compaction.js";
import { claudeCompactWindow } from "../src/adapters/agents/acp/toolset.js";

/** JSON lines of a file, oldest first. @param {string} file */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

describe("the line", () => {
  // (fails before: yes — the slider's floor was 50, so 400K of a 1M window could not be set)
  test("the page's line goes as low as 15% of the window, the band a line named in tokens takes", () => {
    assert.ok(LINE_MIN <= 40 && LINE_MAX === 95);
    assert.deepEqual([LOWEST, HIGHEST], [LINE_MIN, LINE_MAX], "a line named in tokens takes the band the slider takes");
  });

  // (fails before: yes — the owner's rules of 10-31: no target under the line; a compaction makes what room its kind makes)
  test("the line is read as stored, and no target goes with it", () => {
    assert.equal("target" in compactionSettingsOf({ context: { compaction: { thresholdPercent: 40, target: 30 } } }), false);
    assert.equal(linePercentOf({ thresholdPercent: 40 }), 40);
    assert.equal(linePercentOf(null), 85);
    assert.equal(usableWindow(1_000_000, { thresholdPercent: 40 }), 400_000);
  });

  test("the tokens `/autocompact` names", () => {
    assert.deepEqual(["400k", "400K", "1m", "1.5m", "400,000", "400000", "400_000", "400k tokens", " auto "].map(compactPointOf), [400_000, 400_000, 1_000_000, 1_500_000, 400_000, 400_000, 400_000, 400_000, "auto"]);
    assert.deepEqual(["", "soon", "0", "-4k", "4g"].map(compactPointOf), [null, null, null, null, null]);
    assert.equal(parseAgentCommand("/autocompact 400k")?.[2], "400k");
    assert.equal(parseAgentCommand("/autocompact")?.[1], "autocompact");
  });
});

describe("`/autocompact` typed in a harness chat on a coding agent", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-c33-line-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{
          id: "claude",
          name: "claude",
          type: "acp",
          acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(root, "calls.jsonl"), FAKE_ACP_LOG: join(root, "prompts.jsonl"), FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close" }, cwdDefault: projDir, permissions: "allow-all" },
        }];
        cfg.routes = [{ match: "claude/*", upstream: "claude", upstreamModel: "{1}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });
  /** @param {string} id */
  const at = (id) => `/api/sessions/${encodeURIComponent(id)}`;
  /** @param {string} id @param {string} content */
  const say = async (id, content) => {
    const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(res.status, 200, await res.clone().text());
    const reply = await res.json();
    return (reply.content || []).filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text).join("");
  };
  /** The session's line, as its settings keep it. @param {string} id */
  const kept = async (id) => {
    const s = await (await shim.api(`${at(id)}/settings`)).json();
    return [s.flat["context.compaction.thresholdPercent"], s.sources["context.compaction.thresholdPercent"]];
  };
  /** What the agent was sent as a prompt. */
  const prompts = () => lines(join(root, "prompts.jsonl")).map((p) => String(p.prompt ?? p.text ?? ""));
  /** The sessions the agent was asked to open, each with the window it was given. */
  const opens = () => lines(join(root, "calls.jsonl")).filter((c) => /^session\/(new|load|resume)$/.test(c.method)).map((c) => [c.method, c.settings?.autoCompactWindow ?? null]);

  // (fails before: yes — the word went to the agent alone: Filament's line stayed where it was, and the next session
  // the chat opened was given Filament's line again)
  test("it is kept as the session's own line, said in the reply, never sent to the agent, and the agent's session is opened with it", async () => {
    const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "claude/fake-a", preset: "plain" } })).json()).id);
    // The agent names its window as its first turn ends: one million tokens.
    await say(id, "~window 1000000");
    assert.deepEqual(opens(), [["session/new", null]], "no window known as the session opened: no line to hand over yet");
    const said = await say(id, "/autocompact 400k");
    assert.match(said, /\*\*The compaction line is 400,000 tokens, 40% of the 1,000,000-token window\.\*\*/);
    assert.match(said, /every claude session this chat opens is opened with it/);
    assert.deepEqual(await kept(id), [40, "session"]);
    assert.ok(!prompts().some((p) => /autocompact/.test(p)), "Filament answered it: the agent was not asked");
    // The next message: the agent's session is opened again with the line (its window: the line and what it keeps free).
    await say(id, "two");
    assert.deepEqual(opens().at(-1), ["session/resume", claudeCompactWindow(400_000).window]);
    // Alone it says the line; a figure past the window is refused in words; auto gives the line back.
    assert.match(await say(id, "/autocompact"), /^This session's compaction line is 400,000 tokens, 40% of the 1,000,000-token window\./);
    assert.match(await say(id, "/autocompact 2m"), /\*\*The line was not changed:\*\* 2,000,000 tokens is past this model's window, 1,000,000\./);
    assert.match(await say(id, "/autocompact soon"), /^Usage: `\/autocompact <tokens>`/);
    // (fails before: yes — a figure under a tenth of the window was refused in a settings key's words, and one
    // between 10% and 15% was kept where the slider cannot show it)
    assert.match(await say(id, "/autocompact 120k"), /\*\*The line was not changed:\*\* 120,000 tokens is 12% of this model's 1,000,000-token window, and the lowest line is 15%: 150,000 tokens here\./);
    assert.match(await say(id, "/autocompact 990k"), /\*\*The line was not changed:\*\* 990,000 tokens is 99% of this model's 1,000,000-token window, and the highest line is 95%: 950,000 tokens here\./);
    assert.deepEqual(await kept(id), [40, "session"]);
    // 333k of a million is no whole percent: the reply says what it reads as.
    assert.match(await say(id, "/autocompact 333k"), /so 333,000 reads as 330,000\./);
    assert.match(await say(id, "/autocompact auto"), /^This session's compaction line follows your default again: 850,000 tokens, 85% of the 1,000,000-token window\./);
    assert.equal((await kept(id))[1] === "session", false);
  });
});

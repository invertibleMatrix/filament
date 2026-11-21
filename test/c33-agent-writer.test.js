// @ts-check
// HarnessV4_Tasks C33, step 5: a coding agent's model as the writer of a summary. The call is Filament's own (memory's)
// and goes to the agent as any request to its model does; the agent's turn reads it as one message, in a session of its
// own in a folder of Filament's, judged at read-only, offered none of Filament's tools, and closed with the call.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_ACP_AGENT, startApp, parseSse } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { houseAuth } from "../src/services/house.js";
import { asOneMessage, OWN_CALL_WORDS } from "../src/app/acp-turn.js";
import { costWords } from "../src/ui/harness/widgets/compaction.js";

// (fails before: yes — an agent's session reads the newest message alone, and a call's brief went nowhere)
test("a call of Filament's own reads as one message: its brief, the word to answer from the text alone, then its words", () => {
  const anthropic = asOneMessage("anthropic", { model: "claude/haiku", max_tokens: 900, system: "Write the summary.", stream: true, messages: [{ role: "user", content: "the transcript" }] });
  assert.deepEqual(anthropic, { model: "claude/haiku", max_tokens: 900, stream: true, messages: [{ role: "user", content: `Write the summary.\n\n${OWN_CALL_WORDS}\n\nthe transcript` }] });
  const openai = asOneMessage("openai", { model: "claude/haiku", messages: [{ role: "system", content: "Write the digest." }, { role: "user", content: "one turn" }] });
  assert.deepEqual(openai.messages, [{ role: "user", content: `Write the digest.\n\n${OWN_CALL_WORDS}\n\none turn` }]);
  assert.match(OWN_CALL_WORDS, /Call no tool, read no file and run no command/);
  // No brief: the word and the words.
  assert.equal(asOneMessage("anthropic", { messages: [{ role: "user", content: "words" }] }).messages[0].content, `${OWN_CALL_WORDS}\n\nwords`);
});

test("the card says where a coding agent writes: on your plan, in a session of its own", () => {
  assert.equal(costWords("summary", { cost: 0, listCost: null, slices: 1, model: "claude/haiku", agentWriter: true }, { model: true }), "On your plan · 1 call · claude/haiku · in a session of its own");
  assert.equal(costWords("trim", { cost: 0, listCost: null, slices: 3, model: "claude/haiku", agentWriter: true }), "On your plan · 3 calls · in a session of its own");
  assert.equal(costWords("summary", { cost: 0.02, listCost: 0.02, slices: 1, model: "cheap" }), "≈ $0.02 · 1 call");
});

describe("a summary's call to a coding agent's model", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  let log = "";
  let calls = "";
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-c33-writer-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    log = join(root, "prompts.jsonl");
    calls = join(root, "calls.jsonl");
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{
          id: "claude",
          name: "claude",
          type: "acp",
          // The upstream's own policy would allow everything: the call's read-only switch is what refuses.
          acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close", FAKE_ACP_LOG: log, FAKE_ACP_CALLS: calls }, cwdDefault: projDir, permissions: "allow-all" },
        }];
        cfg.routes = [{ match: "claude/*", upstream: "claude", upstreamModel: "{1}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });
  /** The file's lines, parsed. @param {string} file */
  const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  /** One call as memory makes it (services/memory/index.js `#ask`). @param {string} system @param {string} user @param {string} purpose */
  const ask = async (system, user, purpose = "compact") => {
    const res = await fetch(`${shim.url}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", ...houseAuth(), "user-agent": "filament-memory/0.1", "x-filament-memory": "off", "x-filament-memory-purpose": purpose, "x-session-id": "memory-same" },
      body: JSON.stringify({ model: "claude/fake-a", max_tokens: 4000, system, messages: [{ role: "user", content: user }], stream: true }),
    });
    const body = await res.text();
    assert.equal(res.status, 200, body);
    const text = parseSse(body).filter((e) => e.data?.type === "content_block_delta" && e.data.delta?.type === "text_delta").map((e) => e.data.delta.text).join("");
    return { text, id: String(res.headers.get("x-filament-request-id") || "") };
  };

  // (fails before: yes — the call was read as a client's housekeeping and answered by Filament with a trimmed
  // transcript, or run as a chat turn under the upstream's own policy, in the agent's default folder)
  test("the agent answers it in words, in a session of its own: its brief with its words, a folder of Filament's, none of Filament's tools, read-only, nothing of Filament's in the answer, and the session closed after", async () => {
    // "permission" in the words makes the fake agent ask to run a command, as a model that did not heed the word may.
    const out = await ask("Summarize the conversation below for a later model.", "User: may I have permission to deploy?\nAssistant: yes, on Friday");
    // Its answer alone: no tool line, no thought, no hint of Filament's; the command it asked to run was refused.
    assert.match(out.text, /^permission:no echo\(1\): /, `the upstream's allow-all did not answer, the call reads only: ${out.text}`);
    assert.doesNotMatch(out.text, /Read File|thinking about it|Filament/);
    const sent = lines(log).at(-1);
    assert.equal(sent.cwd, join(shim.dataDir, "agent-calls"), "a folder of Filament's, not the agent's default nor a project");
    assert.equal(sent.mcp, 0, "none of Filament's tools are offered");
    assert.match(sent.text, new RegExp(`^Summarize the conversation below for a later model\\.\\n\\n${OWN_CALL_WORDS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n\\nUser: may I have permission`));
    // Its record is memory's own call, with its purpose: the time a summary takes is read from such records.
    const rec = await shim.record(out.id);
    assert.deepEqual([rec.memoryFor?.purpose, rec.upstream, rec.status], ["compact", "claude", "ok"]);
    assert.ok(!(rec.changes || []).some((/** @type {string} */ c) => /housekeeping/.test(c)), "never a client's housekeeping");
    // The session it made is let go of with the call.
    await until(() => lines(calls).some((c) => c.method === "session/close" && c.sessionId === sent.sessionId), "the call's session closed");
    // A second call, the same header and all: a session of its own again, not the first one gone on in.
    const again = await ask("Summarize the conversation below for a later model.", "User: hello\nAssistant: hi");
    assert.match(again.text, /^echo\(1\): /, "its first prompt in a new session");
    assert.notEqual(lines(log).at(-1).sessionId, sent.sessionId);
  });

  // (fails before: yes — a slash at the start of a transcript was read as a chat command of Filament's)
  test("its words are never a chat command", async () => {
    const out = await ask("", "/status\nUser: what is the status?", "compact");
    assert.match(out.text, /^echo\(1\): /);
    assert.match(lines(log).at(-1).text, /\/status\nUser: what is the status\?$/);
  });
});

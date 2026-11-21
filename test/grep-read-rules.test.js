// @ts-check
// A session's rules on reading speak for grep and glob (Claude Code's Read rules speak for its Grep and Glob): what
// grep searches — rg, or the walker where there is none — and what glob lists leave out the files a read of would be
// refused, judged as `ruleFor` judges a read; a page and its "there are more" count only what is shown. A whole turn
// carries the session's rules to the hands.
// (fails before: yes — a read of .env was refused, and grep printed its lines)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHand } from "../src/adapters/tools/hands.js";
import { readRules, ruleFor } from "../src/app/agent/rules.js";
import { keptOut } from "../src/core/read-rules.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** A folder: a secret beside two plain files, all three holding the word KEY. */
const folder = () => {
  const d = mkdtempSync(join(tmpdir(), "filament-grep-rules-"));
  made.push(d);
  mkdirSync(join(d, "conf"));
  writeFileSync(join(d, "a.env"), "KEY=secret-one\n");
  writeFileSync(join(d, "conf", "b.env"), "KEY=secret-two\n");
  writeFileSync(join(d, "c.txt"), "KEY is read from the env\n");
  writeFileSync(join(d, "d.txt"), "no KEY here either\n");
  return d;
};
const DENY_ENV = [{ tool: "read", pattern: "*.env", verdict: /** @type {const} */ ("deny") }];

describe("the rules as a worker carries them", () => {
  // (fails before: yes — there was no such form)
  test("a file is kept out exactly where ruleFor refuses a read naming it, from the folder or whole", () => {
    const root = process.platform === "win32" ? "C:\\proj" : "/proj";
    const at = (/** @type {string} */ rel) => (process.platform === "win32" ? `${root}\\${rel.replace(/\//g, "\\")}` : `${root}/${rel}`);
    /** @type {any[][]} */
    const sets = [
      DENY_ENV,
      [{ tool: "read", pattern: "conf/*", verdict: "deny" }],
      [{ tool: "*", pattern: "*secret*", verdict: "deny" }],
      [{ tool: "read", pattern: "conf/keep.env", verdict: "allow" }, { tool: "read", pattern: "*.env", verdict: "deny" }],
      [{ tool: "read", pattern: "*.env", verdict: "ask" }, { tool: "read", pattern: "*.env", verdict: "deny" }],
      [{ tool: "read", pattern: "*.env", verdict: "ask" }, { tool: "read", pattern: "*.env", verdict: "review" }, { tool: "read", pattern: "conf/*", verdict: "deny" }],
      [{ tool: "write", pattern: "*.env", verdict: "deny" }, { tool: "grep", pattern: "*", verdict: "deny" }],
    ];
    const files = ["a.env", "conf/b.env", "conf/keep.env", "src/secret.js", "c.txt", "CONF/X.TXT"];
    for (const rules of sets) {
      const out = keptOut(readRules(rules) ? { root, rules: /** @type {any} */ (readRules(rules)) } : null);
      for (const f of files) {
        const refused = [f, at(f)].some((p) => ruleFor(rules, "read", { path: p })?.verdict === "deny");
        assert.equal(!!out?.(at(f)), refused, `${JSON.stringify(rules)} ${f}`);
      }
    }
    assert.equal(readRules([{ tool: "read", pattern: "*.env", verdict: "ask" }]), null, "no deny, nothing kept out");
  });
});

describe("grep and glob", () => {
  /** @type {string} */
  let root;
  before(() => {
    root = folder();
  });
  const fence = () => ({ root, rules: /** @type {any} */ (readRules(DENY_ENV)) });
  for (const [engine, noRg] of /** @type {const} */ ([["rg", false], ["walker", true]])) {
    // (fails before: yes — grep printed the secret's line)
    test(`${engine}: matching lines, files and counts leave out the files a read of is refused; a page counts only what it shows`, async () => {
      const grep = (/** @type {any} */ input) => runHand("grep", input, { root, noRg, readRules: fence() });
      assert.equal(await grep({ pattern: "KEY" }), "c.txt:1:KEY is read from the env\nd.txt:1:no KEY here either");
      assert.equal(await grep({ pattern: "KEY", output: "files" }), "c.txt\nd.txt");
      assert.equal(await grep({ pattern: "KEY", output: "count" }), "c.txt:1\nd.txt:1\n[2 matching lines in 2 files]");
      assert.equal(await grep({ pattern: "secret" }), "(no matches)");
      assert.equal(await grep({ pattern: "KEY", path: "a.env" }), "(no matches)", "the file named itself");
      assert.equal(await grep({ pattern: "KEY", limit: 2 }), "c.txt:1:KEY is read from the env\nd.txt:1:no KEY here either", "no page past what can be shown");
      assert.match(await runHand("grep", { pattern: "secret" }, { root, noRg }), /a\.env:1:KEY=secret-one/, "with no rules, all of them");
    });
  }

  // (fails before: yes — glob listed the secrets)
  test("glob lists no file a read of is refused", async () => {
    assert.equal(await runHand("glob", { pattern: "*" }, { root, readRules: fence() }), "c.txt\nd.txt");
    assert.equal(await runHand("glob", { pattern: "*.env" }, { root, readRules: fence() }), "No files match *.env under the task folder.");
    assert.equal(await runHand("glob", { pattern: "*.env" }, { root }), "a.env\nconf/b.env");
  });
});

describe("in a whole turn", () => {
  /** @type {any} */
  let up;
  /** @type {any} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = folder();
    up = await fakeUpstream(async (/** @type {any} */ call) => brain(call));
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
    made.push(shim.dataDir);
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });
  const answer = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });

  // (fails before: yes — the read rule refused a read of .env, and the agent's grep printed it)
  test("the session's read rule keeps the agent's grep and glob out of its files", async () => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { loop: { rules: DENY_ENV } } } });
    if (created.status !== 200) assert.fail(`HTTP ${created.status}: ${await created.text()}`);
    const id = String((await created.json()).id);
    /** @type {Record<string, string>} */
    let results = {};
    brain = (/** @type {any} */ call) => {
      const last = call.body.messages.at(-1);
      if (Array.isArray(last?.content)) for (const b of last.content) if (b?.type === "tool_result") results[b.tool_use_id] = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
      if (!("g1" in results))
        return answer([{ type: "tool_use", id: "g1", name: "grep", input: { pattern: "secret" } }, { type: "tool_use", id: "l1", name: "glob", input: { pattern: "*.env" } }], "tool_use");
      return answer([{ type: "text", text: "Done." }]);
    };
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "find the secret", stream: false } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    assert.deepEqual(results, { g1: "(no matches)", l1: "No files match *.env under the task folder." });
  });
});

// @ts-check
// Memory's model calls ask for the most their model can write, inside its window (HarnessV3-FailurePoints §13). A cap
// sized to the answer alone ended a reasoning model's calls in thought: GLM 5.3 spent a 1,500-token keying call
// thinking and answered nothing (HarnessV3-Memory M4-D22), and GLM 5.3 Flash spent each 1,500-token cap of the user's
// compaction slices thinking, so the compaction failed (2026-10-10). The length an answer should have is its prompt's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryService } from "../src/memory-service.js";
import { defaultsOf, RULES } from "../src/core/schema.js";
import { DEFAULT_OUTPUT_TOKENS, estimateTokens, replyHeadroom } from "../src/core/tokens.js";

/**
 * A front door that answers every call with `answer(body)`, and a memory service pointed at it.
 * @param {(b: any) => any} answer @param {{ windowFor?: (m: string) => number }} [o]
 */
async function door(answer, { windowFor = () => 0 } = {}) {
  /** @type {any[]} */
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const b = JSON.parse(body);
      seen.push(b);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(answer(b)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
  const port = /** @type {any} */ (server.address()).port;
  const dir = mkdtempSync(join(tmpdir(), "filament-room-"));
  const cfg = {
    memory: { enabled: false },
    rules: defaultsOf(RULES),
    upstreams: [{ id: "u", type: "anthropic", enabled: true, pricing: { "roomy-model": { maxOutputTokens: 64000 }, "windowed-model": { maxOutputTokens: 64000, contextTokens: 32000 } } }],
    routes: [{ match: "*-model", upstream: "u", upstreamModel: "{model}" }],
  };
  const svc = new MemoryService({ getConfig: () => cfg, dataDir: dir, log: () => {}, selfBase: () => `http://127.0.0.1:${port}`, windowFor });
  const close = () => {
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { svc, seen, close };
}
/** A plain answer. @param {string} text */
const said = (text) => ({ type: "message", role: "assistant", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });

// (fails before: yes — a judgement asked for its answer's room plus 4,096 tokens, a /trim slice for its 1,500)
test("every memory call asks for the most its model can write, inside its window, whatever its purpose", async () => {
  const d = await door(() => said("{}"), { windowFor: (m) => (m === "cached-model" ? 20000 : 0) });
  try {
    const ask = async (/** @type {string} */ model, purpose = "curate", user = "u") => {
      await d.svc.callModel({ system: "s", user, model, purpose });
      return d.seen.at(-1).max_tokens;
    };
    for (const purpose of ["curate", "learn", "recall", "signal", "estimate", "trim", "compact"])
      assert.equal(await ask("roomy-model", purpose), 64000, `${purpose}: the model's stated ceiling`);
    assert.equal(await ask("nobody-knows-it"), DEFAULT_OUTPUT_TOKENS, "a model nobody states a ceiling for: the 128,000 floor");
    const long = "a fact worth keeping. ".repeat(2000);
    const request = estimateTokens("s") + estimateTokens(long);
    assert.equal(await ask("windowed-model", "trim", long), 32000 - request - replyHeadroom(32000), "what the window leaves after the prompt, less the headroom");
    assert.equal(await ask("cached-model", "trim", long), 20000 - request - replyHeadroom(20000), "the window memory's model cache knows wins over the tables'");
    assert.equal(await ask("windowed-model", "trim", "x".repeat(200_000)), 64000, "a prompt the window cannot hold goes with the ceiling, and the provider says so");
  } finally {
    d.close();
  }
});

// (fails before: yes — the user's compaction, 2026-10-10: a slice went with max_tokens 1,500, GLM 5.3 Flash spent it all
// thinking, and every summary came back empty)
test("a summarizer that thinks first still answers: one call, with all the room its model has", async () => {
  // A model that thinks for 6,000 tokens before it writes: under that, it stops in thought with no text.
  const d = await door((b) =>
    b.max_tokens <= 6000
      ? { type: "message", role: "assistant", content: [{ type: "thinking", thinking: "let me weigh the turns" }], stop_reason: "max_tokens", usage: { input_tokens: 100, output_tokens: b.max_tokens } }
      : { type: "message", role: "assistant", content: [{ type: "thinking", thinking: "weighed" }, { type: "text", text: "the summary" }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 6400 } },
  );
  try {
    assert.equal(await d.svc.callModel({ system: "s", user: "EXCERPT (messages 1 to 40 of the earlier conversation)", model: "glm-model", purpose: "compact" }), "the summary");
    assert.equal(d.seen.length, 1, "one call: nothing is asked again");
  } finally {
    d.close();
  }
});

// (fails before: no — kept from M7-D69's mutation pass, where a count no call reported was summed to zero)
test("includeUsage: the call's billed usage; a count the route did not report stays null, never a fabricated zero", async () => {
  const d = await door((b) => ({ ...said('{"pairs":[]}'), usage: b.model === "quiet-model" ? { output_tokens: 70 } : { input_tokens: 100, output_tokens: 50 } }));
  try {
    const usageOf = async (/** @type {string} */ model) => /** @type {any} */ (await d.svc.callModel({ system: "s", user: "u", model, purpose: "curate", includeUsage: true }));
    const a = await usageOf("roomy-model");
    assert.deepEqual([a.text, a.usage], ['{"pairs":[]}', { input: 100, output: 50 }]);
    assert.deepEqual((await usageOf("quiet-model")).usage, { input: null, output: 70 }, "no input was reported");
  } finally {
    d.close();
  }
});

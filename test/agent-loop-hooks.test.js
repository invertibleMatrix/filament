// @ts-check
// HarnessV2 Phase 5 — session hooks through the loop, end to end against a scripted upstream and a scripted hook
// command (test/fixtures/hook.mjs): a pre-tool block, a pre-tool rewrite, a post-tool note, the turn-end verify
// send-back with the read-back judgement, and a session-start block.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

const HOOK = `node "${fileURLToPath(new URL("./fixtures/hook.mjs", import.meta.url))}"`;
const text = (blocks) => (blocks || []).filter((b) => b?.type === "text").map((b) => b.text).join("");
const lastResults = (msgs) => {
  const m = msgs.at(-1);
  return Array.isArray(m?.content) ? m.content.filter((c) => c?.type === "tool_result") : [];
};
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const reply = (blocks, stop = "end_turn", model = "brain-model") =>
  anthropicReply("", { model, stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });

describe("session hooks through the loop (HarnessV2 §5.6)", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  const configure = (cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
    cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.memory.autopilot = { enabled: false };
    cfg.memory.capture = { turns: true, learn: false };
    cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-agent-hooks-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({ memory: true, configure, keep: true });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const dir of [shim.dataDir, root]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
  /** @param {any} settings */
  const create = async (settings) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return (await r.json()).id;
  };
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return { headers: r.headers, json: await r.json() };
  };
  const events = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?limit=500`)).json()).events || [];

  test("a pre-tool block stops the write in words; a post-tool note rides the result; every run is on the record, the ops log and the run", async () => {
    const seen = join(root, "hooks-seen.jsonl");
    const id = await create({ hooks: [
      { on: "pre-tool", tool: "write", command: `${HOOK} record "${seen}" block writes are frozen today` },
      { on: "post-tool", tool: "read", command: `${HOOK} note` },
    ] });
    writeFileSync(join(root, "seed.txt"), "seed\n");
    let round = 0;
    /** @type {any[]} */
    let seenResults = [];
    brain = (call) => {
      round++;
      if (round === 1) return reply([toolUse("w1", "write", { path: "frozen.txt", content: "x\n" }), toolUse("r1", "read", { path: "seed.txt" })], "tool_use");
      seenResults = lastResults(call.body.messages);
      return reply([{ type: "text", text: "Done." }]);
    };
    up.reset();
    const r = await turn(id, "write frozen.txt and read seed.txt");
    assert.equal(text(r.json.content), "Done.");
    assert.equal(seenResults.length, 2);
    assert.equal(seenResults[0].is_error, true);
    assert.match(seenResults[0].content, /^Not run: the pre-tool hook `node .*hook\.mjs.*` blocked write — writes are frozen today\./);
    assert.ok(!existsSync(join(root, "frozen.txt")), "the blocked write never happened");
    assert.match(seenResults[1].content, /^ {5}1\tseed\n*\[hook node .*hook\.mjs.* note: saw post-tool of read\]$/s);
    const payload = JSON.parse(readFileSync(seen, "utf8").trim().split("\n")[0]);
    assert.equal(payload.event, "pre-tool"); assert.equal(payload.tool, "write"); assert.deepEqual(payload.input, { path: "frozen.txt", content: "x\n" }); assert.equal(payload.session, id); assert.equal(payload.turn, 1);
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    assert.equal(rec.hooks.length, 2);
    assert.deepEqual(rec.hooks.map((h) => [h.on, h.tool, h.verdict, h.exit]), [["pre-tool", "write", "block", 0], ["post-tool", "read", "allow", 0]]);
    assert.equal(rec.hooks[0].note, "writes are frozen today");
    assert.ok(rec.changes.some((c) => /^hook: pre-tool\(write\) node .* → block \(exit 0, \d+ ms\) — writes are frozen today$/.test(c)), rec.changes.join("\n"));
    assert.equal(rec.agent.toolCalls, 2, "both calls counted (one refused by the hook)");
    const ev = await events(rec.id);
    assert.deepEqual(ev.filter((e) => e.type === "hook").map((e) => [e.on, e.tool, e.verdict]), [["pre-tool", "write", "block"], ["post-tool", "read", "allow"]]);
    const wEnd = ev.find((e) => e.type === "tool-end" && e.name === "write");
    assert.equal(wEnd?.refused, true); assert.ok(wEnd?.hook);
    const opsRes = await (await shim.api("/api/ops?limit=80")).json();
    const ops = Array.isArray(opsRes) ? opsRes : opsRes.ops || opsRes.items || [];
    assert.ok(ops.some((o) => o.kind === "hook" && o.sub === "block"), `audited as a hook op: ${JSON.stringify(ops.slice(0, 3)).slice(0, 300)}`);
  });

  // (fails before: n/a — an image result is new; this pins that a withheld result withholds its image too)
  test("an image read (TL-D17): a post-tool note rides its words with the image after them; a post-tool block withholds the image with the words", async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.alloc(100, 7)]);
    writeFileSync(join(root, "pic.png"), png);
    /** @type {any[]} */
    let seenResults = [];
    let round = 0;
    brain = (call) => {
      round++;
      if (round % 2 === 1) return reply([toolUse(`p${round}`, "read", { path: "pic.png" })], "tool_use");
      seenResults = lastResults(call.body.messages);
      return reply([{ type: "text", text: "Seen." }]);
    };
    const noted = await create({ hooks: [{ on: "post-tool", tool: "read", command: `${HOOK} note` }] });
    up.reset();
    await turn(noted, "look at pic.png");
    assert.equal(seenResults[0].content.length, 2);
    assert.match(seenResults[0].content[0].text, /^\[pic\.png: a PNG image, 112 bytes\.\]\n\n\[hook node .*hook\.mjs.* note: saw post-tool of read\]$/s);
    assert.deepEqual(seenResults[0].content[1], { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } });
    const blocked = await create({ hooks: [{ on: "post-tool", tool: "read", command: `${HOOK} block no pictures` }] });
    await turn(blocked, "look at pic.png");
    assert.equal(seenResults[0].is_error, true);
    assert.match(seenResults[0].content, /^Result withheld by the post-tool hook `node .*hook\.mjs.*`: no pictures\.$/, "words only: the image is withheld with them");
  });

  test("a pre-tool rewrite renames the write's target; the record says the input was rewritten", async () => {
    const id = await create({ hooks: [{ on: "pre-tool", tool: "write", command: `${HOOK} rewrite renamed.txt` }] });
    let round = 0;
    brain = () => {
      round++;
      if (round === 1) return reply([toolUse("w1", "write", { path: "original.txt", content: "hello\n" })], "tool_use");
      return reply([{ type: "text", text: "Written." }]);
    };
    up.reset();
    const r = await turn(id, "write original.txt");
    assert.equal(readFileSync(join(root, "renamed.txt"), "utf8"), "hello\n");
    assert.ok(!existsSync(join(root, "original.txt")));
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    assert.equal(rec.hooks[0].rewrote, true);
    assert.equal(rec.hooks[0].verdict, "allow");
  });

  test("turn-end: loop.verify.afterEdits runs after a turn that wrote and sends a failing exit back for one more round; readBackBeforeDone asks for the read-back; a turn without writes runs neither", async () => {
    const id = await create({ loop: { verify: { afterEdits: `${HOOK} exit 2 tests failed: 1 of 3`, readBackBeforeDone: true } } });
    let round = 0;
    /** @type {string[]} */
    const userTexts = [];
    brain = (call) => {
      round++;
      const last = call.body.messages.at(-1);
      if (last?.role === "user" && Array.isArray(last.content) && last.content[0]?.type === "text") userTexts.push(last.content[0].text);
      if (round === 1) return reply([toolUse("w1", "write", { path: "impl.js", content: "export const x = 1;\n" })], "tool_use");
      if (round === 2) return reply([{ type: "text", text: "Implemented x." }]);
      if (round === 3) return reply([toolUse("r1", "read", { path: "impl.js" })], "tool_use");
      return reply([{ type: "text", text: "Read back; the tests still fail on an unrelated case." }]);
    };
    up.reset();
    const r = await turn(id, "implement x");
    assert.equal(text(r.json.content), "Implemented x.Read back; the tests still fail on an unrelated case.");
    assert.equal(round, 4, "one extra round: the send-back, then the read, then the answer");
    const back = userTexts.find((t) => /turn-end hook/.test(t));
    assert.ok(back, userTexts.join("\n---\n"));
    assert.match(back, /^\[Filament turn-end hook `node .*hook\.mjs.*` \(loop\.verify\.afterEdits\) → block, exit 2\]\ntests failed: 1 of 3\n\n\[Filament: loop\.verify\.readBackBeforeDone\] Read these files back before you finish and confirm they are as intended: impl\.js$/);
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    assert.ok(rec.changes.some((c) => c === "agent: the turn went back for one more round (1 turn-end hook block, 1 file not read back)"), rec.changes.join("\n"));
    assert.equal(rec.hooks.filter((h) => h.on === "turn-end").length, 1, "the verify command ran once: the send-back cap holds the turn the second time");
    assert.equal(rec.hooks[0].builtin, "loop.verify.afterEdits");
    assert.equal(rec.agent.status, "done");
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript?work=1`)).json();
    assert.equal(tr.turns[0].work.filter((m) => m.role === "user" && m.content?.[0]?.type === "text").length, 1, "the send-back is part of the turn's work");
    assert.deepEqual(tr.turns[0].final.content, [{ type: "text", text: "Read back; the tests still fail on an unrelated case." }]);

    round = 0;
    brain = () => reply([{ type: "text", text: "Nothing to write." }]);
    up.reset();
    const r2 = await turn(id, "just answer");
    const rec2 = await shim.record(r2.headers.get("x-filament-request-id"));
    assert.equal(rec2.hooks, undefined, "no writes, no verify, no read-back");
    assert.equal(text(r2.json.content), "Nothing to write.");
  });

  test("session-start: a blocking hook refuses the session's first turn in words, runs again on the next turn, and once it allows runs on no other turn", async () => {
    const seen = join(root, "start-seen.jsonl");
    const id = await create({ hooks: [{ on: "session-start", command: `${HOOK} record "${seen}" block not on a Friday` }] });
    brain = () => reply([{ type: "text", text: "unreachable" }]);
    up.reset();
    const r = await turn(id, "hello");
    assert.match(text(r.json.content), /The session-start hook `node .*hook\.mjs.*` blocked this session: not on a Friday\. Nothing ran\./);
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    assert.equal(rec.hooks.length, 1); assert.equal(rec.hooks[0].on, "session-start");
    assert.ok(rec.changes.some((c) => /a session-start hook blocked the session/.test(c)));
    assert.equal(readFileSync(seen, "utf8").trim().split("\n").length, 1);
    // The session has not started: the next turn runs the hook again (the developer fixed what it checks).
    const again = await turn(id, "hello again");
    assert.match(text(again.json.content), /blocked this session: not on a Friday/);
    assert.equal(readFileSync(seen, "utf8").trim().split("\n").length, 2, "the block did not count as the session's start");
    const ok = await create({ hooks: [{ on: "session-start", command: `${HOOK} record "${seen}" allow` }] });
    brain = () => reply([{ type: "text", text: "Hi." }]);
    up.reset();
    assert.equal(text((await turn(ok, "hello")).json.content), "Hi.");
    assert.equal(text((await turn(ok, "again")).json.content), "Hi.");
    assert.equal(readFileSync(seen, "utf8").trim().split("\n").length, 3, "turn 2 did not run it");
  });
});

// The op-log SINK redacts secrets (review P2): an upstream that echoes a credential in an error body reached
// ops.jsonl through a thrown error's message on the compaction/learner/engine/tool producers — the
// `log` channel already redacted its own lines, the other producers did not. Now OpLog.record redacts the title and
// sanitizeDetail redacts every string BEFORE truncating (truncating first could halve a token and evade the
// patterns). Also pinned here: a job carries its chain/requestId from creation (a THROWN job has no result, so its op
// would otherwise be an orphan no chain filter can find).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { OpLog } from "../src/ops.js";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";
import { uiSrc } from "./helpers/ui-src.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_SIDECAR = join(here, "fixtures", "fake-sidecar.mjs");
const KEY = "sk-ant-secretkey123456789ABCDEFGH"; // a credential-shaped string an upstream might echo in a 401 body

test("OpLog.record redacts secrets from the title and every detail string, in memory and on disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-opssink-"));
  try {
    const ops = new OpLog({ dataDir: dir });
    const op = ops.record("log", `upstream said no: ${KEY}`, { detail: { body: `Authorization: Bearer abcdefghijklmnop1234567890`, arr: [`token ${KEY}`], n: 3 } });
    assert.ok(op, "recorded");
    assert.ok(!op.title.includes("secretkey"), `title redacted: ${op.title}`);
    assert.ok(op.title.includes("sk-ant-…"), "the key's redacted prefix survives so the message still says WHICH credential shape");
    assert.ok(!op.detail.body.includes("abcdefghijklmnop1234567890"), `detail string redacted: ${op.detail.body}`);
    assert.ok(op.detail.body.includes("[redacted]"), "with the marker in place");
    assert.ok(!op.detail.arr[0].includes("secretkey"), "and array items");
    assert.equal(op.detail.n, 3, "numbers pass through untouched");
    await ops.flush?.();
    const onDisk = readFileSync(join(dir, "ops.jsonl"), "utf8");
    assert.ok(!onDisk.includes("secretkey") && !onDisk.includes("abcdefghijklmnop1234567890"), "the durable file is clean, not just the API view");
  } finally { for (let i = 0; i < 10; i++) { try { rmSync(dir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 150)); } } }
});

// ---- through a real server: the review's exact scenario, a summarizer 401 echoing the key ------------------------
let up, app, port, dataDir;
const H = { "content-type": "application/json", "x-api-key": "k" };
before(async () => {
  up = http.createServer((req, res) => {
    let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
      let body = {}; try { body = JSON.parse(b || "{}"); } catch {}
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "msg_x", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "EXPENSIVE MODEL ANSWER" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }));
    });
  });
  await new Promise((r) => up.listen(0, "127.0.0.1", r));
  dataDir = mkdtempSync(join(tmpdir(), "filament-opssink-e2e-"));
  const stateFile = join(dataDir, "fake-engine-state.json"); writeFileSync(stateFile, JSON.stringify({ memories: [], canonical: [], seq: 1 }));
  process.env.FILAMENT_MEMORY_SIDECAR = JSON.stringify({ command: process.execPath, args: [FAKE_SIDECAR], env: { FAKE_SIDECAR_STATE: stateFile } });
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.loopbackTrust = "legacy"; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  cfg.upstreams = [{ id: "u", name: "u", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${up.address().port}`, apiKey: "s", pricing: { "cheap-1": { input: 1, output: 1, contextTokens: 6000 }, "big-1": { input: 5, output: 5, contextTokens: 200000 } } }];
  cfg.routes = [{ match: "cheap-*", upstream: "u", upstreamModel: "{model}" }, { match: "big-*", upstream: "u", upstreamModel: "{model}" }];
  cfg.memory = { enabled: true, folder: join(dataDir, "mem"), models: { summarizer: "cheap-1" }, autopilot: { enabled: false }, capture: { turns: true, learn: false }, commands: { enabled: true, prefix: "@mem" }, privacy: { encryptArchive: true } };
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } }); port = (await app.start()).port;
});
after(async () => {
  try { if (app) await app.stop(); } catch {}
  try { up?.close(); } catch {}
  delete process.env.FILAMENT_MEMORY_SIDECAR;
  for (let i = 0; i < 10; i++) { try { rmSync(dataDir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
});

const jobOps = async () => (await (await fetch(`http://127.0.0.1:${port}/api/ops?limit=200&kinds=job`, { headers: H })).json()).ops;

// (fails before: no — the owner's rules of 10-31 took /trim, whose refused pass this test drove through a summarizer's
// 401; a memory job that fails on the same echo is the producer it pins now)
test("a failed job whose upstream echoed a key is redacted in the API AND in ops.jsonl", async () => {
  // The key FIRST: the op's title is capped at 160 chars, so a secret deep in the words would be cut by truncation
  // alone and prove nothing about redaction. At the front, truncation alone leaks it.
  const said = `invalid x-api-key: ${KEY} — the request was rejected`;
  app.memory.onJobEvent({ id: "compact-401", kind: "compact", chain: "chainK", requestId: "reqK", result: null, error: said }, "error", new Error(said));
  const failed = (await jobOps()).find((o) => o.ref?.jobId === "compact-401");
  assert.ok(failed, "the failure is recorded");
  const whole = JSON.stringify(failed);
  assert.ok(!whole.includes("secretkey"), `no fragment of the key survives: ${whole.slice(0, 260)}`);
  assert.ok(whole.includes("sk-ant-…"), `the redaction marker is there, proving redaction — not truncation — did it: ${whole.slice(0, 260)}`);
  await app.ops?.flush?.();
  const onDisk = readFileSync(join(dataDir, "ops.jsonl"), "utf8");
  assert.ok(!onDisk.includes("secretkey123456789"), "the durable file is clean");
});

test("a THROWN job still knows its chain and request", async () => {
  // A thrown run has no result, so the ref must come from the job. Driven through the real wiring (the api exposes
  // memory for exactly this kind of seeding).
  app.memory.onJobEvent({ id: "compact-crashed-1", kind: "compact", chain: "chainX", requestId: "reqX", result: null, error: "the wheels came off" }, "error", new Error("the wheels came off"));
  const crashed = (await jobOps()).find((o) => o.ref?.jobId === "compact-crashed-1");
  assert.ok(crashed, "the crash is a job op");
  assert.equal(crashed.sub, "error");
  assert.equal(crashed.ref.chainId, "chainX", "the chain survives the throw");
  assert.equal(crashed.ref.requestId, "reqX", "and so does the request");
});

// (fails before: yes — HarnessV4_Tasks U1, found in the live drive: a console page left open across a restart kept
// the dead process's calls "in flight"; nothing read the lists again when the stream came back)
test("the console reads its traffic again when the events stream opens a second time, and not on the first hello", () => {
  const ui = uiSrc();
  const sse = ui.slice(ui.indexOf("function connectEvents"), ui.indexOf("bindUi({"));
  // the configuration's version is asked too (HarnessV4_Settings_Plan HS-D3): a save may have landed while it was away;
  // and whether the page is a view-only device's (remote-view-console.test.js)
  assert.match(sse, /eventListeners\.hand\(ev\);\n.*\n\s*if \(ev\?\.type === "hello"\) \{ if \(streamGreeted\) \{ readTrafficAgain\(\); api\("\/state"\)\.then\(\(st\) => \{ setViewOnly\(viewOnlyOf\(st\)\); configFollow\.heard\(st\.configVersion\); \}, \(\) => \{\}\); \} streamGreeted = true; return; \}/);
  const again = ui.slice(ui.indexOf("function readTrafficAgain() {"), ui.indexOf("function connectEvents"));
  assert.match(again, /Promise\.all\(\[loadRequests\(\), loadOps\(\)\]\)\.then\(/, "the two lists the stream feeds");
  assert.match(again, /\(\) => \{ navBadges\(\); if \(state\.live && \[[^\]]+\]\.includes\(state\.tab\) && !state\.dirty\) scheduleRender\(true\); \}/, "drawn as a finished call is");
  assert.match(again, /\(e\) => setStatus\("err", `Connected again, but the traffic could not be read: \$\{e\.message\}`\)/, "a failed read names itself");
  assert.ok(!/loadAll\(/.test(again), "never the saved configuration: an edit in progress is the person's");
});

test("static UI pins: the All tab's merged list is sliced at render (Show more can appear)", () => {
  const ui = uiSrc();
  const at = ui.indexOf("const mixed = isAllTab");
  assert.ok(at > 0, "found the merged-feed construction");
  const block = ui.slice(at, at + 400);
  assert.ok(!/\.slice\(0, F\.limit\)/.test(block), "the merged feed is NOT sliced at construction — a pre-sliced list made visRows.length > F.limit permanently false, so Show more never appeared on All");
  assert.ok(ui.includes("mixedTable((mixed || []).slice(0, F.limit))"), "the slice happens at render");
});

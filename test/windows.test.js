// HarnessV3 Step 3, Phase 3A (D1–D4): a turn belongs to a window. The resolver answers a key with the chain it owns
// alone; every new turn is stamped with its window, its wire format and its pin identity; the chain's window list is
// built from older turns by D1's rule and kept up from then on; compactions say who compacted. And D3's suspicion,
// checked: a Claude Code-style tool loop whose person message loses its cache_control marker between legs still lands
// in the archive (the identity is the text, not the bytes).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Archive } from "../src/archive.js";
import { chainKeyForConversationId } from "../src/services/memory/brain.js";
import { pinHashOf } from "../src/core/fold.js";
import { createApp } from "../src/server.js";
import { removeDirs } from "./helpers/wait.js";
import { defaultConfig } from "../src/config.js";

const dir = mkdtempSync(join(tmpdir(), "filament-win-"));
let clock = 1_758_100_000_000;
const now = () => (clock += 1000);
const opened = [];
const open = (opts = {}) => { const a = new Archive({ file: opts.file || join(dir, `a${opened.length + 1}.db`), now, ...opts }); opened.push(a); return a; };
after(async () => {
  for (const a of opened) a.close();
  await removeDirs(dir);
});

const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
const final = (text) => ({ role: "assistant", content: [{ type: "text", text }] });
const img = (data) => ({ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data } }] });

describe("the pin identity of a person message (D3)", () => {
  test("a message with no text is not the empty message: two different images are two messages", () => {
    assert.notEqual(pinHashOf(img("aaaa")), pinHashOf(img("bbbb")));
    assert.equal(pinHashOf(img("aaaa")), pinHashOf(img("aaaa")));
    assert.equal(pinHashOf(img("aaaa")).length, 16);
    assert.equal(pinHashOf(user("same text")), pinHashOf({ role: "user", content: [{ type: "text", text: "same text", cache_control: { type: "ephemeral" } }] }), "re-serialization keeps the identity");
    assert.equal(pinHashOf({ role: "user", content: "" }), pinHashOf({ role: "user", content: [{ type: "text", text: "" }] }), "a truly empty message stays one identity");
    assert.notEqual(pinHashOf(img("aaaa")), pinHashOf({ role: "user", content: "" }), "an image is not an empty message");
  });

  test("the identity tells two image-only turns apart: the second opens its own turn, not a leg of the first", () => {
    const a = open();
    const c = a.chainForKey("h:imgs", { client: "opencode", cwd: "C:\\w" });
    const t1 = a.beginTurn(c.id, { window: "h:imgs", format: "anthropic", userMessage: img("aaaa") });
    const t2 = a.beginTurn(c.id, { window: "h:imgs", format: "anthropic", userMessage: img("bbbb") });
    assert.equal(t1.isNew, true);
    assert.equal(t2.isNew, true, "a different screenshot is a new turn, not another leg of the open one");
    assert.equal(t2.n, 2);
  });

  test("Archive.turnWindow is D1's one rule for an unstamped turn", () => {
    assert.equal(Archive.turnWindow({ meta: { client: "harness" } }, { key: "h:z" }), "harness");
    assert.equal(Archive.turnWindow({ meta: { composed: { strategy: "raw" } } }, { key: "h:z" }), "harness");
    assert.equal(Archive.turnWindow({ meta: { client: "opencode" } }, { key: "h:z" }), "h:z");
    assert.equal(Archive.turnWindow({ meta: null }, { key: "h:z" }), "h:z");
    assert.equal(Archive.turnWindow(null, null), "unknown");
  });
});

describe("the resolver and the stamps (D1–D4)", () => {
  // (fails before: yes — a key an archive's `chain_windows` named (`@mem attach`) resolved to the session it was attached
  // to, and chainForKey went on in that session instead of birthing the key's own: the owner's rule of 10-31, an outside
  // client's chat is its own session)
  test("a key resolves to the chain it owns alone: an older archive's attached windows are never read", () => {
    const file = join(dir, "older.db");
    const made = new Archive({ file, now });
    const c = made.chainForKey("h:main", { client: "opencode", cwd: "C:\\w" });
    made.close();
    // An older archive keeps a table of the windows attached to its sessions, a row of it naming this session.
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE IF NOT EXISTS chain_windows (key TEXT PRIMARY KEY, chain_id TEXT, client TEXT, created_at INT)");
    db.prepare("INSERT INTO chain_windows (key, chain_id, client, created_at) VALUES (?, ?, ?, ?)").run("h:second", c.id, "claude-code", 1);
    db.close();
    const a = open({ file });
    assert.equal(a.chainIdForKey("h:main"), c.id, "the chain's own key resolves");
    assert.equal(a.chainIdForKey("h:second"), null, "a key no chain owns resolves to nothing");
    assert.equal(a.chainIdForKey("h:unknown"), null);
    const second = a.chainForKey("h:second", { client: "claude-code", cwd: "C:\\w" });
    assert.equal(second.isNew, true, "the key's own chain is born");
    assert.notEqual(second.id, c.id);
    assert.equal(a.chainIdForKey("h:second"), second.id);
  });

  // (fails before: yes — every archive made a table for the windows attached to its sessions)
  test("a new archive keeps no table of attached windows", () => {
    const a = open();
    assert.deepEqual(a.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'chain_windows%'").all(), []);
  });

  test("a turn is stamped with its window, its wire format and its pin identity", () => {
    const a = open();
    const c = a.chainForKey("h:z", { client: "opencode", cwd: "C:\\w" });
    const { turnId } = a.beginTurn(c.id, { client: "opencode", window: "h:z", format: "anthropic", userMessage: user("read the config") });
    const t = a.getTurn(turnId);
    assert.equal(t.meta.window, "h:z");
    assert.equal(t.meta.format, "anthropic");
    assert.equal(typeof t.meta.key, "string", "the pin identity is stamped");
    a.finishTurn(turnId, { finalMessage: final("done") });
    // The window list exists from the first stamped turn, with the client
    assert.deepEqual(a.windowsOf(c.id), { "h:z": { client: "opencode" } });
  });

  test("Filament's own machinery stamps no window", () => {
    const a = open();
    const c = a.chainForKey("h:d", { client: "opencode", cwd: "C:\\w" });
    a.beginTurn(c.id, { userMessage: user("tick task") });
    const t = a.getTurns(c.id).at(-1);
    assert.equal(t.meta.window, undefined);
    assert.equal(t.meta.client, undefined, "the housekeeping write stays clientless");
    assert.ok(t.meta.key, "the pin identity is stamped all the same");
    assert.deepEqual(a.windowsOf(c.id), { "h:d": { client: "opencode" } }, "an unstamped turn counts as the chain's own window (D1's rule), the chain's client its label");
  });

  test("older turns give D1's windows: harness-stamped ones are the harness's, the rest the chain's own key", () => {
    const a = open();
    const c = a.chainForKey("h:mixed", { client: "opencode", cwd: "C:\\w" });
    // three old turns: two the client typed (no window stamp — before this step), one the harness composed
    const cases = [
      [1, { client: "opencode" }],
      [2, { client: "harness", composed: { strategy: "raw" } }],
      [3, { client: "opencode" }],
    ];
    for (const [n, meta] of cases) {
      const { turnId } = a.beginTurn(c.id, { userMessage: user(`old ${n}`) });
      a.mergeTurnMeta(turnId, meta);
      a.finishTurn(turnId, { finalMessage: final(`a${n}`) });
    }
    assert.deepEqual(
      a.windowsOf(c.id),
      { "h:mixed": { client: "opencode" }, harness: { client: "harness" } },
      "built from the turns on first read",
    );
    // persisted: a second read does not rebuild, a turn of a listed window keeps the list, and a new window joins it
    const { turnId } = a.beginTurn(c.id, { client: "harness", window: "harness", format: "anthropic", userMessage: user("new here") });
    a.finishTurn(turnId, { finalMessage: final("ok") });
    assert.deepEqual(
      a.windowsOf(c.id),
      { "h:mixed": { client: "opencode" }, harness: { client: "harness" } },
    );
    a.beginTurn(c.id, { client: "codex", window: "h:other", format: "openai", userMessage: user("from another window") });
    assert.deepEqual(
      a.windowsOf(c.id),
      { "h:mixed": { client: "opencode" }, harness: { client: "harness" }, "h:other": { client: "codex" } },
    );
  });

  test("compactions say who compacted, and the window survives a fork", () => {
    const a = open();
    const c = a.chainForKey("h:cc", { client: "opencode", cwd: "C:\\w" });
    const { turnId } = a.beginTurn(c.id, { window: "h:cc", format: "anthropic", userMessage: user("go") });
    a.finishTurn(turnId, { finalMessage: final("done") });
    a.addCompaction(c.id, { fromTurn: 1, toTurn: 1, summaryText: "the summary", kind: "client", window: "h:cc", method: "summary" });
    assert.equal(a.getCompactions(c.id)[0].window, "h:cc");
    assert.equal(a.addCompaction(c.id, { fromTurn: 1, toTurn: 1, summaryText: "s2", kind: "plain", window: "harness", method: "summary" })?.id > 0, true);
    const fork = a.forkChain(c.id, { atTurn: 1, key: "h:fork-of-cc" });
    const windows = a.getCompactions(fork.id).map((x) => x.window);
    assert.ok(windows.includes("h:cc") && windows.includes("harness"), "the forked compactions keep their windows");
  });

});

describe("D3's suspicion: a Claude Code tool loop whose person message loses its cache_control marker", () => {
  let up, app, port, dataDir, bodies = [];
  const SYS = (cwd) => ({ role: "system", content: `You help.\nWorking directory: ${cwd}` });
  before(async () => {
    up = http.createServer((req, res) => {
      let buf = "";
      req.on("data", (d) => (buf += d));
      req.on("end", () => {
        const body = JSON.parse(buf || "{}");
        bodies.push(body);
        const wantsTool = bodies.length === 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "c", object: "chat.completion", model: body.model,
          choices: [{
            index: 0,
            message: wantsTool
              ? { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "Read", arguments: "{\"file_path\":\"a.js\"}" } }] }
              : { role: "assistant", content: "here is the answer" },
            finish_reason: wantsTool ? "tool_calls" : "stop",
          }],
          usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
        }));
      });
    });
    await new Promise((r) => up.listen(0, "127.0.0.1", r));
    dataDir = mkdtempSync(join(tmpdir(), "filament-cc-"));
    const cfg = defaultConfig();
    cfg.server.port = 0;
    cfg.server.inboundKeys = ["k"];
    cfg.observability.logFile = "";
    cfg.upstreams = [{ id: "oai", name: "oai", type: "openai-compatible", baseUrl: `http://127.0.0.1:${up.address().port}`, apiKey: "s" }];
    cfg.routes = [{ match: "gpt-*", upstream: "oai", upstreamModel: "{model}" }];
    cfg.memory = { enabled: true, folder: join(dataDir, "mem"), privacy: { encryptArchive: false }, autopilot: { enabled: false }, capture: { turns: true, learn: false }, commands: { enabled: false } };
    writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
    app = createApp({ dataDir });
    port = (await app.start()).port;
  });
  after(async () => {
    await app.stop();
    up.close();
    for (let i = 0; i < 10; i++) {
      try { rmSync(dataDir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 150)); }
    }
  });
  const messages = (msgs) =>
    fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer k", "x-session-id": "cc-leg" },
      body: JSON.stringify({ model: "gpt-x", max_tokens: 100, messages: msgs }),
    }).then((r) => r.json());

  // (fails before: yes — turnForUser's byte-exact match broke when the client re-serialized the person message,
  // so the leg's work went unarchived; D3's fix is the pin identity, and this pins it)
  test("the leg still lands in the archive: one turn, its work, and the leg's reply as the final", async () => {
    const cwd = "C:\\cc";
    const person = { role: "user", content: [{ type: "text", text: "read the config", cache_control: { type: "ephemeral" } }] };
    const first = await messages([SYS(cwd), person]);
    assert.equal(first.stop_reason, "tool_use", "the first reply asks for the tool");
    // The next leg: the same person message WITHOUT the marker (the client moved it), and the tool's result
    const leg = await messages([
      SYS(cwd),
      { role: "user", content: [{ type: "text", text: "read the config" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.js" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "the bytes" }] },
    ]);
    assert.equal(leg.stop_reason, "end_turn");
    const a = new Archive({ file: join(dataDir, "mem", "archive.db"), now });
    try {
      const chainId = a.chainIdForKey(chainKeyForConversationId("cc-leg"));
      assert.ok(chainId, "the session exists");
      const turns = a.getTurns(chainId);
      assert.equal(turns.length, 1, "the leg continued the same turn — no phantom second turn");
      const t = a.turnBodies(chainId)[0];
      const work = t.work || [];
      assert.equal(work.length, 2, "the loop so far — the call and its result — joined the turn's work");
      assert.ok(t.final, "the leg's reply is the turn's final");
    } finally {
      a.close();
    }
  });
});

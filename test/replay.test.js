import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";

// The fake provider answers differently per model, so the replay's reply proves it went to the other model.
let fake, app, port, dataDir, hits;
before(async () => {
  hits = [];
  fake = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    if (req.method === "GET") { res.writeHead(404); return res.end(); } // a model-list ask (a save that changed the address asks once, Providers P0)
    const body = JSON.parse(b); hits.push({ url: req.url, body, headers: req.headers });
    const who = body.model.includes("sonnet") ? "sonnet says" : "opus says";
    const c0 = body.messages?.[0]?.content;
    const userText = typeof c0 === "string" ? c0 : Array.isArray(c0) ? (c0.find((b) => b?.type === "text")?.text || "") : "";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg_x", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: `${who}: ${userText.slice(0, 40)}` }], stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 5 } }));
  }); });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  dataDir = mkdtempSync(join(tmpdir(), "filament-replay-"));
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  cfg.observability.storeBodies = "full";
  cfg.upstreams = [{ id: "m", name: "m", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${fake.address().port}`, apiKey: "s" }];
  cfg.routes = [{ match: "claude-*", upstream: "m", upstreamModel: "{model}" }];
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } }); port = (await app.start()).port;
});
after(async () => { await app.stop(); fake.close(); rmSync(dataDir, { recursive: true, force: true }); });

test("replay: the stored body goes to another model, memory off, linked record, agents refused", async () => {
  const post = (path, body, headers = {}) => fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k", ...headers }, body: JSON.stringify(body) });
  const r1 = await post("/v1/messages", { model: "claude-opus-5", max_tokens: 100, messages: [{ role: "user", content: "fix the flux capacitor" }] });
  assert.equal(r1.status, 200);
  assert.match((await r1.json()).content[0].text, /opus says/);
  const orig = (await (await fetch(`http://127.0.0.1:${port}/api/requests?limit=5`)).json()).requests.find((x) => x.status === "ok");
  assert.ok(orig?.id, "original request recorded");

  const rep = await (await post(`/api/requests/${orig.id}/replay`, { model: "claude-sonnet-5" })).json();
  assert.equal(rep.ok, true, JSON.stringify(rep));
  assert.match(rep.reply, /sonnet says: fix the flux capacitor/, "the replay carried the same body to the other model");
  assert.ok(rep.record?.id, "the replay produced its own record");
  const recs = (await (await fetch(`http://127.0.0.1:${port}/api/requests?limit=5`)).json()).requests;
  const repRec = recs.find((x) => x.id === rep.record.id);
  assert.equal(repRec?.replayOf, orig.id, "the replay record links to the original");
  const replayHit = hits.find((x) => x.body.model === "claude-sonnet-5");
  // Deliberately streaming now (it used to be false): a non-streaming call only has a first-byte time once the whole
  // reply has landed, so its "TTFT" is really its total. Streaming is the only way the comparison's first-byte column
  // means what it says. The body is otherwise the stored one, untouched.
  assert.equal(replayHit.body.stream, true, "replays stream, so first-byte time is measurable");
  assert.equal(replayHit.body.model, "claude-sonnet-5", "and the stored body still carries the new model");
  // Filament's cache rules may normalise a plain string into text blocks with cache_control markers, so compare the
  // text rather than the exact shape — what matters is that the user's words arrived untouched.
  const sentContent = replayHit.body.messages[0].content;
  const sentText = typeof sentContent === "string" ? sentContent : (Array.isArray(sentContent) ? sentContent.filter((b) => b?.type === "text").map((b) => b.text).join("") : "");
  assert.equal(sentText, "fix the flux capacitor", "and the original message text, unchanged");

  // refusals: no route, no such request, and a route whose FALLBACK is an agent (failover would run it for real)
  const noRoute = await (await post(`/api/requests/${orig.id}/replay`, { model: "nope-xyz" })).json();
  assert.equal(noRoute.error.includes("no route"), true);
  const noBody = await (await post(`/api/requests/zzz/replay`, { model: "claude-sonnet-5" })).json();
  assert.ok(/no such request/.test(noBody.error));
  const cfgR = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  const cfg = cfgR.config;
  cfg.upstreams.push({ id: "agent1", name: "agent", type: "acp", baseUrl: "", apiKey: "", acp: { command: "no-such-agent", args: [] } });
  cfg.routes.push({ match: "safe-*", upstream: "m", upstreamModel: "{model}", fallbacks: [{ upstream: "agent1", upstreamModel: "{model}" }] });
  await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cfg) });
  const agentFb = await (await post(`/api/requests/${orig.id}/replay`, { model: "safe-1" })).json();
  assert.match(agentFb.error, /coding agent "agent1"/, "an agent in the fallbacks refuses the replay");
  assert.equal(hits.filter((x) => x.url.includes("/v1/messages")).length, 2, "nothing was sent for the refused replay");
});

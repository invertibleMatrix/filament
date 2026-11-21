import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { defaultConfig, loadConfig } from "../src/config.js";
import { deobfuscate, QODER, obfuscate, cosyHeaders, buildPayload, startDeviceLogin, parseExpiry, qoderEndpoints, chatBase, pollDeviceLogin, listModels, chat, isSignatureRejection, qoderDestination } from "../src/qoder.js";
import { watchDispatches } from "./helpers/dispatch.js";
import { applyImport } from "../src/migrate.js";

test("obfuscate keeps length, uses the substituted alphabet, and pads with $", () => {
  const out = obfuscate(JSON.stringify({ a: 1 }));
  const b64 = Buffer.from(JSON.stringify({ a: 1 })).toString("base64");
  assert.equal(out.length, b64.length);
  const s = out.toString("latin1");
  assert.ok(!/[A-Za-z0-9+/]{4}=*$/.test(s) || s !== b64, "must not be plain base64");
  assert.ok(/^[_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!$]+$/.test(s), s);
});

test("deobfuscate inverts obfuscate", () => {
  for (const j of ['{"a":1}', '{"messages":[{"role":"user","content":"hello there, this is a longer body ✓"}]}', "x", "ab", "abcd"]) assert.equal(deobfuscate(obfuscate(j)), j);
});

test("cosy headers sign the body, path and date and carry the user id", () => {
  const body = Buffer.from("hello", "latin1");
  const h = cosyHeaders(body, "https://api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation?x=1", { userId: "u1", authToken: "dt-abc", name: "N", email: "e@x", machineId: "m1" });
  assert.ok(h.Authorization.startsWith("Bearer COSY.")); assert.equal(h["Cosy-User"], "u1"); assert.equal(h["Cosy-Machineid"], "m1");
  assert.equal(h["Cosy-Bodyhash"], createHash("md5").update(body).digest("hex")); assert.equal(h["Cosy-Bodylength"], "5"); assert.equal(h["Cosy-Sigpath"], "/api/v2/service/pro/sse/agent_chat_generation");
  const [, payload, sig] = h.Authorization.slice("Bearer ".length).split(".");
  const expected = createHash("md5").update(Buffer.from(`${payload}\n${h["Cosy-Key"]}\n${h["Cosy-Date"]}\nhello\n${h["Cosy-Sigpath"]}`, "latin1")).digest("hex");
  assert.equal(sig, expected);
  assert.throws(() => cosyHeaders(body, "https://x/algo/p", { userId: "", authToken: "t" }), /user id/);
});

test("buildPayload shapes an OpenAI request into Qoder's chat request", () => {
  const p = buildPayload({ modelId: "lite", userId: "u1", modelConfig: { key: "lite", is_reasoning: true, max_output_tokens: 8000, source: "system" }, body: { model: "lite", max_tokens: 500, messages: [{ role: "system", content: "sys" }, { role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }], tools: [{ type: "function", function: { name: "f", parameters: {} } }] } });
  assert.equal(p.system, "sys"); assert.equal(p.messages.length, 1); assert.ok(Array.isArray(p.messages[0].content) && p.messages[0].content.some((x) => x.type === "text" && x.text === "hi") && p.messages[0].content.some((x) => x.type === "image_url" && x.image_url.url.startsWith("data:image/png")), "image parts are kept for Qoder");
  assert.equal(p.parameters.max_tokens, 500); assert.equal(p.tools.length, 1); assert.equal(p.model_config.key, "lite"); assert.equal(p.chat_context.extra.modelConfig.is_reasoning, true);
  assert.equal(p.session_type, "qodercli"); assert.equal(p.stream, true); assert.ok(p.session_id.length === 16 && p.chat_record_id.length === 16);
});

test("device login start produces a PKCE URL; expiry parsing accepts all shapes", () => {
  const s = startDeviceLogin(); const u = new URL(s.url);
  assert.equal(u.origin + u.pathname, QODER.loginUrl); assert.equal(u.searchParams.get("challenge_method"), "S256"); assert.equal(u.searchParams.get("nonce"), s.nonce); assert.equal(u.searchParams.get("machine_id"), s.machineId);
  assert.equal(u.searchParams.get("challenge"), createHash("sha256").update(s.verifier).digest("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"));
  assert.equal(parseExpiry(1700000000000), 1700000000000); assert.equal(parseExpiry("2026-10-11T21:07:37.896Z"), Date.parse("2026-10-11T21:07:37.896Z")); assert.ok(parseExpiry(undefined, 60) - Date.now() <= 60000);
});

test("region china switches every endpoint to the qoder.cn deployment", async () => {
  const cn = qoderEndpoints("china"); const alsoCn = qoderEndpoints("cn");
  // the international branch is asserted relative to QODER: the fake-cloud hook below re-points QODER's hosts
  // at a local server, and the default region must keep following whatever QODER holds.
  assert.equal(qoderEndpoints().loginUrl, QODER.loginUrl);
  assert.equal(chatBase({ accessToken: "dt-1", region: "" }), QODER.chatBase);
  assert.equal(chatBase({ accessToken: "jt-1", region: "" }), QODER.chatBaseJob);
  assert.equal(cn.loginUrl, "https://qoder.cn/device/selectAccounts");
  assert.equal(cn.openApi, "https://openapi.qoder.com.cn"); assert.equal(cn.userInfo, "https://openapi.qoder.com.cn/api/v1/userinfo"); assert.equal(cn.patExchange, "https://openapi.qoder.com.cn/api/v1/jobToken/exchange"); assert.equal(cn.quota, "https://openapi.qoder.com.cn/api/v2/quota/usage");
  assert.equal(cn.chatBase, "https://gateway.qoder.com.cn"); assert.equal(cn.chatBaseJob, "https://gateway.qoder.com.cn");
  assert.equal(alsoCn.loginUrl, cn.loginUrl);
  const s = startDeviceLogin("china");
  assert.equal(new URL(s.url).origin, "https://qoder.cn"); assert.equal(s.region, "china");
  assert.equal(new URL(s.url).searchParams.get("client_id"), "732aef47-9cf2-46a2-95fe-4cebb5d0d1fa", "qoder.cn requires the CN app's client_id");
  assert.equal(new URL(startDeviceLogin().url).origin, new URL(QODER.loginUrl).origin);
  assert.equal(new URL(startDeviceLogin().url).searchParams.get("client_id"), null);
  assert.equal(chatBase({ accessToken: "dt-1", region: "china" }), "https://gateway.qoder.com.cn");
  assert.equal(chatBase({ accessToken: "jt-1", region: "china" }), "https://gateway.qoder.com.cn");
  // the pending device login carries its region, so pollDeviceLogin(pend) polls the right deployment
  const polled = [];
  const fake = async (url) => { polled.push(String(url)); return { status: 202, ok: false }; };
  await pollDeviceLogin({ ...s, verifier: s.verifier }, fake);
  assert.ok(polled[0].startsWith("https://openapi.qoder.com.cn/api/v1/deviceToken/poll"), polled[0]);
});

test("a 403 Signature invalid is explained in words, not a bare status", async () => {
  assert.ok(isSignatureRejection(403, '{"code":"101","message":"Signature invalid"}'));
  assert.ok(!isSignatureRejection(403, '{"code":"112","message":"credits exhausted"}'));
  assert.ok(!isSignatureRejection(429, '{"code":"101"}'));
  const upstream = { id: "q", type: "qoder", apiKey: "", qoder: { region: "", authMethod: "device", accessToken: "dt-1", userId: "u1", machineId: "m1" } };
  const refuse = { status: 403, ok: false, text: async () => JSON.stringify({ code: "101", message: "Signature invalid" }) };
  await assert.rejects(listModels(upstream, { fetchImpl: async () => refuse }), /refused the signed request/i);
  await assert.rejects(chat({ upstream, modelId: "lite", body: { messages: [{ role: "user", content: "hi" }] }, fetchImpl: async () => refuse }), /refused the signed request/i);
});

// (fails before: no — a guard the mutation pass asked for: every Qoder test hands in its own fetch, so nothing showed
// that a chat's calls go without Node's fetch limits when none is — HarnessV3-FailurePoints §4 A)
test("a Qoder chat's calls go without Node's fetch limits by default; none is answered here", async () => {
  const upstream = { id: "q", type: "qoder", apiKey: "", qoder: { region: "", authMethod: "device", accessToken: "dt-1", userId: "u1", machineId: "m1" } };
  const seen = await watchDispatches(async () => {
    await Promise.resolve(qoderDestination(upstream).answers.open({ body: { messages: [{ role: "user", content: "hi" }] }, modelId: "lite", signal: null })).catch(() => {});
  }, { refuse: true });
  assert.ok(seen.some((s) => s.path.includes("/agent_chat_generation")), JSON.stringify(seen));
  assert.deepEqual(seen.filter((s) => s.headersTimeout !== 0 || s.bodyTimeout !== 0), [], "every call asked for no limit");
});

test("the COSY RSA public key is byte-exact (one wrong character breaks every signature)", () => {
  // pinned from the working key; a single corrupted character once produced 403 "Signature invalid" everywhere
  assert.equal(QODER.publicKey, `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`);
});

test("applyImport maps 9router connections onto Filament upstreams without overwriting existing secrets", () => {
  const cfg = defaultConfig(); cfg.upstreams = [{ id: "anthropic", type: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "sk-mine", enabled: true }]; cfg.routes = [{ match: "*", upstream: "anthropic", upstreamModel: "{model}" }];
  const conns = [
    { provider: "anthropic", authType: "apikey", active: true, data: { apiKey: "sk-from-9router" } },
    { provider: "qoder", authType: "oauth", active: true, email: "me@x", data: { accessToken: "dt-1", refreshToken: "drt-1", expiresAt: "2026-10-11T00:00:00Z", displayName: "Me", providerSpecificData: { userId: "u9", machineId: "m9" } } },
    { provider: "cursor", authType: "oauth", active: true, data: {} },
    { provider: "kimi", authType: "oauth", active: false, data: {} },
  ];
  const { config, report } = applyImport(cfg, conns);
  assert.equal(config.upstreams.find((u) => u.id === "anthropic").apiKey, "sk-mine");
  const q = config.upstreams.find((u) => u.type === "qoder"); assert.ok(q); assert.equal(q.qoder.accessToken, "dt-1"); assert.equal(q.qoder.userId, "u9"); assert.equal(q.qoder.email, "me@x"); assert.ok(q.qoder.expiresAt > 0);
  assert.equal(config.routes[0].match, "qd/*", "qd route inserted before the catch-all"); assert.equal(config.routes.at(-1).match, "*");
  assert.ok(report.some((r) => r.provider === "anthropic" && r.action === "kept existing key")); assert.ok(report.some((r) => r.provider === "cursor" && r.action === "skipped"));
  const { config: c2 } = applyImport(cfg, conns, { overwrite: true }); assert.equal(c2.upstreams.find((u) => u.id === "anthropic").apiKey, "sk-from-9router");
});

// ---- integration against a fake Qoder cloud ----
let fake, app, port, dataDir, seen = [], pollCount = 0;
before(async () => {
  fake = http.createServer((req, res) => { const chunks = []; req.on("data", (d) => chunks.push(d)); req.on("end", () => {
    const body = Buffer.concat(chunks); const u = new URL(req.url, "http://x");
    const J = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (u.pathname === "/algo/api/v2/model/list") { seen.push({ kind: "models", headers: req.headers }); return J(200, { chat: [{ key: "lite", display_name: "Lite", max_input_tokens: 128000, max_output_tokens: 8192, is_reasoning: false, enable: true }, { key: "hidden", enable: false }] }); }
    if (u.pathname === "/algo/api/v2/service/pro/sse/agent_chat_generation") {
      seen.push({ kind: "chat", headers: req.headers, body: body.toString("latin1"), query: u.search });
      const wrap = (inner) => `data: ${JSON.stringify({ statusCodeValue: 200, body: typeof inner === "string" ? inner : JSON.stringify(inner) })}\n\n`;
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (req.headers["x-model-key"] === "broke") { res.end(`data: ${JSON.stringify({ statusCodeValue: 403, body: JSON.stringify({ code: "112", message: "Your personal Credits have been exhausted" }) })}\n\n`); return; }
      res.end(wrap({ id: "c1", choices: [{ index: 0, delta: { role: "assistant", content: "hello " }, finish_reason: null }] }) + wrap({ id: "c1", choices: [{ index: 0, delta: { content: "from qoder" }, finish_reason: null }] }) + wrap({ id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 3 } }) + wrap("[DONE]"));
      return;
    }
    if (u.pathname === "/algo/api/v2/image/upload") { seen.push({ kind: "upload", headers: req.headers, method: req.method, body: body.toString("latin1"), query: u.search }); if (process.env.FAKE_QODER_UPLOAD_FAIL) return J(500, { message: "oss down" }); return J(200, { result: { imageUrls: [`https://oss.example/img-${seen.filter((x) => x.kind === "upload").length}.png`] } }); }
    if (u.pathname === "/api/v1/jobToken/exchange") { const j = JSON.parse(body.toString()); seen.push({ kind: "pat", token: j.personal_token }); return J(200, { token: "jt-job1", expires_in: 3600000 }); }
    if (u.pathname === "/api/v1/userinfo") return J(200, { id: "user-from-info", email: "me@example.com", name: "Me" });
    if (u.pathname === "/api/v1/deviceToken/poll") { pollCount++; if (pollCount < 2) { res.writeHead(202); return res.end(); } return J(200, { token: "dt-device1", refresh_token: "drt-1", user_id: "user-dev", expires_in: 2592000 }); }
    if (u.pathname === "/api/v2/quota/usage") return J(200, { userQuota: { total: 100, used: 40, remaining: 60, unit: "credits" }, totalUsagePercentage: 40, isQuotaExceeded: false });
    res.writeHead(404); res.end();
  }); });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${fake.address().port}`;
  Object.assign(QODER, { chatBase: base, chatBaseJob: base, devicePoll: `${base}/api/v1/deviceToken/poll`, userInfo: `${base}/api/v1/userinfo`, patExchange: `${base}/api/v1/jobToken/exchange`, quota: `${base}/api/v2/quota/usage` });
  dataDir = mkdtempSync(join(tmpdir(), "filament-qoder-"));
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  cfg.upstreams = [
    { id: "qc", name: "Qoder cloud", type: "qoder", apiKey: "", qoder: { authMethod: "device", accessToken: "dt-existing", userId: "u1", machineId: "m1", email: "me@x", expiresAt: Date.now() + 86400000 } },
    { id: "qpat", name: "Qoder via PAT", type: "qoder", apiKey: "pt-secret" },
    { id: "qnew", name: "Qoder not logged in", type: "qoder", apiKey: "" },
  ];
  cfg.routes = [{ match: "qd/*", upstream: "qc", upstreamModel: "{1}" }, { match: "qpat/*", upstream: "qpat", upstreamModel: "{1}" }, { match: "qnew/*", upstream: "qnew", upstreamModel: "{1}" }];
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } }); port = (await app.start()).port;
});
after(async () => { await app.stop(); fake.close(); rmSync(dataDir, { recursive: true, force: true }); });
const H = { "content-type": "application/json", authorization: "Bearer k" };

test("Anthropic-format request to a Qoder model is translated, signed, obfuscated and streamed back as Anthropic SSE", async () => {
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "qd/lite", max_tokens: 100, stream: true, system: "be nice", messages: [{ role: "user", content: "hi" }] }) });
  assert.equal(r.status, 200); const text = await r.text();
  assert.ok(text.includes('"text_delta","text":"hello "') && text.includes("from qoder") && text.includes("message_stop"), text);
  const chat = seen.find((s) => s.kind === "chat"); assert.ok(chat);
  assert.equal(chat.headers["x-model-key"], "lite"); assert.equal(chat.headers["cosy-user"], "u1"); assert.ok(chat.headers.authorization.startsWith("Bearer COSY.")); assert.ok(chat.query.includes("Encode=1"));
  assert.throws(() => JSON.parse(chat.body), "body must be obfuscated, not plain JSON");
  const rec = app.usage.list(1)[0]; assert.equal(rec.status, "ok"); assert.equal(rec.tokens.output, 3); assert.equal(rec.translatedFormats, "anthropic -> openai");
  // The Qoder model list is served from disk (the owner's rule): the dashboard's Refresh is what asks the account.
  await fetch(`http://127.0.0.1:${port}/api/models?refresh=1`, { headers: { "x-filament-ui": "1" } });
  const m = await (await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: H })).json(); assert.ok(m.data.some((x) => x.id === "qd/lite")); assert.ok(!m.data.some((x) => x.id === "qd/hidden"));
});

test("images pasted by an Anthropic-format client are uploaded to Qoder and referenced by URL; on upload failure small ones go inline", async () => {
  let mark = seen.length; const since = () => seen.slice(mark);
  const png = Buffer.from("fake-png-bytes-1234567890").toString("base64");
  const send = () => fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "qd/lite", max_tokens: 100, messages: [{ role: "user", content: [{ type: "text", text: "what is this?" }, { type: "image", source: { type: "base64", media_type: "image/png", data: png } }, { type: "document", title: "notes.txt", source: { type: "text", media_type: "text/plain", data: "alpha beta" } }] }] }) });
  let r = await send(); assert.equal(r.status, 200); await r.text();
  const up = since().find((x) => x.kind === "upload"); assert.ok(up, "an upload happened"); assert.equal(up.method, "PUT"); assert.ok(up.query.startsWith("?request_id=")); assert.ok(up.headers["content-type"].startsWith("multipart/form-data; boundary=")); assert.ok(up.body.includes('filename="image.png"') && up.body.includes("fake-png-bytes-1234567890")); assert.ok(up.headers.authorization.startsWith("Bearer COSY.")); assert.equal(up.headers["cosy-user"], "u1");
  let chat = since().filter((x) => x.kind === "chat").at(-1); const payload = JSON.parse(deobfuscate(chat.body));
  const userMsg = payload.messages.find((m) => m.role === "user"); assert.ok(Array.isArray(userMsg.content)); assert.ok(userMsg.content.some((p) => p.type === "image_url" && p.image_url.url === "https://oss.example/img-1.png"), JSON.stringify(userMsg.content)); assert.ok(userMsg.content.some((p) => p.type === "text" && p.text.includes("Attached file: notes.txt") && p.text.includes("alpha beta")));
  let rec = app.usage.list(1)[0]; assert.ok(rec.changes.some((c) => /1 image\(s\) uploaded/.test(c)), rec.changes.join("; "));
  // same image again: served from the upload cache, no second upload
  mark = seen.length; r = await send(); await r.text(); assert.ok(!since().some((x) => x.kind === "upload")); assert.ok(app.usage.list(1)[0].changes.some((c) => /reused from an earlier upload/.test(c)));
  // upload failure: a small image is kept inline as a data URI
  process.env.FAKE_QODER_UPLOAD_FAIL = "1"; mark = seen.length;
  try {
    const png2 = Buffer.from("other-bytes-" + Date.now()).toString("base64");
    r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "qd/lite", messages: [{ role: "user", content: [{ type: "text", text: "and this?" }, { type: "image_url", image_url: { url: `data:image/png;base64,${png2}` } }] }] }) });
    assert.equal(r.status, 200); await r.text();
    chat = since().filter((x) => x.kind === "chat").at(-1); const p2 = JSON.parse(deobfuscate(chat.body)); const um = p2.messages.find((m) => m.role === "user");
    assert.ok(um.content.some((p) => p.type === "image_url" && p.image_url.url.startsWith("data:image/png;base64,")), "kept inline"); assert.ok(app.usage.list(1)[0].changes.some((c) => /sent inline \(upload failed\)/.test(c)));
  } finally { delete process.env.FAKE_QODER_UPLOAD_FAIL; }
});

test("a personal token is exchanged for a job token and the job endpoint is used", async () => {
  const j = await (await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "qpat/lite", messages: [{ role: "user", content: "hi" }] }) })).json();
  assert.equal(j.choices[0].message.content, "hello from qoder");
  assert.ok(seen.some((s) => s.kind === "pat" && s.token === "pt-secret"));
  const chat = seen.filter((s) => s.kind === "chat").at(-1); assert.equal(chat.headers["cosy-user"], "user-from-info");
});

test("billing blocks surface as an error, and a not-logged-in upstream fails with a clear message", async () => {
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "qd/broke", stream: true, messages: [{ role: "user", content: "hi" }] }) });
  const text = await r.text(); assert.ok(text.includes("billing/quota") && text.includes("insufficient_quota"), text);
  const rec = app.usage.list(1)[0]; assert.equal(rec.status, "error");
  const r2 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "qnew/lite", messages: [{ role: "user", content: "hi" }] }) });
  assert.equal(r2.status, 502); const j2 = await r2.json(); assert.ok(j2.error.message.includes("not logged in"), j2.error.message);
});

test("device login: start returns the browser URL, poll waits then stores the account on the upstream", async () => {
  const st = await (await fetch(`http://127.0.0.1:${port}/api/qoder/qnew/login/start`, { method: "POST" })).json();
  assert.ok(st.url.startsWith(QODER.loginUrl) && st.nonce && st.userCode.length === 8);
  const p1 = await (await fetch(`http://127.0.0.1:${port}/api/qoder/qnew/login/poll`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nonce: st.nonce }) })).json();
  assert.equal(p1.status, "pending");
  const p2 = await (await fetch(`http://127.0.0.1:${port}/api/qoder/qnew/login/poll`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nonce: st.nonce }) })).json();
  assert.equal(p2.status, "ok"); assert.equal(p2.email, "me@example.com");
  assert.ok(JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")).upstreams.find((u) => u.id === "qnew").qoder.accessToken.startsWith("enc:v1:"), "token encrypted at rest");
  const saved = loadConfig(dataDir).config.upstreams.find((u) => u.id === "qnew");
  assert.equal(saved.qoder.accessToken, "dt-device1"); assert.equal(saved.qoder.userId, "user-dev"); assert.ok(typeof saved.qoder.machineId === "string" && saved.qoder.machineId.length >= 8, "the machine id used during login is kept for request signing");
  const status = await (await fetch(`http://127.0.0.1:${port}/api/qoder/qnew/status?quota=1`)).json();
  assert.equal(status.loggedIn, true); assert.equal(status.method, "device"); assert.equal(status.quota.user.used, 40);
  const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  assert.equal(state.config.upstreams.find((u) => u.id === "qnew").qoder.accessToken, "__SECRET__", "tokens are masked in the API");
  const j = await (await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "qnew/lite", messages: [{ role: "user", content: "hi" }] }) })).json();
  assert.equal(j.choices[0].message.content, "hello from qoder");
  const t = await (await fetch(`http://127.0.0.1:${port}/api/upstreams/qnew/test`)).json(); assert.equal(t.ok, true); assert.equal(t.models, 1); assert.equal(t.account, "me@example.com");
});

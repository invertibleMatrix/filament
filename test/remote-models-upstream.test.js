// @ts-check
// Another paired machine as an upstream (the remote-agents plan's m-upstream): `here` keeps an agents' device for
// `there` (minted by here's full device, its grant `models` switched on by there's own computer, kept sealed in here's
// remotes.json as the desktop app keeps it), and adds there as an upstream of type `filament` — POST /api/upstreams
// {type:"filament", machine}. There's models that answer by an API then show in here's lists under the machine's name,
// its coding agents never; here's calls go to there's /v1 (m-door) in their client's own wire, over https pinned to its
// certificate, the device's token their one credential — none of the address, the pin or the token in here's
// config.json. A machine whose grant is off, whose device is revoked, or that does not answer is offline: its models say
// so, and a call fails over to here's own model at once. Two real Filaments (helpers/two-machines.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pairMachines, startTwoMachines } from "./helpers/two-machines.js";
import { removeDirs } from "./helpers/wait.js";
import { anthropicReply, anthropicStream, fakeUpstream } from "./helpers/app.js";
import { createMachines } from "../src/services/machines/index.js";
import { pinnedFetch } from "../src/services/machines/pinned.js";
import { lanIdentity } from "../src/services/lan-tls.js";
import { houseAuth } from "../src/services/house.js";
import { AGENTS_CHAT_HEADER, lendModels } from "../src/services/devices.js";
import { normalizeConfig, validateConfig } from "../src/services/config/store.js";
import { CONNECT_MS, filamentDestination, forgetOffline, offlineWords } from "../src/adapters/providers/filament.js";
import { LENT_IN_FLIGHT } from "../src/http/front-door.js";
import { dispatch } from "../src/app/pipeline/stages/dispatch.js";
import { route as routeStage } from "../src/app/pipeline/stages/route.js";
import { lentModels } from "../src/app/models.js";
import { modelsThatAnswer } from "../src/app/readiness.js";

const JSON_TYPE = { "content-type": "application/json" };
/** A message, as the Anthropic SDK sends one. @param {string} model @param {string} text */
const message = (model, text, stream = false) => ({ model, max_tokens: 64, stream, messages: [{ role: "user", content: text }] });
/** A message's words. @param {any} j */
const wordsOf = (j) => (Array.isArray(j?.content) ? j.content.map((/** @type {any} */ b) => b?.text ?? "").join("") : "");

/**
 * Two machines: `there` serving an Anthropic model (`m-1`), an OpenAI one (`gpt-1`), a Claude model's name (`claude-test-1`,
 * which reads PDFs) and a coding agent (`cc-sonnet`); `here` with a model of its own (`mine-1`) on a provider of its own,
 * which answers in its own words. Here's agents' device minted on there and kept here; its grant `models` on unless
 * `granted` is false.
 * `script`: there's provider's, fakeUpstream's.
 * @param {{ granted?: boolean, script?: Parameters<typeof fakeUpstream>[0] }} [o]
 */
async function lending({ granted = true, script } = {}) {
  const up = await fakeUpstream(script);
  const mine = await fakeUpstream((call) => (call.kind === "anthropic" ? (call.body?.stream ? anthropicStream("HERE'S ANSWER") : anthropicReply("HERE'S ANSWER")) : undefined));
  /** @type {Awaited<ReturnType<typeof startTwoMachines>> | null} */
  let two = null;
  try {
    two = await startTwoMachines({
      here: {
        configure: (cfg) => {
          cfg.upstreams = [{ id: "local", name: "local", type: "anthropic", baseUrl: mine.url, apiKey: "s", enabled: true, discoverModels: false }];
          cfg.routes = [{ match: "mine-1", upstream: "local", upstreamModel: "mine-1", enabled: true }];
        },
      },
      there: {
        configure: (cfg) => {
          cfg.upstreams = [
            { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, discoverModels: false },
            { id: "o", name: "o", type: "openai", baseUrl: `${up.url}/v1`, apiKey: "s", enabled: true, discoverModels: false },
            { id: "cc", name: "cc", type: "acp", enabled: true, models: ["cc-sonnet"], discoverModels: false, acp: { command: "no-such-agent", args: [] } },
          ];
          cfg.routes = [
            { match: "m-1", upstream: "m", upstreamModel: "m-1", enabled: true },
            { match: "gpt-1", upstream: "o", upstreamModel: "gpt-1", enabled: true },
            { match: "claude-test-1", upstream: "m", upstreamModel: "claude-test-1", enabled: true },
            { match: "cc-sonnet", upstream: "cc", upstreamModel: "sonnet", enabled: true },
          ];
        },
      },
    });
    const t = two;
    const minted = await t.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: "{}" });
    assert.equal(minted.status, 200, await minted.clone().text());
    const agents = await minted.json();
    const id = encodeURIComponent(agents.device.id);
    /** There's own computer switches the device's grant `models`. @param {boolean} on */
    const grant = async (on) => assert.equal((await t.there.api(`/api/remote/devices/${id}`, { method: "PATCH", body: { grants: { models: on } } })).status, 200);
    if (granted) await grant(true);
    /** The agents' device kept here, as the desktop app keeps it. */
    const keep = () => createMachines({ dataDir: t.here.dataDir }).keep({ url: t.remote.url, fingerprint: t.remote.fingerprint, machine: t.remote.machine, device: agents.device, token: agents.token });
    /** Here's models, asked anew. */
    const models = async () => (await (await t.here.api("/api/models?refresh=1")).json());
    /**
     * A route of here's, put on top of its routes, with failover on: off by default, and these routes' backups are what
     * a sleeping machine's call goes on to. @param {any} route
     */
    const route = async (route) => {
      const cfg = (await (await t.here.api("/api/state")).json()).config;
      const rules = { ...cfg.rules, resilience: { ...cfg.rules?.resilience, failover: true } };
      const put = await t.here.api("/api/config", { method: "PUT", body: { ...cfg, rules, routes: [route, ...cfg.routes] } });
      assert.equal(put.status, 200, await put.clone().text());
    };
    return {
      ...t,
      up,
      mine,
      agents,
      grant,
      keep,
      models,
      route,
      revoke: async () => assert.equal((await t.there.api(`/api/remote/devices/${id}`, { method: "DELETE" })).status, 200),
      async stop() {
        await t.stop();
        await up.close();
        await mine.close();
      },
    };
  } catch (e) {
    await two?.stop();
    await up.close();
    await mine.close();
    throw e;
  }
}

/** What here's config.json says, whole. @param {string} dataDir */
const configText = (dataDir) => readFileSync(join(dataDir, "config.json"), "utf8");

// (fails before: yes — the hunt on s4c: a pinned machine's wire was never asked, and its token went to a Filament this
// one speaks nothing with)
test("a pinned machine on a wire this Filament does not speak is sent no token, its refusal saying which side to update; on this wire, its wire is asked once a minute, not at each call", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "filament-wire-here-"));
  const certDir = mkdtempSync(join(tmpdir(), "filament-wire-there-"));
  const id = lanIdentity(certDir, { name: "Studio" });
  const STUDIO = "22222222-2222-4222-8222-222222222222";
  /** @type {any} */
  let said = { id: STUDIO, name: "Studio", version: "9.0.0", protocol: 9, protocolLowest: 9 };
  /** @type {string[]} */
  const heard = [];
  const server = https.createServer({ key: id.key, cert: id.cert }, (req, res) => {
    heard.push(`${req.method} ${req.url}${req.headers.authorization ? " with a token" : ""}`);
    res.writeHead(200, JSON_TYPE);
    res.end(JSON.stringify(said));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  try {
    const url = `https://127.0.0.1:${/** @type {net.AddressInfo} */ (server.address()).port}`;
    const machines = createMachines({ dataDir });
    machines.keep({ url, fingerprint: id.fingerprint, machine: { id: STUDIO, name: "Studio" }, device: { id: "d-studio", name: "Filament agents", scope: "agent" }, token: "fdt_studio" });
    await assert.rejects(machines.modelsWay("Studio", { agents: true }), (/** @type {any} */ e) => {
      assert.equal(e.message, "Studio runs Filament 9.0.0, too new for this Filament: update this Filament. Here: filament update, or the Filament app's Check for updates. Nothing was sent.");
      return true;
    });
    assert.deepEqual(heard, ["GET /.well-known/filament"], "its token never went");
    said = { id: STUDIO, name: "Studio", version: "0.9.0", protocol: 1, protocolLowest: 1 };
    heard.length = 0;
    const way = await machines.modelsWay("Studio", { agents: true });
    assert.deepEqual([way.url, way.headers.authorization], [url, "Bearer fdt_studio"]);
    await machines.modelsWay("Studio", { agents: true });
    assert.deepEqual(heard, ["GET /.well-known/filament"], "asked once: its pass is kept");
  } finally {
    await new Promise((r) => server.close(() => r(undefined)));
    await removeDirs(dataDir, certDir);
  }
});

// (fails before: yes — the add was refused, 400 "A provider here is openai-compatible, anthropic-compatible, openai,
// anthropic…": `filament` was no upstream type, and config.json had no field to name a machine)
test("adding a machine's models: refused where it is kept for the person alone, or not at all; added where it is kept for the agents — its name the machine's, its prefix route, and neither its address, its certificate nor its token in config.json", async () => {
  const s = await lending();
  try {
    const add = (/** @type {any} */ body) => s.here.api("/api/upstreams", { method: "POST", body });
    const persons = await add({ type: "filament", machine: s.there.machine.id });
    assert.equal(persons.status, 400);
    assert.match((await persons.json()).error, /Workstation is paired with this machine for you, not for its agents/);
    const none = await add({ type: "filament", machine: "Nowhere" });
    assert.equal(none.status, 400);
    assert.match((await none.json()).error, /No machine "Nowhere" is kept for this Filament's agents/);
    assert.equal((await add({ type: "filament" })).status, 400, "a machine is named");
    s.keep();
    const added = await add({ type: "filament", machine: "Workstation" });
    const out = await added.json();
    assert.equal(added.status, 200, JSON.stringify(out));
    assert.deepEqual([out.upstream.id, out.upstream.name, out.upstream.type, out.upstream.machine, out.upstream.prefix], ["workstation", "Workstation", "filament", s.there.machine.id, "workstation"]);
    assert.equal(out.upstream.billing, "plan", "its machine pays its provider");
    const again = await add({ type: "filament", machine: s.there.machine.id });
    assert.equal(again.status, 409);
    assert.match((await again.json()).error, /Workstation's models are offered already, by Workstation/);
    // Its address, certificate and key are its machine's: a change here takes none of them.
    const changed = await s.here.api("/api/upstreams/workstation", { method: "PATCH", body: { baseUrl: "https://elsewhere.example" } });
    assert.equal(changed.status, 400);
    assert.match((await changed.json()).error, /Workstation is another machine's models: its baseUrl is that machine's/);
    const text = configText(s.here.dataDir);
    assert.match(text, new RegExp(s.there.machine.id), "the machine named by its id");
    for (const secret of [s.agents.token, "fdt_", s.remote.url, s.remote.fingerprint || "no fingerprint"]) assert.ok(!text.includes(secret), `config.json holds no ${secret.slice(0, 16)}…`);
  } finally {
    await s.stop();
  }
});

// (fails before: yes — the add was refused (400), so here listed nothing of there's and no route reached it)
test("there's API models that answer show under the machine's name, its coding agents never; a message on here answers from there, streamed and not, in its client's own wire, by the device's token alone", async () => {
  const s = await lending();
  try {
    s.keep();
    assert.equal((await s.here.api("/api/upstreams", { method: "POST", body: { type: "filament", machine: "Workstation" } })).status, 200);
    const listed = await s.models();
    const theirs = listed.models.filter((/** @type {any} */ m) => m.upstream === "workstation").map((/** @type {any} */ m) => m.id).sort();
    assert.deepEqual(theirs, ["workstation/claude-test-1", "workstation/gpt-1", "workstation/m-1"], "there's API models that answer");
    assert.ok(listed.models.filter((/** @type {any} */ m) => m.upstream === "workstation").every((/** @type {any} */ m) => m.answers === true), "each answers");
    assert.equal(listed.upstreams.workstation.offline, undefined);
    const names = listed.models.map((/** @type {any} */ m) => m.id);
    for (const id of ["workstation/cc-sonnet", "workstation/sonnet", "cc-sonnet"]) assert.ok(!names.includes(id), `${id} is a coding agent there: ${names.join(", ")}`);
    const ups = (await (await s.here.api("/api/upstreams")).json()).upstreams;
    assert.equal(ups.find((/** @type {any} */ u) => u.id === "workstation")?.name, "Workstation", "their source is the machine's name");
    const v1 = (await (await s.here.api("/v1/models", { headers: { "anthropic-version": "2023-06-01" } })).json()).data.map((/** @type {any} */ m) => m.id);
    assert.ok(v1.includes("workstation/m-1") && !v1.some((/** @type {string} */ id) => /cc-sonnet|sonnet$/.test(id)), v1.join(", "));

    s.up.reset();
    const one = await s.here.post("/v1/messages", message("workstation/m-1", "Hello from the laptop."));
    const said = await one.json();
    assert.equal(one.status, 200, JSON.stringify(said));
    assert.equal(wordsOf(said), "MODEL ANSWER");
    const got = s.up.received.find((c) => c.kind === "anthropic");
    assert.equal(got?.body?.model, "m-1", "there's own model, by its own name");
    assert.match(JSON.stringify(got?.body?.messages), /Hello from the laptop\./);
    const streamed = await s.here.post("/v1/messages", message("workstation/m-1", "Stream it.", true));
    assert.equal(streamed.status, 200);
    const events = await streamed.text();
    for (const e of [/event: message_start/, /"text":"MODEL "/, /"text":"ANSWER"/, /event: message_stop/]) assert.match(events, e);
    // The OpenAI wire goes as it came: there's OpenAI model is sent a chat completion, and its Anthropic one is
    // translated there, once.
    s.up.reset();
    const chat = await s.here.post("/v1/chat/completions", { model: "workstation/gpt-1", messages: [{ role: "user", content: "hi" }] });
    assert.equal(chat.status, 200, await chat.clone().text());
    assert.equal((await chat.json()).choices?.[0]?.message?.content, "MODEL ANSWER");
    const across = await s.here.post("/v1/chat/completions", { model: "workstation/m-1", messages: [{ role: "user", content: "hi again" }] });
    assert.equal(across.status, 200, await across.clone().text());
    assert.deepEqual(s.up.received.map((c) => c.kind), ["openai", "anthropic"]);
    const ownRecs = await s.here.records(20);
    const sent = await s.here.record(ownRecs.find((/** @type {any} */ r) => r.model === "workstation/m-1" && r.format === "openai")?.id ?? ownRecs[0].id);
    assert.equal(sent.url, `${s.remote.url}/v1/chat/completions`, "here sent its client's own wire");
    // There took each call as the agents' device's: the token let it in — never here's inbound key or the house key,
    // which there's door refuses over the network (remote-models-door.test.js), the same house key as here's in this
    // process. Nothing of either rode to there's provider.
    const theirRecs = (await (await s.there.api("/api/requests?limit=40")).json()).requests;
    const full = await Promise.all(theirRecs.map(async (/** @type {any} */ r) => (await s.there.api(`/api/requests/${r.id}`)).json()));
    assert.ok(full.length >= 4 && full.every((r) => r.device?.name === "Filament agents on Laptop"), JSON.stringify(full.map((r) => r.device)));
    for (const c of s.up.received) {
      const h = JSON.stringify(c.headers);
      for (const k of [s.agents.token, s.here.key, houseAuth()["x-api-key"]]) assert.ok(!h.includes(k), "none of here's credentials reaches there's provider");
    }
  } finally {
    await s.stop();
  }
});

// (fails before: yes — the add was refused (400); and with the door's marked refusal unread (filament.js `doorRefused`),
// the call failed over on a bare 403 whose words named no machine, and nothing said the machine offline)
test("there's grant off, or here's device revoked: here says the machine offline, and a call fails over to here's own model at once; a direct call says why in there's words; the grant on again, it answers again", async () => {
  const s = await lending();
  try {
    s.keep();
    assert.equal((await s.here.api("/api/upstreams", { method: "POST", body: { type: "filament", machine: "Workstation" } })).status, 200);
    await s.route({ match: "team-1", upstream: "workstation", upstreamModel: "m-1", fallbacks: [{ upstream: "local", upstreamModel: "mine-1" }], enabled: true });
    const first = await s.here.post("/v1/messages", message("team-1", "Whose answer?"));
    assert.equal(wordsOf(await first.json()), "MODEL ANSWER", "there's, while its grant is on");

    await s.grant(false);
    let t0 = Date.now();
    const over = await s.here.post("/v1/messages", message("team-1", "Whose answer now?"));
    const overSaid = await over.json();
    assert.equal(over.status, 200, JSON.stringify(overSaid));
    assert.equal(wordsOf(overSaid), "HERE'S ANSWER", "here's own model answered");
    assert.ok(Date.now() - t0 < CONNECT_MS, `failed over in ${Date.now() - t0} ms, no wait`);
    const rec = await s.here.record(over.headers.get("x-filament-request-id") || "");
    assert.equal(rec.failover?.servedBy, "local");
    assert.match(JSON.stringify(rec.failover?.trail), /Workstation said: Filament agents on Laptop may not use this machine's models/);
    const off = await s.models();
    assert.match(String(off.upstreams.workstation.offline), /^Workstation said: Filament agents on Laptop may not use this machine's models/);
    assert.equal(off.models.find((/** @type {any} */ m) => m.id === "workstation/m-1")?.answers, false, "its models say so");
    // Remembered: the next call goes to here's own model first, and never asks there.
    const recsBefore = (await (await s.there.api("/api/requests?limit=40")).json()).requests.length;
    assert.equal(wordsOf(await (await s.here.post("/v1/messages", message("team-1", "And now?"))).json()), "HERE'S ANSWER");
    const parked = await s.here.record((await s.here.records(1))[0].id);
    assert.equal(parked.upstream, "local");
    assert.equal(parked.failover, undefined, "parked last, never tried first");
    assert.equal((await (await s.there.api("/api/requests?limit=40")).json()).requests.length, recsBefore);
    const direct = await s.here.post("/v1/messages", message("workstation/m-1", "Directly?"));
    assert.equal(direct.status, 502);
    assert.match((await direct.json()).error.message, /Workstation said: Filament agents on Laptop may not use this machine's models: its grant is switched on in Settings › Remote access/);

    // On again: the next call there answers, and the machine is offline no more.
    await s.grant(true);
    const back = await s.here.post("/v1/messages", message("workstation/m-1", "Back?"));
    assert.equal(back.status, 200, await back.clone().text());
    assert.equal((await s.models()).upstreams.workstation.offline, undefined);

    // Revoked: the same, in there's words.
    await s.revoke();
    t0 = Date.now();
    const gone = await s.here.post("/v1/messages", message("team-1", "Still there?"));
    assert.equal(wordsOf(await gone.json()), "HERE'S ANSWER");
    assert.ok(Date.now() - t0 < CONNECT_MS, `failed over in ${Date.now() - t0} ms`);
    assert.match(String((await s.models()).upstreams.workstation.offline), /^Workstation said: this device's token is not one this Filament knows: it was revoked, or replaced/);
    // The house key — one per process, here's and there's alike in this test — lets none of here's own calls through.
    const own = await s.here.house("/v1/messages", message("workstation/m-1", "As Filament's own?"));
    assert.equal(own.status, 502);
    assert.match((await own.json()).error.message, /Workstation said: this device's token is not one this Filament knows/);
    const text = configText(s.here.dataDir);
    assert.ok(!text.includes(s.agents.token) && !text.includes("fdt_"), "the token is never in here's config.json");
  } finally {
    await s.stop();
  }
});

// (fails before: yes — the add was refused (400); and with no connect time (pinned.js `connectMs`), the call to a port
// that never speaks TLS was still waiting when the test timed out at 40 s)
test("a machine that does not answer: its connection gives up within the connect time, the call fails over, and the next skips it", async () => {
  const s = await lending();
  // An address that takes the connection and never says a word of TLS, as a machine gone to sleep behind a router does.
  /** @type {Set<net.Socket>} */
  const held = new Set();
  const mute = net.createServer((c) => void held.add(c));
  await new Promise((r) => mute.listen(0, "127.0.0.1", () => r(undefined)));
  try {
    const port = /** @type {net.AddressInfo} */ (mute.address()).port;
    createMachines({ dataDir: s.here.dataDir }).keep({ url: `https://127.0.0.1:${port}`, fingerprint: s.remote.fingerprint, machine: { id: "11111111-1111-4111-8111-111111111111", name: "Asleep" }, device: { id: "d-asleep", name: "Filament agents", scope: "agent" }, token: "fdt_asleep" });
    const added = await s.here.api("/api/upstreams", { method: "POST", body: { type: "filament", machine: "Asleep" } });
    assert.equal(added.status, 200, await added.clone().text());
    await s.route({ match: "team-2", upstream: "asleep", upstreamModel: "m-1", fallbacks: [{ upstream: "local", upstreamModel: "mine-1" }], enabled: true });
    let t0 = Date.now();
    const r = await s.here.post("/v1/messages", message("team-2", "Anyone?"));
    const took = Date.now() - t0;
    assert.equal(wordsOf(await r.json()), "HERE'S ANSWER");
    assert.ok(took >= CONNECT_MS - 200 && took < CONNECT_MS + 3000, `gave up in ${took} ms`);
    assert.match(String((await (await s.here.api("/api/models")).json()).upstreams.asleep.offline), /^Asleep did not answer: ETIMEDOUT/);
    t0 = Date.now();
    assert.equal(wordsOf(await (await s.here.post("/v1/messages", message("team-2", "Anyone now?"))).json()), "HERE'S ANSWER");
    assert.ok(Date.now() - t0 < 1500, `the next skipped it: ${Date.now() - t0} ms`);
  } finally {
    for (const c of held) c.destroy();
    await new Promise((r) => mute.close(() => r(undefined)));
    await s.stop();
  }
});

// (fails before: yes — the add was refused (400); and with attempt.js's hunk off, here read the PDF with its own
// pdftotext for a model it took for no Claude model, and there answered 200)
test("a PDF goes there as it came — there's model that reads none refuses it in words, a Claude model reads it —, and what here's provider keeps is never sent there", async () => {
  const s = await lending();
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n").toString("base64");
  /** @param {string} model */
  const withPdf = (model) => ({ model, max_tokens: 64, messages: [{ role: "user", content: [{ type: "document", title: "plan.pdf", source: { type: "base64", media_type: "application/pdf", data: pdf } }, { type: "text", text: "Read it." }] }] });
  try {
    s.keep();
    assert.equal((await s.here.api("/api/upstreams", { method: "POST", body: { type: "filament", machine: "Workstation" } })).status, 200);
    s.up.reset();
    const refused = await s.here.post("/v1/messages", withPdf("workstation/m-1"));
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error.message, /m-1 at m reads no PDF, and this machine reads none for another machine's chat/);
    assert.equal(s.up.received.length, 0);
    const read = await s.here.post("/v1/messages", withPdf("workstation/claude-test-1"));
    assert.equal(read.status, 200, await read.clone().text());
    const sent = s.up.received.find((c) => c.kind === "anthropic")?.body;
    assert.equal(sent?.messages?.[0]?.content?.find((/** @type {any} */ b) => b.type === "document")?.source?.data, pdf, "the PDF as it came");
    s.up.reset();
    const kept = await s.here.post("/v1/messages", { ...message("workstation/m-1", "Run it."), container: "cntr_1" });
    assert.equal(kept.status, 400);
    assert.match((await kept.json()).error.message, /m-1 at workstation is another machine's, and the request names container, which this machine's provider keeps on this machine's account/);
    assert.equal(s.up.received.length, 0, "nothing went there");
  } finally {
    await s.stop();
  }
});

// (fails before: yes — an upstream of type `filament` answered nothing; with it answering and lentModels as it was, a
// model another machine lent here was lent on, its machine's grant going to a third)
test("another machine's models answer here, and are never lent on: the list another machine's chats are given leaves them out", () => {
  const cfg = {
    upstreams: [
      { id: "m", type: "anthropic", apiKey: "s", enabled: true },
      { id: "workstation", type: "filament", machine: "11111111-1111-4111-8111-111111111111", enabled: true },
    ],
    routes: [],
    pricing: {},
  };
  const catalogue = [
    { id: "m-1", upstream: "m", source: "route" },
    { id: "workstation/m-1", upstream: "workstation", source: "discovered" },
  ];
  assert.deepEqual(modelsThatAnswer(cfg, catalogue).map((m) => m.id), ["m-1", "workstation/m-1"], "here's chats run on it");
  assert.deepEqual(lentModels(cfg, catalogue).map((m) => m.id), ["m-1"]);
});

/** Here offers there's models: POST /api/upstreams {type:"filament", machine}. @param {Awaited<ReturnType<typeof lending>>} s */
async function offer(s) {
  const added = await s.here.api("/api/upstreams", { method: "POST", body: { type: "filament", machine: "Workstation" } });
  assert.equal(added.status, 200, await added.clone().text());
}

// (fails before: yes — there passed its provider's `x-filament: 1` on with the 404, and here took it for there's door
// refusing the device: 502 "Workstation said: …" for the provider's 404, and Workstation said offline)
test("a provider's x-filament header on there is never there's door's: here's call fails as there's provider said, the machine stays online, and its other models answer", async () => {
  const s = await lending({
    script: (call) =>
      call.body?.model === "fx-1" ? { status: 404, headers: { "x-filament": "1" }, json: { type: "error", error: { type: "not_found_error", message: "no model fx-1 here" } } } : undefined,
  });
  try {
    const cfg = (await (await s.there.api("/api/state")).json()).config;
    const put = await s.there.api("/api/config", { method: "PUT", body: { ...cfg, routes: [{ match: "fx-1", upstream: "m", upstreamModel: "fx-1", enabled: true }, ...cfg.routes] } });
    assert.equal(put.status, 200, await put.clone().text());
    s.keep();
    await offer(s);
    const missing = await s.here.post("/v1/messages", message("workstation/fx-1", "Anyone?"));
    assert.equal(missing.status, 404, "there's provider's answer, as it came");
    assert.equal(missing.headers.get("x-filament"), null, "no mark reaches here's client either");
    assert.match(await missing.text(), /no model fx-1 here/);
    // Read before a listing could find it answering, which would clear it.
    assert.equal(offlineWords("workstation"), null);
    const listed = await s.models();
    assert.equal(listed.upstreams.workstation.offline, undefined);
    assert.equal(listed.models.find((/** @type {any} */ m) => m.id === "workstation/m-1")?.answers, true);
    const other = await s.here.post("/v1/messages", message("workstation/m-1", "And you?"));
    assert.equal(wordsOf(await other.json()), "MODEL ANSWER");
  } finally {
    await s.stop();
  }
});

// (fails before: yes — validateConfig took each of them, with no error)
test("another machine's upstream takes no address, key, headers, models path or auth style of its own: the configuration says so in words", () => {
  const machine = { id: "workstation", name: "Workstation", type: "filament", machine: "11111111-1111-4111-8111-111111111111", enabled: true };
  /** @param {any} u */
  const errorsOf = (u) => validateConfig(normalizeConfig({ upstreams: [u] })).errors;
  assert.deepEqual(errorsOf(machine), []);
  for (const [field, value] of /** @type {[string, any][]} */ ([["baseUrl", "https://elsewhere.example"], ["apiKey", "sk-mine"], ["headers", { "x-api-key": "sk-mine" }], ["modelsPath", "/api/config"], ["authStyle", "bearer"]])) {
    const errors = errorsOf({ ...machine, [field]: value });
    assert.equal(errors.length, 1, `${field}: ${errors.join(" | ")}`);
    assert.match(errors[0], new RegExp(`\\(workstation\\) is another machine's models, which takes no ${field}: its address, certificate and token are kept in Settings › Remote access, and its path and headers are the wire's own`));
  }
});

/**
 * A machine's /v1 as a plain server on loopback, and an upstream reaching it unpinned, as a tailnet's address is:
 * `answer` writes its reply; `deps`, the destination's own beside its machines and turns. → what it was sent, its
 * address, and the destination.
 * @param {(req: http.IncomingMessage, res: http.ServerResponse) => void} answer @param {string} id
 * @param {{ listingMs?: number, listingWaitMs?: number }} [deps]
 */
async function plainMachine(answer, id, deps = {}) {
  /** @type {{ path: string, headers: http.IncomingHttpHeaders }[]} */
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ path: req.url || "", headers: req.headers });
    req.resume();
    req.on("end", () => answer(req, res));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  const url = `http://127.0.0.1:${/** @type {net.AddressInfo} */ (server.address()).port}`;
  const machines = { modelsWay: async () => ({ url, fetch: null, headers: { authorization: "Bearer fdt_unit" } }) };
  const d = filamentDestination({ id, name: "Unit", type: "filament", machine: `${id}-machine` }, { machines, inFlight: LENT_IN_FLIGHT, ...deps });
  return { seen, url, d, close: () => new Promise((r) => server.close(() => r(undefined))) };
}

/** A call's open as attempt.js makes it, with what a rule or a client would add. @param {any} d @param {"anthropic" | "openai"} format */
const openFor = (d, format) =>
  d.answers.open({
    url: "filament://machine/api/config?steer=1",
    headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "anthropic-beta": "b-1", "user-agent": "sdk/1", "x-api-key": "sk-here", authorization: "Bearer inbound", "helicone-auth": "Bearer gw", cookie: "c=1", "x-filament-session": "s1" },
    bodyString: "{}",
    body: {},
    modelId: "m-1",
    format,
  });

// (fails before: yes — the call went to its url's own path and query, "/api/config?steer=1"; and with the headers
// filtered as before, a cookie and a gateway's key went with it)
test("a call there goes to its wire's one path, whatever its url says, with the wire's headers and the device's token alone", async () => {
  const m = await plainMachine((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  }, "unit-path");
  try {
    for (const [format, path] of /** @type {const} */ ([["anthropic", "/v1/messages"], ["openai", "/v1/chat/completions"]])) {
      const opened = await openFor(m.d, format);
      assert.equal(opened.res.status, 200);
      await opened.res.text();
      opened.cleanup();
      assert.equal(opened.url, `${m.url}${path}`);
    }
    assert.deepEqual(m.seen.map((c) => c.path), ["/v1/messages", "/v1/chat/completions"]);
    const sent = m.seen[0].headers;
    assert.deepEqual(
      Object.keys(sent).filter((k) => !["host", "connection", "content-length", "accept-language", "sec-fetch-mode", "accept-encoding", "accept"].includes(k)).sort(),
      ["anthropic-beta", "anthropic-version", "authorization", "content-type", "user-agent"],
    );
    assert.equal(sent.authorization, "Bearer fdt_unit", "the device's token, never the inbound key");
  } finally {
    await m.close();
  }
});

// (fails before: yes — the fetch followed the 307, and the open answered with the address it named's 200)
test("a redirect from the machine is followed nowhere: the call fails, saying so, and the machine is offline", async () => {
  /** @type {string[]} */
  const elsewhere = [];
  const other = http.createServer((req, res) => {
    elsewhere.push(req.url || "");
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise((r) => other.listen(0, "127.0.0.1", () => r(undefined)));
  const target = `http://127.0.0.1:${/** @type {net.AddressInfo} */ (other.address()).port}/v1/messages`;
  const m = await plainMachine((_req, res) => {
    res.writeHead(307, { location: target });
    res.end();
  }, "unit-redirect");
  try {
    await assert.rejects(openFor(m.d, "anthropic"), (/** @type {any} */ e) => {
      assert.equal(e.message, `Unit answered with a redirect (HTTP 307 to ${target}): a call goes to the machine kept, never on elsewhere`);
      assert.equal(m.d.answers?.unreachable(e).retryable, true);
      return true;
    });
    assert.deepEqual(elsewhere, []);
    assert.match(String(offlineWords("unit-redirect")), /^Unit answered with a redirect/);
  } finally {
    await m.close();
    await new Promise((r) => other.close(() => r(undefined)));
  }
});

// (fails before: yes — with no turns kept here, the five went at once, there's door refused the fifth 429 with its
// mark, and here answered it 502)
test("five calls at once to two models of one machine: there sees no more than its door lets one device have, each answers, and no model learns a ceiling", async () => {
  let active = 0;
  let most = 0;
  const s = await lending({
    script: async (call) => {
      if (call.kind === "models") return undefined;
      most = Math.max(most, ++active);
      await new Promise((r) => setTimeout(r, 400));
      active--;
      return undefined;
    },
  });
  try {
    s.keep();
    await offer(s);
    await s.models();
    const said = await Promise.all(["workstation/m-1", "workstation/gpt-1", "workstation/m-1", "workstation/gpt-1", "workstation/m-1"].map((model, i) => s.here.post("/v1/messages", message(model, `Call ${i}`))));
    for (const r of said) assert.equal(r.status, 200, await r.clone().text());
    assert.ok(most <= LENT_IN_FLIGHT, `there had ${most} in flight`);
    const health = (await (await s.here.api("/api/usage/upstreams")).json()).health;
    assert.deepEqual(health.workstation?.ceilings ?? [], []);
  } finally {
    await s.stop();
  }
});

// (fails before: yes — the door's marked 429 went through here's verdict as m-1's own refusal, said to here's client in
// the door's words alone, never as Workstation busy)
test("there's door saying the device has its calls in flight already is busy: the call fails in its words, nothing learns a ceiling, the machine stays online", async () => {
  /** @type {() => void} */
  let release = () => {};
  const gate = new Promise((r) => (release = () => r(undefined)));
  /** @type {() => void} */
  let allIn = () => {};
  const arrived = new Promise((r) => (allIn = () => r(undefined)));
  let holding = 0;
  const s = await lending({
    script: async (call) => {
      if (!JSON.stringify(call.body?.messages || "").includes("Hold it")) return undefined;
      if (++holding === LENT_IN_FLIGHT) allIn();
      await gate;
      return undefined;
    },
  });
  try {
    s.keep();
    await offer(s);
    await s.models();
    // The same device's calls from elsewhere — another process of this machine's — take all of there's turns.
    const pinned = pinnedFetch(s.remote.fingerprint || "");
    const held = Array.from({ length: LENT_IN_FLIGHT }, () =>
      pinned(`${s.remote.url}/v1/messages`, { method: "POST", headers: { authorization: `Bearer ${s.agents.token}`, "content-type": "application/json", "anthropic-version": "2023-06-01" }, body: JSON.stringify(message("m-1", "Hold it")) }).then(
        (r) => r.status,
        (e) => String(e),
      ),
    );
    await arrived;
    const busy = await s.here.post("/v1/messages", message("workstation/m-1", "My turn?"));
    assert.notEqual(busy.status, 200);
    assert.match((await busy.json()).error.message, /^Workstation is busy: Filament agents on Laptop has 4 calls in flight on this machine's models/);
    release();
    assert.deepEqual(await Promise.all(held), Array(LENT_IN_FLIGHT).fill(200));
    const health = (await (await s.here.api("/api/usage/upstreams")).json()).health;
    assert.deepEqual(health.workstation?.ceilings ?? [], []);
    assert.equal((await (await s.here.api("/api/models")).json()).upstreams.workstation.offline, undefined);
    assert.equal(wordsOf(await (await s.here.post("/v1/messages", message("workstation/m-1", "Now?"))).json()), "MODEL ANSWER");
  } finally {
    release();
    await s.stop();
  }
});

// (fails before: yes — s0b: a plain-http row on this computer was refused, so a machine reached by SSH alone lent
// nothing; and there's main listener answered a device's model call as this computer's own, its grant never read)
test("a machine kept at a plain-http address on this computer — an SSH tunnel — lends its models through the same door: its grant, a revoke", async () => {
  const s = await lending();
  try {
    createMachines({ dataDir: s.here.dataDir }).keep({ url: s.there.url, machine: s.remote.machine, device: s.agents.device, token: s.agents.token });
    await offer(s);
    s.up.reset();
    const r = await s.here.post("/v1/messages", message("workstation/m-1", "Through the tunnel?"));
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(wordsOf(await r.json()), "MODEL ANSWER");
    assert.equal(s.up.received.length, 1);
    await s.grant(false);
    const off = await s.here.post("/v1/messages", message("workstation/m-1", "Still?"));
    assert.equal(off.status, 502);
    assert.match((await off.json()).error.message, /Workstation said: Filament agents on Laptop may not use this machine's models: its grant is switched on in Settings › Remote access/);
    await s.grant(true);
    const back = await s.here.post("/v1/messages", message("workstation/m-1", "Back?"));
    assert.equal(back.status, 200, await back.clone().text());
    await s.revoke();
    const gone = await s.here.post("/v1/messages", message("workstation/m-1", "And now?"));
    assert.equal(gone.status, 502);
    assert.match((await gone.json()).error.message, /Workstation said: this device's token is not one this Filament knows: it was revoked, or replaced/);
    assert.equal(s.up.received.length, 2, "the refused calls reached no provider there");
  } finally {
    await s.stop();
  }
});

// (fails before: yes — the words were "Workstation did not answer: FILAMENT_PIN"; and with server.js's hunk off, the
// offline words outlived the upstream's removal)
test("a certificate other than the one pinned is said as that; the machine's offline words go with its upstream", async () => {
  const s = await lending();
  try {
    createMachines({ dataDir: s.here.dataDir }).keep({ url: s.remote.url, fingerprint: Array(32).fill("00").join(":"), machine: s.remote.machine, device: s.agents.device, token: s.agents.token });
    await offer(s);
    const r = await s.here.post("/v1/messages", message("workstation/m-1", "Still you?"));
    assert.equal(r.status, 502);
    assert.match((await r.json()).error.message, /Workstation: its certificate changed — the certificate at 127\.0\.0\.1:\d+ is [0-9A-F:]{95}, not the one .* pinned .*If that machine's was made anew, pair it again from its Settings › Remote access/);
    assert.match(String(offlineWords("workstation")), /^Workstation: its certificate changed/);
    const cfg = (await (await s.here.api("/api/state")).json()).config;
    const put = await s.here.api("/api/config", { method: "PUT", body: { ...cfg, upstreams: cfg.upstreams.filter((/** @type {any} */ u) => u.id !== "workstation"), routes: cfg.routes.filter((/** @type {any} */ r) => r.upstream !== "workstation") } });
    assert.equal(put.status, 200, await put.clone().text());
    assert.equal(offlineWords("workstation"), null);
  } finally {
    await s.stop();
  }
});

// (fails before: yes — with the machine upstream left out of the stage's check, the stage planned workstation's call
// for another machine's chat; and with dispatch.js's hunk of the m-upstream hunt off, a loop's call for another
// machine's agents' chat here was planned there all the same)
test("another machine's chat is never sent to a third machine's models, though the configuration named them after its route was read", async () => {
  const cfg = { upstreams: [{ id: "workstation", name: "Workstation", type: "filament", machine: "11111111-1111-4111-8111-111111111111", enabled: true }], routes: [] };
  /** A call to workstation/m-1, planned past the stages that read the configuration: who asked, and what came of it. @param {"lent" | "agents' chat"} who */
  const dispatched = async (who) => {
    /** @type {{ status: number, body: string }} */
    const replied = { status: 0, body: "" };
    let asked = 0;
    const res = /** @type {any} */ ({ writableEnded: false, destroyed: false, writeHead: (/** @type {number} */ status) => void (replied.status = status), end: (/** @type {string} */ b) => void (replied.body = b), setHeader() {}, on() {} });
    const req = /** @type {any} */ ({ socket: { remoteAddress: "192.0.2.7" }, headers: {} });
    if (who === "lent") lendModels(req, /** @type {any} */ ({ id: "d-1", name: "Filament agents on Laptop", scope: "agent" }));
    /** @type {any[]} */
    const finished = [];
    const deps = /** @type {any} */ ({
      config: () => cfg,
      log: { info() {}, warn() {}, error() {}, debug() {} },
      destination: () => ({ agent: null, answers: { open: async () => (asked++, Promise.reject(new Error("asked"))), unreachable: () => ({ message: "asked", retryable: true }) } }),
      // The call to it planned: the first step of asking it.
      plan: () => {
        asked++;
        throw new Error("planned");
      },
      finish: (/** @type {any} */ _rec, /** @type {any} */ o) => finished.push(o),
      wireApiFor: () => null,
    });
    const headers = who === "lent" ? {} : { [AGENTS_CHAT_HEADER]: "1" };
    const ctx = /** @type {any} */ ({ req, res, format: "anthropic", body: { model: "workstation/m-1", max_tokens: 8, messages: [] }, raw: "{}", headers, requested: "workstation/m-1", route: { match: "workstation/*" }, rec: { id: "r-1" }, candidates: [{ upstream: "workstation", upstreamModel: "m-1" }], t0: Date.now() });
    const out = await dispatch({ turn: async () => undefined })(ctx, deps).catch((/** @type {any} */ e) => `threw: ${e?.message}`);
    return { asked, out, replied, finished };
  };
  for (const who of /** @type {const} */ (["lent", "agents' chat"])) {
    const { asked, out, replied, finished } = await dispatched(who);
    assert.equal(asked, 0, `${who}: workstation was never asked`);
    assert.equal(out, "replied", who);
    assert.equal(replied.status, 403, who);
    assert.match(replied.body, /another machine's chats use this machine's own models; workstation is another machine's, which it lends to this machine alone/, who);
    assert.equal(finished[0]?.httpStatus, 403, who);
  }
});

// (fails before: yes — their device's list here named workstation/m-1, which their chat here ran on: the turn answered
// "MODEL ANSWER" from Workstation's provider; and a call of Filament's own saying it is for their chat went there too)
test("a machine's models lent here go to no other machine's agents: their device's list here leaves them out, and their chat here on one is refused in words, nothing sent there", async () => {
  const s = await lending();
  const project = mkdtempSync(join(tmpdir(), "filament-third-"));
  try {
    s.keep();
    await offer(s);
    assert.equal((await s.models()).models.find((/** @type {any} */ m) => m.id === "workstation/m-1")?.answers, true, "here's own chats run on it");
    // Workstation's agents start chats here as well: their device here, minted over Workstation's own pairing with here,
    // its grant `agents` on.
    const back = await pairMachines(s.there, s.here);
    const minted = await (await back.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: "{}" })).json();
    assert.ok(minted.token, JSON.stringify(minted));
    const granted = await s.here.api(`/api/remote/devices/${encodeURIComponent(minted.device.id)}`, { method: "PATCH", body: { grants: { agents: true } } });
    assert.equal(granted.status, 200, await granted.clone().text());
    const pinned = pinnedFetch(s.here.lan.fingerprint);
    /** A request of their device's to here, over the network. @param {string} path @param {unknown} [body] */
    const theirs = (path, body) =>
      pinned(`${s.here.far}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${minted.token}`, ...(body === undefined ? {} : JSON_TYPE) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const listed = await theirs("/api/models");
    assert.equal(listed.status, 200, await listed.clone().text());
    const ids = (await listed.json()).models.map((/** @type {any} */ m) => m.id);
    assert.ok(ids.includes("mine-1"), ids.join(", "));
    assert.deepEqual(ids.filter((/** @type {string} */ id) => id.startsWith("workstation/")), []);

    // Their chat here, named on it all the same: its turn's call is refused here, in words.
    const cfg = (await (await s.here.api("/api/state")).json()).config;
    const put = await s.here.api("/api/config", { method: "PUT", body: { ...cfg, agentLoop: { ...cfg.agentLoop, roots: [project] } } });
    assert.equal(put.status, 200, await put.clone().text());
    s.up.reset();
    const made = await theirs("/api/sessions", { cwd: project, model: "agent/workstation/m-1", preset: "plain" });
    const chat = await made.json();
    assert.equal(made.status, 200, JSON.stringify(chat));
    const turn = await theirs(`/api/sessions/${encodeURIComponent(chat.id)}/turns`, { content: "Whose model?", stream: false });
    const said = await turn.text();
    assert.ok(said.includes("another machine's chats use this machine's own models; workstation/m-1 is answered by another machine's, which it lends to this machine alone"), `${turn.status} ${said.slice(0, 600)}`);
    assert.ok(!said.includes("MODEL ANSWER"), said.slice(0, 600));
    assert.deepEqual(s.up.received.filter((c) => c.kind === "anthropic"), [], "nothing went to Workstation's provider");

    // A call of Filament's own for such a chat is refused the same; a client's saying so is a client's, said nothing by it.
    const own = await s.here.house("/v1/messages", message("workstation/m-1", "For their chat?"), { [AGENTS_CHAT_HEADER]: "1" });
    assert.equal(own.status, 403);
    assert.ok((await own.json()).error.message.includes("another machine's chats use this machine's own models"));
    const client = await s.here.post("/v1/messages", message("workstation/m-1", "A client's?"), { [AGENTS_CHAT_HEADER]: "1" });
    assert.equal(wordsOf(await client.json()), "MODEL ANSWER");
  } finally {
    await s.stop();
    // A stopped app's processes may still hold the folder a moment on a loaded machine (EPERM): removed once they let go.
    await removeDirs(project);
  }
});

/**
 * The route stage's plan for a call on `route`, health's own cooldown past (it parks nothing): its upstreams in the order
 * they are tried, and the notes its record keeps.
 * @param {any} cfg @param {any} route @param {Record<string, string>} [headers]
 */
const planned = async (cfg, route, headers = {}) => {
  /** @type {any} */
  const rec = { id: "r-1" };
  const ctx = /** @type {any} */ ({
    req: { socket: { remoteAddress: "127.0.0.1" }, on() {} },
    res: { writableEnded: false, on() {} },
    format: "anthropic",
    body: { model: route.match, max_tokens: 8, messages: [] },
    raw: "{}",
    pre: null,
    headers,
    requested: { base: route.match },
    route,
    notes: [],
    setAside: { dropped: [], agent: null, unread: [] },
    memory: { traceOn() {}, housekeeping: false },
  });
  const deps = /** @type {any} */ ({ config: () => cfg, usage: { start: () => rec }, health: { order: (/** @type {any[]} */ c) => ({ ordered: c, parked: [] }) }, liveAborts: new Map() });
  await routeStage(ctx, deps);
  return { order: ctx.candidates.map((/** @type {any} */ c) => c.upstream), notes: /** @type {string[]} */ (rec.priorChanges || []) };
};

// (fails before: yes — with health's cooldown past, the plan tried asleep-unit first again: a call paid its connect wait
// on a machine found offline a minute before; and a loop's call for another machine's agents' chat kept the machine as
// its route's backup)
test("a machine found offline is tried after its route's other upstreams for as long as it is found so, past health's own cooldown, and first again once it answers; another machine's agents' chat's call has it as no backup", async () => {
  const id = "asleep-unit";
  const cfg = {
    // Failover on, which is off by default: the order of a route's upstreams is health's only while it is on.
    rules: { resilience: { failover: true } },
    observability: {},
    upstreams: [
      { id, name: "Asleep", type: "filament", machine: "m-asleep", enabled: true },
      { id: "local", name: "local", type: "anthropic", apiKey: "s", enabled: true },
    ],
    routes: [],
  };
  try {
    const found = await filamentDestination({ id, name: "Asleep", type: "filament", machine: "m-asleep" }, { machines: null, inFlight: LENT_IN_FLIGHT }).test();
    assert.equal(found.ok, false);
    assert.match(String(offlineWords(id)), /^Asleep: this Filament keeps no machines/);
    const team = { match: "team-1", upstream: id, upstreamModel: "m-1", fallbacks: [{ upstream: "local", upstreamModel: "mine-1" }] };
    const asleep = await planned(cfg, team);
    assert.deepEqual(asleep.order, ["local", id]);
    assert.ok(asleep.notes.includes(`routing: ${id} moved last (cooling down, out of quota or offline)`), asleep.notes.join(" | "));
    forgetOffline(id);
    assert.deepEqual((await planned(cfg, team)).order, [id, "local"], "found answering, first again");

    const backed = { match: "team-2", upstream: "local", upstreamModel: "mine-1", fallbacks: [{ upstream: id, upstreamModel: "m-1" }] };
    assert.deepEqual((await planned(cfg, backed)).order, ["local", id], "here's own call fails over to it");
    assert.deepEqual((await planned(cfg, backed, { [AGENTS_CHAT_HEADER]: "1" })).order, ["local"]);
  } finally {
    forgetOffline(id);
  }
});

// (fails before: yes — the review of x14: every refusal of the wire's ask that carried a cause was said by its code, and
// a time limit's is the number 23: "Box did not answer: 23")
test("a machine whose wire's ask failed: a connection's code or a changed certificate said as a call's own failure is; a time limit, a status or an answer no Filament gives, in the store's own words", async () => {
  /** @param {string} id @param {Error} e */
  const offlineAfter = async (id, e) => {
    try {
      await filamentDestination({ id, name: "Box", type: "filament", machine: `${id}-m` }, { machines: { modelsWay: async () => Promise.reject(e) }, inFlight: LENT_IN_FLIGHT }).test();
      return String(offlineWords(id));
    } finally {
      forgetOffline(id);
    }
  };
  /** machineAt's refusal, with what failed beneath it. @param {string} words @param {any} cause */
  const refused = (words, cause) => Object.assign(new Error(words), { cause });
  const refusedConnection = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
  assert.equal(await offlineAfter("u-refused", refused("No Filament answers at https://box.example: … (fetch failed)", refusedConnection)), "Box did not answer: ECONNREFUSED");
  const pin = Object.assign(new Error("the certificate at box.example is AB, not the one this command line pinned (CD): nothing was sent"), { code: "FILAMENT_PIN" });
  assert.match(await offlineAfter("u-pin", refused("the certificate at box.example …", pin)), /^Box: its certificate changed — the certificate at box\.example is AB/);
  const slow = "No Filament answers at https://box.example: is the machine on, Filament running there, and its address one this machine reaches? (The operation was aborted due to timeout)";
  assert.equal(await offlineAfter("u-slow", refused(slow, new DOMException("The operation was aborted due to timeout", "TimeoutError"))), `Box: ${slow}`);
  const odd = "No Filament answers at https://box.example: is the machine on, Filament running there, and its address one this machine reaches? (HTTP 502)";
  assert.equal(await offlineAfter("u-odd", refused(odd, new Error("HTTP 502"))), `Box: ${odd}`);
});

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// (fails before: yes — with the listing's own time started before its wait for a turn (the times as they are here, the
// order as it was), the listing behind four calls gave up before it was sent: "The operation was aborted due to timeout")
test("a listing behind the calls in flight there waits for its turn, its own time starting once it is sent; one that waited past its wait says the machine busy, never offline", async () => {
  /** @type {(() => void)[]} */
  const held = [];
  /** @type {Parameters<typeof plainMachine>[0]} */
  const answer = (req, res) => {
    const reply = () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(req.url === "/v1/models" ? { data: [{ id: "m-1" }] } : { type: "message", role: "assistant", content: [{ type: "text", text: "ok" }] }));
    };
    if (req.url === "/v1/models") setTimeout(reply, 100);
    else held.push(reply);
  };
  /** Four calls there, held until `held` is let go; then each read and handed back. @param {any} d */
  const hold = async (d) => {
    const opening = Array.from({ length: LENT_IN_FLIGHT }, () => openFor(d, "anthropic"));
    const end = Date.now() + 5000;
    while (held.length < LENT_IN_FLIGHT && Date.now() < end) await sleep(20);
    assert.equal(held.length, LENT_IN_FLIGHT, "there has its four calls");
    return async () => {
      for (const go of held.splice(0)) go();
      for (const r of await Promise.all(opening)) {
        await r.res.text();
        r.cleanup();
      }
    };
  };
  const waits = await plainMachine(answer, "listing-waits", { listingMs: 400, listingWaitMs: 5000 });
  const busy = await plainMachine(answer, "listing-busy", { listingMs: 400, listingWaitMs: 300 });
  try {
    let release = await hold(waits.d);
    const listing = waits.d.test();
    await sleep(700);
    await release();
    const said = await listing;
    assert.equal(said.ok, true, JSON.stringify(said));
    assert.equal(said.models, 1);
    assert.equal(offlineWords("listing-waits"), null);

    release = await hold(busy.d);
    const late = await busy.d.test();
    await release();
    assert.equal(late.ok, false);
    assert.match(String(late.error), /^Unit is busy: its models were not listed now, behind 4 calls of this Filament's in flight there/);
    assert.equal(offlineWords("listing-busy"), null);
    assert.deepEqual(busy.seen.filter((s) => s.path === "/v1/models"), [], "nothing was asked of it");
  } finally {
    for (const go of held.splice(0)) go();
    await waits.close();
    await busy.close();
  }
});

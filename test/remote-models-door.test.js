// @ts-check
// Another machine's chats on this machine's models (the remote-agents plan's m-door): this machine's /v1 answers, at the
// network's door, an agents' device whose grant `models` its managers switched on — its token as a Bearer or an
// x-api-key, over the network listener's TLS (front-door.js `lanDoor`, guards.js `modelsDevice`). Nobody else is let in
// there: a device without the grant, the person's own full or view device, this machine's inbound key, the house key,
// plain http. Its calls go to API models alone, named alone — never a coding agent —, carry none of Filament's headers,
// and leave nothing here: memory stays out of them, Traffic keeps no body. A revoke, or the grant switched off, ends a
// stream at once. Two real Filaments (helpers/two-machines.js): `here` paired with `there` as a full device, which
// mints its machine's agents their device on `there`.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAR_ADDRESS, pairMachines, startTwoMachines } from "./helpers/two-machines.js";
import { anthropicReply, fakeUpstream } from "./helpers/app.js";
import { fedStream } from "./helpers/wait.js";
import { pinnedFetch } from "../src/services/machines/pinned.js";
import { houseAuth } from "../src/services/house.js";
import { HERE_ALONE_WORDS, LENT_IN_FLIGHT, LENT_STALL_MS, lanDoor } from "../src/http/front-door.js";
import { createDevices, modelsLentTo } from "../src/services/devices.js";

const JSON_TYPE = { "content-type": "application/json" };
/** What a model client of another machine sends: a message, as the Anthropic SDK does. @param {string} model @param {string} text */
const message = (model, text, stream = false) => ({ model, max_tokens: 64, stream, messages: [{ role: "user", content: text }] });

/** A while. @param {number} ms */
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
/** Whether `p` settles within `ms`. @param {Promise<any>} p @param {number} ms */
const within = (p, ms) => Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);

/** A reply's first events, as `m-slow` streams them and then waits. */
const SLOW_START = [
  `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_slow", type: "message", role: "assistant", model: "m-slow", content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 1 } } })}\n\n`,
  `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
  `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Still thinking" } })}\n\n`,
];
/**
 * The fake provider's script: `m-slow` streams its first words and waits, fed by hand (each stream kept in `fed`); any
 * other Anthropic call is answered at once. @param {ReturnType<typeof fedStream>[]} fed @returns {Parameters<typeof fakeUpstream>[0]}
 */
const slowly = (fed) => (call) => {
  if (call.kind !== "anthropic" || call.body?.model !== "m-slow") return call.kind === "anthropic" ? anthropicReply("MODEL ANSWER") : undefined;
  const f = fedStream(SLOW_START);
  fed.push(f);
  return f;
};

/**
 * Two machines, `there` serving its models: an Anthropic upstream (`m-*`), an OpenAI one (`gpt-*`), one with no key
 * (`nk-1`, which cannot answer), a coding agent (`cc-sonnet`, ACP) and one switched off (`cc-off-1`), a Responses
 * server (`resp-1`) and a Claude model's name on the Anthropic one (`claude-test-1`, which reads PDFs); and `here`'s
 * agents' device minted there, its grants as `grants` says. `memory`: there runs with memory on (never both: its engine
 * is a process-wide setting).
 * `script`: the fake provider's.
 * @param {{ grants?: Record<string, boolean>, memory?: boolean, script?: Parameters<typeof fakeUpstream>[0], configure?: (cfg: any) => void }} [o]
 */
async function serving({ grants = { models: true }, memory = false, script = undefined, configure = () => {} } = {}) {
  const up = await fakeUpstream(script);
  const two = await startTwoMachines({
    there: {
      memory,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, discoverModels: false },
          { id: "o", name: "o", type: "openai", baseUrl: `${up.url}/v1`, apiKey: "s", enabled: true, discoverModels: false },
          { id: "nk", name: "nk", type: "anthropic", baseUrl: "http://127.0.0.1:9", enabled: true, discoverModels: false },
          { id: "cc", name: "cc", type: "acp", enabled: true, models: ["cc-sonnet"], discoverModels: false, acp: { command: "no-such-agent", args: [] } },
          { id: "cc-off", name: "cc-off", type: "acp", enabled: false, discoverModels: false, acp: { command: "no-such-agent", args: [] } },
          { id: "r", name: "r", type: "openai-compatible", baseUrl: `${up.url}/v1`, apiKey: "s", enabled: true, discoverModels: false, wireApi: "responses" },
        ];
        cfg.routes = [
          { match: "m-1", upstream: "m", upstreamModel: "m-1", enabled: true },
          { match: "m-slow", upstream: "m", upstreamModel: "m-slow", enabled: true },
          { match: "gpt-1", upstream: "o", upstreamModel: "gpt-1", enabled: true },
          { match: "nk-1", upstream: "nk", upstreamModel: "nk-1", enabled: true },
          { match: "cc-sonnet", upstream: "cc", upstreamModel: "sonnet", enabled: true },
          { match: "cc-off-1", upstream: "cc-off", upstreamModel: "sonnet", enabled: true },
          { match: "resp-1", upstream: "r", upstreamModel: "resp-1", enabled: true },
          { match: "claude-test-1", upstream: "m", upstreamModel: "claude-test-1", enabled: true },
        ];
        cfg.observability = { ...cfg.observability, storeBodies: "full" };
        configure(cfg);
      },
    },
  });
  try {
    const minted = await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: "{}" });
    assert.equal(minted.status, 200, await minted.clone().text());
    const agents = await minted.json();
    if (Object.keys(grants).length) {
      const set = await two.there.api(`/api/remote/devices/${encodeURIComponent(agents.device.id)}`, { method: "PATCH", body: { grants } });
      assert.equal(set.status, 200, await set.clone().text());
    }
    const pinned = pinnedFetch(two.there.lan.fingerprint);
    /**
     * A model call to there over the network, pinned, its credential as `as` says: a Bearer, or x-api-key.
     * @param {string} path @param {{ body?: unknown, method?: string, key?: string, as?: "bearer" | "x-api-key", headers?: Record<string, string>, signal?: AbortSignal }} [o]
     */
    const call = (path, { body, method = body === undefined ? "GET" : "POST", key = agents.token, as = "bearer", headers = {}, signal } = {}) =>
      pinned(`${two.there.far}${path}`, {
        method,
        signal,
        headers: { ...(as === "bearer" ? { authorization: `Bearer ${key}` } : { "x-api-key": key }), "anthropic-version": "2023-06-01", ...(body === undefined ? {} : JSON_TYPE), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    return {
      ...two,
      up,
      agents,
      call,
      async stop() {
        await two.stop();
        await up.close();
      },
    };
  } catch (e) {
    await two.stop();
    await up.close();
    throw e;
  }
}

// (fails before: yes — /v1 at the network's door answered 404 to anyone, a device's token among them)
test("a granted agents' device's chats call there's API models over the network: a message, streamed or not, by a Bearer or an x-api-key; a chat completion; a count of tokens; the list holds the models that answer and no coding agent", async () => {
  const s = await serving();
  try {
    const one = await s.call("/v1/messages", { body: message("m-1", "Hello from the laptop.") });
    const said = await one.json();
    assert.equal(one.status, 200, JSON.stringify(said));
    assert.deepEqual([said.type, said.content?.[0]?.text], ["message", "MODEL ANSWER"]);
    // Streamed, the key as an x-api-key: the Anthropic SDK's own way.
    const streamed = await s.call("/v1/messages", { body: message("m-1", "Stream it.", true), as: "x-api-key" });
    assert.equal(streamed.status, 200);
    assert.match(String(streamed.headers.get("content-type")), /text\/event-stream/);
    const events = await streamed.text();
    assert.match(events, /event: message_start/);
    assert.match(events, /MODEL /);
    assert.match(events, /event: message_stop/);
    // The OpenAI wire too.
    const chat = await s.call("/v1/chat/completions", { body: { model: "gpt-1", messages: [{ role: "user", content: "hi" }] } });
    const completion = await chat.json();
    assert.equal(chat.status, 200, JSON.stringify(completion));
    assert.equal(completion.choices?.[0]?.message?.content, "MODEL ANSWER");
    const count = await s.call("/v1/messages/count_tokens", { body: { model: "m-1", messages: [{ role: "user", content: "count me" }] } });
    assert.equal(count.status, 200);
    assert.equal(typeof (await count.json()).input_tokens, "number");
    // The upstream was sent there's own key, never the device's token.
    for (const c of s.up.received) {
      assert.doesNotMatch(JSON.stringify(c.headers), /fdt_/, "the device's token stays there");
    }
    // The list: what answers, by an API. This machine's own client sees the rest as it always did.
    const listed = (await (await s.call("/v1/models")).json()).data.map((/** @type {any} */ m) => m.id);
    for (const id of ["gpt-1", "m-1"]) assert.ok(listed.includes(id), `${id} is theirs: ${listed.join(", ")}`);
    for (const id of ["cc-sonnet", "sonnet", "nk-1"]) assert.ok(!listed.includes(id), `${id} is not theirs: ${listed.join(", ")}`);
    const own = (await (await s.there.api("/v1/models", { headers: { "anthropic-version": "2023-06-01" } })).json()).data.map((/** @type {any} */ m) => m.id);
    for (const id of ["cc-sonnet", "nk-1"]) assert.ok(own.includes(id), `${id} is listed to this machine's own client: ${own.join(", ")}`);
  } finally {
    await s.stop();
  }
});

// (fails before: yes — the door answered every caller its 404, so no refusal said why; a granted device's call was one)
test("who is refused there's models over the network: an agents' device without the grant, the person's own full and view devices, an unknown token, this machine's inbound key, the house key; and a device's token over plain http, the main port's included", async () => {
  const s = await serving({ grants: { agents: true } });
  const phoneDir = mkdtempSync(join(tmpdir(), "filament-models-phone-"));
  try {
    const body = message("m-1", "May I?");
    /** @param {Response} r */
    const words = async (r) => (await r.json())?.error?.message || "";
    const off = await s.call("/v1/messages", { body });
    assert.equal(off.status, 403);
    assert.match(await words(off), /Filament agents on Laptop may not use this machine's models: its grant is switched on in Settings › Remote access/);
    assert.equal((await s.call("/v1/models")).status, 403, "nor the list");
    // The person's own devices: theirs is the console, never another machine's chats.
    const full = await s.call("/v1/messages", { body, key: s.remote.token });
    assert.equal(full.status, 403);
    assert.match(await words(full), /Laptop is the person's own device/);
    const phone = await pairMachines(/** @type {any} */ ({ dataDir: phoneDir, machine: { name: "Phone" } }), s.there, { scope: "view" });
    const view = await s.call("/v1/messages", { body, key: phone.remote.token });
    assert.equal(view.status, 403);
    assert.match(await words(view), /Phone is the person's own device/);
    const unknown = await s.call("/v1/messages", { body, key: "fdt_no-such-token" });
    assert.equal(unknown.status, 401);
    assert.match(await words(unknown), /not one this Filament knows/);
    // This machine's inbound key, and the house key (one per process: here's is there's, in this test), are no way in
    // over the network.
    for (const [key, as] of /** @type {const} */ ([[s.there.key, "bearer"], [s.there.key, "x-api-key"], [houseAuth()["x-api-key"], "x-api-key"]])) {
      const r = await s.call("/v1/messages", { body, key, as });
      assert.equal(r.status, 404, `${as} ${key.slice(0, 12)}…`);
      assert.equal((await r.json()).error, HERE_ALONE_WORDS);
    }
    // MCP, a hook and the memory engine's door stay refused, the device's token or not.
    for (const path of ["/mcp/memory", "/hook/app/token", "/memory-engine/v1/messages", "/v1/embeddings"])
      assert.equal((await s.call(path, { body: {} })).status, 404, path);
    // The grant on: let in. Then a device's token over plain http, from the network to the main port: refused there by
    // the same door, which takes it over a sealed way alone. Over the listener's TLS, a header that says http says nothing.
    const set = await s.there.api(`/api/remote/devices/${encodeURIComponent(s.agents.device.id)}`, { method: "PATCH", body: { grants: { models: true } } });
    assert.equal(set.status, 200);
    assert.equal((await s.call("/v1/messages", { body })).status, 200, "its grant on");
    const plain = await new Promise((resolve, reject) => {
      const raw = JSON.stringify(body);
      const r = http.request({ host: "127.0.0.1", port: s.there.port, localAddress: FAR_ADDRESS, path: "/v1/messages", method: "POST", headers: { ...JSON_TYPE, host: `127.0.0.1:${s.there.port}`, authorization: `Bearer ${s.agents.token}`, "content-length": String(Buffer.byteLength(raw)) } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      r.on("error", reject);
      r.end(raw);
    });
    assert.equal(plain, 403, "the main port over plain http from the network: a device's token is taken over a sealed way alone");
    // (fails before: yes — the review of s0b: a device's model call at a path with no /v1 went past the door on the main
    // port, served as this computer's own client's)
    const bare = await fetch(`http://127.0.0.1:${s.there.port}/messages`, { method: "POST", headers: { ...JSON_TYPE, authorization: `Bearer ${s.agents.token}` }, body: JSON.stringify(body) });
    assert.equal(bare.status, 404);
    assert.match(JSON.stringify(await bare.json()), /a device's model calls go to \/v1\/messages, \/v1\/chat\/completions, \/v1\/responses and \/v1\/models alone/);
    const viaProxy = await s.call("/v1/messages", { body, headers: { "x-forwarded-proto": "http", "x-forwarded-for": "192.168.1.20" } });
    assert.equal(viaProxy.status, 200, "over the listener's own TLS, a header says nothing of the way it came");
  } finally {
    await s.stop();
    rmSync(phoneDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// (fails before: yes — the door answered 404, so a coding agent's route and a marked name were never theirs to be refused)
test("there's coding agents are never theirs: a coding agent's route, and a name with @, # or $, are refused; Filament's own headers they send are none of its", async () => {
  const s = await serving();
  try {
    const agent = await s.call("/v1/messages", { body: message("cc-sonnet", "Work on your machine for me.") });
    assert.equal(agent.status, 403);
    assert.match((await agent.json()).error.message, /cc-sonnet is answered by a coding agent, which works on this machine alone/);
    for (const name of ["m-1@plan", "m-1#chat-1", "m-1$fast"]) {
      const r = await s.call("/v1/messages", { body: message(name, "hi") });
      assert.equal(r.status, 403, name);
      assert.match((await r.json()).error.message, /another machine's chats name a model here alone/, name);
    }
    const responses = await s.call("/v1/responses", { body: { model: "cc-sonnet", input: "hi" } });
    assert.equal(responses.status, 403, "the Responses wire too");
    // Filament's own headers ride no further than the door: a folder, a mode, memory's switch and its load, a chain.
    s.up.reset();
    const sent = await s.call("/v1/messages", {
      body: message("m-1", "Plain words."),
      headers: { "x-filament-cwd": process.cwd(), "x-filament-permissions": "allow-all", "x-filament-memory": "on", "x-filament-memory-load": "c-any", "x-filament-chain": "c-any" },
    });
    assert.equal(sent.status, 200);
    const recs = (await (await s.there.api("/api/requests?limit=20")).json()).requests;
    const rec = recs.find((/** @type {any} */ r) => r.model === "m-1");
    assert.ok(rec, "the call is a record there");
    const full = await (await s.there.api(`/api/requests/${rec.id}`)).json();
    assert.equal(full.cwd, undefined, "no folder of its naming");
    assert.doesNotMatch(JSON.stringify(full.priorChanges || []), /x-filament/, "nothing of theirs was even set aside: the door took it off");
  } finally {
    await s.stop();
  }
});

// (fails before: yes — the door answered 404; and memory off by a header still let a briefing ride and kept nothing apart)
test("there keeps nothing of their calls: memory never situates them — a chat of there's named to load is not loaded, nothing is captured — and Traffic keeps what they spent, never what they said", async () => {
  const s = await serving({ memory: true });
  try {
    // There's own client, on its own machine, with the inbound key: memory captures its turn, as ever.
    const own = await s.there.post("/v1/messages", message("m-1", "The workstation's own secret plan."));
    assert.equal(own.status, 200);
    const ownRec = (await (await s.there.api("/api/requests?limit=20")).json()).requests.find((/** @type {any} */ r) => r.memory?.chain);
    assert.ok(ownRec?.memory?.chain, "this machine's own call is memory's");
    const chain = String(ownRec.memory.chain);
    const before = JSON.stringify(await (await s.there.api("/api/memory/sessions")).json());
    assert.match(JSON.stringify(await (await s.there.api(`/api/memory/sessions/${encodeURIComponent(chain)}`)).json()), /secret plan/);
    // Theirs, naming that chat to load and asking memory on: the model reads nothing of it, and memory keeps nothing.
    s.up.reset();
    const theirs = await s.call("/v1/messages", { body: message("m-1", "The laptop's private words."), headers: { "x-filament-memory": "on", "x-filament-memory-load": chain } });
    assert.equal(theirs.status, 200);
    const got = JSON.stringify(s.up.received.find((c) => c.kind === "anthropic")?.body);
    assert.match(got, /The laptop's private words\./);
    assert.doesNotMatch(got, /secret plan/, "there's chat was not loaded into theirs");
    assert.doesNotMatch(got, /filament_memory|filament_recall/, "no tool of there's memory rides it");
    const after = JSON.stringify(await (await s.there.api("/api/memory/sessions")).json());
    assert.equal(after, before, "no session was made or moved");
    assert.doesNotMatch(after, /private words/);
    const rec = (await (await s.there.api("/api/requests?limit=20")).json()).requests.find((/** @type {any} */ r) => r.id !== ownRec.id && r.model === "m-1");
    const full = await (await s.there.api(`/api/requests/${rec.id}`)).json();
    assert.equal(full.memory, undefined, "memory prepared nothing");
    assert.equal(full.memoryTrace, undefined, "memory never situated it");
    assert.doesNotMatch(JSON.stringify(full), /private words/, "Traffic keeps no body of it, bodies stored in full or not");
    assert.match(String(full.bodyWithheld), /another machine's chat \(Filament agents on Laptop\)/);
    assert.ok(full.usage || full.inputTokens != null || full.tokens, `what it spent is counted: ${Object.keys(full).join(", ")}`);
    // The Responses wire keeps a conversation an hour, to continue by previous_response_id: theirs is kept nowhere, and
    // continues none of there's own.
    const ownResponse = await (await s.there.post("/v1/responses", { model: "m-1", input: "The workstation's own question." })).json();
    assert.match(String(ownResponse.id), /^resp_/, JSON.stringify(ownResponse));
    const continued = await s.call("/v1/responses", { body: { model: "m-1", input: "And then?", previous_response_id: ownResponse.id } });
    assert.equal(continued.status, 400, "there's own conversation is not theirs to continue");
    assert.match((await continued.json()).error.message, /continues no response here/);
    const theirResponse = await s.call("/v1/responses", { body: { model: "m-1", input: "The laptop's question." } });
    const theirId = (await theirResponse.json()).id;
    assert.equal(theirResponse.status, 200);
    assert.equal((await s.there.post("/v1/responses", { model: "m-1", input: "Go on.", previous_response_id: theirId })).status, 404, "theirs was never kept");
  } finally {
    await s.stop();
  }
});

// (fails before: yes — their x-session-id sat on there's Traffic as the call's client session, and went on to there's
// provider with the rest of their chat's ids)
test("their chat's own ids ride no further than the door: Traffic keeps no client session of theirs, and there's provider is sent none; there's own client's session is its Traffic's, as ever", async () => {
  const s = await serving();
  try {
    s.up.reset();
    const ids = { "x-session-id": "their-chat-1", "x-opencode-session": "their-chat-2", "x-conversation-id": "their-chat-3", "x-thread-id": "their-chat-4" };
    const theirs = await s.call("/v1/messages", { body: message("m-1", "Whose chat?"), headers: ids });
    assert.equal(theirs.status, 200, await theirs.clone().text());
    assert.doesNotMatch(JSON.stringify(s.up.received.find((c) => c.kind === "anthropic")?.headers), /their-chat/);
    const rec = await (await s.there.api(`/api/requests/${theirs.headers.get("x-filament-request-id")}`)).json();
    assert.equal(rec.model, "m-1", JSON.stringify(rec).slice(0, 300));
    assert.doesNotMatch(JSON.stringify(rec), /their-chat/);
    const own = await s.there.post("/v1/messages", message("m-1", "Mine?"), { "x-session-id": "own-chat" });
    assert.equal(own.status, 200);
    assert.equal((await (await s.there.api(`/api/requests/${own.headers.get("x-filament-request-id")}`)).json()).clientSession, "own-chat");
  } finally {
    await s.stop();
  }
});

// (fails before: yes — the door answered 404, so there was no stream of theirs to end)
test("a stream of theirs ends at once as there revokes their device, or switches its grant `models` off; the provider's stream is let go too", async () => {
  /** @type {ReturnType<typeof fedStream>[]} */
  const fed = [];
  const s = await serving({ script: slowly(fed) });
  /** @type {AbortController[]} */
  const held = [];
  try {
    /** A stream of theirs, read until its first words; → its end (in an object: a promise returned would be awaited). */
    const open = async () => {
      const stop = new AbortController();
      held.push(stop);
      const r = await s.call("/v1/messages", { body: message("m-slow", "Take your time.", true), signal: stop.signal });
      assert.equal(r.status, 200);
      const reader = /** @type {ReadableStreamDefaultReader<Uint8Array>} */ (r.body?.getReader());
      let seen = "";
      while (!/Still thinking/.test(seen)) {
        const { value, done } = await reader.read();
        if (done) break;
        seen += new TextDecoder().decode(value);
      }
      assert.match(seen, /Still thinking/);
      const closed = (async () => {
        try {
          while (!(await reader.read()).done);
        } catch {}
        return true;
      })();
      return { closed };
    };
    const id = encodeURIComponent(s.agents.device.id);
    // The grant `agents` switched on and off is none of a model's stream: it streams on.
    const first = await open();
    assert.equal((await s.there.api(`/api/remote/devices/${id}`, { method: "PATCH", body: { grants: { agents: true } } })).status, 200);
    assert.equal(await within(first.closed, 500), false, "another grant moved: it streams on");
    // `models` off: it ends, and so does the provider's.
    assert.equal((await s.there.api(`/api/remote/devices/${id}`, { method: "PATCH", body: { grants: { models: false } } })).status, 200);
    assert.equal(await within(first.closed, 3000), true, "its grant off: the stream ends");
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(fed[0]?.cancelled, true, "the provider's stream let go");
    // On again, a stream again; revoked: it ends, and its token fails.
    assert.equal((await s.there.api(`/api/remote/devices/${id}`, { method: "PATCH", body: { grants: { models: true } } })).status, 200);
    const second = await open();
    assert.equal((await s.there.api(`/api/remote/devices/${id}`, { method: "DELETE" })).status, 200);
    assert.equal(await within(second.closed, 3000), true, "revoked: the stream ends");
    assert.equal((await s.call("/v1/messages", { body: message("m-1", "Again?") })).status, 401, "its token fails");
  } finally {
    for (const h of held) h.abort();
    for (const f of fed) f.end();
    await s.stop();
  }
});

// (fails before: yes — lanDoor took no devices, and answered /v1 404 whoever asked)
test("the door itself, as the tailnet's hands it a request (over loopback, a proxy's headers on it): a device's token a proxy here took over plain http is refused; over https it reaches the front door marked theirs, with no header of Filament's", async () => {
  const devices = createDevices();
  const full = devices.claim(devices.startPairing({ scope: "full" }).code, { name: "Laptop" });
  assert.ok(full.ok);
  const minted = devices.mintAgents(full.device.id);
  assert.ok(minted.ok);
  devices.grant(minted.device.id, { models: true });
  /** @type {{ lent: any, headers: Record<string, any> }[]} */
  const reached = [];
  const server = http.createServer(
    lanDoor(
      (req, res) => {
        reached.push({ lent: modelsLentTo(req), headers: { ...req.headers } });
        res.end("the front door");
      },
      { devices },
    ),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
  /** @param {Record<string, string>} headers @returns {Promise<{ status: number, text: string }>} */
  const send = (headers) =>
    new Promise((resolve, reject) => {
      const r = http.request({ host: "127.0.0.1", port, path: "/v1/messages", method: "POST", headers: { host: "desktop-1.tail5e6f7a.ts.net", "x-forwarded-for": "100.101.102.103", authorization: `Bearer ${minted.token}`, ...headers } }, (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: Number(res.statusCode), text }));
      });
      r.on("error", reject);
      r.end("{}");
    });
  try {
    const plain = await send({ "x-forwarded-proto": "http" });
    assert.equal(plain.status, 403);
    assert.match(JSON.parse(plain.text).error.message, /a device's token is taken over https alone/);
    assert.equal(reached.length, 0);
    const sealed = await send({ "x-forwarded-proto": "https", "x-filament-cwd": "/home/someone", "x-filament-memory": "on", "x-filament-chain": "c-1" });
    assert.deepEqual([sealed.status, sealed.text], [200, "the front door"]);
    assert.equal(reached[0]?.lent?.id, minted.device.id, "marked theirs");
    assert.deepEqual(Object.keys(reached[0].headers).filter((k) => k.startsWith("x-filament-")), [], "no header of Filament's");
    // Without the door's devices — or with no token of one —, /v1 is what it was: refused to anyone.
    devices.grant(minted.device.id, { models: false });
    assert.equal((await send({ "x-forwarded-proto": "https" })).status, 403);
    assert.equal((await send({ authorization: "Bearer not-a-device" })).status, 404);
  } finally {
    await new Promise((r) => server.close(() => r(undefined)));
  }
});

/** Read a stream of theirs to its first words. @param {Response} r */
const toFirstWords = async (r) => {
  const reader = /** @type {ReadableStreamDefaultReader<Uint8Array>} */ (r.body?.getReader());
  let seen = "";
  while (!/Still thinking/.test(seen)) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += new TextDecoder().decode(value);
  }
  return seen;
};

// (fails before: yes — nothing capped a device: a fifth call in flight went on, and its record named no device)
test("a device has four calls in flight on there's models at the most: a fifth is answered 429 in its client's wire, in words, and goes once one ends; there's own client is never counted; a call's record names its device", async () => {
  /** @type {ReturnType<typeof fedStream>[]} */
  const fed = [];
  const s = await serving({ script: slowly(fed) });
  /** @type {AbortController[]} */
  const held = [];
  try {
    assert.equal(LENT_IN_FLIGHT, 4);
    for (let n = 0; n < LENT_IN_FLIGHT; n++) {
      const stop = new AbortController();
      held.push(stop);
      const r = await s.call("/v1/messages", { body: message("m-slow", `Stream ${n}.`, true), signal: stop.signal });
      assert.equal(r.status, 200);
      assert.match(await toFirstWords(r), /Still thinking/);
    }
    const fifth = await s.call("/v1/messages", { body: message("m-1", "One more?") });
    assert.equal(fifth.status, 429);
    assert.equal(fifth.headers.get("retry-after"), "5");
    const said = await fifth.json();
    assert.equal(said.type, "error", "the Anthropic wire");
    assert.match(said.error.message, /Filament agents on Laptop has 4 calls in flight on this machine's models, the most one device may/);
    const chat = await s.call("/v1/chat/completions", { body: { model: "gpt-1", messages: [{ role: "user", content: "hi" }] } });
    assert.equal(chat.status, 429);
    assert.match((await chat.json()).error.message, /calls in flight/, "the OpenAI wire");
    assert.equal((await s.there.post("/v1/messages", message("m-1", "Mine."))).status, 200, "there's own client goes on");
    // One ends: the next goes, once there hears it.
    held[0].abort();
    let next = 429;
    for (let t = 0; t < 50 && next === 429; t++) {
      next = (await s.call("/v1/messages", { body: message("m-1", "Now?") })).status;
      if (next === 429) await pause(100);
    }
    assert.equal(next, 200);
    // Each record of theirs names the device, and where it called from; there's own names none.
    const list = (await (await s.there.api("/api/requests?limit=40")).json()).requests;
    const full = await Promise.all(list.map(async (/** @type {any} */ r) => (await s.there.api(`/api/requests/${r.id}`)).json()));
    const theirs = full.filter((r) => r.device);
    assert.ok(theirs.length >= LENT_IN_FLIGHT + 1, `their calls: ${theirs.length}`);
    for (const r of theirs) assert.deepEqual([r.device, r.clientIp], [{ id: s.agents.device.id, name: "Filament agents on Laptop" }, FAR_ADDRESS]);
    assert.ok(full.some((r) => !r.device && r.model === "m-1"), "there's own call names no device");
  } finally {
    for (const h of held) h.abort();
    for (const f of fed) f.end();
    await s.stop();
  }
});

// (fails before: yes — an answer nobody read waited for its reader for good, and its provider's slot with it)
test("an answer another machine's chat reads none of ends at the stall limit (60 s; shorter here), the call it answers with it; one read on is never cut", async () => {
  assert.equal(LENT_STALL_MS, 60_000);
  const devices = createDevices();
  const full = devices.claim(devices.startPairing({ scope: "full" }).code, { name: "Laptop" });
  assert.ok(full.ok);
  const minted = devices.mintAgents(full.device.id);
  assert.ok(minted.ok);
  devices.grant(minted.device.id, { models: true });
  const SIZE = 64 * 1024 * 1024;
  /** The third answer's, read slowly: a few MB, so its reader's pauses add up to several stall limits. */
  const SLOW_SIZE = 4 * 1024 * 1024;
  /** How each answer ended, as the front door — the pipeline — sees it: its end, or its connection closed under it. @type {Promise<string>[]} */
  const ends = [];
  const server = http.createServer(
    lanDoor(
      (_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const size = ends.length === 2 ? SLOW_SIZE : SIZE;
        const closed = /** @type {Promise<string>} */ (new Promise((r) => res.once("close", () => r(res.writableFinished ? "finished" : "cut"))));
        ends.push(closed);
        const chunk = Buffer.alloc(64 * 1024, 97);
        void (async () => {
          for (let sent = 0; sent < size && !res.destroyed; sent += chunk.length)
            if (!res.write(chunk)) await Promise.race([new Promise((r) => res.once("drain", r)), closed]);
          if (!res.destroyed) res.end();
        })();
      },
      { devices, stallMs: 300 },
    ),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
  /** The calls made, dropped at the end: a reader that reads nothing never hears its connection closed. @type {http.ClientRequest[]} */
  const made = [];
  /**
   * A call that reads its answer — → the bytes read — or leaves it unread — → 0, once its answer starts. `slowly`: it
   * rests a while after each piece, reading on all the same.
   * @param {boolean} reads @param {{ slowly?: number }} [o] @returns {Promise<number>}
   */
  const ask = (reads, { slowly = 0 } = {}) =>
    new Promise((resolve, reject) => {
      const r = http.request({ host: "127.0.0.1", port, path: "/v1/messages", method: "POST", agent: false, headers: { host: "desktop-1.tail5e6f7a.ts.net", "x-forwarded-for": "100.101.102.103", "x-forwarded-proto": "https", authorization: `Bearer ${minted.token}` } }, (res) => {
        let got = 0;
        if (!reads) {
          res.pause();
          return resolve(got);
        }
        res.on("data", (c) => {
          got += c.length;
          if (slowly) (res.pause(), setTimeout(() => res.resume(), slowly));
        });
        res.on("end", () => resolve(got));
        res.on("error", () => resolve(got));
      });
      made.push(r);
      r.on("error", (e) => (reads ? reject(e) : resolve(0)));
      r.end("{}");
    });
  try {
    await ask(false);
    while (!ends[0]) await pause(20);
    assert.equal(await within(ends[0], 5000), true, "the unread answer ends");
    assert.equal(await ends[0], "cut");
    assert.equal(await ask(true), SIZE, "an answer read on goes whole");
    assert.equal(await ends[1], "finished");
    // (fails before: yes — the door looked at whether its buffer was full, and a provider faster than its reader keeps it
    // full: a reader reading on steadily, slower than the answer comes, was cut at the stall limit)
    assert.equal(await ask(true, { slowly: 25 }), SLOW_SIZE, "an answer read slowly, but read on, goes whole");
    assert.equal(await ends[2], "finished");
  } finally {
    for (const r of made) r.destroy();
    server.closeAllConnections();
    await new Promise((r) => server.close(() => r(undefined)));
  }
});

// (fails before: yes — each field went to there's provider as sent, and a Responses call was stored there: store unsaid is true)
test("their calls name nothing there's provider keeps — a conversation, a stored prompt, a vector store, a container, a file — and are stored there by none: store goes false", async () => {
  const s = await serving();
  try {
    s.up.reset();
    for (const [path, body, field] of /** @type {[string, any, RegExp][]} */ ([
      ["/v1/responses", { model: "resp-1", input: "hi", conversation: "conv_123" }, /names conversation,/],
      ["/v1/responses", { model: "resp-1", input: "hi", prompt: { id: "pmpt_123" } }, /names prompt,/],
      ["/v1/responses", { model: "resp-1", input: "hi", tools: [{ type: "file_search", vector_store_ids: ["vs_1"] }] }, /names tools\[0\]\.vector_store_ids,/],
      ["/v1/responses", { model: "resp-1", input: "hi", tools: [{ type: "code_interpreter", container: "cntr_1" }] }, /names tools\[0\]\.container,/],
      ["/v1/responses", { model: "resp-1", input: [{ role: "user", content: [{ type: "input_file", file_id: "file-1" }] }] }, /names input\[0\]\.content\[0\]\.file_id,/],
      ["/v1/messages", { ...message("m-1", "hi"), container: "cntr_1" }, /names container,/],
      ["/v1/messages", { model: "m-1", max_tokens: 64, messages: [{ role: "user", content: [{ type: "document", source: { type: "file", file_id: "file_1" } }, { type: "text", text: "Read it." }] }] }, /names messages\[0\]\.content\[0\]\.source\.file_id,/],
      ["/v1/chat/completions", { model: "gpt-1", messages: [{ role: "user", content: [{ type: "file", file: { file_id: "file-1" } }] }] }, /names messages\[0\]\.content\[0\]\.file\.file_id,/],
    ])) {
      const r = await s.call(path, { body });
      const text = await r.text();
      assert.equal(r.status, 400, `${path}: ${text}`);
      assert.match(text, field);
      assert.match(text, /which this machine's provider keeps on this machine's account/);
    }
    assert.equal(s.up.received.length, 0, "none reached the provider");
    // A tool of theirs whose schema holds such a key names nothing kept.
    const tool = await s.call("/v1/messages", { body: { ...message("m-1", "Use it."), tools: [{ name: "open", description: "opens a file", input_schema: { type: "object", properties: { file_id: { type: "string" }, container: { type: "string" } } } }] } });
    assert.equal(tool.status, 200, await tool.clone().text());
    // Stored nowhere: a Responses call passed through, and a completion asked to be stored.
    s.up.reset();
    const resp = await s.call("/v1/responses", { body: { model: "resp-1", input: "A plain question." } });
    assert.equal(resp.status, 200, await resp.clone().text());
    assert.equal(s.up.received.find((c) => c.kind === "responses")?.body?.store, false);
    const chat = await s.call("/v1/chat/completions", { body: { model: "gpt-1", store: true, messages: [{ role: "user", content: "hi" }] } });
    assert.equal(chat.status, 200);
    assert.equal(s.up.received.find((c) => c.kind === "openai")?.body?.store, false);
    // There's own client is as it was.
    s.up.reset();
    assert.equal((await s.there.post("/v1/responses", { model: "resp-1", input: "Mine." })).status, 200);
    assert.equal(s.up.received.find((c) => c.kind === "responses")?.body?.store, undefined);
  } finally {
    await s.stop();
  }
});

// (fails before: yes — a route to a coding agent switched off passed parse and route, which find no upstream that is off; count_tokens answered a coding agent's name and a marked one)
test("a coding agent switched off is refused them as one on; count_tokens refuses what their calls are refused", async () => {
  const s = await serving();
  try {
    const off = await s.call("/v1/messages", { body: message("cc-off-1", "hi") });
    assert.equal(off.status, 403);
    assert.match((await off.json()).error.message, /cc-off-1 is answered by a coding agent, which works on this machine alone/);
    const messages = [{ role: "user", content: "count me" }];
    for (const [model, words] of /** @type {[string, RegExp][]} */ ([
      ["cc-sonnet", /cc-sonnet is answered by a coding agent/],
      ["cc-off-1", /cc-off-1 is answered by a coding agent/],
      ["m-1#chat-1", /another machine's chats name a model here alone: "#"/],
    ])) {
      const r = await s.call("/v1/messages/count_tokens", { body: { model, messages } });
      assert.equal(r.status, 403, model);
      assert.match((await r.json()).error.message, words);
    }
    assert.equal((await s.call("/v1/messages/count_tokens", { body: { model: "m-1", messages } })).status, 200);
    assert.equal((await s.there.post("/v1/messages/count_tokens", { model: "cc-sonnet", messages })).status, 200, "there's own client counts as ever");
  } finally {
    await s.stop();
  }
});

// (fails before: yes — their PDF went through this machine's pdftotext, and to a model that reads none as its text)
test("their PDFs are read by no program here: a model that reads PDFs gets each as it came; one that reads none is refused it in words", async () => {
  const s = await serving();
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n").toString("base64");
  /** @param {string} model */
  const withPdf = (model) => ({ model, max_tokens: 64, messages: [{ role: "user", content: [{ type: "document", title: "plan.pdf", source: { type: "base64", media_type: "application/pdf", data: pdf } }, { type: "text", text: "Read it." }] }] });
  try {
    s.up.reset();
    const refused = await s.call("/v1/messages", { body: withPdf("m-1") });
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error.message, /m-1 at m reads no PDF, and this machine reads none for another machine's chat/);
    assert.equal(s.up.received.length, 0);
    const read = await s.call("/v1/messages", { body: withPdf("claude-test-1") });
    assert.equal(read.status, 200, await read.clone().text());
    const sent = s.up.received.find((c) => c.kind === "anthropic")?.body;
    assert.equal(sent?.messages?.[0]?.content?.find((/** @type {any} */ b) => b.type === "document")?.source?.data, pdf, "the PDF as it came");
    // There's own client: to a model that reads none, its PDF goes as its text, as ever.
    s.up.reset();
    assert.equal((await s.there.post("/v1/messages", withPdf("m-1"))).status, 200);
    assert.ok(!s.up.received[0]?.body?.messages?.[0]?.content?.some((/** @type {any} */ b) => b.type === "document"), "its own went as its text");
  } finally {
    await s.stop();
  }
});

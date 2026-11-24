// @ts-check
// Your providers' keys copied to another machine from the desk (s3c): POST /api/key-copies answers the desktop app's
// main process alone — this computer's caller that sends the app's press key and the owner key both. The page (the
// press key, no owner key), the command line (the owner key, no press key) and a caller from the network are refused
// in words; the keys named go alone, a coding agent, a key no secret.key here opens and an unknown name refused. The
// machine that takes one keeps where it came from beside it (keyFrom), said in Settings › Providers, until a key typed
// there replaces it. No key reaches a file in the data folder open. Through a real Filament.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FAKE_ACP_AGENT, startApp } from "./helpers/app.js";
import { PRESS_HEADER, setPressKey } from "../src/http/guards.js";
import { OWNER_HEADER, ownerKeyOf } from "../src/services/owner.js";
import { COPY_MOST, COPY_REFUSED } from "../src/http/admin/keys-copy.js";
import { NAME_MAX } from "../src/services/machine.js";

const KEY = randomBytes(32).toString("base64url");
const PRESS = { [PRESS_HEADER]: KEY };
const OPEN = { or: `sk-or-OPEN-${randomBytes(9).toString("hex")}`, ant: `sk-ant-OPEN-${randomBytes(9).toString("hex")}`, mine: `mine-OPEN-${randomBytes(9).toString("hex")}` };

/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {Record<string, string>} */
let BOTH;

before(async () => {
  shim = await startApp({
    configure: (cfg, { dataDir }) => {
      cfg.upstreams.push(
        { id: "coder", name: "coder", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: {}, cwdDefault: dataDir, permissions: "allow-all", hints: false } },
        // Sealed with a secret.key this data folder does not hold.
        { id: "lost", name: "Lost", type: "openai-compatible", baseUrl: "https://lost.example/v1", apiKey: `enc:v1:${randomBytes(40).toString("base64")}` },
        // Its key readable, a header's value sealed with another secret.key.
        { id: "hdr", name: "Hdr", type: "openai-compatible", baseUrl: "https://hdr.example/v1", apiKey: "hdr-key-of-its-own", headers: { "X-Org": `enc:v1:${randomBytes(40).toString("base64")}` } },
      );
    },
  });
  for (const body of [
    { provider: "openrouter", apiKey: OPEN.or, prefix: "or" },
    { provider: "anthropic", apiKey: OPEN.ant, prefix: "ant" },
    { type: "openai-compatible", name: "Mine", baseUrl: "https://mine.example/v1", apiKey: OPEN.mine, prefix: "mine", headers: { "X-Org": "acme" } },
    { type: "openai-compatible", name: "Keyless", baseUrl: "http://127.0.0.1:9/v1", prefix: "keyless" },
  ]) {
    const r = await shim.api("/api/upstreams", { method: "POST", body });
    assert.equal(r.status, 200, await r.text());
  }
  BOTH = { ...PRESS, [OWNER_HEADER]: ownerKeyOf(shim.dataDir) };
  setPressKey(KEY);
});
after(async () => {
  setPressKey("");
  await shim?.stop();
});

/** @param {any} body @param {Record<string, string>} [headers] */
const copy = async (body, headers = BOTH) => {
  const r = await shim.api("/api/key-copies", { method: "POST", body, headers });
  const text = await r.text();
  return { status: r.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })(), store: r.headers.get("cache-control") };
};

// (fails before: yes — s3c: no route answered a provider's key open, to anyone)
test("the app's main process alone: the page (press key alone), the command line (owner key alone), a caller from the network and none of them are refused in words, before a body is read", async () => {
  for (const [who, headers] of /** @type {[string, Record<string, string>][]} */ ([
    ["the page: the press key, no owner key", PRESS],
    ["the command line: the owner key, no press key", { [OWNER_HEADER]: BOTH[OWNER_HEADER] }],
    ["a program here with neither", {}],
    ["a wrong press key with the owner key", { [PRESS_HEADER]: `${KEY}x`, [OWNER_HEADER]: BOTH[OWNER_HEADER] }],
  ])) {
    const r = await copy({ ids: ["or"] }, headers);
    assert.equal(r.status, 403, `${who}: ${r.text}`);
    assert.ok(!r.text.includes(OPEN.or), who);
    if (r.json?.error !== COPY_REFUSED) assert.match(String(r.json?.error), /Filament app/, `${who}: said why`);
  }
  assert.equal((await copy({ ids: ["or"] }, PRESS)).json.error, COPY_REFUSED);
  const far = await copy({ ids: ["or"] }, { ...BOTH, "x-forwarded-for": "100.101.102.103" });
  assert.ok([401, 403].includes(far.status), `a caller from the network: ${far.text}`);
  assert.ok(!far.text.includes(OPEN.or));
  assert.equal((await copy("not json", PRESS)).status, 403, "refused before its body is read");
});

// (fails before: yes — s3c)
test("with both keys: the providers named alone, each as it is set here and its key open, never kept by a cache; a coding agent, a key no secret.key here opens and an unknown name are refused", async () => {
  const r = await copy({ ids: ["mine", "or", "mine"] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.store, "no-store");
  assert.deepEqual(r.json.keys.map((/** @type {any} */ k) => [k.id, k.apiKey]), [["mine", OPEN.mine], ["or", OPEN.or]], "named once each, in its order");
  const [mine, or] = r.json.keys;
  assert.deepEqual([mine.name, mine.type, mine.baseUrl, mine.headers, mine.provider], ["Mine", "openai-compatible", "https://mine.example/v1", { "X-Org": "acme" }, undefined]);
  assert.deepEqual([or.provider, typeof or.plan, or.baseUrl], ["openrouter", "string", "https://openrouter.ai/api/v1"], "a catalogue provider's address says which it is");
  assert.ok(!r.text.includes(OPEN.ant), "a key not named stays here");
  assert.equal((await copy({ ids: ["coder"] })).status, 404, "a coding agent signs in on its machine");
  assert.equal((await copy({ ids: ["nope"] })).status, 404);
  const lost = await copy({ ids: ["lost"] });
  assert.equal(lost.status, 409, lost.text);
  assert.match(lost.json.error, /^Lost has no key here that can be read/);
  const none = await copy({ ids: ["keyless"] });
  assert.equal(none.status, 409, `a provider with no key: ${none.text}`);
  const hdr = await copy({ ids: ["hdr"] });
  assert.equal(hdr.status, 409, `a header no secret.key here opens (the review of s3c): ${hdr.text}`);
  assert.match(hdr.json.error, /^Hdr has a header here whose value cannot be read/);
  assert.ok(!hdr.text.includes("hdr-key-of-its-own"));
  assert.equal((await copy({ ids: [] })).status, 400);
  assert.equal((await copy({ ids: Array.from({ length: COPY_MOST + 1 }, (_, i) => `p${i}`) })).status, 400);
  assert.equal((await copy("not json")).status, 400);
});

// (fails before: yes — s3c: a key had no word of where it came from)
test("a key copied here says where it came from in Settings › Providers until a key set here replaces it; with no key, no word", async () => {
  const add = await shim.api("/api/upstreams", { method: "POST", body: { type: "openai-compatible", name: "Copied", baseUrl: "https://copied.example/v1", apiKey: "copied-OPEN-key", prefix: "copied", keyFrom: "Desk on 2026-11-24" } });
  assert.equal(add.status, 200, await add.text());
  const keyOf = async (/** @type {string} */ id) => (await (await shim.api("/api/upstreams")).json()).upstreams.find((/** @type {any} */ u) => u.id === id)?.key;
  assert.equal((await keyOf("copied")).from, "Desk on 2026-11-24");
  assert.equal((await shim.api("/api/upstreams/copied", { method: "PATCH", body: { hiddenModels: ["x/y"] } })).status, 200);
  assert.equal((await keyOf("copied")).from, "Desk on 2026-11-24", "a change that leaves the key keeps its word");
  assert.equal((await shim.api("/api/upstreams/copied", { method: "PATCH", body: { apiKey: "copied-again-OPEN-key", keyFrom: `Laptop ${"x".repeat(300)}` } })).status, 200);
  assert.equal((await keyOf("copied")).from.length, NAME_MAX, "as long as a machine's name at most");
  assert.equal((await shim.api("/api/upstreams/copied", { method: "PATCH", body: { apiKey: "typed-here-OPEN-key" } })).status, 200);
  assert.equal((await keyOf("copied")).from, undefined, "a key typed here clears it");
  // (the review of s3c) A key changed by the console's save of the whole configuration (its Destinations) clears it too;
  // a save that leaves the key keeps it.
  assert.equal((await shim.api("/api/upstreams/copied", { method: "PATCH", body: { apiKey: "copied-third-OPEN-key", keyFrom: "Desk on 2026-11-24" } })).status, 200);
  const put = async (/** @type {(u: any) => any} */ edit) => {
    const cfg = (await (await shim.api("/api/state")).json()).config;
    const r = await shim.api("/api/config", { method: "PUT", body: { ...cfg, upstreams: cfg.upstreams.map((/** @type {any} */ u) => (u.id === "copied" ? edit(u) : u)) } });
    assert.equal(r.status, 200, await r.text());
  };
  await put((u) => ({ ...u, name: "Copied again" }));
  assert.equal((await keyOf("copied")).from, "Desk on 2026-11-24", "a save that leaves the key keeps it");
  await put((u) => ({ ...u, apiKey: "console-typed-OPEN-key" }));
  assert.equal((await keyOf("copied")).from, undefined, "a key set in the console clears it");
  const bare = await shim.api("/api/upstreams", { method: "POST", body: { type: "openai-compatible", name: "Bare", baseUrl: "https://bare.example/v1", prefix: "bare", keyFrom: "Desk on 2026-11-24" } });
  assert.equal(bare.status, 200, await bare.text());
  assert.equal((await keyOf("bare")).from, undefined, "no key, no word of one");
});

// (fails before: no — it guards that the copy leaves no key open on disk: logs, records, the config)
test("no key open in any file of the data folder once copied", async () => {
  assert.equal((await copy({ ids: ["or", "ant", "mine"] })).status, 200);
  /** @param {string} dir @returns {string[]} */
  const files = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
  for (const f of files(shim.dataDir)) {
    const text = readFileSync(f, "latin1");
    for (const k of Object.values(OPEN)) assert.ok(!text.includes(k), `${f} holds a key open`);
  }
});

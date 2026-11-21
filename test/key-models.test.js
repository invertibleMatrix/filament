// @ts-check
// The owner's of 11-11: a Claude Code account signed in with an Anthropic API key offered only the models Claude Code
// lists itself, though its key could use more (claude-fable-5-2), and the only way to one was "Add a model by name".
// A Refresh — and the first listing — of such an account also asks Anthropic's Models API what the key can use, offers
// what Claude Code's own list lacks, each started as a typed name is, and marks it on the card. The ask fails soft, and
// the key reaches nothing but that address. Every Models endpoint here is a local server of the test's own: no test
// asks Anthropic, and no key here is a real one.
import "./helpers/clean-env.js";
import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AcpBridge } from "../src/acp.js";
import * as keyModelsJs from "../src/adapters/agents/acp/key-models.js";
import { renderHints } from "../src/core/notes.js";

const { keyAccess, keyModels } = keyModelsJs;
import { startApp, fakeUpstream } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");
/** A key of the test's own, in a real one's shape: what must reach the Models endpoint and nothing else. */
const KEY = "sk-ant-api03-TESTONLY-0123456789abcdefghijklmnopqrstuvwxyz";
const KEY_FILE = "sk-ant-api03-TESTONLY-kept-in-the-accounts-folder-0123456789";
const KEY_SETTINGS = "sk-ant-api03-TESTONLY-from-claude-codes-settings-0123456";
/** Claude's adapter's word for an account on a key (claude-agent-acp 0.93): `detail` its source, none for a Console sign-in's. */
const ON_KEY = { kind: "api_key", label: "Anthropic API key" };
const ON_ENV_KEY = { ...ON_KEY, detail: "ANTHROPIC_API_KEY" };
const ON_PLAN = { kind: "account", label: "Claude Max", account: { plan: "max", email: "dev@example.com" } };
/** Anthropic's Models API answer, in two pages: of the four, Claude Code's own list has two under its own names. */
const PAGE_1 = [
  { type: "model", id: "claude-fable-5-2", display_name: "Claude Fable 5.2", created_at: "2026-11-01T00:00:00Z", max_input_tokens: 1000000 },
  { type: "model", id: "claude-opus-5", display_name: "Claude Opus 5", created_at: "2026-06-01T00:00:00Z" },
];
const PAGE_2 = [
  { type: "model", id: "claude-sonnet-5", display_name: "Claude Sonnet 5", created_at: "2026-05-01T00:00:00Z" },
  { type: "model", id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5", created_at: "2026-09-01T00:00:00Z" },
];
/** @param {any[]} data @param {boolean} [more] */
const page = (data, more = false) => ({ json: { data, has_more: more, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null } });
/** @param {{ path: string }} call */
const paged = (call) => (/[?&]after_id=claude-opus-5(&|$)/.test(call.path) ? page(PAGE_2) : page(PAGE_1, true));
const REFUSED = { status: 401, json: { type: "error", error: { type: "authentication_error", message: `invalid x-api-key ${KEY}` } } };
const KEYED_NOTE = "Anthropic lists it for this account's API key; Claude Code does not list it itself";
/** A failed ask's words where it went to an address of the test's own: the host asked, never Anthropic. @param {string} url */
const askedOf = (url) => `The list of the models this account's API key can use, asked of ${new URL(url).host},`;
const OWN_ONLY = "only the models Claude Code lists itself are offered.";
const OWN_LABELS = {
  "opus[1m]": { label: "Opus (1M context)", note: "Opus 5 with 1M context · Best for everyday, complex tasks" },
  sonnet: { label: "Sonnet 5", note: "Sonnet 5 · Efficient for routine tasks" },
};

/** @type {string} */
let dir;
/** The fake under the name of Claude Code's adapter (typed-models.test.js): Filament takes it for Claude Code. @type {string} */
let command;
/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let api;
/** Another address, which must hear nothing. @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let elsewhere;
/** What the Models endpoint answers. @type {(call: any) => any} */
let answer = paged;
let n = 0;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), "filament-key-models-"));
  if (process.platform === "win32") {
    copyFileSync(FAKE, join(dir, "fake-acp-agent.mjs"));
    copyFileSync(join(dirname(FAKE), "person-words.mjs"), join(dir, "person-words.mjs"));
    writeFileSync(join(dir, "claude-agent-acp.cmd"), `@ECHO off\r\nSET dp0=%~dp0\r\n"${process.execPath}" "%dp0%\\fake-acp-agent.mjs" %*\r\n`);
    command = join(dir, "claude-agent-acp.cmd");
  } else {
    writeFileSync(join(dir, "claude-agent-acp"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
    chmodSync(join(dir, "claude-agent-acp"), 0o755);
    command = join(dir, "claude-agent-acp");
  }
  api = await fakeUpstream((call) => answer(call));
  elsewhere = await fakeUpstream(() => page(PAGE_1));
});
after(async () => {
  await api?.close();
  await elsewhere?.close();
  await removeDirs(dir);
});
beforeEach(() => {
  api.reset();
  elsewhere.reset();
  answer = paged;
});

/** An account's folder of its own, empty or with these files: no test reads the person's own Claude Code folder. @param {Record<string, any>} [files] */
const home = (files = {}) => {
  const at = mkdtempSync(join(dir, "home-"));
  for (const [name, json] of Object.entries(files)) writeFileSync(join(at, name), JSON.stringify(json));
  return at;
};
/**
 * A Claude Code account that says it runs as `auth`, its key in its environment unless `env` says otherwise, its
 * Models address the test's endpoint.
 * @param {{ auth?: any, env?: Record<string, string>, files?: Record<string, any>, models?: string[], cmd?: string, id?: string }} [o]
 */
const account = ({ auth = ON_ENV_KEY, env = { ANTHROPIC_API_KEY: KEY }, files = {}, models = [], cmd = command, id = `kc${n++}` } = {}) => ({
  id,
  name: "Claude Code",
  type: "acp",
  models,
  acp: { command: cmd, args: cmd === process.execPath ? [FAKE] : [], env: { FAKE_ACP_CONFIG: "1", FAKE_ACP_ALLOW_LOAD: "1", FAKE_ACP_SETTINGS: "1", FAKE_ACP_AUTH: JSON.stringify(auth), ANTHROPIC_BASE_URL: api.url, ...env }, home: home(files), cwdDefault: dir, permissions: "allow-all", modelSelection: "session" },
});
/** A bridge whose every log line is kept. @returns {{ b: any, lines: string[] }} */
const bridge = () => {
  /** @type {string[]} */
  const lines = [];
  const b = /** @type {any} */ (new AcpBridge(/** @type {any} */ ({ log: (/** @type {any[]} */ ...a) => void lines.push(a.map(String).join(" ")) })));
  return { b, lines };
};
/** What the endpoint heard, each ask's path and the two headers the API reads. */
const heard = (/** @type {typeof api} */ at = api) => at.received.map((c) => [c.path, c.headers["x-api-key"], c.headers["anthropic-version"]]);

describe("a Claude Code account on an Anthropic API key, asked for its models", () => {
  // (fails before: yes — its list was Claude Code's own, and Anthropic was asked nothing)
  test("it offers what Anthropic lists for the key and Claude Code's own list lacks, every page read, and a turn on one runs in a process of its own", async () => {
    const { b } = bridge();
    const up = account();
    try {
      const r = await b.listModels(up, { force: true });
      assert.deepEqual(heard(), [
        ["/v1/models?limit=1000", KEY, "2023-06-01"],
        ["/v1/models?limit=1000&after_id=claude-opus-5", KEY, "2023-06-01"],
      ]);
      // claude-opus-5 and claude-sonnet-5 are its own `opus[1m]` and `sonnet`, as a turn on them finds (`matchOffered`).
      assert.deepEqual(r.names, ["opus[1m]", "sonnet", "claude-fable-5-2", "claude-haiku-5-5"]);
      assert.deepEqual(r.keyed, ["claude-fable-5-2", "claude-haiku-5-5"]);
      assert.deepEqual(r.labels, { ...OWN_LABELS, "claude-fable-5-2": { label: "Claude Fable 5.2", note: KEYED_NOTE }, "claude-haiku-5-5": { label: "Claude Haiku 5.5", note: KEYED_NOTE } });
      assert.deepEqual([r.source, r.keyNote], ["discovered", undefined]);
      /** @type {string[]} */
      const efforts = [];
      const out = await b.run({ upstream: up, modelId: "claude-fable-5-2-xhigh", effort: "xhigh", format: "anthropic", body: { model: "m", max_tokens: 100, messages: [{ role: "user", content: "hello" }] }, conversationId: "K",
        onEvent: (/** @type {any} */ e) => void (e?.type === "step" && e.step === "effort" && efforts.push(String(e.to))) });
      assert.equal(out.structured.find((/** @type {any} */ s) => s.note.kind === "model-not-offered"), undefined, out.notes.join("\n"));
      assert.ok(out.notes.includes("acp: model claude-fable-5-2 (effort xhigh)"), out.notes.join("\n"));
      assert.deepEqual(efforts, ["xhigh"]);
      assert.deepEqual(b.processInfo(up.id)?.models, ["claude-fable-5-2"], "named to Claude Code as a typed name is");
      const own = await b.run({ upstream: up, modelId: "sonnet", format: "anthropic", body: { model: "m", max_tokens: 100, messages: [{ role: "user", content: "hello" }] }, conversationId: "K2" });
      assert.equal(own.structured.find((/** @type {any} */ s) => s.note.kind === "model-not-offered"), undefined);
      assert.deepEqual(b.processInfo(up.id)?.models, ["claude-fable-5-2", "default"], "a model Claude Code lists runs where every listed one does");
      assert.ok(!JSON.stringify([r, out, own]).includes(KEY), "the key in a listing's answer or a turn's record");
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — nothing was asked, so nothing changed with a Refresh)
  test("within the hour its list is the one kept, and a Refresh asks Anthropic again: a model new to the key comes, one gone from it goes", async () => {
    const { b } = bridge();
    const up = account();
    try {
      await b.listModels(up, { force: true });
      const asked = api.received.length;
      const kept = await b.listModels(up);
      assert.deepEqual([kept.source, kept.names, kept.keyed, api.received.length], ["cache", ["opus[1m]", "sonnet", "claude-fable-5-2", "claude-haiku-5-5"], ["claude-fable-5-2", "claude-haiku-5-5"], asked]);
      answer = () => page([{ type: "model", id: "claude-fable-5-2", display_name: "Claude Fable 5.2" }, { type: "model", id: "claude-nova-6", display_name: "Claude Nova 6" }]);
      const again = await b.listModels(up, { force: true });
      assert.equal(api.received.length, asked + 1, "the Refresh asked");
      assert.deepEqual(again.keyed, ["claude-fable-5-2", "claude-nova-6"]);
      assert.deepEqual(again.names, ["opus[1m]", "sonnet", "claude-fable-5-2", "claude-nova-6"]);
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — nothing was asked: there was no line, and nothing to keep)
  test("a refusal leaves Claude Code's own list and says why, the key in none of it; what the key gave before stays", async () => {
    const { b, lines } = bridge();
    const up = account();
    try {
      answer = () => REFUSED;
      const r = await b.listModels(up, { force: true });
      assert.deepEqual([r.names, r.labels, r.source, r.keyed], [["opus[1m]", "sonnet"], OWN_LABELS, "discovered", undefined]);
      assert.equal(r.keyNote, `${askedOf(api.url)} was refused (401 authentication_error): ${OWN_ONLY}`);
      answer = paged;
      assert.deepEqual((await b.listModels(up, { force: true })).keyed, ["claude-fable-5-2", "claude-haiku-5-5"]);
      answer = () => ({ status: 529, json: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } });
      const later = await b.listModels(up, { force: true });
      assert.deepEqual(later.names, ["opus[1m]", "sonnet", "claude-fable-5-2", "claude-haiku-5-5"]);
      assert.deepEqual(later.labels["claude-fable-5-2"], { label: "Claude Fable 5.2", note: KEYED_NOTE });
      assert.equal(later.keyNote, `${askedOf(api.url)} was refused (529 overloaded_error): the 2 it gave before stay.`);
      assert.ok(!JSON.stringify([r, later, lines]).includes(KEY), "the key is in no answer and no log line");
      assert.ok(lines.every((l) => !l.includes("sk-ant")), lines.join("\n"));
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — nothing was asked)
  test("an endpoint that is slow, away, sends elsewhere or answers no list leaves the list standing, each said in a line; a redirect carries the key nowhere", async () => {
    const { b, lines } = bridge();
    try {
      b.keyModelsMs = 200;
      /** @type {(v?: any) => void} */
      let letGo = () => {};
      answer = () => new Promise((resolve) => (letGo = () => resolve(page(PAGE_1))));
      const t0 = Date.now();
      const slow = await b.listModels(account(), { force: true });
      letGo();
      assert.deepEqual([slow.names, slow.keyed], [["opus[1m]", "sonnet"], undefined]);
      assert.equal(slow.keyNote, `${askedOf(api.url)} gave no answer in 0.2 s: ${OWN_ONLY}`);
      assert.ok(Date.now() - t0 < 15_000, "the listing did not wait on it");
      b.keyModelsMs = 5000;
      const closed = await new Promise((resolve) => {
        const s = http.createServer();
        s.listen(0, "127.0.0.1", () => {
          const { port } = /** @type {import("node:net").AddressInfo} */ (s.address());
          s.close(() => resolve(`http://127.0.0.1:${port}`));
        });
      });
      const away = await b.listModels(account({ env: { ANTHROPIC_API_KEY: KEY, ANTHROPIC_BASE_URL: String(closed) } }), { force: true });
      assert.deepEqual([away.names, away.keyNote], [["opus[1m]", "sonnet"], `${askedOf(String(closed))} could not be reached: ${OWN_ONLY}`]);
      answer = () => ({ status: 307, headers: { location: `${elsewhere.url}/v1/models` }, text: "" });
      const sent = await b.listModels(account(), { force: true });
      assert.deepEqual([sent.names, sent.keyNote], [["opus[1m]", "sonnet"], `${askedOf(api.url)} answered with a redirect, which Filament does not follow: ${OWN_ONLY}`]);
      assert.deepEqual(heard(elsewhere), [], "the address it was sent to heard nothing");
      answer = () => ({ json: { hello: "there" } });
      const odd = await b.listModels(account(), { force: true });
      assert.deepEqual([odd.names, odd.keyNote], [["opus[1m]", "sonnet"], `${askedOf(api.url)} could not be read: ${OWN_ONLY}`]);
      assert.ok(!JSON.stringify([slow, away, sent, odd, lines]).includes(KEY));
    } finally {
      b.shutdown();
    }
  });

  // (fails before: no — nothing was asked of anyone; this guards that an account on a plan, one signed out, and an
  // agent that is not Claude Code, are asked nothing whatever key their environment holds)
  test("an account that is not on a key asks nothing, and its list is as ever", async () => {
    const { b } = bridge();
    try {
      for (const auth of [ON_PLAN, { kind: "none", label: "Not logged in" }, { kind: "gateway", label: "Amazon Bedrock" }]) {
        const r = await b.listModels(account({ auth }), { force: true });
        assert.deepEqual(r, { names: ["opus[1m]", "sonnet"], labels: OWN_LABELS, source: "discovered" }, auth.kind);
      }
      const other = await b.listModels(account({ cmd: process.execPath }), { force: true });
      assert.deepEqual(other, { names: ["opus[1m]", "sonnet"], labels: OWN_LABELS, source: "discovered" }, "an agent that is not Claude Code, on a key of its own");
      assert.deepEqual(heard(), []);
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — no key was read, whatever the account ran on)
  test("the key is read where Claude Code reads it — a Console sign-in's in the account's folder — and one a command makes, a token, or one that is not there is not: the card says why", async () => {
    const { b, lines } = bridge();
    try {
      const console_ = await b.listModels(account({ auth: ON_KEY, env: {}, files: { ".claude.json": { primaryApiKey: KEY_FILE, numStartups: 3 } } }), { force: true });
      assert.deepEqual(console_.keyed, ["claude-fable-5-2", "claude-haiku-5-5"]);
      assert.deepEqual(heard().map(([, key]) => key), [KEY_FILE, KEY_FILE]);
      api.reset();
      const notAsked = (/** @type {string} */ why) => `Anthropic was not asked what else this account's API key can use: ${why}.`;
      const rows = /** @type {const} */ ([
        [{ auth: ON_KEY, env: {} }, `the key is not in the account's folder for Filament to read${process.platform === "darwin" ? " (a Mac keeps it in the Keychain)" : ""}`],
        [{ auth: ON_KEY, env: {}, files: { ".claude.json": { numStartups: 3 } } }, `the account's .claude.json holds no key where Claude Code keeps one${process.platform === "darwin" ? " (a Mac keeps it in the Keychain)" : ""}`],
        [{ auth: ON_KEY, env: {}, files: { ".claude.json": [KEY_FILE] } }, "the account's .claude.json is not as Claude Code writes it, so no key is read from it"],
        [{ auth: { ...ON_KEY, detail: "API key helper" } }, "a command makes the key (apiKeyHelper), and Filament does not run it"],
        [{ auth: { ...ON_KEY, detail: "ANTHROPIC_AUTH_TOKEN" }, env: { ANTHROPIC_AUTH_TOKEN: KEY } }, "the key comes from ANTHROPIC_AUTH_TOKEN, which Filament does not read"],
        [{ auth: ON_ENV_KEY, env: {} }, "ANTHROPIC_API_KEY is not in the environment Filament starts Claude Code with"],
        [{ auth: ON_ENV_KEY, env: { ANTHROPIC_API_KEY: KEY, ANTHROPIC_BASE_URL: "file:///etc/passwd" } }, "its ANTHROPIC_BASE_URL is no http address"],
        // Claude Code's own settings name its one model beyond its list over whatever Filament starts it with
        // (claude-agent-acp 0.93 acp-agent.js): no key's model could be named to it.
        [
          { auth: ON_ENV_KEY, files: { "settings.json": { env: { ANTHROPIC_CUSTOM_MODEL_OPTION: "claude-opus-6" } } } },
          'Claude Code\'s own settings (settings.json in the account\'s folder) set ANTHROPIC_CUSTOM_MODEL_OPTION, which Claude Code puts above the variables Filament starts it with, so no other model it does not list can be named to it; take ANTHROPIC_CUSTOM_MODEL_OPTION out of that file\'s "env" to have the key\'s models offered',
        ],
      ]);
      for (const [o, why] of rows) {
        const r = await b.listModels(account(/** @type {any} */ (o)), { force: true });
        assert.equal(r.keyNote, notAsked(why));
        assert.equal(r.keyed, undefined, why);
        assert.deepEqual(r.names.slice(0, 2), ["opus[1m]", "sonnet"], why);
      }
      assert.deepEqual(heard(), [], "none of them was asked for");
      assert.ok(!JSON.stringify(lines).includes("sk-ant"), lines.join("\n"));
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — no address was read)
  test("the key goes to the address Claude Code calls: the person's own settings' ANTHROPIC_BASE_URL and key over its environment's, never a project's", async () => {
    const { b } = bridge();
    try {
      const up = account({ env: { ANTHROPIC_API_KEY: KEY, ANTHROPIC_BASE_URL: elsewhere.url }, files: { "settings.json": { env: { ANTHROPIC_BASE_URL: `${api.url}/`, ANTHROPIC_API_KEY: KEY_SETTINGS } } } });
      // The folder its sessions open in brings settings of its own, which name another address: not read.
      const project = mkdtempSync(join(dir, "project-"));
      mkdirSync(join(project, ".claude"));
      writeFileSync(join(project, ".claude", "settings.json"), JSON.stringify({ env: { ANTHROPIC_BASE_URL: elsewhere.url } }));
      writeFileSync(join(project, ".claude", "settings.local.json"), JSON.stringify({ env: { ANTHROPIC_BASE_URL: elsewhere.url } }));
      up.acp.cwdDefault = project;
      const r = await b.listModels(up, { force: true });
      assert.deepEqual(r.keyed, ["claude-fable-5-2", "claude-haiku-5-5"]);
      assert.deepEqual(heard().map(([path, key]) => [path, key]), [["/v1/models?limit=1000", KEY_SETTINGS], ["/v1/models?limit=1000&after_id=claude-opus-5", KEY_SETTINGS]]);
      assert.deepEqual(heard(elsewhere), [], "the environment's address, which the settings replace, and the project's heard nothing");
    } finally {
      b.shutdown();
    }
  });

  // The owner's of 11-11: the owner's own card sets ANTHROPIC_CUSTOM_MODEL_OPTION, and its Refresh said Anthropic was not
  // asked. The card's value stays the model of the process every listed one runs in; a key's model is the more specific
  // word, and runs in a process of its own that Filament starts with the variable naming it.
  // (fails before: yes — "Anthropic was not asked …: the account's own ANTHROPIC_CUSTOM_MODEL_OPTION holds the one place")
  test("a card that sets ANTHROPIC_CUSTOM_MODEL_OPTION is asked all the same: a key's model runs in its own process, named by it; the card's own, picked, in the shared one", async () => {
    const { b } = bridge();
    const up = account({ env: { ANTHROPIC_API_KEY: KEY, ANTHROPIC_CUSTOM_MODEL_OPTION: "claude-opus-6" } });
    try {
      const r = await b.listModels(up, { force: true });
      assert.equal(r.keyNote, undefined, r.keyNote);
      assert.deepEqual(heard().map(([path]) => path), ["/v1/models?limit=1000", "/v1/models?limit=1000&after_id=claude-opus-5"]);
      assert.deepEqual(r.names, ["opus[1m]", "sonnet", "claude-opus-6", "claude-fable-5-2", "claude-haiku-5-5"], "Claude Code's own, the card's among them, then the key's");
      assert.deepEqual(r.keyed, ["claude-fable-5-2", "claude-haiku-5-5"]);
      const body = { model: "m", max_tokens: 100, messages: [{ role: "user", content: "hello" }] };
      const keyed = await b.run({ upstream: up, modelId: "claude-fable-5-2", format: "anthropic", body, conversationId: "C1" });
      assert.equal(keyed.structured.find((/** @type {any} */ s) => s.note.kind === "model-not-offered"), undefined, keyed.notes.join("\n"));
      assert.ok(keyed.notes.includes("acp: model claude-fable-5-2"), keyed.notes.join("\n"));
      assert.deepEqual(b.processInfo(up.id)?.models, ["claude-fable-5-2"], "a process of its own, named by it");
      const own = await b.run({ upstream: up, modelId: "claude-opus-6", format: "anthropic", body, conversationId: "C2" });
      assert.equal(own.structured.find((/** @type {any} */ s) => s.note.kind === "model-not-offered"), undefined, own.notes.join("\n"));
      assert.ok(own.notes.includes("acp: model claude-opus-6"), own.notes.join("\n"));
      assert.deepEqual(b.processInfo(up.id)?.models, ["claude-fable-5-2", "default"], "the card's own runs in the shared process, which keeps it");
    } finally {
      b.shutdown();
    }
  });

  // The owner's of 11-11: a key's model, picked, that Claude Code then does not take — here its own settings name
  // another, after the key's list was kept — was said only with the agent's hints on.
  // (fails before: yes — the note had no `keyed`: not always said)
  test("a key's model that Claude Code still does not offer is always said, by its name and where it came from", async () => {
    const { b } = bridge();
    const up = account({ files: { "settings.json": { env: { ANTHROPIC_CUSTOM_MODEL_OPTION: "claude-opus-6" } } } });
    try {
      b.keyedOf = (/** @type {string} */ id) => (id === up.id ? { names: ["claude-fable-5-2"], labels: {} } : null);
      const out = await b.run({ upstream: up, modelId: "claude-fable-5-2-high", effort: "high", format: "anthropic", body: { model: "m", max_tokens: 100, messages: [{ role: "user", content: "hello" }] }, conversationId: "D" });
      const note = out.structured.find((/** @type {any} */ s) => s.note.kind === "model-not-offered")?.note;
      assert.deepEqual(note, { kind: "model-not-offered", model: "claude-fable-5-2", offers: ["default", "opus[1m]", "sonnet", "claude-opus-6"], keeping: "default", keyed: true }, out.notes.join("\n"));
      const [said] = renderHints(/** @type {any} */ (note), { agentName: "Claude Code", firstTurn: false });
      assert.equal(said.mustSay, true);
      assert.ok(out.notes.includes("acp: model claude-fable-5-2 (from the account's API key) not offered by this agent (offers default, opus[1m], sonnet, claude-opus-6); keeping default"), out.notes.join("\n"));
    } finally {
      b.shutdown();
    }
  });

  // (fails before: yes — a bridge started afresh knew of no such names: the turn ran where every listed model does,
  // "not offered by this agent")
  test("after a restart a turn on one still runs in a process of its own, by the names the server kept", async () => {
    const { b } = bridge();
    const up = account();
    try {
      b.keyedOf = (/** @type {string} */ id) => (id === up.id ? { names: ["claude-fable-5-2"], labels: {} } : null);
      const out = await b.run({ upstream: up, modelId: "claude-fable-5-2-high", effort: "high", format: "anthropic", body: { model: "m", max_tokens: 100, messages: [{ role: "user", content: "hello" }] }, conversationId: "R" });
      assert.equal(out.structured.find((/** @type {any} */ s) => s.note.kind === "model-not-offered"), undefined, out.notes.join("\n"));
      assert.ok(out.notes.includes("acp: model claude-fable-5-2 (effort high)"), out.notes.join("\n"));
      assert.deepEqual(b.processInfo(up.id)?.models, ["claude-fable-5-2"]);
      assert.deepEqual(heard(), [], "a turn asks Anthropic's list nothing");
    } finally {
      b.shutdown();
    }
  });
});

describe("the ask itself", () => {
  // (fails before: yes — there was no such ask)
  test("keyModels reads every page with the key in its header, and says a failure by its status and type, never its body", async () => {
    assert.deepEqual(await keyModels({ key: KEY, base: api.url }), { models: [{ id: "claude-fable-5-2", name: "Claude Fable 5.2" }, { id: "claude-opus-5", name: "Claude Opus 5" }, { id: "claude-sonnet-5", name: "Claude Sonnet 5" }, { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" }] });
    assert.deepEqual(heard().map(([path]) => path), ["/v1/models?limit=1000", "/v1/models?limit=1000&after_id=claude-opus-5"]);
    answer = () => REFUSED;
    assert.deepEqual(await keyModels({ key: KEY, base: api.url }), { failed: "was refused (401 authentication_error)" });
    answer = () => ({ status: 500, text: `<html>${KEY}</html>` });
    assert.deepEqual(await keyModels({ key: KEY, base: api.url }), { failed: "was refused (500)" });
    answer = () => ({ status: 403, json: { error: { type: `Permission denied for ${KEY}` } } });
    assert.deepEqual(await keyModels({ key: KEY, base: api.url }), { failed: "was refused (403)" }, "a type that is no plain word of the API's is not said");
    // A listing that says there is more without end is read no further than its page limit.
    api.reset();
    answer = () => page([{ id: "claude-a" }], true);
    assert.deepEqual(await keyModels({ key: KEY, base: api.url }), { models: [{ id: "claude-a", name: "" }] });
    assert.equal(api.received.length, 20);
  });

  // (fails before: yes — there was no such reading)
  test("keyAccess: only an account on a key, its key by the source the adapter names, its address Claude Code's own", () => {
    const up = { id: "cc", acp: { command: "claude-agent-acp", env: {} } };
    /** @param {Record<string, string>} files */
    const read = (files) => (/** @type {string} */ file) => {
      const hit = Object.entries(files).find(([name]) => file.replace(/\\/g, "/").endsWith(name));
      if (!hit) throw new Error("ENOENT");
      return hit[1];
    };
    const env = { CLAUDE_CONFIG_DIR: "/acct", ANTHROPIC_API_KEY: ` ${KEY}\n` };
    assert.equal(keyAccess(up, null, { env, read: read({}) }), null);
    assert.equal(keyAccess(up, { kind: "account" }, { env, read: read({}) }), null);
    assert.equal(keyAccess(up, { kind: "gateway" }, { env, read: read({}) }), null);
    assert.deepEqual(keyAccess(up, { kind: "api-key", detail: "ANTHROPIC_API_KEY" }, { env, read: read({}) }), { key: KEY, base: "https://api.anthropic.com" });
    assert.deepEqual(keyAccess(up, { kind: "api-key", detail: "ANTHROPIC_API_KEY" }, { env: { anthropic_api_key: KEY, Anthropic_Base_Url: "http://127.0.0.1:9/" }, read: read({}), platform: "win32" }), { key: KEY, base: "http://127.0.0.1:9" }, "Windows names its variables in any case");
    assert.deepEqual(keyAccess(up, { kind: "api-key", detail: "ANTHROPIC_API_KEY" }, { env: { anthropic_api_key: KEY }, read: read({}), platform: "linux" }), { why: "ANTHROPIC_API_KEY is not in the environment Filament starts Claude Code with" });
    assert.deepEqual(keyAccess(up, { kind: "api-key", detail: null }, { env, read: read({ "/acct/.claude.json": JSON.stringify({ primaryApiKey: KEY_FILE }) }) }), { key: KEY_FILE, base: "https://api.anthropic.com" }, "a Console sign-in's key, not the environment's");
    assert.deepEqual(keyAccess(up, { kind: "api-key", detail: null }, { env, read: read({}), platform: "darwin" }), { why: "the key is not in the account's folder for Filament to read (a Mac keeps it in the Keychain)" });
    // A .claude.json not as Claude Code writes it gives no key, and says so: never a throw.
    const shapes = /** @type {[string, string][]} */ ([
      ["{ not json", "the account's .claude.json is not as Claude Code writes it, so no key is read from it"],
      ["null", "the account's .claude.json is not as Claude Code writes it, so no key is read from it"],
      [JSON.stringify([KEY_FILE]), "the account's .claude.json is not as Claude Code writes it, so no key is read from it"],
      [JSON.stringify({ primaryApiKey: 42 }), "the account's .claude.json holds no key where Claude Code keeps one"],
      [JSON.stringify({ primaryApiKey: { key: KEY_FILE } }), "the account's .claude.json holds no key where Claude Code keeps one"],
      [JSON.stringify({ primaryApiKey: "   " }), "the account's .claude.json holds no key where Claude Code keeps one"],
    ]);
    for (const [kept, why] of shapes) assert.deepEqual(keyAccess(up, { kind: "api-key", detail: null }, { env, read: read({ "/acct/.claude.json": kept }), platform: "linux" }), { why }, kept);
    assert.deepEqual(keyAccess(up, { kind: "api-key", detail: null }, { env, read: read({ "/acct/.claude.json": "{}" }), platform: "darwin" }), { why: "the account's .claude.json holds no key where Claude Code keeps one (a Mac keeps it in the Keychain)" });
    assert.deepEqual(keyAccess(up, { kind: "api-key", detail: "apiKeyHelper" }, { env, read: read({}) }), { why: "a command makes the key (apiKeyHelper), and Filament does not run it" });
    assert.deepEqual(keyAccess(up, { kind: "api-key", detail: "env" }, { env, read: read({}) }), { why: "the key comes from env, which Filament does not read" });
    // The person's own Claude Code settings over the environment's; a project's settings, which a folder brings with
    // it, say nothing of where a key goes.
    const files = { ".claude/settings.json": JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://evil.example" } }), ".claude/settings.local.json": JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://evil.example" } }), "/acct/settings.json": JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://gate.example/anthropic/", ANTHROPIC_API_KEY: KEY_SETTINGS } }) };
    assert.deepEqual(keyAccess(up, { kind: "api-key", detail: "ANTHROPIC_API_KEY" }, { env, read: read(files) }), { key: KEY_SETTINGS, base: "https://gate.example/anthropic" });
    for (const bad of ["ftp://x.example", "not a url", `https://user:${KEY}@x.example`])
      assert.deepEqual(keyAccess(up, { kind: "api-key", detail: "ANTHROPIC_API_KEY" }, { env: { ...env, ANTHROPIC_BASE_URL: bad }, read: read({}) }), { why: "its ANTHROPIC_BASE_URL is no http address" }, bad);
  });
});

describe("whose list a failure names", () => {
  // The review of 11-11: a failure said "Anthropic's list" of an ask that went to the account's own gateway.
  // (fails before: yes — there were no such words: every failure said Anthropic's)
  test("Anthropic's at its own address; elsewhere, the host asked — never its path, its query or a credential", () => {
    const { keyListWords } = /** @type {any} */ (keyModelsJs);
    assert.equal(typeof keyListWords, "function", "key-models.js has no keyListWords");
    const anthropic = "Anthropic's list of the models this account's API key can use";
    assert.equal(keyListWords("https://api.anthropic.com"), anthropic);
    assert.equal(keyListWords("https://api.anthropic.com:443/"), anthropic);
    assert.equal(keyListWords("https://gate.example:8443/anthropic/v1?team=7#x"), "The list of the models this account's API key can use, asked of gate.example:8443,");
    assert.equal(keyListWords(`https://user:${KEY}@gate.example/anthropic`), "The list of the models this account's API key can use, asked of gate.example,");
    assert.equal(keyListWords("http://127.0.0.1:9"), "The list of the models this account's API key can use, asked of 127.0.0.1:9,");
    assert.equal(keyListWords("not an address"), "The list of the models this account's API key can use", "never a throw");
  });
});

describe("through the app: Refresh on the account, its card's rows, and what is kept", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let dataDir;
  /** @type {any} */
  let acct;
  /** The app with one Claude Code account on a Console sign-in's key, kept in its folder alone; `reuse`: started again on the folder it left. @param {string} [reuse] */
  const start = async (reuse) => {
    acct ||= account({ auth: ON_KEY, env: {}, files: { ".claude.json": { primaryApiKey: KEY_FILE } }, id: "cc" });
    shim = await startApp({
      ...(reuse ? { dataDir: reuse } : {}),
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ ...acct, enabled: true }];
        cfg.routes = [{ match: "cc/*", upstream: "cc", upstreamModel: "{1}", enabled: true }];
      },
    });
    dataDir = shim.dataDir;
  };
  /** Every file under a folder, as text. @param {string} at @returns {[string, string][]} */
  const files = (at) => readdirSync(at).flatMap((name) => {
    const file = join(at, name);
    return statSync(file).isDirectory() ? files(file) : [[file, readFileSync(file, "latin1")]];
  });
  after(async () => {
    await shim?.stop();
    if (dataDir) await removeDirs(dataDir);
  });

  // (fails before: yes — the answer listed Claude Code's own two, and nothing said a key could use more)
  test("Refresh offers the key's models in every picker, apart from Claude Code's own list; the key is in no answer and no file, and a restart keeps them", async () => {
    await start();
    const before = await (await shim.api("/api/models")).json();
    assert.deepEqual([before.upstreams.cc?.listed, before.upstreams.cc?.keyed, api.received.length], [undefined, undefined, 0], "a read asks nobody");
    const res = await shim.api("/api/models?refresh=1");
    const text = await res.text();
    const got = JSON.parse(text);
    assert.deepEqual(heard().map(([, key]) => key), [KEY_FILE, KEY_FILE]);
    assert.deepEqual(got.upstreams.cc.listed, ["opus[1m]", "sonnet"], "Claude Code's own list, apart");
    assert.deepEqual(got.upstreams.cc.keyed, ["claude-fable-5-2", "claude-haiku-5-5"]);
    assert.equal(got.upstreams.cc.keyNote, undefined);
    const row = got.models.find((/** @type {any} */ m) => m.id === "cc/claude-fable-5-2");
    assert.deepEqual([row?.upstreamModel, row?.label, row?.note, row?.codingAgent], ["claude-fable-5-2", "Claude Fable 5.2", KEYED_NOTE, true]);
    assert.ok(got.families.some((/** @type {any} */ f) => f.members.some((/** @type {any} */ x) => x.id === "cc/claude-fable-5-2")), "the harness's picker offers it");
    const accounts = (await (await shim.api("/api/agent-accounts")).json()).agents;
    assert.deepEqual(accounts.find((/** @type {any} */ a) => a.upstream === "cc")?.keyModels, { names: ["claude-fable-5-2", "claude-haiku-5-5"], note: null }, "the account's row says them");
    // The key: in no answer of a route a page reads, and in no file Filament keeps.
    const answers = [text];
    for (const path of ["/api/config", "/api/agent-accounts", "/api/requests?limit=50", "/api/ops?limit=200", "/api/logs?limit=500", "/v1/models"]) answers.push(await (await shim.api(path)).text());
    assert.ok(answers.every((a) => !a.includes(KEY_FILE)), "the key in a route's answer");
    await shim.stop();
    const kept = files(dataDir);
    assert.ok(kept.length > 0 && kept.every(([, body]) => !body.includes(KEY_FILE)), `the key in a kept file: ${kept.filter(([, body]) => body.includes(KEY_FILE)).map(([f]) => f).join(", ")}`);
    assert.deepEqual(JSON.parse(readFileSync(join(dataDir, "models-cache.json"), "utf8")).local.cc.keyed, ["claude-fable-5-2", "claude-haiku-5-5"]);
    api.reset();
    await start(dataDir);
    const again = await (await shim.api("/api/models")).json();
    assert.deepEqual([again.upstreams.cc.listed, again.upstreams.cc.keyed, api.received.length], [["opus[1m]", "sonnet"], ["claude-fable-5-2", "claude-haiku-5-5"], 0], "kept across the restart, nobody asked");
    assert.ok(again.models.some((/** @type {any} */ m) => m.id === "cc/claude-fable-5-2"));
    // A chat's turn on one, in the app started afresh: named to Claude Code in a process of its own before anything is
    // listed again, and its record holds no key.
    const turned = await shim.post("/v1/messages", { model: "cc/claude-fable-5-2", max_tokens: 100, system: `Working directory: ${dir}`, messages: [{ role: "user", content: "hello" }] }, { "x-session-id": "key-chat" });
    const said = await turned.text();
    assert.equal(turned.status, 200, said);
    const record = JSON.stringify(await shim.record(String(turned.headers.get("x-filament-request-id"))));
    assert.ok(record.includes('"acp: model claude-fable-5-2"') && !record.includes("not offered"), record.slice(0, 3000));
    assert.ok(![said, record, await (await shim.api("/api/requests?limit=50")).text()].some((t) => t.includes(KEY_FILE)), "the key in a turn's answer or record");
    assert.equal(api.received.length, 0, "a turn asks Anthropic's list nothing");
  });

  // (fails before: yes — no line: nothing was asked)
  test("a Refresh the API refuses keeps the list and says why on the account; the next one that answers takes the line away", async () => {
    answer = () => REFUSED;
    const refused = await (await shim.api("/api/models?refresh=1")).json();
    assert.deepEqual(refused.upstreams.cc.listed, ["opus[1m]", "sonnet"]);
    assert.deepEqual(refused.upstreams.cc.keyed, ["claude-fable-5-2", "claude-haiku-5-5"], "what the key gave before stays");
    assert.equal(refused.upstreams.cc.keyNote, `${askedOf(api.url)} was refused (401 authentication_error): the 2 it gave before stay.`);
    assert.equal(refused.upstreams.cc.error, undefined, "Claude Code listed its models: the account's list has no error");
    const row = (await (await shim.api("/api/agent-accounts")).json()).agents.find((/** @type {any} */ a) => a.upstream === "cc");
    assert.deepEqual(row.keyModels, { names: ["claude-fable-5-2", "claude-haiku-5-5"], note: refused.upstreams.cc.keyNote });
    answer = paged;
    const fine = await (await shim.api("/api/models?refresh=1")).json();
    assert.deepEqual([fine.upstreams.cc.keyed, fine.upstreams.cc.keyNote], [["claude-fable-5-2", "claude-haiku-5-5"], undefined]);
  });
});

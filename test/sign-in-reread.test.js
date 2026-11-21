// @ts-check
// The re-read of the coding agents' sign-in (the Fable 5.2 re-read of 11-11, its findings 4, 14 and 15), each a trace in
// code confirmed here before its fix. A key an agent reads from a variable was kept before anything checked it: one its
// agent then called nobody's stayed in the account's environment, in place of the key before it; where nothing could
// tell, the sign-in ended "signed in"; and an agent with no sign-out of its own kept the key for good. The command
// line's sign-in offered the page that comes back to Filament's computer first over SSH, held the server's moments
// against its own clock, and said nothing shows where a star does. Two sign-ins asked for at once both started, the
// first one's 15 minutes left running to end whichever sign-in waited then. And one found after it: a key kept in the
// place of one that worked, which nothing checked, left the account saying who the key before it signed in.
// Through the whole app against the fake agents; the logins over stand-ins, one step at a time; and the command line
// over a Filament of the test's own. Every key here is made up, and one kept is read through the configuration alone.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";

import { BROWSER_WAIT_MS, createAgentLogins } from "../src/app/agent-logins.js";
import { createAgentAccounts } from "../src/services/agent-accounts.js";
import { EXIT } from "../src/cli/client.js";
import { writeListening } from "../src/cli/listening.js";
import { runCli } from "../src/cli/main.js";
import { startApp, FAKE_ACP_AGENT, FIXTURES } from "./helpers/app.js";
import { removeDirs, scaledMs, until } from "./helpers/wait.js";

const FAKE_CODEX = join(FIXTURES, "fake-codex-app-server.mjs");
/** The variable the fake reads its key from, and the way that names it. */
const VAR = "FAKE_AGENT_API_KEY";
const KEY_WAY = JSON.stringify([{ type: "env_var", id: "fake-key", name: "Fake API key", description: "A key from the fake's dashboard", vars: [{ name: VAR, label: "Your Fake API key" }] }]);
/** A way the fake carries out itself. */
const OWN_WAY = JSON.stringify([{ id: "browser-login", name: "Log in", description: "Log in with your account, in your browser" }]);
/** Made-up keys: the one the picky fakes take, and others. */
const GOOD = "fk-good-0123456789abcdef";
const WRONG = "fk-wrong-0123456789abcdef";
const OTHER = "fk-other-0123456789abcdef";
const FIRST = "fk-first-0123456789abcdef";
const TYPED = "fk-typed-0123456789abcdef";
const KEYS = [GOOD, WRONG, OTHER, FIRST, TYPED];

/** Every reaction already set off has run. */
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};

/**
 * Every line the app's log says while the tests run, kept instead of printed: its undo given back.
 * @param {string[]} into @returns {() => void}
 */
const hear = (into) => {
  const was = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of /** @type {const} */ (["log", "info", "warn", "error", "debug"])) console[k] = (...args) => void into.push(args.map(String).join(" "));
  return () => Object.assign(console, was);
};

/**
 * A command run as a script runs it: no terminal, stdin `piped`.
 * @param {string} dataDir @param {string[]} argv @param {string} [piped]
 */
const runAt = async (dataDir, argv, piped = "") => {
  /** @type {{ out: string[], err: string[] }} */
  const said = { out: [], err: [] };
  const term = /** @type {any} */ ({ input: Readable.from(piped ? [piped] : []), output: new PassThrough(), tty: false });
  const code = await runCli(argv, { dataDir, term, out: (s) => said.out.push(s), err: (s) => said.err.push(s) });
  return { code, ...said };
};

describe("the re-read's findings 4 and 15, and 14's ways: through the app, against the fake agents", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  /** @type {string[]} */
  const lines = [];
  let restore = () => {};
  /** Every answer a test was given, for the last test: none says a key. @type {any[]} */
  const answers = [];
  /** Each reading of an agent's sign-in: whether the account it was read for held a key under its variable — never the key. @type {Record<string, boolean[]>} */
  const readWith = {};
  /** What an agent was asked, as its calls file says. @param {string} id @returns {any[]} */
  const callsOf = (id) => {
    const f = join(root, `${id}.calls.jsonl`);
    return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
  /** The file whose coming lets Gated say who it runs as. */
  const gate = () => join(root, "gated.gate");
  /** Whether a process is still there. @param {number} pid */
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-sign-in-reread-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    mkdirSync(join(root, "codex-home"));
    /** A fake agent of ACP's registry. @param {string} id @param {string} name @param {Record<string, string>} env */
    const fake = (id, name, env) => ({
      id,
      name,
      type: "acp",
      acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(root, `${id}.calls.jsonl`), ...env }, cwdDefault: projDir, permissions: "allow-all", hints: false, authenticate: false },
    });
    /** One that reads its key from a variable. @param {string} id @param {string} name @param {Record<string, string>} [env] */
    const keyed = (id, name, env = {}) => fake(id, name, { FAKE_ACP_AUTH_METHODS: KEY_WAY, FAKE_ACP_KEY_VAR: VAR, ...env });
    restore = hear(lines);
    shim = await startApp({
      // An agent's CLI and files can't tell, as in every test; what they were read for is kept.
      overrides: {
        signInOf: async (/** @type {any} */ u) => {
          (readWith[u.id] ||= []).push(!!u.acp?.env?.[VAR]);
          return { signedIn: null, identity: null };
        },
      },
      configure: (cfg) => {
        cfg.server.logLevel = "debug";
        cfg.upstreams = [
          // Says nothing of who it runs as, and has no sign-out of its own: nothing here can check its key.
          keyed("keyed", "Keyed"),
          keyed("keyed-cli", "Keyed Cli"),
          // Says who it runs as: its key's owner with the one key it takes, nobody with any other.
          keyed("picky", "Picky", { FAKE_ACP_KEY_TAKES: GOOD }),
          // The same, saying it once the test lets it: its check waits meanwhile.
          keyed("gated", "Gated", { FAKE_ACP_KEY_TAKES: GOOD, FAKE_ACP_AUTH_GATE: join(root, "gated.gate") }),
          // The same again: the one test of it lets it speak only once its sign-in has ended.
          keyed("slow", "Slow", { FAKE_ACP_KEY_TAKES: GOOD, FAKE_ACP_AUTH_GATE: join(root, "slow.gate") }),
          // Signs in itself, a moment after it is asked.
          fake("twice", "Twice", { FAKE_ACP_AUTH_METHODS: OWN_WAY, FAKE_ACP_SIGNED_IN: join(root, "twice.signed-in"), FAKE_ACP_AUTHENTICATE_MS: "300" }),
          { id: "cx", name: "Codex", type: "codex", acp: { command: process.execPath, args: [FAKE_CODEX], env: { FAKE_CODEX_SIGNED_OUT: "home", CODEX_HOME: join(root, "codex-home") }, cwdDefault: projDir, permissions: "allow-all" } },
        ];
        cfg.routes = cfg.upstreams.map((/** @type {any} */ u) => ({ match: `${u.id}/*`, upstream: u.id, upstreamModel: "{1}", enabled: true }));
      },
    });
  });
  after(async () => {
    writeFileSync(gate(), "");
    await shim?.stop();
    restore();
    await removeDirs(root);
  });

  /** @param {string} id */
  const row = async (id) => (await (await shim.api("/api/agent-accounts")).json()).agents.find((/** @type {any} */ r) => r.upstream === id);
  /** @param {string} method @param {string} path @param {unknown} [body] */
  const call = async (method, path, body) => {
    const res = await shim.api(`/api/agent-accounts${path}`, { method, body });
    const out = { status: res.status, ...(await res.json()) };
    answers.push(out);
    return out;
  };
  /** The account's row once its sign-in ended. @param {string} id */
  const ended = (id) =>
    until(async () => {
      const r = await row(id);
      return r?.lastSignIn && !r.signingIn ? r : null;
    }, `${id}'s sign-in to end`, { timeoutMs: 20_000 });
  /** @param {string} model */
  const turn = async (model) => {
    const res = await shim.post("/v1/messages", { model, max_tokens: 100, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "hello" }] });
    const body = await res.text();
    return { status: res.status, error: res.status === 200 ? undefined : String(JSON.parse(body)?.error?.message) };
  };
  /** The key an account keeps under its variable, as the configuration holds it. @param {string} id */
  const keptKey = (id) => shim.app.config.upstreams.find((/** @type {any} */ u) => u.id === id)?.acp?.env?.[VAR];

  // (fails before: yes — finding 4: the sign-in ended "signed-in", and the account was kept as someone signed in on the
  // sign-in's own word, where nothing had tried the key)
  test("a key nothing here can check — its agent says nothing of who it runs as — is kept, and its end says that: never that someone is signed in", async () => {
    const before = await turn("keyed/fake-a");
    assert.notEqual(before.status, 200, "no key yet: its turn is refused");
    const r = await call("POST", "/keyed/sign-in", { way: "fake-key", key: FIRST });
    assert.equal(r.status, 200, r.error);
    const done = await ended("keyed");
    assert.deepEqual([done.lastSignIn.outcome, done.lastSignIn.error], ["key-kept", null]);
    assert.notEqual(done.account?.identitySource, "sign-in", "the sign-in itself is no word that someone is signed in");
    assert.deepEqual([keptKey("keyed"), done.keyKept, done.signsOut], [FIRST, true, false], "kept under its variable; its agent has no sign-out of its own");
    const served = await turn("keyed/fake-a");
    assert.equal(served.status, 200, served.error);
    const now = await until(async () => {
      const x = await row("keyed");
      return x.account?.identitySource === "turn" ? x : null;
    }, "the turn it served to say someone is signed in");
    assert.equal(now.account.signedOut, false);
  });

  // (fails before: yes — finding 4: 400 "this agent has no sign-out of its own: sign out in its own CLI", the key left
  // in the account's environment with nothing on the page or the command line to take it out)
  test("Sign out forgets the key, though its agent has no sign-out of its own: its variable goes, and its next process starts without it", async () => {
    assert.equal(keptKey("keyed"), FIRST);
    const out = await call("POST", "/keyed/sign-out");
    assert.equal(out.status, 200, out.error);
    assert.equal(readWith.keyed?.at(-1), false, "who is signed in is read as the account is left: without the key that went");
    assert.equal(keptKey("keyed"), undefined, "nothing kept under its variable");
    assert.deepEqual([out.agent.keyKept, out.agent.lastSignIn.outcome, out.agent.account?.signedOut], [false, "signed-out", true]);
    const refused = await turn("keyed/fake-a");
    assert.notEqual(refused.status, 200);
    assert.deepEqual(callsOf("keyed").filter((c) => c.method === "start").map((c) => c.keyed).slice(-1), [false], "started without it");
    const again = await call("POST", "/keyed/sign-out");
    assert.deepEqual([again.status, again.error], [400, "this agent has no sign-out of its own: sign out in its own CLI"], "with no key kept, there is nothing of Filament's to forget");
  });

  // (fails before: yes — finding 4: the key its agent called nobody's stayed under its variable — with none before it,
  // and in place of the one that worked)
  test("a key its agent calls nobody's fails the sign-in and is not kept: none stays where none was, and the key before it is put back", async () => {
    const none = await call("POST", "/picky/sign-in", { way: "fake-key", key: WRONG });
    assert.equal(none.status, 200, none.error);
    const failed = await ended("picky");
    assert.deepEqual([failed.lastSignIn.outcome, failed.lastSignIn.error], ["failed", "the sign-in ended, but Picky says nobody is signed in"]);
    assert.deepEqual([keptKey("picky"), failed.keyKept], [undefined, false], "the key it refused is gone");
    const good = await call("POST", "/picky/sign-in", { way: "fake-key", key: GOOD });
    assert.equal(good.status, 200, good.error);
    const signedIn = await ended("picky");
    assert.deepEqual([signedIn.lastSignIn.outcome, signedIn.account?.identity?.label, keptKey("picky")], ["signed-in", "Fake API key", GOOD]);
    const over = await call("POST", "/picky/sign-in", { way: "fake-key", key: WRONG });
    assert.equal(over.status, 200, over.error);
    const back = await ended("picky");
    assert.deepEqual([back.lastSignIn.outcome, back.lastSignIn.error], ["failed", "the sign-in ended, but Picky says nobody is signed in"]);
    assert.equal(keptKey("picky"), GOOD, "the key that worked is back under its variable");
    // What its agent said of the key that went is not left standing: asked again, it runs as the key put back.
    await until(async () => (await row("picky")).account?.identity?.label === "Fake API key", "Picky to say who it runs as with the key put back");
    const served = await turn("picky/fake-a");
    assert.equal(served.status, 200, served.error);
    const out = await call("POST", "/picky/sign-out");
    assert.equal(out.status, 200, out.error);
    assert.deepEqual([keptKey("picky"), out.agent.account?.signedOut], [undefined, true], "signed out: no key, and its agent says nobody");
  });

  // (fails before: yes — finding 4: its agent, asked who it runs as, said nothing in the eight seconds it is given, and
  // the sign-in ended "signed-in" on no word at all)
  test("a key its agent says nothing of in time — one that says who it runs as — is kept, and its end says that; its word, late, then stands", async () => {
    const r = await call("POST", "/slow/sign-in", { way: "fake-key", key: GOOD });
    assert.equal(r.status, 200, r.error);
    const done = await ended("slow");
    assert.deepEqual([done.lastSignIn.outcome, done.lastSignIn.error, done.account?.identity ?? null, keptKey("slow")], ["key-kept", null, null, GOOD]);
    writeFileSync(join(root, "slow.gate"), "");
    await until(async () => (await row("slow")).account?.identity?.label === "Fake API key", "Slow to say who it runs as");
  });

  // (fails before: yes — finding 15, a key's case: the second key took the first one's place while the first was being
  // checked, both sign-ins going on; and nothing said a key was being checked)
  test("while a key is checked, its sign-in is under way: a second key is refused in words, one asked for with none gets the one under way; Cancel takes the key out again", async () => {
    try {
      const first = await call("POST", "/gated/sign-in", { way: "fake-key", key: GOOD });
      assert.equal(first.status, 200, first.error);
      const second = await call("POST", "/gated/sign-in", { way: "fake-key", key: OTHER });
      assert.deepEqual([second.status, second.error], [409, "Gated is signing in already: let that sign-in end, or cancel it, then paste the key again"]);
      assert.equal(keptKey("gated"), GOOD, "the first key stands");
      const asked = await call("POST", "/gated/sign-in", {});
      assert.deepEqual([asked.status, asked.signIn, asked.already, asked.agent.signingIn], [200, first.signIn, true, first.signIn], "the one under way, said as that");
      const stop = await call("POST", "/gated/sign-in/cancel");
      assert.deepEqual([stop.stopped, stop.agent.signingIn, stop.agent.lastSignIn.outcome, keptKey("gated")], [true, null, "cancelled", undefined], "stopped: its key is not kept");
      // The processes let go of so far — the one that named its ways, the one the stopped key started — have ended: a
      // kill takes a moment to land, and one still there would take the gate's word for the next.
      await until(() => callsOf("gated").filter((c) => c.method === "start").every((c) => !alive(c.pid)), "the processes let go of to end");
      const again = await call("POST", "/gated/sign-in", { way: "fake-key", key: GOOD });
      assert.equal(again.status, 200, again.error);
      writeFileSync(gate(), "");
      const done = await ended("gated");
      assert.deepEqual([done.lastSignIn.outcome, done.account?.identity?.label, keptKey("gated")], ["signed-in", "Fake API key", GOOD]);
    } finally {
      writeFileSync(gate(), "");
    }
  });

  // (fails before: yes — finding 15: both started: the agent was asked to sign in twice, the second sign-in taking the
  // first one's place)
  test("an agent's own sign-in asked for twice at once is one sign-in: its agent is asked once, and both are answered with it", async () => {
    const [a, b] = await Promise.all([call("POST", "/twice/sign-in", { way: "browser-login" }), call("POST", "/twice/sign-in", { way: "browser-login" })]);
    assert.deepEqual([a.status, b.status], [200, 200], `${a.error} ${b.error}`);
    const done = await ended("twice");
    assert.equal(done.lastSignIn.outcome, "signed-in");
    assert.equal(callsOf("twice").filter((c) => c.method === "authenticate").length, 1, "asked to sign in once");
    assert.deepEqual([b.signIn.way, b.signIn.at], [a.signIn.way, a.signIn.at], "the one sign-in, to both");
  });

  // (fails before: yes — finding 14: the server's answer dropped what says a way finishes from another computer, so
  // over SSH the ways came as the agent lists them, the page that comes back to Filament's computer first)
  test("the command line over SSH, against the app's own answer: Codex's code for another device comes first", async () => {
    const was = process.env.SSH_CONNECTION;
    process.env.SSH_CONNECTION = "203.0.113.7 52100 10.0.0.5 22";
    try {
      const far = await runAt(shim.dataDir, ["agents", "sign-in", "cx"]);
      assert.deepEqual([far.code, far.err], [EXIT.needsPerson, ["filament agents: Codex signs in more than one way: give --way, one of chatgpt-code, chatgpt, api-key"]]);
    } finally {
      if (was === undefined) delete process.env.SSH_CONNECTION;
      else process.env.SSH_CONNECTION = was;
    }
  });

  // (fails before: yes — finding 4: "✓ Keyed Cli is signed in: whom it did not say." of a key nothing had tried)
  test("the command line says the same of a key nothing checked: kept, its next turn tries it", async () => {
    const into = await runAt(shim.dataDir, ["agents", "sign-in", "keyed-cli", "--way", "fake-key", "--key-stdin"], `${TYPED}\n`);
    assert.deepEqual([into.code, into.out.at(-1), into.err], [EXIT.ok, "Key kept; Keyed Cli's next turn tries it.", []]);
    assert.equal(keptKey("keyed-cli"), TYPED);
    const gone = await runAt(shim.dataDir, ["agents", "sign-out", "keyed-cli"]);
    assert.deepEqual([gone.code, gone.out, keptKey("keyed-cli")], [EXIT.ok, ["Keyed Cli is signed out."], undefined]);
    answers.push(into, gone);
  });

  // (fails before: no — a guard: no key was said before either; it holds over the put-back and the sign-out too)
  test("no answer, row, operation, record or log says a key, and the configuration on disk holds them sealed", async () => {
    const said = JSON.stringify([
      answers,
      (await (await shim.api("/api/agent-accounts")).json()).agents,
      (await (await shim.api("/api/state")).json()).config,
      await (await shim.api("/api/ops?kinds=all&limit=1000")).json(),
      await shim.records(200),
    ]);
    const disk = readFileSync(join(shim.dataDir, "config.json"), "utf8");
    for (const key of KEYS) {
      assert.ok(!said.includes(key), "no answer, row, operation or record says it");
      assert.ok(!disk.includes(key), "sealed on disk");
      assert.ok(!lines.some((l) => l.includes(key)), "its log says none, at the debug level either");
    }
  });
});

describe("the re-read's finding 15: a sign-in's start, one step at a time (app/agent-logins.js)", () => {
  /** @type {string[]} */
  const roots = [];
  after(() => removeDirs(...roots));
  /**
   * The logins over a Codex account that signs in on its page: the agent answers a sign-in's start when the test lets it
   * (`hold`, `release`), each start counted (`started`); a page's sign-in ends with what the test gives (`pages`), and
   * the sign-ins the agent was told to stop are kept (`cancelled`).
   */
  const stand = () => {
    const root = mkdtempSync(join(tmpdir(), "filament-sign-in-reread-steps-"));
    roots.push(root);
    const upstreams = [{ id: "cx", name: "Codex", type: "codex", enabled: true, acp: { command: process.execPath, args: [], cwdDefault: root } }];
    const s = {
      started: 0,
      hold: false,
      /** @type {(() => void)[]} */
      held: [],
      release: () => {
        s.hold = false;
        s.held.splice(0).forEach((r) => r());
      },
      /** @type {((out: any) => void)[]} */
      pages: [],
      /** @type {string[]} */
      cancelled: [],
      row: () => logins.state(upstreams[0]),
    };
    const bridge = {
      signInWays: async () => [{ id: "chatgpt", name: "ChatGPT", description: "", kind: "browser" }],
      signIn: async () => {
        s.started++;
        if (s.hold) await new Promise((r) => s.held.push(() => r(undefined)));
        return { url: "https://example.test/login", code: null, done: new Promise((r) => s.pages.push(r)) };
      },
      cancelSignIn: async (/** @type {any} */ u) => {
        s.cancelled.push(u.id);
        return true;
      },
      checkAccount: async () => {},
      letGo: () => {},
      running: () => false,
    };
    const logins = createAgentLogins({
      config: /** @type {any} */ ({ get: () => ({ upstreams, routes: [] }), set: () => {}, save: () => {} }),
      destinationFor: () => /** @type {any} */ ({ agent: bridge }),
      terminal: /** @type {any} */ ({ create: () => { throw new Error("no terminal here"); }, kill: () => true }),
      accounts: /** @type {any} */ ({ view: () => ({ identity: { kind: "account" } }) }),
      dataDir: root,
      adoptModels: () => {},
      askModels: async () => {},
      publish: () => {},
      log: () => {},
      signInOf: async () => ({ signedIn: null, identity: null }),
      saysWho: () => true,
    });
    return { logins, s };
  };

  // (fails before: yes — the agent was asked for two sign-ins, the second kept in the first one's place)
  test("asked twice while its agent is still asked for the page: one start, and the second gets the first one's sign-in, said as under way already", async () => {
    const { logins, s } = stand();
    s.hold = true;
    const both = Promise.all([logins.signIn("cx", { way: "chatgpt" }), logins.signIn("cx", { way: "chatgpt" })]);
    await settle();
    assert.equal(s.started, 1, "the agent is asked for one sign-in");
    s.release();
    const [a, b] = /** @type {any[]} */ (await both);
    assert.deepEqual([a.already, b.signIn, b.already], [undefined, a.signIn, true]);
    assert.deepEqual((await s.row()).signingIn, a.signIn);
    const again = /** @type {any} */ (await logins.signIn("cx", { way: "chatgpt" }));
    assert.deepEqual([again.signIn, again.already, s.started], [a.signIn, true, 1], "asked again while it waits: the one under way");
  });

  // (fails before: yes — the first sign-in's 15 minutes were never stopped once the second took its place: they ended
  // the sign-in that waited then, five minutes old, as one nobody finished in 15)
  test("no sign-in's 15 minutes outlive it: one asked for twice at once and finished leaves a later sign-in its own 15 minutes", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { logins, s } = stand();
    s.hold = true;
    const both = Promise.all([logins.signIn("cx", { way: "chatgpt" }), logins.signIn("cx", { way: "chatgpt" })]);
    await settle();
    s.release();
    await both;
    // The sign-in that stands ends well.
    s.pages.at(-1)?.({ ok: true, error: null });
    await settle();
    assert.equal((await s.row()).lastSignIn?.outcome, "signed-in");
    t.mock.timers.tick(10 * 60_000);
    await logins.signIn("cx", { way: "chatgpt" });
    // 15 minutes after the first two were asked for: the one that waits now is five minutes old.
    t.mock.timers.tick(BROWSER_WAIT_MS - 10 * 60_000 + 1000);
    await settle();
    const young = await s.row();
    assert.deepEqual([young.signingIn?.way, young.lastSignIn], ["chatgpt", null], "still waiting for the person");
    t.mock.timers.tick(10 * 60_000);
    await settle();
    const old = await s.row();
    assert.deepEqual([old.signingIn, old.lastSignIn?.outcome, old.lastSignIn?.error], [null, "failed", "nobody finished the sign-in within 15 minutes"], "its own 15 minutes");
  });

  // (fails before: yes — a sign-in stopped while its agent was still asked for the page was not there to stop: Cancel
  // answered that nothing was under way, and the sign-in then stood)
  test("stopped while its agent is still asked for the page: the sign-in is stopped once it stands, and its agent told", async () => {
    const { logins, s } = stand();
    s.hold = true;
    const start = logins.signIn("cx", { way: "chatgpt" });
    await settle();
    const stop = logins.cancelSignIn("cx");
    await settle();
    s.release();
    await start;
    assert.equal(await stop, true);
    const now = await s.row();
    assert.deepEqual([now.signingIn, now.lastSignIn?.outcome, s.cancelled], [null, "cancelled", ["cx"]]);
  });
});

describe("a key kept in the place of one that worked, which nothing checked (app/agent-logins.js, services/agent-accounts.js)", () => {
  /** @type {string[]} */
  const roots = [];
  after(() => removeDirs(...roots));
  /** Who the key before it signed in, as its agent named them, and the window of their plan, spent. */
  const NAMED = /** @type {any} */ ({ kind: "api-key", label: "Fake API key", plan: null, email: null, organization: null, detail: null, billing: "metered" });
  const SPENT = /** @type {any} */ ({ id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 100, resetsAt: Date.now() + 3_600_000, windowMins: 10_080, status: "rejected" });
  /**
   * The logins over one account that keeps a key under its variable (`FIRST`), with the accounts' store itself: its
   * agent says who it runs as or keeps it to itself (`says`), asked who it runs as it answers nothing — when the test
   * lets it (`hold`, `release`), or not at all (`down`) —, and neither its CLI nor its files can tell.
   * @param {{ says: boolean }} o
   */
  const stand = ({ says }) => {
    const root = mkdtempSync(join(tmpdir(), "filament-sign-in-reread-key-"));
    roots.push(root);
    /** @type {any} */
    let cfg = { upstreams: [{ id: "keyed", name: "Keyed", type: "acp", enabled: true, acp: { command: process.execPath, args: [], cwdDefault: root, env: { [VAR]: FIRST } } }], routes: [] };
    const accounts = createAgentAccounts();
    const s = {
      hold: false,
      down: false,
      /** @type {(() => void)[]} */
      held: [],
      release: () => {
        s.hold = false;
        s.held.splice(0).forEach((r) => r());
      },
      key: () => cfg.upstreams[0].acp.env[VAR],
      row: async () => ({ ...(await logins.state(cfg.upstreams[0])), account: accounts.view("keyed") }),
      /** The row once the key's sign-in ended. @returns {Promise<any>} */
      ended: () =>
        until(async () => {
          const r = await s.row();
          return r.lastSignIn && !r.signingIn ? r : null;
        }, "the key's sign-in to end"),
    };
    const bridge = {
      signInWays: async () => [{ id: "fake-key", name: "Fake API key", description: "", kind: "key", label: "Your Fake API key", variable: VAR }],
      checkAccount: async () => {
        if (s.hold) await new Promise((r) => s.held.push(() => r(undefined)));
        if (s.down) throw new Error("its process did not start");
      },
      letGo: () => {},
      running: () => false,
    };
    const logins = createAgentLogins({
      config: /** @type {any} */ ({ get: () => cfg, set: (/** @type {any} */ c) => (cfg = c), save: () => {} }),
      destinationFor: () => /** @type {any} */ ({ agent: bridge }),
      terminal: /** @type {any} */ ({ create: () => { throw new Error("no terminal here"); }, kill: () => true }),
      accounts,
      dataDir: root,
      adoptModels: () => {},
      askModels: async () => {},
      publish: () => {},
      log: () => {},
      signInOf: async () => ({ signedIn: null, identity: null }),
      saysWho: () => says,
    });
    return { logins, accounts, s };
  };

  // (fails before: yes — the account stayed kept as someone signed in, on the word of the turn the key before it
  // served: its row said "Signed in" of a key nothing had tried)
  test("its agent keeps who it runs as to itself, and a turn was served with the key before: that word is let go of — nothing says someone is signed in until the new key is tried", async () => {
    const { logins, accounts, s } = stand({ says: false });
    logins.turnSaid("keyed", true);
    await until(() => accounts.view("keyed")?.identitySource === "turn", "the served turn to say someone is signed in");
    const r = /** @type {any} */ (await logins.signIn("keyed", { way: "fake-key", key: OTHER }));
    assert.equal(r.signIn?.kind, "key");
    const done = await s.ended();
    assert.deepEqual([done.lastSignIn.outcome, s.key()], ["key-kept", OTHER]);
    assert.deepEqual([done.account?.identity ?? null, done.account?.identitySource ?? null, done.account?.signedOut ?? false], [null, null, false], "neither someone nor nobody: nothing tried the key");
    // The turn the new key serves says it again.
    logins.turnSaid("keyed", true);
    await until(() => accounts.view("keyed")?.identitySource === "turn", "the turn the new key served to say someone is signed in");
  });

  // (fails before: yes — the account stayed kept as the one its agent named for the key before, with that one's spent
  // window: its row said "Signed in" as them, and the plan used up, of a key nothing had tried)
  test("its agent says who it runs as, and says nothing of the new key in time: the account it named for the key before goes, and its plan's windows with it; its word, late, then stands", async () => {
    const { logins, accounts, s } = stand({ says: true });
    accounts.report("keyed", { source: "agent", identity: NAMED, windows: [SPENT] });
    assert.deepEqual([accounts.view("keyed")?.identity?.label, accounts.view("keyed")?.spent], ["Fake API key", true]);
    // The key comes a moment after its agent last spoke.
    await new Promise((r) => setTimeout(r, 5));
    await logins.signIn("keyed", { way: "fake-key", key: OTHER });
    const done = await s.ended();
    assert.deepEqual([done.lastSignIn.outcome, s.key()], ["key-kept", OTHER]);
    assert.deepEqual([done.account?.identity ?? null, done.account?.identitySource ?? null, done.account?.windows, done.account?.spent], [null, null, [], false], "who the key before signed in is not said of this one, nor their plan");
    accounts.report("keyed", { source: "agent", identity: { ...NAMED, label: "Another key" } });
    assert.equal(accounts.view("keyed")?.identity?.label, "Another key");
  });

  // (fails before: no — a guard of what the row says at the two other moments: while the key is checked its sign-in is
  // under way, and a check that could not be made puts the key before it back, whose account then stands)
  test("while the new key is checked the row says it is signing in; a check that could not be made puts back the key that worked, and who it signed in stands", async () => {
    const { logins, accounts, s } = stand({ says: true });
    accounts.report("keyed", { source: "agent", identity: NAMED });
    await new Promise((r) => setTimeout(r, 5));
    s.hold = true;
    s.down = true;
    await logins.signIn("keyed", { way: "fake-key", key: OTHER });
    await settle();
    const during = await s.row();
    assert.deepEqual([during.signingIn?.kind, during.lastSignIn, s.key()], ["key", null, OTHER], "under way: the page says Signing in");
    s.release();
    const done = await s.ended();
    assert.deepEqual([done.lastSignIn.outcome, done.lastSignIn.error], ["failed", "the sign-in ended, but Keyed could not be asked who it runs as (its process did not start)"]);
    assert.deepEqual([s.key(), done.account?.identity?.label], [FIRST, "Fake API key"], "the key that worked is back, and its account is the one kept");
  });
});

describe("the re-read's finding 14: the command line's sign-in, over a Filament that answers as told", () => {
  /** How far the other machine's clock is from this one's. */
  const APART = 10 * 60_000;
  const CLAUDE_LINE = "claude auth login";
  /**
   * A Filament of the test's own on a port of its own, its listening.json in a folder of its own, its clock `ahead` of
   * this machine's (behind, where negative): Codex and Claude Code connected, nobody signed in. Codex's sign-in ends
   * well by the first look after it began; Claude Code's is in Filament's terminal — `under`: under way before the
   * command asked.
   * @param {{ ahead?: number, under?: boolean }} [o]
   */
  const farFilament = async ({ ahead = 0, under = false } = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "filament-sign-in-reread-cli-"));
    const clock = () => Date.now() + ahead;
    /** @type {{ method: string, path: string, body: any }[]} */
    const came = [];
    /** @type {{ state: "out" | "signing" | "in", at: number }} */
    const codex = { state: "out", at: 0 };
    const codexRow = () => ({
      upstream: "codex",
      name: "Codex",
      label: "Default",
      off: false,
      signingIn: null,
      lastSignIn: codex.state === "in" ? { outcome: "signed-in", error: null, at: codex.at } : null,
      account: codex.state === "in" ? { identity: { kind: "account", label: "ada@example.com", plan: "plus" } } : { signedOut: true, identity: { kind: "none" } },
    });
    const claudeRow = () => ({ upstream: "claude-code", name: "Claude Code", label: "Default", off: false, signingIn: null, lastSignIn: null, account: { signedOut: true, identity: { kind: "none" } } });
    const KEY_WAYS = [{ id: "api-key", name: "OpenAI API key", description: "Paste a key from your OpenAI account", kind: "key", label: "OpenAI API key" }];
    /** @type {Record<string, (body: any) => any>} */
    const routes = {
      "GET /coding-agents": () => ({
        entries: [
          { id: "claude-code", name: "Claude Code", state: "connected", primary: "claude-code", upstreams: ["claude-code"] },
          { id: "codex", name: "Codex", state: "connected", primary: "codex", upstreams: ["codex"] },
        ],
      }),
      "GET /agent-accounts": () => {
        // The first look after its sign-in began finds it ended, a moment ago by the server's clock.
        if (codex.state === "signing") Object.assign(codex, { state: "in", at: clock() });
        return { agents: [claudeRow(), codexRow()] };
      },
      "POST /agent-accounts/codex/sign-in": (b) => {
        if (b?.way === "api-key" && !b.key) return { choose: KEY_WAYS };
        codex.state = "signing";
        return b?.way === "api-key"
          ? { signIn: { kind: "key", way: "api-key", name: "OpenAI API key", at: clock() } }
          : { signIn: { kind: "browser", way: "chatgpt-code", name: "ChatGPT on another device", url: "https://auth.example.test/codex/device", code: "FAKE-1234", line: "codex login", at: clock() } };
      },
      "POST /agent-accounts/claude-code/sign-in": () => ({
        signIn: { kind: "terminal", way: "cli", name: "Claude Code", terminal: "t1", line: CLAUDE_LINE, at: clock() - (under ? 60_000 : 0) },
        ...(under ? { already: true } : {}),
      }),
      "POST /agent-accounts/claude-code/sign-in/cancel": () => ({ stopped: true }),
    };
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        const path = String(req.url || "").replace(/^\/api/, "");
        const body = raw ? JSON.parse(raw) : null;
        came.push({ method: String(req.method), path, body });
        if (path === "/state") return void res.end(JSON.stringify({ version: "9.9.9", dataDir: dir, uptimeMs: 1000 }));
        const route = routes[`${req.method} ${path}`];
        if (!route) {
          res.statusCode = 404;
          return void res.end(JSON.stringify({ error: `no ${req.method} ${path}` }));
        }
        res.end(JSON.stringify(route(body)));
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
    const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
    writeListening(dir, { host: "127.0.0.1", port, pid: process.pid, version: "9.9.9", startedAt: 1 });
    return {
      dir,
      came,
      /** How often the accounts were read once the sign-in began. */
      looks: () => came.slice(came.findIndex((c) => c.path.endsWith("/sign-in"))).filter((c) => c.method === "GET" && c.path === "/agent-accounts").length,
      async close() {
        server.closeAllConnections();
        await new Promise((r) => server.close(() => r(undefined)));
        await removeDirs(dir);
      },
    };
  };
  /** The command's end, or "still waiting" where it has not ended in time: its second look, with room to spare. @param {Promise<any>} cli */
  const inTime = (cli) => {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const late = new Promise((r) => (timer = setTimeout(() => r("still waiting"), scaledMs(9000))));
    return Promise.race([cli, late]).finally(() => clearTimeout(timer));
  };

  // (fails before: yes — the sign-in's end, ten minutes old by the command's own clock, was never taken for its end: the
  // command looked every two seconds for 15 minutes and ended "did not finish")
  test("a Filament whose clock runs ten minutes behind this machine's: a sign-in that ended is read as ended at the first look", async () => {
    const f = await farFilament({ ahead: -APART });
    const cli = runAt(f.dir, ["agents", "sign-in", "codex", "--way", "chatgpt-code", "--no-open"]);
    try {
      const r = await inTime(cli);
      assert.notEqual(r, "still waiting", `the sign-in ended at the first look of ${f.looks()}, and the command waits on`);
      assert.deepEqual([r.code, r.out.at(-1), r.err, f.looks()], [EXIT.ok, "✓ Codex is signed in: ada@example.com · plus.", [], 1]);
    } finally {
      // A command that waits on ends at its next look: nothing answers there.
      await f.close();
      await cli.catch(() => {});
    }
  });

  // (fails before: yes — a sign-in this command began read as one from before it, its moment ten minutes back by the
  // command's clock: "is signing in in Filament's terminal already: finish it there", and nothing taken back)
  test("a terminal's sign-in this command began, on a Filament whose clock runs behind: taken back, its line given to run", async () => {
    const f = await farFilament({ ahead: -APART });
    try {
      const r = await runAt(f.dir, ["agents", "sign-in", "claude-code"]);
      assert.deepEqual([r.code, r.err], [EXIT.needsPerson, [`filament agents: Claude Code signs in at a terminal: run \`${CLAUDE_LINE}\`, then filament agents check claude-code`]]);
      assert.ok(f.came.some((c) => c.path === "/agent-accounts/claude-code/sign-in/cancel"), "the one it began in Filament's terminal is taken back");
    } finally {
      await f.close();
    }
  });

  // (fails before: yes — a sign-in the person began in the harness a minute before read as this command's own, its
  // moment nine minutes ahead by the command's clock: it was cancelled under them)
  test("a terminal's sign-in under way before the command asked, on a Filament whose clock runs ahead: left to finish there, never taken back", async () => {
    const f = await farFilament({ ahead: APART, under: true });
    try {
      const r = await runAt(f.dir, ["agents", "sign-in", "claude-code"]);
      assert.deepEqual([r.code, r.err], [EXIT.needsPerson, ["filament agents: Claude Code is signing in in Filament's terminal already: finish it there (filament open), then filament agents check claude-code"]]);
      assert.ok(!f.came.some((c) => c.path.endsWith("/cancel")), "the person's own sign-in is not stopped");
    } finally {
      await f.close();
    }
  });

  // (fails before: yes — the question said "nothing shows as you type", and a star showed for each character)
  test("a key typed at a terminal: its question says what the terminal then shows — a star for each character, never the key", async () => {
    const f = await farFilament();
    const input = /** @type {any} */ (new PassThrough());
    input.setRawMode = () => {};
    const output = new PassThrough();
    let screen = "";
    let question = "";
    output.on("data", (c) => {
      screen += String(c);
      // The question waits at the end of the screen: the person types the key.
      if (question || !/: $/.test(screen)) return;
      question = screen.split("\n").at(-1) || "";
      setImmediate(() => input.write(`${TYPED}\n`));
    });
    /** @type {string[]} */
    const said = [];
    try {
      const code = await runCli(["agents", "sign-in", "codex", "--way", "api-key"], { dataDir: f.dir, term: /** @type {any} */ ({ input, output, tty: true }), out: (s) => said.push(s), err: (s) => said.push(`ERR ${s}`) });
      assert.equal(code, EXIT.ok, said.join("\n"));
      assert.deepEqual(f.came.filter((c) => c.path === "/agent-accounts/codex/sign-in").map((c) => c.body), [{ way: "api-key" }, { way: "api-key", key: TYPED }]);
      const shown = screen.slice(screen.indexOf(question) + question.length);
      assert.equal(shown, `${"*".repeat(TYPED.length)}\n`, "a star for each character, then the line's end");
      assert.equal(question, "Paste your OpenAI API key (it shows as stars): ");
      assert.ok(!screen.includes(TYPED) && !said.join("\n").includes(TYPED), "the key is shown nowhere");
    } finally {
      await f.close();
    }
  });
});

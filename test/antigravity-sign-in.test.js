// @ts-check
// The owner's of 11-11, on Antigravity's card: three sign-ins that worked, its account's row grey with Sign in after
// each; one model listed, with no thinking level to pick. Antigravity's ACP server (agy_acp_server 1.4.5) never says
// who it runs as — at its start, in a session, or in a notification — and no CLI of its own says it either: a session
// it opens or refuses is all that tells. So a sign-in that ended well is kept as someone signed in, as nobody said whom
// (services/agent-accounts.js `signedIn`), a session opened or refused for its models speaks as a turn's does
// (adapters/agents/acp/bridge.js `listModels`, app/agent-logins.js `turnSaid`), a sign-out its own way is kept as nobody
// signed in, the command line's sign-in and check read the same account (cli/flows.js `signedInWords`), and the levels
// its session's model takes are kept with its list for the picker (app/models.js, core/model-families.js). Through the
// whole app, against the fake agent as Antigravity (FAKE_ACP_AGY).
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";

import { EXIT } from "../src/cli/client.js";
import { runCli } from "../src/cli/main.js";
import { turnModelName } from "../src/core/model-caps.js";
import { startApp, FAKE_ACP_AGENT } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

describe("Antigravity's account, through the app: signed in, as it doesn't say whom (the owner's of 11-11)", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  /** What an agent was asked, as its calls file says. @param {string} id @returns {any[]} */
  const callsOf = (id) => {
    const f = join(root, `${id}.calls.jsonl`);
    return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  };

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-agy-sign-in-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    // Signed in before Filament ran them: nothing here was told.
    for (const id of ["agy-there", "agy-turn", "agy-bare"]) writeFileSync(join(root, `${id}.signed-in`), "signed in");
    /** The fake as Antigravity's ACP server, its login in a file of its own. @param {string} id @param {Record<string, string>} [env] */
    const agy = (id, env = {}) => ({
      id,
      name: `Antigravity ${id}`,
      type: "acp",
      acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_AGY: "1", FAKE_ACP_SIGNED_IN: join(root, `${id}.signed-in`), FAKE_ACP_CALLS: join(root, `${id}.calls.jsonl`), ...env }, cwdDefault: projDir, permissions: "allow-all", hints: false, authenticate: false },
    });
    shim = await startApp({
      configure: (cfg) => {
        // One that names no way to sign in: it has no sign-in to speak of.
        cfg.upstreams = [agy("agy"), agy("agy-asked"), agy("agy-there"), agy("agy-turn"), agy("agy-cli"), agy("agy-bare", { FAKE_ACP_AUTH_METHODS: "[]" })];
        cfg.routes = cfg.upstreams.map((/** @type {any} */ u) => ({ match: `${u.id}/*`, upstream: u.id, upstreamModel: "{1}", enabled: true }));
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await removeDirs(root);
  });

  /** @param {string} id */
  const row = async (id) => (await (await shim.api("/api/agent-accounts")).json()).agents.find((/** @type {any} */ r) => r.upstream === id);
  /** What an account's row keeps of who is signed in. @param {any} r */
  const kept = (r) => (r?.account ? [r.account.signedOut, r.account.identity?.kind ?? null, r.account.identitySource] : null);
  /** @param {string} method @param {string} path @param {unknown} [body] */
  const call = async (method, path, body) => {
    const res = await shim.api(`/api/agent-accounts${path}`, { method, body });
    return { status: res.status, ...(await res.json()) };
  };
  /** @param {string} id */
  const ended = (id) =>
    until(async () => {
      const r = await row(id);
      return r?.lastSignIn && !r.signingIn ? r : null;
    }, `${id}'s sign-in to end`, { timeoutMs: 20_000 });
  const models = async () => (await shim.api("/api/models")).json();
  /** An agent's models as the picker has them, once it listed some. @param {string} id */
  const listed = (id) =>
    until(async () => {
      const m = await models();
      return m.models.some((/** @type {any} */ x) => x.upstream === id) ? m : null;
    }, `${id}'s models`, { timeoutMs: 20_000 });
  /** @param {string} model */
  const turn = async (model) => {
    const res = await shim.post("/v1/messages", { model, max_tokens: 100, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "hello" }] });
    const body = await res.text();
    return { status: res.status, error: res.status === 200 ? undefined : String(JSON.parse(body)?.error?.message) };
  };

  // (fails before: yes — a sign-in that ended well kept nothing where nothing was kept before: the store's `signedIn`
  // only ever took a "nobody" away, so the row stayed "It doesn't say which account it runs on" with Sign in)
  test("one sign-in is enough: ended well, its row is signed in, as nobody said whom, with Sign out; its models come with it", async () => {
    const fresh = await row("agy");
    assert.deepEqual([fresh.account, fresh.ways.map((/** @type {any} */ w) => w.id)], [null, []], "never started: nothing known of it");
    const ways = await call("POST", "/agy/sign-in", {});
    assert.deepEqual([ways.status, ways.choose?.map((/** @type {any} */ w) => w.id)], [200, ["oauth-personal", "oauth-business", "gemini-api-key", "agent-platform"]], "its four ways, none with a type: it carries each out itself");
    const r = await call("POST", "/agy/sign-in", { way: "oauth-personal" });
    assert.equal(r.status, 200, r.error);
    const done = await ended("agy");
    assert.deepEqual([done.lastSignIn.outcome, done.lastSignIn.error], ["signed-in", null]);
    assert.deepEqual(kept(done), [false, null, "sign-in"], "someone is signed in; as whom, it never says");
    assert.deepEqual([done.says, done.signsOut], [false, true], "it keeps who it runs as to itself, and signs out its own way");
    assert.deepEqual(callsOf("agy").filter((c) => c.method === "authenticate").map((c) => c.methodId), ["oauth-personal"], "asked once");
    const m = await listed("agy");
    assert.deepEqual(m.models.filter((/** @type {any} */ x) => x.upstream === "agy").map((/** @type {any} */ x) => [x.id, x.label]), [["agy/gemini-3.8-flash", "Gemini 3.8 Flash"]], "the one model its plan lists");
  });

  // (fails before: yes — a listing its agent refused for its sign-in said so in the log alone, and one it opened said
  // nothing; a sign-out its own way left what was kept as it stood)
  test("its models asked for while nobody is signed in say so on its row; signed in, Check now keeps it; signed out its own way, nobody is", async () => {
    assert.equal((await call("POST", "/agy-asked/check")).status, 200);
    await until(async () => (await models()).upstreams?.["agy-asked"]?.error, "agy-asked's listing to be refused");
    const out = await row("agy-asked");
    assert.deepEqual([kept(out), out.account?.identity?.detail], [[true, "none", "turn"], "Authentication required"], "the session it refused says nobody is signed in");
    const r = await call("POST", "/agy-asked/sign-in", { way: "oauth-personal" });
    assert.equal(r.status, 200, r.error);
    assert.deepEqual(kept(await ended("agy-asked")), [false, null, "sign-in"]);
    await listed("agy-asked");
    const news = () => callsOf("agy-asked").filter((c) => c.method === "session/new").length;
    const before = news();
    assert.equal((await call("POST", "/agy-asked/check")).status, 200);
    await until(() => news() > before, "Check now's listing");
    assert.deepEqual(kept(await row("agy-asked")), [false, null, "sign-in"], "nothing can tell otherwise: it stays signed in");
    const gone = await call("POST", "/agy-asked/sign-out");
    assert.equal(gone.status, 200, gone.error);
    assert.deepEqual([kept(gone.agent), gone.agent.lastSignIn.outcome], [[true, "none", "sign-out"], "signed-out"], "its sign-out's good end is the word");
    assert.deepEqual(callsOf("agy-asked").filter((c) => c.method === "logout").length, 1);
    const refused = await turn("agy-asked/gemini-3.8-flash");
    assert.notEqual(refused.status, 200);
  });

  // (fails before: yes — an agent signed in before Filament ran it showed as not heard from whatever it served: a
  // session opened said someone is signed in only over a kept "nobody")
  test("signed in already, as nothing here was told: Check now's listing, or a turn it serves, says so; an agent that names no way to sign in has none to speak of", async () => {
    assert.deepEqual([(await row("agy-there")).account, (await row("agy-turn")).account], [null, null]);
    assert.equal((await call("POST", "/agy-there/check")).status, 200);
    await listed("agy-there");
    assert.deepEqual(kept(await row("agy-there")), [false, null, "turn"], "the session it opened for its models");
    const served = await turn("agy-turn/gemini-3.8-flash");
    assert.equal(served.status, 200, served.error);
    assert.deepEqual(kept(await row("agy-turn")), [false, null, "turn"], "the turn it served");
    const bare = await turn("agy-bare/gemini-3.8-flash");
    assert.equal(bare.status, 200, bare.error);
    assert.deepEqual([(await row("agy-bare")).ways, (await row("agy-bare")).account], [[], null], "no way to sign in: nobody is said to be signed in");
  });

  // (fails before: yes — `filament agents sign-in` said "is signed in" of a sign-in that ended well, and `agents check`
  // then read the same account, of which nothing was kept, as "is not signed in: filament agents sign-in …")
  test("the command line agrees with itself: signed in by `filament agents sign-in`, check says it is signed in, as it did not say whom; signed out, that nobody is", async () => {
    /** A command run as a script runs it: no terminal. @param {string[]} argv */
    const run = async (argv) => {
      /** @type {{ out: string[], err: string[] }} */
      const said = { out: [], err: [] };
      const term = /** @type {any} */ ({ input: Readable.from([]), output: new PassThrough(), tty: false });
      const code = await runCli(argv, { dataDir: shim.dataDir, term, out: (s) => said.out.push(s), err: (s) => said.err.push(s) });
      return { code, ...said };
    };
    const into = await run(["agents", "sign-in", "agy-cli", "--way", "oauth-personal"]);
    const check = await run(["agents", "check", "agy-cli"]);
    assert.deepEqual(
      [into.code, into.out.at(-1), into.err, check.code, check.out, check.err],
      [EXIT.ok, "✓ Antigravity agy-cli is signed in: whom it did not say.", [], EXIT.ok, ["Antigravity agy-cli is signed in: whom it did not say."], []],
      "the sign-in's line and the check's say the same",
    );
    const gone = await run(["agents", "sign-out", "agy-cli"]);
    assert.deepEqual([gone.code, gone.out], [EXIT.ok, ["Antigravity agy-cli is signed out."]]);
    const after = await run(["agents", "check", "agy-cli"]);
    assert.deepEqual([after.code, after.out], [EXIT.needsPerson, ["Antigravity agy-cli is not signed in: filament agents sign-in agy-cli."]]);
  });

  // (fails before: yes — the levels its session's model takes were read at each turn and kept nowhere: the picker asked
  // Filament's own table, which knows no gemini-3.8-flash, and offered effort for Claude's adapter and Codex alone.
  // The level's way to the agent — the name's suffix, then `session/set_config_option` — was there: a guard)
  test("the picker offers its model at the thinking levels its session takes, and a level chosen reaches it as the option it names", async () => {
    const m = await listed("agy");
    const fam = m.families.find((/** @type {any} */ f) => f.id === "agy/gemini-3.8-flash");
    assert.deepEqual(fam?.effort, { via: "setting", levels: ["low", "medium", "high"], default: null });
    // The chat's setting rides on the name it sends (core/model-caps.js `turnModelName`).
    const sent = turnModelName(shim.app.config, { model: { effort: "low" } }, "agy/gemini-3.8-flash");
    assert.equal(sent, "agy/gemini-3.8-flash-low");
    const low = await turn(sent);
    assert.equal(low.status, 200, low.error);
    assert.deepEqual(callsOf("agy").filter((c) => c.method === "session/set_config_option").map((c) => [c.configId, c.value]), [["thinking_level", "low"]], "the agent was set to it, under its own option's id");
  });
});

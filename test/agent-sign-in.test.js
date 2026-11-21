// @ts-check
// The owner's of 10-30: "Only the ones that are available and connected need to be shown in the model picker." Where a
// coding agent doesn't say who it runs as itself, its sign-in is read without a turn — its CLI's status (Cursor's,
// Qoder's at either site, Claude's before its adapter first starts; core/agent-limits.js, adapters/agents/acp/detect.js)
// — at start, as a page reads the accounts, at Check now and as a sign-in ends, and learnt
// from its turns (app/agent-logins.js); each account's row says whether its agent's program is here; and the picker and
// a fresh start's model offer no agent nobody is signed in to, nor one whose program isn't here (ui/lib/accounts.js
// `offered`). The modules that gained these are read whole (`* as`): against a build without them, each test fails on
// its own.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as limits from "../src/core/agent-limits.js";
import * as detect from "../src/adapters/agents/acp/detect.js";
import * as failures from "../src/adapters/agents/acp/failures.js";
import * as logins from "../src/app/agent-logins.js";
import * as lib from "../src/ui/lib/accounts.js";
import * as picker from "../src/ui/harness/composer/model.js";
import { KNOWN_AGENTS } from "../src/core/catalogues.js";
import { createAgentAccounts } from "../src/services/agent-accounts.js";
import { startApp, FAKE_ACP_AGENT } from "./helpers/app.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { removeDirs, until } from "./helpers/wait.js";

/** @typedef {import("../src/core/agent-limits.js").SignInReading} SignInReading */
/** @typedef {import("../src/core/agent-limits.js").Identity} Identity */

/** @type {SignInReading} */
const CANNOT = { signedIn: null, identity: null };
/** @type {Identity} */
const NONE = { kind: "none", label: "Not signed in", plan: null, email: null, organization: null, detail: null, billing: null };
/** @param {string} label @param {string | null} email @returns {Identity} */
const who = (label, email) => ({ kind: "account", label, plan: null, email, organization: null, detail: null, billing: "plan" });
const settle = () => new Promise((r) => setImmediate(r));

describe("what an agent's CLI says of its sign-in (core/agent-limits.js statusReading)", () => {
  // (fails before: yes — nothing read Cursor's status: its sign-in was unknown, whatever it said)
  test("Cursor's: signed in as its user's name and email, nobody where it says so, its own failed check can't tell; its text form read alike", () => {
    const read = (/** @type {any} */ j) => limits.statusReading("cursor", JSON.stringify(j, null, 2));
    assert.deepEqual(
      read({ status: "authenticated", isAuthenticated: true, hasAccessToken: true, hasRefreshToken: true, userInfo: { email: "dev@example.com", userId: 1, firstName: "Ada", lastName: "Lovelace", teamId: 2, createdAt: "2026-06-30T17:55:29.965Z" } }),
      { signedIn: true, identity: who("Ada Lovelace", "dev@example.com") },
    );
    assert.deepEqual(read({ status: "authenticated", isAuthenticated: true, hasAccessToken: true, hasRefreshToken: true, message: "Logged in (unable to fetch user details)" }), { signedIn: true, identity: null }, "signed in, as nobody said whom");
    assert.deepEqual(read({ status: "unauthenticated", isAuthenticated: false, hasAccessToken: false, hasRefreshToken: false, message: "Not logged in" }), { signedIn: false, identity: NONE });
    assert.equal(read({ status: "partially-authenticated", isAuthenticated: false, hasAccessToken: true, hasRefreshToken: false, message: "Partially authenticated (missing refresh token)" }).signedIn, false);
    assert.deepEqual(read({ status: "error", message: "Status check error: fetch failed" }), CANNOT, "its own check failed: it can't tell");
    const text = (/** @type {string} */ s) => limits.statusReading("cursor", s);
    assert.deepEqual(text("✓ Logged in as dev@example.com\n").identity, who("Cursor account", "dev@example.com"), "an email is never the label: the pages mask it");
    assert.equal(text("Not logged in").signedIn, false);
    assert.equal(text("Status check error: boom").signedIn, null);
  });

  // (fails before: yes — nothing read Qoder's status, at either site)
  test("Qoder's: signed in as its user, with its plan; a username that is an email is no label; nobody where it says so; anything else can't tell", () => {
    const read = (/** @type {any} */ j) => limits.statusReading("qoder", JSON.stringify(j));
    assert.deepEqual(read({ logged_in: true, version: "1.1.50", allow_byok: 0, username: "ada", email: "dev@example.com", avatar_url: "https://example.com/a.png", plan: "pro" }), {
      signedIn: true,
      identity: { ...who("ada", "dev@example.com"), plan: "pro" },
    });
    assert.equal(read({ logged_in: true, version: "1.1.50", username: "dev@example.com" }).identity?.label, "Qoder account");
    assert.deepEqual(read({ logged_in: false, version: "1.1.50", allow_byok: 0 }), { signedIn: false, identity: NONE });
    assert.equal(limits.statusReading("qoder", "Version: 1.1.50\nAccount: Not logged in\n").signedIn, false);
    assert.deepEqual(limits.statusReading("qoder", "error: unknown option '-o'"), CANNOT);
  });

  // (fails before: yes — the reader is new; its claude and codex readings are detect.js's, moved)
  test("Claude's `loggedIn` and Codex's words: yes or no, whom left to the agents themselves; a way nobody knows can't tell", () => {
    assert.deepEqual(limits.statusReading("claude", '{"loggedIn": true, "authMethod": "claude.ai"}'), { signedIn: true, identity: null });
    assert.deepEqual(limits.statusReading("claude", '{"loggedIn": false}'), { signedIn: false, identity: NONE });
    assert.deepEqual(limits.statusReading("codex", "", "Logged in using ChatGPT"), { signedIn: true, identity: null }, "its words on stderr");
    assert.equal(limits.statusReading("codex", "Not logged in").signedIn, false);
    assert.deepEqual(limits.statusReading("mine", '{"isAuthenticated": true}'), CANNOT);
  });
});

describe("read without a turn (adapters/agents/acp/detect.js)", () => {
  /** @type {string} */
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-sign-in-"));
  });
  after(() => removeDirs(dir));
  /**
   * A program named as an agent's CLI, in a folder of the test's: node running `body`, which sees its arguments and
   * variables. Only ever this program runs here.
   * @param {string} name @param {string} body
   */
  const program = (name, body) => {
    const at = join(dir, name);
    mkdirSync(at, { recursive: true });
    const script = join(at, "status.mjs");
    writeFileSync(script, body);
    if (process.platform === "win32") {
      writeFileSync(join(at, `${name}.cmd`), `@"${process.execPath}" "${script}" %*\r\n`);
      return join(at, `${name}.cmd`);
    }
    writeFileSync(join(at, name), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    chmodSync(join(at, name), 0o755);
    return join(at, name);
  };

  // (fails before: yes — the catalogue read Claude's and Codex's alone)
  test("the catalogue reads Cursor's and Qoder's at either site, beside Claude's and Codex's; Antigravity's sign-in is its own to say", () => {
    const status = (/** @type {string} */ id) => KNOWN_AGENTS.find((a) => a.id === id)?.status;
    const qoder = { cmd: "qodercli", args: ["status", "-o", "json"], parse: "qoder" };
    assert.deepEqual([status("cursor"), status("qoder"), status("qoder-cn"), status("antigravity-acp")], [{ cmd: "agent", args: ["status", "--format", "json"], parse: "cursor" }, qoder, qoder, undefined]);
    assert.deepEqual([status("claude-code")?.parse, status("codex")?.parse], ["claude", "codex"]);
  });

  // (fails before: yes — the status ran with Filament's variables alone, and Qoder CN's said nothing it could read)
  test("a status runs with its agent's own variables and its upstream's, its upstream's program where the status is that program's", async () => {
    const qodercli = program("qodercli", "console.log(JSON.stringify({ logged_in: process.env.QODERCLI_SITE === 'cn', version: '1', username: process.argv.slice(2).join(' ') }));");
    const cn = { id: "qoder-cn", type: "acp", acp: { command: qodercli, env: { QODERCLI_SITE: "cn" } } };
    assert.deepEqual(await detect.upstreamLogin(cn), { signedIn: true, identity: who("status -o json", null) }, "Qoder CN's site, and the catalogue's arguments");
    // Without the site a developer's own environment may set.
    assert.equal((await detect.upstreamLogin({ id: "qoder", type: "acp", acp: { command: qodercli, env: {}, envRemove: ["QODERCLI_SITE"] } })).signedIn, false, "Qoder's other site");
    assert.equal(await detect.loginStatus({ env: { QODERCLI_SITE: "cn" }, status: { cmd: qodercli, args: [], parse: "qoder" } }), true, "the catalogue's own variables");
    assert.deepEqual(await detect.upstreamLogin({ id: "qoder", type: "acp", acp: { command: join(dir, "nowhere", "qodercli") } }), CANNOT, "its program isn't here: nothing runs");
    assert.deepEqual(await detect.upstreamLogin({ id: "cursor-sdk", type: "cursor-sdk", apiKey: "k" }), CANNOT, "Cursor's SDK route says who owns its key itself");
    assert.deepEqual(await detect.upstreamLogin({ id: "mine", type: "acp", acp: { command: join(dir, "my-agent") } }), CANNOT, "an agent the catalogue doesn't know");
  });
});

describe("what a turn's failure says of its agent's sign-in (adapters/agents/acp/failures.js saysSignedOut)", () => {
  // (fails before: yes — every failure its account was read in hid the agent: a file it may not open, a session that
  // expired, a credit balance)
  test("a sign-in asked for says nobody; an account's other troubles, and an error kind of another trouble, don't", () => {
    /** @param {string} message @param {any} [extra] */
    const err = (message, extra = {}) => Object.assign(new Error(message), extra);
    assert.deepEqual(
      [
        err("x", { data: { errorKind: "authentication_failed" } }),
        err("x", { data: { errorKind: "unauthorized" } }),
        err("Authentication required", { code: -32000 }),
        err("Cursor is not signed in. Run agent login"),
        err("Invalid API key · Please run /login"),
      ].map(failures.saysSignedOut),
      [true, true, true, true, true],
    );
    assert.deepEqual(
      [
        err("EACCES: permission denied, open 'C:\\x'"),
        err("your session has expired, start a new chat"),
        err("Your credit balance is too low to access the API"),
        err("unauthorized", { data: { errorKind: "rate_limit" } }),
        err("x", { data: { errorKind: "billing_error" } }),
        err("the agent process exited"),
      ].map(failures.saysSignedOut),
      [false, false, false, false, false, false],
    );
  });
});

describe("an agent that keeps who it runs as to itself (app/agent-logins.js)", () => {
  /** @type {string} */
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-sign-in-reads-"));
  });
  after(() => removeDirs(dir));
  /**
   * The logins over a store of their own, with readings the test says (`said`, by upstream; a function is a reading
   * under way the test settles) and agents that keep who they run as to themselves unless `says` names them; the agent
   * itself can't be asked who it runs as where `unasked` says so, and names no way to sign in where `noWays` names it.
   * @param {{ says?: Record<string, boolean | null>, unasked?: boolean, noWays?: string[] }} [o]
   */
  const stand = ({ says = {}, unasked = false, noWays = [] } = {}) => {
    const upstreams = [
      { id: "cur", type: "acp", enabled: true, acp: { command: "agent" } },
      { id: "gem", type: "acp", enabled: true, acp: { command: "gemini" } },
      { id: "cc", type: "acp", enabled: true, acp: { command: "claude-agent-acp" } },
      { id: "off", type: "acp", enabled: false, acp: { command: "qodercli" } },
      { id: "api", type: "anthropic", enabled: true },
    ];
    const accounts = createAgentAccounts({});
    /** @type {Record<string, SignInReading | (() => Promise<SignInReading>)>} */
    const said = {};
    /** @type {string[]} */
    const asked = [];
    /** @type {Map<string, (code: number | null, closed: boolean) => void>} */
    const exits = new Map();
    const bridge = {
      checkAccount: async () => {
        if (unasked) throw new Error("its adapter did not start");
      },
      letGo: () => {},
      running: () => false,
      signInWays: async (/** @type {any} */ u) => (noWays.includes(u.id) ? [] : [{ id: "cli", name: "Its CLI", description: "", kind: "terminal", command: process.execPath, args: ["--version"], env: {} }]),
      signOut: async () => {},
    };
    const l = logins.createAgentLogins({
      config: /** @type {any} */ ({ get: () => ({ upstreams, routes: [] }) }),
      destinationFor: () => /** @type {any} */ ({ agent: bridge }),
      terminal: /** @type {any} */ ({ create: (/** @type {any} */ o) => (exits.set("t", o.onExit), { id: "t" }), kill: () => true }),
      accounts,
      dataDir: dir,
      adoptModels: () => {},
      askModels: async () => {},
      publish: () => {},
      log: () => {},
      signInOf: async (u) => {
        asked.push(u.id);
        const r = said[u.id];
        return typeof r === "function" ? r() : r || CANNOT;
      },
      saysWho: (u) => (u.id in says ? says[u.id] : false),
    });
    return { l, accounts, said, asked, upstreams, exits };
  };

  // (fails before: yes — nothing read an agent's sign-in without a turn)
  test("read at start and as a page reads the accounts, once a minute at most: every enabled agent that doesn't say who it runs as, none that does", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    const { l, accounts, said, asked } = stand({ says: { cc: true } });
    said.cur = { signedIn: true, identity: who("Ada Lovelace", "dev@example.com") };
    said.gem = { signedIn: false, identity: { ...NONE, detail: "a gateway chosen" } };
    l.refresh();
    await settle();
    assert.deepEqual(asked, ["cur", "gem"], "Claude's adapter says who it runs as; one turned off and a provider aren't agents to read");
    assert.deepEqual([accounts.view("cur")?.identity, accounts.view("gem")?.signedOut, accounts.view("cc")], [who("Ada Lovelace", "dev@example.com"), true, null]);
    l.refresh();
    await settle();
    assert.equal(asked.length, 2, "read a moment ago: not again");
    t.mock.timers.tick(logins.SIGN_IN_READ_MS);
    l.refresh();
    await settle();
    assert.deepEqual(asked, ["cur", "gem", "cur", "gem"], "a minute on, again");
  });

  // (fails before: yes — nothing read an agent's sign-in without a turn)
  test("someone, as whom where it says, or nobody, into the store; a reading that can't tell leaves it; only the newest reading speaks", async () => {
    const { l, accounts, said } = stand();
    said.gem = { signedIn: false, identity: NONE };
    l.refresh();
    await settle();
    said.gem = CANNOT;
    await l.check({ id: "gem", type: "acp", acp: { command: "gemini" } });
    assert.equal(accounts.view("gem")?.signedOut, true, "it can't tell now: what its files said stays");
    said.cc = { signedIn: true, identity: null };
    await l.check({ id: "cc", type: "acp", acp: { command: "claude-agent-acp" } });
    assert.deepEqual([accounts.view("cc")?.signedOut, accounts.view("cc")?.identity, accounts.view("cc")?.identitySource], [false, null, "status"], "signed in, as nobody said whom: kept as that");
    /** @type {(r: SignInReading) => void} */
    let late = () => {};
    const cur = { id: "cur", type: "acp", acp: { command: "agent" } };
    said.cur = () => new Promise((r) => (late = r));
    const first = l.check(cur);
    await settle();
    said.cur = { signedIn: false, identity: NONE };
    await l.check(cur);
    late({ signedIn: true, identity: who("Ada Lovelace", "dev@example.com") });
    await first;
    assert.equal(accounts.view("cur")?.signedOut, true, "the reading asked for later spoke; the earlier one, ending after it, said nothing");
  });

  // (fails before: yes — a turn its agent refused for its account reached its health alone, never its account)
  test("a turn refused for its account says nobody; one served says someone, and whom is read afresh; an agent that says who it runs as keeps its own word", async () => {
    const { l, accounts, said, asked } = stand({ says: { cc: true } });
    l.turnSaid("cur", false, "Cursor is not signed in.\n Sign in under Settings → Coding agents");
    assert.deepEqual([accounts.view("cur")?.signedOut, accounts.view("cur")?.identity?.detail, accounts.view("cur")?.identitySource], [true, "Cursor is not signed in. Sign in under Settings → Coding agents", "turn"]);
    said.cur = { signedIn: true, identity: who("Ada Lovelace", "dev@example.com") };
    l.turnSaid("cur", true);
    assert.equal(accounts.view("cur")?.signedOut, false, "served: someone is signed in");
    await settle();
    assert.deepEqual([asked, accounts.view("cur")?.identity], [["cur"], who("Ada Lovelace", "dev@example.com")], "and as whom, read afresh");
    l.turnSaid("cur", true);
    assert.equal(asked.length, 1, "served while signed in: nothing to read");
    l.turnSaid("cc", false, "authentication_failed");
    l.turnSaid("api", false, "401");
    assert.deepEqual([accounts.view("cc"), accounts.view("api")], [null, null]);
  });

  // (fails before: yes — a served turn cleared its CLI's "nobody", and the reading it set off put it back at once, so an
  // agent its CLI wrongly said nobody of stayed hidden however many turns it served)
  test("a turn served outranks its CLI's nobody until a turn is refused again; Check now's reading still speaks", async () => {
    const { l, accounts, said } = stand();
    said.cur = { signedIn: false, identity: NONE };
    l.refresh();
    await settle();
    assert.equal(accounts.view("cur")?.signedOut, true, "its CLI says nobody");
    l.turnSaid("cur", true);
    await settle();
    await settle();
    assert.equal(accounts.view("cur")?.signedOut, false, "it served a turn: the reading that followed says no nobody over it");
    l.refresh();
    await settle();
    assert.equal(accounts.view("cur")?.signedOut, false, "nor does a page's read");
    await l.check({ id: "cur", type: "acp", acp: { command: "agent" } });
    assert.equal(accounts.view("cur")?.signedOut, true, "Check now, at the person's word, says what its CLI says");
    l.turnSaid("cur", true);
    await settle();
    await settle();
    assert.equal(accounts.view("cur")?.signedOut, false, "served again");
    l.turnSaid("cur", false, "not signed in");
    assert.equal(accounts.view("cur")?.signedOut, true, "refused again: nobody");
  });

  // (fails before: yes — an agent that could not be asked who it runs as had its CLI's word left unread: Check now
  // answered its failure first, and a sign-in's end failed on it)
  test("an agent that can't be asked who it runs as still has its CLI's word read, at Check now and as a sign-in ends", async () => {
    const { l, accounts, said, exits } = stand({ unasked: true });
    said.cur = { signedIn: true, identity: who("Ada Lovelace", "dev@example.com") };
    await l.signIn("cur", { way: "cli" });
    exits.get("t")?.(0, false);
    const cur = { id: "cur", type: "acp", acp: { command: "agent" } };
    await until(async () => (await l.state(cur)).lastSignIn, "the sign-in's end");
    assert.deepEqual([(await l.state(cur)).lastSignIn?.outcome, accounts.view("cur")?.identity], ["signed-in", who("Ada Lovelace", "dev@example.com")]);
    said.cur = CANNOT;
    await l.signIn("cur", { way: "cli" });
    exits.get("t")?.(0, false);
    await until(async () => (await l.state(cur)).lastSignIn?.outcome === "failed", "the sign-in's failed end");
    assert.match(String((await l.state(cur)).lastSignIn?.error), /could not be asked who it runs as \(its adapter did not start\)/);
  });

  // (fails before: yes — Check now asked an agent that keeps who it runs as to itself nothing)
  test("Check now lets go of a nobody that only a turn said where nothing can tell; one its CLI or its files said stays", async () => {
    const { l, accounts, said } = stand();
    l.turnSaid("cur", false, "not signed in");
    await l.check({ id: "cur", type: "acp", acp: { command: "agent" } });
    assert.deepEqual([accounts.view("cur")?.signedOut, accounts.view("cur")?.identity], [false, null]);
    said.gem = { signedIn: false, identity: NONE };
    await l.check({ id: "gem", type: "acp", acp: { command: "gemini" } });
    said.gem = CANNOT;
    await l.check({ id: "gem", type: "acp", acp: { command: "gemini" } });
    assert.equal(accounts.view("gem")?.signedOut, true);
  });

  // (fails before: yes — a sign-in that ended well was read as signed in wherever the agent said nothing, so its CLI
  // saying nobody went unheard)
  test("a sign-in that ended well: its CLI's word decides; where it can't tell, the good end is the word", async () => {
    const { l, accounts, said, exits } = stand();
    said.cur = { signedIn: false, identity: NONE };
    await l.signIn("cur", { way: "cli" });
    exits.get("t")?.(0, false);
    await until(async () => (await l.state({ id: "cur", type: "acp", acp: { command: "agent" } })).lastSignIn, "the sign-in's end");
    const failed = (await l.state({ id: "cur", type: "acp", acp: { command: "agent" } })).lastSignIn;
    assert.deepEqual([failed?.outcome, failed?.error], ["failed", "the sign-in ended, but cur says nobody is signed in"]);
    said.cur = CANNOT;
    await l.signIn("cur", { way: "cli" });
    exits.get("t")?.(0, false);
    await until(async () => (await l.state({ id: "cur", type: "acp", acp: { command: "agent" } })).lastSignIn?.outcome === "signed-in", "the sign-in's good end");
    assert.deepEqual([accounts.view("cur")?.signedOut, accounts.view("cur")?.identitySource], [false, "sign-in"]);
  });

  // (fails before: yes — the owner's of 11-11, Antigravity's card: with nothing kept before it, a sign-in's good end
  // kept nothing, so the account read as not heard from, with Sign in, however many times it was signed in)
  test("a sign-in that ended well where nothing was kept and nothing can tell: someone is signed in, as nobody said whom", async () => {
    const { l, accounts, exits } = stand();
    const gem = { id: "gem", type: "acp", acp: { command: "gemini" } };
    await l.signIn("gem", { way: "cli" });
    exits.get("t")?.(0, false);
    await until(async () => (await l.state(gem)).lastSignIn, "the sign-in's end");
    assert.deepEqual(
      [(await l.state(gem)).lastSignIn?.outcome, accounts.view("gem")?.signedOut, accounts.view("gem")?.identity, accounts.view("gem")?.identitySource],
      ["signed-in", false, null, "sign-in"],
    );
  });

  // (fails before: yes — a turn served said someone is signed in only over a kept "nobody"; and a turn's "nobody" let
  // go of at Check now was kept the way someone signed in is, with nothing to say it)
  test("a turn served with nothing kept says someone is signed in, where its agent names a way to sign in; a turn's nobody let go of is unknown again, not signed in", async () => {
    const { l, accounts } = stand({ noWays: ["gem"] });
    l.turnSaid("cur", true);
    l.turnSaid("gem", true);
    await settle();
    assert.deepEqual([accounts.view("cur")?.signedOut, accounts.view("cur")?.identity, accounts.view("cur")?.identitySource], [false, null, "turn"]);
    assert.equal(accounts.view("gem"), null, "no way to sign in: no sign-in to speak of");
    l.turnSaid("cur", false, "not signed in");
    await l.check({ id: "cur", type: "acp", acp: { command: "agent" } });
    assert.deepEqual([accounts.view("cur")?.signedOut, accounts.view("cur")?.identity, accounts.view("cur")?.identitySource], [false, null, null], "nothing can tell: neither nobody nor someone");
  });

  // (fails before: yes — a sign-out of an agent that keeps who it runs as to itself left what was kept as it stood: its
  // row still read signed in)
  test("signed out its agent's own way: its CLI's word decides; where it can't tell, the sign-out's good end is the word", async () => {
    const { l, accounts, said } = stand();
    const cur = { id: "cur", type: "acp", acp: { command: "agent" } };
    l.turnSaid("cur", true);
    await settle();
    await l.signOut("cur");
    assert.deepEqual([accounts.view("cur")?.signedOut, accounts.view("cur")?.identitySource, (await l.state(cur)).lastSignIn?.outcome], [true, "sign-out", "signed-out"]);
    said.gem = { signedIn: true, identity: who("Ada Lovelace", "dev@example.com") };
    await l.signOut("gem");
    assert.deepEqual(accounts.view("gem")?.identity, who("Ada Lovelace", "dev@example.com"), "its CLI says someone still is: its word stands");
  });
});

describe("through the app: the accounts' rows, Check now, and what a turn shows (server.js, http/admin/upstreams.js, app/acp-turn.js)", () => {
  /** @type {string} */
  let root;
  /** @type {string} */
  let projDir;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** What the stand-in reads of each agent's sign-in, by upstream. @type {Record<string, SignInReading>} */
  const said = {
    out: { signedIn: false, identity: NONE },
    ok: { signedIn: false, identity: NONE },
  };
  /** @type {string[]} */
  const asked = [];
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-sign-in-app-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello\n");
    const git = (/** @type {string[]} */ ...a) => execFileSync("git", a, { cwd: projDir, stdio: "ignore" });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
    /** An agent that keeps who it runs as to itself, as the fake plays one. @param {Record<string, string>} env */
    const agent = (env) => ({ command: process.execPath, args: [FAKE_ACP_AGENT], env, cwdDefault: projDir, permissions: "allow-all", hints: false });
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "ok", name: "Ok", type: "acp", acp: agent({}) },
          { id: "out", name: "Out", type: "acp", acp: agent({}) },
          { id: "refuser", name: "Refuser", type: "acp", acp: agent({ FAKE_ACP_FAIL_KIND: "authentication_failed" }) },
          { id: "gone", name: "Gone", type: "acp", acp: { ...agent({}), command: join(root, "no-such-agent") } },
        ];
        cfg.routes = ["ok", "out", "refuser", "gone"].map((id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true }));
      },
      overrides: {
        signInOf: async (/** @type {any} */ u) => {
          asked.push(u.id);
          return said[u.id] || CANNOT;
        },
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });
  const rows = async () => /** @type {any[]} */ ((await (await shim.api("/api/agent-accounts")).json()).agents);
  const rowOf = async (/** @type {string} */ id) => (await rows()).find((r) => r.upstream === id);
  /** @param {string} model @param {string} chat */
  const turn = async (model, chat) => {
    const res = await shim.post("/v1/messages", { model, max_tokens: 100, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: "hello" }] }, { "x-session-id": chat });
    return { status: res.status, body: await res.text() };
  };

  // (fails before: yes — no row said whether its program is here, and no agent's sign-in was read at start)
  test("from the start, an agent nobody is signed in to says so; each row says whether its program is here", async () => {
    const out = await until(async () => ((await rowOf("out"))?.account?.signedOut ? rowOf("out") : null), "the start's reading of out");
    assert.deepEqual([out.here, out.account.identitySource], [true, "status"]);
    assert.deepEqual([(await rowOf("gone")).here, (await rowOf("refuser")).account], [false, null]);
    assert.ok(["ok", "out", "refuser", "gone"].every((id) => asked.includes(id)), "every agent read at start");
  });

  // (fails before: yes — Check now asked an agent that keeps who it runs as to itself nothing of its sign-in)
  test("Check now reads its sign-in afresh: signed in, it says as whom", async () => {
    said.out = { signedIn: true, identity: who("Ada Lovelace", "dev@example.com") };
    const r = await (await shim.api("/api/agent-accounts/out/check", { method: "POST" })).json();
    assert.deepEqual([r.agent.account.signedOut, r.agent.account.identity], [false, who("Ada Lovelace", "dev@example.com")]);
    assert.equal(r.agent.says, false, "started to be checked, it said it keeps who it runs as to itself");
  });

  // (fails before: yes — Check now answered the agent's failure to start before its sign-in was read)
  test("Check now reads its sign-in even where its agent can't be asked who it runs as", async () => {
    const before = asked.filter((id) => id === "gone").length;
    const res = await shim.api("/api/agent-accounts/gone/check", { method: "POST" });
    assert.equal(res.status, 502, await res.clone().text());
    assert.equal(asked.filter((id) => id === "gone").length, before + 1);
  });

  // (fails before: yes — a sign-in its agent refused cooled its health, and its account never heard of it)
  test("a turn its agent refuses for its account says nobody is signed in there; a turn served says someone is, and as whom is read afresh", async () => {
    assert.notEqual((await turn("refuser/sonnet", "sign-in-refused")).status, 200);
    const refused = await until(async () => ((await rowOf("refuser"))?.account?.signedOut ? rowOf("refuser") : null), "refuser to be signed out");
    assert.equal(refused.account.identitySource, "turn");
    await until(async () => (await rowOf("ok"))?.account?.signedOut, "ok's start reading");
    said.ok = { signedIn: true, identity: who("Grace Hopper", "ops@example.com") };
    assert.equal((await turn("ok/sonnet", "sign-in-served")).status, 200);
    const served = await until(async () => ((await rowOf("ok"))?.account?.identity ? rowOf("ok") : null), "ok to be signed in");
    assert.deepEqual([served.account.signedOut, served.account.identity.email], [false, "ops@example.com"]);
  });
});

describe("the store: someone signed in, as nobody said whom (services/agent-accounts.js)", () => {
  // (fails before: yes — a "nobody" stood until the agent said someone by name; then, the owner's of 11-11, with nothing
  // kept there was nothing to say: a sign-in that ended well left no word that someone is signed in)
  test("a kept nobody goes, whoever was kept stays, and with nothing kept someone is kept as signed in; said again, nothing changes", () => {
    const s = createAgentAccounts({ now: () => 1000 });
    /** @type {string[]} */
    const heard = [];
    s.onChange((id) => heard.push(id));
    s.signedIn("x", "sign-in");
    assert.deepEqual([s.view("x")?.identity, s.view("x")?.signedOut, s.view("x")?.identitySource], [null, false, "sign-in"]);
    s.signedIn("x", "turn");
    assert.equal(s.view("x")?.identitySource, "sign-in", "said again: as it was kept");
    s.report("x", { source: "status", identity: NONE });
    s.signedIn("x", "turn");
    assert.deepEqual([s.view("x")?.identity, s.view("x")?.signedOut, s.view("x")?.identitySource], [null, false, "turn"]);
    s.report("y", { source: "status", identity: who("Ada Lovelace", "dev@example.com") });
    s.signedIn("y", "turn");
    assert.deepEqual(s.view("y")?.identity, who("Ada Lovelace", "dev@example.com"));
    assert.deepEqual(heard, ["x", "x", "x", "y"]);
  });

  // (fails before: yes — there was no way to keep "nothing known": a "nobody" let go of was kept as someone signed in)
  test("a nobody nothing can confirm is let go of as nothing known; whoever is kept, and someone signed in, stay", () => {
    const s = createAgentAccounts({ now: () => 1000 });
    /** @type {string[]} */
    const heard = [];
    s.onChange((id) => heard.push(id));
    s.unknown("x");
    assert.equal(s.view("x"), null, "nothing kept: nothing to let go of");
    s.report("x", { source: "turn", identity: NONE });
    s.unknown("x");
    assert.deepEqual([s.view("x")?.identity, s.view("x")?.signedOut, s.view("x")?.identitySource], [null, false, null]);
    s.signedIn("x", "sign-in");
    s.unknown("x");
    assert.equal(s.view("x")?.identitySource, "sign-in");
    s.report("y", { source: "status", identity: who("Ada Lovelace", "dev@example.com") });
    s.unknown("y");
    assert.deepEqual(s.view("y")?.identity, who("Ada Lovelace", "dev@example.com"));
    assert.deepEqual(heard, ["x", "x", "x", "y"]);
  });
});

describe("the picker offers no agent nobody is signed in to (ui/lib/accounts.js offered, ui/harness/composer/model.js)", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());
  /** An account's row as `/api/agent-accounts` says it. @param {string} upstream @param {any} account @param {boolean} [here] @returns {any} */
  const row = (upstream, account, here = true) => ({ upstream, name: upstream, type: "acp", agent: upstream, agentName: upstream, here, says: false, login: null, account, label: "Default", added: false, home: null, style: null, oneAccount: null, ways: [], signsOut: false, signingIn: null, lastSignIn: null });
  /** @param {Identity} identity */
  const account = (identity) => ({ identity, signedOut: identity.kind === "none", identityAt: 1, identitySource: "status", windows: [], fullest: null, spent: false, freeAt: null, extra: null, credits: null, resetCredits: null, reached: null, noWindows: null, at: 1 });
  const ROWS = [row("cur", account(who("Ada Lovelace", "dev@example.com"))), row("gem", account(NONE)), row("gone", null, false), row("fresh", null)];

  // (fails before: yes — every enabled agent was offered, signed in or not)
  test("never an agent nobody is signed in to, nor one whose program isn't here; a provider's API and an agent not heard from are offered", () => {
    assert.deepEqual(["api", "cur", "gem", "gone", "fresh"].map((u) => lib.offered(ROWS, u)), [true, true, false, false, true]);
    assert.equal(lib.offered([row("spent", { ...account(who("Ada Lovelace", null)), spent: true })], "spent"), true, "a plan that is spent is not signed out");
  });

  // (fails before: yes — the picker grouped every family by its upstream, signed in or not)
  test("its tabs: a signed-out agent's and one whose program isn't here are gone, and its search finds neither; signed in again, it comes back by itself", () => {
    const body = /** @type {any} */ (doc.document.body);
    /** @param {string} id @param {string} upstream @returns {any} */
    const fam = (id, upstream) => ({ id, upstream, kind: "model", members: [{ id, effort: null, speed: null, thinking: null, window: null }], effort: null, speed: null, thinking: null, window: null, ...(upstream === "api" ? {} : { codingAgent: true }) });
    const s = picker.createModelSelect({ onPick: () => {} });
    s.setFamilies([fam("api/glm", "api"), fam("cur/auto", "cur"), fam("gem/flash", "gem"), fam("gone/x", "gone"), fam("fresh/y", "fresh")]);
    s.setAccounts(ROWS);
    /** The tabs an open shows; a row picked closes it again. */
    const tabs = () => {
      s.open();
      const names = body.querySelectorAll(".mp-source-name").map((/** @type {any} */ e) => e.textContent);
      body.querySelector(".mp-row").dispatch("click");
      return names;
    };
    assert.deepEqual(tabs(), ["api", "cur", "fresh"]);
    assert.deepEqual([s.matches("flash"), s.matches("glm")], [false, true]);
    s.setAccounts([row("cur", account(who("Ada Lovelace", "dev@example.com"))), row("gem", account(who("Google account", "dev@example.com"))), row("gone", null, false), row("fresh", null)]);
    assert.deepEqual(tabs(), ["api", "cur", "gem", "fresh"]);
  });

  // (fails before: yes — a fresh start chose the catalogue's first model, a signed-out agent's among them)
  test("a fresh start's model: the first the picker offers, never an effort twin", () => {
    const models = [
      { id: "gem/flash-high", upstream: "gem", source: "effort-variant" },
      { id: "gem/flash", upstream: "gem" },
      { id: "gone/x", upstream: "gone" },
      { id: "cur/auto-high", upstream: "cur", source: "effort-variant" },
      { id: "cur/auto", upstream: "cur" },
      { id: "api/glm", upstream: "api" },
    ];
    assert.equal(picker.firstModel(models, []), "gem/flash", "accounts not read: nothing is hidden");
    assert.equal(picker.firstModel(models, ROWS), "cur/auto");
    assert.equal(picker.firstModel(models, [...ROWS.filter((r) => r.upstream !== "cur"), row("cur", account(NONE))]), "api/glm");
    assert.equal(picker.firstModel([], ROWS), "");
  });

  // (fails before: yes — the catalogue's paint chose at once, before the accounts were read; the page needs a browser,
  // so its wiring is held by its source)
  test("the harness chooses a fresh start's model once both the catalogue and the accounts are read", () => {
    const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "ui", "harness", "app.js"), "utf8");
    assert.match(app, /function pickFirstModel\(\) \{\s*if \(composer\.modelName\(\) \|\| !accountsRead \|\| !state\.models\.length\) return;\s*const name = firstModel\(state\.models, state\.accounts\);/);
    assert.match(app, /onSaid: \(rows\) => \{ state\.accounts = rows; accountsRead = true; accountsMoved\(\); pickFirstModel\(\); \}/, "the accounts read");
    assert.match(app, /state\.families = models\.families \|\| \[\];\s*\/\/ [^\n]*\n\s*pickFirstModel\(\);/, "the catalogue painted");
  });
});

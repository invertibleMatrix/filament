// @ts-check
// HarnessV4_Space_Plan S4b: the account each project signs in with. A server's sign-ins are kept per account at its
// address — the first, main, under the address alone as every sign-in was —; a place picks one with `{ name, account }`
// beside its switch, or `account` on a server it holds; the chat's list, Filament's own agent, a coding agent and a
// Space's dashboards each sign in as the account its place picks. The pure parts (core/oauth.js, services/mcp-servers.js,
// the settings' checks, the MCP client's pool key, the change words); the sign-ins against a fake OAuth server; the
// admin rows a project's Connections sheet calls; and the sheet's words (ui/harness/space/connections.js).
// (fails before: yes — a sign-in was the address's: one account per server, for every project)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACCOUNT_RE, MAIN_ACCOUNT, accountOf, accountWords, accountsAt, addressOf, signInKey } from "../src/core/oauth.js";
import { isPick, mergeServers, serversOn, withAccount } from "../src/services/mcp-servers.js";
import { mcpEntryProblem, mcpServerProblem, resolveSettings } from "../src/services/session-settings.js";
import { createSignInStore } from "../src/services/mcp-sign-ins.js";
import { createMcpSignIns } from "../src/app/sessions/mcp-sign-in.js";
import { connectMcp, specKey } from "../src/adapters/tools/mcp-client.js";
import { createMcpServers } from "../src/app/sessions/mcp-servers.js";
import { mcpServerRoutes } from "../src/http/admin/mcp-servers.js";
import { createRouter } from "../src/http/router.js";
import { createConfigStore } from "../src/services/config/store.js";
import { MemoryService } from "../src/services/memory/index.js";
import { sidecar } from "../src/adapters/sidecar/index.js";
import { createSessions } from "../src/app/sessions/service.js";
import { mcpChangeWords } from "../src/ui/harness/lib/labels.js";
import { missingWords, programsWords, usedWords, usesConnections } from "../src/ui/harness/space/connections.js";
import { startOAuthMcp, pressAllow } from "./helpers/oauth-mcp-fake.js";
import { removeDirs } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
/** @type {any[]} */
const fakes = [];
after(async () => {
  await Promise.all(fakes.splice(0).map((f) => f.close()));
  await removeDirs(...made);
});
/** A folder of the test's own. @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-space-conn-${tag}-`));
  made.push(d);
  return d;
};
/** A fake OAuth MCP server, closed at the end. */
const fake = async () => {
  const f = await startOAuthMcp();
  fakes.push(f);
  return f;
};

describe("the pure parts", () => {
  test("an account: main is the first, kept under the address alone; another under address#name, which no address is; its name's rule", () => {
    assert.deepEqual(["main", " Main ", "", null, "work", " Work Two "].map(accountOf), ["", "", "", "", "work", "Work Two"]);
    assert.deepEqual(["", "work"].map(accountWords), [MAIN_ACCOUNT, "work"]);
    const a = "https://mcp.linear.app/mcp";
    assert.deepEqual([signInKey(a, ""), signInKey(a, "main"), signInKey(a, "work")], [a, a, `${a}#work`]);
    assert.equal(addressOf(`${a}#work`), a, "an address keeps no fragment: a key with an account is never a server's address");
    assert.deepEqual(accountsAt(a, [a, `${a}#work`, `${a}#b`, "https://other.dev/mcp#x"]), ["", "b", "work"]);
    assert.deepEqual(accountsAt(a, [`${a}#work`]), ["work"], "main signed out, the others stay");
    for (const ok of ["work", "Personal 2", "a.b_c-d", "x".repeat(32)]) assert.ok(ACCOUNT_RE.test(ok), ok);
    for (const no of ["", " lead", "a/b", "a#b", "x".repeat(33)]) assert.ok(!ACCOUNT_RE.test(no), no);
  });

  test("a pick is { name, account } beside a switch; merged, the server signs in as the narrowest layer's pick; main is no account; one on this computer takes none", () => {
    assert.deepEqual([isPick({ name: "ci", account: "work" }), isPick({ name: "ci", account: "work", enabled: false }), isPick({ name: "ci", account: "work", url: "https://x" }), isPick({ name: "ci", enabled: false })], [true, true, false, false]);
    assert.deepEqual(withAccount({ name: "ci", url: "https://x", account: "old" }, "work"), { name: "ci", url: "https://x", account: "work" });
    assert.deepEqual(withAccount({ name: "ci", url: "https://x", account: "work" }, "main"), { name: "ci", url: "https://x" });
    assert.deepEqual(withAccount({ name: "fs", command: "npx" }, "work"), { name: "fs", command: "npx" }, "a pick written by hand on a program is no account");
    const ci = { name: "ci", url: "https://ci.dev/mcp" };
    const merged = mergeServers([{ at: "global", list: [ci] }, { at: "project", list: [{ name: "ci", account: "work" }] }]);
    assert.deepEqual(merged.map((s) => [s.spec, s.from, s.on, s.pickedAt]), [[{ ...ci, account: "work" }, "global", true, "project"]]);
    const chat = mergeServers([{ at: "global", list: [ci] }, { at: "project", list: [{ name: "ci", account: "work" }] }, { at: "session", list: [{ name: "ci", enabled: false, account: "main" }] }]);
    assert.deepEqual(chat.map((s) => [s.spec, s.on, s.switchedAt, s.pickedAt]), [[ci, false, "session", "session"]], "the chat's pick of main over the project's");
    assert.deepEqual(mergeServers([{ at: "project", list: [{ name: "gone", account: "work" }] }]).map((s) => [s.orphan, s.pickedAt]), [[true, "project"]], "a pick with no server beneath is an orphan, as a switch is");
    assert.deepEqual(serversOn(merged), [{ ...ci, account: "work" }]);
    // The chat's settings resolve to the spec it signs in as.
    const r = resolveSettings({ global: { "plugins.mcp": [ci] }, project: { "plugins.mcp": [{ name: "ci", account: "work" }] } });
    assert.deepEqual(r.flat["plugins.mcp"], [{ ...ci, account: "work" }]);
  });

  test("checked: an account by its rule, only on a server reached over HTTP; a pick as one; the pool keeps one connection per account", () => {
    assert.equal(mcpServerProblem({ name: "ci", url: "https://ci.dev/mcp", account: "work" }), null);
    assert.equal(mcpServerProblem({ name: "ci", url: "https://ci.dev/mcp", account: "a/b" }), 'account must name an account: letters, digits, space, . _ -, 32 at most ("main" is the first)');
    assert.equal(mcpServerProblem({ name: "fs", command: "npx", account: "work" }), "account is for a server reached over HTTP: one on this computer signs in its own way");
    assert.equal(mcpEntryProblem({ name: "ci", account: "work" }), null);
    assert.equal(mcpEntryProblem({ name: "ci", account: "work", enabled: false }), null);
    assert.match(String(mcpEntryProblem({ name: "ci", account: "#" })), /^account must name an account/);
    const ci = { name: "ci", url: "https://ci.dev/mcp" };
    assert.notEqual(specKey(ci), specKey({ ...ci, account: "work" }));
    assert.notEqual(specKey({ ...ci, account: "work" }), specKey({ ...ci, account: "personal" }));
    assert.equal(specKey(ci), specKey({ ...ci }), "main's key as it was");
  });

  test("a place's change in words: an account picked, picked back, and with a switch", () => {
    assert.equal(mcpChangeWords([], [{ name: "ci", account: "work" }]), "Connector ci signs in as work");
    assert.equal(mcpChangeWords([{ name: "ci", account: "work" }], [{ name: "ci", account: "main" }]), "Connector ci signs in as main");
    assert.equal(mcpChangeWords([{ name: "ci", account: "work" }], []), "Connector ci: inherits again");
    assert.equal(mcpChangeWords([], [{ name: "ci", enabled: false, account: "work" }]), "Connector ci off, signs in as work");
    assert.equal(mcpChangeWords([{ name: "ci", enabled: false }], [{ name: "ci", enabled: true, account: "work" }]), "Connector ci on, signs in as work");
    assert.equal(mcpChangeWords([{ name: "ci", url: "https://x" }], [{ name: "ci", url: "https://x", account: "work" }]), "Connector ci signs in as work");
    assert.equal(mcpChangeWords([{ name: "ci", url: "https://x" }], [{ name: "ci", url: "https://y", account: "work" }]), "Connector ci changed");
  });

  test("the Connectors sheet's words: what uses each, the programs and where they run; the top bar's button once a kept dashboard calls one", () => {
    assert.equal(usedWords(undefined), "Used by nothing in this Space yet");
    assert.equal(usedWords([{ name: "ci-ab12", title: "CI", reads: ["runs", "checks"], presses: ["Re-run failed jobs…"] }, { name: "rel-cd34", title: "Releases", reads: [], presses: ["Cut a release…"] }]),
      "Used by CI (reads runs and checks · Re-run failed jobs…), Releases (Cut a release…)");
    assert.equal(programsWords([], "/r"), "");
    assert.equal(programsWords([{ program: "npx", by: ["Deploys", "CI"] }, { program: "gh", by: ["CI"] }], "/r"),
      "Deploys and CI run npx · CI runs gh — in /r, signed in the way those programs are. Filament keeps no token for them.");
    // A Space of your own's folder is the Space's (found by the Hunter on the mock pass).
    assert.match(programsWords([{ program: "gh", by: ["CI"] }], null, { own: true }), /— in the Space's folder,/);
    assert.match(programsWords([{ program: "gh", by: ["CI"] }], null), /— in the project's folder,/);
    const tool = { connection: "ci", name: "list_runs", args: {} };
    const grant = (/** @type {any} */ sources, /** @type {any} */ actions = {}) => ({ sources, watch: [], actions });
    assert.equal(usesConnections([]), false);
    assert.equal(usesConnections([{ state: "kept", grant: grant({ deploys: { command: ["npx"] } }) }]), false, "commands only: no connection");
    assert.equal(usesConnections([{ state: "draft", grant: null }]), false, "a draft calls nothing yet");
    assert.equal(usesConnections([{ state: "kept", grant: grant({}, { rerun: { tool } }) }]), true, "a button's tool");
    assert.equal(usesConnections([{ state: "kept", grant: grant({ runs: { tool } }) }]), true);
    // (fails before: yes — found by the Hunter on S4b: a connection renamed or removed after Keep left every row "Used by
    // nothing", and nothing said what stops)
    const uses = { ci: [{ name: "ci-ab12", title: "CI", reads: ["runs"], presses: [] }], gh: [{ name: "a", title: "PRs", reads: [], presses: ["Merge…"] }, { name: "b", title: "Issues", reads: ["issues"], presses: [] }] };
    assert.equal(missingWords(uses, [{ name: "ci", spec: { url: "https://x" } }, { name: "gh", spec: { url: "https://y" } }]), "");
    assert.equal(missingWords(uses, [{ name: "ci", spec: { url: "https://x" } }, { name: "gh", orphan: true }]),
      "PRs and Issues call gh, which no connector here is named now: what they read and press through it fails until one is.");
    assert.equal(missingWords({ ci: uses.ci }, []), "CI calls ci, which no connector here is named now: what it reads and presses through it fails until one is.");
  });
});

describe("sign-ins per account, against a fake OAuth server", () => {
  /** A sign-in service over its own store. */
  const signIns = () => createMcpSignIns({ store: createSignInStore({ dataDir: fresh("si") }), selfBase: () => "http://127.0.0.1:4321" });

  test("main and another account at one address: two sign-ins, each its own token; each connection and coding agent signs in as its spec's; one signed out, the other stays", async () => {
    const f = await fake();
    const s = signIns();
    const host = new URL(f.url).host;
    const main = await s.start({ name: "ci", url: f.url });
    assert.equal((await s.back((await pressAllow(main.url)).searchParams)).ok, true);
    /** @type {string[]} */
    const done = [];
    const other = await s.start({ name: "ci", url: f.url, account: "personal", onDone: () => done.push("picked"), from: "project:p1" });
    assert.deepEqual(s.stateOf(f.url, {}, "personal"), { state: "waiting", host, account: "personal", accounts: ["main"], id: other.id, page: other.url });
    // (fails before: yes — found at the live look: a row on main said nothing of the other account's wait, so a page
    // that did not open could not be opened again or cancelled)
    assert.deepEqual(s.stateOf(f.url, {}, "", "project:p1"), { state: "waiting", host, account: "personal", accounts: ["main"], id: other.id, page: other.url }, "the row it was started from, on main, shows the wait");
    // (fails before: yes — found by the Hunter on S4b: every place's row on main showed it, with its Cancel)
    assert.deepEqual(s.stateOf(f.url, {}, "", "project:p2"), { state: "in", host, account: "main", accounts: ["main"] }, "another place's row on main does not");
    assert.deepEqual(s.stateOf(f.url, {}), { state: "in", host, account: "main", accounts: ["main"] });
    assert.match(String(await s.auth.header(f.url, {})), /^Bearer at-1-\d+$/, "main signs in all the while");
    assert.deepEqual(await s.back((await pressAllow(other.url)).searchParams), { ok: true, words: "Signed in to ci as personal: you can close this tab and go back to Filament." });
    assert.deepEqual(s.status(other.id), { status: "done", words: `Signed in on ${host} as personal`, name: "ci", host, account: "personal" });
    assert.deepEqual(done, ["picked"], "the place that asked picks it once it is kept");
    assert.deepEqual(s.stateOf(f.url, {}, "personal"), { state: "in", host, account: "personal", accounts: ["main", "personal"] });
    assert.deepEqual(s.stateOf(f.url, {}, "main"), { state: "in", host, account: "main", accounts: ["main", "personal"] });
    assert.deepEqual(s.stateOf(f.url, {}, "work"), { state: "asks", host, account: "work", accounts: ["main", "personal"] }, "an account picked with no sign-in asks for its own");
    // Filament's own agent: each connection as its spec's account, its own pooled connection.
    const asMain = await connectMcp({ name: "ci", url: f.url }, { timeoutMs: 10_000, auth: s.auth });
    const asPersonal = await connectMcp({ name: "ci", url: f.url, account: "personal" }, { timeoutMs: 10_000, auth: s.auth });
    assert.deepEqual([await asMain.call("whoami", {}), await asPersonal.call("whoami", {})], ["signed in as test-user (grant 1)", "signed in as test-user (grant 2)"]);
    await Promise.all([asMain.close(), asPersonal.close()]);
    // A coding agent: each server at Filament's door, its token of its spec's account, said in the record by account.
    /** @type {{ name: string, url: string, account?: string, headers?: Record<string, string> }[]} */
    const asked = [{ name: "ci", url: f.url }, { name: "ci2", url: f.url, account: "personal" }, { name: "ci3", url: f.url, account: "work" }];
    const given = s.forAgent(asked, (x) => ({ ...x, url: `door/${x.name}` }));
    assert.deepEqual(given.list.map((x) => x.url), ["door/ci", "door/ci2", f.url], "an account with no sign-in goes as it is: its server asks");
    assert.match(String(await s.auth.header(f.url, {}, "personal")), /^Bearer at-2-\d+$/, "the door adds the account's own");
    assert.deepEqual(given.words, [`mcp: the chat's server ci is given through Filament, with its sign-in on ${host}`, `mcp: the chat's server ci2 is given through Filament, with its sign-in on ${host} as personal`]);
    // Sign out of one: the other stays.
    assert.equal(s.signOut(f.url, "personal").signedOut, true);
    assert.deepEqual(s.stateOf(f.url, {}, "personal"), { state: "asks", host, account: "personal", accounts: ["main"] });
    assert.deepEqual(s.stateOf(f.url, {}), { state: "in", host, account: "main", accounts: ["main"] });
    assert.match(String(await s.auth.header(f.url, {})), /^Bearer at-1-\d+$/);
    assert.equal(await s.auth.header(f.url, {}, "personal"), null);
    // Every account at once: what removing the last server at the address does.
    await s.back((await pressAllow((await s.start({ name: "ci", url: f.url, account: "personal" })).url)).searchParams);
    assert.deepEqual(s.signOutEvery(f.url), { signedOut: true });
    assert.deepEqual([s.stateOf(f.url, {})?.state, s.stateOf(f.url, {}, "personal")?.state, s.stateOf(f.url, {})?.accounts], ["asks", "asks", []]);
  });

  test("an account's name is refused in words before anything is asked of the server", async () => {
    const f = await fake();
    const s = signIns();
    await assert.rejects(s.start({ name: "ci", url: f.url, account: "a/b" }), (/** @type {any} */ e) => e.status === 400 && e.message === 'An account\'s name is letters, digits, space, . _ -, 32 at most ("main" is the first\'s), not "a/b"');
    assert.deepEqual([f.seen.mcpAuth.length, f.seen.registered.length], [0, 0]);
  });
});

describe("the rows a project's Connections sheet calls", () => {
  const dir = fresh("rows");
  const folder = mkdtempSync(join(dir, "project-"));
  const config = createConfigStore({ dataDir: dir });
  config.set({ ...config.get(), memory: { ...config.get().memory, enabled: true } });
  const memory = new MemoryService(/** @type {any} */ ({
    sidecar, getConfig: config.get, dataDir: dir, log: () => {}, selfBase: () => "http://127.0.0.1:20399", getModelNames: () => ["cheap"], now: Date.now,
  }));
  memory.start();
  const record = { record: () => {}, list: () => [] };
  const sessions = createSessions(/** @type {any} */ ({ memory, config, pipeline: { handle() {} }, ops: record, log: () => {}, forkSession: async () => ({}), mcpTests: new Map() }));
  const mcpSignIns = createMcpSignIns({ store: createSignInStore({ dataDir: dir }), selfBase: () => "http://127.0.0.1:4321" });
  const mcpServers = createMcpServers({ sessions, memory, config, home: dir, signIns: mcpSignIns });
  const a = { mcpServers, mcpSignIns, config };
  const route = createRouter(mcpServerRoutes(a));
  /** A row answered, as the admin handler hands it a path. @param {string} method @param {string} path @param {any} [body] */
  const call = async (method, path, body = undefined) => {
    const url = new URL(`http://x${path.replace(/^\/api(?=\/)/, "")}`);
    const m = route(method, url.pathname);
    assert.ok(m, `${method} ${path} has a row`);
    let out = "";
    let status = 0;
    const res = /** @type {any} */ ({
      headersSent: false,
      setHeader() {},
      writeHead(/** @type {number} */ s) { status = s; this.headersSent = true; return this; },
      write(/** @type {string} */ c) { out += c; },
      end(/** @type {string} */ c = "") { out += c; },
      on() {},
    });
    const req = { headers: {}, method, socket: { remoteAddress: "127.0.0.1" }, on() {} };
    await m.handler({ req, res, url, path: url.pathname, method, params: m.params, json: async () => body }, a);
    let parsed = null;
    try {
      parsed = out ? JSON.parse(out) : null;
    } catch {}
    return { status, text: out, body: parsed };
  };
  const chat = sessions.create({ cwd: folder, model: "cheap" });
  const projectScope = `project:${chat.projectId}`;
  const enc = encodeURIComponent(projectScope);
  const rowOf = async (/** @type {string} */ scope, /** @type {string} */ name) => (await call("GET", `/mcp-servers?scope=${encodeURIComponent(scope)}`)).body.servers.find((/** @type {any} */ s) => s.name === name);
  /** A sign-in through the rows, the browser's return included. @param {string} scope @param {string} name @param {string} [account] */
  const signInRows = async (scope, name, account) => {
    const st = (await call("POST", "/mcp-servers/sign-in", { scope, name, ...(account ? { account } : {}) })).body;
    const back = await pressAllow(st.url);
    const page = await call("GET", `${back.pathname}${back.search}`);
    assert.equal(page.status, 200, page.text);
    return page;
  };
  /** @type {any} */
  let f;
  after(() => memory.shutdown());

  test("a project signs in as another account: Sign in with another account… keeps it beside main and picks it for the project alone; Use picks it back; ↺ takes the pick away", async () => {
    f = await fake();
    const host = new URL(f.url).host;
    await call("PUT", "/mcp-servers/all/ci", { url: f.url });
    await signInRows("all", "ci");
    let row = await rowOf(projectScope, "ci");
    assert.deepEqual([row.account, row.pickedHere, row.signIn], ["main", false, { state: "in", host, account: "main", accounts: ["main"] }]);
    const page = await signInRows(projectScope, "ci", "personal");
    assert.match(page.text, /Signed in to ci as personal: you can close this tab and go back to Filament\./);
    row = await rowOf(projectScope, "ci");
    assert.deepEqual([row.account, row.pickedHere, row.signIn], ["personal", true, { state: "in", host, account: "personal", accounts: ["main", "personal"] }]);
    const all = await rowOf("all", "ci");
    assert.deepEqual([all.account, all.pickedHere, all.signIn.account], ["main", false, "main"], "all chats keep main");
    // What the project's dashboards and chats are given: the server as its account.
    const got = mcpServers.serverFor(chat.projectId, "ci");
    assert.deepEqual(got.ok && got.spec, { name: "ci", url: f.url, account: "personal" });
    const c = await connectMcp(/** @type {any} */ (got.ok && got.spec), { timeoutMs: 10_000, auth: mcpSignIns.auth });
    assert.equal(await c.call("whoami", {}), "signed in as test-user (grant 2)");
    await c.close();
    // Use main: the pick says what beneath says, so it goes; Use personal picks it again; ↺ takes it away.
    let r = await call("PUT", `/mcp-servers/${enc}/ci`, { account: "main" });
    assert.deepEqual([r.status, r.body.servers.find((/** @type {any} */ x) => x.name === "ci").pickedHere], [200, false]);
    r = await call("PUT", `/mcp-servers/${enc}/ci`, { account: "personal" });
    assert.equal(r.body.servers.find((/** @type {any} */ x) => x.name === "ci").account, "personal");
    r = await call("DELETE", `/mcp-servers/${enc}/ci`);
    assert.deepEqual([r.body.servers.find((/** @type {any} */ x) => x.name === "ci").account, r.body.signedOut], ["main", undefined], "a pick taken away signs nothing out");
    assert.equal(mcpSignIns.stateOf(f.url, {}, "personal")?.state, "in");
  });

  test("refused in words: an account's name, an account for a program, a server no layer has; a project's own server keeps its account on itself", async () => {
    let r = await call("PUT", `/mcp-servers/${enc}/ci`, { account: "a/b" });
    assert.deepEqual([r.status, r.body.error], [400, 'An account\'s name is letters, digits, space, . _ -, 32 at most ("main" is the first\'s), not "a/b"']);
    await call("PUT", "/mcp-servers/all/local", { command: "node", args: ["srv.js"] });
    r = await call("PUT", `/mcp-servers/${enc}/local`, { account: "work" });
    assert.deepEqual([r.status, r.body.error], [400, "local runs on this computer: it signs in its own way, with no account of Filament's"]);
    await call("DELETE", "/mcp-servers/all/local");
    r = await call("PUT", `/mcp-servers/${enc}/nope`, { account: "work" });
    assert.equal(r.status, 404);
    r = await call("POST", "/mcp-servers/sign-in", { scope: projectScope, name: "ci", account: "a/b" });
    assert.equal(r.status, 400);
    // The project's own server at the same address: its account on its entry; no ↺, since nothing beneath is picked over.
    await call("PUT", `/mcp-servers/${enc}/own`, { url: f.url });
    r = await call("PUT", `/mcp-servers/${enc}/own`, { account: "personal" });
    const own = r.body.servers.find((/** @type {any} */ x) => x.name === "own");
    assert.deepEqual([own.own, own.account, own.pickedHere, own.spec.account, own.signIn.state], [true, "personal", false, "personal", "in"]);
  });

  test("Sign out from a project's row signs out of its account alone; Remove of the last server at the address signs out of every account", async () => {
    let r = await call("POST", "/mcp-servers/sign-out", { scope: projectScope, name: "own" });
    assert.equal(r.body.signedOut, true);
    assert.deepEqual([(await rowOf(projectScope, "own")).signIn.state, (await rowOf("all", "ci")).signIn.state], ["asks", "in"], "personal signed out; main stays");
    r = await call("DELETE", "/mcp-servers/all/ci");
    assert.equal(r.body.signedOut, undefined, "the project's own server still names the address");
    r = await call("DELETE", `/mcp-servers/${enc}/own`);
    assert.equal(r.body.signedOut, true);
    assert.deepEqual([mcpSignIns.stateOf(f.url, {})?.state, mcpSignIns.stateOf(f.url, {})?.accounts], ["asks", []]);
  });

  // (fails before: yes — found by the Hunter on S4b: Edit's Save wrote the server with no account, so a project picking
  // personal signed in as main; Test tested main's; a switch turned on over a pick kept no `enabled`, so the server
  // stayed off beneath)
  test("Edit's Save and Test keep the account a place signs in with; a switch rides on a pick, over a server switched off beneath", async () => {
    await call("PUT", `/mcp-servers/${enc}/own`, { url: f.url });
    await call("PUT", `/mcp-servers/${enc}/own`, { account: "personal" });
    await signInRows(projectScope, "own");
    // The editor's Save names no account: the one picked here stays.
    let r = await call("PUT", `/mcp-servers/${enc}/own`, { name: "own", url: f.url });
    assert.equal(r.body.servers.find((/** @type {any} */ x) => x.name === "own").account, "personal");
    // Its Test, as the editor sends it, tests the account it signs in with here: the row's dot is that test's.
    r = await call("POST", "/mcp-servers/test", { scope: projectScope, server: { name: "own", url: f.url } });
    assert.equal(r.body.ok, true, r.text);
    assert.equal((await rowOf(projectScope, "own")).test?.ok, true, "the row signs in as personal: its test is the one kept");
    await call("DELETE", `/mcp-servers/${enc}/own`);
    // An inherited server, off for all chats; the project picks an account, then switches it on, then off again.
    await call("PUT", "/mcp-servers/all/ci", { url: f.url, enabled: false });
    r = await call("PUT", `/mcp-servers/${enc}/ci`, { account: "personal" });
    let row = r.body.servers.find((/** @type {any} */ x) => x.name === "ci");
    assert.deepEqual([row.on, row.account, row.pickedHere], [false, "personal", true]);
    r = await call("PUT", `/mcp-servers/${enc}/ci`, { enabled: true });
    row = r.body.servers.find((/** @type {any} */ x) => x.name === "ci");
    assert.deepEqual([row.on, row.account, row.pickedHere], [true, "personal", true], "on for this project, as personal");
    assert.equal(mcpServers.serverFor(chat.projectId, "ci").ok, true, "its dashboards reach it");
    r = await call("PUT", `/mcp-servers/${enc}/ci`, { enabled: false });
    row = r.body.servers.find((/** @type {any} */ x) => x.name === "ci");
    assert.deepEqual([row.on, row.account, row.switchedHere], [false, "personal", false], "off as beneath: the pick alone stays");
    await call("DELETE", `/mcp-servers/${enc}/ci`);
    await call("DELETE", "/mcp-servers/all/ci");
  });

  // (fails before: yes — found by the Hunter on S4b: removed from all chats, a chat's own server at the same address
  // lost its sign-in, since only all chats' and the projects' lists were asked)
  test("Remove from all chats leaves the sign-ins that a chat's own server at the address still uses", async () => {
    const chatScope = encodeURIComponent(`chat:${chat.id}`);
    await call("PUT", "/mcp-servers/all/ci", { url: f.url });
    await signInRows("all", "ci");
    await call("PUT", `/mcp-servers/${chatScope}/mine`, { url: f.url });
    let r = await call("DELETE", "/mcp-servers/all/ci");
    assert.deepEqual([r.status, r.body.signedOut, mcpSignIns.stateOf(f.url, {})?.state], [200, undefined, "in"], "the chat's own server still names the address");
    r = await call("DELETE", `/mcp-servers/${chatScope}/mine`);
    assert.equal(r.body.signedOut, true, "the last server at the address: every account signed out");
  });
});

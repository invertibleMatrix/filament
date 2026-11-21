// @ts-check
// An App (the owner's of 10-29: "a dynamic dashboard of anything, an app inside Filament, which the agent can drive"): a
// page the agent writes whole, with a dashboard's sources, watches and buttons beside it in content.json — published,
// shown in its project's Space as a draft, kept, its sources read at its own address, its buttons' runs followed as
// they go, and its page's own `filament` that reads them and asks for a button through the harness.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTENT_JSON, runsItself } from "../src/core/artifacts.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { JOBS_KEPT, createDashboardRunner } from "../src/services/dashboard-runner.js";
import { runActionCommand } from "../src/adapters/tools/source-command.js";
import { ALONE_ACT_WORDS, FRESH_MS, PAGE_SCRIPT_TEXT, createArtifactsHandler } from "../src/http/artifacts.js";
import { ARTIFACT_GUIDE, ARTIFACT_TOOL, artifactCall } from "../src/app/agent/artifacts.js";
import { dashboardWords, dashboardsWords } from "../src/app/agent/space-dashboard.js";
import { changeWords, fixWords } from "../src/ui/harness/space/dashboards.js";
import { barOf } from "../src/ui/harness/lib/space-dashboards.js";

const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), "filament-apps-"));
  dirs.push(d);
  return d;
};

/** A build pipeline, as an agent publishes it: its page and a script beside it; the repository and CI's runs; two buttons. */
const PIPE = {
  type: "app",
  title: "Pipeline",
  html: '<!doctype html><html><head><title>Pipeline</title></head><body><main id="app"></main><script src="app.js"></script></body></html>',
  files: [{ path: "app.js", content: 'filament.source("repo");' }],
  sources: {
    repo: { command: ["node", "reads/repo.mjs"], rows: "repo", key: "key", every: "1m" },
    runs: { command: ["node", "github.mjs", "runs"], rows: "runs", key: "id", every: "2m" },
  },
  actions: {
    build: { label: "Build…", on: "repo", command: ["node", "actions/build.mjs"], says: "Build Filament {row.version}?" },
    rerun: { label: "Re-run…", on: "runs", only: { status: "completed" }, command: ["node", "github.mjs", "rerun", "{row.id}"], check: { "row.id": "^\\d+$" }, says: "Re-run {row.title}?" },
  },
};
const NAME = "pipeline-ab12";

/**
 * A world for the runner: an artifact store, a Space store, a clock; the sources' commands answered by their script,
 * each run counted; a button's command saying what `says` holds, a piece at a time, and ending as `ends` says.
 */
function worldOf() {
  const clock = { at: Date.UTC(2026, 9, 29, 14, 0) };
  const now = () => clock.at;
  const artifacts = createArtifactStore({ dataDir: fresh(), log: () => {}, now, four: (() => { const f = ["ab12", "cd34", "ef56"]; return () => f.shift() || "zzzz"; })() });
  const spaces = createSpaceStore({ dir: null, now });
  /** @type {string[]} */
  const ran = [];
  /** @type {import("../src/core/dashboard-sources.js").RunCommand} */
  const run = async (argv) => {
    ran.push(argv.join(" "));
    if (argv[1] === "reads/repo.mjs") return { ok: true, out: JSON.stringify({ repo: [{ key: "here", version: "0.1.1", branch: "main" }] }) };
    if (argv[1] === "github.mjs") return { ok: true, out: JSON.stringify({ runs: [{ id: 42, title: "Build", status: "completed" }] }) };
    return { ok: false, error: `${argv[0]} was not found on this computer` };
  };
  const says = ["Typecheck…\n", "Installer built\n"];
  /** @type {{ ok: boolean, error?: string }} */
  const ends = { ok: true };
  /** @type {import("../src/core/dashboard-sources.js").RunAction} */
  const act = async (_argv, _cwd, _signal, onData) => {
    for (const s of says) onData?.(s);
    const said = says.join("");
    return ends.ok ? { ok: true, said } : { ok: false, error: String(ends.error), said };
  };
  const runner = createDashboardRunner({ spaces, artifacts, folderOf: (p) => (p === "p1" ? "/work/filament" : null), projectOfChain: (c) => (c.startsWith("c") ? "p1" : null), now, run, act });
  /** A version published by a chat of p1, or what was refused. @param {any} input */
  const publish = (input) => artifactCall({ action: "publish", ...input }, { who: "c1", by: { chain: "c1", model: "m-1", folder: "/work/filament", helper: null }, within: [], port: 20300, maxBytes: 1_000_000 }, artifacts);
  return { clock, artifacts, spaces, ran, says, ends, runner, publish };
}

describe("an app: its page, and what it reads and runs beside it", () => {
  // (fails before: yes — "app" was no type: Filament made page, doc, slides, dashboard and design)
  test("published by its page with its sources, watch and actions, kept in content.json beside its files; a wrong part refused in words", () => {
    const w = worldOf();
    const r = w.publish(PIPE);
    assert.ok(r.ok, r.ok ? "" : r.error);
    const a = /** @type {any} */ (w.artifacts.get(NAME));
    assert.equal(a.type, "app");
    assert.deepEqual(a.versions[0].files.map((/** @type {any} */ f) => f.path), ["index.html", "app.js", CONTENT_JSON]);
    assert.deepEqual(JSON.parse(String(w.artifacts.file(NAME, 1, CONTENT_JSON))), { sources: PIPE.sources, actions: PIPE.actions }, "Filament's, as given");
    /** @param {any} input */
    const no = (input) => {
      const x = w.publish(input);
      return x.ok ? "" : x.error;
    };
    assert.match(no({ ...PIPE, tiles: [{ kind: "number", title: "N", value: 1 }] }), /^Not published: an app is given by its page — html or folder — with sources, watch and actions; tiles is for a dashboard/);
    assert.equal(no({ ...PIPE, files: [{ path: "content.json", content: "{}" }] }), `Not published: ${CONTENT_JSON} beside an app's page is Filament's — its sources, watch and actions, given by those fields. Name the page's own file otherwise.`);
    assert.match(no({ ...PIPE, sources: { repo: { command: [] } } }), /^Not published: the source repo has no command/);
    assert.match(no({ ...PIPE, actions: { build: { ...PIPE.actions.build, on: "nope" } } }), /^Not published: the button build acts on nope: it acts on the rows of one of the sources \(repo, runs\)/);
    assert.match(no({ type: "page", title: "P", html: "<p>x</p>", sources: PIPE.sources }), /sources is for a dashboard or an app — a new one names its type \("dashboard" or "app"\)\.$/);
    // A dashboard given html is pointed at an app too, which keeps its sources and buttons, not at a page alone (found by
    // the Hunter on apps). (fails before: yes — it said "A page of your own HTML is type "page".")
    for (const k of ["html", "files", "folder"]) {
      const given = k === "html" ? "<p>x</p>" : k === "files" ? [{ path: "index.html", content: "<p>x</p>" }] : "/work/filament/.filament/apps/x";
      assert.match(no({ type: "dashboard", title: "D", tiles: [{ kind: "number", title: "N", value: 1 }], [k]: given }), new RegExp(`so leave ${k} out\\. A page or an app of your own HTML is type "page" or "app"\\.$`));
    }
    assert.equal(no({ id: NAME, type: "page", html: "<p>x</p>" }), "Not published: Pipeline is an app, and a next version keeps its type. Make a new artifact for a page.");
    // Its next version is its page again, whole, with what it reads.
    const read = artifactCall({ action: "read", id: NAME }, { who: "c1", by: { chain: "c1", model: "m-1", folder: "/work/filament", helper: null }, within: [], port: 20300, maxBytes: 1_000_000 }, w.artifacts);
    assert.ok(read.ok);
    assert.match(read.ok ? read.text : "", /^Pipeline — pipeline-ab12, an app, version 1 of 1 \(the newest\)/);
    assert.match(read.ok ? read.text : "", /\nReads: by itself once kept in its project's Space, its sources repo, runs\n/);
    assert.ok(runsItself("app") && runsItself("dashboard") && !runsItself("page"));
  });

  // (fails before: yes — the same: there was no guide for one)
  test("its guide says how its page reads and asks through filament; the tool names it", () => {
    const g = /** @type {any} */ (ARTIFACT_GUIDE).app;
    for (const said of ['filament.source("runs")', 'filament.refresh("runs")', "filament.onSource", 'filament.act("rerun", row.__key)', "filament.jobs()", "filament.job(id)", "filament.onJob", "filament.stop(id)", '"key":"here"', "Keep…"])
      assert.ok(g.includes(said), said);
    // (fails before: yes — the plan of 10-29: a game's page was not told what its frame lets it)
    for (const said of ["canvas.requestPointerLock()", "document.documentElement.requestFullscreen()", "navigator.getGamepads()", "a process of its own"]) assert.ok(g.includes(said), said);
    // (fails before: yes — the plan of 10-29: an app had no database of its own)
    for (const said of ['filament.sql("SELECT title, n FROM runs WHERE n > ?", [3])', "{ rows, columns, changes, lastId, more }", "10 s a statement", "5000 rows an answer", "1024 MB in all", "1 MB with them (big data goes in several)", "no ATTACH, no VACUUM, no PRAGMA", "CREATE TABLE IF NOT EXISTS"]) assert.ok(g.includes(said), said);
    assert.ok(/** @type {any} */ (ARTIFACT_TOOL.input_schema.properties.type).enum.includes("app"));
    assert.match(/** @type {any} */ (ARTIFACT_TOOL.input_schema.properties.type).description, /or app \(you write the page, with the commands it reads and the buttons it runs/);
    assert.match(ARTIFACT_TOOL.description, /^Make a page, doc, slides, dashboard, design or app the person keeps/);
  });
});

describe("an app in its project's Space", () => {
  // (fails before: yes — a Space showed and ran dashboards alone)
  test("a draft as a dashboard is, its type said; kept, its sources read; a button's run followed as it goes — what it says as it comes, how it ended", async () => {
    const w = worldOf();
    w.publish(PIPE);
    const [d] = w.runner.shown("p1");
    assert.deepEqual([d.name, d.type, d.state], [NAME, "app", "draft"]);
    assert.equal(w.runner.keep("p1", NAME, 1).ok, true);
    const r = await w.runner.read(NAME, 1, "repo");
    assert.deepEqual(r.ok && r.state.rows.map((x) => x.__key), ["here"]);
    /** @type {any[]} */
    const heard = [];
    const stop = w.runner.followJobs((name, e) => heard.push([name, e]));
    const done = await w.runner.act("p1", NAME, "build", "here", {});
    assert.equal(done.ok && done.done, true);
    const [job] = w.runner.jobsOf(NAME);
    assert.deepEqual(job, { id: job.id, action: "build", label: "Build…", key: "here", state: "done", startedAt: w.clock.at, endedAt: w.clock.at, said: "Installer built", by: null }, "its runs, without their logs");
    assert.deepEqual(heard, [
      [NAME, { id: job.id, action: "build", state: "running" }],
      [NAME, { id: job.id, action: "build", chunk: "Typecheck…\n" }],
      [NAME, { id: job.id, action: "build", chunk: "Installer built\n" }],
      [NAME, { id: job.id, action: "build", state: "done" }],
    ]);
    assert.equal(w.runner.jobOf(NAME, job.id)?.log, "Typecheck…\nInstaller built\n");
    assert.equal(w.runner.jobOf(NAME, "nope"), null);
    w.ends.ok = false;
    w.ends.error = "node exited 1: tsc failed";
    await w.runner.act("p1", NAME, "build", "here", {});
    assert.deepEqual([w.runner.jobsOf(NAME)[0].state, w.runner.jobsOf(NAME)[0].said], ["failed", "node exited 1: tsc failed"], "the newest first");
    stop();
    for (let i = 0; i < JOBS_KEPT; i++) await w.runner.act("p1", NAME, "build", "here", {});
    assert.equal(w.runner.jobsOf(NAME).length, JOBS_KEPT, "ten kept");
    assert.equal(heard.length, 8, "a follower stopped hears nothing more");
  });

  // (fails before: yes — a chat's agent and the tab's words called every one a dashboard)
  test("a chat's agent reads it as an app; Fix and Change with an agent… name it so", () => {
    const w = worldOf();
    w.publish(PIPE);
    const list = w.runner.shown("p1");
    assert.match(dashboardsWords(list, w.clock.at), /\n- pipeline-ab12 “Pipeline” \(an app\) · a draft, v1/);
    assert.equal(changeWords(list[0], "filament"), "Change the app “Pipeline” (artifact pipeline-ab12) in filament's Space, and publish its next version: ");
    assert.match(fixWords(list[0], { source: "repo", said: "node exited 1." }, "filament"), /^The app “Pipeline” \(artifact pipeline-ab12\) in filament's Space couldn't read its source repo/);
    // (fails before: yes — found driving it: its bar spoke of sample rows an app has none of)
    assert.equal(barOf(/** @type {any} */ (list[0]), w.clock.at).words, "Draft · nothing reads or runs until you keep it");
  });

  // (fails before: yes — an agent read a dashboard's rows and buttons, never how its runs went)
  test("an agent reading it whole reads its buttons' runs too, the newest first", async () => {
    const w = worldOf();
    w.publish(PIPE);
    w.runner.keep("p1", NAME, 1);
    await w.runner.read(NAME, 1, "repo");
    await w.runner.act("p1", NAME, "build", "here", {});
    w.clock.at += 120_000;
    const seen = await w.runner.seeOf("p1", NAME);
    const words = dashboardWords(/** @type {any} */ (seen), w.clock.at);
    // Each by its id, which "log" reads whole; kept across a restart, so no longer "since Filament started" (10-29).
    const id = /** @type {any} */ (w.runner.jobsOf(NAME)[0]).id;
    assert.match(words, new RegExp(`\\n\\nIts latest runs, the newest first \\("log" reads one's log by its id\\):\\n {2}- ${id}: build on "here" 2 min ago: done, 1 s — Installer built$`));
  });

  // (fails before: yes — a button's command said nothing until it ended)
  test("a button's command hands what it says to its run as it comes", async () => {
    /** @type {string[]} */
    const chunks = [];
    const got = await runActionCommand([process.execPath, "-e", "process.stdout.write('a\\n');setTimeout(()=>process.stderr.write('b\\n'),50)"], process.cwd(), undefined, (c) => chunks.push(c));
    assert.equal(got.ok, true);
    assert.equal(chunks.join(""), "a\nb\n");
  });
});

/**
 * A request to an artifact's address, awaited: its status and its body (JSON where it is).
 * @param {any} answer @param {string} path @param {{ name?: string, method?: string }} [o]
 */
async function ask(answer, path, { name = NAME, method = "GET" } = {}) {
  /** @type {any} */
  const res = { status: 0, headers: {}, body: "", written: /** @type {string[]} */ ([]), writeHead(/** @type {number} */ s, /** @type {any} */ h) { this.status = s; this.headers = h; }, write(/** @type {any} */ x) { this.written.push(String(x)); }, end(/** @type {any} */ b) { this.body = b ? String(b) : ""; } };
  /** @type {(() => void)[]} */
  const closes = [];
  await answer({ method, headers: {}, socket: { remoteAddress: "127.0.0.1" }, on: (/** @type {string} */ ev, /** @type {() => void} */ fn) => void (ev === "close" && closes.push(fn)) }, res, name, new URL(`http://x${path}`));
  res.close = () => closes.forEach((f) => f());
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch {}
  return { res, status: res.status, json };
}

describe("an app's address: its page, its sources and its runs, to it alone", () => {
  // (fails before: yes — an app's address read no source and had no runs)
  test("its page served as a page's; a draft's source refused with why; kept, read — again when asked fresh, past ten seconds —; its runs and their news", async () => {
    const w = worldOf();
    w.publish(PIPE);
    w.publish({ type: "doc", title: "Notes", markdown: "# N\n" });
    const handler = createArtifactsHandler({ store: w.artifacts, server: () => ({ host: "127.0.0.1", allowedHosts: [] }), port: () => 20300, dashboards: w.runner });
    const page = await ask(handler, "/?in=space");
    assert.equal(page.status, 200);
    assert.ok(page.res.body.includes('<main id="app"></main>') && page.res.body.includes("/_filament/page.js"), "its own page, Filament's script first");
    // (fails before: yes — measured on Electron 45: one app's busy page stalled another app's frame as long as it ran)
    // Its page asks a process of its own; a page that is no app keeps its site's one.
    assert.equal(page.res.headers["origin-agent-cluster"], "?1");
    const plain = /** @type {any} */ (w.publish({ type: "page", title: "Plain", html: "<p>x</p>" }));
    const plainPage = await ask(handler, "/", { name: plain.event.name });
    assert.deepEqual([plainPage.status, plainPage.res.headers["origin-agent-cluster"]], [200, undefined]);
    assert.deepEqual((await ask(handler, "/_filament/sources/repo")).json, { error: "Pipeline does not read repo now: it is not kept in a Space: nothing reads until it is.", off: "draft" });
    w.runner.keep("p1", NAME, 1);
    const got = await ask(handler, "/_filament/sources/repo");
    assert.deepEqual([got.status, got.json.rows.length, w.ran.length], [200, 1, 1]);
    w.clock.at += FRESH_MS / 2;
    await ask(handler, "/_filament/sources/repo?fresh=1");
    assert.equal(w.ran.length, 1, "read a moment ago: its rows as read");
    w.clock.at += FRESH_MS;
    await ask(handler, "/_filament/sources/repo?fresh=1");
    assert.equal(w.ran.length, 2, "asked fresh: read again");
    await ask(handler, "/_filament/sources/repo");
    assert.equal(w.ran.length, 2, "else at its every");
    w.runner.change("p1", NAME, { paused: true });
    assert.deepEqual((await ask(handler, "/_filament/sources/repo")).json, { error: "Pipeline does not read repo now: it is paused.", off: "paused" });
    w.runner.change("p1", NAME, { paused: false });
    const stream = await ask(handler, "/_filament/job-changes");
    assert.deepEqual([stream.status, stream.res.written], [200, [": following\n\n"]]);
    await w.runner.act("p1", NAME, "build", "here", {});
    const [job] = (await ask(handler, "/_filament/jobs")).json.jobs;
    assert.deepEqual(stream.res.written.slice(1).map((x) => JSON.parse(x.replace(/^data: /, ""))), [
      { id: job.id, action: "build", state: "running" },
      { id: job.id, action: "build", chunk: "Typecheck…\n" },
      { id: job.id, action: "build", chunk: "Installer built\n" },
      { id: job.id, action: "build", state: "done" },
    ]);
    stream.res.close();
    assert.equal((await ask(handler, `/_filament/jobs/${job.id}`)).json.job.log, "Typecheck…\nInstaller built\n");
    assert.deepEqual(await ask(handler, "/_filament/jobs/nope").then((x) => [x.status, x.json]), [404, { error: "Pipeline has no run nope: it keeps its newest runs alone, across a restart too." }]);
    assert.deepEqual((await ask(handler, "/_filament/jobs", { name: "notes-cd34" })).json, { error: "Notes runs no button." });
    assert.equal((await ask(handler, "/_filament/jobs", { method: "POST" })).status, 405);
  });
});

/**
 * Filament's page script run in a stand-in window at a path of its address: what it fetched, said to its parent, the
 * streams it opened and the notes it showed.
 * @param {{ framed?: boolean, path?: string, answer?: (url: string) => { status: number, body: any } }} [o]
 */
function pageAt({ framed = true, path = "/", answer = () => ({ status: 200, body: { rows: [] } }) } = {}) {
  /** @type {string[]} */
  const fetched = [];
  /** @type {any[]} */
  const said = [];
  /** @type {any[]} */
  const streams = [];
  /** @type {any[]} */
  const notes = [];
  /** @type {any[]} */
  const posted = [];
  const el = () => ({ style: {}, textContent: "", setAttribute() {}, addEventListener() {}, remove() {} });
  const document = {
    documentElement: { setAttribute() {}, appendChild() {} },
    currentScript: null,
    createElement: (/** @type {string} */ tag) => (tag === "canvas" ? { getContext: () => null } : el()),
    addEventListener() {},
    body: { appendChild: (/** @type {any} */ n) => void notes.push(n) },
  };
  const media = () => ({ matches: false, addEventListener() {} });
  /** @type {any} */
  const win = {
    name: "",
    location: { href: `http://pipeline-ab12.art.localhost:20300${path}`, origin: "http://pipeline-ab12.art.localhost:20300", protocol: "http:", pathname: path },
    fetch: async (/** @type {string} */ url, /** @type {any} */ init) => {
      fetched.push(url);
      if (init?.method === "POST") posted.push({ url, type: init.headers?.["content-type"], body: JSON.parse(init.body) });
      const a = answer(url);
      return { ok: a.status < 400, status: a.status, json: async () => a.body };
    },
    EventSource: function (/** @type {string} */ url) {
      const s = { url, closed: false, onmessage: /** @type {any} */ (null), close() { this.closed = true; } };
      streams.push(s);
      return s;
    },
    setTimeout: () => 0,
    matchMedia: media,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    addEventListener() {},
    document,
    URL,
  };
  win.window = win;
  win.parent = framed ? { postMessage: (/** @type {any} */ m) => said.push(JSON.parse(JSON.stringify(m))) } : win;
  vm.runInContext(PAGE_SCRIPT_TEXT, vm.createContext(win));
  return { filament: win.filament, fetched, said, streams, notes, posted };
}

describe("an app's page: filament", () => {
  // (fails before: yes — a page's filament had db and ask alone)
  test("reads its sources at the version its page is, fresh when asked; a refusal carries why; hears its sources and runs", async () => {
    const p = pageAt({ path: "/_filament/v/2/" });
    assert.deepEqual(await p.filament.source("repo"), { rows: [] });
    await p.filament.refresh("repo");
    await p.filament.source("runs", { fresh: true });
    await p.filament.jobs();
    assert.deepEqual(p.fetched, ["/_filament/sources/repo?v=2", "/_filament/sources/repo?v=2&fresh=1", "/_filament/sources/runs?v=2&fresh=1", "/_filament/jobs"]);
    const newest = pageAt({ answer: (url) => (url.startsWith("/_filament/sources/") ? { status: 409, body: { error: "Pipeline does not read repo now: it is paused.", off: "paused" } } : { status: 200, body: { job: { id: "j1", log: "ok" } } }) });
    await assert.rejects(newest.filament.source("repo"), (/** @type {any} */ e) => e.message === "Pipeline does not read repo now: it is paused." && e.off === "paused");
    assert.deepEqual(await newest.filament.job("j1"), { id: "j1", log: "ok" });
    assert.equal(newest.fetched.at(-1), "/_filament/jobs/j1");
    /** @type {any[]} */
    const runs = [];
    const off = newest.filament.onJob((/** @type {any} */ e) => runs.push(JSON.parse(JSON.stringify(e))));
    newest.filament.onSource(() => {});
    assert.deepEqual(newest.streams.map((s) => s.url), ["/_filament/job-changes", "/_filament/source-changes"]);
    newest.streams[0].onmessage({ data: JSON.stringify({ id: "j1", action: "build", chunk: "hi\n" }) });
    assert.deepEqual(runs, [{ id: "j1", action: "build", chunk: "hi\n" }]);
    off();
    assert.equal(newest.streams[0].closed, true, "its last listener gone, its stream closed");
  });

  // (fails before: yes — the Space Apps plan of 10-29: an app had no database of its own)
  test("its own SQLite database: a statement and its values sent to its own address, its rows back; a refusal carries why", async () => {
    const p = pageAt({ answer: (url) => (url === "/_filament/sql" ? { status: 200, body: { rows: [{ n: 2 }], columns: ["n"], changes: 0, lastId: null, more: false } } : { status: 200, body: {} }) });
    assert.deepEqual(JSON.parse(JSON.stringify(await p.filament.sql("SELECT count(*) AS n FROM runs WHERE title = ?", ["build"]))), { rows: [{ n: 2 }], columns: ["n"], changes: 0, lastId: null, more: false });
    await p.filament.sql("CREATE TABLE t (x)");
    assert.deepEqual(p.posted, [
      { url: "/_filament/sql", type: "application/json", body: { sql: "SELECT count(*) AS n FROM runs WHERE title = ?", params: ["build"] } },
      { url: "/_filament/sql", type: "application/json", body: { sql: "CREATE TABLE t (x)", params: null } },
    ]);
    const no = pageAt({ answer: () => ({ status: 400, body: { error: "Not run: no such table: runs." } }) });
    await assert.rejects(no.filament.sql("SELECT * FROM runs"), (/** @type {any} */ e) => e.message === "Not run: no such table: runs.");
  });

  // (fails before: yes — the same)
  test("a button and a stop only asked of the harness, framed; alone in a browser, a note", () => {
    const p = pageAt();
    p.filament.act("rerun", { __key: "42", title: "Build" });
    p.filament.act("build", "here");
    p.filament.stop("j1");
    assert.deepEqual(p.said.filter((m) => m.kind !== "here"), [
      { kind: "act", action: "rerun", key: "42", filament: "artifact" },
      { kind: "act", action: "build", key: "here", filament: "artifact" },
      { kind: "stop", id: "j1", filament: "artifact" },
    ]);
    const alone = pageAt({ framed: false });
    alone.filament.act("build", "here");
    assert.deepEqual([alone.said.length, alone.notes.map((n) => n.textContent)], [0, [ALONE_ACT_WORDS]]);
  });

  // (fails before: yes — the harness heard no stop, and let any page in a Space's tab fill the screen)
  // (fails before: yes — the plan of 10-29: a game's page could not lock the pointer, fill the screen or read a gamepad,
  // and a broken version offered no way back)
  test("in its Space's tab: a stop heard after a click in the page alone; an app's page never asks Filament to fill the screen, but has a game's frame; a broken version offers the one before (pinned in the source)", () => {
    const frame = readFileSync("src/ui/harness/artifact-frame.js", "utf8");
    assert.match(frame, /if \(m\.kind === "stop"\) \{\n\s+\/\/[^\n]*\n\s+if \(o\.onStop && clickedIn\(frame\)\) o\.onStop\(\);/);
    assert.match(frame, /sandbox: o\.app \? APP_FRAME_SANDBOX : FRAME_SANDBOX, allow: o\.app \? APP_FRAME_ALLOW : FRAME_ALLOW,/);
    assert.match(frame, /framed\.get\(f\)\?\.again\(p\.v\);/, "a publish tells its frames which version it was");
    assert.match(frame, /again: \(v\) => \{\n\s+if \(v\) heardV = Math\.max\(heardV, v\);\n\s+show\(\);/);
    assert.match(frame, /const back = o\.back\?\.\(heardV \|\| null\);\n\s+if \(back\) parts\.push\(h\("button", \{ class: "visual-tell artifact-back"[^\n]*onclick: \(\) => back\.go\(\) \}, `Back to v\$\{back\.v\}`\)\);/, "beside Tell the agent, on a failure alone");
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    // A failure's Tell the agent fills the Start in the Space; what the page asks goes the Space page's way (11-04).
    assert.match(app, /artifactFrame\(name, \{ title, onTell: tell, onAsk: ask, mayFill: \(\) => !more\.app, within: "space", onAct, onStop: more\.onStop, app: more\.app, back: more\.back \}\)/);
    const tabs = readFileSync("src/ui/harness/space/dashboards.js", "utf8");
    assert.match(tabs, /\{ app: d\.type === "app", onStop: \(\) => void stopRun\(name\), back \}/);
    assert.match(tabs, /await api\(`\/artifacts\/\$\{encodeURIComponent\(d\.name\)\}\/newest`, \{ method: "POST", body: \{ v \} \}\);/, "Back publishes it again, as Make this the newest does");
  });
});

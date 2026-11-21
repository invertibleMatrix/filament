// @ts-check
// HarnessV3-Launch LD-D8 (F12): a project is shown in words — its folder's name, with the folder and the id in its
// tooltip — wherever the dashboard names one: Home's Where you left off, Memory → Sessions (the detail and its export),
// the always-allow offers and Usage's By project, and the Assistant's usage answer. And By project is filled: every
// request memory situates in a folder books on that folder's project (the record never said which, so the table had
// said "Nothing yet" since it was built).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";
import { projectIdOf } from "../src/core/project-id.js";
import { projectWords } from "../src/ui/lib/format.js";
import { Assistant } from "../src/app/assistant.js";
import { UsageStore } from "../src/services/records.js";

const read = (/** @type {string} */ f) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", f), "utf8");

describe("a project's spend is booked on it, and every page names it", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  const plain = () => anthropicReply("", { model: "m-1", stop: "end_turn", blocks: [{ type: "text", text: "ok." }], usage: { input_tokens: 30, output_tokens: 7 } });
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-words-"));
    up = await fakeUpstream(async () => plain());
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });
  /** A fresh folder under the test's root, spelled as the disk spells it. @param {string} name */
  const folder = (name) => {
    const p = join(root, name);
    mkdirSync(p);
    return realpathSync.native(p);
  };
  const summary = async () => (await shim.api("/api/usage/summary?hours=24")).json();
  /** A harness session in `cwd` with one turn done. @param {string} cwd */
  const sessionWithATurn = async (cwd) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd, model: "m-1" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    return id;
  };

  // (fails before: yes — the record kept no project, so By project stayed empty)
  test("a harness session's turn books on its project, named by its folder", async () => {
    const cwd = folder("shop-api");
    const id = await sessionWithATurn(cwd);
    const pid = projectIdOf(cwd);
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.equal(tr.project?.id, pid, "the session's project is its folder's");
    const s = await summary();
    const b = s.byProject[pid];
    assert.ok(b, `no bucket for the session's project: ${JSON.stringify(s.byProject)}`);
    assert.equal(b.requests, 1, "its one model call — the turn's own record is no model call (LD-D9)");
    assert.equal(b.output, 7);
    assert.equal(b.name, "shop-api", "the folder's name rides on the bucket");
    assert.equal(projectIdOf(b.cwd), pid, "and the folder itself");
  });

  // (fails before: yes — no bucket at all)
  test("a client's own request books on the folder it names; one that names no folder books on no project", async () => {
    const cwd = folder("web-app");
    const was = await summary();
    const ua = { "user-agent": "claude-cli/2.1" };
    const a = await shim.post("/v1/messages", { model: "m-1", max_tokens: 50, messages: [{ role: "user", content: "hi" }] }, { ...ua, "x-filament-cwd": cwd });
    assert.equal(a.status, 200, await a.clone().text());
    const b = await shim.post("/v1/messages", { model: "m-1", max_tokens: 50, messages: [{ role: "user", content: "hi, nowhere" }] }, ua);
    assert.equal(b.status, 200, await b.clone().text());
    const s = await summary();
    assert.equal(s.requests, was.requests + 2, "both were model calls");
    assert.equal(s.byProject[projectIdOf(cwd)]?.requests, 1, JSON.stringify(s.byProject));
    assert.equal(s.byProject[projectIdOf(cwd)]?.name, "web-app");
    assert.equal(s.byProject.none, undefined, "a request that named no folder makes no bucket");
    assert.deepEqual(Object.keys(s.byProject).sort(), [...Object.keys(was.byProject), projectIdOf(cwd)].sort());
  });

  // (fails before: yes — the detail carried the chain's raw project id alone)
  test("a session's detail names its project", async () => {
    const cwd = folder("billing");
    const id = await sessionWithATurn(cwd);
    const d = await (await shim.api(`/api/memory/sessions/${encodeURIComponent(id)}`)).json();
    assert.equal(d.project?.id, projectIdOf(cwd));
    assert.equal(d.project?.name, "billing");
    assert.equal(projectIdOf(d.project?.cwd), projectIdOf(cwd));
  });

  // (fails before: yes — memory had no way to name a project by its id)
  test("memory names a project by its id: none is no project, an id it does not know keeps the id", () => {
    const cwd = folder("docs-site");
    shim.app.memory.archive.ensureProject(cwd);
    const pid = projectIdOf(cwd);
    const named = shim.app.memory.projectNamed(pid);
    assert.equal(named?.id, pid);
    assert.equal(named?.name, "docs-site");
    assert.equal(projectIdOf(named?.cwd), pid);
    assert.equal(shim.app.memory.projectNamed("none"), null);
    assert.equal(shim.app.memory.projectNamed(""), null);
    assert.equal(shim.app.memory.projectNamed(null), null);
    assert.deepEqual(shim.app.memory.projectNamed("ffffffffffff"), { id: "ffffffffffff", name: null, cwd: null });
  });

  // (fails before: yes — an offer carried its project's id alone)
  test("an always-allow offer names its project", async () => {
    const cwd = folder("infra");
    const pid = projectIdOf(cwd);
    shim.app.memory.archive.ensureProject(cwd);
    shim.app.memory.archive.items.add({ projectId: pid, kind: "permission", text: "bash: npm test", status: "inferred", importance: 0.8, origin: "learner" });
    const { items } = await (await shim.api("/api/memory/items?kind=permission&status=inferred")).json();
    const it = items.find((/** @type {any} */ x) => x.text === "bash: npm test");
    assert.ok(it, JSON.stringify(items));
    assert.equal(it.project_id, pid);
    assert.equal(it.projectName, "infra");
    assert.equal(projectIdOf(it.projectCwd), pid);
  });
});

// (fails before: yes — the Assistant read By project as ids under the name `name`)
test("the Assistant's usage answer names each project and keeps its id", async () => {
  const u = new UsageStore({ dataDir: ".", options: { logFile: "", broadcast: false, keepLastRequests: 5 } });
  const r = u.start({ format: "anthropic", model: "m", upstream: "u1", ua: "claude-cli/2.1" });
  r.memory = { project: "abc123def456" };
  u.finish(r, { status: "ok", httpStatus: 200, tokens: { input: 10, output: 5 } }, {});
  const named = (/** @type {string} */ id) => (id === "abc123def456" ? { id, name: "shop-api", cwd: "H:/work/shop-api" } : null);
  const a = new Assistant(/** @type {any} */ ({ getConfig: () => ({}), usage: u, memory: { projectNamed: named } }));
  const out = await a.runTool(/** @type {any} */ ({ draft: {} }), "get_usage", {});
  assert.deepEqual(out.byProject, [{ project: "abc123def456", name: "shop-api", cwd: "H:/work/shop-api", requests: 1, errors: 0, cost: 0, output: 5 }]);
  const bare = new Assistant(/** @type {any} */ ({ getConfig: () => ({}), usage: u }));
  const out2 = await bare.runTool(/** @type {any} */ ({ draft: {} }), "get_usage", {});
  assert.deepEqual(out2.byProject, [{ project: "abc123def456", requests: 1, errors: 0, cost: 0, output: 5 }], "no memory, no names: the id still says which");
});

// (fails before: yes — the summary had no way to name its projects)
test("the usage summary names its projects when asked to, and only then", () => {
  const u = new UsageStore({ dataDir: ".", options: { logFile: "", broadcast: false, keepLastRequests: 5 } });
  const r = u.start({ format: "anthropic", model: "m", upstream: "u1", ua: "claude-cli/2.1" });
  r.memory = { project: "abc123def456" };
  u.finish(r, { status: "ok", httpStatus: 200, tokens: { input: 10, output: 5 } }, {});
  const day = 24 * 3600 * 1000;
  assert.deepEqual(u.summary(day).byProject, { abc123def456: { requests: 1, errors: 0, cost: 0, output: 5 } });
  assert.deepEqual(u.summary(day, { projectNamed: (id) => ({ id, name: "shop-api", cwd: "H:/work/shop-api" }) }).byProject, {
    abc123def456: { requests: 1, errors: 0, cost: 0, output: 5, name: "shop-api", cwd: "H:/work/shop-api" },
  });
  assert.deepEqual(u.summary(day, { projectNamed: () => null }).byProject, { abc123def456: { requests: 1, errors: 0, cost: 0, output: 5, name: null, cwd: null } });
});

test("projectWords: the folder's name, with the folder and the id in the tooltip; the id where no name is known; the empty sentinel for no project", () => {
  assert.deepEqual(projectWords({ id: "11a466ddb578", name: "shop-api", cwd: "H:/work/shop-api" }), { text: "shop-api", title: "H:/work/shop-api · project 11a466ddb578" });
  assert.deepEqual(projectWords({ id: "11a466ddb578", name: "shop-api" }), { text: "shop-api", title: "project 11a466ddb578" });
  assert.deepEqual(projectWords({ id: "11a466ddb578", name: null, cwd: null }), { text: "11a466ddb578", title: "project 11a466ddb578" });
  for (const none of [null, undefined, {}, { id: "" }, { id: "none", name: "x" }]) assert.deepEqual(projectWords(none), { text: "–", title: "" }, JSON.stringify(none));
});

// The dashboard's pages build real DOM; their use of the one rule is pinned in their source.
test("every page that names a project says its words", () => {
  const home = read("src/ui/pages/home.js");
  assert.match(home, /const pw = projectWords\(\{ id: s\.project, name: s\.projectName, cwd: s\.cwd \}\);/, "Home's Where you left off");
  assert.match(home, /h\("td", \{ class: "muted small", title: pw\.title \}, pw\.text\)/);
  const mem = read("src/ui/pages/memory.js");
  assert.match(mem, /const pw = projectWords\(d\.project\);/, "Memory → Sessions' detail");
  assert.match(mem, /\["project", h\("span", \{ title: pw\.title \}, pw\.text\)\]/);
  assert.match(mem, /`- project: \$\{pw\.text\}\$\{d\.project\?\.cwd \? ` \(\$\{d\.project\.cwd\}\)` : ""\} · client:/, "its export says the folder, a file having no tooltip");
  const claims = read("src/ui/pages/memory-claims.js");
  assert.match(claims, /projectWords\(\{ id: it\.project_id, name: it\.projectName, cwd: it\.projectCwd \}\)/, "the always-allow offers");
  const usage = read("src/ui/pages/usage.js");
  assert.match(usage, /projectWords\(\{ id: r\.k, name: r\.name, cwd: r\.cwd \}\)/, "Usage's By project");
  assert.doesNotMatch(usage, /const pn = /, "the names come with the summary, not from a list the page cached");
  for (const [f, src] of [["home", home], ["memory", mem], ["memory-claims", claims]])
    assert.doesNotMatch(src, /project_id !== "none" \? \w+\.project_id/, `${f} shows no raw project id`);
  const route = read("src/http/admin/traffic.js");
  assert.match(route, /projectNamed: \(id\) => memory\?\.projectNamed\?\.\(id\) \?\? null/, "the summary route names its projects from memory");
});

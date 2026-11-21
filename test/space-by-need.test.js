// @ts-check
// A Space by need (the decision of 11-12): what the person adds on a project's page that lives in a Space — a task, a
// line in What happened, a sync, a pull, an app, a Keep — makes the project's Space with that same press, and its answer
// says so. Never while a deleted Space still waits for Bring back; never by a write refused for its body; and never by
// anything an agent, a routine, a sync or Filament itself writes: the store's gate stands, and only the person's rows
// make one. Who may call them is who may call Make a Space's own row: a view-only device and another machine's agents
// neither, a full device and this computer both. The rows on stand-ins; the doors through a real Filament.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipOf } from "../src/services/zip.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { createSpaceStore, NO_SPACE, SPACE_DELETED } from "../src/services/spaces.js";
import { createDashboardRunner } from "../src/services/dashboard-runner.js";
import { createSpaceSync } from "../src/app/space-sync.js";
import { createRoutines } from "../src/app/routines.js";
import { ARTIFACT_GUIDE, artifactCall } from "../src/app/agent/artifacts.js";
import { SPACE_OFF, spaceCall, spaceProjectOf } from "../src/app/agent/space.js";
import { spaceRoutes } from "../src/http/admin/spaces.js";
import { createRouter } from "../src/http/router.js";
import { pressClass } from "../src/http/admin/press.js";
import { agentRefusal, viewReads } from "../src/http/admin/remote.js";
import { PRESS_HEADER, setPressKey } from "../src/http/guards.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";

const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function fresh() {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "filament-space-by-need-")));
  dirs.push(d);
  return d;
}
const NOW = Date.UTC(2026, 10, 12, 10, 0);
const P = "p1";
/** What a row is refused with while the project's deleted Space still waits. */
const WAITS = "This project's Space was deleted: bring it back, or make a new one, first.";
const file = (/** @type {string} */ path, /** @type {string} */ text) => ({ path, data: Buffer.from(text, "utf8") });
const RUNS = { command: ["node", ".filament/apps/runs/runs.mjs"], rows: "runs", key: "id" };
const APP_JSON = { title: "Runs", description: "CI's runs", sources: { runs: RUNS } };
/** An app's .zip, as Import app… takes one. */
const PULSE = () => zipOf([file("pulse/app.json", JSON.stringify({ title: "Pulse", sources: { log: { command: ["git", "log", "-1", "--format=%H"], fields: ["sha"], key: "sha" } } })), file("pulse/index.html", "<p>pulse</p>")]).toString("base64");
/** A pull as its sheet sends it: read only, nothing goes back. */
const LINEAR = { service: "linear", title: "Linear", connection: "linear", tool: "list_issues", args: { assignee: "me" }, rows: "", key: "identifier", name: "title", state: "status", columns: { Todo: "planned" } };

/**
 * A project's folder with an app under .filament/apps/runs, and Filament's Space rows over a store that keeps only
 * made Spaces, as Filament's own does: c1 is the project's chat.
 * @param {{ dir?: string | null }} [o]
 */
function world({ dir = null } = {}) {
  const cwd = fresh();
  const at = join(cwd, ".filament", "apps", "runs");
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, "app.json"), JSON.stringify(APP_JSON));
  writeFileSync(join(at, "index.html"), "<!doctype html><title>Runs</title><main></main>");
  writeFileSync(join(at, "runs.mjs"), "console.log('{\"runs\":[]}')");
  const artifacts = createArtifactStore({ dataDir: fresh(), log: () => {}, now: () => NOW, four: () => "ab12" });
  const spaces = createSpaceStore({ dir, madeOnly: true, now: () => NOW });
  const runner = createDashboardRunner({ spaces, artifacts, folderOf: () => cwd, projectOfChain: (c) => (c === "c1" ? P : null), now: () => NOW, run: async () => ({ ok: /** @type {const} */ (true), out: '{"runs":[]}' }) });
  /** @type {[string, string][]} */
  const sent = [];
  const sync = createSpaceSync({
    store: spaces,
    reach: { busy: () => false, post: async (chain, text) => (sent.push([chain, text]), { status: 200, body: null }), steer: () => ({ ok: false }) },
    projectOf: (c) => (c === "c1" ? P : null),
    nameOf: (c) => (c === "c1" ? "login" : c),
    now: () => NOW,
  });
  const rows = spaceRoutes({
    config: { get: () => ({ agentLoop: { roots: [tmpdir()] }, server: { maxBodyBytes: 1e6, port: 20300 } }) },
    memory: { archive: { getProject: (/** @type {string} */ id) => (id === P ? { id, name: "proj", cwd } : null) } },
    spaces,
    dashboards: runner,
    artifacts,
    spaceSync: sync,
  });
  /** @param {string} method @param {string} path @param {any} [json] */
  const call = async (method, path, json) => {
    const m = createRouter(rows)(method, path);
    assert.ok(m, `${method} ${path} matched a row`);
    const got = { status: 0, body: /** @type {any} */ (null) };
    const res = { headersSent: false, writableEnded: false, writeHead: (/** @type {number} */ s) => Object.assign(got, { status: s }), end: (/** @type {string} */ b) => void Object.assign(got, { body: JSON.parse(String(b)) }) };
    await m.handler({ res, url: new URL(`http://localhost/api${path}`), params: m.params, json: async () => json }, {});
    return got;
  };
  /** The project's chat's agent publishes the folder's app: a draft of its Space. */
  const published = () => {
    const pub = /** @type {any} */ (artifactCall({ action: "publish", folder: ".filament/apps/runs" }, { who: "c1", by: { chain: "c1", model: "m", folder: cwd, helper: null }, within: [cwd], port: 20300, maxBytes: 1e6 }, artifacts));
    assert.equal(pub.ok, true, pub.error);
    return "runs-ab12";
  };
  /** Its Space made and deleted: one waits for Bring back. */
  const deleted = () => {
    spaces.make(P);
    spaces.remove(P);
    assert.equal(spaces.has(P), false);
    assert.notEqual(spaces.deletedAt(P), null);
  };
  return { cwd, artifacts, spaces, runner, sync, sent, call, published, deleted };
}

/**
 * The person's adds, each on a world of its own: its row, its body, and what shows that its write was done.
 * @type {{ name: string, path: string, body: () => any, before?: (w: ReturnType<typeof world>) => void, wrote: (w: ReturnType<typeof world>, body: any) => void }[]}
 */
const ADDS = [
  { name: "a task", path: "/tasks", body: () => ({ title: "Ship it" }), wrote: (w, b) => (assert.equal(b.task.title, "Ship it"), assert.deepEqual(w.spaces.get(P).tasks.map((t) => t.title), ["Ship it"])) },
  { name: "a line in What happened", path: "/log", body: () => ({ text: "Deploys are frozen until Friday." }), wrote: (w, b) => (assert.equal(b.entry.text, "Deploys are frozen until Friday."), assert.equal(w.spaces.get(P).log.at(-1)?.text, "Deploys are frozen until Friday.")) },
  { name: "Tell the chats…", path: "/sync", body: () => ({ lanes: [{ chain: "c1", when: "now" }], also: "Read the board first." }), wrote: (w, b) => (assert.equal(b.sync.lanes[0].chain, "c1"), assert.equal(w.spaces.get(P).syncs.length, 1)) },
  { name: "a pull", path: "/pulls", body: () => LINEAR, wrote: (w, b) => (assert.equal(b.pull.title, "Linear"), assert.equal((w.spaces.get(P).pulls || []).length, 1)) },
  { name: "New app…, in words", path: "/new-app", body: () => ({ said: "A page of our runs" }), wrote: (_w, b) => assert.match(b.words, /^Make an app for proj's Space: A page of our runs/) },
  { name: "New app…, from a starter's folder", path: "/new-app", body: () => ({ starter: "pipeline" }), wrote: (w, b) => (assert.equal(b.folder, ".filament/apps/pipeline"), assert.ok(existsSync(join(w.cwd, ".filament", "apps", "pipeline", "app.json")))) },
  { name: "an app of the folder's", path: "/folder-apps", body: () => ({ folder: ".filament/apps/runs" }), wrote: (_w, b) => (assert.equal(b.name, "runs-ab12"), assert.ok(b.space.dashboards.some((/** @type {any} */ d) => d.name === "runs-ab12" && d.state === "draft"))) },
  { name: "Import app…", path: "/import-app", body: () => ({ data: PULSE() }), wrote: (w, b) => (assert.equal(b.folder, ".filament/apps/pulse"), assert.ok(existsSync(join(w.cwd, ".filament", "apps", "pulse", "index.html")))) },
  { name: "Keep", path: "/dashboards/runs-ab12/keep", body: () => ({ v: 1 }), before: (w) => void w.published(), wrote: (w, b) => (assert.equal(b.dashboard.name, "runs-ab12"), assert.deepEqual(w.spaces.get(P).dashboards.map((d) => [d.name, d.state]), [["runs-ab12", "kept"]])) },
];

describe("the person's adds on a project with no Space", () => {
  // (fails before: yes — each answered 404 "This project has no Space…", or — the three that write a folder or a draft —
  // 200 with no Space made and no `made`)
  for (const add of ADDS)
    test(`${add.name} makes the project's Space with that press, says so in its answer, and is written`, async () => {
      const w = world();
      add.before?.(w);
      assert.equal(w.spaces.has(P), false);
      const got = await w.call("POST", `/space/${P}${add.path}`, add.body());
      assert.equal(got.status, 200, JSON.stringify(got.body));
      assert.equal(got.body.made, true, "its answer says the Space was made");
      assert.equal(got.body.tasks, undefined, "no old board, no tasks came back");
      assert.equal(w.spaces.has(P), true);
      assert.equal(w.spaces.get(P).log[0].text, "You made this Space.");
      add.wrote(w, got.body);
      w.runner.stop();
    });

  // (fails before: yes — `made` was no part of a write's answer)
  test("the next add finds the Space and says nothing of making it", async () => {
    const w = world();
    assert.equal((await w.call("POST", `/space/${P}/tasks`, { title: "Ship it" })).body.made, true);
    const next = await w.call("POST", `/space/${P}/tasks`, { title: "Docs" });
    assert.deepEqual([next.status, "made" in next.body], [200, false]);
    const line = await w.call("POST", `/space/${P}/log`, { text: "A line." });
    assert.deepEqual([line.status, "made" in line.body], [200, false]);
    assert.equal(w.spaces.get(P).log.filter((e) => e.text.startsWith("You made this Space")).length, 1);
  });

  // (fails before: yes — 404, and the old board's tasks stayed set aside)
  test("an old board's tasks come back with it, and the answer says how many", async () => {
    const dir = fresh();
    const old = createSpaceStore({ dir: null });
    old.addTask(P, { title: "Ship the installer" }, { kind: "you" });
    old.addTask(P, { title: "Docs" }, { kind: "you" });
    writeFileSync(join(dir, `${P}.json`), JSON.stringify(old.get(P)));
    const w = world({ dir });
    assert.equal(w.spaces.has(P), false, "set aside: no Space until made");
    const got = await w.call("POST", `/space/${P}/tasks`, { title: "Ship it" });
    assert.deepEqual([got.status, got.body.made, got.body.tasks], [200, true, 2]);
    assert.deepEqual(got.body.space.tasks.map((/** @type {any} */ t) => t.title).sort(), ["Docs", "Ship it", "Ship the installer"]);
  });
});

describe("while a deleted Space still waits", () => {
  // (fails before: yes — a task, a line, a pull and a sync answered 404 with the store's words, which send the person
  // to a menu; New app…, the folder's app and Import app… answered 200 and wrote their folder or their draft; Keep 404)
  for (const add of ADDS)
    test(`${add.name} is refused in words that say the way on: nothing made, nothing written`, async () => {
      const w = world();
      w.deleted();
      add.before?.(w);
      const drafts = w.artifacts.list().length;
      const got = await w.call("POST", `/space/${P}${add.path}`, add.body());
      assert.deepEqual([got.status, got.body.error], [409, WAITS]);
      assert.equal(w.spaces.has(P), false, "no Space made over the one that waits");
      assert.notEqual(w.spaces.deletedAt(P), null, "Bring back still has it");
      assert.equal(w.artifacts.list().length, drafts, "no draft published");
      assert.equal(existsSync(join(w.cwd, ".filament", "apps", "pipeline")), false, "no starter copied");
      assert.equal(existsSync(join(w.cwd, ".filament", "apps", "pulse")), false, "no .zip unpacked");
      assert.deepEqual(w.sent, [], "no chat told");
      w.runner.stop();
    });

  // (fails before: yes — the add after Bring back was never refused 409 before it)
  test("brought back, the add is written and nothing is made", async () => {
    const w = world();
    w.deleted();
    assert.equal((await w.call("POST", `/space/${P}/tasks`, { title: "Ship it" })).status, 409);
    w.spaces.bringBack(P);
    const got = await w.call("POST", `/space/${P}/tasks`, { title: "Ship it" });
    assert.deepEqual([got.status, "made" in got.body], [200, false]);
  });

  // (fails before: yes — the make took no `need`, and made one over the Space that waits)
  test("the make of a press that only fills a box (`need`) is refused the same; Make a Space, on purpose, still makes one", async () => {
    const w = world();
    w.deleted();
    const need = await w.call("POST", `/space/${P}`, { need: true });
    assert.deepEqual([need.status, need.body.error, w.spaces.has(P)], [409, WAITS, false]);
    const make = await w.call("POST", `/space/${P}`, undefined);
    assert.deepEqual([make.status, make.body.made, w.spaces.has(P)], [200, true, true]);
  });
});

describe("the make of a press that only fills a box", () => {
  // (fails before: yes — its answer said `made: false` of a Space that is there, where a by-need answer says nothing)
  test("`need` makes the Space where there is none and says so; where there is one, nothing", async () => {
    const w = world();
    const first = await w.call("POST", `/space/${P}`, { need: true });
    assert.deepEqual([first.status, first.body.made, w.spaces.has(P)], [200, true, true]);
    assert.equal(first.body.space.project, P);
    const again = await w.call("POST", `/space/${P}`, { need: true });
    assert.deepEqual([again.status, "made" in again.body], [200, false]);
  });
});

describe("a write refused makes no Space", () => {
  /** @type {[string, string, string, any, number, ((w: ReturnType<typeof world>) => void)?][]} */
  const REFUSED = [
    ["a task with no title", "POST", "/tasks", {}, 400],
    ["a task in no column", "POST", "/tasks", { title: "Ship it", column: "someday" }, 400],
    ["an empty line", "POST", "/log", { text: "  " }, 400],
    ["a line on a task, which a project with no Space has none of", "POST", "/log", { text: "Done.", task: "t1" }, 404],
    ["a sync to no lane", "POST", "/sync", { lanes: [] }, 400],
    ["a sync to another project's chat", "POST", "/sync", { lanes: [{ chain: "c9", when: "now" }] }, 400],
    ["a pull that reads as none", "POST", "/pulls", { service: "linear" }, 400],
    ["New app… with nothing said", "POST", "/new-app", {}, 400],
    ["New app… from a starter Filament has not", "POST", "/new-app", { starter: "nope" }, 404],
    ["a folder that holds no app", "POST", "/folder-apps", { folder: "../elsewhere" }, 404],
    ["Import app… with no .zip", "POST", "/import-app", { data: "" }, 400],
    ["Import app… of a .zip that holds no app", "POST", "/import-app", { data: zipOf([file("index.html", "x")]).toString("base64") }, 400],
    ["Import app… of an app that does not publish", "POST", "/import-app", { data: zipOf([file("app.json", JSON.stringify({ title: "Bad", sources: { x: { command: "not a list" } } })), file("index.html", "x")]).toString("base64") }, 400],
    ["Keep of no version", "POST", "/dashboards/runs-ab12/keep", { v: 0 }, 400, (w) => void w.published()],
    ["Keep of an app there is not", "POST", "/dashboards/nope/keep", { v: 1 }, 404],
    ["Keep of a version that is not its newest", "POST", "/dashboards/runs-ab12/keep", { v: 2 }, 409, (w) => void w.published()],
    // What is no add of the person's is the store's to refuse, as before.
    ["a setting", "PATCH", "/settings", { asks: "ask" }, 404],
    ["a task changed", "PATCH", "/tasks/t1", { title: "Other" }, 404],
  ];
  // (fails before: no for the store's own refusals — these hold the rule that the make comes after the body's checks —;
  // the three that answered 200 before, with no Space, answer the same refusals now)
  for (const [name, method, path, body, status, before] of REFUSED)
    test(`${name}: ${status}, and none is made`, async () => {
      const w = world();
      before?.(w);
      const got = await w.call(method, `/space/${P}${path}`, body);
      assert.equal(got.status, status, JSON.stringify(got.body));
      assert.equal(w.spaces.has(P), false);
      assert.deepEqual(w.spaces.projects(), []);
      w.runner.stop();
    });
});

describe("the page of a project with no Space", () => {
  // (fails before: yes — the answer carried no dashboards, so an app an agent published before any Space had no row,
  // no page and no Keep…)
  test("its answer carries the drafts the project's chats published; once a deleted Space waits it still says when", async () => {
    const w = world();
    const empty = await w.call("GET", `/space/${P}`);
    assert.deepEqual([empty.status, empty.body.none, empty.body.deletedAt, empty.body.dashboards], [404, true, null, []]);
    const name = w.published();
    assert.equal(w.spaces.has(P), false, "an agent's publish makes no Space");
    const none = await w.call("GET", `/space/${P}`);
    assert.deepEqual([none.status, none.body.none, none.body.deletedAt], [404, true, null]);
    assert.deepEqual(none.body.dashboards.map((/** @type {any} */ d) => [d.name, d.state, d.type]), [[name, "draft", "app"]]);
    assert.equal(w.spaces.has(P), false, "a read makes none");
    w.deleted();
    const gone = await w.call("GET", `/space/${P}`);
    assert.deepEqual([gone.status, gone.body.none, gone.body.deletedAt], [404, true, w.spaces.deletedAt(P)]);
    w.runner.stop();
  });

  // (fails before: yes — both said "This project has no Space: make one from its menu.", which sends the person away
  // from the page whose first add makes it, and says nothing of a deleted one that waits)
  test("a read that finds no Space says how one comes to be now, and, where its deleted one waits, that it does", async () => {
    const w = world();
    const YET = "This project has no Space yet: the first thing you add on its page makes one.";
    assert.equal((await w.call("GET", `/space/${P}`)).body.error, YET);
    w.deleted();
    assert.equal((await w.call("GET", `/space/${P}`)).body.error, WAITS);
    w.runner.stop();
  });
});

// (fails before: yes — d-space's left, for the agents' versioned words (123): each sentence was written when a Space
// was made from the project's menu alone, and a draft was "in the Space" with "its row under the Space in the left bar")
describe("what an agent reads of a project with no Space says how one comes to be, by need", () => {
  test("the space tool's refusal, of a chat in no project and of one whose project has none yet; the store's, of a write", () => {
    assert.equal(SPACE_OFF, "Not run: this chat has no Space — it works in no project, or its project has none yet. The person makes a project's Space by adding something on its page, or from its menu.");
    assert.equal(NO_SPACE, "This project has no Space: the person makes one by adding something on the project's page, or from the project's menu (right-click it in the bar).");
  });

  test("the artifact tool's guides: a draft is on its project's page, its Keep… there; under the Space in the left bar where there is one", () => {
    const dash = String(/** @type {any} */ (ARTIFACT_GUIDE).dashboard);
    const app = String(/** @type {any} */ (ARTIFACT_GUIDE).app);
    assert.ok(dash.includes("- Nothing runs before the developer keeps it. Until then it is a draft on its project's page, showing your sample rows, its buttons off; keeping it lists every command, watch and button in Filament's words."), "the dashboard's");
    assert.ok(app.includes("- Nothing runs before the developer keeps it. Until then it is a draft on its project's page, its page's reads refused; keeping it lists every command, watch and button in Filament's words."), "the app's");
    assert.ok(dash.endsWith("the developer opens it from the card. A dashboard with sources is a draft on its project's page: say that Keep… on its page there lists what it will run, and that nothing runs before. Its page is its row under the Space in the left bar; where the project has no Space yet, it is on the project's page (the project's menu in the left bar, Open its page), and keeping it makes the Space."), dash.slice(-500));
    assert.ok(app.endsWith("Do not paste its code into your answer. It is a draft on its project's page: say that Keep… on its page there lists what it will run, and that nothing runs before. Its page is its row under the Space in the left bar; where the project has no Space yet, it is on the project's page (the project's menu in the left bar, Open its page), and keeping it makes the Space."), app.slice(-500));
    for (const g of [dash, app]) assert.doesNotMatch(g, /a draft in (the|its project's) Space/);
  });
});

describe("while a deleted Space waits, what an agent reads says so", () => {
  const SAYS = "This project's Space was deleted: the person brings it back, or makes a new one, on the project's page or from its menu (right-click it in the bar).";
  /** Filament's tools for a coding agent, over a Space store: c1 is the project's chat. @param {any} spaces */
  const toolsOver = (spaces) =>
    createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: /** @type {any} */ ({ get: () => null }), subagents: () => null, membersOf: () => null, space: /** @type {any} */ ({ store: spaces, projectOf: (/** @type {string} */ c) => (c === "c1" ? P : null), nameOf: () => "login", on: () => true }) });
  // (fails before: yes — d-send's third follow-up: where the project's deleted Space waits for Bring back, the store's
  // refusal and the space tool's said the person makes one by adding something on its page, where every add is refused
  // until it is brought back or made anew)
  test("the store's refusal and a coding agent's space call: the deleted sentence where one waits, the by-need sentence where none ever was", async () => {
    assert.equal(SPACE_DELETED, SAYS);
    const w = world();
    w.deleted();
    const never = world();
    const at = /** @type {any} */ ({ store: w.spaces, project: P, chain: "c1", name: null, nameOf: () => "login", on: () => true });
    assert.deepEqual(spaceCall({ action: "add", title: "Ship it" }, at, NOW), { ok: false, error: SAYS });
    assert.deepEqual(spaceCall({ action: "add", title: "Ship it" }, { ...at, store: never.spaces }, NOW), { ok: false, error: NO_SPACE });
    assert.deepEqual(await toolsOver(w.spaces).call("space", { action: "read" }, /** @type {any} */ ({ cwd: "/r", chain: "c1" })), { text: `Not run: ${SAYS}`, isError: true });
    assert.deepEqual(await toolsOver(never.spaces).call("space", { action: "read" }, /** @type {any} */ ({ cwd: "/r", chain: "c1" })), { text: SPACE_OFF, isError: true });
    assert.deepEqual(await toolsOver(w.spaces).call("space", { action: "read" }, /** @type {any} */ ({ cwd: "/r", chain: "c9" })), { text: SPACE_OFF, isError: true }, "a chat in no project");
    assert.deepEqual(await toolsOver(w.spaces).call("space", { action: "read" }, /** @type {any} */ ({ cwd: "/r", chain: "c1", space: false })), { text: SPACE_OFF, isError: true }, "an agent whose card goes without it");
    w.spaces.bringBack(P);
    assert.equal((await toolsOver(w.spaces).call("space", { action: "read" }, /** @type {any} */ ({ cwd: "/r", chain: "c1" }))).isError, undefined, "brought back, it reads");
    assert.equal(w.spaces.has(P) && never.spaces.has(P), false, "none made by a refusal");
  });

  // The loop offers its space tool only where the chat's project has a Space as the turn starts — a call made anyway is
  // the loop's "not available" —, so what reaches a loop agent of a deleted Space is the store's refusal, its Space
  // deleted while its turn runs.
  test("through a real Filament: a loop agent whose project's Space is deleted while its turn runs reads the deleted sentence from its next write", async (t) => {
    /** What the space call was answered. @type {string[]} */
    const answered = [];
    /** @type {Awaited<ReturnType<typeof startApp>> | null} */
    let shim = null;
    /** The project whose Space goes while the turn runs. */
    let project = "";
    const up = await fakeUpstream(async (call) => {
      const b = call.body || {};
      if (!b.tools?.length) return anthropicReply("A title", { model: "brain-model" });
      const results = (b.messages || []).flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : [])).filter((/** @type {any} */ p) => p?.type === "tool_result");
      if (!results.length) {
        assert.ok(b.tools.some((/** @type {any} */ x) => x.name === "space"), "offered: its project's Space stood as the turn began");
        assert.equal((await /** @type {any} */ (shim).api(`/api/space/${encodeURIComponent(project)}`, { method: "DELETE" })).status, 200);
        return anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: "sp1", name: "space", input: { action: "add", title: "Ship it" } }] });
      }
      const r = results[0];
      answered.push(typeof r.content === "string" ? r.content : (r.content || []).map((/** @type {any} */ x) => x.text || "").join(""));
      return anthropicReply("Noted.", { model: "brain-model" });
    });
    const cwd = fresh();
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [cwd], readerModel: "" };
      },
    });
    const app = shim;
    t.after(async () => {
      await app.stop();
      await up.close();
    });
    const s = await app.api("/api/sessions", { method: "POST", body: { cwd, model: "agent/brain-model", preset: "plain", settings: { loop: { permissions: "auto" } } } });
    assert.equal(s.status, 200, await s.clone().text());
    const id = String((await s.json()).id);
    project = String((await (await app.api(`/api/sessions/${encodeURIComponent(id)}/settings`)).json()).projectId);
    assert.equal((await app.api(`/api/space/${encodeURIComponent(project)}`, { method: "POST" })).status, 200);
    const r = await app.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "add a task to the board", stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(answered, [`Error: ${SAYS}`], "the loop's answer to a refused call");
    assert.notEqual((await (await app.api(`/api/space/${encodeURIComponent(project)}`)).json()).deletedAt, null, "it still waits for Bring back: the refusal made none");
  });
});

describe("nothing an agent, a routine, a sync or Filament writes makes a Space", () => {
  // These hold before and after: they pin the store's gate from the agents' side, which by need leaves as it is.
  test("the space tool: not offered, and a call made anyway is refused in the store's words", () => {
    const w = world();
    assert.equal(spaceProjectOf(/** @type {any} */ ({ store: w.spaces, projectOf: () => P }), "c1"), null);
    const at = /** @type {any} */ ({ store: w.spaces, project: P, chain: "c1", name: null, nameOf: () => "login", on: () => true });
    for (const call of [{ action: "add", title: "Ship it" }, { action: "log", text: "I looked at the build." }, { action: "routine", with: { title: "Morning brief", when: "weekdays 09:00", text: "Read the open PRs." } }]) {
      const got = spaceCall(call, at, NOW);
      assert.deepEqual([got.ok, /** @type {any} */ (got).error], [false, NO_SPACE], call.action);
    }
    assert.equal(w.spaces.has(P), false);
  });

  test("an agent's publish is a draft the project's page shows, and makes none", () => {
    const w = world();
    const name = w.published();
    assert.deepEqual(w.runner.shown(P).map((d) => [d.name, d.state]), [[name, "draft"]]);
    assert.equal(w.spaces.has(P), false);
    w.runner.stop();
  });

  test("a sync that is not the person's row is refused by the store, and tells no chat", () => {
    const w = world();
    assert.throws(() => w.sync.run(P, { lanes: [{ chain: "c1", when: "now" }] }), { status: 404, message: NO_SPACE });
    assert.equal(w.spaces.has(P), false);
    assert.deepEqual(w.sent, []);
  });

  test("a routine's run that ends after its Space was deleted writes nothing into it and makes none", async () => {
    const clock = { at: new Date(2026, 9, 26, 8).getTime() };
    const spaces = createSpaceStore({ dir: null, madeOnly: true, now: () => clock.at });
    spaces.make(P);
    const r = spaces.routinePropose(P, { title: "Morning brief", when: "daily 09:00", task: "Read the open PRs.", writes: false }, { chain: "c1", byName: "Release", model: "agent/brain-model" });
    spaces.routineOn(P, r.id);
    /** @type {Map<string, any>} */
    const facts = new Map();
    const routines = createRoutines({
      spaces,
      sessions: { create: () => (facts.set("run1", { busy: true, asking: false, last: null }), { id: "run1" }), besideFacts: (id) => facts.get(id) },
      mark: () => {},
      postTurn: async () => ({ status: 200, body: null }),
      folderOf: () => "/work/app",
      now: () => clock.at,
    });
    await routines.start();
    clock.at = new Date(2026, 9, 26, 9).getTime();
    await routines.tick();
    assert.equal(spaces.get(P).routines[0].last?.state, "running");
    spaces.remove(P);
    facts.set("run1", { busy: false, asking: false, last: { final: true, text: "3 PRs wait for you", cut: false, failed: false, why: "", stopped: false } });
    routines.released("run1");
    await routines.tick();
    routines.stop();
    assert.equal(spaces.has(P), false);
    assert.notEqual(spaces.deletedAt(P), null, "it still waits for Bring back, as it was");
    assert.deepEqual(spaces.projects(), []);
  });
});

describe("who may call them", () => {
  /** The rows that make a Space by need, and Make a Space's own. */
  const BY_NEED = ["/space/:project/tasks", "/space/:project/log", "/space/:project/sync", "/space/:project/pulls", "/space/:project/new-app", "/space/:project/folder-apps", "/space/:project/import-app", "/space/:project/dashboards/:name/keep"];
  const MAKE = "/space/:project";

  // These hold before and after: they pin what by need rests on.
  test("no row of them answers a view-only device or another machine's agents, as Make a Space's row answers neither; and that row asks no press", () => {
    const device = { name: "the studio's agents", grants: { agents: true } };
    for (const row of [MAKE, ...BY_NEED]) {
      assert.equal(viewReads("POST", row), false, `a view-only device: POST ${row}`);
      assert.match(String(agentRefusal("POST", row.replace(":project", P).replace(":name", "runs"), row, device)), /is more than that$/, `another machine's agents: POST ${row}`);
    }
    // A caller on this computer with no press may make a Space already: a row that makes one by need gives it no more.
    assert.equal(pressClass(`POST ${MAKE}`).press, "no");
    // Keep is a press whatever it carries: with none it is refused before its row acts, so it makes nothing.
    assert.equal(pressClass("POST /space/:project/dashboards/:name/keep").press, "always");
  });

  /**
   * A request over node:http, so the test sets every header itself.
   * @param {number} port @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any }} [o]
   * @returns {Promise<{ status: number, json: any, headers: http.IncomingHttpHeaders }>}
   */
  const ask = (port, path, { method = "GET", headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const text = body === undefined ? "" : JSON.stringify(body);
      const req = http.request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...(text ? { "content-type": "application/json" } : {}), ...headers } });
      req.on("response", (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(b);
          } catch {}
          resolve({ status: Number(res.statusCode), json, headers: res.headers });
        });
      });
      req.on("error", reject);
      req.end(text || undefined);
    });
  const FAR = { "x-forwarded-for": "100.101.102.103" };
  /** A device paired from this machine and claimed by another machine's page: its headers. @param {number} port @param {"full" | "view"} scope */
  const paired = async (port, scope) => {
    const pair = await ask(port, "/api/remote/pair", { method: "POST", body: { scope } });
    const claimed = await ask(port, "/api/remote/claim", { method: "POST", headers: { ...FAR, origin: `http://127.0.0.1:${port}` }, body: { code: pair.json.code, name: `a ${scope} device` } });
    assert.equal(claimed.status, 200);
    return { ...FAR, cookie: String(claimed.headers["set-cookie"]?.[0] || "").split(";")[0] };
  };

  // (fails before: yes — a full device's and this computer's add answered 404; the refusals held before)
  test("through a real Filament: a view-only device is refused the add as it is the make, and none is made; a full device's add makes it; this computer's too", async (t) => {
    const shim = await startApp({ memory: true });
    t.after(() => shim.stop());
    const { port } = shim;
    /** A project, and whether it has a Space. */
    const project = async () => (await ask(port, "/api/memory/projects", { method: "POST", body: { cwd: fresh() } })).json.id;
    const has = (/** @type {string} */ id) => existsSync(join(shim.dataDir, "spaces", `${id}.json`));

    const a = await project();
    const view = await paired(port, "view");
    for (const path of [`/api/space/${a}`, `/api/space/${a}/tasks`, `/api/space/${a}/log`]) {
      const r = await ask(port, path, { method: "POST", headers: view, body: { title: "Ship it", text: "A line." } });
      assert.equal(r.status, 403, `${path}: ${JSON.stringify(r.json)}`);
    }
    assert.equal(has(a), false, "a view-only device made none");

    const full = await paired(port, "full");
    const fromFull = await ask(port, `/api/space/${a}/tasks`, { method: "POST", headers: { ...full, origin: `http://127.0.0.1:${port}` }, body: { title: "Ship it" } });
    assert.deepEqual([fromFull.status, fromFull.json?.made, has(a)], [200, true, true], JSON.stringify(fromFull.json));

    const b = await project();
    const here = await ask(port, `/api/space/${b}/log`, { method: "POST", body: { text: "A line." } });
    assert.deepEqual([here.status, here.json?.made, has(b)], [200, true, true], JSON.stringify(here.json));
  });

  // (fails before: yes — the add with no press answered 404 where Make a Space's row, with no press, answered 200)
  test("while the desktop app holds its key: Keep with no press is refused before it makes anything; an add that asks no press makes the Space, as Make a Space's row would for the same caller", async (t) => {
    const shim = await startApp({ memory: true });
    const KEY = randomBytes(32).toString("base64url");
    setPressKey(KEY);
    t.after(async () => {
      setPressKey(null);
      await shim.stop();
    });
    const { port } = shim;
    const project = async () => (await ask(port, "/api/memory/projects", { method: "POST", headers: { [PRESS_HEADER]: KEY }, body: { cwd: fresh() } })).json.id;
    const has = (/** @type {string} */ id) => existsSync(join(shim.dataDir, "spaces", `${id}.json`));
    const a = await project();
    const keep = await ask(port, `/api/space/${a}/dashboards/runs-ab12/keep`, { method: "POST", body: { v: 1 } });
    assert.deepEqual([keep.status, keep.json?.press, has(a)], [403, true, false], JSON.stringify(keep.json));
    const add = await ask(port, `/api/space/${a}/tasks`, { method: "POST", body: { title: "Ship it" } });
    assert.deepEqual([add.status, add.json?.made, has(a)], [200, true, true], JSON.stringify(add.json));
    const b = await project();
    const make = await ask(port, `/api/space/${b}`, { method: "POST" });
    assert.deepEqual([make.status, make.json?.made, has(b)], [200, true, true], "the make itself asks no press");
  });
});

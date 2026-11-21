// @ts-check
// The space tool's `app` (the Space Apps plan of 10-29, "app-action"; the owner's "finish the space work fully"): an
// agent operates an app the person kept as the app's own page does, never by clicking it — `{"action":"app"}` lists the
// Space's apps; with a name, one whole: its builder's howto and what its sources mean, its rows, its actions and its
// latest runs with their ids; `"do"` runs an action, `"args"` its fields, the row left out where it is on one alone —
// judged by the chat's gate as a dashboard's button is, answered once its run ended with its last lines; `"log"` reads a
// run's log. In Filament's own loop and in a coding agent's call alike.
// (fails before: yes — the space tool had no app action: an agent operated an app through the dashboard's words alone,
// naming a row each time, and read no run's log)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArtifactStore } from "../src/services/artifacts.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createDashboardRunner } from "../src/services/dashboard-runner.js";
import { artifactCall } from "../src/app/agent/artifacts.js";
import { SPACE_GUIDED, SPACE_TOOL, spaceCall, spaceGuide, spaceRun } from "../src/app/agent/space.js";
import { APP_CALL, pressFieldsOf, pressStandIn } from "../src/app/agent/space-dashboard.js";
import { gate, toolSetFor } from "../src/app/agent/tools.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { createAgentTools } from "../src/app/agent-tools.js";

const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), "filament-app-action-"));
  dirs.push(d);
  return d;
};

const SOURCES = {
  repo: { command: ["node", "repo.mjs"], key: "branch" },
  builds: { command: ["node", "builds.mjs"], rows: "builds", key: "v" },
};
const BUILD = { label: "Build installer…", on: "repo", command: ["npm", "run", "dist", "--", "--channel", "{ask.channel}"], ask: [{ name: "channel", label: "Channel", required: true, choices: ["beta", "stable"] }], says: "Build the installer from {row.branch}?" };
const INSTALL = { label: "Install…", on: "builds", command: ["node", "install.mjs", "{row.v}"], check: { "row.v": "^[0-9.]+$" }, says: "Install {row.v}?" };
const PUBLISH = { label: "Publish…", on: "builds", command: ["node", "publish.mjs", "{row.v}"], check: { "row.v": "^[0-9.]+$" }, says: "Publish {row.v}?", effect: "sends" };
const APP = {
  type: "app",
  title: "Pipeline",
  html: "<!doctype html><title>Pipeline</title><main></main>",
  sources: SOURCES,
  actions: { build: BUILD, install: INSTALL, publish: PUBLISH },
  howto: "To ship: Build installer, then Install the build it made.",
  state: { repo: "The branch, its version and what is not committed", builds: "The installers built, the newest first" },
};
const NAME = "pipeline-ab12";
const DASH = { type: "dashboard", title: "Deploys", tiles: [{ kind: "table", title: "Deploys", from: "deploys" }], tables: { deploys: [{ v: 1 }] }, sources: { deploys: { command: ["node", "deploys.mjs"], key: "v" } } };
const BUILD_LOG = "::stage source\n::stage typecheck\n::stage tests\nwrote dist/Filament-0.2.0.exe\nInstaller built: 0.2.0\n";

/** Pipeline kept in p1, with its repo and builds read, and Deploys kept beside it. */
async function world() {
  const clock = { at: Date.UTC(2026, 9, 29, 16, 0) };
  const now = () => clock.at;
  const four = ["ab12", "cd34"];
  const artifacts = createArtifactStore({ dataDir: fresh(), log: () => {}, now, four: () => four.shift() || "zzzz" });
  const spaces = createSpaceStore({ dir: null, now });
  const reads = /** @type {Record<string, string>} */ ({
    "repo.mjs": JSON.stringify([{ branch: "main", version: "0.2.0", uncommitted: 0 }]),
    "builds.mjs": JSON.stringify({ builds: [{ v: "0.2.0", at: "16:00" }, { v: "0.1.9", at: "yesterday" }] }),
    "deploys.mjs": JSON.stringify([{ v: 1 }]),
  });
  /** @type {string[][]} */
  const acted = [];
  const runner = createDashboardRunner({
    spaces,
    artifacts,
    folderOf: () => "/work/filament",
    projectOfChain: () => "p1",
    now,
    run: async (argv) => ({ ok: /** @type {const} */ (true), out: reads[argv[1]] || "[]" }),
    act: async (argv, _cwd, _signal, onData) => {
      acted.push(argv);
      onData?.(BUILD_LOG);
      return { ok: /** @type {const} */ (true), said: BUILD_LOG };
    },
  });
  const publish = (/** @type {any} */ input) => artifactCall({ action: "publish", ...input }, { who: "c1", by: { chain: "c1", model: "m", folder: "/work/filament", helper: null }, within: [], port: 20300, maxBytes: 1_000_000 }, artifacts);
  assert.ok(publish(APP).ok);
  assert.ok(publish(DASH).ok);
  assert.equal(runner.keep("p1", NAME, 1).ok, true);
  assert.equal(runner.keep("p1", "deploys-cd34", 1).ok, true);
  await runner.read(NAME, 1, "repo");
  await runner.read(NAME, 1, "builds");
  await runner.read("deploys-cd34", 1, "deploys");
  /** @param {Record<string, any>} [o] @returns {import("../src/app/agent/space.js").SpaceAt} */
  const atOf = (o = {}) => ({ store: spaces, project: "p1", chain: "c1", name: null, nameOf: () => "Release", on: () => true, dashboards: runner, judge: async () => ({ ok: true }), ...o });
  return { clock, spaces, runner, acted, atOf };
}
/** @param {any} r */
const words = (r) => (r.ok ? r.text : r.error);
/** A call of the app action. @param {Record<string, any>} [w] */
const app = (w) => ({ action: "app", ...(w ? { with: w } : {}) });

describe("the agent reads the Space's apps", () => {
  test("{action:app}: the apps alone, a dashboard left to the dashboard action", async () => {
    const w = await world();
    // Read on the world's clock, as its reads were: on the machine's, "0 s ago" held only before 16:00 UTC of 10-29.
    const text = words(await spaceRun(app(), w.atOf(), w.clock.at));
    assert.match(text, /^Apps in this project's Space, as of [\d-]+ [\d:]+: 1 kept\.\n/);
    assert.ok(text.includes(`- ${NAME} “Pipeline” · kept, v1 · repo: 1 row, read 0 s ago; builds: 2 rows, read 0 s ago`), text);
    assert.ok(!text.includes("Deploys"), "a dashboard is not listed as an app");
    assert.ok(text.endsWith(`${APP_CALL} reads one whole: how to use it, its rows, its actions and its runs.`), text);
  });

  test("one whole: its howto and state, its rows, each action with what it does, the call that runs one", async () => {
    const w = await world();
    const text = words(await spaceRun(app({ name: NAME }), w.atOf()));
    assert.match(text, /^“Pipeline” \(pipeline-ab12\) in this project's Space, as of .+: kept, v1\./);
    assert.match(text, /\nHow to use it, as its builder wrote: To ship: Build installer, then Install the build it made\.\n/);
    assert.match(text, /\n {2}- builds: The installers built, the newest first\n/);
    assert.match(text, /\nActions \(run one with "do"; "row" names the row where it is on more than one\):\n/);
    assert.match(text, /- publish “Publish…” on builds: .+; it sends: it leaves this machine, so your press of it always asks the person, whatever this chat's mode\n/);
    assert.ok(text.includes(`{"action":"app","with":{"name":"${NAME}","do":"build","args":{…its fields}}}`), text);
  });
});

describe("do: an action run, answered once it ended", () => {
  // (fails before: yes — "do" was no field of the space tool's: nothing ran)
  test("on its one row without naming it, its fields from args; the answer: what it said, its last lines, the run's id", async () => {
    const w = await world();
    const r = await spaceRun(app({ name: NAME, do: "build", args: { channel: "beta" } }), w.atOf());
    assert.equal(r.ok, true, words(r));
    assert.deepEqual(w.acted, [["npm", "run", "dist", "--", "--channel", "beta"]]);
    const id = /** @type {any} */ (w.runner.jobsOf(NAME)[0]).id;
    const text = words(r);
    assert.ok(text.startsWith(`Pressed “Build installer…” on “Pipeline” ran npm run dist -- --channel beta — Installer built: 0.2.0. Its run is ${id}.\n\nIts last lines:\n  ::stage source\n  ::stage typecheck\n  ::stage tests\n  wrote dist/Filament-0.2.0.exe\n  Installer built: 0.2.0\n\n“Pipeline” (${NAME})`), text);
    assert.equal(w.spaces.get("p1").log.at(-1)?.text, "Pressed “Build installer…” on Pipeline: npm run dist -- --channel beta — Installer built: 0.2.0");
  });

  test("on more than one row, the row named — or refused with the rows' keys; a field left out refused as the sheet would", async () => {
    const w = await world();
    const none = words(await spaceRun(app({ name: NAME, do: "install" }), w.atOf()));
    assert.equal(none, `Not pressed: “Install…” is on 2 rows of builds — name one by its key ("row"): "0.2.0", "0.1.9".`);
    const r = await spaceRun(app({ name: NAME, do: "install", row: "0.1.9" }), w.atOf());
    assert.equal(r.ok, true, words(r));
    assert.deepEqual(w.acted, [["node", "install.mjs", "0.1.9"]]);
    const field = words(await spaceRun(app({ name: NAME, do: "build" }), w.atOf()));
    assert.equal(field, "Not pressed: Channel is empty: it is needed.");
    assert.equal(w.acted.length, 1);
  });

  test("judged as the button's command: the stand-in a gate reads is the dashboard's, and a sends action asks in Full access", async () => {
    const w = await world();
    const f = pressFieldsOf({ action: "app", name: NAME, do: "publish", row: "0.2.0" });
    assert.deepEqual([f?.press, f?.name], ["publish", NAME]);
    assert.equal(pressFieldsOf({ action: "read" }), null, "no press of a dashboard or an app");
    const s = /** @type {any} */ (pressStandIn(/** @type {any} */ (f), w.atOf()));
    assert.equal(s.ok, true, s.error);
    assert.deepEqual([s.call.name, s.call.input.command, s.call.input.press.effect], ["bash", "node publish.mjs 0.2.0", "sends"]);
    assert.equal(gate("auto", s.call.name, s.call.input).verdict, "ask");
    const refused = words(await spaceRun(app({ name: NAME, do: "publish", row: "0.2.0" }), w.atOf({ judge: async () => ({ ok: false, error: "Not run: the person declined it" }) })));
    assert.equal(refused, "Not pressed: the person declined it.");
    assert.deepEqual(w.acted, []);
  });
});

describe("log: a run's log", () => {
  test("by its id: who ran what, how it ended, and its log; an id it never had refused, with where the ids are", async () => {
    const w = await world();
    await spaceRun(app({ name: NAME, do: "build", args: { channel: "beta" } }), w.atOf());
    const id = /** @type {any} */ (w.runner.jobsOf(NAME)[0]).id;
    const text = words(await spaceRun(app({ name: NAME, log: id }), w.atOf(), w.clock.at));
    assert.ok(text.startsWith(`Run ${id} of “Build installer…” on "main" in “Pipeline”, pressed by Release, `), text);
    assert.match(text, /: done in 1 s — Installer built: 0\.2\.0\.\n\nIts log:\n::stage source\n::stage typecheck\n::stage tests\nwrote dist\/Filament-0\.2\.0\.exe\nInstaller built: 0\.2\.0$/);
    const whole = words(await spaceRun(app({ name: NAME }), w.atOf(), w.clock.at));
    assert.match(whole, new RegExp(`\\nIts latest runs, the newest first \\("log" reads one's log by its id\\):\\n {2}- ${id}: build on "main" 0 s ago: done, 1 s, pressed by Release — Installer built: 0\\.2\\.0`));
    assert.equal(words(await spaceRun(app({ name: NAME, log: "j-nope" }), w.atOf())), `Not read: “Pipeline” has no run j-nope; {"action":"app","with":{"name":"${NAME}"}} lists its latest runs with their ids.`);
  });
});

/** A turn whose model calls the space tool once with `input`, then ends. @param {Awaited<ReturnType<typeof world>>} w @param {any} input @param {Record<string, any>} over */
const turn = (w, input, over = {}) => {
  let n = 0;
  /** @type {any[]} */
  const events = [];
  const run = runAgentTurn(/** @type {any} */ ({
    model: "m",
    messages: [{ role: "user", content: "ship it" }],
    system: "s",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "edit",
    root: tmpdir(),
    readerModel: "",
    maxTokens: 100,
    call: async () => (++n === 1 && !over.resume ? reply([toolUse("a1", "space", input)]) : reply([{ type: "text", text: "Done." }])),
    costOf: () => 0,
    runHand: async (/** @type {string} */ name) => `${name} ran`,
    delegateRead: null,
    mailbox: { read: () => [] },
    permissions: null,
    tree: null,
    onEvent: (/** @type {any} */ e) => events.push(e),
    previewChars: 0,
    sink,
    signal: null,
    resume: null,
    space: w.atOf({ judge: undefined }),
    ...over,
  }));
  return { run, events };
};
const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
/** The space call's result in a turn's work. @param {any} out */
const resultOf = (out) => out.work.flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : [])).find((/** @type {any} */ b) => b.type === "tool_result" && b.tool_use_id === "a1");

describe("in Filament's own loop and in a coding agent's call", () => {
  const DO = app({ name: NAME, do: "install", row: "0.2.0" });
  test("Ask mode asks with the action's words and command, and a yes runs it; Full access runs a writes action at once", async () => {
    const w = await world();
    const out = /** @type {any} */ (await turn(w, DO).run);
    assert.equal(out.status, "paused");
    assert.equal(out.pause.question, "May I press “Install…” on “Pipeline”? It says: Install 0.2.0? It runs `node install.mjs 0.2.0` in /work/filament — answer /allow to press it, or say what to do instead.");
    assert.deepEqual(w.acted, [], "nothing ran before the yes");
    const yes = /** @type {any} */ (await turn(w, DO, { resume: { paused: out.pause, answer: "yes", allow: true }, messages: out.pause.convo }).run);
    assert.match(String(resultOf(yes)?.content), /^Pressed “Install…” on “Pipeline” ran node install\.mjs 0\.2\.0 — /);
    const full = /** @type {any} */ (await turn(w, DO, { modeNow: () => "auto" }).run);
    assert.equal(full.status, "done");
    assert.equal(w.acted.length, 2);
  });

  test("a sends action asks in Full access too; a read asks nothing in Read only", async () => {
    const w = await world();
    const sends = /** @type {any} */ (await turn(w, app({ name: NAME, do: "publish", row: "0.2.0" }), { modeNow: () => "auto" }).run);
    assert.equal(sends.status, "paused");
    assert.match(sends.pause.question, /It sends: it leaves this machine, so an agent's press of it always asks you/);
    const read = /** @type {any} */ (await turn(w, app({ name: NAME }), { modeNow: () => "read-only" }).run);
    assert.equal(read.status, "done");
    assert.match(String(resultOf(read)?.content), /^“Pipeline” \(pipeline-ab12\)/);
    assert.deepEqual(w.acted, []);
  });

  test("a coding agent's call: judged through its permit with the action's command", async () => {
    const w = await world();
    const tools = createAgentTools({
      memory: null, memoryToolsOn: () => false, graphs: () => null, turns: { get: () => null }, subagents: () => null, membersOf: () => null,
      space: { store: w.spaces, projectOf: () => "p1", nameOf: () => "Release", on: () => true, dashboards: w.runner },
    });
    /** @type {any[]} */
    const asked = [];
    const permit = async (/** @type {any[]} */ calls, /** @type {string} */ what) => (asked.push([calls[0].name, calls[0].input.command, what]), { asked: true });
    const r = await tools.call("space", DO, /** @type {any} */ ({ cwd: "/r", chain: "c1", permit }));
    assert.equal(r.isError, undefined, r.text);
    assert.deepEqual(asked, [["bash", "node install.mjs 0.2.0", "press “Install…” on Pipeline"]]);
  });
});

describe("the door and the guide name it", () => {
  test("app is a guided action; its topic whole; words for it read as meant; a call outside an engine refused", async () => {
    assert.ok(SPACE_GUIDED.includes("app"));
    assert.match(SPACE_TOOL.description, /whose fields go in with: [\w, ]*\bapp\b[\w, ]*;/);
    const g = spaceGuide("app");
    assert.ok(g.ok && g.text.startsWith("## app — the Space's apps\n"), JSON.stringify(g));
    assert.ok(g.ok && g.text.includes("never by clicking its page in the browser"));
    assert.deepEqual(spaceGuide("apps"), g);
    assert.deepEqual(spaceGuide("jobs"), g);
    assert.ok(/** @type {any} */ (spaceGuide(null)).text.includes("\n- app: an app the person kept — how to use it, its rows, its actions, the tools it offers you —, an action or a tool run and its log."));
    const w = await world();
    assert.deepEqual(spaceCall(app(), w.atOf()), { ok: false, error: "Not run: the app action reads and runs, and is answered by Filament's own call of the tool." });
  });
});

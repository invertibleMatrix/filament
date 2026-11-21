// @ts-check
// E42 AS1 and AS3, agents drive the Space's dashboards (HarnessV4_AgentsSpace_Plan cases 8–16, 21d, 23): an agent of
// the project reads the dashboards its Space shows, one whole with its rows and their keys, its watches and its
// buttons; reads a kept one's sources again, as Read again does; pauses one with its line — its bar and What happened
// say who and why, and resuming stays the person's —; and presses a kept button on a row, judged by its chat's gate as
// the button's command would be: asked in Ask mode with the button's own words, run in Full access, refused in Read
// only, a review rule asking with its second look whatever the mode. A press runs from the kept grant as the person's
// does, What happened saying the chat pressed it; a row read again while the person was asked runs nothing. In
// Filament's own loop and in a coding agent's call alike.
// (fails before: yes — the space tool had no dashboard action: an agent saw none of them)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArtifactStore } from "../src/services/artifacts.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createDashboardRunner } from "../src/services/dashboard-runner.js";
import { artifactCall } from "../src/app/agent/artifacts.js";
import { SPACE_GUIDED, SPACE_TOOL, spaceCall, spaceGuide, spaceRun } from "../src/app/agent/space.js";
import { PRESS_MOVED, PRESS_READ_ONLY, pressStandIn } from "../src/app/agent/space-dashboard.js";
import { gate, ruled, toolSetFor } from "../src/app/agent/tools.js";
import { ruleFor } from "../src/app/agent/rules.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { barOf } from "../src/ui/harness/lib/space-dashboards.js";
import { readerNames } from "../src/core/space.js";
import { removeDirs, until } from "./helpers/wait.js";

const dirs = /** @type {string[]} */ ([]);
after(() => removeDirs(...dirs));
const fresh = (/** @type {string} */ tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-sda-${tag}-`));
  dirs.push(d);
  return d;
};

/** The Designer's Deploys with its Roll back button (space-dashboards.test.js's). */
const ROLLBACK = {
  label: "Roll back to this…",
  on: "deploys",
  except: { version: "7c1e" },
  command: ["npx", "wrangler", "rollback", "{row.version}", "--message", "{ask.why}", "--yes"],
  check: { "row.version": "^[0-9a-f]{4}$" },
  ask: [{ name: "why", label: "Why (goes in the deploy's message)", required: true }],
  says: "Roll back app-api to {row.version} ({row.message})? Production serves it at once.",
};
const DEPLOYS = {
  type: "dashboard",
  title: "Deploys",
  tiles: [
    { kind: "status", title: "Live now", from: "deploys", field: "version", words: "{message}", age: "when" },
    { kind: "table", title: "Recent deploys", from: "deploys", columns: ["when", "version", "message"], actions: ["rollback"] },
    { kind: "status", title: "CI on main", from: "runs", field: "status", bad: { status: "failure" }, good: { status: "success" } },
  ],
  tables: { deploys: [{ when: "2026-10-24T12:00:00Z", version: "7c1e", message: "Fix login" }], runs: [{ run: 8812, status: "failure" }] },
  sources: {
    deploys: {
      command: ["npx", "wrangler", "deployments", "list", "--json"],
      key: "id",
      order: "-when",
      every: "2m",
      columns: { when: "created_on", version: "versions.0.version_id", message: "annotations.workers/message" },
    },
    runs: { command: ["gh", "run", "list", "--json", "databaseId,conclusion"], key: "databaseId", columns: { run: "databaseId", status: "conclusion" } },
  },
  watch: [{ from: "runs", new: true, match: { status: "failure" }, says: "CI failed on main: run {row.run}", every: "10m" }],
  actions: { rollback: ROLLBACK },
};
const WRANGLER = JSON.stringify([
  { id: "a", created_on: "2026-10-23T10:00:00Z", versions: [{ version_id: "3f2a" }], annotations: { "workers/message": "Add retry" } },
  { id: "b", created_on: "2026-10-24T12:00:00Z", versions: [{ version_id: "7c1e" }], annotations: {} },
]);
const RAN = 'npx wrangler rollback 3f2a --message "the login broke" --yes';
const NAME = "deploys-ab12";
const NAMES = /** @type {Record<string, string>} */ ({ c1: "Release", c2: "Docs" });

/**
 * A project p1 with its folder, its chats c1 and c2, the dashboards' runner on stand-ins; `apart`, the chats whose words
 * are none of another chat's agent's. @param {{ dir?: string | null, apart?: (chain: string) => boolean }} [o]
 */
function worldOf({ dir = null, apart = undefined } = {}) {
  const clock = { at: Date.UTC(2026, 9, 26, 14, 0) };
  const now = () => clock.at;
  const artifacts = createArtifactStore({ dataDir: fresh("art"), log: () => {}, now, four: (() => { const f = ["ab12", "cd34"]; return () => f.shift() || "zzzz"; })() });
  const spaces = createSpaceStore({ dir, now });
  /** @type {string[]} */
  const ran = [];
  /** @type {Record<string, import("../src/core/dashboard-sources.js").CommandOut>} */
  const answers = { npx: { ok: true, out: WRANGLER }, gh: { ok: true, out: JSON.stringify([{ databaseId: 1, conclusion: "failure" }]) } };
  /** @type {string[][]} */
  const acted = [];
  /** Each agent's check started, by what it was told. @type {any[]} */
  const checked = [];
  const hold = { on: false };
  /** A source's read held until `release`. */
  const readHold = { on: false, release: () => {} };
  const runner = createDashboardRunner({
    spaces,
    artifacts,
    folderOf: (p) => (p === "p1" ? "/work/app" : null),
    projectOfChain: (c) => (c.startsWith("c") ? "p1" : null),
    now,
    run: async (argv) => {
      ran.push(argv.join(" "));
      if (readHold.on) await new Promise((/** @type {(v?: unknown) => void} */ r) => (readHold.release = () => r()));
      return answers[argv[0]] || { ok: false, error: `${argv[0]} was not found on this computer` };
    },
    act: async (argv, _cwd, signal) => {
      acted.push(argv);
      if (hold.on) {
        await new Promise((done) => signal?.addEventListener("abort", done, { once: true }));
        return { ok: false, error: "you stopped it", said: "Rolling back…\n" };
      }
      return { ok: true, said: "Rolling back…\nRolled back to 3f2a\n" };
    },
    checks: { start: (o) => (checked.push(o), { ok: true, chain: o.chainId, agent: `sa-${checked.length}` }), ended: () => new Promise(() => {}) },
    ...(apart ? { apart } : {}),
  });
  const publish = (/** @type {any} */ input, chain = "c1") => {
    const r = artifactCall({ action: "publish", ...input }, { who: chain, by: { chain, model: "m-1", folder: "/work/app", helper: null }, within: [], port: 20300, maxBytes: 1_000_000 }, artifacts);
    assert.ok(r.ok, r.ok ? "" : r.error);
  };
  /** Where a call of a chat stands. @param {Record<string, any>} [o] @returns {import("../src/app/agent/space.js").SpaceAt} */
  const atOf = (o = {}) => ({ store: spaces, project: "p1", chain: "c1", name: null, nameOf: (c) => NAMES[c] || c, on: () => true, dashboards: runner, judge: async () => ({ ok: true }), ...o });
  return { clock, artifacts, spaces, ran, answers, acted, checked, hold, readHold, runner, publish, atOf };
}
/** @param {any} r */
const words = (r) => (r.ok ? r.text : r.error);
/** A call of the dashboard action. @param {Record<string, any>} [w] */
const dash = (w) => ({ action: "dashboard", ...(w ? { with: w } : {}) });

describe("the agent reads the dashboards (cases 8, 9)", () => {
  test("none: it says so; a draft one of the chats published, named as a draft", async () => {
    const w = worldOf();
    assert.equal(words(await spaceRun(dash(), w.atOf())), "No dashboards in this project's Space. An agent makes one with the artifact tool (a dashboard, or an app: its own page with the same sources and buttons); the person keeps it, and then it reads by itself.");
    w.publish(DEPLOYS);
    const text = words(await spaceRun(dash(), w.atOf()));
    assert.match(text, /^Dashboards in this project's Space, as of [\d-]+ [\d:]+: 0 kept, 1 draft\.\n/);
    assert.ok(text.includes(`- ${NAME} “Deploys” · a draft, v1: nothing of it reads or runs until the person keeps it`), text);
    assert.ok(text.endsWith('{"action":"dashboard","with":{"name":"deploys"}} reads one whole: its rows with their keys, its watches and its buttons.'), text);
    assert.deepEqual(w.ran, [], "a draft reads nothing");
  });

  test("a draft whole: its sample rows, marked as the agent's; its buttons said to run once kept", async () => {
    const w = worldOf();
    w.publish(DEPLOYS);
    const text = words(await spaceRun(dash({ name: NAME }), w.atOf()));
    assert.ok(text.startsWith(`“Deploys” (${NAME}) in this project's Space, as of `), text);
    assert.ok(text.includes("A draft's sample rows, as the agent that made it read them — not read by Filament:"), text);
    assert.ok(text.includes("version 7c1e · message Fix login"), text);
    assert.ok(text.includes("Buttons — they run once it is kept:"), text);
    assert.ok(!text.includes('"press"'), "no call to press a draft's button");
    assert.deepEqual(w.ran, []);
  });

  test("a kept one whole, by its name or its title: read first where older than its every; each row with its key and the buttons on it", async () => {
    const w = worldOf();
    w.publish(DEPLOYS);
    w.runner.keep("p1", NAME, 1);
    const text = words(await spaceRun(dash({ name: "deploys" }), w.atOf()));
    assert.match(text, /^“Deploys” \(deploys-ab12\) in this project's Space, as of [\d-]+ [\d:]+: kept, v1\.\n/);
    assert.ok(text.includes("Source deploys — npx wrangler deployments list --json, read every 2 min:"), text);
    assert.ok(text.includes('  - "a": when 2026-10-23T10:00:00Z · version 3f2a · message Add retry · buttons: rollback'), text);
    assert.ok(text.includes('  - "b": when 2026-10-24T12:00:00Z · version 7c1e · message '), "the version serving now");
    assert.ok(!/"b": [^\n]*buttons/.test(text), "Roll back is not on the row serving now");
    assert.ok(text.includes("  - a new row of runs where status is failure → What happened, every 10 min"), text);
    assert.ok(text.includes("  - rollback “Roll back to this…” on deploys, not where version is 7c1e: “Roll back app-api to {row.version} ({row.message})? Production serves it at once.” — runs npx wrangler rollback {row.version} --message {ask.why} --yes; its fields: why (required)"), text);
    assert.ok(text.includes('{"action":"dashboard","with":{"name":"deploys-ab12","press":"rollback","row":"<its key>","ask":{…its fields}}}'), text);
    assert.deepEqual(w.ran.sort(), ["gh run list --json databaseId,conclusion", "npx wrangler deployments list --json"], "each source read once");
    const again = words(await spaceRun(dash({ name: NAME }), w.atOf()));
    assert.equal(w.ran.length, 2, "younger than its every: read as it was");
    assert.ok(again.includes('"a": when'));
    assert.equal(words(await spaceRun(dash({ name: "nope" }), w.atOf())), 'Not run: there is no dashboard "nope" in this Space: {"action":"dashboard"} lists them.');
  });
});

describe("Read again and Pause (cases 10, 11)", () => {
  test("Read again reads now, a fresh source too; a failure counts as the page's does, and says itself", async () => {
    const w = worldOf();
    w.publish(DEPLOYS);
    w.runner.keep("p1", NAME, 1);
    await spaceRun(dash({ name: NAME }), w.atOf());
    const before = w.ran.length;
    await spaceRun(dash({ name: NAME, read: "deploys" }), w.atOf());
    assert.deepEqual(w.ran.slice(before), ["npx wrangler deployments list --json"], "one source, though fresh");
    w.answers.npx = { ok: false, error: "npx exited 1: not signed in" };
    // Read at the world's clock: the real one put the failure "22 h ago" once 10-26 19:00 had passed.
    const text = words(await spaceRun(dash({ name: NAME, read: true }), w.atOf(), w.clock.at));
    assert.ok(text.includes("Its last read failed 0 s ago: npx exited 1: not signed in. Its rows below are from its last good read."), text);
    const st = w.runner.shown("p1")[0].sources.deploys;
    assert.deepEqual([st?.fails, st?.stopped], [1, false], "counted as the page's Read again");
    assert.equal(words(await spaceRun(dash({ name: NAME, read: "nope" }), w.atOf())), "Not read: “Deploys” has no source nope; its sources are deploys, runs.");
  });

  test("Pause with its line: as the person's Pause, its bar and What happened say who and why; resuming is the person's", async () => {
    const dir = fresh("sp");
    const w = worldOf({ dir });
    w.publish(DEPLOYS);
    w.runner.keep("p1", NAME, 1);
    assert.equal(words(await spaceRun(dash({ name: NAME, pause: true }), w.atOf())), 'Not changed: say why, in a line: {"action":"dashboard","with":{"name":"deploys-ab12","pause":"its deploy key expired; every read fails"}}.');
    const r = await spaceRun(dash({ name: NAME, pause: "its deploy key expired; every read fails" }), w.atOf());
    assert.equal(words(r), "“Deploys” is paused: nothing of it reads, watches or runs until the person resumes it. Its bar says you paused it, with your line, and so does What happened.");
    const d = w.runner.shown("p1")[0];
    assert.deepEqual([d.paused, d.pausedBy], [true, { chain: "c1", byName: "Release", line: "its deploy key expired; every read fails" }]);
    assert.deepEqual(w.spaces.get("p1").log.at(-1), { id: w.spaces.get("p1").log.at(-1)?.id, at: w.clock.at, by: { kind: "agent", chain: "c1" }, text: "Paused “Deploys”: its deploy key expired; every read fails", task: null });
    assert.equal(barOf(/** @type {any} */ (d), w.clock.at).words, "Paused by Release: its deploy key expired; every read fails · nothing of it reads or runs");
    assert.equal(words(await spaceRun(dash({ name: NAME, pause: "again" }), w.atOf({ chain: "c2" }))), "Not changed: “Deploys” is paused already, by Release: its deploy key expired; every read fails.");
    assert.equal(words(await spaceRun(dash({ name: NAME, resume: true }), w.atOf())), "Not changed: resuming “Deploys” is the person's — it lets it read and run by itself again. Say in your answer why it may go on.");
    assert.equal(words(await spaceRun(dash({ name: NAME, read: true }), w.atOf())), "Not read: “Deploys” is paused: nothing of it reads until the person resumes it.");
    // Kept in the Space's file, as it was said.
    const reread = createSpaceStore({ dir, now: () => w.clock.at });
    assert.deepEqual(reread.get("p1").dashboards[0].pausedBy, { chain: "c1", byName: "Release", line: "its deploy key expired; every read fails" });
    // Your Resume says whose pause it ends; its bar reads as ever.
    w.runner.change("p1", NAME, { paused: false });
    assert.equal(w.spaces.get("p1").log.at(-1)?.text, "You resumed “Deploys”, which Release had paused: its deploy key expired; every read fails");
    assert.equal(w.runner.shown("p1")[0].pausedBy, null);
    w.runner.change("p1", NAME, { paused: true });
    assert.equal(barOf(/** @type {any} */ (w.runner.shown("p1")[0]), w.clock.at).words, "Paused · nothing of it reads or runs", "yours reads as today");
    assert.equal(words(await spaceRun(dash({ name: NAME, pause: "x" }), w.atOf())), "Not changed: “Deploys” is paused already, by the person.");
  });

  test("a draft: nothing to pause or read", async () => {
    const w = worldOf();
    w.publish(DEPLOYS);
    assert.equal(words(await spaceRun(dash({ name: NAME, pause: "why" }), w.atOf())), "Not changed: “Deploys” is a draft: nothing of it runs to pause.");
    assert.equal(words(await spaceRun(dash({ name: NAME, read: true }), w.atOf())), "Not read: “Deploys” is a draft: nothing of it reads until the person keeps it.");
  });
});

describe("a press judged as its command (SA-D4, cases 12–15)", () => {
  /** The press as the gate judges it. @param {ReturnType<typeof worldOf>} w */
  const standIn = async (w) => {
    w.publish(DEPLOYS);
    w.runner.keep("p1", NAME, 1);
    await w.runner.read(NAME, 1, "deploys");
    const s = pressStandIn({ name: NAME, press: "rollback", row: "a", ask: { why: "the login broke" } }, w.atOf());
    assert.ok(s?.ok, JSON.stringify(s));
    return /** @type {any} */ (s).call;
  };
  const QUESTION = `May I press “Roll back to this…” on “Deploys”? It says: Roll back app-api to 3f2a (Add retry)? Production serves it at once. It runs \`${RAN}\` in /work/app — answer /allow to press it, or say what to do instead.`;

  test("the button's command, as bash, with its words: Ask mode asks in them, Full access runs, Read only refuses; never read as one that only reads", async () => {
    const call = await standIn(worldOf());
    assert.deepEqual(call, { name: "bash", input: { command: RAN, press: { dashboard: "Deploys", label: "Roll back to this…", says: "Roll back app-api to 3f2a (Add retry)? Production serves it at once.", runs: RAN, folder: "/work/app", effect: "writes", allowed: false } } });
    const reads = () => /** @type {any} */ ({ ok: true });
    assert.deepEqual(gate("edit", call.name, call.input, null, undefined, reads), { verdict: "ask", question: QUESTION });
    assert.deepEqual(gate("auto", call.name, call.input, null, undefined, reads), { verdict: "run" });
    assert.equal(gate("read-only", call.name, call.input, null, undefined, reads).verdict, "refuse", "a reader that says it only reads is not asked");
  });

  test("a review rule that covers its command asks with its second look, in every mode", async () => {
    const call = await standIn(worldOf());
    const rules = [{ tool: "bash", pattern: "npx wrangler rollback *", verdict: /** @type {const} */ ("review") }];
    const hit = ruleFor(rules, call.name, call.input);
    const v = ruled(gate("auto", call.name, call.input), hit, call.name, call.input, "", () => true);
    assert.deepEqual([v.verdict, /** @type {any} */ (v).review, /** @type {any} */ (v).question], ["ask", true, `${QUESTION} A rule of this session asks for a second look first.`]);
  });

  test("a tool's button judged as that connection's tool", async () => {
    const w = worldOf();
    w.publish({ ...DEPLOYS, actions: { rollback: { ...ROLLBACK, command: undefined, check: {}, tool: { connection: "cloudflare", name: "rollback", args: { version: "{row.version}", message: "{ask.why}" } } } } });
    w.runner.keep("p1", NAME, 1);
    await w.runner.read(NAME, 1, "deploys");
    const s = /** @type {any} */ (pressStandIn({ name: NAME, press: "rollback", row: "a", ask: { why: "broke" } }, w.atOf()));
    assert.equal(s.call.name, "mcp__cloudflare__rollback");
    assert.deepEqual([s.call.input.version, s.call.input.message, s.call.input.press.runs], ["3f2a", "broke", 'cloudflare › rollback {"version":"3f2a","message":"broke"}']);
    assert.equal(gate("edit", s.call.name, s.call.input).verdict, "ask");
  });
});

describe("a press run (cases 13, 16, 21d)", () => {
  test("judged yes: run from the kept grant, the chat's line in What happened, its source read again; the answer says what it said", async () => {
    const w = worldOf();
    w.publish(DEPLOYS);
    w.runner.keep("p1", NAME, 1);
    await spaceRun(dash({ name: NAME }), w.atOf());
    /** @type {any[]} */
    const judged = [];
    const r = await spaceRun(dash({ name: NAME, press: "rollback", row: "a", ask: { why: "the login broke" } }), w.atOf({ judge: async (/** @type {any} */ c) => (judged.push(c), { ok: true }) }));
    assert.equal(r.ok, true, words(r));
    // Its run's id, which "log" reads, and what it said before its last line (the Space Apps plan of 10-29).
    const id = /** @type {any} */ (w.runner.jobsOf(NAME)[0]).id;
    assert.ok(words(r).startsWith(`Pressed “Roll back to this…” on “Deploys” ran ${RAN} — Rolled back to 3f2a. Its run is ${id}.\n\nIts last lines:\n  Rolling back…\n  Rolled back to 3f2a\n\n“Deploys” (${NAME})`), words(r));
    assert.deepEqual(judged.map((c) => [c.name, c.input.command]), [["bash", RAN]]);
    assert.deepEqual(w.acted, [["npx", "wrangler", "rollback", "3f2a", "--message", "the login broke", "--yes"]]);
    const line = w.spaces.get("p1").log.at(-1);
    assert.deepEqual([line?.by, line?.text], [{ kind: "agent", chain: "c1" }, `Pressed “Roll back to this…” on Deploys: ${RAN} — Rolled back to 3f2a`]);
  });

  // The owner's word of 10-31: no agent starts behind the person's back. An agent's press asks no other agent to check
  // it — that is the person's, from the button's sheet, on the model they choose —: it reads the rows read again itself.
  // (fails before: yes — "check":true started the Skeptic in the chat that made the dashboard, on a model nobody chose)
  test("an agent's press starts no check, whatever its call says: its answer says so, and gives the rows read again", async () => {
    const w = worldOf();
    w.publish(DEPLOYS);
    w.runner.keep("p1", NAME, 1);
    await spaceRun(dash({ name: NAME }), w.atOf());
    const r = await spaceRun(dash({ name: NAME, press: "rollback", row: "a", ask: { why: "the login broke" }, check: true }), w.atOf());
    assert.equal(r.ok, true, words(r));
    assert.ok(words(r).includes(" No check: Filament starts no agent for it — an agent's check is the person's, from the button's sheet. Its rows, read again, are below."), words(r));
    assert.ok(words(r).includes(`“Deploys” (${NAME})`), "the rows read again follow");
    assert.deepEqual([w.acted.length, w.checked.length], [1, 0], "it ran; no agent started");
    // Its words never offer one.
    assert.ok(!words(await spaceRun(dash({ name: NAME }), w.atOf())).includes('"check":true'));
  });

  test("refused in words, nothing run: a stale row, a value failing its check, a field left empty, a draft's button, paused, no row named, the gate's no", async () => {
    const w = worldOf();
    w.publish(DEPLOYS);
    const press = (/** @type {Record<string, any>} */ x, /** @type {any} */ o = {}) => spaceRun(dash({ name: NAME, press: "rollback", row: "a", ask: { why: "x" }, ...x }), w.atOf(o)).then(words);
    assert.equal(await press({}), "Not pressed: “Deploys” is a draft: its buttons run once the person keeps it.");
    w.runner.keep("p1", NAME, 1);
    assert.equal(await press({}), "Not pressed: deploys has not been read yet: read it first.");
    await w.runner.read(NAME, 1, "deploys");
    assert.equal(await press({ row: "zz" }), "Not pressed: that row is no longer in deploys: read it again.");
    assert.equal(await press({ row: "b" }), "Not pressed: Roll back to this… is not on that row.");
    assert.equal(await press({ ask: {} }), "Not pressed: Why (goes in the deploy's message) is empty: it is needed.");
    assert.equal(await press({ row: "" }), `Not pressed: name the row by its key, as {"action":"dashboard","with":{"name":"${NAME}"}} gives it: {"action":"dashboard","with":{"name":"${NAME}","press":"rollback","row":"<its key>","ask":{…its fields}}}`);
    assert.equal(await press({}, { judge: async () => ({ ok: false, error: "the person declined it" }) }), "Not pressed: the person declined it.");
    assert.equal(await press({}, { judge: null }), "Not pressed: no turn of this chat runs now to judge the press.");
    w.answers.npx = { ok: true, out: JSON.stringify([{ id: "a", created_on: "2026-10-23T10:00:00Z", versions: [{ version_id: "3f2a;rm" }], annotations: {} }]) };
    await w.runner.read(NAME, 1, "deploys", { force: true });
    assert.equal(await press({}), "Not pressed: {row.version} is “3f2a;rm”, which does not match its check ^[0-9a-f]{4}$.");
    w.runner.change("p1", NAME, { paused: true });
    assert.equal(await press({}), "Not pressed: “Deploys” is paused: nothing of it runs until the person resumes it.");
    assert.deepEqual(w.acted, [], "nothing ran");
  });

  test("the row read again while the press was judged: nothing runs", async () => {
    const w = worldOf();
    w.publish(DEPLOYS);
    w.runner.keep("p1", NAME, 1);
    await w.runner.read(NAME, 1, "deploys");
    const moved = async () => {
      w.answers.npx = { ok: true, out: WRANGLER.replace("3f2a", "9e9e") };
      await w.runner.read(NAME, 1, "deploys", { force: true });
      return { ok: /** @type {const} */ (true) };
    };
    const r = await spaceRun(dash({ name: NAME, press: "rollback", row: "a", ask: { why: "x" } }), w.atOf({ judge: moved }));
    assert.equal(words(r), "Not pressed: the row changed since the press was judged: read the dashboard again, and press it anew.");
    assert.deepEqual(w.acted, []);
  });

  test("running: its tab says so and who pressed it, with Stop; another chat stops it not; its own Stop or the turn's stops it", async () => {
    const w = worldOf();
    w.publish(DEPLOYS);
    w.runner.keep("p1", NAME, 1);
    await w.runner.read(NAME, 1, "deploys");
    w.hold.on = true;
    const stop = new AbortController();
    const pressing = spaceRun(dash({ name: NAME, press: "rollback", row: "a", ask: { why: "one" } }), w.atOf({ signal: stop.signal }));
    await until(() => w.acted.length === 1, "the press runs");
    const d = /** @type {any} */ (w.runner.shown("p1")[0]);
    assert.deepEqual(d.running, { label: "Roll back to this…", action: "rollback", by: "Release", byChain: "c1" });
    assert.deepEqual([barOf(d, Date.now()).words, barOf(d, Date.now()).press], ["“Roll back to this…” is running · pressed by Release", "stop"]);
    assert.equal(words(await spaceRun(dash({ name: NAME, stop: true }), w.atOf({ chain: "c2" }))), "Not stopped: “Roll back to this…” was pressed by Release: that chat or the person stops it.");
    assert.equal(words(await spaceRun(dash({ name: NAME, press: "rollback", row: "a", ask: { why: "two" } }), w.atOf({ chain: "c2" }))), "Not pressed: Roll back to this… is running on Deploys, pressed by Release: wait for it, or stop it.");
    stop.abort();
    const r = await pressing;
    assert.equal(r.ok, false);
    assert.ok(words(r).startsWith(`Pressed “Roll back to this…” on “Deploys” ran npx wrangler rollback 3f2a --message one --yes, and it was stopped. Its last line: Rolling back…`), words(r));
    assert.equal(w.spaces.get("p1").log.at(-1)?.text, "Pressed “Roll back to this…” on Deploys: npx wrangler rollback 3f2a --message one --yes — it was stopped");
    assert.equal(w.runner.shown("p1")[0].running, null);
    // Its own Stop.
    const again = spaceRun(dash({ name: NAME, press: "rollback", row: "a", ask: { why: "three" } }), w.atOf());
    await until(() => w.acted.length === 2, "the second press runs");
    assert.equal(words(await spaceRun(dash({ name: NAME, stop: true }), w.atOf())), "Stopped “Roll back to this…” on “Deploys”: what it did before the stop stays done.");
    assert.equal((await again).ok, false);
  });

  // (fails before: yes — round 7's lead 1 of the 11-02 privacy round: the press and the pause kept the chat by its name
  // alone, and c2's agent read c1 by it: "pressed by Release" in its read, its press's and its stop's refusals, its runs'
  // list, and "paused by Release" in its read and its press's refusal)
  test("a press and a pause by a chat whose words are none of the reader's name it as an untitled chat to that reader: the read, the runs, the refusals; its own agent and the person's page read its name", async () => {
    const w = worldOf({ apart: (c) => c === "c1" });
    w.publish(DEPLOYS);
    w.runner.keep("p1", NAME, 1);
    await w.runner.read(NAME, 1, "deploys");
    /** c2's agent, for which c1 is apart. @param {Record<string, any>} [o] */
    const c2 = (o = {}) => w.atOf({ chain: "c2", ...readerNames({ nameOf: (c) => NAMES[c] || c, apart: (c) => c === "c1" }, "c2"), ...o });
    w.hold.on = true;
    const stop = new AbortController();
    const pressing = spaceRun(dash({ name: NAME, press: "rollback", row: "a", ask: { why: "one" } }), w.atOf({ signal: stop.signal }));
    await until(() => w.acted.length === 1, "the press runs");
    const said = [
      words(await spaceRun(dash({ name: NAME }), c2())),
      words(await spaceRun(dash({ name: NAME, stop: true }), c2())),
      words(await spaceRun(dash({ name: NAME, press: "rollback", row: "a", ask: { why: "two" } }), c2())),
    ];
    assert.deepEqual([said[0].includes("“Roll back to this…” is running, pressed by an untitled chat"), said[1], said[2]], [
      true,
      "Not stopped: “Roll back to this…” was pressed by an untitled chat: that chat or the person stops it.",
      "Not pressed: Roll back to this… is running on Deploys, pressed by an untitled chat: wait for it, or stop it.",
    ], said[0]);
    assert.equal(/** @type {any} */ (w.runner.shown("p1")[0]).running.by, "Release", "the person's page reads its name");
    assert.match(words(await spaceRun(dash({ name: NAME }), w.atOf())), /is running, pressed by Release/, "its own agent reads its own name");
    stop.abort();
    await pressing;
    assert.match(words(await spaceRun(dash({ name: NAME }), c2())), /rollback on "a" .*: stopped, .*pressed by an untitled chat/);
    assert.match(words(await spaceRun(dash({ name: NAME }), w.atOf())), /rollback on "a" .*: stopped, .*pressed by Release/);
    // Paused by c1, with its line.
    assert.equal((await spaceRun(dash({ name: NAME, pause: "its deploy key expired" }), w.atOf())).ok, true);
    assert.match(words(await spaceRun(dash({ name: NAME }), c2())), /paused by an untitled chat: its deploy key expired/);
    assert.equal(words(await spaceRun(dash({ name: NAME, press: "rollback", row: "a", ask: { why: "x" } }), c2())), "Not pressed: “Deploys” is paused (by an untitled chat: its deploy key expired): nothing of it runs until the person resumes it.");
  });

  // (fails before: yes — found reviewing the Space work: the turn's stop was heard until the read after its press, and
  // stopped the person's press made meanwhile)
  test("a turn's stop stops its own press alone: one the person pressed once it ran runs on", async () => {
    const w = worldOf();
    w.publish(DEPLOYS);
    w.runner.keep("p1", NAME, 1);
    await w.runner.read(NAME, 1, "deploys");
    const turn = new AbortController();
    w.readHold.on = true;
    const agent = spaceRun(dash({ name: NAME, press: "rollback", row: "a", ask: { why: "one" } }), w.atOf({ signal: turn.signal }));
    // Its run ended; the read after it waits.
    await until(() => w.acted.length === 1 && w.runner.shown("p1")[0].running === null, "the agent's press ran");
    w.hold.on = true;
    const person = w.runner.act("p1", NAME, "rollback", "a", { why: "two" });
    await until(() => w.acted.length === 2, "the person's press runs");
    turn.abort();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(w.runner.shown("p1")[0].running, { label: "Roll back to this…", action: "rollback", by: null }, "the person's press runs on");
    w.readHold.on = false;
    w.readHold.release();
    assert.equal(w.runner.stopAct("p1", NAME).ok, true);
    await Promise.all([agent, person]);
  });
});

/** A scripted model call for Filament's loop. */
const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
const PRESS = { action: "dashboard", with: { name: NAME, press: "rollback", row: "a", ask: { why: "the login broke" } } };

describe("in Filament's own loop (case 12)", () => {
  /** A turn whose model presses Roll back, then ends. @param {ReturnType<typeof worldOf>} w @param {Record<string, any>} over */
  const turn = (w, over) => {
    let n = 0;
    /** @type {any[]} */
    const events = [];
    const run = runAgentTurn(/** @type {any} */ ({
      model: "m",
      messages: [{ role: "user", content: "roll it back" }],
      system: "s",
      tools: toolSetFor({ delegateRead: false }),
      modeNow: () => "edit",
      root: tmpdir(),
      readerModel: "",
      maxTokens: 100,
      call: async () => (++n === 1 && !over.resume ? reply([toolUse("p1", "space", PRESS)]) : reply([{ type: "text", text: "Done." }])),
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
  const ready = async () => {
    const w = worldOf();
    w.publish(DEPLOYS);
    w.runner.keep("p1", NAME, 1);
    await w.runner.read(NAME, 1, "deploys");
    return w;
  };
  const QUESTION = `May I press “Roll back to this…” on “Deploys”? It says: Roll back app-api to 3f2a (Add retry)? Production serves it at once. It runs \`${RAN}\` in /work/app — answer /allow to press it, or say what to do instead.`;
  /** The space call's result in a turn's work. @param {any} out */
  const resultOf = (out) => out.work.flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : [])).find((/** @type {any} */ b) => b.type === "tool_result" && b.tool_use_id === "p1");

  test("Ask mode: the turn asks with the button's words and its command; a yes runs it", async () => {
    const w = await ready();
    const { run, events } = turn(w, {});
    const out = /** @type {any} */ (await run);
    assert.equal(out.status, "paused");
    const ask = events.find((e) => e.type === "ask");
    assert.deepEqual([ask.kind, ask.tool, ask.question, ask.command], ["permission", "space", QUESTION, RAN]);
    assert.equal(out.pause.question, QUESTION);
    assert.deepEqual(w.acted, [], "nothing ran before the yes");
    const yes = /** @type {any} */ (await turn(w, { resume: { paused: out.pause, answer: "yes", allow: true }, messages: out.pause.convo }).run);
    assert.equal(yes.status, "done");
    assert.match(String(resultOf(yes)?.content), /^Pressed “Roll back to this…” on “Deploys” ran /);
    assert.deepEqual(w.acted, [["npx", "wrangler", "rollback", "3f2a", "--message", "the login broke", "--yes"]]);
  });

  test("the row changed while the person was asked: a yes runs nothing", async () => {
    const w = await ready();
    const out = /** @type {any} */ (await turn(w, {}).run);
    w.answers.npx = { ok: true, out: WRANGLER.replace("3f2a", "9e9e") };
    await w.runner.read(NAME, 1, "deploys", { force: true });
    const yes = /** @type {any} */ (await turn(w, { resume: { paused: out.pause, answer: "yes", allow: true }, messages: out.pause.convo }).run);
    assert.equal(resultOf(yes)?.content, PRESS_MOVED);
    assert.deepEqual(w.acted, []);
  });

  test("Full access runs it at once; Read only refuses it in words", async () => {
    const w = await ready();
    const full = /** @type {any} */ (await turn(w, { modeNow: () => "auto" }).run);
    assert.equal(full.status, "done");
    assert.equal(w.acted.length, 1);
    const ro = /** @type {any} */ (await turn(w, { modeNow: () => "read-only" }).run);
    assert.equal(resultOf(ro)?.content, PRESS_READ_ONLY);
    assert.equal(w.acted.length, 1, "nothing more ran");
  });

  test("a read of the dashboards asks nothing, in any mode", async () => {
    const w = await ready();
    let n = 0;
    const out = /** @type {any} */ (await turn(w, { modeNow: () => "read-only", call: async () => (++n === 1 ? reply([toolUse("p1", "space", { action: "dashboard", with: { name: NAME } })]) : reply([{ type: "text", text: "Done." }])) }).run);
    assert.equal(out.status, "done");
    assert.match(String(resultOf(out)?.content), /^“Deploys” \(deploys-ab12\)/);
  });
});

describe("in a coding agent's call (case 23)", () => {
  test("the same press, judged by the session's switch through its permit, the button's command its request", async () => {
    const w = worldOf();
    w.publish(DEPLOYS);
    w.runner.keep("p1", NAME, 1);
    await w.runner.read(NAME, 1, "deploys");
    const tools = createAgentTools({
      memory: null, memoryToolsOn: () => false, graphs: () => null, turns: { get: () => null }, subagents: () => null, membersOf: () => null,
      space: { store: w.spaces, projectOf: (c) => (c.startsWith("c") ? "p1" : null), nameOf: (c) => NAMES[c] || c, on: () => true, dashboards: w.runner },
    });
    /** @type {any[]} */
    const asked = [];
    let answer = /** @type {Error | null} */ (null);
    const permit = async (/** @type {any[]} */ calls, /** @type {string} */ what) => {
      asked.push([calls, what]);
      if (answer) throw answer;
      return { asked: true };
    };
    const ctx = /** @type {any} */ ({ cwd: "/r", chain: "c1", permit });
    const r = await tools.call("space", PRESS, ctx);
    assert.equal(r.isError, undefined, r.text);
    assert.match(r.text, /^Pressed “Roll back to this…” on “Deploys” ran /);
    assert.deepEqual(asked.map(([calls, what]) => [calls[0].name, calls[0].input.command, what]), [["bash", RAN, "press “Roll back to this…” on Deploys"]]);
    answer = new Error("the person declined it");
    assert.deepEqual(await tools.call("space", PRESS, ctx), { text: "Not pressed: the person declined it.", isError: true });
    assert.deepEqual(await tools.call("space", PRESS, { ...ctx, permit: null }), { text: "Not pressed: no turn of this chat runs now to judge the press.", isError: true });
    assert.equal(w.acted.length, 1, "only the yes ran");
    const read = await tools.call("space", { action: "dashboard" }, { ...ctx, permit: null });
    assert.match(read.text, /^Dashboards in this project's Space/, "a read needs no permit");
  });
});

describe("the door and the guide name it", () => {
  test("dashboard is a guided action; its topic whole; words for it read as meant; the door stays small", () => {
    assert.ok(SPACE_GUIDED.includes("dashboard"));
    assert.match(SPACE_TOOL.description, /whose fields go in with: [\w, ]*\bdashboard\b[\w, ]*;/);
    const g = spaceGuide("dashboard");
    assert.ok(g.ok && g.text.startsWith("## dashboard — the Space's dashboards\n"), JSON.stringify(g));
    assert.deepEqual(spaceGuide("buttons"), g, "a button is the dashboard's");
    assert.ok(/** @type {any} */ (spaceGuide(null)).text.includes("- dashboard: the dashboards — each one's rows, watches and buttons —, a source read again, one paused, a kept button pressed."));
    assert.ok(JSON.stringify(SPACE_TOOL).length < 2500, `the door is ${JSON.stringify(SPACE_TOOL).length} chars`);
    // A call of it outside an engine's own call is refused, not left hanging.
    const w = worldOf();
    assert.deepEqual(spaceCall(dash(), w.atOf()), { ok: false, error: "Not run: the dashboard action reads and runs, and is answered by Filament's own call of the tool." });
  });
});

// @ts-check
// What a button does (the Space Apps plan of 10-29, "effects"; the owner's "finish the space work fully"): `keeps` changes
// the app's own data alone and runs as you press it, with no sheet; `writes` changes this machine — every button before —
// and opens Filament's sheet; `sends` leaves the machine: an agent's press of it always asks you, whatever its chat's
// mode, unless you let agents press that button. And an app's builder's words for agents: `howto` and `state`.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actionKept, grantOf, sameGrant, sourcesOf } from "../src/core/dashboard-sources.js";
import { appOf } from "../src/core/artifact-content.js";
import { gate, ruled, sendsAlways } from "../src/app/agent/tools.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createDashboardRunner } from "../src/services/dashboard-runner.js";
import { artifactCall } from "../src/app/agent/artifacts.js";
import { dashboardWords, pressStandIn } from "../src/app/agent/space-dashboard.js";
import { PRESS_GROUPS, keepLines } from "../src/ui/harness/lib/space-dashboards.js";

const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SOURCES = { posts: { command: ["node", "posts.mjs"], rows: "posts", key: "id" } };
const POST = { label: "Post it…", on: "posts", command: ["node", "post.mjs", "{row.key}"], check: { "row.key": "^p\\d+$" }, says: "Post {row.key} to the blog?", effect: "sends" };
const MARK = { label: "Mark read", on: "posts", command: ["node", "mark.mjs", "{row.key}"], check: { "row.key": "^p\\d+$" }, says: "Mark {row.key} read", effect: "keeps" };
const DRAFT = { label: "Draft…", on: "posts", command: ["node", "draft.mjs", "{row.key}"], check: { "row.key": "^p\\d+$" }, says: "Write a draft of {row.key}?" };
const APP = {
  type: "app",
  title: "Blog",
  html: "<!doctype html><title>Blog</title><main></main>",
  sources: SOURCES,
  actions: { post: POST, mark: MARK, draft: DRAFT },
  howto: "To publish: Draft, read it, then Post it.",
  state: { posts: "The blog's posts, the newest first; id p<number>" },
};
const NAME = "blog-ab12";

/** The faults a dashboard's sources and buttons have, as a publish says them. @param {Record<string, any>} actions */
const faultOf = (actions) => {
  const r = sourcesOf({ sources: SOURCES, actions });
  return r.ok ? "" : r.error;
};

describe("a button's effect, as published and kept", () => {
  // (fails before: yes — there was no effect: every button was today's "writes", and none ran without its sheet)
  test("keeps, writes or sends; a keeps button asks, looks again and checks nothing — no sheet opens for it", () => {
    assert.equal(faultOf({ post: POST, mark: MARK, draft: DRAFT }), "");
    assert.match(faultOf({ post: { ...POST, effect: "deploys" } }), /the button post has the effect "deploys": give "keeps" .+, "writes" .+ or "sends"/);
    assert.match(faultOf({ mark: { ...MARK, ask: [{ name: "why", label: "Why" }] } }), /the button mark keeps and has ask: a keeps button runs as it is pressed, with no sheet/);
    assert.match(faultOf({ mark: { ...MARK, secondLook: true } }), /keeps and has secondLook/);
    assert.match(faultOf({ mark: { ...MARK, verify: "it shows read" } }), /keeps and has verify/);
    assert.deepEqual([actionKept(POST).effect, actionKept(MARK).effect, actionKept(DRAFT).effect], ["sends", "keeps", "writes"]);
  });

  test("the grant keeps a button's effect where it is not writes — so a grant kept before effects reads the same — and a changed effect is a new grant", () => {
    const g = grantOf({ sources: SOURCES, actions: { post: POST, mark: MARK, draft: DRAFT } });
    assert.deepEqual([g.actions.post.effect, g.actions.mark.effect, "effect" in g.actions.draft], ["sends", "keeps", false]);
    const before = grantOf({ sources: SOURCES, actions: { draft: DRAFT } });
    assert.ok(sameGrant(before, grantOf({ sources: SOURCES, actions: { draft: { ...DRAFT, effect: "writes" } } })), "writes said or not: the same grant");
    assert.ok(!sameGrant(before, grantOf({ sources: SOURCES, actions: { draft: { ...DRAFT, effect: "sends" } } })), "said to send now: kept again first");
  });

  test("an app's howto and state are its builder's words, checked; another type is told they are an app's", () => {
    const r = appOf(APP);
    assert.ok(r.ok);
    assert.deepEqual([r.ok && r.content.howto, r.ok && r.content.state], [APP.howto, APP.state]);
    assert.match(/** @type {any} */ (appOf({ ...APP, howto: "x".repeat(601) })).error, /^howto is a few lines for the agents that use it, 600 characters at most/);
    assert.match(/** @type {any} */ (appOf({ ...APP, state: { "a b": "x" } })).error, /^state names "a b": a source's or a collection's name/);
    assert.match(/** @type {any} */ (appOf({ ...APP, state: { posts: "" } })).error, /^state's posts is no line/);
    const store = createArtifactStore({ dataDir: fresh(), log: () => {}, four: () => "ab12" });
    const no = artifactCall({ action: "publish", type: "dashboard", title: "D", tiles: [{ kind: "number", title: "N", value: 1 }], howto: "x" }, at(), store);
    assert.match(no.ok ? "" : no.error, /so leave howto out\. An app is type "app"\.$/);
  });
});

describe("an agent's press of a button that sends", () => {
  const press = (/** @type {any} */ p) => ({ command: "node post.mjs p1", press: { dashboard: "Blog", label: "Post it…", says: "Post p1 to the blog?", runs: "node post.mjs p1", folder: "/w", ...p } });
  // (fails before: yes — Full access ran it, as any button)
  test("asks in Full access and in Ask, whatever was learned and whatever a rule allows; read-only refuses; let by the person, the mode judges it", () => {
    const sends = press({ effect: "sends", allowed: false });
    const learned = () => true;
    const auto = gate("auto", "bash", sends, learned);
    assert.equal(auto.verdict, "ask");
    assert.match(auto.verdict === "ask" ? auto.question : "", /^May I press “Post it…” on “Blog”\? .+ It runs `node post\.mjs p1` in \/w\. It sends: it leaves this machine, so an agent's press of it always asks you — answer \/allow/);
    assert.equal(gate("edit", "bash", sends, learned).verdict, "ask");
    assert.equal(gate("read-only", "bash", sends).verdict, "refuse");
    const allowRule = /** @type {any} */ ({ verdict: "allow", rule: { verdict: "allow", tool: "bash", pattern: "*" }, subject: "node post.mjs p1", rules: [] });
    assert.equal(ruled(auto, allowRule, "bash", sends).verdict, "ask", "no rule turns it into a run");
    const allowed = press({ effect: "sends", allowed: true });
    assert.equal(sendsAlways(allowed), false);
    assert.equal(gate("auto", "bash", allowed).verdict, "run", "the person let agents press it: Full access runs it");
    assert.equal(gate("auto", "bash", press({ effect: "writes", allowed: false })).verdict, "run", "a writes button: as before");
  });
});

/** @returns {string} */
function fresh() {
  const d = mkdtempSync(join(tmpdir(), "filament-app-effects-"));
  dirs.push(d);
  return d;
}
/** Where a publish stands: chat c1 of p1, in /work/blog. */
const at = () => ({ who: "c1", by: { chain: "c1", model: "m", folder: "/work/blog", helper: null }, within: [], port: 20300, maxBytes: 1_000_000 });

/** A runner whose Blog app is kept in p1, its posts read. @param {any} [app] */
async function world(app = APP) {
  const now = () => Date.UTC(2026, 9, 29, 16, 0);
  const artifacts = createArtifactStore({ dataDir: fresh(), log: () => {}, now, four: () => "ab12" });
  const spaces = createSpaceStore({ dir: null, now });
  const run = async () => ({ ok: /** @type {const} */ (true), out: JSON.stringify({ posts: [{ id: "p1", title: "Hello" }] }) });
  /** @type {string[][]} */
  const ran = [];
  const act = async (/** @type {string[]} */ argv) => (ran.push(argv), { ok: /** @type {const} */ (true), said: "done\n" });
  const runner = createDashboardRunner({ spaces, artifacts, folderOf: () => "/work/blog", projectOfChain: () => "p1", now, run, act });
  const publish = (/** @type {any} */ input) => artifactCall({ action: "publish", ...input }, at(), artifacts);
  assert.ok(publish(app).ok);
  assert.equal(runner.keep("p1", NAME, 1).ok, true);
  await runner.read(NAME, 1, "posts");
  return { spaces, artifacts, runner, publish, ran };
}

describe("letting agents press a button that sends", () => {
  // (fails before: yes — there was no such word of the person's)
  test("the person's switch, said in What happened; a press's stand-in carries it; refused on a button that does not send", async () => {
    const w = await world();
    const p = /** @type {any} */ (w.runner.pressOf("p1", NAME, "post", "p1", {}));
    assert.deepEqual([p.effect, p.allowed], ["sends", false]);
    assert.deepEqual(/** @type {any} */ (await w.runner.sheet("p1", NAME, "mark", "p1")).effect, "keeps", "the sheet's look says it, so a keeps press runs at once");
    const on = /** @type {any} */ (w.runner.allow("p1", NAME, "post", true));
    assert.deepEqual(on, { ok: true, allowed: ["post"] });
    assert.equal(w.spaces.get("p1").log.at(-1)?.text, "You let agents press “Post it…” on Blog without asking you, though it sends.");
    assert.equal(/** @type {any} */ (w.runner.pressOf("p1", NAME, "post", "p1", {})).allowed, true);
    assert.deepEqual(w.runner.shown("p1").find((d) => d.name === NAME)?.allowed, ["post"]);
    const s = /** @type {any} */ (pressStandIn({ name: NAME, press: "post", row: "p1" }, { project: "p1", chain: "c1", name: null, nameOf: () => "", dashboards: /** @type {any} */ (w.runner) }));
    assert.deepEqual([s.call.input.press.effect, s.call.input.press.allowed], ["sends", true]);
    assert.equal(gate("auto", s.call.name, s.call.input).verdict, "run");
    assert.match(/** @type {any} */ (w.runner.allow("p1", NAME, "draft", true)).error, /^draft does not send: an agent's press of it is judged as its chat's mode says$/);
    assert.match(/** @type {any} */ (w.runner.allow("p1", NAME, "nope", true)).error, /^Blog has no button nope$/);
    w.runner.allow("p1", NAME, "post", false);
    assert.equal(w.spaces.get("p1").log.at(-1)?.text, "Agents ask you again before they press “Post it…” on Blog.");
    assert.equal(/** @type {any} */ (w.runner.pressOf("p1", NAME, "post", "p1", {})).allowed, false);
  });

  test("kept again, the allowance stays on the same button; a button changed asks again", async () => {
    const w = await world();
    w.runner.allow("p1", NAME, "post", true);
    // A next version that changes only the page keeps the grant: still allowed.
    assert.ok(w.publish({ id: NAME, ...APP, title: undefined, html: "<!doctype html><title>Blog</title><main>2</main>" }).ok);
    assert.equal(w.runner.keep("p1", NAME, 2).ok, true);
    assert.deepEqual(w.runner.shown("p1").find((d) => d.name === NAME)?.allowed, ["post"]);
    // One that changes what Post runs: asked again.
    assert.ok(w.publish({ id: NAME, ...APP, title: undefined, actions: { ...APP.actions, post: { ...POST, command: ["node", "post2.mjs", "{row.key}"] } } }).ok);
    assert.equal(w.runner.keep("p1", NAME, 3).ok, true);
    assert.deepEqual(w.runner.shown("p1").find((d) => d.name === NAME)?.allowed, []);
  });
});

describe("what agents and the Keep sheet read of it", () => {
  test("the space tool says each button's effect, the builder's howto and what each source means", async () => {
    const w = await world();
    const seen = /** @type {any} */ (await w.runner.seeOf("p1", NAME));
    const words = dashboardWords(seen, Date.UTC(2026, 9, 29, 16, 0));
    assert.match(words, /\nHow to use it, as its builder wrote: To publish: Draft, read it, then Post it\.\n/);
    assert.match(words, /\nWhat its sources and collections mean:\n {2}- posts: The blog's posts, the newest first; id p<number>\n/);
    assert.match(words, /- post “Post it…” on posts: .+; it sends: it leaves this machine, so your press of it always asks the person, whatever this chat's mode/);
    assert.match(words, /- mark “Mark read” on posts: .+; it keeps: it changes the app's own data alone/);
    assert.match(words, /- draft “Draft…” on posts: .+; it writes: it changes files or programs on this machine/);
  });

  test("the Keep sheet groups the buttons by what they do, a sends button's switch in What it may do; a keeps press runs with no sheet (pinned in the source)", async () => {
    const w = await world();
    const d = /** @type {any} */ (w.runner.shown("p1").find((x) => x.name === NAME));
    assert.deepEqual(keepLines(d, "/work/blog").presses.map((b) => [b.name, b.effect, b.allowed]), [["post", "sends", false], ["mark", "keeps", false], ["draft", "writes", false]]);
    assert.deepEqual(PRESS_GROUPS.map((g) => [g.effect, g.head]), [["keeps", "Does at once when you press"], ["writes", "Does when you press"], ["sends", "Sends when you press — it leaves this machine"]]);
    const src = readFileSync(new URL("../src/ui/harness/space/dashboards.js", import.meta.url), "utf8");
    assert.match(src, /if \(r\.got\?\.effect === "keeps"\) \{\n {6}const ran = await ctx\.request\("POST", `\$\{at\}\/run`, \{ key, ask: \{\} \}\);/);
    assert.match(src, /\.\.\.\(g\.effect === "sends" && readOnly \? \[allowSwitch\(d, b\)\] : \[\]\)/);
    assert.match(src, /await ctx\.write\("POST", `\$\{path\(d\)\}\/allow`, \{ action: b\.name, on: box\.checked \}\)/);
    const route = readFileSync(new URL("../src/http/admin/spaces.js", import.meta.url), "utf8");
    assert.match(route, /"\/space\/:project\/dashboards\/:name\/allow",\n {6}guard\(async \(r\) => \{/);
  });
});

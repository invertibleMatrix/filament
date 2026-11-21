// @ts-check
// ＋ New app (the Space Apps plan of 10-29, "Building and changing"; the owner's "finish the space work fully"): one box
// — What should it do? — and four starters, each a real folder an agent adapts — Pipeline, Team pulse, Reader — or
// Numbers, the tile dashboard. A starter picked is copied into the project's .filament/apps/<id>/, never over one there,
// and the Start opens with the words that make the app from it; nothing is sent. Each starter runs as it is: it
// publishes from its folder, its page loads from the shelf, and its sources read rows.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STARTERS_DIR, appStarters, copyStarter, newAppWords, startersFor } from "../src/services/app-starters.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { ARTIFACT_GUIDE, artifactCall } from "../src/app/agent/artifacts.js";
import { CONTENT_JSON } from "../src/core/artifacts.js";
import { rowsFrom, sourceKept } from "../src/core/dashboard-sources.js";
import { runCommand } from "../src/adapters/tools/source-command.js";
import { SHELF_AT, shelf } from "../src/services/shelf.js";
import { spaceRoutes } from "../src/http/admin/spaces.js";
import { createRouter } from "../src/http/router.js";
import { stubDocument } from "./helpers/dom-stub.js";

const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), "filament-starters-"));
  dirs.push(d);
  return d;
};
const APPS = ["pipeline", "team-pulse", "reader"];
const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

/** A copied starter's source, as Filament keeps it. @param {string} root @param {string} folder @param {string} name */
const sourceOf = (root, folder, name) => sourceKept(JSON.parse(readFileSync(join(root, folder, "app.json"), "utf8")).sources[name]);
/** A copied starter's source, run in the project and read into rows as Filament reads it. @param {string} root @param {string} folder @param {string} name */
async function rowsOf(root, folder, name) {
  const s = sourceOf(root, folder, name);
  const out = await runCommand(s.command, root);
  assert.ok(out.ok, out.ok ? "" : out.error);
  const rows = rowsFrom(out.ok ? out.out : "", s);
  assert.ok(rows.ok, rows.ok ? "" : rows.error);
  return rows.ok ? rows.rows : [];
}

describe("＋ New app's starters", () => {
  // (fails before: yes — a Space made a dashboard alone, from an empty Start: no starter, no app folder)
  test("a project's four, in their order: three apps with folders, and Numbers, the tile dashboard", () => {
    const got = startersFor(false);
    assert.deepEqual(got.map((s) => [s.id, s.title, s.kind, s.folder]), [
      ["pipeline", "Pipeline", "app", true],
      ["team-pulse", "Team pulse", "app", true],
      ["reader", "Reader", "app", true],
      ["numbers", "Numbers", "dashboard", false],
    ]);
    for (const s of appStarters()) assert.ok(s.says && s.words, `${s.id} says itself`);
  });

  // (fails before: yes — the Designer's redesign of 10-29: a Space of your own offered a project's scripts, its commits
  // and its commands' numbers, "this project" in each)
  test("a Space of your own's: a to-do list, habits, the Reader and a small game, none of them a project's", () => {
    const got = startersFor(true);
    assert.deepEqual(got.map((s) => [s.id, s.title, s.kind, s.folder]), [
      ["todo", "To-do list", "app", false],
      ["habits", "Habits", "app", false],
      ["reader", "Reader", "app", true],
      ["game", "A small game", "app", false],
    ]);
    for (const s of got) assert.doesNotMatch(`${s.says} ${s.words}`, /project|commit|branch|script/i, s.id);
    assert.deepEqual(appStarters().map((s) => s.for).sort(), ["any", "own", "own", "own", "project", "project", "project"]);
  });

  // (fails before: yes — the same)
  test("a starter copied: into .filament/apps/<id>/, its folder written into its commands, starter.json left; a second beside the first, never over it", () => {
    const root = fresh();
    const one = copyStarter("pipeline", root);
    assert.deepEqual(one.ok && [one.folder, one.files.sort()], [".filament/apps/pipeline", ["app.js", "app.json", "index.html", "reads/scripts.mjs", "style.css"]]);
    const app = JSON.parse(readFileSync(join(root, ".filament", "apps", "pipeline", "app.json"), "utf8"));
    assert.deepEqual(app.sources.scripts.command, ["node", ".filament/apps/pipeline/reads/scripts.mjs"]);
    assert.ok(!existsSync(join(root, ".filament", "apps", "pipeline", "starter.json")));
    writeFileSync(join(root, ".filament", "apps", "pipeline", "app.js"), "// mine");
    const two = copyStarter("pipeline", root);
    assert.equal(two.ok && two.folder, ".filament/apps/pipeline-2");
    assert.deepEqual(JSON.parse(readFileSync(join(root, ".filament", "apps", "pipeline-2", "app.json"), "utf8")).sources.scripts.command, ["node", ".filament/apps/pipeline-2/reads/scripts.mjs"]);
    assert.equal(readFileSync(join(root, ".filament", "apps", "pipeline", "app.js"), "utf8"), "// mine", "the first left as it was");
    assert.deepEqual(copyStarter("numbers", root), { ok: false, error: "Numbers has no folder to copy: a dashboard is made in a chat" });
    assert.deepEqual(copyStarter("nope", root), { ok: false, error: "Filament has no starter nope: it has pipeline, todo, habits, team-pulse, reader, numbers, game" });
    assert.equal(copyStarter("reader", join(root, "missing")).ok, false);
  });

  // (fails before: yes — the same)
  test("each app starter publishes from its folder as it is, and its page names only the shelf's files", () => {
    const root = fresh();
    const store = createArtifactStore({ dataDir: fresh(), log: () => {}, four: () => "ab12" });
    const at = { who: "c1", by: { chain: "c1", model: "m", folder: root, helper: null }, within: [root], port: 20300, maxBytes: 5_000_000 };
    for (const id of APPS) {
      const made = copyStarter(id, root);
      assert.ok(made.ok);
      const folder = made.ok ? made.folder : "";
      const r = artifactCall({ action: "publish", folder }, at, store);
      assert.equal(r.ok, true, `${id}: ${r.ok ? "" : r.error}`);
      const a = /** @type {any} */ (store.list().find((x) => x.title === appStarters().find((s) => s.id === id)?.title));
      assert.equal(a.type, "app", id);
      const content = JSON.parse(String(store.file(a.name, 1, CONTENT_JSON)));
      assert.ok(Object.keys(content.sources).length, `${id} reads by itself once kept`);
      const page = String(store.file(a.name, 1, "app.js"));
      const named = [...page.matchAll(/from "(\/_filament\/lib\/[^"]+)"/g)].map((m) => m[1]);
      assert.ok(named.length, `${id}'s page loads from the shelf`);
      for (const p of named) assert.ok(shelf().files.includes(p.slice(SHELF_AT.length)), `${id}: ${p} is on the shelf`);
      assert.ok(!/https?:\/\//.test(page.replace(/\/\/[^\n]*$/gm, "")), `${id}'s page loads nothing from the web`);
    }
  });

  // (fails before: yes — the same)
  test("Pipeline's source reads package.json's scripts; its button runs one by name, checked", async () => {
    const root = fresh();
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test", "dist:win": "node scripts/dist.mjs" } }));
    const made = copyStarter("pipeline", root);
    const folder = made.ok ? made.folder : "";
    assert.deepEqual((await rowsOf(root, folder, "scripts")).map((r) => [r.__key, r.command]), [["test", "node --test"], ["dist:win", "node scripts/dist.mjs"]]);
    const run = JSON.parse(readFileSync(join(root, folder, "app.json"), "utf8")).actions.run;
    const check = new RegExp(run.check["row.name"]);
    assert.ok(check.test("dist:win") && check.test("test") && !check.test("-rf") && !check.test("a b"));
  });

  // (fails before: yes — the same)
  test("Team pulse's source reads the week's commits on the branch, a row each", async () => {
    const root = fresh();
    const git = (/** @type {string[]} */ args) => execFileSync("git", args, { cwd: root, env, encoding: "utf8", windowsHide: true });
    git(["init", "-q", "-b", "main"]);
    writeFileSync(join(root, "a.txt"), "1");
    git(["add", "."]);
    git(["commit", "-q", "-m", "Add the login page (#12)"]);
    writeFileSync(join(root, "a.txt"), "2");
    git(["commit", "-q", "-am", "Fix the build"]);
    const made = copyStarter("team-pulse", root);
    const rows = await rowsOf(root, made.ok ? made.folder : "", "week");
    assert.deepEqual(rows.map((r) => [r.who, r.subject]), [["t", "Fix the build"], ["t", "Add the login page (#12)"]]);
    assert.match(String(rows[0].sha), /^[0-9a-f]{7,}$/);
    assert.match(String(rows[0].date), /^\d{4}-\d{2}-\d{2}$/);
  });

  // (fails before: yes — the same)
  test("Reader's source reads RSS and Atom feeds into one list, newest first; a feed that fails is named, the rest still read", async () => {
    const RSS = `<?xml version="1.0"?><rss><channel><title>Blog &amp; news</title><item><title><![CDATA[Older <b>post</b>]]></title><link>https://example.com/a</link><guid>a</guid><pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate><description>First &lt;p&gt;line&lt;/p&gt;</description></item></channel></rss>`;
    const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom feed</title><entry><title>Newer post</title><link rel="alternate" href="https://example.com/b"/><id>urn:b</id><updated>2026-10-28T09:00:00Z</updated><summary>Second</summary></entry></feed>`;
    const ODD = `<?xml version="1.0"?><rss><channel><title>Odd</title><item><title>Bad &#abc; &#x110000; one</title><link>javascript:alert(1)</link><guid>x</guid><pubDate>Tue, 27 Oct 2026 10:00:00 GMT</pubDate></item><item><title>Here</title><link>/c</link><guid>c</guid><pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
    const server = createServer((req, res) => {
      if (req.url === "/rss") return void res.writeHead(200, { "content-type": "application/rss+xml" }).end(RSS);
      if (req.url === "/atom") return void res.writeHead(200, { "content-type": "application/atom+xml" }).end(ATOM);
      if (req.url === "/odd") return void res.writeHead(200, { "content-type": "application/rss+xml" }).end(ODD);
      res.writeHead(404).end();
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
    try {
      const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
      const root = fresh();
      const made = copyStarter("reader", root);
      const folder = made.ok ? made.folder : "";
      writeFileSync(join(root, folder, "feeds.json"), JSON.stringify([`${base}/rss`, `${base}/atom`, `${base}/gone`]));
      const rows = await rowsOf(root, folder, "posts");
      assert.deepEqual(rows.map((r) => [r.title, r.feed, r.link, r.date]), [
        ["Newer post", "Atom feed", "https://example.com/b", "2026-10-28T09:00:00.000Z"],
        ["Older post", "Blog & news", "https://example.com/a", "2026-10-26T10:00:00.000Z"],
      ]);
      assert.equal(rows[1].text, "First line");
      assert.match(String(rows[0].__key), /^[0-9a-f]{16}$/, "an id a page keeps as a record's");
      const out = await runCommand(sourceOf(root, folder, "posts").command, root);
      assert.deepEqual(out.ok && JSON.parse(out.out).failed, [{ feed: `${base}/gone`, error: "answered 404" }]);
      // (fails before: yes — found reviewing the Space work: a feed's javascript: link went to the page's href, and one
      // entity naming no character, &#abc;, threw and failed the whole feed)
      writeFileSync(join(root, folder, "feeds.json"), JSON.stringify([`${base}/odd`]));
      const odd = await rowsOf(root, folder, "posts");
      assert.deepEqual(odd.map((r) => [r.title, r.link]), [
        ["Bad &#abc; &#x110000; one", ""],
        ["Here", `${base}/c`],
      ]);
      assert.match(readFileSync(join(root, folder, "app.js"), "utf8"), /href=\$\{\/\^https\?:\\\/\\\/\/i\.test\(String\(p\.link\)\) \? p\.link : undefined\}/, "its page opens a web address alone");
    } finally {
      server.close();
    }
  });

  // (fails before: yes — the Designer's redesign of 10-29: the Start's box held Filament's instructions to the agent —
  // "Read the app guide first (the artifact tool's guide, type "app")…" — under the person's own request)
  test("the Start's words are the person's request — from a starter's folder, a dashboard for Numbers, or their words alone —; how to make it is the agent's guides'", async () => {
    const [pipeline, , , numbers] = startersFor(false);
    assert.equal(newAppWords({ project: "filament", said: "Tests and the installer", starter: pipeline, folder: ".filament/apps/pipeline" }),
      "Make an app for filament's Space from Filament's Pipeline starter, copied into .filament/apps/pipeline/: Tests and the installer");
    assert.equal(newAppWords({ project: "filament", said: "", starter: numbers }), `Make a dashboard for filament's Space: ${numbers.words}`);
    assert.equal(newAppWords({ project: "Northwind", said: "A queue of my reviews" }), "Make an app for Northwind's Space: A queue of my reviews");
    // (fails before: yes — the Designer's walk of 10-29: "recipes's Space")
    assert.equal(newAppWords({ project: "recipes", said: "A page per recipe" }), "Make an app for recipes' Space: A page per recipe");
    // (fails before: yes — the Designer's second walk of 10-29: "Make an app for Hobbies' Space", in a Space that is Hobbies)
    assert.equal(newAppWords({ project: "Hobbies", said: "A small game", own: true }), "Make an app for Hobbies: A small game");
    // The app guide says where an app lives and how a starter is made one; the space tool's guide points there.
    const guide = ARTIFACT_GUIDE.app;
    assert.match(guide, /keep a new app in a folder of its own, `\.filament\/apps\/<its name>\/`/);
    assert.match(guide, /copied there already and runs as it is: adapt it — its sources' commands, its buttons, its page —, run each command once yourself, look at its page in your Browser pane, then publish it by its folder/);
    assert.doesNotMatch(guide, /tab/, "a Space's apps are pages, no tabs");
    const { spaceGuide } = await import("../src/app/agent/space.js");
    assert.match(/** @type {any} */ (spaceGuide("app")).text, /To make one: the artifact tool, type "app" — read its guide first\./);
    const { PROMPT_VERSION } = await import("../src/app/agent/prompt.js");
    assert.ok(PROMPT_VERSION >= 70, "the agents' words changed");
  });

  // (fails before: yes — the same)
  test("its routes: the starters, and the words — a starter's folder copied first; nothing to make refused", async () => {
    const root = fresh();
    const rows = spaceRoutes({
      config: { get: () => ({ agentLoop: { roots: [root] }, server: {} }) },
      memory: { archive: { getProject: (/** @type {string} */ id) => (id === "p1" ? { id, name: "proj", cwd: root } : id === "p2" ? { id, name: "Northwind", cwd: root } : null) } },
      // Each has a Space: New app… asks the store, and makes one where a project has none (by need, 11-12:
      // test/space-by-need.test.js).
      spaces: /** @type {any} */ ({ get: (/** @type {string} */ id) => (id === "p2" ? { own: { name: "Northwind", folder: root } } : {}), has: () => true }),
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
    assert.deepEqual((await call("GET", "/space/p1/starters")).body.starters.map((/** @type {any} */ s) => s.id), ["pipeline", "team-pulse", "reader", "numbers"]);
    const made = await call("POST", "/space/p1/new-app", { said: "", starter: "reader" });
    assert.equal(made.status, 200);
    assert.equal(made.body.folder, ".filament/apps/reader");
    assert.ok(existsSync(join(root, ".filament", "apps", "reader", "reads", "feeds.mjs")));
    assert.match(made.body.words, /^Make an app for proj's Space from Filament's Reader starter, copied into \.filament\/apps\/reader\/: A reader for the feeds I follow/);
    const dash = await call("POST", "/space/p1/new-app", { said: "Deploys at a glance", starter: "numbers" });
    assert.deepEqual([dash.status, dash.body], [200, { words: "Make a dashboard for proj's Space: Deploys at a glance" }]);
    assert.deepEqual([(await call("POST", "/space/p1/new-app", { said: " " })).status, (await call("POST", "/space/p1/new-app", { said: "x", starter: "nope" })).status], [400, 404]);
    assert.equal((await call("GET", "/space/p9/starters")).status, 404);
    // A Space of your own: its own starters; one with no folder makes its words alone, nothing copied.
    assert.deepEqual((await call("GET", "/space/p2/starters")).body.starters.map((/** @type {any} */ s) => s.id), ["todo", "habits", "reader", "game"]);
    const todo = await call("POST", "/space/p2/new-app", { said: "", starter: "todo" });
    assert.equal(todo.status, 200);
    assert.equal(todo.body.folder, undefined);
    assert.match(todo.body.words, /^Make an app for Northwind: A to-do list: /);
    assert.ok(!existsSync(join(root, ".filament", "apps", "todo")));
  });

  // (fails before: yes — the same)
  test("the sheet: a starter picked fills the empty box; its press makes the words and opens the Start with them, nothing sent", async () => {
    const doc = stubDocument();
    // The sheet asks what had the focus; nothing in the stub page is an element of the browser's.
    const g = /** @type {any} */ (globalThis);
    const hadElement = g.HTMLElement;
    g.HTMLElement = class {};
    try {
      const { newAppSheet } = await import("../src/ui/harness/space/new-app.js");
      /** @type {any[]} */
      const made = [];
      /** @type {string[]} */
      const started = [];
      newAppSheet({
        place: "proj",
        starters: async () => startersFor(false),
        make: async (said, starter) => (made.push([said, starter]), { words: `W:${starter}:${said}` }),
        startWith: (words) => void started.push(words),
      });
      const el = doc.document.body.querySelector(".snew-sheet");
      assert.ok(el, "the sheet");
      await new Promise((r) => setTimeout(r, 0));
      const buttons = el.querySelectorAll(".snew-starter");
      assert.deepEqual(buttons.map((/** @type {any} */ b) => b.querySelector(".snew-starter-t").textContent), ["Pipeline", "Team pulse", "Reader", "Numbers"]);
      const box = el.querySelector(".snew-box");
      const go = /** @type {any} */ (el.querySelector(".snew-go"));
      assert.equal(go.disabled, true, "nothing to make yet");
      buttons[2].dispatch("click");
      assert.equal(box.value, startersFor(false)[2].words);
      assert.equal(buttons[2].getAttribute("aria-pressed"), "true");
      assert.match(el.querySelector(".snew-note").textContent, /^Copies the Reader starter into proj's \.filament\/apps\/ for an agent to adapt/);
      buttons[0].dispatch("click");
      assert.equal(box.value, startersFor(false)[0].words, "another starter's words replace the first's");
      box.value = "Only my scripts";
      buttons[0].dispatch("click");
      assert.equal(box.value, "Only my scripts", "the person's own words stay");
      buttons[0].dispatch("click");
      go.dispatch("click");
      await new Promise((r) => setTimeout(r, 0));
      assert.deepEqual(made, [["Only my scripts", "pipeline"]]);
      assert.deepEqual(started, ["W:pipeline:Only my scripts"]);
      assert.equal(doc.document.body.querySelector(".snew-sheet"), null, "closed");
      // (fails before: yes — a starter with no folder was said to make a dashboard) An app made from words alone says so.
      newAppSheet({ place: "Northwind", starters: async () => startersFor(true), make: async () => null, startWith: () => {} });
      const own = doc.document.body.querySelector(".snew-sheet");
      await new Promise((r) => setTimeout(r, 0));
      own.querySelectorAll(".snew-starter")[0].dispatch("click");
      assert.equal(own.querySelector(".snew-note").textContent, "Opens the Start with its words, for an agent to make the app. Nothing runs until you send.");
    } finally {
      g.HTMLElement = hadElement;
      doc.restore();
    }
  });

  test("the starters ship: the installer's files and the package's name their folder", () => {
    assert.ok(existsSync(STARTERS_DIR));
    assert.match(readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8"), /\n {2}- starters\/\*\*\n/);
    assert.ok(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).files.includes("starters/"));
  });
});


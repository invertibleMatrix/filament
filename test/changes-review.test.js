// @ts-check
// What a review of the Changes tab found (the Space work of 10-29): a pane drawn again left its copy's dry run asked
// every 15 s for good; a new chat's pane kept the chain and folder it was drawn with; an open file's diff stayed as it
// was read while its counts stood; and the commit-time read of many long paths failed quietly, naming agents on files
// the person had committed since.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** The addresses the page asked for, in order. @type {string[]} */
const asked = [];
/** What the stand-in server answers by the whole address: a body, or undefined for a 404. @type {(url: string) => any} */
let serve = () => undefined;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
  if (String(init.method || "GET") === "GET") asked.push(String(url));
  const body = serve(String(url));
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { refreshChanges, renderChanges } = await import("../src/ui/harness/panes/changes.js");
const { PREVIEW_MS } = await import("../src/ui/harness/lib/apply-words.js");
const { h } = await import("../src/ui/lib/dom.js");
const { ignoredOf, lastCommits } = await import("../src/adapters/git/inspect.js");

after(() => {
  g.fetch = realFetch;
});

/** A place's answer: the folder with one file the chat's agent wrote, and a sub-agent's copy whose file waits. @param {number} [at] */
const answerOf = (at = 1) => ({
  cwd: "/r", ok: true, error: null, at,
  places: [
    { kind: "folder", cwd: "/r", ok: true, place: "/r", worktree: false, branch: "main", detached: false, base: "main", ahead: 0, behind: 0,
      files: [{ path: "src/a.js", oldPath: null, status: "M", added: 1, removed: 1, binary: false, untracked: false, by: [{ chain: "c1", agent: "", at: 50 }] }] },
    { kind: "copy", cwd: "/wt/sa_1", ok: true, place: "/wt/sa_1", worktree: true, branch: null, detached: true, base: "main", ahead: 0, behind: 0, sub: "sa_1",
      files: [{ path: "x.js", oldPath: null, status: "M", added: 3, removed: 0, binary: false, untracked: false, by: [{ chain: "c1", agent: "sa_1", at: 60 }] }] },
  ],
  chats: { c1: { title: "Changes drive", model: "claude-opus-5-5" } },
  homes: {},
  atWork: [],
});
/** A sub-agent of the chat whose copy holds a file that waits for its Apply. @returns {any} */
const scout = () => ({
  id: "sa_1", card: { name: "Scout" }, description: "find the retry", model: "glm-5.3", may: "edit", status: "done", startedAt: 10, endedAt: 60,
  work: { pending: 1, added: 3, removed: 0, applied: 0, folder: "/wt/sa_1", sig: "s1", files: [{ path: "x.js", status: "M", added: 3, removed: 0 }] },
});

describe("the Changes tab in a page", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
    HTMLElement: class {},
  };
  before(() => {
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
    g.window.setTimeout = () => 0;
  });
  after(() => {
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
  });
  beforeEach(() => {
    asked.length = 0;
  });

  /**
   * The tab drawn into a new body, as the host draws it; its copy's dry runs counted.
   * @param {any} chat @param {{ previews?: string[], subagents?: () => any[] }} [o]
   */
  const mount = (chat, o = {}) => {
    const body = h("div", { class: "pane-body" });
    doc.document.body.append(body);
    /** @type {number[]} */
    const badges = [];
    const previews = o.previews || [];
    const band = {
      openSubagent: () => {}, openChat: () => {}, stopSubagent: () => {},
      diffOf: async () => ({ diff: "" }),
      preview: async (/** @type {string} */ id) => (previews.push(id), { came: [{ path: "x.js", how: "took" }], conflicts: [], folder: "/wt/sa_1", repo: "/r" }),
      apply: async () => /** @type {const} */ ({ ok: true }),
      modelName: (/** @type {string} */ id) => id,
    };
    const ctx = {
      chat,
      setBadge: (/** @type {number} */ n) => void badges.push(n),
      subagents: o.subagents || (() => [scout()]),
      openSubagent: () => {},
      model: () => "claude-opus-5-5",
      band: () => band,
    };
    renderChanges(body, /** @type {any} */ (ctx));
    return { body, ctx, badges };
  };
  /** The copy's dry run said, in this body. @param {any} body */
  const checked = (body) =>
    until(() => {
      const e = body.querySelector(".agb-effect");
      return e && e.textContent !== "Checking what Apply would do…";
    }, "the copy's dry run");

  // (fails before: yes — found reviewing the Space work: a pane drawn again left the one before it reading its copy's
  // dry run every 15 s for good, one more loop with each draw, and setting the tab's badge)
  test("a pane drawn again lets the one before it go: its copy's dry run is read again only by the pane on screen", async () => {
    serve = (u) => (u.startsWith("/api/git/changes?") ? answerOf() : undefined);
    const realSet = g.setTimeout;
    const realClear = g.clearTimeout;
    const realNow = Date.now;
    /** The band's timers set for once a dry run is old, held here. @type {Set<{ fn: () => void }>} */
    const later = new Set();
    let t = realNow();
    g.setTimeout = (/** @type {() => void} */ fn, /** @type {number} */ ms, /** @type {any[]} */ ...a) => {
      if (ms !== PREVIEW_MS + 50) return realSet(fn, ms, ...a);
      const handle = { fn, unref() {} };
      later.add(handle);
      return handle;
    };
    g.clearTimeout = (/** @type {any} */ id) => (later.has(id) ? void later.delete(id) : realClear(id));
    Date.now = () => t;
    /** The clock moved on, and each timer due fired. @param {number} ms */
    const advance = async (ms) => {
      t += ms;
      for (const handle of [...later]) {
        later.delete(handle);
        handle.fn();
      }
      await new Promise((r) => realSet(r, 20));
    };
    try {
      /** @type {string[]} */
      const previews = [];
      const chat = { chainId: "c1", cwd: "/r", turns: [], live: null };
      const panes = [];
      for (let i = 0; i < 3; i++) {
        const pane = mount(chat, { previews });
        await until(() => pane.body.querySelector(".chp-place"), "the places to be drawn");
        await checked(pane.body);
        panes.push(pane);
      }
      const before = previews.length;
      const badgesBefore = panes.map((p) => p.badges.length);
      await advance(15_100);
      await advance(15_100);
      await advance(1_000);
      assert.ok(previews.length - before <= 2, `the pane on screen alone reads again: ${previews.length - before} dry runs in 31 s`);
      assert.deepEqual(panes.slice(0, 2).map((p, i) => p.badges.length - badgesBefore[i]), [0, 0], "the panes let go set no badge");
      // Another tab drawn in its place: the pane off the screen reads nothing on its own either.
      panes[2].body.replaceChildren();
      const shown = previews.length;
      await advance(15_100);
      await advance(15_100);
      assert.equal(previews.length, shown, "off the screen, no dry run");
    } finally {
      g.setTimeout = realSet;
      g.clearTimeout = realClear;
      Date.now = realNow;
    }
  });

  // (fails before: yes — found reviewing the Space work: a new chat's pane kept the chain and folder it was drawn with,
  // so after its first send no read named its chain, a worktree chat read the folder it left, and its own agent was
  // named as another chat)
  test("a new chat's pane reads with the chain and folder its first send gave it", async () => {
    serve = (u) => (u.startsWith("/api/git/changes?") ? answerOf() : undefined);
    const chat = /** @type {any} */ ({ cwd: "/r", turns: [], live: null });
    const { body, ctx } = mount(chat, { subagents: () => [] });
    await until(() => body.querySelector(".chp-place"), "the places to be drawn");
    assert.equal(asked.at(-1), "/api/git/changes?cwd=%2Fr");
    // Its first send: the session made, its worktree its folder, its turn running and then ended.
    chat.live = { turn: {} };
    refreshChanges(body, /** @type {any} */ (ctx));
    chat.chainId = "c1";
    chat.cwd = "/w";
    chat.live = null;
    refreshChanges(body, /** @type {any} */ (ctx));
    await until(() => asked.length === 2, "the read at the turn's end");
    assert.equal(asked.at(-1), "/api/git/changes?cwd=%2Fw&chain=c1&fresh=1");
    await until(() => body.querySelectorAll(".agb-name").length, "its writers drawn");
    assert.ok(body.querySelectorAll(".agb-name").map((/** @type {any} */ e) => e.textContent).includes("Your agent"), "its own agent is its own");
  });

  // (fails before: yes — found reviewing the Space work: a file edited again with the same counts, +1 −1 then +1 −1,
  // kept the diff first read, whatever was read since)
  test("an open file's diff is read again with each new read of its place, though its counts stand", async () => {
    const DIFF_URL = "/api/git/branch?cwd=%2Fr&place=%2Fr&part=uncommitted&path=src%2Fa.js";
    let at = 1;
    let patch = "diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-one\n+ONE\n";
    serve = (u) => (u.startsWith("/api/git/changes?") ? answerOf(at++) : u === DIFF_URL ? { patch } : undefined);
    const { body } = mount({ chainId: "c1", cwd: "/r", turns: [], live: null }, { subagents: () => [] });
    await until(() => body.querySelector(".chp-place"), "the places to be drawn");
    const row = () => body.querySelectorAll(".chg-file").find((/** @type {any} */ r) => r.getAttribute("data-path") === "src/a.js");
    row().dispatch("click");
    await until(() => asked.filter((u) => u === DIFF_URL).length === 1 && body.querySelector(".chg-dh-path"), "its diff");
    // Edited again in the person's editor: the same counts, another line.
    patch = "diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-one\n+uno\n";
    const reads = asked.filter((u) => u.startsWith("/api/git/changes?")).length;
    body.querySelector(".chp-again").dispatch("click");
    await until(() => asked.filter((u) => u.startsWith("/api/git/changes?")).length === reads + 1, "Read again");
    await until(() => asked.filter((u) => u === DIFF_URL).length === 2, "its diff read again", { timeoutMs: 2000 });
  });
});

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();

describe("the commit-time read", { skip: !hasGit && "git is not on PATH" }, () => {
  /** @type {string | null} */
  let dir = null;
  after(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  // (fails before: yes — found reviewing the Space work: 200 long paths on one git command line passed Windows' limit;
  // the read failed quietly, every file seemed never committed, and agents were named on files committed since)
  test("200 paths of about 170 characters each all get their commit times", async () => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), "filament-cr-")));
    run(dir, ["init", "-q", "-b", "main"]);
    const deep = `${"d".repeat(80)}/${"e".repeat(76)}`;
    mkdirSync(join(dir, deep), { recursive: true });
    const paths = Array.from({ length: 200 }, (_, i) => `${deep}/file-${String(i).padStart(3, "0")}.txt`);
    for (const p of paths) writeFileSync(join(dir, p), `${p}\n`);
    run(dir, ["add", "."]);
    run(dir, ["commit", "-q", "-m", "all"]);
    assert.ok(paths.every((p) => p.length >= 165), "each path is long");
    const { times, error } = await lastCommits(dir, 0, paths);
    assert.equal(paths.filter((p) => times.has(p)).length, 200, "each path's commit time");
    assert.equal(error, null);
    // A read that fails says so, not "never committed".
    const none = await lastCommits(join(dir, "nowhere"), 0, paths.slice(0, 2));
    assert.deepEqual([none.times.size, typeof none.error], [0, "string"]);
  });

  // (fails before: yes — found reviewing the Space work: which files git ignores was asked of 200 paths on one command
  // line, past Windows' limit too)
  test("which of 200 long paths git ignores is read whole", async () => {
    const at = realpathSync.native(mkdtempSync(join(tmpdir(), "filament-cr-ig-")));
    try {
      run(at, ["init", "-q", "-b", "main"]);
      writeFileSync(join(at, ".gitignore"), "*.log\n");
      const deep = `${"d".repeat(80)}/${"e".repeat(76)}`;
      const paths = Array.from({ length: 200 }, (_, i) => `${deep}/file-${String(i).padStart(3, "0")}.${i % 2 ? "log" : "txt"}`);
      const { ignored, error } = await ignoredOf(at, paths);
      assert.deepEqual([error, ignored.size, [...ignored].every((p) => p.endsWith(".log"))], [null, 100, true]);
    } finally {
      rmSync(at, { recursive: true, force: true });
    }
  });
});

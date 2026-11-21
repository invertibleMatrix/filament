// @ts-check
// The Files pane (panes/files.js) on the stub document, in the tile host as the page's pane list has it (pane-host.js,
// app.js): what the developer opened kept across the run's pulse and a turn's end, a read that failed said in its
// place, the filter's answers drawn in the order typed, and the trees kept for the folders shown last.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { gate, until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** What the page asked for, in order, as `GET /api/…`. @type {string[]} */
const asked = [];
/** A refusal the stand-in server answers, in the server's words. */
class Refusal {
  /** @param {number} status @param {string} error */
  constructor(status, error) {
    this.status = status;
    this.error = error;
  }
}
/** What the stand-in server answers by the whole address: a body, a promise of one, a `Refusal`, or undefined for a 404. @type {(url: string) => any} */
let serve = () => undefined;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
  asked.push(`${String(init.method || "GET")} ${url}`);
  const body = await serve(String(url));
  if (body instanceof Refusal) return new Response(JSON.stringify({ error: body.error }), { status: body.status });
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const files = await import("../src/ui/harness/panes/files.js");
const { createPaneHost } = await import("../src/ui/harness/panes/pane-host.js");

/** The page's clock, run ahead by hand: a tree read "seconds ago" without waiting them. */
const clock = { ahead: 0 };
const realNow = Date.now;
before(() => {
  Date.now = () => realNow() + clock.ahead;
});
after(() => {
  Date.now = realNow;
  g.fetch = realFetch;
});

/** A few turns of the event loop: what a press or a pulse set off has landed. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

/**
 * A project folder as the stand-in server has it: its top, `src` with its files, and git's status.
 * @param {string} cwd @param {{ src?: string[], changed?: string[] }} [o]
 */
const folder = (cwd, o = {}) => {
  const at = `cwd=${encodeURIComponent(cwd)}`;
  return /** @type {Record<string, any>} */ ({
    [`/api/git/status?${at}`]: { ok: true, files: (o.changed || ["src/a.js"]).map((path) => ({ path, status: "modified" })) },
    [`/api/files/tree?${at}&path=&depth=1`]: { entries: [{ name: "src", path: "src", kind: "dir" }, { name: "README.md", path: "README.md", kind: "file" }] },
    [`/api/files/tree?${at}&path=src&depth=1`]: { entries: (o.src || ["a.js"]).map((name) => ({ name, path: `src/${name}`, kind: "file" })) },
  });
};

/** The Files pane in a tile host, with its draw and — where the module has one — its refresh, as the page lists it. */
function hosted() {
  const { document, restore } = stubDocument();
  const saved = { local: g.localStorage, session: g.sessionStorage };
  /** @param {Map<string, string>} kept */
  const storage = (kept) => ({ getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)), removeItem: (/** @type {string} */ k) => void kept.delete(k) });
  g.localStorage = storage(new Map());
  g.sessionStorage = storage(new Map());
  const frame = /** @type {any} */ (document.createElement("aside"));
  document.body.append(frame);
  const host = createPaneHost(frame, {
    panes: [{ id: "files", label: "Files", icon: "folder", render: files.renderFiles, refresh: files.refreshFiles }],
    room: () => ({ row: 1600, win: 1920, height: 900 }),
    paint: () => {},
  });
  return {
    frame,
    host,
    done: () => {
      g.localStorage = saved.local;
      g.sessionStorage = saved.session;
      restore();
    },
  };
}

/**
 * The run's pulse as the host answers it: coalesced, then each tile refreshed in place, or drawn again where its pane
 * has no refresh. @param {any} t @param {any} host
 */
const pulse = (t, host) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    host.pulse();
    t.mock.timers.tick(1200);
  } finally {
    t.mock.timers.reset();
  }
};

/** @param {any} root @param {string} name */
const rowNamed = (root, name) => root.querySelectorAll(".file-tree-row").find((/** @type {any} */ r) => r.getAttribute("aria-label") === name) || null;
/** A folder's row's box of entries. @param {any} root @param {string} name */
const kidsOf = (root, name) => rowNamed(root, name)?.parentNode?.children[1] || null;
/** @param {any} root */
const names = (root) => root.querySelectorAll(".file-tree-name").map((/** @type {any} */ e) => e.textContent);
/** @param {any} root @param {string} words */
const buttonSaying = (root, words) => root.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === words);

// (fails before: yes — the bug hunt of 10-30, UIP-2: the pane had no refresh, so each pulse of a running turn drew it
// anew — past its first 8 s, or with Show changed files only on at once: a new tree, every folder shut, the toggle off)
test("the run's pulse leaves the tree as it stands: the folders open, Show changed files only, nothing read again", async (t) => {
  const answers = folder("/p1");
  serve = (u) => answers[u];
  const p = hosted();
  try {
    // A turn runs in it: the pulses are its run's.
    p.host.setChat({ id: "p1", chainId: "c1", cwd: "/p1", live: { turn: {} } });
    p.host.openTab("files");
    await until(() => rowNamed(p.frame, "src"), "the tree");
    rowNamed(p.frame, "src").dispatch("click");
    await until(() => rowNamed(p.frame, "a.js"), "the folder's files");
    const reads = asked.length;
    clock.ahead += 9000;
    pulse(t, p.host);
    await flush();
    assert.ok(rowNamed(p.frame, "a.js"), "the folder open, its files shown");
    assert.equal(kidsOf(p.frame, "src")?.classList.contains("hidden"), false);
    assert.equal(asked.length, reads, "nothing read again");
    buttonSaying(p.frame, "Show changed files only").dispatch("click");
    assert.deepEqual(names(p.frame), ["src/a.js"]);
    pulse(t, p.host);
    await flush();
    assert.deepEqual(names(p.frame), ["src/a.js"], "the changed files still");
    assert.ok(buttonSaying(p.frame, "Show changed files only").classList.contains("on"));
  } finally {
    p.done();
  }
});

// (fails before: yes — the bug hunt of 10-30, UIP-2: a turn's end drew the pane anew once its tree was 8 s old, a new
// tree with every folder shut and Show changed files only off)
// (fails before: yes — the owner's of 11-01: a turn's end refreshes the panes in place now, app.js `rail.refresh()`, and
// the refresh read nothing: the turn's new file never showed)
test("a turn's end reads the tree again where it stands: the turn's new file shows in the folder left open, the toggle stays", async () => {
  let answers = folder("/p2");
  serve = (u) => answers[u];
  const p = hosted();
  try {
    p.host.setChat({ id: "p2", chainId: "c2", cwd: "/p2" });
    p.host.openTab("files");
    await until(() => rowNamed(p.frame, "src"), "the tree");
    rowNamed(p.frame, "src").dispatch("click");
    await until(() => rowNamed(p.frame, "a.js"), "the folder's files");
    const tree = p.frame.querySelector(".files");
    // The turn wrote src/b.js; at its end the page refreshes the panes, the chat idle (app.js `rail.refresh()`).
    answers = folder("/p2", { src: ["a.js", "b.js"] });
    clock.ahead += 9000;
    p.host.refresh();
    await until(() => rowNamed(p.frame, "b.js"), "the folder read again, open", { timeoutMs: 2000 });
    assert.equal(kidsOf(p.frame, "src")?.classList.contains("hidden"), false);
    assert.equal(p.frame.querySelector(".files"), tree, "the pane stands, its tree read again in it");
    buttonSaying(p.frame, "Show changed files only").dispatch("click");
    clock.ahead += 9000;
    p.host.refresh();
    await flush();
    assert.deepEqual(names(p.frame), ["src/a.js"]);
    assert.ok(buttonSaying(p.frame, "Show changed files only").classList.contains("on"), "Show changed files only, still on");
    // Its read fresh, a turn's end reads nothing: the tree as it stands.
    const reads = asked.length;
    p.host.refresh();
    await flush();
    assert.equal(asked.length, reads, "nothing read again");
  } finally {
    p.done();
  }
});

// (fails before: yes — the bug hunt of 10-30, UIP-8: a folder, a Refresh or a cleared filter whose read failed said
// "Loading…" for good)
test("a read that failed says why in its place — a folder's, the tree's on Refresh — and a folder opened again reads again", async () => {
  const answers = folder("/p3");
  let refuse = /** @type {string | null} */ ("EACCES: permission denied, scandir 'src'");
  serve = (u) => (refuse && u.includes("path=src") ? new Refusal(500, refuse) : answers[u]);
  const p = hosted();
  try {
    p.host.setChat({ id: "p3", chainId: "c3", cwd: "/p3" });
    p.host.openTab("files");
    await until(() => rowNamed(p.frame, "src"), "the tree");
    rowNamed(p.frame, "src").dispatch("click");
    await until(() => /EACCES/.test(kidsOf(p.frame, "src")?.textContent || ""), "the folder's failure", { timeoutMs: 2000 });
    assert.ok(kidsOf(p.frame, "src").querySelector(".pane-note"), "said as its other notes are");
    refuse = null;
    rowNamed(p.frame, "src").dispatch("click");
    rowNamed(p.frame, "src").dispatch("click");
    await until(() => rowNamed(p.frame, "a.js"), "the folder read again");
    // Refresh, the folder gone meanwhile.
    serve = (u) => (u.includes("files/tree") ? new Refusal(500, "the folder is gone") : answers[u]);
    p.frame.querySelector("button[title='Refresh file tree']").dispatch("click");
    await until(() => p.frame.querySelector(".file-tree .pane-empty")?.textContent === "the folder is gone", "the tree's failure", { timeoutMs: 2000 });
  } finally {
    p.done();
  }
});

// (fails before: yes — the bug hunt of 10-30, the Files pane's Lows: the search had no sequence check, so an older
// answer that landed last drew over the newer one — and over the tree once the filter was cleared)
test("the filter's answers are drawn in the order typed: an older one landing last draws nothing", async () => {
  const answers = folder("/p4");
  /** @type {Map<string, ReturnType<typeof gate>>} */
  const held = new Map();
  serve = (u) => {
    const q = /[?&]q=([^&]*)/.exec(u);
    if (!u.includes("files/search") || !q) return answers[u];
    const word = decodeURIComponent(q[1]);
    const open = gate();
    held.set(word, open);
    return open.promise.then(() => ({ files: [{ name: `${word}.js`, path: `src/${word}.js` }] }));
  };
  const p = hosted();
  try {
    p.host.setChat({ id: "p4", chainId: "c4", cwd: "/p4" });
    p.host.openTab("files");
    await until(() => rowNamed(p.frame, "src"), "the tree");
    const filter = p.frame.querySelector("input");
    /** @param {string} words */
    const type = (words) => {
      filter.value = words;
      filter.dispatch("input");
    };
    type("a");
    type("ab");
    await until(() => held.has("a") && held.has("ab"), "both searches asked");
    held.get("ab")?.open();
    await until(() => names(p.frame).includes("ab.js"), "the newer answer");
    held.get("a")?.open();
    await flush();
    assert.deepEqual(names(p.frame), ["ab.js"], "the older answer, landed last, drew nothing");
    type("x");
    await until(() => held.has("x"), "the search asked");
    type("");
    await until(() => rowNamed(p.frame, "src"), "the tree, the filter cleared");
    held.get("x")?.open();
    await flush();
    assert.ok(rowNamed(p.frame, "src") && !names(p.frame).includes("x.js"), "the tree stands");
  } finally {
    p.done();
  }
});

// (fails before: yes — the bug hunt of 10-30: a search the server refused said "The search failed." and nothing of why,
// so git refusing the folder's repository went unsaid)
test("a search the server refuses says why in its words, as a tree's read does", async () => {
  const answers = folder("/p5");
  const refused = "git refuses the repository this folder is in: fatal: detected dubious ownership in repository at '/p5' — a git repository's files are listed by git alone, which leaves out what .gitignore hides";
  serve = (u) => (u.includes("files/search") ? new Refusal(500, refused) : answers[u]);
  const p = hosted();
  try {
    p.host.setChat({ id: "p5", chainId: "c5", cwd: "/p5" });
    p.host.openTab("files");
    await until(() => rowNamed(p.frame, "src"), "the tree");
    const filter = p.frame.querySelector("input");
    filter.value = "ignored";
    filter.dispatch("input");
    await until(() => p.frame.querySelector(".file-tree .pane-empty"), "the search's answer", { timeoutMs: 2000 });
    assert.equal(p.frame.querySelector(".file-tree .pane-empty")?.textContent, `The search failed: ${refused}`);
  } finally {
    p.done();
  }
});

// (fails before: yes — the bug hunt of 10-30, the Files pane's Lows: the trees and git statuses were kept for every
// folder ever shown, none let go)
test("the trees of the last FOLDERS_KEPT folders are kept: one drawn before them is drawn afresh, a kept one as it stands", async () => {
  serve = (u) => (u.startsWith("/api/git/status") ? { ok: true, files: [] } : u.startsWith("/api/files/tree") ? { entries: [{ name: "x.txt", path: "x.txt", kind: "file" }] } : undefined);
  const { document, restore } = stubDocument();
  try {
    /** The pane drawn for a folder in a body of its own, once its tree is read. @param {string} cwd */
    const draw = async (cwd) => {
      const body = /** @type {any} */ (document.createElement("div"));
      document.body.append(body);
      files.renderFiles(body, { chat: { cwd } });
      await until(() => body.querySelector(".file-tree-row"), `the tree of ${cwd}`);
      return body.firstElementChild;
    };
    const first = await draw("/kept0");
    let last = null;
    for (let i = 1; i <= 8; i++) last = await draw(`/kept${i}`);
    assert.notEqual(await draw("/kept0"), first, "eight folders drawn since: drawn afresh");
    assert.equal(asked.filter((u) => u === "GET /api/git/status?cwd=%2Fkept0").length, 2, "its git status read again");
    assert.equal(await draw("/kept8"), last, "a folder among the last eight: as it stands");
  } finally {
    restore();
  }
});

// (fails before: yes — the bug hunt of 10-30, UIP-2: the page's Files pane had no refresh)
test("the page hands the Files pane its refresh beside its draw", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /\{ id: "files", [^\n]*render: \(body, ctx\) => renderFiles\(body, filesCtx\(ctx\)\), refresh: \(body, ctx\) => refreshFiles\(body, filesCtx\(ctx\)\) \}/);
  assert.match(app, /function filesCtx\(ctx\) \{\s*return \{ \.\.\.ctx, onInsert: \(\/\*\* @type \{string\} \*\/ text\) => composer\.fill\(composer\.draft\(\) \+ text\) \};\s*\}/, "Add to chat writes into the message box, as it did");
});

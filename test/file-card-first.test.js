// @ts-check
// A turn's file card reads its run's first FILES_FIRST changed files and the counts, not every row (the owner's of
// 11-17: one turn's answer, `GET /runs/:id/changes`, was 22.8 MB — 77,842 rows, 21.5 MB of them `whole.files` — read and
// held by the page for a card most often hidden under its tree card). The route holds the whole's lists to their first
// rows where the page asks (`?first=N`, `firstOf`), sliced from the answer it keeps whole; the card's head, its lines and
// its totals say what they said; opened, a turn of more than FILES_FIRST files shows its first and a row that reads the
// rest; Find reads every row before it searches, as it searched them all before. A host that answers whole — another
// machine's older Filament — is drawn as before. Every repository is a throwaway under the temp folder — never this one.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { snapshotTree } from "../src/adapters/git/snapshot.js";
import { createRunLog } from "../src/services/runs.js";
import { createEventBus } from "../src/services/events.js";
import { runRoutes, firstOf } from "../src/http/admin/runs.js";
import { createRouter } from "../src/http/router.js";
import { removeDirs } from "./helpers/wait.js";
import { stubDocument } from "./helpers/dom-stub.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made.reverse()));

/** The changes route over a throwaway repository whose one round changed seven files; `body` is the answer's text. */
async function route() {
  const dir = mkdtempSync(join(tmpdir(), "filament-first-change-"));
  const data = mkdtempSync(join(tmpdir(), "filament-first-runs-"));
  made.push(dir, data);
  git(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "keep.txt"), "k\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);
  const head = git(dir, ["rev-parse", "HEAD"]);
  const place = git(dir, ["rev-parse", "--show-toplevel"]);
  const names = ["a", "b", "c", "d", "e", "f", "g"].map((x) => `${x}.txt`);
  for (const n of names) writeFileSync(join(dir, n), `${n}\n`);
  const s1 = await snapshotTree(dir, { name: "f1/1-1" });
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: data, config: () => ({}) });
  runs.startRun({ id: "run-f1", kind: "agent-turn", meta: { root: dir } });
  bus.publish("run:run-f1", { type: "snapshot", place, round: 1, agent: "", before: head, after: String(s1.commit), base: "round", own: names, command: false });
  const call = createRouter(runRoutes(/** @type {any} */ ({ runs, sseClients: new Set() })));
  /** @param {string} query */
  const ask = async (query) => {
    const path = "/runs/run-f1/changes";
    const m = call("GET", path);
    assert.ok(m);
    let body = "";
    let status = 0;
    const res = { headersSent: false, writableEnded: false, setHeader() {}, getHeader() {}, writeHead: (/** @type {number} */ s) => void (status = s), write: (/** @type {string} */ c) => void (body += c), end: (/** @type {string} */ c = "") => void (body += c), on() {} };
    await m.handler(/** @type {any} */ ({ req: { headers: {}, method: "GET", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url: new URL(`http://127.0.0.1${path}?${query}`), path, method: "GET", params: m.params }), /** @type {any} */ ({}));
    assert.equal(status, 200, body);
    return { body, json: JSON.parse(body) };
  };
  /** git cannot be asked in the repository while `fn` runs. @param {() => Promise<void>} fn */
  const gitAway = async (fn) => {
    renameSync(join(dir, ".git"), join(dir, ".git-away"));
    try {
      await fn();
    } finally {
      renameSync(join(dir, ".git-away"), join(dir, ".git"));
    }
  };
  return { ask, gitAway, close: () => runs.close() };
}

// (fails before: yes — `first` was not read: every row went, whatever the page asked)
test("the route: first=N holds the whole's lists to their first N rows with their counts, from the answer kept whole — one git read for both; the whole as before; a value that is no count is none", async () => {
  const t = await route();
  try {
    const whole = await t.ask("");
    const w = whole.json.whole;
    assert.equal(w.files.length, 7, JSON.stringify(w));
    await t.gitAway(async () => {
      const three = (await t.ask("first=3")).json;
      assert.deepEqual(three, { ...whole.json, whole: { ...w, files: w.files.slice(0, 3), during: w.during.slice(0, 3), outside: w.outside.slice(0, 3), counts: { files: 7, during: 0, outside: 0 } } }, "the kept answer, sliced: git was not asked");
      assert.equal((await t.ask("first=1")).json.whole.files.length, 1);
      assert.equal((await t.ask("")).body, whole.body, "the whole again, as it was: no slice wrote on it");
      for (const q of ["first=0", "first=-2", "first=abc", "first=2.5", "first="]) assert.equal((await t.ask(q)).body, whole.body, `${q}: as no first`);
    });
  } finally {
    t.close();
  }
});

// (fails before: yes — no `first`)
test("the route: an answer that says git could not read a place, asked with first, is read again at the next ask", async () => {
  const t = await route();
  try {
    await t.gitAway(async () => {
      const failed = (await t.ask("first=3")).json;
      assert.ok(failed.whole?.errors?.length, `git could not be asked: ${JSON.stringify(failed)}`);
    });
    const again = (await t.ask("first=3")).json;
    assert.deepEqual([again.whole.files.length, again.whole.counts.files, again.whole.errors.length], [3, 7, 0]);
  } finally {
    t.close();
  }
});

test("firstOf counts what the files card counts: during by place and path, outside by path, each once", () => {
  const whole = {
    files: [{ path: "a" }, { path: "b" }, { path: "c" }],
    during: [{ place: "P", path: "x" }, { place: "P", path: "x" }, { place: "Q", path: "x" }, { place: "P", path: "y" }],
    outside: [{ path: "/o/1" }, { path: "/o/1" }, { path: "/o/2" }],
    places: [],
    errors: [],
    totals: { files: 3, added: 9, removed: 1 },
  };
  const answer = { runId: "r", whole };
  const out = firstOf(answer, 2);
  assert.deepEqual(out.whole.counts, { files: 3, during: 3, outside: 2 });
  assert.deepEqual([out.whole.files.length, out.whole.during.length, out.whole.outside.length, out.whole.totals], [2, 2, 2, whole.totals]);
  assert.deepEqual(answer.whole.files.length, 3, "the answer it was given, as it was");
});

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const g = /** @type {any} */ (globalThis);
/** A turn's answer whole: `n` files, during and outside rows with repeats. @param {number} n */
const answerOf = (n) => {
  const files = Array.from({ length: n }, (_, i) => ({ path: `src/f${String(i + 1).padStart(3, "0")}.txt`, place: "H:/p", agent: "", added: 1, removed: 0, status: "modified", binary: false }));
  return {
    runId: "r1",
    root: "H:/p",
    folder: "H:/p",
    rounds: null,
    totals: { files: n, added: n, removed: 0 },
    whole: { files, during: [{ place: "H:/p", path: "d1" }, { place: "H:/p", path: "d1" }, { place: "H:/q", path: "d2" }], outside: [{ path: "C:/o/1" }, { path: "C:/o/1" }], places: [{ place: "H:/p", start: "x" }], errors: [], totals: { files: n, added: n, removed: 0 } },
  };
};
/** What the stand-in host answers, by run, and whether it reads `first` (a host of today's) or not (an older one). */
const host = { answers: /** @type {Map<string, any>} */ (new Map()), first: true, asked: /** @type {string[]} */ ([]) };
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => {
  const u = new URL(String(url), "http://x");
  const id = decodeURIComponent(/\/runs\/([^/]+)\/changes/.exec(u.pathname)?.[1] || "");
  host.asked.push(`${id}${u.search}`);
  const body = host.answers.get(id);
  if (!body) return new Response("{}", { status: 404 });
  const first = Number(u.searchParams.get("first"));
  // As the route: sliced where there is a whole to slice.
  const out = host.first && first > 0 && body.whole ? firstOf(body, first) : body;
  return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
};
const dom = stubDocument();
Object.assign(g.window, {
  setInterval: (/** @type {any} */ fn, /** @type {number} */ ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; },
  clearInterval,
  setTimeout: (/** @type {any} */ fn, /** @type {number} */ ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
  clearTimeout,
});
const { fileChangeCard, FILES_FIRST, createTimeline } = await import("../src/ui/harness/conversation/timeline.js");
const { alignEvents } = await import("../src/ui/harness/lib/labels.js");
const { runReadsKept } = await import("../src/ui/harness/lib/turn-changes.js");
after(() => {
  g.fetch = realFetch;
  dom.restore();
});
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};
/** What a card says: its head, its lines, its totals, and its rows' leaves while they stand. @param {any} card */
const seen = (card) => ({
  label: card.querySelector(".file-label").textContent,
  totals: card.querySelector("summary .file-counts").textContent,
  lines: [...card.querySelectorAll(".file-during, .file-outside")].map((/** @type {any} */ l) => l.textContent),
  rows: [...card.querySelectorAll(".file-row")].filter((/** @type {any} */ r) => !r.classList.contains("file-all")).length,
  all: card.querySelector(".file-all")?.textContent ?? null,
});
/** A card over run `id`, opened. @param {string} id */
const opened = async (id) => {
  const card = /** @type {any} */ (fileChangeCard([], { runId: id }));
  document.body.append(card);
  await settle();
  card.open = true;
  card.dispatch("toggle");
  return card;
};

// (fails before: yes — the card read every row: no first, no Show all)
test("a turn of more than FILES_FIRST files: the head, lines and totals as every row said them; opened, its first rows and a row that reads the rest; pressed, every row", async () => {
  assert.equal(FILES_FIRST, 500);
  host.first = true;
  host.answers.set("big", answerOf(503));
  host.asked.length = 0;
  const card = await opened("big");
  assert.deepEqual(host.asked, ["big?first=500"]);
  const before = seen(card);
  assert.deepEqual(before, { label: "503 files changed", totals: "+503", lines: ["2 more changed while its commands ran — by them or by someone else", before.lines[1]], rows: 500, all: "Show all 503 files" });
  card.querySelector(".file-all").dispatch("click");
  assert.equal(card.querySelector(".file-all").textContent, "Reading all 503 files…");
  await settle();
  assert.deepEqual(host.asked, ["big?first=500", "big"]);
  assert.deepEqual(seen(card), { ...before, rows: 503, all: null }, "every row, the rest as it was");
  // An older host, which reads no `first`, answers whole: drawn as before, every row and no Show all.
  host.first = false;
  host.answers.set("old", answerOf(503));
  assert.deepEqual(seen(await opened("old")), { ...before, rows: 503, all: null });
  // A turn of FILES_FIRST or fewer: as before.
  host.first = true;
  host.answers.set("small", answerOf(12));
  const small = seen(await opened("small"));
  assert.deepEqual([small.label, small.rows, small.all], ["12 files changed", 12, null]);
});

// (fails before: yes — the share kept every run's answer for the page's life)
test("a run's read is shared while it is fresh, then let go", async () => {
  host.answers.set("gone", answerOf(3));
  const { runChanges } = await import("../src/ui/harness/lib/turn-changes.js");
  const before = runReadsKept();
  await Promise.all([runChanges("gone"), runChanges("gone"), runChanges("gone", { first: 500 })]);
  assert.equal(runReadsKept(), before + 2, "one read each way while fresh");
  await new Promise((r) => setTimeout(r, 4100));
  assert.equal(runReadsKept(), 0, "let go once stale, as every read before it");
});

/** The globals a drawn timeline reads that node lacks. */
const pageGlobals = () => {
  g.requestAnimationFrame ||= () => 0;
  g.cancelAnimationFrame ||= () => {};
  g.IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  g.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  g.getComputedStyle ||= () => ({});
  g.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
  g.sessionStorage ||= g.localStorage;
  Object.assign(g.window, { getSelection: () => ({ toString: () => "", removeAllRanges() {}, rangeCount: 0 }) });
  const d = /** @type {any} */ (document);
  d.addEventListener ||= () => {};
  d.removeEventListener ||= () => {};
};

// (fails before: yes — Find searched the card's first rows alone, or a card placed again while it was open read its
// first rows again)
test("Find on the timeline reads every row of a card that held its first, and a card placed again while it is open reads them all; closed, a new card reads its first again", async () => {
  pageGlobals();
  host.first = true;
  host.answers.set("r-find", answerOf(503));
  const root = /** @type {any} */ (document.createElement("div"));
  document.body.append(root);
  const tl = createTimeline(root, /** @type {any} */ ({}));
  const aligned = alignEvents([
    { type: "round-start", round: 1, blocksBefore: 0 },
    { type: "snapshot", round: 1, place: "H:/p", agent: "", before: "a", after: "b", ref: "refs/x", base: "round", own: [], command: false },
  ]);
  const turn = { n: 1, status: "done", past: false, runId: "r-find", blocks: [{ type: "text", text: "Done." }], steers: [], segments: [], boundaries: [], boundariesAfter: [], aligned, startedAt: Date.UTC(2026, 10, 17) };
  host.asked.length = 0;
  tl.render(/** @type {any} */ ({ chainId: "c1", turns: [turn], live: null }));
  await settle();
  assert.deepEqual(host.asked, ["r-find?first=500"], "drawn: its first rows");
  const cardNow = () => /** @type {any} */ (root.querySelector(".file-card"));
  const rowsOf = () => [...cardNow().querySelectorAll(".file-row")].filter((/** @type {any} */ r) => !r.classList.contains("file-all")).map((/** @type {any} */ r) => r.querySelector(".file-leaf").textContent);
  tl.revealWork("f502");
  assert.deepEqual(rowsOf(), [], "before Find reads: the row is not among its first");
  const brought = await tl.readWork();
  assert.equal(brought, 1, "the card read the rest: Find searches again");
  // A placing between Find's read and its search: the card made anew reads every row, as Find is open.
  tl.placeCards(turn);
  await settle();
  assert.equal(host.asked.filter((a) => a === "r-find?first=500").length, 1, "placed while Find is open: no first read");
  tl.revealWork("f502");
  assert.deepEqual(rowsOf().filter((r) => r === "f502.txt"), ["f502.txt"], "Find draws the row past the first 500");
  tl.foldWork();
  tl.placeCards(turn);
  await settle();
  tl.revealWork("f502");
  assert.deepEqual(rowsOf(), [], "Find closed: a card made anew holds its first rows again");
  tl.revealWork("f007");
  assert.deepEqual(rowsOf().filter((r) => r === "f007.txt"), ["f007.txt"], "among them, as ever");
});

// (fails before: yes — the review of item 10: a card whose run answered no whole was read again at each Find open, and
// counted as brought, so Find searched again and its place went back to the first match)
test("Find brings nothing for a card whose run recorded no change of its own, or is gone: one read in all, at every open", async () => {
  pageGlobals();
  host.first = true;
  host.answers.set("r-none", { runId: "r-none", root: "H:/p", rounds: [], totals: { files: 0, added: 0, removed: 0 }, whole: null, note: "this run recorded no change of its own" });
  host.answers.delete("r-gone");
  const root = /** @type {any} */ (document.createElement("div"));
  document.body.append(root);
  const tl = createTimeline(root, /** @type {any} */ ({}));
  /** A settled turn of its run whose round took a snapshot. @param {string} runId @param {number} n */
  const turnOf = (runId, n) => ({ n, status: "done", past: false, runId, blocks: [{ type: "text", text: "Done." }], steers: [], segments: [], boundaries: [], boundariesAfter: [], startedAt: Date.UTC(2026, 10, 17), aligned: alignEvents([{ type: "round-start", round: 1, blocksBefore: 0 }, { type: "snapshot", round: 1, place: "H:/p", agent: "", before: "a", after: "b", ref: "refs/x", base: "round", own: [], command: false }]) });
  host.asked.length = 0;
  tl.render(/** @type {any} */ ({ chainId: "c2", turns: [turnOf("r-none", 1), turnOf("r-gone", 2)], live: null }));
  await settle();
  assert.deepEqual([await tl.readWork(), await tl.readWork()], [0, 0], "nothing brought, at either open");
  tl.foldWork();
  assert.deepEqual(host.asked.filter((a) => a.startsWith("r-")).sort(), ["r-gone?first=500", "r-none?first=500"], "one read each, its first");
});

// (fails before: yes — the review of item 10: the landing took the focus wherever it stood, the composer's too)
test("Show all's landing moves the focus to the first row it brought, without scrolling, only where nothing took it while it read", async () => {
  host.first = true;
  host.answers.set("focus", answerOf(503));
  const d = /** @type {any} */ (document);
  const proto = Object.getPrototypeOf(d.createElement("button"));
  const had = proto.focus;
  /** @type {[string, any][]} */
  const focused = [];
  proto.focus = function (/** @type {any} */ o) { focused.push([this.querySelector?.(".file-leaf")?.textContent ?? this.className, o]); };
  try {
    const press = async (/** @type {(btn: any) => void} */ meanwhile) => {
      const card = await opened("focus");
      const btn = card.querySelector(".file-all");
      d.activeElement = btn;
      btn.dispatch("click");
      meanwhile(btn);
      await settle();
      return card;
    };
    await press(() => {});
    assert.deepEqual(focused, [["f501.txt", { preventScroll: true }]], "on the row: to the first it brought, where it stands");
    focused.length = 0;
    await press(() => void (d.activeElement = d.createElement("textarea")));
    assert.deepEqual(focused, [], "the person typed elsewhere meanwhile: left there");
  } finally {
    proto.focus = had;
    delete d.activeElement;
  }
});

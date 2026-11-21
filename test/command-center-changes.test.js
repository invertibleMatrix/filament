// @ts-check
// The command center's Recent changes (the owner's of 11-18, on what was left of the 11-17 speed pass: "the command
// center downloads its newest turn in full at every keystroke"): it read the newest turn's changes whole — 22.9 MB for
// TinyQuest's turn 47 — at every keystroke to list six, and drew nothing until its three reads had come one after
// another, so a turn's first read after a start, a git walk, held the list empty. The route cuts the files whose path
// holds the words (`?match=`, `?take=`), in the answer's own order, saying so in `match`; the page asks that, holds a
// host's whole for the open where none is said, and draws the parts that came once a read is slow, each below the last.
// Every repository is a throwaway under the temp folder — never this one.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { snapshotTree } from "../src/adapters/git/snapshot.js";
import { memoryRoutes, changesMatching, TURN_MATCH_MOST } from "../src/http/admin/memory.js";
import { createRouter } from "../src/http/router.js";
import { removeDirs } from "./helpers/wait.js";
import { stubDocument } from "./helpers/dom-stub.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made.reverse()));

// The page's API client keeps the `fetch` it finds when it is first imported: the stand-in goes first.
const g = /** @type {any} */ (globalThis);
const realFetch = g.fetch;
/** @type {string[]} */
const asked = [];
/** What a test's host answers, by the address asked. @type {(url: string) => any} */
let host = () => ({});
/** Each read's address and signal, as a browser's fetch is handed them. @type {{ url: string, signal: AbortSignal }[]} */
const reads = [];
/** @param {string} url @param {RequestInit} [init] */
g.fetch = (url, init) => {
  asked.push(String(url));
  const signal = init?.signal;
  if (signal) reads.push({ url: String(url), signal });
  // As a browser's: a read let go rejects at once, its connection freed, whatever its host still does.
  return new Promise((resolve, reject) => {
    signal?.addEventListener("abort", () => reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" })), { once: true });
    Promise.resolve(host(String(url))).then((body) => resolve({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }), reject);
  });
};
const { createCommandCenter, SLOW_PARTS_MS } = await import("../src/ui/harness/command-center.js");
after(() => {
  g.fetch = realFetch;
});

/** The command center's own naming of a file: its whole path where its place is not the chat's folder. @param {any} f @param {string | null} folder */
const named = (f, folder) => (f.place && folder && f.place !== folder ? `${f.place}/${f.path}` : String(f.path));

/**
 * The memory changes route over two throwaway repositories, the chat's folder and a worktree beside it, whose turn 1
 * changed files in each: the folder's paths are named alone, the worktree's by their place.
 */
async function route() {
  const dir = mkdtempSync(join(tmpdir(), "filament-cc-changes-"));
  made.push(dir);
  const main = join(dir, "main");
  const side = join(dir, "side-wt");
  /** @type {any[]} */
  const rounds = [];
  for (const [repo, names] of /** @type {[string, string[]][]} */ ([[main, ["src/App.js", "src/b.txt", "docs/side-note.md", "z.txt"]], [side, ["lib/c.js", "d.txt"]]])) {
    mkdirSync(repo);
    git(repo, ["init", "-q", "-b", "main"]);
    writeFileSync(join(repo, "keep.txt"), "k\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
    const head = git(repo, ["rev-parse", "HEAD"]);
    const place = git(repo, ["rev-parse", "--show-toplevel"]);
    for (const n of names) {
      mkdirSync(dirname(join(repo, n)), { recursive: true });
      writeFileSync(join(repo, n), `${n}\n`);
    }
    const s = await snapshotTree(repo, { name: `cc/${rounds.length + 1}` });
    rounds.push({ place, round: 1, agent: "", before: head, after: String(s.commit), base: "round", own: [...names], command: false, turn: 1 });
  }
  const memory = {
    roundsOf: (/** @type {string} */ id) => {
      if (id !== "c1") throw new Error("no such session");
      return { chainId: "c1", turns: 1, cwd: main, rounds, tree: null };
    },
    placesAlone: () => new Set(),
  };
  const call = createRouter(memoryRoutes(/** @type {any} */ ({ memory, usage: {}, sseClients: new Set() })));
  /** @param {string} query */
  const ask = async (query) => {
    const path = "/memory/sessions/c1/changes";
    const m = call("GET", path);
    assert.ok(m);
    let body = "";
    let status = 0;
    const res = { headersSent: false, writableEnded: false, setHeader() {}, getHeader() {}, writeHead: (/** @type {number} */ s) => void (status = s), write: (/** @type {string} */ c) => void (body += c), end: (/** @type {string} */ c = "") => void (body += c), on() {} };
    await m.handler(/** @type {any} */ ({ req: { headers: {}, method: "GET", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url: new URL(`http://127.0.0.1${path}?${query}`), path, method: "GET", params: m.params }), /** @type {any} */ ({}));
    return { status, json: JSON.parse(body) };
  };
  /** git cannot be asked in either repository while `fn` runs. @param {() => Promise<void>} fn */
  const gitAway = async (fn) => {
    for (const r of [main, side]) renameSync(join(r, ".git"), join(r, ".git-away"));
    try {
      await fn();
    } finally {
      for (const r of [main, side]) renameSync(join(r, ".git-away"), join(r, ".git"));
    }
  };
  return { ask, gitAway, main: git(main, ["rev-parse", "--show-toplevel"]), side: git(side, ["rev-parse", "--show-toplevel"]) };
}

// (fails before: yes — `match` was not read: every file went at every keystroke)
test("the route: match cuts the files whose path, as the command center names it, holds the words, in the answer's own order, and says so; kept, so git is not asked again", async () => {
  const t = await route();
  const whole = (await t.ask("turn=1")).json;
  assert.equal(whole.files.length, 6, JSON.stringify(whole));
  assert.equal(whole.folder, t.main);
  /** The page's own cut of the whole, by the folder its answer names: the oracle. @param {string} q @param {number} take */
  const oracle = (q, take, folder = whole.folder) => whole.files.filter((/** @type {any} */ f) => !q || named(f, folder).toLowerCase().includes(q.toLowerCase())).slice(0, take);
  for (const [q, take] of /** @type {[string, number][]} */ ([["", 3], ["", 50], ["APP", 6], ["side", 6], ["side-wt", 6], [".txt", 2], ["nothing-like-it", 6]])) {
    const got = await t.ask(`turn=1&match=${encodeURIComponent(q)}&take=${take}`);
    assert.equal(got.status, 200, JSON.stringify(got.json));
    assert.deepEqual(got.json, { chainId: "c1", turn: 1, folder: t.main, tree: null, files: oracle(q, take), errors: [], match: { q, take } }, `${JSON.stringify(q)} take ${take}`);
  }
  const side = (await t.ask("turn=1&match=side&take=6")).json.files.map((/** @type {any} */ f) => named(f, t.main));
  assert.deepEqual(side, ["docs/side-note.md", `${t.side}/lib/c.js`, `${t.side}/d.txt`].sort((a, b) => whole.files.findIndex((/** @type {any} */ f) => named(f, t.main) === a) - whole.files.findIndex((/** @type {any} */ f) => named(f, t.main) === b)), "a worktree's file by its place, the folder's by its path");
  assert.deepEqual((await t.ask("turn=1&match=%20%20APP%20&take=6")).json.match, { q: "APP", take: 6 }, "the words as the page trims them");
  await t.gitAway(async () => {
    const kept = (await t.ask("turn=1&match=.js&take=6")).json;
    assert.deepEqual([kept.folder, kept.files, kept.errors], [null, oracle(".js", 6, null), []], "cut from the whole kept, git out of reach: the folder, read at each ask, is none");
  });
});

// (fails before: yes — `match` was not read, so these answered whole)
test("the route: match refuses what is not kept — the chat's, a patch's — and first beside it, and a take that is no count from 1 to the most", async () => {
  const t = await route();
  const refused = async (/** @type {string} */ q, /** @type {RegExp} */ words) => {
    const got = await t.ask(q);
    assert.equal(got.status, 400, `${q}: ${JSON.stringify(got.json)}`);
    assert.match(got.json.error, words, q);
  };
  await refused("scope=chat&match=a&take=6", /not with scope=chat or patch=1/);
  await refused("turn=1&patch=1&match=a&take=6", /not with scope=chat or patch=1/);
  await refused("turn=1&first=4&match=a&take=6", /ask one/);
  for (const take of ["", "0", "-1", "2.5", "abc", String(TURN_MATCH_MOST + 1)]) await refused(`turn=1&match=a&take=${take}`, new RegExp(`1 to ${TURN_MATCH_MOST}`));
  await refused("turn=1&match=a", new RegExp(`1 to ${TURN_MATCH_MOST}`));
  assert.equal((await t.ask(`turn=1&match=a&take=${TURN_MATCH_MOST}`)).status, 200);
});

test("the route: a match read where git could not read a place says so, and is not kept", async () => {
  const t = await route();
  await t.gitAway(async () => {
    const failed = (await t.ask("turn=1&match=&take=6")).json;
    assert.ok(failed.errors.length, JSON.stringify(failed));
  });
  assert.deepEqual((await t.ask("turn=1&match=&take=6")).json.errors, [], "read again once git answers");
});

test("changesMatching: stops at take, the words lower-cased, nothing typed holds in every path, a folder unknown names each file by its path alone", () => {
  const files = [
    { place: "C:/w/app", path: "src/A.js" },
    { place: "C:/w/wt", path: "b.js" },
    { place: "C:/w/app", path: "README.md" },
    { place: "C:/w/wt", path: "src/c.js" },
  ];
  assert.deepEqual(changesMatching(files, "C:/w/app", "", 2), files.slice(0, 2));
  assert.deepEqual(changesMatching(files, "C:/w/app", "SRC", 6), [files[0], files[3]]);
  assert.deepEqual(changesMatching(files, "C:/w/app", "w/wt", 6), [files[1], files[3]], "another place's file by its whole path");
  assert.deepEqual(changesMatching(files, null, "w/wt", 6), [], "no folder: each by its path");
  assert.deepEqual(changesMatching(files, "C:/w/app", "w/app", 6), [], "the folder's own files by their path alone");
});

/** A promise with its resolve in hand. @template T */
const later = () => {
  /** @type {(v: T) => void} */
  let resolve = () => {};
  /** @type {Promise<T>} */
  const p = new Promise((r) => (resolve = r));
  return { p, resolve };
};
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

/**
 * The command center opened on a stub page over a chat whose newest finished turn is `n`, its timers the test's own:
 * `wait(ms)` moves them on, `slow()` past the paint's wait.
 * @param {import("node:test").TestContext} t @param {{ chat?: any, actions?: any[], settings?: any, history?: string[], folder?: string }} [o]
 *   `folder`: the folder the files search reads, none where it is not said
 */
function openOn(t, { chat = { chainId: "c1", cwd: "H:/w/app", turns: [{ status: "done", rec: { memory: { turn: 3 } } }] }, actions = [], settings = null, history = /** @type {string[]} */ ([]), folder = "" } = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  /** @param {number} ms */
  const wait = async (ms) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  const doc = stubDocument();
  const was = { frame: g.requestAnimationFrame, element: g.HTMLElement, local: g.localStorage };
  g.requestAnimationFrame = (/** @type {() => void} */ fn) => setTimeout(fn, 0);
  g.HTMLElement = class {};
  g.localStorage = { getItem: (/** @type {string} */ k) => (k === "filament.harness.searchHistory" ? JSON.stringify(history) : null), setItem() {}, removeItem() {} };
  t.after(() => {
    g.requestAnimationFrame = was.frame;
    g.HTMLElement = was.element;
    g.localStorage = was.local;
    doc.restore();
  });
  asked.length = 0;
  const d = /** @type {any} */ (globalThis.document);
  createCommandCenter({ actions: () => actions, onOpenTask: () => {}, getChat: () => chat, settings: () => settings, getFolder: () => folder }).open();
  const input = d.querySelector(".cc-input");
  return {
    chat,
    wait,
    slow: () => wait(SLOW_PARTS_MS),
    list: d.querySelector(".cc-list"),
    /** @param {string} v */
    type: (v) => {
      input.value = v;
      input.dispatch("input");
    },
    /** @param {string} key */
    key: (key) => input.dispatch("keydown", { key }),
    on: () => d.querySelector(".cc-row.on")?.querySelector(".cc-name")?.textContent ?? null,
    has: (/** @type {string} */ sel) => !!d.querySelector(sel),
    close: () => d.querySelector(".cc-esc").dispatch("click"),
    labels: () => /** @type {any[]} */ (d.querySelectorAll(".cc-label")).map((e) => e.textContent),
    rows: () => /** @type {any[]} */ (d.querySelectorAll(".cc-row")).map((e) => e.querySelector(".cc-name")?.textContent ?? e.textContent),
    empty: () => !!d.querySelector(".cc-empty"),
    changesAsked: () => asked.filter((u) => u.includes("/changes?")),
  };
}

/** A host's file rows for the command center: `n` of them, each holding the words `q`. @param {string} q @param {number} n */
const filesFor = (q, n) => Array.from({ length: n }, (_, i) => ({ place: "H:/w/app", path: `src/${q}${i}.js`, status: "modified", added: i, removed: 0 }));

// (fails before: yes — it asked the whole, `?turn=3&cwd=…` alone, at every keystroke)
test("the page asks the newest turn's files whose path holds the words, six, at each keystroke; what comes back is cut again", async (t) => {
  host = (url) => {
    if (url.includes("/changes?")) {
      const q = new URL(url, "http://x").searchParams.get("match") || "";
      // One row that does not hold the words, and more than six: the page cuts what comes back.
      return { folder: "H:/w/app", files: [{ place: "H:/w/app", path: "other.md", status: "added" }, ...filesFor(q, 8)], match: { q, take: 6 } };
    }
    if (url.startsWith("/api/memory/sessions?")) return { sessions: [] };
    return {};
  };
  const cc = openOn(t);
  await settle();
  for (const v of ["a", "ab", "AbC"]) {
    cc.type(v);
    await settle();
  }
  assert.deepEqual(cc.changesAsked(), ["", "a", "ab", "abc"].map((q) => `/api/memory/sessions/c1/changes?turn=3&cwd=${encodeURIComponent("H:/w/app")}&match=${q}&take=6`));
  assert.deepEqual(cc.rows(), filesFor("abc", 6).map((f) => f.path), "six that hold the words, in the order they came");
});

// (fails before: yes — a host that answered whole was asked again at every keystroke)
test("a host that answers whole is asked once an open, its answer cut here; another newest turn is asked anew", async (t) => {
  const whole = [...filesFor("x", 3), ...filesFor("y", 9), { place: "H:/w/wt", path: "x9.js", status: "added" }];
  host = (url) => (url.includes("/changes?") ? { folder: "H:/w/app", files: whole } : url.startsWith("/api/memory/sessions?") ? { sessions: [] } : {});
  const cc = openOn(t);
  await settle();
  assert.deepEqual(cc.rows(), whole.slice(0, 6).map((f) => f.path), "nothing typed: the first six");
  for (const v of ["y", "Y1", "wt/x"]) {
    cc.type(v);
    await settle();
  }
  assert.equal(cc.changesAsked().length, 1, "asked once");
  assert.deepEqual(cc.rows(), ["H:/w/wt/x9.js"], "a worktree's file by its whole path");
  cc.type("y");
  await settle();
  assert.deepEqual(cc.rows(), filesFor("y", 9).slice(0, 6).map((f) => f.path));
  cc.chat.turns = [...cc.chat.turns, { status: "done", rec: { memory: { turn: 4 } } }];
  cc.type("y1");
  await settle();
  assert.deepEqual(cc.changesAsked().map((u) => new URL(u, "http://x").searchParams.get("turn")), ["3", "4"], "a turn that ended while it was open: read anew");
});

// (fails before: yes — the list drew nothing until all three reads had come, one after another)
test("a slow read: the parts that came are drawn, up to the first still out — no empty line, examples or history yet — and each that comes draws below", async (t) => {
  const changes = later();
  host = (url) => (url.includes("/changes?") ? changes.p : url.startsWith("/api/memory/sessions?") ? { sessions: [{ id: "s1", title: "Chat one" }] } : {});
  const cc = openOn(t, { actions: [{ id: "a", label: "Open the plan", run() {} }] });
  await settle();
  assert.deepEqual(cc.rows(), [], "within the wait, nothing is drawn: a quick read draws once");
  await cc.slow();
  assert.deepEqual(cc.labels(), ["Quick actions", "Recent chats"]);
  assert.deepEqual(cc.rows(), ["Open the plan", "Chat one"]);
  changes.resolve({ folder: "H:/w/app", files: filesFor("", 2), match: { q: "", take: 6 } });
  await settle();
  assert.deepEqual(cc.labels(), ["Quick actions", "Recent chats", "Recent changes"]);
  assert.deepEqual(cc.rows(), ["Open the plan", "Chat one", "src/0.js", "src/1.js"], "below the rows drawn");
});

test("a slow chats read holds the changes that came below it: nothing is drawn under a part still out", async (t) => {
  const chats = later();
  host = (url) => (url.includes("/changes?") ? { folder: "H:/w/app", files: filesFor("", 1), match: { q: "", take: 6 } } : url.startsWith("/api/memory/sessions?") ? chats.p : {});
  const cc = openOn(t, { actions: [{ id: "a", label: "Open the plan", run() {} }] });
  await settle();
  await cc.slow();
  assert.deepEqual(cc.labels(), ["Quick actions"], "the changes came, the chats did not");
  chats.resolve({ sessions: [{ id: "s1", title: "Chat one" }] });
  await settle();
  assert.deepEqual(cc.labels(), ["Quick actions", "Recent chats", "Recent changes"]);
});

test("reads that come within the wait draw the list once: nothing for a quarter of a second, then whole as they come", async (t) => {
  const changes = later();
  host = (url) =>
    url.includes("/changes?")
      ? new URL(url, "http://x").searchParams.get("match") ? { folder: "H:/w/app", files: filesFor("a", 2), match: { q: "a", take: 6 } } : changes.p
      : url.startsWith("/api/memory/sessions?") ? { sessions: [{ id: "s1", title: "a chat" }] } : {};
  const cc = openOn(t, { actions: [{ id: "x", label: "an action", run() {} }] });
  const was = cc.list.replaceChildren.bind(cc.list);
  let draws = 0;
  cc.list.replaceChildren = (/** @type {any[]} */ ...kids) => {
    draws++;
    return was(...kids);
  };
  await cc.wait(250);
  assert.equal(draws, 0, "a read out for a quarter of a second: nothing drawn yet");
  changes.resolve({ folder: "H:/w/app", files: filesFor("", 1), match: { q: "", take: 6 } });
  await settle();
  assert.deepEqual([draws, cc.labels()], [1, ["Quick actions", "Recent chats", "Recent changes"]]);
  cc.type("a");
  await settle();
  assert.deepEqual([draws, cc.labels()], [2, ["Quick actions", "Recent chats", "Recent changes"]], "a keystroke whose reads come at once: one draw");
});

test("a whole that names a place git could not read, or no list of files, is not held: the next keystroke asks again", async (t) => {
  /** @type {any[]} */
  const answers = [{ folder: "H:/w/app", files: filesFor("y", 2), errors: [{ place: "H:/w/wt", error: "git timed out" }] }, {}, { folder: "H:/w/app", files: filesFor("y", 2), errors: [] }];
  host = (url) => (url.includes("/changes?") ? answers.shift() || {} : url.startsWith("/api/memory/sessions?") ? { sessions: [] } : {});
  const cc = openOn(t);
  await settle();
  for (const v of ["y", "y1", "y0"]) {
    cc.type(v);
    await settle();
  }
  assert.equal(cc.changesAsked().length, 3, "asked at the open, again after an answer with errors and one with no list of files, then held");
  assert.deepEqual(cc.rows(), ["src/y0.js"]);
});

test("a slow read that finds nothing: no 'No related results' until the last part came", async (t) => {
  const changes = later();
  host = (url) => (url.includes("/changes?") ? changes.p : url.startsWith("/api/memory/sessions?") ? { sessions: [] } : {});
  const cc = openOn(t);
  await settle();
  cc.type("qqq");
  await cc.slow();
  assert.equal(cc.empty(), false, "a part still out");
  changes.resolve({ folder: "H:/w/app", files: [], match: { q: "qqq", take: 6 } });
  await settle();
  assert.equal(cc.empty(), true);
});

test("a slow read: the examples to type and the search history wait for the last part", async (t) => {
  /** @type {ReturnType<typeof later>[]} */
  const reads = [];
  host = (url) => {
    if (!url.includes("/changes?")) return url.startsWith("/api/memory/sessions?") ? { sessions: [] } : {};
    const l = later();
    reads.push(l);
    return l.p;
  };
  const settings = { chat: true, client: false, line: { percent: 85, window: 200_000 }, permission: "edit", effort: { levels: ["low", "high"], now: "high", auto: true }, window: { options: [200_000], now: 200_000, standard: 200_000 }, model: "M", modelId: "p/m", families: [], memory: { on: true, source: "default" }, may: { tags: [], cards: [] }, mayOff: "" };
  const cc = openOn(t, { settings, history: ["an old search"] });
  await cc.slow();
  assert.equal(cc.has(".cc-history"), false, "nothing typed, a part still out: no history yet");
  reads[0].resolve({ folder: "H:/w/app", files: [], match: { q: "", take: 6 } });
  await settle();
  assert.equal(cc.has(".cc-history"), true);
  cc.type("zzqq");
  await cc.slow();
  assert.equal(cc.has(".cc-also"), false, "nothing found yet: no examples");
  reads[1].resolve({ folder: "H:/w/app", files: [], match: { q: "zzqq", take: 6 } });
  await settle();
  assert.equal(cc.has(".cc-also"), true, "nothing found: what else to type");
});

test("the highlight stands through a keystroke's parts: a draw with fewer rows than it leaves it, the last one sets it", async (t) => {
  /** @type {ReturnType<typeof later>[]} */
  const reads = [];
  host = (url) => {
    if (!url.includes("/changes?")) return url.startsWith("/api/memory/sessions?") ? { sessions: [] } : {};
    const q = new URL(url, "http://x").searchParams.get("match") || "";
    if (q === "src") {
      const l = later();
      reads.push(l);
      return l.p;
    }
    return { folder: "H:/w/app", files: filesFor("src", 6), match: { q, take: 6 } };
  };
  const cc = openOn(t, { actions: [{ id: "a", label: "src action", run() {} }] });
  cc.type("sr");
  await cc.slow();
  for (let i = 0; i < 5; i++) cc.key("ArrowDown");
  assert.equal(cc.on(), "src/src4.js");
  cc.type("src");
  await cc.slow();
  assert.equal(cc.on(), null, "a part still out: no row under it yet");
  reads[0].resolve({ folder: "H:/w/app", files: filesFor("src", 6), match: { q: "src", take: 6 } });
  await settle();
  assert.equal(cc.on(), "src/src4.js", "the same place once the rows came");
});

test("a newer keystroke paints: a slow read of an older one, come at last, draws nothing", async (t) => {
  /** @type {Map<string, ReturnType<typeof later>>} */
  const by = new Map();
  host = (url) => {
    if (!url.includes("/changes?")) return url.startsWith("/api/memory/sessions?") ? { sessions: [] } : {};
    const q = new URL(url, "http://x").searchParams.get("match") || "";
    const l = later();
    by.set(q, l);
    return q === "b" ? { folder: "H:/w/app", files: filesFor("b", 1), match: { q, take: 6 } } : l.p;
  };
  const cc = openOn(t);
  await settle();
  cc.type("a");
  await settle();
  cc.type("b");
  await cc.slow();
  assert.deepEqual(cc.rows(), ["src/b0.js"]);
  by.get("a")?.resolve({ folder: "H:/w/app", files: filesFor("a", 1), match: { q: "a", take: 6 } });
  by.get("")?.resolve({ folder: "H:/w/app", files: filesFor("z", 1), match: { q: "", take: 6 } });
  await cc.slow();
  assert.deepEqual(cc.rows(), ["src/b0.js"], "the older reads drew nothing");
});

// (fails before: yes — each keystroke's reads stayed out until they came, the review of 11-19: while a turn's walk ran,
// some six keystrokes held all six of the browser's connections to Filament, every other read of the page behind them)
test("a keystroke lets the reads of the paint before it go, and closing lets the last paint's go: one paint's reads out at most", async (t) => {
  host = (url) => (url.includes("/changes?") || url.startsWith("/api/memory/sessions?") || url.startsWith("/api/files/search?") ? new Promise(() => {}) : {});
  reads.length = 0;
  const cc = openOn(t, { folder: "H:/w/app" });
  await settle();
  const typed = ["a", "ab", "abc", "abcd", "abcde", "abcdef", "abcdefg"];
  for (const v of typed) {
    cc.type(v);
    await settle();
  }
  assert.equal(reads.filter((r) => r.url.includes("/changes?")).length, typed.length + 1, "each paint asked");
  const out = () => reads.filter((r) => !r.signal.aborted).map((r) => r.url);
  assert.deepEqual(
    out().sort(),
    [`/api/memory/sessions/c1/changes?turn=3&cwd=${encodeURIComponent("H:/w/app")}&match=abcdefg&take=6`, "/api/memory/sessions?limit=20&q=abcdefg", `/api/files/search?cwd=${encodeURIComponent("H:/w/app")}&q=abcdefg&limit=8`].sort(),
    "the newest paint's three alone",
  );
  const drew = cc.list.replaceChildren;
  let draws = 0;
  cc.list.replaceChildren = (/** @type {any[]} */ ...kids) => {
    draws++;
    return drew.call(cc.list, ...kids);
  };
  cc.close();
  assert.deepEqual(out(), [], "closed: none out");
  await cc.slow();
  assert.equal(draws, 0, "and no paint draws once closed");
});

test("the page's wiring: the three reads side by side, the wait for them, the hold kept per open", () => {
  const src = readFileSync(new URL("../src/ui/harness/command-center.js", import.meta.url), "utf8");
  assert.match(src, /await Promise\.race\(\[Promise\.all\(parts\), new Promise\(\(r\) => setTimeout\(r, SLOW_PARTS_MS\)\)\]\);/);
  assert.match(src, /const held = \{ key: "", r: null \};\n[\s\S]*?let reading = null;\n\n {6}const paint = async \(\) => \{/, "one hold per open, and one paint's reads");
  assert.match(src, /if \(!r\?\.match && Array\.isArray\(r\?\.files\) && !r\.errors\?\.length\) Object\.assign\(held, \{ key, r \}\);/, "held only where the host cut none, and its answer is whole");
});

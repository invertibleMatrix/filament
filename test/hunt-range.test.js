// @ts-check
// The plan's p6, "teams, improved and kept": a hunt's range, and its Hunters' findings merged in code.
// A hunt names what it hunts in — a diff (uncommitted, or since a ref), a commit range or files; none, what is uncommitted
// and what the chat's turns changed — and Filament reads it from git into the lead's opening, bounded, never the diff
// itself; the team tool's fire takes it, and the Plan's hunt from a node takes its task's files. Hunters end their reports
// with the fixed findings list, and Filament hands the lead their findings merged by file and nearby line, "found by N";
// `findingsOf` reads that mark and merges the lead's own duplicates. A team's total per run went with the owner's word of
// 11-05 ("Crew at once and Crew in one run: drop both"): an old one saved loads as none.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RANGE_LIMITS, parseRange, rangeBlock, huntsIn } from "../src/core/hunt-range.js";
import { CHAT_ROUNDS, resolveRange } from "../src/app/hunt-range.js";
import { snapshotTree } from "../src/adapters/git/snapshot.js";
import { NEAR_LINES, findingsOf, mergeFindings, mergedWords, openingContent, resultSubject, spotOf } from "../src/core/beside.js";
import { transcriptTurns } from "../src/ui/harness/conversation/history.js";
import { EMPTY_TREE } from "../src/adapters/git/changes.js";
import { createTeamsBeside } from "../src/app/teams-beside.js";
import { BESIDE_TOOL, besideCall } from "../src/app/agent/beside-tool.js";
import { createTeamTools } from "../src/app/agent/team-tools.js";
import { huntBrief } from "../src/ui/harness/views/task-graph.js";
import { sessionRoutes } from "../src/http/admin/sessions.js";
import { createRouter } from "../src/http/router.js";
import { TEAMS_FILE } from "../src/services/teams.js";
import { KNOBS } from "../src/services/session-settings.js";
import { openBrief } from "../src/ui/harness/views/brief.js";
import { RANGE_WORDS } from "../src/ui/harness/lib/brief.js";
import { foundByMark } from "../src/ui/harness/lib/beside.js";
import { teamStore, watched, leadOf, TEAM } from "./helpers/team.js";
import { until } from "./helpers/wait.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { all, one, btn, field, type, pick, settle, openAgents } from "./helpers/agents-page.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" }).trim();
/** A folder of the test's own. @param {string} [prefix] */
const folder = (prefix = "filament-hunt-") => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
/**
 * A repository: `a.js` and `src/b.js` committed and tagged `v1`; then `a.js` changed and committed (`HEAD`); then
 * `src/b.js` changed and `c.js` made, neither committed.
 */
const repo = () => {
  const dir = folder();
  git(dir, "init", "-q");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "a.js"), "one\ntwo\n");
  writeFileSync(join(dir, "src", "b.js"), "b1\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "first");
  git(dir, "tag", "v1");
  writeFileSync(join(dir, "a.js"), "one\nTWO\nthree\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "second");
  writeFileSync(join(dir, "src", "b.js"), "b1\nb2\nb3\n");
  writeFileSync(join(dir, "c.js"), "new 1\nnew 2\n");
  return dir;
};
/** A range's files as [path, added, removed]. @param {any} r */
const rows = (r) => r.files.map((/** @type {any} */ f) => [f.path, f.added, f.removed]);

// ---------------------------------------------------------------------------------------------------
// A. The range: its forms, the default from a chat's changes, the refusals — read-only
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — nothing read a range: a hunt hunted wherever its lead's words pointed)
describe("a hunt's range, as it is named", () => {
  test("plain words: none is the default; uncommitted; since or diff a ref; a..b; else files — a list a caller knows is files", () => {
    for (const none of [undefined, null, "", "  ", []]) assert.deepEqual(parseRange(none), { kind: "chat" });
    assert.deepEqual(parseRange("Uncommitted"), { kind: "uncommitted" });
    assert.deepEqual(parseRange("since main"), { kind: "diff", ref: "main" });
    assert.deepEqual(parseRange("diff:v1.2"), { kind: "diff", ref: "v1.2" });
    assert.deepEqual(parseRange("main..HEAD"), { kind: "commits", from: "main", to: "HEAD" });
    assert.deepEqual(parseRange("v1.."), { kind: "commits", from: "v1", to: "HEAD" });
    assert.deepEqual(parseRange("src/a.js, src/b.js\nlib"), { kind: "words", words: ["src/a.js", "src/b.js", "lib"] });
    assert.deepEqual(parseRange(["a.js", "a.js", " b.js "]), { kind: "files", files: ["a.js", "b.js"] });
    assert.match(String(/** @type {any} */ (parseRange("a...b")).error), /two commits with two dots between them/);
    assert.match(String(/** @type {any} */ (parseRange("..b")).error), /names no commit to start from/);
    assert.match(String(/** @type {any} */ (parseRange("x".repeat(RANGE_LIMITS.words + 1))).error), /characters at most/);
    assert.match(String(/** @type {any} */ (parseRange(42)).error), /a range is words/);
  });
});

describe("a hunt's range, read from git", () => {
  test("each form: its files, each with the lines its diff changes and how to read that diff", async () => {
    const dir = repo();
    const u = /** @type {any} */ (await resolveRange({ folder: dir, spec: "uncommitted" }));
    assert.equal(u.ok, true, u.error);
    assert.deepEqual(rows(u.range).sort(), [["c.js", 2, 0], ["src/b.js", 2, 0]]);
    // (the review of 11-03, 9: each command reads with no lock, its path in double quotes)
    assert.equal(u.range.read, `A file's diff: git --no-optional-locks diff HEAD -- "<file>"`);
    assert.equal(u.range.files.find((/** @type {any} */ f) => f.path === "c.js").note, "new, untracked: read the file");
    const v1 = git(dir, "rev-parse", "v1").slice(0, 12);
    const head = git(dir, "rev-parse", "HEAD").slice(0, 12);
    const since = /** @type {any} */ (await resolveRange({ folder: dir, spec: "since v1" }));
    assert.deepEqual(rows(since.range).sort(), [["a.js", 2, 1], ["c.js", 2, 0], ["src/b.js", 2, 0]]);
    // (9: a ref by the commit it names)
    assert.deepEqual([since.range.read, since.range.label], [`A file's diff: git --no-optional-locks diff ${v1} -- "<file>"`, `everything changed since \`v1\` (${v1}) — committed since, and uncommitted`]);
    const span = /** @type {any} */ (await resolveRange({ folder: dir, spec: "v1..HEAD" }));
    assert.deepEqual([rows(span.range), span.range.read, span.range.label], [[["a.js", 2, 1]], `A file's diff: git --no-optional-locks diff ${v1}..${head} -- "<file>"`, `the commits v1..HEAD (${v1}..${head})`]);
    // One word that names no path but a commit is a diff since it.
    const word = /** @type {any} */ (await resolveRange({ folder: dir, spec: "v1" }));
    assert.equal(word.range.kind, "diff");
    // Files and folders: a folder brings what git tracks in it; a file with uncommitted lines names how to read them.
    const files = /** @type {any} */ (await resolveRange({ folder: dir, spec: "a.js, src" }));
    assert.deepEqual(files.range.files, [{ path: "a.js", added: null, removed: null }, { path: "src/b.js", added: 2, removed: 0, note: "uncommitted", read: `git --no-optional-locks diff HEAD -- "src/b.js"` }]);
  });

  test("none named: what is uncommitted and the files the chat's turns changed, each read from before the chat first changed it", async () => {
    const dir = repo();
    const head = git(dir, "rev-parse", "HEAD");
    writeFileSync(join(dir, "own.js"), "the agent's 1\nthe agent's 2\nthe agent's 3\n");
    const s = await snapshotTree(dir, { name: "c1/1-1" });
    const place = git(dir, "rev-parse", "--show-toplevel");
    /** @type {any[]} */
    const rounds = [{ place, round: 1, turn: 1, agent: "", before: head, after: String(s.commit), base: "round", own: ["own.js"], command: false }];
    // Committed since: still the chat's change, read from its snapshot.
    git(dir, "add", "own.js");
    git(dir, "commit", "-qm", "the chat's work");
    const r = /** @type {any} */ (await resolveRange({ folder: dir, spec: null, rounds }));
    assert.equal(r.range.kind, "chat");
    const own = r.range.files.find((/** @type {any} */ f) => f.path === "own.js");
    assert.deepEqual(own, { path: "own.js", added: 3, removed: 0, note: "this chat changed it, added", read: `git --no-optional-locks diff ${head.slice(0, 12)} -- "own.js"` });
    assert.deepEqual(r.range.files.filter((/** @type {any} */ f) => f.note?.startsWith("uncommitted")).map((/** @type {any} */ f) => f.path).sort(), ["c.js", "src/b.js"]);
    // Nothing uncommitted, nothing changed: no range to carry.
    const clean = folder();
    git(clean, "init", "-q");
    writeFileSync(join(clean, "x.js"), "x\n");
    git(clean, "add", "-A");
    git(clean, "commit", "-qm", "x");
    assert.deepEqual(await resolveRange({ folder: clean, spec: "", rounds: [] }), { ok: true, range: null });
  });

  test("a range that names nothing, or a ref git does not know, is refused in words", async () => {
    const dir = repo();
    /** @param {string} at @param {unknown} spec */
    const no = async (at, spec) => /** @type {any} */ (await resolveRange({ folder: at, spec })).error;
    assert.equal(await no(dir, "since v9"), "git knows no commit, tag or branch `v9` in this repository");
    assert.equal(await no(dir, "v1..nope"), "git knows no commit, tag or branch `nope` in this repository");
    assert.equal(await no(dir, "HEAD..HEAD"), "`HEAD..HEAD` changes no file");
    assert.equal(await no(dir, "gone.js, a.js"), "the range names no file or folder in the chat's folder: `gone.js`");
    assert.equal(await no(dir, "nothing-here"), "the range names no file or folder in the chat's folder: `nothing-here`, and git knows no commit by that name");
    // (the review of 11-03, 7b: a list Filament made — the Plan's task's — is never refused: a gone file is listed so)
    assert.equal(await no(dir, ["gone.js"]), undefined);
    const clean = folder();
    git(clean, "init", "-q");
    writeFileSync(join(clean, "x.js"), "x\n");
    git(clean, "add", "-A");
    git(clean, "commit", "-qm", "x");
    assert.equal(await no(clean, "uncommitted"), "nothing is uncommitted in the chat's folder: name a ref, a commit range or files");
    assert.match(String(await no(folder(), "since v1")), /^the chat's folder is in no git repository .*: a diff or a commit range needs one — name files instead$/);
  });

  test("read-only: its reads take no lock and write nothing — the index and the refs are as git status left them", async () => {
    const dir = repo();
    const status = git(dir, "status", "--porcelain");
    const index = readFileSync(join(dir, ".git", "index"));
    const at = statSync(join(dir, ".git", "index")).mtimeMs;
    const refs = git(dir, "for-each-ref");
    for (const spec of [null, "uncommitted", "since v1", "v1..HEAD", "v1", "a.js, src", ["a.js"]]) await resolveRange({ folder: dir, spec });
    assert.deepEqual(readFileSync(join(dir, ".git", "index")), index, "the index, byte for byte");
    assert.equal(statSync(join(dir, ".git", "index")).mtimeMs, at, "and untouched");
    assert.deepEqual([git(dir, "for-each-ref"), git(dir, "status", "--porcelain")], [refs, status]);
  });
});

// ---------------------------------------------------------------------------------------------------
// B. The lead's opening carries it, bounded
// ---------------------------------------------------------------------------------------------------

/**
 * Teams beside a chat whose folder is `dir`: a fire's opening is kept in `posted`, its chat's meta in `meta`;
 * `huntRange` reads the range from git, as the sessions service does, over `rounds` — or as `huntRange` says, where
 * given — and a block the lead's first turn waits for (`openingAfter`) is set in as the service's turn sets it: once that
 * turn holds the chat, after the record.
 * @param {string} dir @param {any[]} [rounds] @param {((spec: unknown) => Promise<any>) | null} [huntRange]
 */
const besideOver = (dir, rounds = [], huntRange = null) => {
  /** @type {Map<string, any>} */
  const chains = new Map([["main", { id: "main", kind: "harness", meta: {} }]]);
  /** @type {any[]} */
  const posted = [];
  /** @type {Map<string, { block: Promise<any>, taken: () => void }>} */
  const openings = new Map();
  let n = 0;
  const beside = createTeamsBeside(/** @type {any} */ ({
    archive: () => ({
      getChain: (/** @type {string} */ id) => chains.get(id) || null,
      mergeMeta: (/** @type {string} */ id, /** @type {any} */ m) => void Object.assign(chains.get(id).meta, m),
      mainOf: (/** @type {string} */ id) => (id === "main" ? null : "main"),
      besideOf: () => [...chains.keys()].filter((k) => k !== "main"),
      chainHead: (/** @type {string} */ id) => chains.get(id),
    }),
    sessions: {
      launchInfo: () => ({ cwd: dir, model: "m-1", full: "m-1" }),
      settingsOf: () => ({ effective: { subagents: {} }, sources: {} }),
      recordFor: async () => "<main-chat title=\"x\" turns=\"1\">\n(the record)\n</main-chat>",
      create: (/** @type {any} */ o) => {
        const chat = { id: `t${++n}`, kind: "team", model: o.model, title: o.title, meta: { settings: o.settings } };
        chains.set(chat.id, chat);
        return chat;
      },
      teamMark: () => null,
      besideFacts: () => ({ busy: true, asking: false, last: null }),
      huntRange: (/** @type {string} */ _id, /** @type {unknown} */ spec) => (huntRange ? huntRange(spec) : resolveRange({ folder: dir, spec, rounds })),
      openingAfter: (/** @type {string} */ id, /** @type {Promise<any>} */ block) => {
        /** @type {() => void} */
        let taken = () => {};
        const took = new Promise((r) => (taken = () => r(undefined)));
        openings.set(id, { block, taken });
        return { taken: took, drop: () => void openings.delete(id) };
      },
    },
    teams: teamStore(),
    registry: () => ({ list: () => [], modelChoice: async (/** @type {string} */ name) => ({ model: name, why: "" }) }),
    postTurn: async (/** @type {string} */ chain, /** @type {any} */ body) => {
      const o = openings.get(chain);
      let content = body.content;
      if (o) {
        openings.delete(chain);
        o.taken();
        const b = await o.block;
        const at = content.findIndex((/** @type {any} */ x) => !String(x.text || "").startsWith("<main-chat"));
        if (b) content = [...content.slice(0, at), b, ...content.slice(at)];
      }
      posted.push({ chain, body: { ...body, content } });
      return { status: 200, body: {} };
    },
    reach: { busy: () => false, post: async () => ({ status: 200, body: {} }), steer: () => ({ ok: true }) },
    remove: async () => {},
    events: { publish: () => {} },
  }));
  return { beside, posted, chains };
};

// (fails before: yes — a hunt's lead read the record and the person's words, nothing of where to hunt)
describe("the lead's opening", () => {
  test("a hunt's fire puts its range between the record and the person's words: the files, their lines, how to read each diff — never the diff", async () => {
    const dir = repo();
    const v1 = git(dir, "rev-parse", "v1").slice(0, 12);
    const head = git(dir, "rev-parse", "HEAD").slice(0, 12);
    const { beside, posted, chains } = besideOver(dir);
    await beside.fire("main", { team: "bughunters", ask: "Find bugs in what changed." });
    await until(() => posted.length >= 1 && chains.get("t1").meta.beside.range, "its first turn sent, its range read");
    const content = posted[0].body.content;
    assert.deepEqual(content.map((/** @type {any} */ b) => b.text.split("\n")[0]), ["<main-chat title=\"x\" turns=\"1\">", '<hunt-range files="2">', "Find bugs in what changed."]);
    const block = content[1].text;
    assert.match(block, /What to hunt in: what is uncommitted in the chat's folder and the files this chat's turns changed — 2 files, \+4 −0 lines\. Split the hunt by these files: give each Hunter its own, a large one alone\./);
    assert.ok(block.includes("- src/b.js (+2 −0, uncommitted)") && block.includes("- c.js (+2 −0, uncommitted, new, untracked: read the file)"), block);
    assert.ok(!block.includes("@@") && !block.includes("+b2"), "no diff is pasted");
    assert.deepEqual(chains.get("t1").meta.beside.range, { kind: "chat", label: "what is uncommitted in the chat's folder and the files this chat's turns changed", files: 2 });
    await beside.fire("main", { team: "bughunters", ask: "Hunt the second commit.", range: "v1..HEAD" });
    assert.equal(posted[1].body.content[1].text, `<hunt-range files="1">\nWhat to hunt in: the commits v1..HEAD (${v1}..${head}) — 1 file, +2 −1 lines. Split the hunt by these files: give each Hunter its own, a large one alone. A file's diff: git --no-optional-locks diff ${v1}..${head} -- "<file>". No diff is pasted here: read what you need.\n\n- a.js (+2 −1)\n</hunt-range>`);
    await beside.fire("main", { team: "bughunters", ask: "Hunt these.", range: "a.js, src/b.js" });
    assert.ok(posted[2].body.content[1].text.includes(`- a.js\n- src/b.js (+2 −0, uncommitted) — git --no-optional-locks diff HEAD -- "src/b.js"`), posted[2].body.content[1].text);
  });

  test("refused at fire, in words: a range that names nothing, a ref git does not know; a team that hunts nothing, a check — and nothing starts", async () => {
    const dir = repo();
    const { beside, posted } = besideOver(dir);
    await assert.rejects(() => beside.fire("main", { team: "bughunters", ask: "x", range: "nope..v1" }), { status: 400, message: "the range cannot be hunted in: git knows no commit, tag or branch `nope` in this repository" });
    await assert.rejects(() => beside.fire("main", { team: "bughunters", ask: "x", range: "missing.js" }), { status: 400, message: "the range cannot be hunted in: the range names no file or folder in the chat's folder: `missing.js`, and git knows no commit by that name" });
    await assert.rejects(() => beside.fire("main", { team: "builders", ask: "x", range: "v1..HEAD" }), { status: 400, message: "the Builders team hunts no bugs: leave range out" });
    await assert.rejects(() => beside.fire("main", { team: "bughunters", ask: "Check these claims.", of: "t9", range: "v1..HEAD" }), { status: 400, message: "a check reads the claims it is given: leave range out" });
    assert.equal(posted.length, 0, "nothing started");
    // A team that hunts nothing carries no range; a hunt's copy keeps its lead, and hunts.
    await beside.fire("main", { team: "builders", ask: "Build it." });
    assert.deepEqual(posted[0].body.content.map((/** @type {any} */ b) => b.text.slice(0, 11)), ["<main-chat ", "Build it."]);
    assert.equal(huntsIn(teamStore().find("bughunters")), true);
    assert.equal(huntsIn(teamStore().find("builders")), false);
  });

  test("bounded: the first files listed, the rest counted with how to list them all", () => {
    const files = Array.from({ length: RANGE_LIMITS.files + 5 }, (_, i) => ({ path: `f${i}.js`, added: 1, removed: 1 }));
    const block = rangeBlock({ kind: "uncommitted", label: "what is uncommitted in the chat's folder", files, read: "A file's diff: git diff HEAD -- <file>", list: "git status" });
    const lines = block.split("\n");
    assert.equal(lines.filter((l) => l.startsWith("- f")).length, RANGE_LIMITS.files);
    assert.equal(lines.at(-2), "- and 5 more files: git status lists them all");
    assert.match(lines[1], /— 45 files, \+45 −45 lines\./);
    // The opening's order: the record, a flow's hand-off, the range, the words last.
    assert.deepEqual(openingContent({ record: "R", handoff: "H", range: "G", ask: " A " }).map((b) => b.text), ["R", "H", "G", "A"]);
    assert.deepEqual(openingContent({ record: null, ask: "A" }).map((b) => b.text), ["A"]);
  });
});

// ---------------------------------------------------------------------------------------------------
// C. The team tool's range; the Plan's hunt from its task
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — the tool took no range, and the Plan's hunt named its files in words alone)
describe("who sets the range", () => {
  test("the team tool's send takes an optional range, and says what one may name", async () => {
    const props = /** @type {any} */ (BESIDE_TOOL.input_schema.properties);
    assert.equal(props.range.type, "string");
    // What a range does for the hunt is said at the range itself (the tool plan): its lead reads its files first.
    assert.match(props.range.description, /^send, a bug hunt: what it hunts in: uncommitted, since <ref>, a commit range \(main\.\.HEAD\), or files and folders by commas; its lead reads those files, with the lines each changes, before your words\. Left out: what is uncommitted and the files this chat changed\./);
    assert.match(BESIDE_TOOL.description, /a bug hunt over recent work/);
    /** @type {any[]} */
    const fired = [];
    const at = { chain: "c1", fire: async (/** @type {any} */ i) => (fired.push(i), /** @type {any} */ ({ team: { name: "BugHunters" }, verify: false, notify: false })), list: () => [], teams: () => [] };
    const r = await besideCall({ action: "send", team: "bughunters", ask: "Hunt.", range: " main..HEAD " }, /** @type {any} */ (at));
    assert.equal(r.ok, true);
    assert.deepEqual(fired, [{ team: "bughunters", ask: "Hunt.", range: "main..HEAD" }]);
    await besideCall({ action: "send", team: "bughunters", ask: "Hunt." }, /** @type {any} */ (at));
    assert.equal("range" in fired[1], false, "none named: the default");
  });

  test("the Plan's hunt from a node: its task's files are its range, read from git into the head of the Reviewer's task", async () => {
    const t = { id: "t3", name: "Lexer", goal: "Lex it", summary: "Lexed", writes: ["src/b.js", "gone.js"], report: { files: [{ path: "src/b.js" }, { path: "c.js" }] } };
    assert.deepEqual(huntBrief(t).range, ["src/b.js", "c.js"], "the files it changed");
    assert.deepEqual(huntBrief({ ...t, report: null }).range, ["src/b.js", "gone.js"], "else the files it named");
    const dir = repo();
    /** @type {any[]} */
    const launched = [];
    const routes = sessionRoutes(/** @type {any} */ ({
      memory: { archive: { hasChain: () => true } },
      config: { get: () => ({}) },
      sessions: { huntRange: (/** @type {string} */ _id, /** @type {unknown} */ spec, /** @type {any} */ o) => resolveRange({ folder: dir, spec, label: o?.label }) },
      subagents: { launch: (/** @type {any} */ spec) => (launched.push(spec), { ok: true, id: "sa_1" }), get: () => ({ id: "sa_1" }) },
    }));
    /** @param {any} body */
    const post = async (body) => {
      const row = /** @type {any} */ (createRouter(routes)("POST", "/sessions/c1/subagents"));
      const got = { status: 0, body: /** @type {any} */ (null) };
      const res = { writableEnded: false, setHeader() {}, writeHead: (/** @type {number} */ s) => Object.assign(got, { status: s }), end: (/** @type {string} */ b) => void Object.assign(got, { body: JSON.parse(String(b)) }) };
      await row.handler({ res, params: row.params, json: async () => body, req: { headers: {} } }, {});
      return got;
    };
    const brief = huntBrief({ ...t, writes: ["src/b.js", "gone.js"], report: null });
    const ok = await post({ prompt: brief.prompt, description: brief.description, as: "reviewer", deliver: true, hunts: "t3", range: brief.range });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const prompt = String(launched[0].prompt);
    // (the review of 11-03, 7a: a Reviewer sent alone hunts the files itself — no Hunters to split them among)
    assert.ok(prompt.startsWith('<hunt-range files="2">\nWhat to hunt in: the files task t3 named and changed — 2 files, +2 −0 lines. Hunt in these files yourself, the riskiest first.'), prompt);
    assert.ok(!prompt.includes("give each Hunter"), prompt);
    assert.ok(prompt.includes(`- src/b.js (+2 −0, uncommitted) — git --no-optional-locks diff HEAD -- "src/b.js"\n- gone.js (not in the folder now)\n</hunt-range>\n\nHunt for bugs in what task t3`), prompt);
    assert.equal(launched[0].hunts, "t3");
    // (7b: a task whose files are all gone — it only deleted one — launches as it did, the gone file said so)
    const gone = await post({ prompt: "x", hunts: "t3", range: ["old.js"] });
    assert.equal(gone.status, 200, JSON.stringify(gone.body));
    assert.ok(String(launched[1].prompt).includes("- old.js (not in the folder now)\n</hunt-range>\n\nx"), String(launched[1].prompt));
    const alone = await post({ prompt: "x", range: ["a.js"] });
    assert.deepEqual([alone.status, alone.body.error], [400, "range names what a bug hunt hunts in: it goes with hunts"]);
    assert.equal(launched.length, 2, "a refusal launches nothing");
  });
});

// ---------------------------------------------------------------------------------------------------
// D. Findings merged in code: by file and nearby line, "found by N"
// ---------------------------------------------------------------------------------------------------

/** A report that ends with the fixed findings list. @param {...string} lines */
const report = (...lines) => `Subject: hunted\n\nWhat I read.\n\nFindings:\n${lines.join("\n")}`;

// (fails before: yes — the lead merged its Hunters' duplicates in its own words, counting none)
describe("findings merged by file and nearby line", () => {
  test(`one bug two Hunters report a line apart is one finding, found by 2; ${NEAR_LINES} lines apart at most, one file, a Hunter counted once`, () => {
    const m = mergeFindings([
      { by: "sa_1", text: report("- Found | null read in parse | src/parse.js:12 | reads x.y of null", "- Plausible | race on save | src/save.js:40 | two writes", "- Found | off by one | src/parse.js:30 | i <= n") },
      { by: "sa_2", text: report("- Found | parse reads null | src/parse.js:13 | x is null on an empty file", "- Found | other bug | src/parse.js:34 | four lines on: its own") },
      { by: "sa_3", text: report("- Found | save races | src/save.js:41 | seen twice", "- Not covered | the docs | - | out of the slice") },
      { by: "sa_4", text: "No list at all." },
    ]);
    assert.equal(m.workers, 3, "the reports that carried a list");
    const at = (/** @type {string} */ where) => /** @type {any} */ (m.items.find((x) => x.where === where));
    assert.deepEqual([at("src/parse.js:12").foundBy, at("src/parse.js:12").by, at("src/parse.js:12").title], [2, ["sa_1", "sa_2"], "null read in parse"], "the first's words");
    assert.deepEqual([at("src/save.js:40").kind, at("src/save.js:40").foundBy], ["found", 2], "Found and Plausible meet: the stronger kept");
    assert.deepEqual([at("src/parse.js:30").foundBy, at("src/parse.js:34").foundBy], [1, 1], "four lines apart: two bugs");
    assert.deepEqual(m.items.map((x) => x.kind), ["found", "found", "found", "found", "uncovered"], "ranked by kind, then by how many found it");
    const words = mergedWords({ role: "hunter", workers: m.workers, items: m.items });
    assert.ok(words.startsWith(`[Filament: the 3 hunter workers of this run have reported. Their findings, merged by file and nearby line — one file, ${NEAR_LINES} lines apart at most — in 5 lines, 2 of them reported by more than one ("found by N": by how many)`), words);
    assert.ok(words.includes("\nFindings:\n- Found | null read in parse | src/parse.js:12 | reads x.y of null — found by 2\n"), words);
    assert.ok(words.includes("- Found | off by one | src/parse.js:30 | i <= n\n"), "one Hunter's says no count");
  });

  test("the lead hears them merged once every Hunter of its run has reported — with the last one's report, never before", async () => {
    const w = watched();
    const l = leadOf(w.registry, w.dir);
    const brief = { role: "scout", description: "Hunt a slice", goal: "find bugs", steps: ["read"], acceptance: "a list" };
    const one = await l.tools.agent(l.call(brief));
    const two = await l.tools.agent(l.call({ ...brief, description: "Hunt another slice" }));
    assert.deepEqual([one.ok, two.ok], [true, true], `${one.text} ${two.text}`);
    const [r1, r2] = [await w.run(1), await w.run(2)];
    r1.attach();
    r2.attach();
    r1.finish({ status: "done", report: report("- Found | null read | src/a.js:10 | x is null") });
    await until(() => w.registry.get(String(one.agentId))?.status === "done", "the first to end");
    let got = /** @type {any[]} */ ([]);
    await until(() => (got = [...got, ...l.door.inbox.take()]).some((d) => d.kind === "report"), "its report");
    assert.ok(!got.some((d) => String(d.text).includes("[Filament: the 2 scout workers")), "one still hunts: no merge yet");
    r2.finish({ status: "done", report: report("- Found | a reads null | src/a.js:11 | the same bug", "- Plausible | slow loop | src/b.js:5 | maybe") });
    /** @type {any[]} */
    let last = [];
    await until(() => (last = [...last, ...l.door.inbox.take()]).some((d) => d.kind === "report"), "the second's report");
    const text = String(last.find((d) => d.kind === "report").text);
    assert.ok(text.includes("[Filament: the 2 scout workers of this run have reported."), text);
    assert.ok(text.includes("- Found | null read | src/a.js:10 | x is null — found by 2"), text);
    assert.ok(text.includes("- Plausible | slow loop | src/b.js:5 | maybe\n"), text);
  });

  test("the shipped Hunter ends its report with the list; the lead's words say Filament merges them, and the range splits the hunt", async () => {
    const t = /** @type {any} */ (teamStore().find("bughunters"));
    const hunter = t.members.find((/** @type {any} */ m) => m.tag === "hunter");
    assert.match(hunter.line, /End your report with a line that says only "Findings:" and one line per finding under it — "- Found \| <the bug, in a few words> \| <file>:<line> \| <the code that shows it, and why>"/);
    assert.ok(t.persona.includes("Asked to find bugs: split the job into slices — by the files of the range your opening names, a large one alone; else a phase, an area, a group of files —"), t.persona);
    assert.ok(t.persona.includes('Filament merges your Hunters\' findings by file and nearby line for you, "found by N" where N of them reported one.'), t.persona);
    assert.ok(t.persona.includes('A finding several Hunters reported keeps Filament\'s "found by N" at the end of its last part.'), t.persona);
    assert.ok(t.persona.includes("- Found | <the bug, in a few words> | <file>:<line> | <its evidence: which Hunter found it, how it shows, and why the Checker confirmed it> — found by <N>"), t.persona);
  });
});

// ---------------------------------------------------------------------------------------------------
// E. findingsOf reads "found by N", and merges the lead's own duplicates
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — "found by 2" stayed in a finding's note)
describe("the result's findings", () => {
  // (the review of 11-03, 2: this test's pins moved — the lead's own list was merged by file and nearby line, so two
  // bugs two lines apart, or two claims a line apart, became one; a list is its writer's own)
  test("found by N read into a field, apart from the note; each line of the lead's list a finding of its own, however near another", () => {
    const text = report(
      "- Found | null read in parse | src/parse.js:12 | reads x.y of null — found by 2",
      "- Found | parse reads null again | src/parse.js:14 | the same, said again (found by 3 Hunters)",
      "- Found | off by one | src/parse.js:30 | i <= n",
      "- Dismissed | a race | src/save.js:40 | not one",
      "- Dismissed | another race | src/save.js:41 | not one either",
    );
    const f = /** @type {any} */ (findingsOf(text));
    assert.deepEqual(f.items, [
      { kind: "found", title: "null read in parse", where: "src/parse.js:12", note: "reads x.y of null", foundBy: 2 },
      { kind: "found", title: "parse reads null again", where: "src/parse.js:14", note: "the same, said again", foundBy: 3 },
      { kind: "found", title: "off by one", where: "src/parse.js:30", note: "i <= n" },
      { kind: "dismissed", title: "a race", where: "src/save.js:40", note: "not one" },
      { kind: "dismissed", title: "another race", where: "src/save.js:41", note: "not one either" },
    ]);
    assert.deepEqual([f.counts.found, f.counts.dismissed], [3, 2]);
    assert.equal(resultSubject({ ask: "x", result: text }), "5 findings: 3 found, 2 dismissed", "the hand-off's subject counts each line");
    // A check's two claims a line apart keep two verdicts.
    const claims = /** @type {any} */ (findingsOf(report("- Confirmed | claim 1 | a.js:10 | holds", "- Confirmed | claim 2 | a.js:11 | holds too")));
    assert.deepEqual(claims.items.map((/** @type {any} */ x) => x.title), ["claim 1", "claim 2"]);
    // A Found and a Dismissed at one line are two claims; one with no line merges with none.
    const two = /** @type {any} */ (findingsOf(report("- Found | a | x.js:3 | y", "- Dismissed | b | x.js:3 | z", "- Not covered | docs | - | later", "- Not covered | tests | - | later")));
    assert.equal(two.items.length, 4);
  });

  test("the page's mark of confidence: ×N beside one that N Hunters found, none beside one", () => {
    assert.deepEqual(foundByMark({ kind: "found", title: "a", where: "", note: "", foundBy: 3 }), { text: "×3", title: "Found by 3 Hunters on their own" });
    assert.equal(foundByMark({ kind: "found", title: "a", where: "", note: "" }), null);
  });
});

// ---------------------------------------------------------------------------------------------------
// F. The Brief's range
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — the Brief had no range)
describe("where a person sets it", () => {
  test("the Brief: a range for a hunt on the side, its words plain, goes with Send, and nothing else changes; no total for the run", async () => {
    const BUGHUNTERS = { key: "bughunters", name: "BugHunters", line: "Finds bugs", shipped: true, readOnly: true, models: [], lead: { tag: "huntlead", name: "BugHunters" }, members: [{ tag: "hunter", card: "reviewer", name: "Hunter", may: "read", place: "reviewer" }] };
    const BUILDERS = { key: "builders", name: "Builders", line: "Builds", shipped: true, readOnly: false, models: [], lead: { tag: "buildlead", name: "Builders" }, members: [{ tag: "builder", name: "Builder", may: "edit", place: "builder" }] };
    /** @type {any[]} */
    const fired = [];
    /** @type {any[]} */
    const handed = [];
    const io = {
      teams: () => [BUGHUNTERS, BUILDERS],
      chat: () => ({ title: "t", model: "m-1", live: false, round: null, paused: false, workersAtWork: false, tokens: 0, compactions: 0, turns: 1, cost: null }),
      models: () => [],
      seats: () => [],
      reads: async () => null,
      preview: async () => null,
      runsOn: async () => null,
      fire: async (/** @type {any} */ b) => (fired.push(b), true),
      handOver: async (/** @type {any} */ o) => (handed.push(o), "now"),
      stopTurn: () => {},
    };
    const kept = new Map();
    const place = (/** @type {any} */ p, /** @type {any[]} */ k) => p.replaceChildren(...k);
    const sheet = (/** @type {any} */ o) => ({ el: fakeH("div", {}, o.head, o.body, o.foot), close() {} });
    const picker = () => ({ el: fakeH("span", {}), set() {}, setModels() {}, setFamilies() {}, setAccounts() {}, setNote() {} });
    const open = (/** @type {any} */ fill) => openBrief(/** @type {any} */ (io), fill, { h: fakeH, place, sheet, modelSelect: /** @type {any} */ (picker), menu: /** @type {any} */ (() => {}), store: { get: (k) => kept.get(k) ?? null, set: (k, v) => void kept.set(k, v) } });
    const labelled = (/** @type {any} */ n, /** @type {string} */ label) => all(n, (x) => x.attrs?.["aria-label"] === label)[0];
    const rangeRow = (/** @type {any} */ b) => all(b.el, (x) => String(x.attrs?.class || "").split(/\s+/).includes("br-range"))[0];
    const b = open({ team: "bughunters", ask: "Find bugs" });
    assert.equal(rangeRow(b).classList.contains("hidden"), false, "a hunt on the side names its range");
    assert.equal(labelled(b.el, "What to hunt in").attrs.placeholder, RANGE_WORDS.hint);
    assert.ok(textOf(rangeRow(b)).includes(RANGE_WORDS.line));
    type(labelled(b.el, "What to hunt in"), "main..HEAD");
    // (fails before: yes — the owner's word of 11-05: "Crew in one run: drop both")
    assert.equal(labelled(b.el, "How many workers its lead launches in all this run"), undefined, "no total for the run");
    /** @type {any} */ (btn(b.el, "Send")).dispatch("click");
    await settle();
    assert.deepEqual([fired[0].range, "total" in fired[0], "most" in fired[0]], ["main..HEAD", false, false]);
    // A check of a result names no range; a team that hunts nothing shows none; empty fields add nothing to Send.
    const check = open({ team: "bughunters", ask: "Check", of: "t9" });
    assert.equal(rangeRow(check).classList.contains("hidden"), true);
    const build = open({ team: "builders", ask: "Build" });
    assert.equal(rangeRow(build).classList.contains("hidden"), true);
    // A team that builds goes in charge by default: its hand-over takes no number either.
    /** @type {any} */ (btn(build.el, "Send")).dispatch("click");
    await settle();
    assert.equal("total" in handed[0] || "most" in handed[0], false, JSON.stringify(handed[0]));
    const side = open({ team: "bughunters", ask: "Find bugs" });
    /** @type {any} */ (btn(side.el, "Send")).dispatch("click");
    await settle();
    assert.equal("range" in fired[1], false, JSON.stringify(fired[1]));
  });
});

// ---------------------------------------------------------------------------------------------------
// G. Old saved teams and settings load without the dropped fields
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — the owner's word of 11-05: "Crew at once and Crew in one run: drop both"; a team's most and total
// were kept and read)
describe("what was saved before", () => {
  test("a teams file whose teams name a most and a total loads with neither, and a save leaves them out; no chat's setting holds them", () => {
    const dir = folder();
    writeFileSync(join(dir, TEAMS_FILE), JSON.stringify({ version: 2, teams: { mine: { name: "Mine", lead: "huntlead", members: [{ tag: "reviewer", name: "Hunter", line: "Hunt." }], most: 3, total: 6 } }, shipped: { bughunters: { most: 4, total: 12 } } }));
    const store = teamStore({ dataDir: dir });
    const read = (/** @type {any} */ t) => [t?.most, t?.total];
    assert.deepEqual([read(store.find("mine")), read(store.find("bughunters"))], [[undefined, undefined], [undefined, undefined]]);
    assert.ok(store.held().every((h) => h.key !== "bughunters"), "a shipped team's old numbers hold nothing back");
    store.update("mine", { name: "Mine" });
    const kept = JSON.parse(readFileSync(join(dir, TEAMS_FILE), "utf8")).teams.mine;
    assert.deepEqual(["most" in kept, "total" in kept], [false, false]);
    assert.deepEqual([KNOBS["engine.teamTotal"], KNOBS["engine.teamMost"], KNOBS["subagents.most"]], [undefined, undefined, undefined]);
  });
});

// ---------------------------------------------------------------------------------------------------
// H. The review of 11-03: the defects a read-only review found in the piece above (10 went with the total per run)
// ---------------------------------------------------------------------------------------------------

describe("the review of 11-03", () => {
  // (fails before: yes — every untracked file up to 2 MB was read, with no cap on how many, on the server's thread)
  test("1. untracked files: the first 500 counted, each up to 512 KB, read asynchronously; the rest listed with no count", async () => {
    const dir = repo();
    mkdirSync(join(dir, "gen"));
    for (let i = 0; i < 505; i++) writeFileSync(join(dir, "gen", `f${String(i).padStart(3, "0")}.txt`), "one\ntwo\n");
    writeFileSync(join(dir, "big.txt"), "x\n".repeat(300_000));
    const r = /** @type {any} */ (await resolveRange({ folder: dir, spec: "uncommitted" }));
    const fresh = r.range.files.filter((/** @type {any} */ f) => f.note === "new, untracked: read the file");
    assert.equal(fresh.length, 507, "every untracked file is listed");
    assert.equal(fresh.filter((/** @type {any} */ f) => f.added != null).length, 499, "500 read, the one past 512 KB among them uncounted");
    assert.deepEqual(fresh.find((/** @type {any} */ f) => f.path === "big.txt"), { path: "big.txt", added: null, removed: null, note: "new, untracked: read the file" });
    assert.deepEqual(fresh.slice(500).map((/** @type {any} */ f) => f.added), Array(7).fill(null));
    // Nothing of it holds the thread: a timer set as it starts fires before it ends.
    let ticked = false;
    setTimeout(() => (ticked = true), 0);
    await resolveRange({ folder: dir, spec: "uncommitted" });
    assert.equal(ticked, true);
  });

  // (fails before: yes — two bugs two lines apart in one worker's list became one; so did a check's two claims)
  test("2. a worker's own list is never merged within: only lists of different workers meet", () => {
    const m = mergeFindings([{ by: "sa_1", text: report("- Found | off-by-one | a.js:10 | i <= n", "- Found | null deref | a.js:12 | x.y") }, { by: "sa_2", text: report("- Found | the null | a.js:12 | x is null") }]);
    // The other worker's a.js:12 meets the nearest of the two: the null deref.
    assert.deepEqual(m.items.map((x) => [x.title, x.foundBy]), [["null deref", 2], ["off-by-one", 1]]);
    const lone = mergeFindings([{ by: "sa_1", text: report("- Found | off-by-one | a.js:10 | i <= n", "- Found | null deref | a.js:12 | x.y") }]);
    assert.deepEqual(lone.items.map((x) => x.title), ["off-by-one", "null deref"]);
  });

  // (fails before: yes — `a.js`, `src/a.js` and `lib/a.js` folded into one by their tails, and `Foo.js` met `foo.js`)
  test("3. one file is the same path as written: slashes, a leading ./ and a path inside the folder made one; a bare name, a tail and case are not", () => {
    const merged = (/** @type {string[]} */ ...where) => mergeFindings(where.map((w, i) => ({ by: `sa_${i}`, text: report(`- Found | bug ${i} | ${w} | x`) })), { roots: ["H:/work/repo"] }).items.map((x) => x.foundBy);
    assert.deepEqual(merged("a.js:10", "src/a.js:11", "lib/a.js:12"), [1, 1, 1]);
    assert.deepEqual(merged("Foo.js:5", "foo.js:5"), [1, 1]);
    assert.deepEqual(merged("./src\\a.js:10", "src/a.js:11"), [2]);
    assert.deepEqual(merged("H:\\work\\repo\\src\\a.js:10", "src/a.js:12"), [2]);
    assert.deepEqual(merged("h:/work/repo/src/a.js:10", "src/a.js:12"), [2], "a drive letter in either case");
    assert.equal(spotOf("Foo.js:3")?.file, "Foo.js");
  });

  // (fails before: yes — nothing marked a batch merged, so each later report of a batch's worker sent the whole list
  // again, and a followed-up Hunter whose answer held no list dropped what it had found)
  test("4. a batch's merged list goes once; a follow-up's report goes as itself; a worker's findings are its newest list; a later wave is its own", async () => {
    const w = watched();
    const l = leadOf(w.registry, w.dir);
    const brief = { role: "scout", description: "Hunt A", goal: "find bugs", steps: ["read"], acceptance: "a list" };
    /** @type {any[]} */
    let got = [];
    const take = async (/** @type {string} */ what) => {
      got = [];
      await until(() => (got = [...got, ...l.door.inbox.take()]).some((d) => d.kind === "report"), what);
      return String(got.find((d) => d.kind === "report").text);
    };
    const a = await l.tools.agent(l.call(brief));
    const b = await l.tools.agent(l.call({ ...brief, description: "Hunt B" }));
    const [ra, rb] = [await w.run(1), await w.run(2)];
    ra.attach();
    rb.attach();
    ra.finish({ status: "done", report: report("- Found | null read | a.js:10 | x is null") });
    assert.ok(!(await take("A's report")).includes("[Filament: the 2 scout workers"));
    // A is followed up, and answers with no list: what it found before stands for it.
    assert.equal((await l.tools.worker(l.call({ agent_id: a.agentId, prompt: "Anything else?" }))).ok, true);
    const ra2 = await w.run(3);
    ra2.attach();
    ra2.finish({ status: "done", report: "Nothing else: the list above stands." });
    assert.ok(!(await take("A's second report")).includes("[Filament: the 2 scout workers"), "B still hunts");
    rb.finish({ status: "done", report: report("- Found | a.js reads null | a.js:11 | the same bug") });
    const merged = await take("B's report");
    assert.ok(merged.includes("- Found | null read | a.js:10 | x is null — found by 2"), merged);
    // After the batch: a follow-up's report is itself alone.
    await l.tools.worker(l.call({ agent_id: b.agentId, prompt: "Look again." }));
    const rb2 = await w.run(4);
    rb2.attach();
    rb2.finish({ status: "done", report: report("- Found | a.js reads null | a.js:11 | still there") });
    assert.ok(!(await take("B's follow-up")).includes("[Filament: the 2 scout workers"), "the merged list is not sent again");
    // A second wave is a batch of its own: its list holds its own findings alone.
    await l.tools.agent(l.call({ ...brief, description: "Hunt C" }));
    await l.tools.agent(l.call({ ...brief, description: "Hunt D" }));
    const [rc, rd] = [await w.run(5), await w.run(6)];
    rc.attach();
    rd.attach();
    rc.finish({ status: "done", report: report("- Found | c breaks | c.js:1 | c") });
    await take("C's report");
    rd.finish({ status: "done", report: report("- Found | c breaks too | c.js:2 | c") });
    const second = await take("D's report");
    assert.ok(second.includes("[Filament: the 2 scout workers") && second.includes("c.js:1 | c — found by 2") && !second.includes("a.js"), second);
  });

  // (fails before: yes — any role's lists were merged: two Checkers' verdicts on one claim came back "found by 2")
  test("5. only hunts' lists are merged: a check's verdicts never are", () => {
    const checks = mergeFindings([{ by: "sa_1", text: report("- Confirmed | the null | a.js:10 | holds") }, { by: "sa_2", text: report("- Confirmed | the null | a.js:10 | holds"), }]);
    assert.deepEqual([checks.workers, checks.items.length], [0, 0]);
    const mixed = mergeFindings([{ by: "sa_1", text: report("- Found | the null | a.js:10 | x") }, { by: "sa_2", text: report("- Dismissed | the null | a.js:10 | no") }, { by: "sa_3", text: report("- Not covered | docs | - | later") }]);
    assert.equal(mixed.workers, 2, "a hunt's list holds Found, Plausible and Not covered");
  });

  // (fails before: yes — the page showed a hunt's range, and its list of files, as the person's words)
  test("6. a hunt's range is never shown as the person's words in its team's chat", () => {
    const [t] = transcriptTurns({ turns: [{ n: 1, requestIds: [], record: true, range: true, user: { role: "user", content: [{ type: "text", text: "<main-chat title=\"x\">…</main-chat>" }, { type: "text", text: '<hunt-range files="1">\nWhat to hunt in: …\n</hunt-range>' }, { type: "text", text: "Find bugs." }] }, final: { role: "assistant", content: [{ type: "text", text: "Done." }] } }] });
    assert.equal(/** @type {any} */ (t).userText, "Find bugs.");
  });

  // (fails before: yes — a path outside the repository went to git with the rest, git refused them all, and every
  // uncommitted count read none)
  test("8. a path outside the repository is listed as such, never handed to git, and the others keep their counts; so does a path in a submodule", async () => {
    const dir = repo();
    const out = folder("filament-hunt-out-");
    writeFileSync(join(out, "x.js"), "x\n");
    const r = /** @type {any} */ (await resolveRange({ folder: dir, spec: `src/b.js, ${join(out, "x.js")}, ../${out.split(/[\\/]/).pop()}/x.js` }));
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.range.files.find((/** @type {any} */ f) => f.path === "src/b.js"), { path: "src/b.js", added: 2, removed: 0, note: "uncommitted", read: `git --no-optional-locks diff HEAD -- "src/b.js"` });
    assert.deepEqual(r.range.files.filter((/** @type {any} */ f) => f.note === "outside the repository: read the file").length, 2);
    // A submodule's file: listed, its parent's counts kept.
    const sub = repo();
    git(dir, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub.replace(/\\/g, "/"), "sub");
    writeFileSync(join(dir, "sub", "a.js"), "changed in the submodule\n");
    const s = /** @type {any} */ (await resolveRange({ folder: dir, spec: "sub/a.js, src/b.js" }));
    assert.equal(s.ok, true, s.error);
    assert.deepEqual(s.range.files.map((/** @type {any} */ f) => [f.path, f.added]), [["sub/a.js", null], ["src/b.js", 2]]);
  });

  // (fails before: yes — a suggested command named a path bare, refreshed the index, cut the empty tree's id short, and
  // a ref git reads with braces went into it as it was written)
  test("9. suggested commands: paths in double quotes, no index refresh, commits by their ids; words may quote a path with spaces", async () => {
    assert.deepEqual(parseRange(`"my file.js", 'other one.js' plain.js`), { kind: "words", words: ["my file.js", "other one.js", "plain.js"] });
    const dir = repo();
    writeFileSync(join(dir, "my file.js"), "spaced\n");
    git(dir, "add", "my file.js");
    const r = /** @type {any} */ (await resolveRange({ folder: dir, spec: `"my file.js"` }));
    assert.deepEqual(r.range.files, [{ path: "my file.js", added: 1, removed: 0, note: "uncommitted", read: `git --no-optional-locks diff HEAD -- "my file.js"` }]);
    // A ref with braces resolves to the commit it is, and the commands name that.
    const prev = git(dir, "rev-parse", "HEAD@{1}").slice(0, 12);
    const span = /** @type {any} */ (await resolveRange({ folder: dir, spec: "HEAD@{1}..HEAD" }));
    assert.ok(!span.range.read.includes("{") && !span.range.list.includes("{") && span.range.read.includes(`${prev}..`), span.range.read);
    // A file the chat made in a repository with no commit before it: read from the empty tree, by its whole id.
    const bare = folder();
    git(bare, "init", "-q");
    writeFileSync(join(bare, "first.js"), "first\n");
    const s = await snapshotTree(bare, { name: "c1/1-1" });
    const place = git(bare, "rev-parse", "--show-toplevel");
    const c = /** @type {any} */ (await resolveRange({ folder: bare, spec: null, rounds: /** @type {any[]} */ ([{ place, round: 1, turn: 1, agent: "", before: null, after: String(s.commit), base: "round", own: ["first.js"], command: false }]) }));
    assert.equal(c.range.files.find((/** @type {any} */ f) => f.path === "first.js").read, `git --no-optional-locks diff ${EMPTY_TREE} -- "first.js"`);
  });

  // (fails before: yes — the fire waited for every round of the chat to be read before it answered)
  test("11. the default range is read as the lead starts: the fire answers first, and the lead's first message waits for it; a chat's newest rounds alone are read", async () => {
    const dir = repo();
    /** @type {(v: any) => void} */
    let give = () => {};
    const slow = new Promise((r) => (give = r));
    const { beside, posted, chains } = besideOver(dir, [], (spec) => (spec == null ? slow : resolveRange({ folder: dir, spec })));
    const row = await beside.fire("main", { team: "bughunters", ask: "Find bugs." });
    assert.equal(row.team.key, "bughunters");
    assert.equal(posted.length, 0, "its first message waits for its range");
    give(await resolveRange({ folder: dir, spec: null }));
    await until(() => posted.length === 1, "its first message sent");
    assert.match(posted[0].body.content[1].text, /^<hunt-range files="2">/);
    assert.equal(chains.get("t1").meta.beside.range.files, 2);
    // The chat's newest CHAT_ROUNDS writing rounds are read; the older ones are said left out.
    const rounds = Array.from({ length: CHAT_ROUNDS + 5 }, (_, i) => ({ place: "", round: 1, turn: i + 1, agent: "", before: null, after: null, base: "none", own: [join(dir, `w${i}.js`)], command: false }));
    const r = /** @type {any} */ (await resolveRange({ folder: dir, spec: null, rounds: /** @type {any[]} */ (rounds) }));
    assert.match(r.range.label, new RegExp(`the files this chat's turns changed from turn 6 on \\(its 5 older writing rounds left out\\)$`));
    assert.equal(r.range.files.filter((/** @type {any} */ f) => f.note?.startsWith("this chat changed it, outside")).length, CHAT_ROUNDS);
  });
});

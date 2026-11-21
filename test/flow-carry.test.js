// @ts-check
// Bring my uncommitted edits (HarnessV4_OneAgent_Plan OA5; the owner's Phase 7): a flow's worktree starts at its folder's
// last commit, so the folder's uncommitted files stay there — the draft says how many — unless the person switches the
// choice on, off by default: then the new worktree is given a copy of them, uncommitted, and the folder keeps its own.
// Against real repositories under the system's temp folder: what the worktree gets (changed, added, deleted and
// untracked files, nothing git ignores, no embedded repository), no commit on its branch past its start, the folder byte
// for byte as it was; teams beside and the flow's runner asking for it only where the person did; the words the flow's
// card and its main agent read.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bringUncommitted } from "../src/adapters/git/carry.js";
import { leftBehind, ownWorktree } from "../src/adapters/git/places.js";
import { createTeamsBeside } from "../src/app/teams-beside.js";
import { createFlowRunner } from "../src/app/flow-runner.js";
import { createFlowStore } from "../src/services/flow-store.js";
import { SHIPPED_CARDS } from "../src/services/agent-cards.js";
import { OWN_CARDS } from "./helpers/flow-cards.js";
import { SHIPPED_TEAMS } from "../src/services/teams.js";
import { worksIn } from "../src/core/flow.js";
import { flowRoutes } from "../src/http/admin/flows.js";
import { createRouter } from "../src/http/router.js";
import { BRING_WORDS, bringNote, createFlowList, worksWords } from "../src/ui/harness/lib/flow.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made.reverse()) rmSync(d, { recursive: true, force: true });
});
/** @param {string} cwd @param {string[]} args */
const run = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", windowsHide: true }).trim();
const fresh = () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "filament-bring-")));
  made.push(dir);
  return dir;
};
/** `git status` one line a file, untracked ones by their own names: its first column kept, a space where clean. @param {string} dir */
const status = (dir) => execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: dir, encoding: "utf8", windowsHide: true }).split("\n").filter(Boolean).sort();
/** Every file under a folder but its `.git`, by its path, with its bytes. @param {string} top */
const filesOf = (top) => {
  /** @type {Record<string, string>} */
  const out = {};
  /** @param {string} rel */
  const walk = (rel) => {
    for (const e of readdirSync(join(top, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (p === ".git") continue;
      if (e.isDirectory()) walk(p);
      else out[p] = readFileSync(join(top, p)).toString("base64");
    }
  };
  walk("");
  return out;
};

/**
 * A repository with a committed tree, then everything a folder may hold uncommitted: a changed file, a change staged, a
 * new file staged, an untracked one in a new folder, a deleted one, two that git ignores, and an embedded repository.
 */
const dirtyRepo = () => {
  const base = fresh();
  const r = join(base, "repo");
  mkdirSync(join(r, "sub"), { recursive: true });
  run(r, "init", "-q", "-b", "main");
  run(r, "config", "core.autocrlf", "false");
  writeFileSync(join(r, ".gitignore"), "*.log\nbuild/\n");
  writeFileSync(join(r, "a.txt"), "one\n");
  writeFileSync(join(r, "b.txt"), "bee\n");
  writeFileSync(join(r, "gone.txt"), "going\n");
  writeFileSync(join(r, "sub", "c.txt"), "sea\n");
  run(r, "add", "-A");
  run(r, "commit", "-qm", "init");
  writeFileSync(join(r, "a.txt"), "one\ntwo\n");
  writeFileSync(join(r, "b.txt"), "bee\nstaged\n");
  run(r, "add", "b.txt");
  writeFileSync(join(r, "staged.txt"), "new and staged\n");
  run(r, "add", "staged.txt");
  mkdirSync(join(r, "sub", "deep"), { recursive: true });
  writeFileSync(join(r, "sub", "deep", "new.txt"), "untracked\n");
  rmSync(join(r, "gone.txt"));
  writeFileSync(join(r, "debug.log"), "ignored\n");
  mkdirSync(join(r, "build"));
  writeFileSync(join(r, "build", "out.js"), "ignored too\n");
  return { base, r };
};

describe("a new worktree given the folder's uncommitted files (carry.js bringUncommitted)", () => {
  // (fails before: yes — nothing brought them: a flow's worktree had the last commit alone)
  test("exactly the folder's uncommitted state, uncommitted; nothing git ignores; no commit on its branch; the folder byte for byte as it was", async () => {
    const { r } = dirtyRepo();
    const before = { files: filesOf(r), index: readFileSync(join(r, ".git", "index")).toString("base64"), status: status(r), refs: run(r, "for-each-ref", "--format=%(refname)"), head: run(r, "rev-parse", "HEAD") };
    assert.deepEqual(await leftBehind(r), { ok: true, count: 5 }, "a.txt, b.txt, gone.txt, staged.txt, sub/deep/new.txt: what git ignores is no file left behind");
    const got = await ownWorktree(r, "flow-x");
    assert.ok(got.ok, JSON.stringify(got));
    const wt = /** @type {any} */ (got);
    const out = await bringUncommitted(wt.place, wt.folder, wt.commit);
    assert.deepEqual(out, { ok: true, files: ["a.txt", "b.txt", "gone.txt", "staged.txt", "sub/deep/new.txt"], stays: [] });
    // Each file as it stands in the folder; the deleted one gone; nothing ignored.
    for (const p of ["a.txt", "b.txt", "staged.txt", "sub/deep/new.txt", "sub/c.txt", ".gitignore"]) assert.equal(readFileSync(join(wt.folder, p), "utf8"), readFileSync(join(r, p), "utf8"), p);
    assert.equal(existsSync(join(wt.folder, "gone.txt")), false);
    assert.equal(existsSync(join(wt.folder, "debug.log")), false, "an ignored file is not brought");
    assert.equal(existsSync(join(wt.folder, "build")), false, "nor an ignored folder");
    // Uncommitted there, nothing staged: what the folder staged comes out unstaged.
    assert.deepEqual(status(wt.folder), [" D gone.txt", " M a.txt", " M b.txt", "?? staged.txt", "?? sub/deep/new.txt"]);
    assert.equal(run(wt.folder, "diff", "--cached", "--name-only"), "", "its index stays at its commit");
    // No commit: the branch and the worktree stand at the folder's last commit.
    assert.equal(run(r, "rev-parse", "flow-x"), before.head);
    assert.equal(run(wt.folder, "rev-parse", "HEAD"), before.head);
    // The folder: its files, its index, its status as they were; one ref more, the new branch, and no other.
    assert.deepEqual(filesOf(r), before.files);
    assert.equal(readFileSync(join(r, ".git", "index")).toString("base64"), before.index, "its index byte for byte");
    assert.deepEqual(status(r), before.status);
    assert.equal(run(r, "rev-parse", "HEAD"), before.head);
    assert.deepEqual(run(r, "for-each-ref", "--format=%(refname)").split("\n").sort(), [...before.refs.split("\n"), "refs/heads/flow-x"].sort());
  });

  test("a clean folder: nothing to bring, nothing left behind; outside git none is counted", async () => {
    const base = fresh();
    const r = join(base, "clean");
    mkdirSync(r);
    run(r, "init", "-q", "-b", "main");
    writeFileSync(join(r, "a.txt"), "one\n");
    run(r, "add", "-A");
    run(r, "commit", "-qm", "init");
    assert.deepEqual(await leftBehind(r), { ok: true, count: 0 });
    const got = /** @type {any} */ (await ownWorktree(r, "flow-clean"));
    assert.ok(got.ok);
    assert.deepEqual(await bringUncommitted(got.place, got.folder, got.commit), { ok: true, files: [], stays: [] });
    assert.deepEqual(status(got.folder), []);
    const plain = join(base, "plain");
    mkdirSync(plain);
    assert.deepEqual(await leftBehind(plain), { ok: true, count: null }, "no repository: no worktree would be made");
    const empty = join(base, "empty");
    mkdirSync(empty);
    run(empty, "init", "-q", "-b", "main");
    writeFileSync(join(empty, "a.txt"), "one\n");
    assert.deepEqual(await leftBehind(empty), { ok: true, count: null }, "no commit yet: no worktree would be made");
  });

  test("an embedded repository stays, named: plain files alone are carried, as a move carries them", async () => {
    const { r } = dirtyRepo();
    const nested = join(r, "nested");
    mkdirSync(nested);
    run(nested, "init", "-q", "-b", "main");
    writeFileSync(join(nested, "n.txt"), "nested\n");
    run(nested, "add", "-A");
    run(nested, "commit", "-qm", "nested");
    const got = /** @type {any} */ (await ownWorktree(r, "flow-n"));
    assert.ok(got.ok);
    const out = /** @type {any} */ (await bringUncommitted(got.place, got.folder, got.commit));
    assert.equal(out.ok, true, String(out.error));
    assert.deepEqual(out.stays, ["nested"]);
    assert.equal(out.files.includes("a.txt"), true);
    assert.equal(existsSync(join(got.folder, "nested")), false, "nothing of it is written");
  });

  // (fails before: yes — the files were written before the deleted ones went: the file `foo` was unlinked where it had
  // become a folder, which threw, and on a disk that ignores case `Name.txt` deleted the `name.txt` just written)
  test("a file that became a folder, and a name whose case alone changed, come across", async () => {
    const base = fresh();
    const r = join(base, "repo");
    mkdirSync(r);
    run(r, "init", "-q", "-b", "main");
    run(r, "config", "core.autocrlf", "false");
    writeFileSync(join(r, "foo"), "a file\n");
    writeFileSync(join(r, "Name.txt"), "named\n");
    run(r, "add", "-A");
    run(r, "commit", "-qm", "init");
    rmSync(join(r, "foo"));
    mkdirSync(join(r, "foo"));
    writeFileSync(join(r, "foo", "x.txt"), "in a folder now\n");
    run(r, "mv", "Name.txt", "name.txt");
    const got = /** @type {any} */ (await ownWorktree(r, "flow-swap"));
    assert.ok(got.ok);
    const out = /** @type {any} */ (await bringUncommitted(got.place, got.folder, got.commit));
    assert.equal(out.ok, true, String(out.error));
    assert.equal(readFileSync(join(got.folder, "foo", "x.txt"), "utf8"), "in a folder now\n");
    assert.equal(readdirSync(got.folder).includes("name.txt"), true, readdirSync(got.folder).join(", "));
    assert.equal(readdirSync(got.folder).includes("Name.txt"), false, "the old name is gone");
    assert.equal(readFileSync(join(got.folder, "name.txt"), "utf8"), "named\n");
  });
});

/**
 * Teams beside over fakes, as flow-parts.test.js holds them: chats made, turns posted, places asked — each in `order`,
 * the places' own list. @param {any} places
 */
function besideWorld(places) {
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", kind: "harness", meta: {} }]]);
  /** @type {string[]} */
  const order = places.order;
  let n = 0;
  const teamsList = Object.entries(SHIPPED_TEAMS).map(([key, t]) => ({ key, name: t.name, readOnly: /** @type {any} */ (t).readOnly === true, models: [], leadModels: [], leadModel: null, lead: { tag: t.lead, name: t.name }, most: null, fired: { notify: false, verify: false } }));
  const archive = {
    getChain: (/** @type {string} */ id) => chains.get(id) || null,
    mergeMeta: (/** @type {string} */ id, /** @type {any} */ patch) => Object.assign(chains.get(id).meta, patch),
    mainOf: (/** @type {string} */ id) => chains.get(id)?.beside || null,
    besideOf: (/** @type {string} */ main) => [...chains.values()].filter((c) => c.beside === main).map((c) => c.id),
  };
  const beside = createTeamsBeside({
    archive: () => archive,
    sessions: {
      launchInfo: () => ({ cwd: "H:/repo", model: "m-1", full: "m-1" }),
      settingsOf: () => ({ effective: { subagents: {} }, sources: {} }),
      recordFor: async () => "<main-chat>the record</main-chat>",
      create: (/** @type {any} */ o) => {
        const id = `t${++n}`;
        order.push(`chat ${id}`);
        chains.set(id, { id, kind: "team", beside: o.beside, cwd: o.cwd, meta: {} });
        return { id };
      },
      besideFacts: () => ({ busy: true, asking: false, turns: 1, last: null }),
      teamMark: (/** @type {string} */ _main, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
      cancelTurn: () => false,
    },
    teams: /** @type {any} */ ({ find: (/** @type {unknown} */ k) => teamsList.find((t) => t.key === String(k ?? "")) || null, list: () => teamsList }),
    registry: () => ({ list: () => [], modelChoice: async (/** @type {string} */ name) => ({ model: name, why: "" }), cardModels: () => [] }),
    postTurn: async (chain) => {
      order.push(`turn ${chain}`);
      return { status: 200, body: null };
    },
    reach: { busy: () => false, post: async () => ({ status: 200, body: null }), steer: () => ({ ok: false }) },
    remove: async () => {},
    events: { publish: () => {} },
    now: () => 0,
    settleMs: 0,
    places,
  });
  return { beside, chains, order };
}

describe("teams beside bring the edits where the flow's fire asks (OA5)", () => {
  const MADE = { ok: true, name: "flow-x", branch: "flow-x", folder: "H:/repo-flow-x", cwd: "H:/repo-flow-x", main: "H:/repo", place: "H:/repo", commit: "abc123" };
  // (the plan's p6) Builders builds it: it does the four build teams' work.
  const FIRE = { team: "builders", ask: "Your part: Build it.", by: "flow", flow: { id: "f1", box: "build" } };
  /** @param {any} answer  what `bring` answers */
  const placesOf = (answer) => {
    const p = {
      /** @type {any[]} */ brought: [],
      /** @type {string[]} */ back: [],
      /** @type {string[]} */ order: [],
      own: async () => MADE,
      bring: async (/** @type {any} */ m) => {
        p.brought.push([m.place, m.folder, m.commit]);
        p.order.push("brought");
        return answer;
      },
      takeBack: async (/** @type {any} */ m) => {
        p.back.push(m.folder);
        return null;
      },
    };
    return p;
  };

  // (fails before: yes — `bring` was never asked, and the place said nothing of it)
  test("asked: the folder's uncommitted files copied in before its chat is made and its lead starts, said on its place", async () => {
    const places = placesOf({ ok: true, files: ["a.txt", "new.txt"], stays: [] });
    const w = besideWorld(places);
    const row = await w.beside.fire("c1", { ...FIRE, own: { name: "flow-x", bring: true } });
    assert.deepEqual(places.brought, [["H:/repo", "H:/repo-flow-x", "abc123"]], "from the place it was made from, at the commit it was made at");
    assert.deepEqual(w.order, ["brought", "chat t1", "turn t1"], "before its chat is made and its lead reads a file");
    assert.deepEqual(row.place, { kind: "worktree", name: "flow-x", branch: "flow-x", folder: "H:/repo-flow-x", cwd: "H:/repo-flow-x", brought: { files: 2, stays: [] } });
    assert.deepEqual(w.chains.get(row.id).meta.beside.place.brought, { files: 2, stays: [] }, "kept with it");
  });

  test("not asked — the default — nothing is brought; a box after the first, in the flow's worktree, brings nothing", async () => {
    const places = placesOf({ ok: true, files: ["a.txt"], stays: [] });
    const w = besideWorld(places);
    const row = await w.beside.fire("c1", { ...FIRE, own: { name: "flow-x" } });
    assert.deepEqual(places.brought, []);
    assert.equal("brought" in /** @type {any} */ (row.place), false);
    await w.beside.fire("c1", { ...FIRE, own: { use: { kind: "worktree", name: "flow-x", branch: "flow-x", folder: "H:/repo-flow-x", cwd: "H:/repo-flow-x" }, bring: true } });
    assert.deepEqual(places.brought, [], "a worktree in use is given nothing again");
  });

  test("a copy that fails takes the worktree back and refuses the fire in words: no chat, no turn", async () => {
    const places = placesOf({ ok: false, error: "git restore exited 128" });
    const w = besideWorld(places);
    await assert.rejects(w.beside.fire("c1", { ...FIRE, own: { name: "flow-x", bring: true } }), /your uncommitted edits could not be brought into its worktree: git restore exited 128/);
    assert.deepEqual(places.back, ["H:/repo-flow-x"]);
    assert.deepEqual(w.order, ["brought"], "no chat made, no turn posted");
  });
});

describe("the flow's runner asks for it only where the person switched it on (OA5)", () => {
  const ROSTER = {
    cards: [...Object.entries(SHIPPED_CARDS).map(([tag, c]) => ({ tag, name: c.name, goodFor: c.goodFor })), ...OWN_CARDS.map(({ tag, name, goodFor }) => ({ tag, name, goodFor }))],
    teams: Object.entries(SHIPPED_TEAMS).map(([key, t]) => ({ key, name: t.name, readOnly: /** @type {any} */ (t).readOnly === true })),
  };
  const TREE = { kind: "worktree", name: "flow-a-lexer", branch: "flow-a-lexer", folder: "H:/repo-flow-a-lexer", cwd: "H:/repo-flow-a-lexer" };
  const LEXER = { goal: "build a lexer", title: "A lexer", steps: [{ boxes: [{ kind: "team", agent: "builders", words: "Build it.", id: "build" }] }, { boxes: [{ agent: "skeptic", words: "Gate.", id: "check", gate: true, needs: ["build"] }] }] };
  /** @param {{ uncommitted?: ((id: string) => Promise<import("../src/adapters/git/places.js").LeftBehind>) | null }} [o] */
  const world = ({ uncommitted = null } = {}) => {
    /** @type {any[]} */
    const fired = [];
    /** @type {string[]} */
    const asked = [];
    const chains = new Map([["c1", { id: "c1", kind: "harness", meta: {} }]]);
    const runner = createFlowRunner({
      store: createFlowStore({ dir: null }),
      archive: () => ({ getChain: (/** @type {string} */ id) => chains.get(id) || null, mergeMeta: () => ({}), besideOf: () => [] }),
      registry: () => ({ notice: () => ({ ok: true }), get: () => null }),
      besides: () => ({
        fire: async (/** @type {string} */ _main, /** @type {any} */ input) => {
          fired.push(input);
          return { id: `t${fired.length}`, state: "working", place: input.own?.use || { ...TREE, ...(input.own?.bring ? { brought: { files: 3, stays: [] } } : {}) } };
        },
        row: () => null,
        list: () => [],
      }),
      sessions: { besideFacts: () => ({ last: null }) },
      roster: () => ROSTER,
      postTurn: async () => ({ status: 200, body: null }),
      events: { publish: () => {}, subscribe: () => () => {} },
      now: () => 0,
      uncommittedOf: uncommitted
        ? async (id) => {
            asked.push(id);
            return uncommitted(id);
          }
        : null,
    });
    return { runner, fired, asked };
  };
  const settled = async () => {
    for (let i = 0; i < 15; i++) await new Promise((r) => setImmediate(r));
  };

  // (fails before: yes — a flow kept no such choice; its fire asked `{ name }` alone, whatever was said)
  test("off by default: the fire asks a worktree alone; switched on, the fire asks for the edits and the flow keeps what was brought", async () => {
    const off = world();
    const d = off.runner.create("c1", LEXER);
    assert.equal(d.bring, undefined, "off unless the person switches it on");
    off.runner.start("c1", d.id);
    await settled();
    assert.deepEqual(off.fired[0].own, { name: "flow-a-lexer" });
    const on = world();
    const d2 = on.runner.create("c1", LEXER);
    assert.equal(on.runner.edit("c1", d2.id, { bring: true }).bring, true);
    on.runner.start("c1", d2.id);
    await settled();
    assert.deepEqual(on.fired[0].own, { name: "flow-a-lexer", bring: true });
    const f = on.runner.get("c1", d2.id);
    assert.deepEqual(f.place?.kind === "worktree" ? f.place.brought : null, { files: 3, stays: [] });
    // Once its worktree is made, what it was given stays: switching it changes nothing, and says so.
    assert.throws(() => on.runner.edit("c1", d2.id, { bring: false }), /its worktree is made already: what it was given of your folder stays as it was/);
    assert.equal(on.runner.edit("c1", d2.id, { bring: true }).bring, true, "the same word again is no change");
    const back = world();
    const d3 = back.runner.create("c1", LEXER);
    back.runner.edit("c1", d3.id, { bring: true });
    assert.equal(back.runner.edit("c1", d3.id, { bring: false }).bring, undefined, "switched off again before Start");
  });

  test("leftBehind: git asked only where a draft has a team box that writes; its count, or null where nothing is to be said", async () => {
    const w = world({ uncommitted: async () => ({ ok: true, count: 4 }) });
    const reads = w.runner.create("c1", { goal: "read it", steps: [{ boxes: [{ kind: "team", agent: "builders", words: "Read.", readOnly: true }] }] });
    assert.deepEqual(await w.runner.leftBehind("c1"), { uncommitted: null });
    assert.deepEqual(w.asked, [], "no draft writes: git is not asked");
    w.runner.create("c1", LEXER);
    assert.deepEqual(await w.runner.leftBehind("c1"), { uncommitted: 4 });
    assert.deepEqual(w.asked, ["c1"]);
    assert.ok(reads);
  });

  // (fails before: yes — the list route waited on git's walk of the folder for the count, whatever moved)
  test("the list route answers without asking git; the count is its own route", async () => {
    const w = world({ uncommitted: async () => ({ ok: true, count: 2 }) });
    w.runner.create("c1", LEXER);
    const route = createRouter(flowRoutes({ flows: w.runner }));
    /** @param {string} path */
    const get = async (path) => {
      const m = route("GET", path);
      assert.ok(m, path);
      const res = { status: 0, body: "", headersSent: false, setHeader() {}, getHeader() {}, writeHead(/** @type {number} */ s) { this.status = s; this.headersSent = true; return this; }, write(/** @type {string} */ c) { this.body += c; }, end(/** @type {string} */ c = "") { this.body += c; }, on() {} };
      await m.handler(/** @type {any} */ ({ req: { headers: {}, method: "GET", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, path, method: "GET", params: m.params }), /** @type {any} */ ({}));
      return JSON.parse(res.body);
    };
    const list = await get("/sessions/c1/flows");
    assert.equal(list.flows.length, 1);
    assert.equal("uncommitted" in list, false);
    assert.deepEqual(w.asked, [], "git is not asked for the list");
    assert.deepEqual(await get("/sessions/c1/flows/uncommitted"), { uncommitted: 2 });
    assert.deepEqual(w.asked, ["c1"]);
  });
});

describe("the words: the draft's, the worktree's, the main agent's (OA5)", () => {
  /** A draft with a team box that writes, as the list route answers it. @param {any} [more] @returns {any} */
  const draft = (more = {}) => ({ state: "draft", place: null, steps: [{ why: "", boxes: [{ id: "build", kind: "team", writes: true }] }], ...more });
  const tree = /** @type {const} */ ({ kind: "worktree", name: "flow-x", branch: "flow-x", folder: "H:/repo-flow-x", cwd: "H:/repo-flow-x" });

  // (fails before: yes — nothing said the folder's uncommitted files stay behind, and nothing offered to bring them)
  test("a draft says plainly that your uncommitted files stay here, or that they are copied in; nothing where there is nothing to say", () => {
    assert.equal(bringNote(draft(), 3), "Its first team that writes starts a new branch from your folder's last commit, so your 3 uncommitted files stay here.");
    assert.equal(bringNote(draft(), 1), "Its first team that writes starts a new branch from your folder's last commit, so your uncommitted file stays here.");
    assert.equal(bringNote(draft({ bring: true }), 3), "Its first team that writes starts a new branch from your folder's last commit, and your 3 uncommitted files are copied into it as uncommitted edits: nothing is committed, and your folder keeps them.");
    assert.equal(bringNote(draft({ bring: true }), 0), "Its first team that writes starts a new branch from your folder's last commit, and what is uncommitted in your folder as it starts is copied into it as uncommitted edits: nothing is now.");
    assert.equal(bringNote(draft(), 0), null, "nothing uncommitted, the switch off: nothing to say");
    assert.equal(bringNote(draft(), null), null, "no worktree would be made");
    assert.equal(bringNote(draft({ steps: [{ why: "", boxes: [{ id: "read", kind: "team", writes: false }] }] }), 3), null, "no team that writes");
    assert.equal(bringNote(draft({ state: "running" }), 3), null);
    assert.equal(BRING_WORDS.label, "Bring my uncommitted edits");
  });

  test("its worktree says what it was given — the tooltip that it was made from the last commit stays — and the main agent hears it", () => {
    const title = "H:/repo-flow-x\nMade from your folder's last commit when its first team that writes started; every box after it works there, never in your folder. Nothing is merged: the branch is yours to merge, or to let go";
    assert.deepEqual(worksWords({ place: tree }), { words: "Works in its own worktree · branch flow-x", title, worktree: true }, "not asked: as it was");
    assert.deepEqual(worksWords({ place: { ...tree, brought: { files: 3, stays: [] } } }), { words: "Works in its own worktree · branch flow-x · your 3 uncommitted files brought", title: `${title}\nYour 3 uncommitted files were copied in as uncommitted edits; your folder keeps them.`, worktree: true });
    assert.deepEqual(worksWords({ place: { ...tree, brought: { files: 0, stays: ["nested"] } } }), { words: "Works in its own worktree · branch flow-x · nothing uncommitted to bring", title: `${title}\nNothing was uncommitted in your folder to copy in. nested stayed: not a plain file.`, worktree: true });
    assert.equal(worksIn({ ...tree, brought: { files: 1, stays: [] } }), "Works in: the worktree H:/repo-flow-x, on branch flow-x — made from the folder's last commit when its first team box that writes started, the folder's uncommitted file copied in, uncommitted; every box after it works there, never in your folder, and nothing of it is merged.");
    assert.match(worksIn(/** @type {any} */ (tree)), /started; every box after it works there/, "not asked: as it was");
  });

  // (fails before: yes — the count came with every read of the list: each flow's move and each tick of the slow timer
  // waited on git's walk of the folder)
  test("the page asks the count on its own: as a draft stands or changes, and as the chat's turn lets go — not as a flow moves", async () => {
    /** @type {string[]} */
    const reads = [];
    /** @type {(() => void)[]} */
    const due = [];
    /** @type {any[]} */
    let rows = [{ id: "f1", chainId: "c1", state: "draft", steps: [{ boxes: [{ id: "b", kind: "team", writes: true }] }] }, { id: "f0", chainId: "c1", state: "running", steps: [] }];
    const list = createFlowList({
      call: async (path) => {
        reads.push(String(path));
        return String(path).endsWith("/uncommitted") ? { uncommitted: 3 } : { flows: rows };
      },
      later: (fn) => (due.push(fn), due.length),
      clear: () => {},
      now: () => 0,
    });
    const settled = async () => {
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    };
    /** Each due read run, the slow timer's left due. */
    const runDue = async () => {
      while (due.length) {
        due.shift()?.();
        await settled();
        due.length = 0;
      }
    };
    const counts = () => reads.filter((p) => p.endsWith("/uncommitted")).length;
    list.setChain("c1");
    await settled();
    assert.deepEqual(reads, ["/sessions/c1/flows", "/sessions/c1/flows/uncommitted"]);
    assert.deepEqual(list.uncommitted(), { files: 3, asking: false, failed: null, answered: true });
    due.length = 0;
    list.heard({ type: "flow", chainId: "c1" });
    await runDue();
    assert.equal(reads.filter((p) => p === "/sessions/c1/flows").length, 2, "the running flow moved: the list read again");
    assert.equal(counts(), 1, "the drafts as they were: no count asked");
    list.heard({ type: "turn", chainId: "c2", holder: null });
    assert.equal(due.length, 0, "another chat's turn is not this one's");
    list.heard({ type: "turn", chainId: "c1", holder: null });
    await runDue();
    assert.equal(counts(), 2, "the turn let go: the count asked again");
    rows = [{ id: "f1", chainId: "c1", state: "draft", steps: [{ boxes: [{ id: "b", kind: "team", writes: true }, { id: "c", kind: "agent", writes: false }] }] }];
    list.heard({ type: "flow", chainId: "c1" });
    await runDue();
    assert.equal(counts(), 3, "the draft changed: asked again");
    rows = [{ id: "f1", chainId: "c1", state: "draft", steps: [{ boxes: [{ id: "c", kind: "agent", writes: false }] }] }];
    list.heard({ type: "flow", chainId: "c1" });
    await runDue();
    assert.equal(counts(), 3, "no team that writes: no worktree, nothing to count");
    rows = [];
    list.heard({ type: "flow", chainId: "c1" });
    await runDue();
    assert.equal(counts(), 3, "no draft: never asked");
    assert.deepEqual(list.uncommitted(), { files: 3, asking: false, failed: null, answered: true }, "what the folder's count last said stays for the next draft");
  });
});

// @ts-check
// The kind of a builder's worktree through the registry and the loop (the owner's plan of 11-09 for big repos): Auto
// gives a builder in a big repository a sparse copy — at its launch, or as its patch moves —, its cone holding what its
// launch names and what it read, its brief saying how to widen it; its follow-up resets that copy where it stands; the
// chat's Worktree stays a full checkout; one that runs in a copy takes a clone where the drive clones and git ignores
// build caches. The loop brings a folder in before the snapshot of a write and says so in the call's result.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setCowProbe } from "../src/adapters/git/cow.js";
import { patchHand } from "../src/adapters/tools/patch-hands.js";
import { runHand } from "../src/adapters/tools/hands.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { copyMeta } from "./helpers/copies.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
afterEach(() => setCowProbe(null));
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }, windowsHide: true }).trim();
/** @param {string} p */
const read = (p) => readFileSync(p, "utf8");
/** @param {string} p @param {string} text */
const put = (p, text) => {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
};
const CLI = "filament-test-cli";
/**
 * A repository of six folders' files, `.gitignore` leaving out Library/; `big`: its files kept with Git LFS, as its
 * attributes say.
 * @param {{ big?: boolean }} [o]
 */
const repo = ({ big = false } = {}) => {
  const dir = join(realpathSync.native(mkdtempSync(join(tmpdir(), "filament-sa-copy-"))), "proj");
  made.push(dir);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  const files = {
    ".gitignore": "Library/\n",
    "a.txt": "a\n",
    "lib/c/x.js": "x\n",
    "lib/c/y.js": "y\n",
    "docs/d/guide.md": "guide\n",
    "tools/e/run.js": "run\n",
    "vendor/f/one.js": "one\n",
    "vendor/f/two.js": "two\n",
    "vendor/g/three.js": "three\n",
    "vendor/g/four.js": "four\n",
    ...(big ? { "assets/.gitattributes": "*.bin filter=lfs diff=lfs merge=lfs -text\n" } : {}),
  };
  for (const [p, s] of Object.entries(files)) put(join(dir, p), s);
  git(dir, "add", "-A");
  git(dir, "-c", "core.hooksPath=.no-hooks", "commit", "-qm", "init");
  return dir;
};
/** A sub-agent's file tools where its host says it works, as agent/turn.js hands them. @param {any} host */
const handsOf = (host) => {
  const seen = new Map();
  return (/** @type {string} */ name, /** @type {any} */ input) => (host.workspace ? patchHand(name, input, host.workspace, { root: host.workdir, fenced: true, seen }) : runHand(name, input, { root: host.workdir, fenced: true, seen })).then(String);
};
/**
 * A registry over a real folder whose sub-agent works where its host says, as `work` says, by exchange; each brief it
 * was sent is kept in `briefs`. `settings`: the session's.
 * @param {string} dir @param {Record<string, any>} settings
 * @param {(o: { n: number, host: any, hands: ReturnType<typeof handsOf> }) => Promise<void>} work @param {{ briefs?: string[] }} [o]
 */
const working = (dir, settings, work, { briefs = [] } = {}) => {
  const cards = createAgentCardStore({ dataDir: null });
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    cli: CLI,
    context: {
      card: (tag) => cards.find(tag),
      settings: () => ({ subagents: { ask: [] }, loop: { permissions: "edit" }, ...settings }),
      session: () => ({ cwd: dir, model: "m", projectId: null }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
      exchangeEnded: () => {},
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      const host = registry.hostOf(id);
      const runId = `run-${++n}`;
      briefs.push(body.messages.at(-1).content.map((/** @type {any} */ b) => b.text).join("\n\n"));
      registry.attach(id, runId);
      await work({ n, host, hands: handsOf(host) });
      registry.relay(id, { type: "tool-end", name: "write", ok: true });
      registry.finish(id, { status: "done", error: null, report: "done", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "done" }] }], rounds: 1, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "done" }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return registry;
};
/** Hooks on the file tools: a builder on Auto gets a worktree at its launch (workspace-kind.js rule 9). */
const HOOKED = { hooks: [{ on: "pre-tool", tool: "write", command: "echo hooked" }] };

// (fails before: yes — every builder's worktree checked every file out, its brief said nothing of a cone, and its
// follow-up's revive checked the whole project out in place of its sparse copy)
test("Auto gives a builder in a big repository a sparse copy holding what its launch names; its brief says how to widen; its host widens it; its follow-up keeps that copy, cone and all", async () => {
  const dir = repo({ big: true });
  /** @type {string[]} */
  const briefs = [];
  /** @type {any[]} */
  const seen = [];
  const registry = working(
    dir,
    HOOKED,
    async ({ n, host }) => {
      seen.push({ n, dest: host.workdir, meta: copyMeta(host.workdir) });
      if (n === 1) {
        writeFileSync(join(host.workdir, "lib", "c", "x.js"), "X\n");
        seen.push({ widened: await host.widen(join(host.workdir, "tools", "e", "run.js"), null), there: existsSync(join(host.workdir, "tools", "e", "run.js")) });
      }
    },
    { briefs },
  );
  const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "Fix `lib/c/x.js`; docs/d says how." }));
  assert.equal(r.ok, true, String(r.error || ""));
  await r.done;
  const id = String(r.id);
  assert.equal(seen[0].meta?.kind, "sparse");
  assert.deepEqual(seen[0].meta?.cone, ["docs/d", "lib/c"], "the launch's paths: a file's folder, a folder");
  assert.ok(!existsSync(join(seen[0].dest, "vendor")), "nothing else of the project is checked out");
  assert.ok(briefs[0].includes(`[Filament: Your copy of the project is sparse: it holds docs/d/, lib/c/ and the files at the top and in their parent folders. Before you read, search or change files in another folder, run \`${CLI} workspace widen <folder>\` in your copy to bring it in.]`), briefs[0]);
  assert.deepEqual(seen[1], { widened: "[Filament: tools/e/run.js lies outside the folders your sparse copy held: it holds tools/e/ now too.]", there: true });
  assert.deepEqual(/** @type {any} */ (registry.get(id))?.work?.files.map((/** @type {any} */ f) => f.path), ["lib/c/x.js"]);
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
  try {
    const again = await door.subagents.run({ id: "toolu_2", input: { description: "again", agent_id: id, prompt: "and again", run_in_background: false }, emit: () => {}, signal: null });
    assert.equal(again.ok, true, again.text);
  } finally {
    door.close();
  }
  const next = seen.at(-1);
  assert.equal(next.dest, seen[0].dest, "its parked copy, at the same place");
  assert.deepEqual([next.meta?.kind, next.meta?.cone], ["sparse", ["docs/d", "lib/c", "tools/e"]], "reset where it stands: its cone as it widened it");
  assert.ok(!existsSync(join(next.dest, "vendor")), "never checked out whole");
  assert.equal(read(join(next.dest, "lib", "c", "x.js")), "X\n", "its work in it");
});

// (fails before: yes — a patch moved only to a full checkout)
test("a builder's patch in a big repository moves to a sparse copy: its cone holds what it read and what its launch names, and the move says how to widen", async () => {
  const dir = repo({ big: true });
  /** @type {any} */
  let got = null;
  const registry = working(dir, {}, async ({ host, hands }) => {
    assert.ok(host.workspace, "it starts in a patch");
    await hands("read", { path: "lib/c/x.js" });
    const m = await host.workspace.move("command");
    got = { m, meta: copyMeta(host.workdir), vendor: existsSync(join(host.workdir, "vendor")) };
  });
  const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "See docs/d first." }));
  assert.equal(r.ok, true, String(r.error || ""));
  await r.done;
  assert.equal(got.m.ok, true, got.m.error);
  assert.deepEqual([got.meta?.kind, got.meta?.cone, got.vendor], ["sparse", ["docs/d", "lib/c"], false]);
  assert.match(got.m.said, new RegExp(`the command ran there\\. Your copy of the project is sparse: it holds docs/d/, lib/c/ .* run \`${CLI} workspace widen <folder>\` in your copy to bring it in\\.\\]$`));
});

// (fails before: no — a guard: the chat's Worktree was a full checkout, and stays one whatever the repository)
test("the chat's Worktree is a full checkout in a big repository whose drive clones and whose caches git ignores — and nothing is asked of the drive", async () => {
  const dir = repo({ big: true });
  put(join(dir, "Library", "ArtifactDB"), "imported assets\n");
  let asked = 0;
  setCowProbe(async () => (asked++, { cow: true, how: "the test's drive clones", verified: true }));
  /** @type {any} */
  let meta = null;
  const registry = working(dir, { subagents: { ask: [], workspace: "worktree" } }, async ({ host }) => {
    meta = copyMeta(host.workdir);
  });
  const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "Fix lib/c/x.js." }));
  assert.equal(r.ok, true, String(r.error || ""));
  await r.done;
  assert.equal(meta?.kind, "worktree");
  assert.equal(asked, 0);
});

// (fails before: yes — the same: nothing chose a clone)
test("one that runs in a copy takes a clone where the drive clones and git ignores build caches — its Library warm —, and a full checkout of a big repository otherwise, never a sparse one", async () => {
  const dir = repo({ big: true });
  put(join(dir, "Library", "ArtifactDB"), "imported assets\n");
  setCowProbe(async () => ({ cow: true, how: "the test's drive clones", verified: true }));
  /** @type {any[]} */
  const seen = [];
  const registry = working(dir, {}, async ({ host }) => {
    seen.push({ kind: copyMeta(host.workdir)?.kind, warm: existsSync(join(host.workdir, "Library", "ArtifactDB")) });
  });
  const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "Run it and say what you see.", may: "copy" }));
  assert.equal(r.ok, true, String(r.error || ""));
  await r.done;
  assert.deepEqual(seen[0], { kind: "clone", warm: true });
  setCowProbe(async () => ({ cow: false, how: "the test's drive does not clone", verified: true }));
  const cold = repo({ big: true });
  put(join(cold, "Library", "ArtifactDB"), "imported assets\n");
  const other = working(cold, {}, async ({ host }) => {
    seen.push({ kind: copyMeta(host.workdir)?.kind, warm: existsSync(join(host.workdir, "Library", "ArtifactDB")) });
  });
  const o = /** @type {any} */ (other.launch({ origin: "owner", chainId: "c1", prompt: "Run lib/c/x.js and say what you see.", may: "copy" }));
  assert.equal(o.ok, true, String(o.error || ""));
  await o.done;
  assert.deepEqual(seen[1], { kind: "worktree", warm: false });
});

const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };

// (fails before: yes — the loop wrote where a sparse copy's cone did not reach, the snapshot taking the file as absent)
test("the loop brings a sparse copy's folder in before the snapshot of a write, and the call's result says so; a call inside the cone says nothing", async () => {
  /** @type {string[]} */
  const order = [];
  /** @type {any[]} */
  const bodies = [];
  await runAgentTurn(/** @type {any} */ ({
    model: "m", messages: [{ role: "user", content: "go" }], system: "s", tools: toolSetFor({ delegateRead: false }), modeNow: () => "edit",
    root: tmpdir(), readerModel: "", maxTokens: 100, costOf: () => 0, delegateRead: null, mailbox: { read: () => [] }, permissions: null,
    tree: { before: async (/** @type {number} */ _r, /** @type {any} */ o) => void order.push(`before ${o.paths.map((/** @type {string} */ p) => basename(p)).join(",")}`), take: async () => ({ errors: [], snapshots: [], rows: [] }) },
    widen: async (/** @type {string} */ path) => (order.push(`widen ${basename(path)}`), basename(path) === "far.js" ? "[Filament: far.js lies outside the folders your sparse copy held: it holds far/ now too.]" : ""),
    onEvent: () => {}, previewChars: 0, sink, signal: null, resume: null,
    runHand: async (/** @type {string} */ name) => (order.push(`hand ${name}`), "ok"),
    call: async ({ body }) => {
      bodies.push(structuredClone(body));
      return bodies.length === 1 ? reply([toolUse("w", "write", { path: "far/far.js", content: "x" })]) : bodies.length === 2 ? reply([toolUse("r", "read", { path: "near.js" })]) : reply([{ type: "text", text: "Done." }]);
    },
  }));
  assert.deepEqual(order, ["widen far.js", "before far.js", "hand write", "widen near.js", "hand read"]);
  const results = (/** @type {any} */ b) => b.messages.at(-1).content.filter((/** @type {any} */ c) => c.type === "tool_result").map((/** @type {any} */ c) => (typeof c.content === "string" ? c.content : c.content.map((/** @type {any} */ x) => x.text).join("")));
  assert.match(results(bodies[1])[0], /^ok\n\n\[Filament: far\.js lies outside the folders your sparse copy held: it holds far\/ now too\.\]$/);
  assert.equal(results(bodies[2])[0], "ok");
});

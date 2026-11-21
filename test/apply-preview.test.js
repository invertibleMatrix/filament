// @ts-check
// Apply says what it will do before the press, and what it did after (the Designer's of 10-27, on the owner's words:
// "what does that apply button even do behind the scene. is it worktree copying files or what"). The apply's plan is a
// dry run of its own: how each file of a sub-agent's work would come into the developer's folder — as it left it,
// merged with their edits, deleted, or already the same — and the files that would stop it, nothing written. The apply
// itself keeps how each came in, and who applied it, on the sub-agent's row.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTaskWork, captureTaskWork, openTaskWorktree, previewApply, removeTaskWorktree } from "../src/adapters/git/worktree.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
/** A repository with three committed files. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-applyprev-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\nfour\nfive\n");
  writeFileSync(join(dir, "b.txt"), "bee\n");
  writeFileSync(join(dir, "d.txt"), "dee\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** @param {string} p */
const read = (p) => readFileSync(p, "utf8");
/** Each file's way in, by path. @param {{ path: string, how: string }[]} came */
const ways = (came) => Object.fromEntries(came.map((c) => [c.path, c.how]));

// (fails before: yes — no dry run: previewApply did not exist, and an apply said only which files changed)
test("the dry run says how each file would come in, writing nothing; the apply then does just that and says so", async () => {
  const dir = repo();
  const o = await openTaskWorktree(dir, { id: "sa_000000a1" });
  assert.ok(o.ok);
  const { wt } = o;
  writeFileSync(join(wt.workdir, "a.txt"), "one\ntwo\nthree\nfour\nFIVE by the sub-agent\n");
  rmSync(join(wt.workdir, "b.txt"));
  writeFileSync(join(wt.workdir, "c.txt"), "sea\n");
  writeFileSync(join(wt.workdir, "d.txt"), "DEE\n");
  writeFileSync(join(wt.workdir, "e.txt"), "ee\n");
  const cap = await captureTaskWork(wt, { id: "sa_000000a1" });
  assert.ok(cap.ok);
  await removeTaskWorktree(wt);
  // Meanwhile the developer edited a.txt's first line, and made e.txt as the sub-agent left it.
  writeFileSync(join(dir, "a.txt"), "ONE by the developer\ntwo\nthree\nfour\nfive\n");
  writeFileSync(join(dir, "e.txt"), "ee\n");
  const status = git(dir, "status", "--porcelain");

  const p = await previewApply(dir, { base: wt.base, head: cap.head });
  assert.deepEqual(p.conflicts, []);
  assert.deepEqual(ways(p.came), { "a.txt": "merged", "b.txt": "deleted", "c.txt": "took", "d.txt": "took", "e.txt": "same" });
  assert.equal(p.files.length, 5);
  assert.equal(read(join(dir, "a.txt")), "ONE by the developer\ntwo\nthree\nfour\nfive\n", "the dry run wrote nothing");
  assert.deepEqual([existsSync(join(dir, "b.txt")), existsSync(join(dir, "c.txt"))], [true, false]);
  assert.equal(git(dir, "status", "--porcelain"), status, "the folder and its index as they were");

  const ap = await applyTaskWork(dir, { base: wt.base, head: cap.head });
  assert.ok(ap.ok, !ap.ok ? JSON.stringify(ap.conflicts) : "");
  assert.deepEqual(ways(ap.came), ways(p.came), "the apply did what the dry run said");
  assert.equal(read(join(dir, "a.txt")), "ONE by the developer\ntwo\nthree\nfour\nFIVE by the sub-agent\n");
  assert.equal(existsSync(join(dir, "b.txt")), false);
});

// (fails before: yes — the same: no dry run to name what would stop an apply, nor what would come in cleanly)
test("a dry run that meets an overlap names it, and the files that would come in cleanly; nothing is written", async () => {
  const dir = repo();
  const o = await openTaskWorktree(dir, { id: "sa_000000a2" });
  assert.ok(o.ok);
  writeFileSync(join(o.wt.workdir, "a.txt"), "one\ntwo\nTHREE (sub-agent)\nfour\nfive\n");
  writeFileSync(join(o.wt.workdir, "c.txt"), "sea\n");
  const cap = await captureTaskWork(o.wt, { id: "sa_000000a2" });
  assert.ok(cap.ok);
  await removeTaskWorktree(o.wt);
  writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree (developer)\nfour\nfive\n");
  const p = await previewApply(dir, { base: o.wt.base, head: cap.head });
  assert.deepEqual(p.conflicts, [{ path: "a.txt", why: "1 change overlaps yours", kind: "lines", overlaps: 1 }]);
  assert.deepEqual(ways(p.came), { "c.txt": "took" }, "what would come in cleanly");
  assert.equal(existsSync(join(dir, "c.txt")), false);
});

// (fails before: yes — the owner's of 10-30: a file that held the sub-agent's change already, brought over by hand
// beside an edit of the developer's own, was said "merged with your edits" and written again, the same)
test("a file that holds its change already, beside edits of your own, is already the same: the apply writes nothing to it", async () => {
  const dir = repo();
  const o = await openTaskWorktree(dir, { id: "sa_000000a3" });
  assert.ok(o.ok);
  writeFileSync(join(o.wt.workdir, "a.txt"), "one\ntwo\nthree\nfour\nFIVE by the sub-agent\n");
  writeFileSync(join(o.wt.workdir, "d.txt"), "DEE\n");
  const cap = await captureTaskWork(o.wt, { id: "sa_000000a3" });
  assert.ok(cap.ok);
  await removeTaskWorktree(o.wt);
  writeFileSync(join(dir, "a.txt"), "ONE by the developer\ntwo\nthree\nfour\nFIVE by the sub-agent\n");
  const p = await previewApply(dir, { base: o.wt.base, head: cap.head });
  assert.deepEqual([p.conflicts, ways(p.came)], [[], { "a.txt": "same", "d.txt": "took" }]);
  const ap = await applyTaskWork(dir, { base: o.wt.base, head: cap.head });
  assert.ok(ap.ok, !ap.ok ? JSON.stringify(ap.conflicts) : "");
  assert.deepEqual(ways(ap.came), { "a.txt": "same", "d.txt": "took" });
  assert.equal(read(join(dir, "a.txt")), "ONE by the developer\ntwo\nthree\nfour\nFIVE by the sub-agent\n");
  assert.equal(read(join(dir, "d.txt")), "DEE\n");
});

/**
 * A registry over a real folder whose sub-agent "works" in its own copy: it rewrites a.txt's last line and adds c.txt.
 * @param {string} dir
 */
const working = (dir) => {
  const cards = createAgentCardStore({ dataDir: null });
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      card: (tag) => cards.find(tag),
      settings: () => ({ subagents: { ask: [] }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: dir, model: "m", projectId: null }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      const cwd = registry.hostOf(id)?.workdir || String(headers["x-filament-cwd"]);
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      writeFileSync(join(cwd, "a.txt"), "one\ntwo\nthree\nfour\nFIVE by the sub-agent\n");
      writeFileSync(join(cwd, "c.txt"), "sea\n");
      registry.relay(id, { type: "tool-end", name: "write", ok: true });
      registry.finish(id, { status: "done", error: null, report: "done", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "done" }] }], rounds: 1, toolCalls: 2, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "done" }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return registry;
};

// (fails before: yes — the registry had no preview, and its row said only when the newest apply was and how many files)
test("a sub-agent's waiting work: the registry's dry run, and the row's newest apply — who applied it and how its files came in", async () => {
  const dir = repo();
  const registry = working(dir);
  const r = registry.launch({ origin: "owner", chainId: "c1", prompt: "end a.txt loud, and add c.txt" });
  assert.equal(r.ok, true, String(/** @type {any} */ (r).error || ""));
  await /** @type {any} */ (r).done;
  const id = /** @type {any} */ (r).id;
  writeFileSync(join(dir, "a.txt"), "ONE by the developer\ntwo\nthree\nfour\nfive\n");

  const p = await registry.preview(id, "c1");
  assert.ok(p.ok, !p.ok ? p.error : "");
  assert.deepEqual([ways(p.came), p.conflicts, p.files], [{ "a.txt": "merged", "c.txt": "took" }, [], 2]);
  assert.ok(p.folder && p.folder !== dir, "where its copy is");
  assert.equal(existsSync(join(dir, "c.txt")), false, "nothing written");

  const a = await registry.apply(id, "c1", "owner");
  assert.ok(a.ok, !a.ok ? a.error : "");
  assert.deepEqual(ways(a.came || []), { "a.txt": "merged", "c.txt": "took" });
  const row = /** @type {any} */ (registry.get(id));
  assert.deepEqual(row.work.lastApplied && { ...row.work.lastApplied, at: 0 }, { at: 0, files: 2, by: "owner", came: { took: 1, merged: ["a.txt"], deleted: 0, same: 0 } });
  assert.equal(row.work.pending, 0);
  const again = await registry.preview(id, "c1");
  assert.deepEqual([again.ok, !again.ok && again.error], [false, `sub-agent ${id} has no changes waiting to be applied`], "once applied, nothing waits");
});

// @ts-check
// A follow-up to a sub-agent at work, and one that names a task (g3b, the owner's of 11-09: sub-agents flexible rather
// than strict). The loop's agent tool and a coding agent's send a follow-up to one still working as a message, read at
// its next step, as a lead's worker tool does — no longer refused until its report. A coding agent's follow-up may name a
// task of its own, so the work it asks for is tracked under it; a task another sub-agent works on now stays refused, in
// words. Against a scripted registry (helpers/team.js `watched`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { watched } from "./helpers/team.js";
import { until } from "./helpers/wait.js";

/**
 * The agent's turn on a registry, and its agent tool's calls: the loop's, or a coding agent's (`coder`).
 * @param {ReturnType<typeof watched>} w @param {{ coder?: boolean }} [o]
 */
const turnOf = (w, { coder = false } = {}) => {
  const door = w.registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: w.dir, mode: "edit", model: "m-main", thinking: null, fork: null });
  let n = 0;
  /** @param {any} input */
  const call = (input) => door.subagents.run({ id: `tu-${++n}`, input: { description: "Fix the parser", ...(coder ? { run_in_background: true } : {}), ...input }, emit: () => {}, signal: /** @type {any} */ (null), coder });
  return { door, call };
};

/** A sub-agent launched in the background, its run attached. @param {ReturnType<typeof watched>} w @param {ReturnType<typeof turnOf>} t @param {number} n @param {any} [more] */
const launched = async (w, t, n, more = {}) => {
  const out = await t.call({ prompt: "fix parse() for an empty file", ...more });
  assert.equal(out.ok, true, out.text);
  const r = await w.run(n);
  const id = r.id;
  r.attach();
  await until(() => w.registry.get(id)?.runId === r.runId, "its run to attach");
  return { id, r };
};

for (const coder of [false, true]) {
  const whose = coder ? "a coding agent's" : "the loop's";
  // (fails before: yes — the friction of 11-09: "sub-agent sa_… is still working; its report comes first", and the
  // agent had to write it a letter instead)
  test(`${whose} follow-up to a sub-agent still at work goes as a message, read at its next step; its report still comes`, async () => {
    const w = watched();
    const t = turnOf(w, { coder });
    const { id, r } = await launched(w, t, 1);
    const out = await t.call({ agent_id: id, prompt: " Keep the old export too. " });
    assert.deepEqual(
      [out.ok, out.text, out.note],
      [true, `Sent to sub-agent ${id} as a message: it reads it at its next step, while it works. Its report still comes when it finishes.`, `agent: a message to sub-agent ${id} (m-main), read at its next step`],
    );
    assert.deepEqual(w.steers, [{ runId: r.runId, kind: "note", text: "Keep the old export too.", from: "agent" }], "into its run, as the agent's");
    assert.equal(w.registry.get(id)?.exchanges.length, 1, "no follow-up of its own: the run it is on reads it");
    // What a message cannot carry is refused in words, and nothing is sent.
    await assert.rejects(t.call({ agent_id: id, prompt: "Take my edits.", sync: true }), { message: `sub-agent ${id} is still working, so your follow-up goes as a message read at its next step: leave sync out, or send it once it reported` });
    await assert.rejects(t.call({ agent_id: id, prompt: "Read this.", changes: "uncommitted" }), { message: `sub-agent ${id} is still working, so your follow-up goes as a message read at its next step: leave changes out, or send it once it reported` });
    await assert.rejects(t.call({ agent_id: id, prompt: "  " }), { message: "a message needs words" });
    assert.equal(w.steers.length, 1);
    r.finish({ status: "done", report: "FIXED" });
    await w.registry.settled(id);
    // Once it reported, a follow-up is one again.
    const again = await t.call({ agent_id: id, prompt: "Now log the count." });
    assert.equal(again.ok, true, again.text);
    assert.match(again.text, new RegExp(`^Sub-agent ${id} took your follow-up`));
    const next = await w.run(2);
    next.attach();
    next.finish({ status: "done", report: "LOGGED" });
    await w.registry.settled(id);
  });
}

// (fails before: yes — a follow-up was refused "a follow-up goes on with the task its launch named — leave task out",
// though a helper launched with no task could not be put on one, nor one put on another of the agent's tasks)
test("a coding agent's follow-up may name a task of its own: the task keeps who works on it; one another works on now is refused in words", async () => {
  /** @type {[string, string, boolean][]} */
  const took = [];
  const w = watched({
    extra: {
      taskHelper: {
        refusal: (/** @type {string} */ _c, /** @type {string} */ id) => (id === "gone" ? "gone is done — task names one that is still to do" : null),
        took: (/** @type {string} */ _c, /** @type {string} */ id, /** @type {any} */ h) => void took.push([id, h.agent, h.copy]),
      },
    },
  });
  const t = turnOf(w, { coder: true });
  const a = await launched(w, t, 1);
  a.r.finish({ status: "done", report: "MAPPED" });
  await w.registry.settled(a.id);
  // A helper launched for no task takes one at its follow-up.
  const followed = await t.call({ agent_id: a.id, prompt: "Now fix it.", task: "t1" });
  assert.equal(followed.ok, true, followed.text);
  assert.deepEqual(took, [["t1", a.id, false]], "its box says who works on it");
  const ra = await w.run(2);
  ra.attach();
  await until(() => w.registry.get(a.id)?.runId === ra.runId, "its follow-up to attach");
  // Another helper may not take t1 while a works on it, by launch or by follow-up.
  await assert.rejects(t.call({ prompt: "fix it another way", task: "t1" }), { message: `${a.id} works on t1 already — follow up with it (agent_id ${a.id}), or leave task out` });
  const b = await launched(w, t, 3, { task: "t2" });
  b.r.finish({ status: "done", report: "DONE" });
  await w.registry.settled(b.id);
  await assert.rejects(t.call({ agent_id: b.id, prompt: "Help with t1.", task: "t1" }), { message: `${a.id} works on t1 already — follow up with it (agent_id ${a.id}), or leave task out` });
  // The one that works on it may be followed up naming it: a message, while it works.
  const told = await t.call({ agent_id: a.id, prompt: "Mind the empty line.", task: "t1" });
  assert.equal(told.ok, true, told.text);
  assert.equal(w.steers.at(-1)?.text, "Mind the empty line.");
  // A task the graph refuses is refused in its words.
  await assert.rejects(t.call({ agent_id: b.id, prompt: "And this.", task: "gone" }), { message: "gone is done — task names one that is still to do" });
  assert.deepEqual(took.map(([id, agent]) => [id, agent]), [["t1", a.id], ["t2", b.id], ["t1", a.id]]);
  ra.finish({ status: "done", report: "FIXED" });
  await w.registry.settled(a.id);
  // Its helper done, t1 may be another's follow-up.
  const moved = await t.call({ agent_id: b.id, prompt: "Finish t1.", task: "t1" });
  assert.equal(moved.ok, true, moved.text);
  assert.deepEqual(took.at(-1)?.slice(0, 2), ["t1", b.id]);
  const rb = await w.run(4);
  rb.attach();
  rb.finish({ status: "done", report: "DONE" });
  await w.registry.settled(b.id);
});

/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

// (fails before: yes — its box said "your folder": the follow-up read whether it had a WorkState yet, and a helper still
// opening its copy had none)
test("a coding agent's follow-up naming a task, to a helper still opening its own copy: its box says it works in its copy, once that is known", async () => {
  /** @type {[string, string, boolean][]} */
  const took = [];
  const w = watched({ sub: { worktree: true }, extra: { taskHelper: { refusal: () => null, took: (/** @type {string} */ _c, /** @type {string} */ id, /** @type {any} */ h) => void took.push([id, h.agent, h.copy]) } } });
  git(w.dir, "init", "-q");
  writeFileSync(join(w.dir, "parse.js"), "export const parse = () => [];\n");
  git(w.dir, "add", "-A");
  git(w.dir, "commit", "-qm", "init");
  const t = turnOf(w, { coder: true });
  const out = await t.call({ prompt: "fix parse() for an empty file" });
  assert.equal(out.ok, true, out.text);
  const id = String(w.registry.list("c1")[0]?.id);
  assert.equal(w.registry.get(id)?.status, "running");
  const told = await t.call({ agent_id: id, prompt: "This is t1.", task: "t1" });
  assert.equal(told.ok, true, told.text);
  const r = await w.run(1);
  r.attach();
  await until(() => took.length > 0, "its box to say who works on it");
  assert.deepEqual(took, [["t1", id, true]]);
  r.finish({ status: "done", report: "FIXED" });
  await w.registry.settled(id);
});

// (fails before: yes — the message went, and the helper was put on t2 as well: both boxes named it, and t2 ran on the
// steer's words alone)
test("a coding agent's follow-up to a helper at work on one task, naming another, is refused in words: one helper works on one task at a time", async () => {
  /** @type {[string, string][]} */
  const took = [];
  const w = watched({ extra: { taskHelper: { refusal: () => null, took: (/** @type {string} */ _c, /** @type {string} */ id, /** @type {any} */ h) => void took.push([id, h.agent]) } } });
  const t = turnOf(w, { coder: true });
  const a = await launched(w, t, 1, { task: "t1" });
  await until(() => took.length === 1, "t1's box");
  await assert.rejects(t.call({ agent_id: a.id, prompt: "Also do t2.", task: "t2" }), { message: `sub-agent ${a.id} works on t1 now: a message to it while it works stays with t1 — name t1 or leave task out, and launch another helper for t2` });
  assert.deepEqual(w.steers, [], "nothing sent");
  assert.deepEqual(took, [["t1", a.id]]);
  // t2 is free for another helper.
  const b = await launched(w, t, 2, { task: "t2" });
  await until(() => took.length === 2, "t2's box");
  assert.deepEqual(took.at(-1), ["t2", b.id]);
  // Its own task, or none, goes as a message still.
  assert.equal((await t.call({ agent_id: a.id, prompt: "Mind the empty line.", task: "t1" })).ok, true);
  assert.equal((await t.call({ agent_id: a.id, prompt: "And the trailing one." })).ok, true);
  a.r.finish({ status: "done", report: "FIXED" });
  b.r.finish({ status: "done", report: "DONE" });
  await w.registry.settled(a.id);
  await w.registry.settled(b.id);
});

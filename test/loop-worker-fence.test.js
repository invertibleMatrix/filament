// @ts-check
// HarnessV3-TaskGraph-v2 TG2-D38 for a worker on Filament's own loop (TG2-D55's drive found it): a worker in its own
// worktree is held to it in every mode, Auto included — a change of a file outside its worktree, a read or a search of
// the developer's folder outside it, and a command that reaches the developer's folder, by its path or by climbing out
// of its worktree, are refused before any mode or rule is asked, in the words a coding agent's worker reads. A command
// that only says the path, and its work inside its worktree, run as the mode says. The session's own agent and a worker
// that shares the folder are not fenced: they keep their mode.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { strayWords } from "../src/app/agent-permits.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
/** @param {string} p */
const fwd = (p) => p.split(sep).join("/");
/** The developer's folder and a worker's worktree in it, as Filament places one. */
const places = () => {
  const folder = mkdtempSync(join(tmpdir(), "filament-loop-fence-"));
  made.push(folder);
  const worktree = join(folder, ".git", "filament-worktrees", "sa_1");
  mkdirSync(worktree, { recursive: true });
  return { folder, worktree };
};

/**
 * One turn on Filament's loop in `root` that makes `calls`, one a round, under `mode`. `fence`: the developer's folder a
 * worker in its own worktree is held off, or none; `hooks`: the session's hooks, or none. What its hands ran, each
 * call's answer and the record's notes.
 * @param {{ name: string, input: any }[]} calls
 * @param {{ root: string, fence: { folder: string } | null, mode?: string, hooks?: any }} o
 */
const turn = async (calls, { root, fence, mode = "auto", hooks = null }) => {
  /** @type {[string, string][]} */
  const ran = [];
  /** @type {{ text: string, error: boolean }[]} */
  const answers = [];
  let n = 0;
  const out = await runAgentTurn(
    /** @type {any} */ ({
      model: "m",
      messages: [{ role: "user", content: "fix it" }],
      system: "s",
      tools: toolSetFor({ delegateRead: true }),
      modeNow: () => mode,
      root,
      readerModel: "",
      maxTokens: 100,
      unattended: "worker",
      call: async (/** @type {any} */ { body }) => {
        const last = body?.messages?.at(-1);
        for (const b of Array.isArray(last?.content) ? last.content : []) if (b.type === "tool_result") answers.push({ text: String(typeof b.content === "string" ? b.content : JSON.stringify(b.content)), error: !!b.is_error });
        const c = calls[n++];
        const content = c ? [{ type: "tool_use", id: `b${n}`, name: c.name, input: c.input }] : [{ type: "text", text: "Done." }];
        return { ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null };
      },
      costOf: () => 0,
      runHand: async (/** @type {string} */ name, /** @type {any} */ input) => {
        ran.push([name, String(input.command ?? input.path ?? "")]);
        return "ok";
      },
      delegateRead: async (/** @type {string[]} */ paths) => {
        ran.push(["delegate_read", paths.join(",")]);
        return { text: "ok", requestId: null };
      },
      mailbox: null,
      permissions: null,
      rules: [],
      grants: null,
      fence,
      hooks,
      tree: null,
      onEvent: () => {},
      previewChars: 0,
      sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() {}, count() { return 0; } },
      signal: null,
      resume: null,
    }),
  );
  return { out, ran, answers };
};

// (fails before: yes — under Auto a worker's hands and commands reached the developer's folder: in the drive, a Flash
// lead stuck on a flaky check had its workers write their change there, past the apply and the folder's check)
test("a worker on Filament's loop in its own worktree, under Auto: a change outside it, a read or search of your folder, and a command that reaches your folder are refused in a coding agent's worker's words; its own work runs", async () => {
  const { folder, worktree } = places();
  const mine = join(folder, "value.js");
  const calls = [
    { name: "write", input: { path: mine, content: "export const v = 1;\n" } },
    { name: "edit", input: { path: fwd(mine), edits: [{ oldText: "1", newText: "2" }] } },
    { name: "bash", input: { command: `cp value.js "${fwd(folder)}/value.js"` } },
    { name: "bash", input: { command: "cd ../../.. && npm test" } },
    { name: "bash", input: { command: `ls -la /tmp/${basename(folder)}/` } },
    { name: "read", input: { path: mine } },
    { name: "grep", input: { pattern: "stockValue", path: fwd(folder) } },
    { name: "write", input: { path: "value.js", content: "export const v = 1;\n" } },
    { name: "read", input: { path: "value.js" } },
    { name: "grep", input: { pattern: "stockValue", path: "." } },
    { name: "bash", input: { command: "npm test" } },
    { name: "bash", input: { command: `echo "${fwd(folder)}"` } },
  ];
  const { out, ran, answers } = await turn(calls, { root: worktree, fence: { folder } });
  assert.deepEqual(ran, [
    ["write", "value.js"],
    ["read", "value.js"],
    ["grep", "."],
    ["bash", "npm test"],
    ["bash", `echo "${fwd(folder)}"`],
  ]);
  assert.equal(answers.length, calls.length);
  const said = answers.map((a) => a.text);
  assert.equal(said[0], strayWords({ path: mine }, worktree, folder));
  assert.match(said[0], /^Filament refused your change to .*value\.js: that is the developer's folder, and you work in your own worktree\. The same file is .*sa_1.value\.js — read and change that one\./);
  assert.equal(said[1], strayWords({ path: fwd(mine) }, worktree, folder));
  assert.equal(said[2], strayWords({ command: calls[2].input.command }, worktree, folder));
  assert.match(said[2], /^Filament refused your command: it reaches the developer's folder/);
  assert.equal(said[3], strayWords({ command: "cd ../../.. && npm test" }, worktree, folder));
  // The folder by Git Bash's name for the temp folder it lies in (TG2-D55's fourth drive).
  assert.equal(said[4], strayWords({ command: calls[4].input.command }, worktree, folder));
  assert.equal(said[5], strayWords({ path: mine, read: "file" }, worktree, folder));
  assert.equal(said[6], strayWords({ path: fwd(folder), read: "search" }, worktree, folder));
  assert.deepEqual(answers.map((a) => a.error), [true, true, true, true, true, true, true, false, false, false, false, false]);
  for (const name of ["write", "edit", "bash", "read", "grep"]) assert.ok(out.notes.some((x) => x.startsWith(`agent: ${name} refused — `) && x.includes("outside the worktree it works in")), `${name}: ${out.notes.join("\n")}`);
});

// (fails before: yes — the same)
test("a background command that climbs out of the worktree, and a delegated read of your folder, are refused too; a delegated read of the worktree runs", async () => {
  const { folder, worktree } = places();
  const mine = join(folder, "value.js");
  const { ran, answers } = await turn(
    [
      { name: "bash_background", input: { command: "cd ../../.. && npm run dev" } },
      { name: "delegate_read", input: { paths: ["value.js", mine], question: "what is v?" } },
      { name: "delegate_read", input: { paths: ["value.js"], question: "what is v?" } },
    ],
    { root: worktree, fence: { folder } },
  );
  assert.deepEqual(ran, [["delegate_read", "value.js"]]);
  assert.equal(answers[0].text, strayWords({ command: "cd ../../.. && npm run dev" }, worktree, folder));
  assert.equal(answers[1].text, strayWords({ path: mine, read: "file" }, worktree, folder));
  assert.deepEqual(answers.map((a) => a.error), [true, true, false]);
});

// (fails before: yes — the mode asked first, and a yes put the change past the apply)
test("the fence comes before the mode: in Edit a change of your folder is refused, never asked about", async () => {
  const { folder, worktree } = places();
  const { ran, answers } = await turn([{ name: "write", input: { path: join(folder, "a.js"), content: "x" } }], { root: worktree, fence: { folder }, mode: "edit" });
  assert.deepEqual(ran, []);
  assert.equal(answers[0].text, strayWords({ path: join(folder, "a.js") }, worktree, folder));
});

// (fails before: yes — the bug hunt of 10-30, PERM-5: a pre-tool hook's rewrite was judged by the deny rules alone, so a
// hook that pointed a worker's write at the developer's folder took the write past the fence)
test("a call a pre-tool hook rewrote meets the fence again: a write it points at your folder is refused, one it keeps in the worktree runs", async () => {
  const { folder, worktree } = places();
  const mine = join(folder, "value.js");
  const hooks = {
    pre: async (/** @type {string} */ _tool, /** @type {any} */ input) => [{ on: "pre-tool", tool: "write", command: "fix-paths", ms: 1, exit: 0, verdict: "allow", note: "", args: { ...input, path: input.path === "out.js" ? mine : "kept.js" }, timedOut: false }],
    post: async () => [],
    turnEnd: async () => [],
    sessionStart: async () => [],
    readBackBeforeDone: false,
  };
  const { out, ran, answers } = await turn(
    [
      { name: "write", input: { path: "out.js", content: "export const v = 1;\n" } },
      { name: "write", input: { path: "in.js", content: "export const v = 2;\n" } },
    ],
    { root: worktree, fence: { folder }, hooks },
  );
  assert.deepEqual(ran, [["write", "kept.js"]], "only the rewrite that stays in the worktree ran");
  assert.equal(answers[0].text, `Not run: a pre-tool hook rewrote the call, and ${strayWords({ path: mine }, worktree, folder)}`);
  assert.deepEqual(answers.map((a) => a.error), [true, false]);
  assert.ok(out.notes.some((x) => x.startsWith("agent: write refused — ") && x.endsWith(", after a pre-tool hook rewrote it")), out.notes.join("\n"));
});

// (fails before: no — kept: the fence holds a worker in its own worktree alone)
test("the session's own agent, and a worker that shares the folder, are not fenced: under Auto they write and run as before", async () => {
  const { folder } = places();
  const { ran } = await turn(
    [
      { name: "write", input: { path: join(folder, "a.js"), content: "x" } },
      { name: "bash", input: { command: `cp a.js b.js` } },
    ],
    { root: folder, fence: null },
  );
  assert.deepEqual(ran, [
    ["write", join(folder, "a.js")],
    ["bash", "cp a.js b.js"],
  ]);
});

// @ts-check
// HarnessV4_Four_Plan E20, the server: the chat's outputs — the files its agents wrote that git does not show, outside
// any repository or ignored by its git — read from the rounds its turns recorded, each as it stands now; the route
// that answers them; and Show in folder's refusals (its success opens the file manager, never in a test). Every folder
// is a throwaway under the temp folder.
// (fails before: yes — nothing listed these files apart: Changes held them at an agent's foot, and an ignored file
// the agent wrote was nowhere)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { outputsOf } from "../src/app/sessions/outputs.js";
import { ignoredOf } from "../src/adapters/git/inspect.js";
import { fakeUpstream, anthropicReply, startApp } from "./helpers/app.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();
/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made.reverse()) rmSync(d, { recursive: true, force: true });
});
/** A folder no repository holds. @param {string} prefix */
const plain = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
/** A repository with one commit and its ignore file. @param {string} prefix @param {string} ignore */
const repo = (prefix, ignore) => {
  const dir = plain(prefix);
  git(dir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, ".gitignore"), ignore);
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);
  return dir;
};
/** @param {string} path @param {string} text */
const put = (path, text) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};
/**
 * A round's row as the archive answers one. @param {string} place @param {string[]} own @param {number} turn
 * @param {string} [agent]
 * @returns {import("../src/core/types.js").RoundChange}
 */
const row = (place, own, turn, agent = "") => ({ place, round: 1, agent, before: null, after: place ? "x" : null, base: place ? "round" : "none", own, command: false, turn });

describe("the list, from the rounds", { skip: !hasGit && "git is not on PATH" }, () => {
  test("outside any repository: newest first, one row a file whoever wrote it last; one gone is named apart (FOC-35, FOC-37, FOC-50)", async () => {
    const dir = plain("filament-out-plain-");
    const a = join(dir, "notes.md");
    const b = join(dir, "pics", "chart.svg");
    const gone = join(dir, "gone.txt");
    put(a, "# notes\n");
    put(b, "<svg/>");
    const out = await outputsOf([row("", [a], 1), row("", [b, gone], 2, "sa_1"), row("", [a.replace(/\\/g, "/")], 3, "sa_2")]);
    assert.deepEqual(
      out.files.map((f) => [f.name, f.folder, f.size, f.agent, f.turn, f.ignoredIn]),
      [
        ["notes.md", dir, 8, "sa_2", 3, null],
        ["chart.svg", join(dir, "pics"), 6, "sa_1", 2, null],
      ],
      "notes.md once, by turn 3's writer, though turn 3 spelled it with forward slashes",
    );
    assert.ok(out.files.every((f) => f.mtimeMs > 0));
    assert.deepEqual(out.gone, [{ path: gone, agent: "sa_1", turn: 2 }]);
    assert.deepEqual(out.errors, []);
  });

  test("inside a repository only what its git ignores; one written outside that a repository holds now is git's, unless ignored (FOC-36, FOC-38)", async () => {
    const dir = repo("filament-out-repo-", ".env\nbuild/\n");
    const place = git(dir, ["rev-parse", "--show-toplevel"]);
    put(join(dir, ".env"), "KEY=1\n");
    put(join(dir, "src", "x.js"), "x\n");
    put(join(dir, "notes.md"), "n\n");
    put(join(dir, "build", "out.txt"), "o\n");
    put(join(dir, "a.txt"), "changed\n");
    const out = await outputsOf([
      row(place, [".env", "src/x.js", "a.txt"], 1),
      // Written when the folder was in no repository: it is in one now.
      row("", [join(dir, "notes.md"), join(dir, "build", "out.txt")], 2),
    ]);
    assert.deepEqual(
      out.files.map((f) => [f.name, f.turn, f.ignoredIn]),
      [
        ["out.txt", 2, place],
        [".env", 1, place],
      ],
      "src/x.js (untracked), a.txt (tracked) and notes.md are git's: Changes shows them",
    );
    assert.deepEqual([out.gone, out.errors], [[], []]);
    const checked = await ignoredOf(place, [".env", "src/x.js", "a.txt", "build/out.txt", "nowhere/never.txt"]);
    assert.deepEqual([[...checked.ignored].sort(), checked.error], [[".env", "build/out.txt"], null]);
  });

  test("a place git cannot read is said in words; a deleted file inside a repository is git's (FOC-37)", async () => {
    const dir = repo("filament-out-err-", "");
    const place = git(dir, ["rev-parse", "--show-toplevel"]);
    const out = await outputsOf([row(place, ["deleted.txt"], 1)]);
    assert.deepEqual([out.files, out.gone, out.errors], [[], [], []], "a file a repository held and that is gone is Changes' deletion");
    const notRepo = plain("filament-out-notrepo-");
    put(join(notRepo, "k.txt"), "k\n");
    const bad = await outputsOf([row(notRepo, ["k.txt"], 1)]);
    assert.equal(bad.files.length, 0);
    assert.equal(bad.errors.length, 1);
    assert.equal(bad.errors[0].place, notRepo);
    assert.match(bad.errors[0].error, /not a git repository|git check-ignore/i);
  });
});

describe("the route against a real app", { skip: !hasGit && "git is not on PATH" }, () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
  before(async () => {
    root = plain("filament-out-app-");
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: true };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });

  test("GET /api/memory/sessions/:id/outputs: what the chat's agent wrote in a folder with no git; then git there takes them (FOC-35, FOC-36, FOC-37)", async () => {
    let round = 0;
    brain = () => {
      round++;
      if (round === 1) return reply([toolUse("w1", "write", { path: "notes.md", content: "first\n" })], "tool_use");
      if (round === 2) return reply([toolUse("w2", "write", { path: "pics/a.svg", content: "<svg/>\n" })], "tool_use");
      return reply([{ type: "text", text: "Done." }]);
    };
    const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 400, messages: [{ role: "user", content: "write" }] }, { "x-filament-cwd": root, "x-session-id": "out-session" });
    assert.equal(r.status, 200, await r.clone().text());
    const rec = await shim.record(String(r.headers.get("x-filament-request-id")));
    const chain = rec.memory.chain;
    const read = async () => (await shim.api(`/api/memory/sessions/${chain}/outputs`)).json();
    const first = await read();
    assert.equal(first.chainId, chain);
    assert.deepEqual(
      first.files.map((/** @type {any} */ f) => [f.name, f.folder, f.agent, f.turn, f.ignoredIn]),
      [
        ["a.svg", join(root, "pics"), "", rec.memory.turn, null],
        ["notes.md", root, "", rec.memory.turn, null],
      ],
      JSON.stringify(first),
    );
    unlinkSync(join(root, "notes.md"));
    const second = await read();
    assert.deepEqual([second.files.map((/** @type {any} */ f) => f.name), second.gone.map((/** @type {any} */ g) => g.path)], [["a.svg"], [join(root, "notes.md")]]);
    git(root, ["init", "-q", "-b", "main"]);
    assert.deepEqual((await read()).files, [], "git there now: its files are Changes'");
    writeFileSync(join(root, ".gitignore"), "pics/\n");
    assert.deepEqual((await read()).files.map((/** @type {any} */ f) => [f.name, f.ignoredIn]), [["a.svg", git(root, ["rev-parse", "--show-toplevel"])]], "ignored by it: Outputs' again");
    assert.equal((await shim.api("/api/memory/sessions/nope/outputs")).status, 404);
  });

  test("POST /api/files/reveal refuses in words: no path, a relative one, one not there, one outside the folders the agent may work in", async () => {
    const reveal = async (/** @type {any} */ body) => {
      const res = await shim.api("/api/files/reveal", { method: "POST", body });
      return [res.status, (await res.json()).error];
    };
    assert.deepEqual(await reveal({}), [400, "path is required: a whole path"]);
    assert.deepEqual(await reveal({ path: "notes.md" }), [400, "path is required: a whole path"]);
    const missing = join(root, "never.txt");
    assert.deepEqual(await reveal({ path: missing }), [404, `no such file: ${missing}`]);
    const elsewhere = plain("filament-out-elsewhere-");
    put(join(elsewhere, "x.txt"), "x\n");
    const [status, error] = await reveal({ path: join(elsewhere, "x.txt") });
    assert.equal(status, 403);
    assert.match(error, /is not under any folder listed in agentLoop\.roots/);
  });
});

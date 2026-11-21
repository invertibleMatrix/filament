// @ts-check
// HarnessV4_Git_Plan §11: where the agent works now, live, before it writes. Each call's folder (core/call-place.js:
// a file tool's path, a command's leading `cd`, the folder a coding agent says it ran in), its place from git, said on
// the run once per move (app/now-in.js) — by Filament's own loop as a call runs, by a coding agent's run as its call
// starts; the page's fold and header read the newest (`alignEvents`' `place`, `liveWords`, the header's chip).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { leadingFolders } from "../src/core/tool-vocab.js";
import { callPlace } from "../src/core/call-place.js";
import { commandCall } from "../src/core/codex-items.js";
import { createNowIn } from "../src/app/now-in.js";
import { createAgentRun } from "../src/app/agent-run.js";
import { alignEvents, liveWords } from "../src/ui/harness/lib/labels.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** The page's admin reads (`/api/…`), answered by a stand-in; any other address goes out. */
let serve = (/** @type {string} */ _url) => /** @type {any} */ (undefined);
/** The addresses the page asked for, in order. @type {string[]} */
const asked = [];
const realFetch = g.fetch;
g.fetch = async (/** @type {any} */ url, /** @type {any} */ init) => {
  if (typeof url !== "string" || !url.startsWith("/api/")) return realFetch(url, init);
  asked.push(url);
  const body = serve(url);
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { createHeader } = await import("../src/ui/harness/header.js");

const WIN = process.platform === "win32";
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
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
  g.fetch = realFetch;
  for (const d of made.reverse()) rmSync(d, { recursive: true, force: true });
});
/** A folder no repository holds. @param {string} prefix */
const plain = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
/** A repository with one commit, and a worktree of it in a folder beside: `{ main, wt }`. @param {string} prefix */
const repoAndWorktree = (prefix) => {
  const main = plain(`${prefix}main-`);
  run(main, ["init", "-q", "-b", "main"]);
  writeFileSync(join(main, "a.txt"), "one\n");
  run(main, ["add", "."]);
  run(main, ["commit", "-q", "-m", "init"]);
  const wt = join(plain(`${prefix}wt-`), "wt");
  run(main, ["worktree", "add", "-q", "-b", "wt", wt]);
  return { main, wt };
};
/** The place a folder is in, as git spells it. @param {string} dir */
const top = (dir) => run(dir, ["rev-parse", "--show-toplevel"]);

// (fails before: yes — no reader of a command's leading folders; the card's label only cut them off)
test("a command's leading folders: as written, their shell left out; null where one cannot be read", () => {
  assert.deepEqual(leadingFolders("npm test"), []);
  assert.deepEqual(leadingFolders("cd /h/wt && npm test"), ["/h/wt"]);
  assert.deepEqual(leadingFolders('cd "H:\\my wt" ; npm test'), ["H:\\my wt"]);
  assert.deepEqual(leadingFolders("cd a && cd b && make"), ["a", "b"]);
  assert.deepEqual(leadingFolders("cd /h/wt"), ["/h/wt"], "a cd alone: a coding agent's shell stays there");
  assert.deepEqual(leadingFolders("cd /h/wt\nnpm test"), ["/h/wt"]);
  assert.deepEqual(leadingFolders("Set-Location -Path 'H:\\wt'; npm test"), ["H:\\wt"]);
  assert.deepEqual(leadingFolders(`bash -lc "cd /h/wt && npm test"`), ["/h/wt"]);
  assert.equal(leadingFolders("cd x || exit 1"), null, "the rest runs only where the cd fails");
  assert.equal(leadingFolders("cd"), null, "the home folder");
});

describe("a call's folder (callPlace, GW-D64)", () => {
  const root = resolve(WIN ? "H:/main" : "/work/main");
  const wt = resolve(WIN ? "H:/wt" : "/work/wt");

  // (fails before: yes — no reader of where a call works)
  test("Filament's own hands: a file's path, relative from the chat's folder; a command where its cd takes it, else the chat's folder", () => {
    /** @param {string} name @param {any} input */
    const at = (name, input) => callPlace(name, input, { root, fresh: true });
    assert.equal(at("read", { path: "src/a.js" }), join(root, "src", "a.js"));
    assert.equal(at("edit", { path: join(wt, "b.js"), edits: [] }), join(wt, "b.js"));
    assert.equal(at("bash", { command: "npm test" }), root, "each command starts in the chat's folder");
    assert.equal(at("bash", { command: `cd ${wt} && npm test` }), wt);
    assert.equal(at("bash", { command: "cd ../wt && npm test" }), resolve(root, "../wt"));
    assert.equal(at("powershell", { command: `Set-Location "${wt}"; npm test` }), wt);
    assert.equal(at("grep", { pattern: "x" }), root, "a search with no folder searches the chat's");
    assert.equal(at("glob", { pattern: "*.js", path: "src" }), join(root, "src"));
    assert.equal(at("bash_output", { id: "b1" }), null, "a background shell's read names no folder");
    assert.equal(at("web_fetch", { url: "https://example.com" }), null);
    assert.equal(at("bash", { command: "cd $DIR && make" }), null, "a folder in a variable is not known");
  });

  test("Git Bash's and WSL's spelling of a drive, on a host with drives", { skip: !WIN && "drives are Windows'" }, () => {
    /** @param {string} command */
    const at = (command) => callPlace("Bash", { command }, { root, fresh: true });
    assert.equal(at("cd /h/wt && npm test"), resolve("H:/wt"));
    assert.equal(at("cd /mnt/h/wt; ls"), resolve("H:/wt"));
    assert.equal(at("cd /tmp && ls"), null, "the shell's own root is not known");
    assert.equal(at("cd ~/x && ls"), null);
  });

  test("a coding agent's: its own vocabulary, its locations, the folder it ran in; a command naming none says nothing", () => {
    /** @param {string} name @param {any} input @param {any[]} [locations] */
    const at = (name, input, locations = []) => callPlace(name, input, { root, locations, fresh: false });
    assert.equal(at("Read", { file_path: join(wt, "a.js") }), join(wt, "a.js"));
    assert.equal(at("Bash", { command: "npm test" }), null, "its shell may stand where an earlier cd took it");
    assert.equal(at("Bash", { command: "cd src && npm test" }), null, "a relative cd from where it stands");
    assert.equal(at("Bash", { command: `cd ${wt} && cd src && npm test` }), join(wt, "src"));
    assert.equal(at("bash", { command: "npm test", cwd: wt }), wt, "the folder Codex says it ran in");
    assert.equal(at("read", {}, [{ path: join(wt, "c.js") }]), join(wt, "c.js"));
    assert.equal(at("Grep", { pattern: "x" }), null);
  });

  // (fails before: yes — GW-D68: the folder Codex ran a command in was dropped)
  test("Codex's command carries the folder it ran in", () => {
    assert.deepEqual(commandCall({ command: "npm test", cwd: wt, commandActions: [{ type: "unknown" }] }).rawInput, { command: "npm test", cwd: wt });
    assert.deepEqual(commandCall({ command: "cat a.js", cwd: wt, commandActions: [{ type: "read", path: "a.js" }] }).rawInput, { file_path: "a.js", cwd: wt });
    assert.deepEqual(commandCall({ command: "make", commandActions: [] }).rawInput, { command: "make" }, "none said, none carried");
    assert.equal(callPlace("read", commandCall({ command: "cat a.js", cwd: wt, commandActions: [{ type: "read", path: "a.js" }] }).rawInput, { root }), join(wt, "a.js"));
  });
});

describe("where the agent works now, against throwaway repositories (GW-D67)", { skip: !hasGit && "git is not on PATH" }, () => {
  /** @type {{ main: string, wt: string }} */
  let r;
  /** @type {string} */
  let outside;
  before(() => {
    r = repoAndWorktree("filament-nowin-");
    outside = plain("filament-nowin-out-");
  });

  // (fails before: yes — nothing said where the agent worked before a write)
  test("said once per move, in the order the calls started; the chat's folder only once the agent worked elsewhere", async () => {
    /** @type {any[]} */
    const said = [];
    const now = createNowIn({ root: r.main, publish: (e) => said.push(e), fresh: true });
    await now.saw(1, { id: "r0", name: "read", input: { path: "a.txt" } });
    assert.deepEqual(said, [], "working in the chat's folder says nothing");
    await Promise.all([
      now.saw(1, { id: "r1", name: "read", input: { path: join(r.wt, "a.txt") } }),
      now.saw(1, { id: "r2", name: "grep", input: { pattern: "x", path: join(r.wt, "not", "made", "yet") } }),
      now.saw(2, { id: "b1", name: "bash", input: { command: "git status" } }),
      now.saw(2, { id: "r3", name: "read", input: { path: join(outside, "x.txt") } }),
      now.saw(2, { id: "f1", name: "web_fetch", input: { url: "https://example.com" } }),
      now.saw(3, { id: "b2", name: "bash", input: { command: `cd "${r.wt}" && npm test` } }),
    ]);
    assert.deepEqual(said, [
      { type: "place", round: 1, id: "r1", place: top(r.wt), home: false },
      { type: "place", round: 2, id: "b1", place: top(r.main), home: true },
      { type: "place", round: 3, id: "b2", place: top(r.wt), home: false },
    ]);
  });

  test("a chat whose own folder is the worktree: the main folder is the elsewhere (GWC-156)", async () => {
    /** @type {any[]} */
    const said = [];
    const now = createNowIn({ root: r.wt, publish: (e) => said.push(e), fresh: true });
    await now.saw(1, { id: "r1", name: "read", input: { path: join(r.main, "a.txt") } });
    assert.deepEqual(said, [{ type: "place", round: 1, id: "r1", place: top(r.main), home: false }]);
  });

  // (fails before: yes — a coding agent's run said nothing of where its calls worked)
  test("a coding agent's run: its main agent's calls as they start, by its own vocabulary; a bare command leaves it", async () => {
    /** @type {any[]} */
    const events = [];
    const agent = createAgentRun({ publish: (e) => events.push(e), sink: { breakBlock: () => 0 }, root: r.main, saysPlace: true });
    agent.take({ type: "tool", id: "c1", toolName: "Bash", title: `cd ${r.wt} && npm test`, kind: "execute", status: "in_progress", rawInput: { command: `cd "${r.wt}" && npm test` } });
    agent.take({ type: "tool", id: "c2", toolName: "Bash", title: "git status", kind: "execute", status: "in_progress", rawInput: { command: "git status" } });
    agent.take({ type: "tool", id: "c3", toolName: "Read", title: "Read a.txt", kind: "read", status: "in_progress", rawInput: { file_path: join(r.main, "a.txt") } });
    await until(() => events.filter((e) => e.type === "place").length === 2, "two moves said");
    assert.deepEqual(events.filter((e) => e.type === "place").map((e) => [e.id, e.place, e.home]), [["c1", top(r.wt), false], ["c3", top(r.main), true]]);
    assert.ok(events.findIndex((e) => e.type === "tool-start" && e.id === "c1") < events.findIndex((e) => e.type === "place"), "the call first");
  });

  // (fails before: not every time — git was asked of the chat's folder as the turn began and stood in it, so on Windows
  // a folder removed as such a turn ended could not go; the removal races git's start: 1 of 5 in a probe, and EPERM
  // in the suite's agent-instructions and views-close)
  test("a turn whose calls name no place runs no git in the chat's folder", { skip: !WIN && "only Windows holds a folder a process stands in" }, async () => {
    const dir = plain("filament-nowin-quiet-");
    const now = createNowIn({ root: dir, publish: () => assert.fail("nothing to say"), fresh: true });
    await now.saw(1, { id: "f1", name: "web_fetch", input: { url: "https://example.com" } });
    rmSync(dir, { recursive: true });
  });

  test("a sub-agent's run, or one that does not say, says none (GW-D66)", async () => {
    /** @type {any[]} */
    const events = [];
    const agent = createAgentRun({ publish: (e) => events.push(e), sink: { breakBlock: () => 0 }, root: r.main });
    agent.take({ type: "tool", id: "c1", toolName: "Read", title: "Read a.txt", kind: "read", status: "in_progress", rawInput: { file_path: join(r.wt, "a.txt") } });
    await new Promise((res) => setTimeout(res, 300));
    assert.deepEqual(events.filter((e) => e.type === "place"), []);
  });
});

describe("Filament's own agent says where it works, against a real app (GW-D64)", { skip: !hasGit && "git is not on PATH" }, () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {{ main: string, wt: string }} */
  let r;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
  before(async () => {
    r = repoAndWorktree("filament-nowin-app-");
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [r.main, resolve(r.wt, "..")], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });

  // (fails before: yes — the run carried no word of where the agent worked)
  test("a read in the worktree, then a command in the chat's folder: two moves on the run, in order", async () => {
    let round = 0;
    brain = () => {
      round++;
      if (round === 1) return reply([toolUse("r1", "read", { path: join(r.wt, "a.txt") })], "tool_use");
      if (round === 2) return reply([toolUse("b1", "bash", { command: "git status --short" })], "tool_use");
      return reply([{ type: "text", text: "Looked." }]);
    };
    const res = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 400, messages: [{ role: "user", content: "look" }] }, { "x-filament-cwd": r.main, "x-session-id": "nowin-1" });
    assert.equal(res.status, 200, await res.clone().text());
    const id = res.headers.get("x-filament-request-id");
    await res.json();
    const events = (await (await shim.api(`/api/runs/${id}/events?since=0&limit=500`)).json()).events || [];
    assert.deepEqual(events.filter((/** @type {any} */ e) => e.type === "place").map((/** @type {any} */ e) => [e.round, e.id, e.place, e.home]), [
      [1, "r1", top(r.wt), false],
      [2, "b1", top(r.main), true],
    ]);
  });
});

describe("the page reads it (GW-D65)", () => {
  const start = (/** @type {number} */ round, /** @type {string} */ id, /** @type {string} */ name, /** @type {string} */ args) => ({ type: "tool-start", round, id, name, args, card: { kind: name === "bash" ? "shell" : "read", title: "", subject: args } });

  // (fails before: yes — the fold said what the agent did, never where)
  test("the live fold leads with where, once the agent worked outside the chat's folder; back home it says so", () => {
    const tool = start(1, "b1", "bash", "npm test");
    assert.equal(liveWords(alignEvents([tool])), "running npm test", "nothing said, nothing shown");
    const away = alignEvents([tool, { type: "place", round: 1, id: "b1", place: "H:/filament-wt", home: false }]);
    assert.deepEqual(away.place, { place: "H:/filament-wt", home: false });
    assert.equal(liveWords(away), "in filament-wt · running npm test");
    const back = alignEvents([tool, { type: "place", round: 1, id: "b1", place: "H:/filament-wt", home: false }, { type: "tool-end", round: 1, id: "b1", name: "bash", ok: true }, { type: "place", round: 2, place: "H:/filament", home: true }]);
    assert.match(liveWords(back), /^in filament( · |$)/, "back in the chat's folder, said");
  });

  // (fails before: yes — the header named the chat's folder alone while the agent worked elsewhere; proposal_ux M2: one
  // chip says it, where the branch, "now in" and "also" chips stood side by side)
  test("the one place chip the header reads, under the box: the chat's branch and its other places; while the agent works elsewhere, that place, live, its branch once read", async () => {
    const doc = stubDocument();
    serve = (url) => {
      if (!url.startsWith("/api/git/place?")) return undefined;
      const cwd = new URL(url, "http://x").searchParams.get("cwd");
      return cwd === "H:/filament-wt"
        ? { ok: true, cwd, place: "H:/filament-wt", worktree: true, branch: "filament-agent", also: [] }
        : { ok: true, cwd, place: "H:/filament", branch: "main", also: [{ ok: true, cwd: "H:/filament-wt", place: "H:/filament-wt", worktree: true, branch: "filament-agent" }] };
    };
    asked.length = 0;
    try {
      const noop = () => {};
      const hd = createHeader({ onFork: noop, onReload: noop, onRenamed: noop, onArchived: noop, onToast: noop, getChat: () => null });
      const chip = /** @type {any} */ (hd.place).querySelector(".place-chip");
      const name = chip.querySelector(".place-name");
      const more = chip.querySelector(".place-more");
      const says = () => [name.textContent, more.textContent, chip.classList.contains("away")];
      assert.equal(/** @type {any} */ (hd.place).querySelectorAll(".place-chip").length, 1, "one chip");
      // The folder as its field holds it (the stub's field fires no input event).
      /** @type {any} */ (hd.folderIn).value = "H:/filament";
      hd.setChat({ id: "c", chainId: "ch", turns: [] });
      await until(() => !chip.classList.contains("hidden"), "the chip drawn");
      assert.deepEqual(says(), ["main", "+1", false], "no turn runs: the chat's branch, and the other place its agents wrote in");
      hd.setNow({ place: "H:/filament-wt", home: false });
      assert.deepEqual(says(), ["filament-wt", "", true], "the place the agent works in now; the other place is that one, so no +1");
      await until(() => name.textContent === "filament-agent", "its branch read");
      assert.ok(chip.classList.contains("away"));
      hd.setNow({ place: "H:/filament", home: true });
      assert.deepEqual(says(), ["main", "+1", false], "back in the chat's folder");
      hd.setNow(null);
      assert.deepEqual(says(), ["main", "+1", false]);
      assert.equal(asked.filter((u) => u.includes("H%3A%2Ffilament-wt") && !u.includes("chain=")).length, 1, "the place read once");
    } finally {
      serve = () => undefined;
      doc.restore();
    }
  });
});

// @ts-check
// WP-L: memory-backed permissions. The gate counts what the developer allows, offers an always-allow once at the
// threshold as a memory item, and lets a confirmed rule through without asking — per project, per call shape, never
// a blanket bash allow, never a compound command.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { permissionShape, RUNS_A_COMMAND } from "../src/services/memory/permissions.js";
import { covers, WRAPPERS } from "../src/app/agent/rules.js";

const text = (blocks) => (blocks || []).filter((b) => b?.type === "text").map((b) => b.text).join("");
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** A command that prints `words` and does more than read: in Edit mode one that only reads, `echo` among them, runs
 *  without asking (HarnessV3-Launch LD-D11). It runs the script each project's folder holds; its shape is
 *  `node say.js`. */
const say = (/** @type {string} */ words) => `node say.js ${words}`;

test("the shape a permission is learned under: a command's head and subcommand, a file's class; compound commands have none", () => {
  assert.deepEqual(permissionShape("bash", { command: "npm test" }), { tool: "bash", shape: "npm test", text: "bash: npm test" });
  assert.equal(permissionShape("bash", { command: "npm test -- --watch tests/x.js" })?.shape, "npm test", "flags and paths are not the shape");
  assert.equal(permissionShape("bash", { command: "git status -s" })?.shape, "git status");
  assert.equal(permissionShape("bash", { command: "node --test test/a.js" }), null, "a flag where the subcommand would be: no shape");
  assert.equal(permissionShape("bash", { command: "ls src/app" })?.shape, "ls", "a path is not a subcommand");
  assert.equal(permissionShape("bash", { command: "echo hi there" })?.shape, "echo", "echo takes arguments, not subcommands: one shape");
  assert.equal(permissionShape("bash", { command: "mkdir build" })?.shape, "mkdir");
  assert.equal(permissionShape("bash", { command: "./node_modules/.bin/vitest run" })?.shape, "./node_modules/.bin/vitest", "an unlisted tool keeps its head only");
  assert.equal(permissionShape("bash", { command: "C:\\tools\\git.exe status" })?.shape, "c:\\tools\\git.exe status", "the listed tool is recognised behind its path and extension; the path stays part of the shape");
  assert.equal(permissionShape("bash", { command: "NPM Test" })?.shape, "npm test", "case does not make a second shape");
  assert.equal(permissionShape("bash", { command: "npm publish" })?.shape, "npm publish", "another subcommand is another shape");
  for (const compound of ["npm test | tee out.txt", "npm test && rm -rf dist", "cat x; npm test", "echo hi > f", "npm test `whoami`", "npm $(echo test)", "npm test\nrm -rf /"])
    assert.equal(permissionShape("bash", { command: compound }), null, `never learned: ${JSON.stringify(compound)}`);
  assert.equal(permissionShape("bash", { command: "" }), null);
  assert.deepEqual(permissionShape("write", { path: "docs/NOTES.md" }), { tool: "write", shape: "*.md", text: "write: *.md" });
  assert.deepEqual(permissionShape("edit", { path: "src/a.test.JS" }), { tool: "edit", shape: "*.js", text: "edit: *.js" });
  assert.equal(permissionShape("write", { path: "Makefile" })?.shape, "(no extension)");
  assert.equal(permissionShape("read", { path: "x.js" }), null, "read never asks, so it has no shape");
});

test("a tool with subcommands whose subcommand can't be read has no shape, so no learned rule covers it (fails before: yes — `git -C x push` was learned as `git`, a rule for every flagged git command)", () => {
  for (const command of ["git -C x push", "git -c core.hooksPath=h commit -m x", "npm --prefix x publish", "node -e process.exit(1)"])
    assert.equal(permissionShape("bash", { command }), null, command);
  assert.equal(permissionShape("bash", { command: "git" })?.shape, "git", "the bare tool, with nothing after it, is a shape of its own");
  const learned = { tool: "bash", pattern: "git", verdict: "allow", learned: true };
  assert.equal(covers(/** @type {any} */ (learned), "git -C x push --force"), false);
  assert.equal(covers(/** @type {any} */ (learned), "git"), true);
});

// (fails before: yes — the bug hunt of 10-30, PERM-2: `python -c '…'` was learned as `python`, so an always-allow a
// `python test.py` brought let any program on the line through; a quoted `"/c"` and PowerShell's `/c`, `-co`, en dash
// and `--command` were read as no script at all)
test("an interpreter handed its program on the line has no shape, nor a shell whose switch is quoted or spelled another way it takes", () => {
  for (const command of [
    `python -c "import shutil"`,
    `python3 -Ic "print(1)"`,
    "python -cprint(1)",
    "py -3 -c print(1)",
    "C:\\Python312\\python.exe -c print(1)",
    "perl -e 'print 1'",
    "perl -lne 'print' notes.txt",
    "perl -pi -e s/a/b/ notes.txt",
    "ruby -e 'puts 1'",
    "php -r 'echo 1'",
    'cmd "/c" del x',
    "cmd /r del x",
    "cmd /d/c del x",
    "cmd /cdel x",
    `bash "-c" 'rm -rf build'`,
    "powershell '-Command' Remove-Item x",
    "powershell /c Remove-Item x",
    "powershell -co Remove-Item x",
    "pwsh --command Remove-Item x",
    "powershell \u2013c Remove-Item x",
    "pwsh -cwa 'Remove-Item $args' x",
  ])
    assert.equal(permissionShape("bash", { command }), null, command);
  // A script file is the program's own shape, as `bash build.sh` is the shell's.
  assert.equal(permissionShape("bash", { command: "python test.py" })?.shape, "python");
  assert.equal(permissionShape("bash", { command: "perl script.pl" })?.shape, "perl");
  assert.equal(permissionShape("bash", { command: "ruby build.rb" })?.shape, "ruby");
  assert.equal(permissionShape("bash", { command: "php artisan migrate" })?.shape, "php");
  assert.equal(permissionShape("bash", { command: "cmd /d" })?.shape, "cmd");
  const learned = { tool: "bash", pattern: "python", verdict: "allow", learned: true };
  assert.equal(covers(/** @type {any} */ (learned), "python test.py"), true);
  assert.equal(covers(/** @type {any} */ (learned), `python -c "import shutil"`), false, "the always-allow of a script covers no program on the line");
});

// (fails before: yes — the bug hunt of 10-30, PERM-2's siblings: `env`, `xargs`, `timeout`, `sudo`, an assignment or a
// variable as the head, awk with `system()` and find with `-exec` were each learned by their head, so one always-allow
// let every command they run through)
test("a head that runs the command its words name, an assignment or a variable head, awk that can run a command and find's acting actions have no shape", () => {
  for (const command of [
    `env X=1 python -c "import shutil"`,
    "xargs rm -rf",
    "timeout 5 rm -rf build",
    "nice -n 5 rm -rf build",
    "nohup rm -rf build",
    "sudo rm -rf /",
    "/usr/bin/env rm x",
    "command rm x",
    "exec rm x",
    "eval rm x",
    "busybox rm x",
    "start del x",
    "Invoke-Expression 'Remove-Item x'",
    "iex 'Remove-Item x'",
    "Start-Process cmd",
    "X=1 rm -rf build",
    "$EDITOR notes.txt",
    "%COMSPEC% del x",
    `awk 'BEGIN { system("rm x") }'`,
    `gawk '@load "filefuncs"' notes.txt`,
    "gawk -l filefuncs '{ print }' notes.txt",
    "gawk -i inplace '{ print }' notes.txt",
    "awk -f prog.awk notes.txt",
    "awk --file=prog.awk notes.txt",
    "find . -name x -exec rm {} +",
    "find . -delete",
    "find . -fprint list.txt",
  ])
    assert.equal(permissionShape("bash", { command }), null, command);
  // What stays a shape: awk and find that only read, and a program whose word merely starts like one of these.
  assert.equal(permissionShape("bash", { command: "awk '{ print $1 }' notes.txt" })?.shape, "awk");
  assert.equal(permissionShape("bash", { command: "awk -F: -v n=1 '{ print $n }' notes.txt" })?.shape, "awk");
  assert.equal(permissionShape("bash", { command: "find . -name '*.js'" })?.shape, "find");
  assert.equal(permissionShape("bash", { command: "envsubst notes.txt" })?.shape, "envsubst");
  assert.equal(permissionShape("bash", { command: "timeouts.sh" })?.shape, "timeouts.sh");
  for (const [pattern, command] of [["env", "env rm -rf build"], ["timeout", "timeout 5 rm -rf build"], ["find", "find . -exec rm {} +"], ["awk", `awk 'BEGIN { system("rm x") }'`]])
    assert.equal(covers(/** @type {any} */ ({ tool: "bash", pattern, verdict: "allow", learned: true }), command), false, `an always-allow of ${pattern} covers no ${command}`);
});

// (fails before: no — a guard: a deny or an ask reads past each wrapper the rules know to the command it runs, and each is
// one Always allow learns no shape for, so a wrapped command asks every time)
test("every wrapper a deny or an ask reads past is a head with no shape", () => {
  for (const w of Object.keys(WRAPPERS)) {
    assert.ok(RUNS_A_COMMAND.has(w), w);
    assert.equal(permissionShape("bash", { command: `${w} npm test` }), null, w);
  }
});

describe("learned permissions in the agent loop", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let rootA;
  /** @type {string} */
  let rootB;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    rootA = mkdtempSync(join(tmpdir(), "filament-perm-a-"));
    rootB = mkdtempSync(join(tmpdir(), "filament-perm-b-"));
    for (const root of [rootA, rootB]) writeFileSync(join(root, "say.js"), "console.log(process.argv.slice(2).join(' '));\n");
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: true };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = {
          enabled: true,
          permissions: "edit",
          roots: [rootA, rootB],
          readerModel: "",
          learnedPermissions: { afterApprovals: 3 },
        };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  });
  let n = 0;
  const session = (root) => ({ "x-filament-cwd": root, "x-session-id": `perm-${++n}` });
  const ask = (body, headers) => shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 400, stream: false, ...body }, headers);
  const eventsOf = async (runId) => (await (await shim.api(`/api/runs/${runId}/events?since=0&limit=5000`)).json()).events;
  const items = async () => (await (await shim.api("/api/memory/items?kind=permission&limit=50")).json()).items;

  /**
   * One turn that runs `command` through bash: the gate asks (edit mode), the developer says yes, the command runs.
   * Returns the second reply's content and the run ids.
   */
  const askAndAllow = async (root, command, answer = "/allow") => {
    const sess = session(root);
    let round = 0;
    brain = (call) => {
      round++;
      if (round === 1) return reply([toolUse(`b${n}`, "bash", { command })], "tool_use");
      const res = call.body.messages.at(-1).content.find((c) => c?.type === "tool_result");
      return reply([{ type: "text", text: res.is_error ? `declined: ${res.content}` : `ran: ${String(res.content).trim().slice(0, 40)}` }]);
    };
    const r1 = await ask({ messages: [{ role: "user", content: "run it" }] }, sess);
    if (r1.status !== 200) assert.fail(`HTTP ${r1.status}: ${await r1.text()}`);
    const j1 = await r1.json();
    if (!/May I run this command\?/.test(text(j1.content))) return { asked: false, content: j1.content, runIds: [r1.headers.get("x-filament-request-id")] };
    const r2 = await ask({ messages: [{ role: "user", content: "run it" }, { role: "assistant", content: j1.content }, { role: "user", content: answer }] }, sess);
    if (r2.status !== 200) assert.fail(`HTTP ${r2.status}: ${await r2.text()}`);
    return { asked: true, content: (await r2.json()).content, runIds: [r1.headers.get("x-filament-request-id"), r2.headers.get("x-filament-request-id")] };
  };

  test("below the threshold nothing is learned; at the threshold the offer appears once, as an inferred permission item named in the reply", async () => {
    up.reset();
    const first = await askAndAllow(rootA, say("one"));
    assert.equal(first.asked, true);
    assert.match(text(first.content), /^ran: one/);
    // (fails before: yes — HarnessV4_Tasks E3: the first question carried no always-allow until a yes made one an item)
    assert.deepEqual((await eventsOf(first.runIds[0])).find((e) => e.type === "ask")?.offer, { itemId: null, tool: "bash", shape: "node say.js" }, "Always allow is offered at the first ask, with no item yet");
    const second = await askAndAllow(rootA, `${say("two")} --flag`);
    assert.equal(second.asked, true);
    assert.equal((await items()).length, 0, "two approvals: nothing learned yet");
    assert.ok(!/always-allow/.test(text(second.content)));
    const third = await askAndAllow(rootA, say("three"));
    assert.equal(third.asked, true, "the third still asks — the rule is only offered, not yet confirmed");
    assert.match(text(third.content), /ran: three[\s\S]*\(Filament: You have allowed the command `node say.js` 3 times in this project\. An always-allow for it is waiting as a memory item/);
    const offered = await items();
    assert.equal(offered.length, 1);
    assert.equal(offered[0].text, "bash: node say.js");
    assert.equal(offered[0].status, "inferred");
    const evts = await eventsOf(third.runIds[1]);
    const offer = evts.find((e) => e.type === "permission-offer");
    assert.deepEqual({ tool: offer.tool, shape: offer.shape, count: offer.count, itemId: offer.itemId }, { tool: "bash", shape: "node say.js", count: 3, itemId: offered[0].id });
    // A fourth allow: still asks (inferred is not confirmed), and no second offer for the same shape.
    const fourth = await askAndAllow(rootA, say("four"));
    assert.equal(fourth.asked, true);
    assert.ok(!/always-allow/.test(text(fourth.content)), "offered once");
    assert.equal((await items()).length, 1);
    // (fails before: yes — the question carried no always-allow: the page offered its turn's newest offer alone)
    const asked = (await eventsOf(fourth.runIds[0])).find((e) => e.type === "ask");
    assert.deepEqual(asked?.offer, { itemId: offered[0].id, tool: "bash", shape: "node say.js" }, "the question carries the always-allow waiting for its shape, whichever turn offered it");
  });

  test("a confirmed rule lets the matching shape through without an ask, is scoped to its project, never generalises past its command shape; dismissing it brings the question back", async () => {
    const [item] = await items();
    const c = await shim.api(`/api/memory/items/${item.id}`, { method: "POST", body: { status: "confirmed" } });
    assert.equal(c.status, 200);
    up.reset();
    const free = await askAndAllow(rootA, say("five --loud"));
    assert.equal(free.asked, false, "no question: the learned rule covers `node say.js`");
    assert.match(text(free.content), /^ran: five --loud/);
    const evts = await eventsOf(free.runIds[0]);
    const end = evts.find((e) => e.type === "tool-end" && e.name === "bash");
    assert.equal(end.learned, true, "the timeline says it ran on a learned permission");
    assert.equal((await shim.record(free.runIds[0])).agent.learnedRuns, 1);
    // Another project: the rule does not apply.
    const other = await askAndAllow(rootB, say("elsewhere"));
    assert.equal(other.asked, true, "project B has no such rule");
    // Another shape under the same head: asks.
    const otherShape = await askAndAllow(rootA, `${say("x")} | cat`);
    assert.equal(otherShape.asked, true, "a compound command is never covered");
    let round = 0;
    brain = (call) => {
      round++;
      if (round === 1) return reply([toolUse("g1", "bash", { command: "git status" })], "tool_use");
      return reply([{ type: "text", text: "done" }]);
    };
    const r = await ask({ messages: [{ role: "user", content: "status" }] }, session(rootA));
    assert.match(text((await r.json()).content), /May I run this command\? `git status`/, "`git status` is not `node say.js`: it asks");
    // Dismissed: the question is back.
    const d = await shim.api(`/api/memory/items/${item.id}`, { method: "POST", body: { status: "dismissed" } });
    assert.equal(d.status, 200);
    const again = await askAndAllow(rootA, say("six"));
    assert.equal(again.asked, true, "dismissing the rule re-enables the ask");
    assert.ok(!/always-allow/.test(text(again.content)), "and a dismissed shape is not offered again");
    assert.equal((await eventsOf(again.runIds[0])).find((e) => e.type === "ask")?.offer, undefined, "nor does its question carry it");
    assert.equal((await items()).length, 1, "still the one item, dismissed");
  });

  test("a bash rule never becomes a blanket allow, and a declined answer teaches nothing", async () => {
    up.reset();
    const declined = await askAndAllow(rootB, "rm -rf build", "no, keep build");
    assert.equal(declined.asked, true);
    assert.match(text(declined.content), /^declined: Not run: the developer declined/);
    for (let i = 0; i < 3; i++) await askAndAllow(rootB, "rm -rf build", "no");
    assert.ok(!(await items()).some((it) => /rm/.test(it.text)), "three declines are not three approvals");
    assert.equal(existsSync(join(rootB, "build")), false);
    // (fails before: yes — the answer was read after memory added its block to the message, so the agent was told the
    // developer said memory's quote of a past /allow too: the memory plan's c3, which looks up any message with words)
    const quoted = await askAndAllow(rootB, "rm -rf build", "/allow please");
    assert.match(text(quoted.content), /^declined: Not run: the developer declined — "\/allow please"/, text(quoted.content));
    assert.ok(!text(quoted.content).includes("filament-memory"), "memory's block is no word of theirs");
  });
});

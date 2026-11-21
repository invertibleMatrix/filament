// @ts-check
// HarnessV4_Background_Plan §8 (E38): the commands a chat's agents run in the background, seen while they run — the
// chat's status capsule says "1 command running" with a row each and Stop; Now keeps the chat under Working; the
// person's Stop is told to the agent with its next turn, never woken for it.
import { test, after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { allCommands, commandRow, commandsOf, createBackgroundCommands, stopByPerson } from "../src/app/agent/commands.js";
import { disposeBackgroundShells, disposeSpills, onShellWake, onShellsChange, peekShellExits, runHand, tellShellExits } from "../src/adapters/tools/hands.js";
import { commandRows, commandsFact, commandsWord, ranWords } from "../src/ui/harness/lib/commands.js";
import { capsuleWords, createStatusCapsule } from "../src/ui/harness/conversation/status-panel.js";
import { ageOf, nowRows } from "../src/ui/harness/lib/now.js";
import { startApp } from "./helpers/app.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

after(async () => {
  await disposeBackgroundShells();
  disposeSpills();
});
const root = tmpdir();
/** A node one-liner, as the shell runs it. @param {string} js */
const node = (js) => `node -e "${js}"`;
const idOf = (/** @type {string} */ text) => (/bg_[0-9a-z]+/.exec(text) || [""])[0];
const allow = async () => ({ asked: false });

describe("the server: a chat's running commands, said at each start and end", () => {
  // (fails before: yes — nothing said a command was running between its start and its end)
  test("a coding agent's command: heard at its start and its end; its row has its command, its newest line, its output's file", async () => {
    /** @type {string[]} */
    const heard = [];
    const off = onShellsChange((s) => heard.push(s));
    try {
      const commands = createBackgroundCommands({ registry: () => ({ commandEnd: () => ({ ok: true }) }), graceMs: 50 });
      const r = await commands.call({ command: node("console.log('\\x1b[32mstep 1\\x1b[0m');setTimeout(()=>console.log('step 2'),300);setTimeout(()=>process.exit(0),1200)") }, { chain: "e1", cwd: root, permit: allow });
      const id = idOf(r.text);
      assert.ok(heard.includes("e1"), "its start was said");
      const row = /** @type {import("../src/app/agent/commands.js").CommandRow} */ (await until(() => commandsOf("e1").find((c) => c.line === "step 2") || null, "its newest line", { timeoutMs: 15_000 }));
      assert.deepEqual([row.id, row.agent, row.cwd.length > 0, typeof row.startedAt], [id, null, true, "number"]);
      assert.match(row.command, /^node -e /);
      assert.match(String(row.logPath), /filament-bash-.+\.log$/, "a coding agent's command keeps its whole output in a file");
      assert.deepEqual(allCommands().filter((x) => x.chainId === "e1").map((x) => x.commands.map((c) => c.id)), [[id]]);
      const before = heard.length;
      await until(() => (commandsOf("e1").length ? null : true), "its end", { timeoutMs: 15_000 });
      assert.ok(heard.length > before && heard.at(-1) === "e1", "its end was said");
      assert.deepEqual(allCommands().filter((x) => x.chainId === "e1"), [], "a chat with none is not listed");
    } finally {
      off();
    }
  });

  // (fails before: yes)
  test("Filament's own agent's bash_background, a sub-agent's: in its chat's list under that agent; its own bash_kill takes it away, said", async () => {
    /** @type {string[]} */
    const heard = [];
    const off = onShellsChange((s) => heard.push(s));
    try {
      const owner = { session: "e3", agent: "subagent:s1" };
      const out = String(await runHand("bash_background", { command: node("setInterval(()=>{},1000)"), grace: 0.1 }, { root, owner }));
      const id = idOf(out);
      assert.deepEqual(commandsOf("e3").map((c) => [c.id, c.agent, c.logPath]), [[id, "subagent:s1", null]]);
      heard.length = 0;
      await runHand("bash_kill", { id }, { root, owner });
      assert.deepEqual(commandsOf("e3"), []);
      assert.ok(heard.includes("e3"), "its stop was said");
      assert.deepEqual(peekShellExits(owner), [], "the agent's own stop is nobody's to hear (BG-D6)");
    } finally {
      off();
    }
  });

  // (fails before: yes — E38-D3)
  test("the person's Stop: stopped, its agent told with its next turn in its own words, the chat never woken; one not running is refused in words", async () => {
    /** @type {string[]} */
    const woken = [];
    const stopWake = onShellWake((s) => woken.push(s));
    try {
      const commands = createBackgroundCommands({ registry: () => ({ commandEnd: () => ({ ok: true }) }), graceMs: 50 });
      const id = idOf((await commands.call({ command: node("setInterval(()=>{},1000)") }, { chain: "e2", cwd: root, permit: allow })).text);
      const out = await stopByPerson("e2", id);
      assert.equal(out.ok, true);
      assert.deepEqual(commandsOf("e2"), []);
      const owner = { session: "e2", agent: null };
      const told = peekShellExits(owner);
      assert.deepEqual(told.map((x) => x.id), [id]);
      assert.match(told[0].text, new RegExp(`^\\[Filament: background command ${id} \\(\`node -e .+\`\\) was stopped by the person after \\d+ s\\.\\]$`), told[0].text);
      await new Promise((r) => setTimeout(r, 300));
      assert.deepEqual(woken, [], "never woken for it");
      tellShellExits(owner, [id]);
      const no = await stopByPerson("e2", id);
      assert.deepEqual(no, { ok: false, error: `“${id}” is not running in this chat: it ended, or it was stopped.` });
    } finally {
      stopWake();
    }
  });

  // (fails before: yes)
  test("a row's newest line: colours out, a progress bar's last redraw, the last line with words, a long one by its end; none yet is empty", () => {
    const base = { id: "bg_a", command: "npm\n  test", cwd: root, startedAt: 1, agent: null, logPath: null };
    assert.equal(commandRow({ ...base, out: "\x1b[32mok\x1b[0m 1\nloading 10%\rloading 100%\n\n", produced: 40 }).line, "loading 100%");
    assert.equal(commandRow({ ...base, out: "", produced: 0 }).line, "");
    assert.equal(commandRow({ ...base, out: "", produced: 0 }).command, "npm test", "its command in one line");
    const long = commandRow({ ...base, out: `${"x".repeat(300)}END`, produced: 303 }).line;
    assert.equal(long.length, 160);
    assert.match(long, /^…x+END$/);
  });
});

describe("the routes, through a real Filament", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  before(async () => {
    shim = await startApp({});
  });
  after(async () => {
    await shim?.stop();
  });

  // (fails before: yes — no route said a chat's running commands, and none stopped one for the person)
  test("its list, the holders read's, the feed's word at each start and end; Stop for the person, 409 in words for one not running", async () => {
    const chain = "e9";
    /** @type {any[]} */
    const said = [];
    const off = /** @type {any} */ (shim.app).events.subscribe("turns", (/** @type {any} */ m) => { if (m?.type === "commands" && m.chainId === chain) said.push(m); });
    try {
      const commands = createBackgroundCommands({ registry: () => ({ commandEnd: () => ({ ok: true }) }), graceMs: 50 });
      const id = idOf((await commands.call({ command: node("console.log('watching');setInterval(()=>{},1000)") }, { chain, cwd: root, permit: allow })).text);
      assert.deepEqual(said.at(-1)?.commands.map((/** @type {any} */ c) => c.id), [id], "the feed said the whole list at its start");
      const list = await until(async () => {
        const r = await (await shim.api(`/api/sessions/${chain}/commands`)).json();
        return r.commands?.[0]?.line === "watching" ? r.commands : null;
      }, "its newest line", { timeoutMs: 15_000 });
      assert.deepEqual(list.map((/** @type {any} */ c) => c.id), [id]);
      const holders = await (await shim.api("/api/sessions/holders")).json();
      assert.deepEqual(holders.commands.filter((/** @type {any} */ x) => x.chainId === chain).map((/** @type {any} */ x) => x.commands.map((/** @type {any} */ c) => c.id)), [[id]]);
      const stop = await shim.api(`/api/sessions/${chain}/commands/${id}/stop`, { method: "POST", body: {} });
      assert.equal(stop.status, 200, await stop.clone().text());
      assert.deepEqual((await stop.json()).command.id, id);
      assert.deepEqual((await (await shim.api(`/api/sessions/${chain}/commands`)).json()).commands, []);
      assert.deepEqual(said.at(-1)?.commands, [], "the feed said it ended");
      const again = await shim.api(`/api/sessions/${chain}/commands/${id}/stop`, { method: "POST", body: {} });
      assert.equal(again.status, 409);
      assert.match((await again.json()).error, /is not running in this chat: it ended, or it was stopped\./);
      tellShellExits({ session: chain, agent: null }, [id]);
    } finally {
      off();
    }
  });
});

describe("the page: the status capsule and Now", () => {
  const NOW = 1_000_000_000;
  /** @param {Partial<import("../src/ui/harness/lib/commands.js").CommandRow>} o @returns {import("../src/ui/harness/lib/commands.js").CommandRow} */
  const cmd = (o) => ({ id: "bg_1", command: "npm test", cwd: "C:\\work\\app", startedAt: NOW - 125_000, agent: null, line: "PASS 12 of 40", logPath: null, ...o });

  // (fails before: yes)
  test("a row's words: the command cut to its room, how long it ran, who started it and where where not the chat's own, its newest line or none yet", () => {
    const rows = commandRows([cmd({ id: "bg_2", startedAt: NOW - 5_000, agent: "subagent:s1", cwd: "C:/work/app-wt", line: "", logPath: "C:/t/filament-bash-1.log" }), cmd({ command: `npm run ${"x".repeat(100)}` })], { cwd: "c:/work/app/", now: NOW, nameOf: (a) => (a === "subagent:s1" ? "Scout" : "") });
    assert.deepEqual(rows.map((r) => r.id), ["bg_1", "bg_2"], "the oldest first");
    assert.equal(rows[0].command.length, 80);
    assert.match(rows[0].command, /…$/);
    assert.deepEqual([rows[0].facts, rows[0].line, rows[0].quiet], ["running 2m", "PASS 12 of 40", false], "its folder is the chat's, whatever its slashes and case");
    assert.deepEqual([rows[1].facts, rows[1].line, rows[1].quiet, rows[1].logPath], ["running 5s · by Scout · in app-wt", "no output yet", true, "C:/t/filament-bash-1.log"]);
    assert.equal(commandRows([cmd({ agent: "subagent:gone" })], { now: NOW }).at(0)?.facts, "running 2m · by a sub-agent");
    assert.deepEqual([commandsWord([cmd({})]), commandsWord([cmd({}), cmd({ id: "bg_3" })]), commandsWord([])], ["1 command running", "2 commands running", ""]);
    assert.deepEqual([commandsFact([cmd({})]), commandsFact([cmd({}), cmd({ id: "bg_3" })]), commandsFact(null)], ["1 command running: npm test", "2 commands running", ""]);
  });

  // (fails before: yes — E38's live look: the popover said "running 7m" beside Now's "8m" for the same command)
  test("how long it ran reads as Now's ages do: minutes rounded", () => {
    assert.deepEqual([12_000, 460_000, 3_930_000].map(ranWords), ["12s", "8m", "1h 06m"]);
    const at = Date.now();
    assert.equal(ranWords(460_000), ageOf(at - 460_000, at), "the same as Now's");
  });

  // (fails before: yes — the capsule hid while only a command ran)
  test("the capsule: the turn over and a command running is Working, counted beside the agents", () => {
    const S = { turn: { phase: "ended", startedAt: null, round: 0, error: "" }, compacting: null, working: 0, asking: 0, tasks: 0, now: NOW };
    assert.deepEqual(capsuleWords({ ...S, commands: 1 }), { state: "working", lead: "Working", more: "1 command", title: "The turn is over; 1 command still at work" });
    assert.equal(capsuleWords({ ...S, working: 1, commands: 2 }).more, "1 agent · 2 commands");
    assert.equal(capsuleWords(S).state, "idle");
  });

  // (fails before: yes — E38-D1)
  test("Now: a chat whose turn ended keeps its row under Working while a command runs, its unread end said first; a turn at work counts them; one that asks you stays in Needs you", () => {
    const run = (/** @type {string} */ chain, /** @type {string} */ status) => ({ id: `r-${chain}`, kind: "agent-turn", status, startedAt: NOW - 600_000, endedAt: status === "running" ? null : NOW - 60_000, meta: { chain, model: "m-1" } });
    const commands = new Map([["c1", [cmd({})]], ["c2", [cmd({}), cmd({ id: "bg_3" })]], ["c3", [cmd({})]], ["c4", [cmd({})]]]);
    const g = nowRows({
      runs: [run("c1", "done"), run("c2", "running"), run("c3", "paused"), run("c4", "done")],
      folds: new Map(), threads: new Map(), unread: new Set(["c1"]), holders: new Map(), commands, now: NOW,
      chats: (c) => ({ title: `chat ${c}`, project: "p", when: NOW - 60_000, unread: c === "c1" }),
    });
    const fact = (/** @type {any[]} */ rows, /** @type {string} */ chain) => rows.find((r) => r.chain === chain)?.fact ?? null;
    assert.equal(fact(g.works, "c1"), "finished · 1 command running: npm test");
    assert.equal(fact(g.done, "c1"), null, "not in Done as well");
    assert.match(String(fact(g.works, "c2")), /2 commands$/);
    assert.notEqual(fact(g.needs, "c3"), null);
    assert.equal(fact(g.works, "c3"), null, "what needs you comes first");
    assert.equal(fact(g.works, "c4"), "1 command running: npm test", "an end already read is not said again");
    assert.equal(g.works.find((r) => r.chain === "c4")?.icon, "terminal");
  });

  describe("the popover", () => {
    /** @type {ReturnType<typeof stubDocument>} */
    let doc;
    before(() => {
      doc = stubDocument();
      /** @type {any} */ (globalThis).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    });
    after(() => {
      doc.restore();
      delete (/** @type {any} */ (globalThis).localStorage);
    });

    // (fails before: yes — E38-D2)
    test("a row each with Stop, the file's path where one is kept; read again every 2 s while it shows, and not once it closed", async () => {
      /** @type {any[]} */
      const did = [];
      const c = createStatusCapsule({ onOpenPlan: () => {}, onGoal: () => {}, onStopCommand: (id, command) => did.push(["stop", id, command]), onCopyCommandOutput: (p) => did.push(["copy", p]), onCommandsTick: () => did.push(["tick"]) });
      const el = /** @type {any} */ (c.el);
      c.set({ turn: { phase: "ended", startedAt: null, round: 0, error: "" }, commands: [cmd({ startedAt: Date.now() - 3_000 }), cmd({ id: "bg_2", command: "npm run build", logPath: "C:/t/filament-bash-2.log", startedAt: Date.now() - 1_000 })], cwd: "C:\\work\\app" });
      assert.equal(el.classList.contains("hidden"), false, "a command alone shows the capsule");
      assert.equal(el.getAttribute("aria-label"), "Working, 2 commands");
      el.dispatch("click");
      const sec = await until(() => doc.document.body.querySelector(".sp-commands"), "its Commands part");
      const rows = sec.querySelectorAll(".sp-command");
      assert.deepEqual(rows.map((/** @type {any} */ r) => r.getAttribute("data-command")), ["bg_1", "bg_2"]);
      assert.deepEqual(rows.map((/** @type {any} */ r) => r.querySelector(".sp-command-line").textContent), ["PASS 12 of 40", "PASS 12 of 40"]);
      assert.equal(rows[0].querySelector(".sp-command-file"), null, "no file kept: no path to copy");
      rows[1].querySelector(".sp-command-file").dispatch("click");
      rows[1].querySelectorAll("button")[0].dispatch("click");
      assert.deepEqual(did.filter((d) => d[0] !== "tick"), [["copy", "C:/t/filament-bash-2.log"], ["stop", "bg_2", "npm run build"]]);
      await new Promise((r) => setTimeout(r, 2_300));
      assert.ok(did.some((d) => d[0] === "tick"), "read again while it shows");
      el.dispatch("click");
      const ticks = did.filter((d) => d[0] === "tick").length;
      await new Promise((r) => setTimeout(r, 2_300));
      assert.equal(did.filter((d) => d[0] === "tick").length, ticks, "not read once it closed");
    });

    // (fails before: yes — E38's live look: every re-read drew the popover whole, and a press on Stop could land on a
    // row just replaced; no `commands` either)
    test("a re-read changes the moving words in place, the same Stop under the pointer; a command that starts draws it again, in place", async () => {
      /** @type {any[]} */
      const did = [];
      const c = createStatusCapsule({ onOpenPlan: () => {}, onGoal: () => {}, onStopCommand: (id) => did.push(id) });
      const el = /** @type {any} */ (c.el);
      const one = cmd({ startedAt: Date.now() - 3_000 });
      c.set({ turn: { phase: "ended", startedAt: null, round: 0, error: "" }, commands: [one], cwd: "C:\\work\\app" });
      el.dispatch("click");
      const sec = await until(() => doc.document.body.querySelector(".sp-commands"), "its Commands part");
      const stop = sec.querySelector(".sp-command button");
      c.commands([{ ...one, line: "PASS 30 of 40" }]);
      assert.equal(doc.document.body.querySelector(".sp-commands"), sec, "the section stays the node it was");
      assert.equal(sec.querySelector(".sp-command button"), stop, "and its Stop too");
      assert.equal(sec.querySelector(".sp-command-line").textContent, "PASS 30 of 40");
      c.commands([{ ...one, line: "" }]);
      assert.equal(sec.querySelector(".sp-command-line").textContent, "no output yet");
      assert.ok(sec.querySelector(".sp-command-line").classList.contains("is-quiet"), "its look follows its words");
      stop.dispatch("click");
      assert.deepEqual(did, ["bg_1"]);
      c.commands([one, cmd({ id: "bg_2", command: "npm run build", startedAt: Date.now() - 1_000 })]);
      const now = doc.document.body.querySelector(".sp-commands");
      // Drawn again into the part that stands (the owner's of 11-01: a Stop made anew under a resting pointer blinked).
      assert.equal(now, sec, "one more command: drawn again, in the part that stood");
      assert.equal(now.querySelector(".sp-command button"), stop, "the first command's Stop with it");
      assert.deepEqual(now.querySelectorAll(".sp-command").map((/** @type {any} */ r) => r.getAttribute("data-command")), ["bg_1", "bg_2"]);
      assert.equal(el.getAttribute("aria-label"), "Working, 2 commands", "and the capsule's words with it");
      c.commands([]);
      assert.equal(doc.document.body.querySelector(".sp-commands"), null, "none left: the part goes");
    });
  });
});

// @ts-check
// HarnessV3-ACP AC1-6, the look every engine's turn shares: a command's card without its shell, calls of mixed kinds
// folded into one row with a sentence, rounds whose cards land side by side in one box, and the live fold naming the
// call running now; and the rows themselves, built on a stub document (helpers/dom-stub.js). No network.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { commandLabel, cardOf } from "../src/core/tool-vocab.js";
import { groupRuns, workSentence, roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { alignEvents, callWords, liveWords, cardBoxes, mergedCell } from "../src/ui/harness/lib/labels.js";
import { stubDocument } from "./helpers/dom-stub.js";

/** A finished stub with the loop's card. @param {string} name @param {any} input @param {string} [state] */
const call = (name, input, state = "done") => ({ id: `${name}-${JSON.stringify(input)}`, name, card: cardOf(name, input), state });

describe("command labels (AC1-6)", () => {
  // (fails before: yes — there was no commandLabel: a card read `bash -lc '…'` and `powershell -Command "…"` whole)
  test("the shell that wraps a command and a leading change of folder are not the command", () => {
    const cases = [
      ["npm test", "npm test"],
      ["/bin/zsh -lc 'git diff --stat'", "git diff --stat"],
      ['bash -c "printf \\"%s\\" hello; git status"', 'printf "%s" hello; git status'],
      ["/usr/bin/fish --command 'rg TODO src | head -20'", "rg TODO src | head -20"],
      ["/bin/bash --noprofile --norc -l -c 'sed -n 1,270p file.ts'", "sed -n 1,270p file.ts"],
      ["/bin/bash -o pipefail -lc 'vp test run'", "vp test run"],
      ['cmd.exe /d /s /c "cd C:\\work && npm test"', "npm test"],
      ["cmd /c bcdedit /enum", "bcdedit /enum"],
      ['pwsh -NoProfile -Command "Set-Location C:\\work; pnpm test"', "pnpm test"],
      ["pwsh -Command Set-Location C:\\work; pnpm test", "pnpm test"],
      ['"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "Get-ChildItem -Force"', "Get-ChildItem -Force"],
      ["cd /repo && npm run build", "npm run build"],
      ['cd "/my repo" && make', "make"],
      ["cd /a && cd b && make", "make"],
      ["bash -lc 'cd /repo && npm test'", "npm test"],
    ];
    for (const [line, label] of cases) assert.equal(commandLabel(line), label, line);
  });

  // (fails before: yes — there was no commandLabel to leave these alone)
  test("a line the rules do not fit stays as it is: arguments after a script, a second command, a script file", () => {
    for (const line of [
      "zsh -lc 'echo $1' name value",
      "zsh -lc 'pwd'; git status",
      "zsh -lc 'unterminated",
      "zsh script.sh",
      'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\work\\scripts\\doctor.ps1"',
      "cd /repo",
    ])
      assert.equal(commandLabel(line), line, line);
    assert.equal(commandLabel("   "), "");
  });

  // (fails before: yes — cmd's valued switches (`/v:on`) ended its switches, so the line stayed whole)
  test("cmd's valued switches are switches", () => {
    assert.equal(commandLabel('cmd /v:on /c "npm test"'), "npm test");
    assert.equal(commandLabel("cmd.exe /e:off /t:0a /c dir"), "dir");
  });

  // (fails before: no — a guard the mutation pass asked for: no line here gave PowerShell a valued switch before its
  // command, cmd a word before /c, or a shell inside a shell)
  test("PowerShell's valued switch takes its value; a word that is no switch ends cmd's; a shell inside a shell", () => {
    assert.equal(commandLabel('powershell -ExecutionPolicy Bypass -Command "npm test"'), "npm test");
    assert.equal(commandLabel("cmd run.bat /c npm test"), "cmd run.bat /c npm test");
    assert.equal(commandLabel(`cmd /c "bash -lc 'npm test'"`), "npm test");
  });

  // (fails before: yes — the card's subject was the whole line, its shell included)
  test("a shell card's subject is the label; a background shell's id is still its subject", () => {
    assert.deepEqual(cardOf("Bash", { command: "bash -lc 'cd /x && npm test'" }), { kind: "shell", title: "Run", subject: "npm test" });
    assert.deepEqual(cardOf("bash", { command: 'powershell -NoProfile -Command "npm run lint"' }), { kind: "shell", title: "Run", subject: "npm run lint" });
    assert.equal(cardOf("bash_output", { id: "bg_1" }).subject, "bg_1");
  });
});

describe("cards of a plan's steps and of files (AC1's drive)", () => {
  // (fails before: yes — Claude Code's TaskCreate read as a list of none ("0 items"), its TaskUpdate as a tool the
  // table did not know, and a list of one as "1 items")
  test("a plan's card: a list counts its items; Claude Code's task tools name the one task they change", () => {
    assert.deepEqual(cardOf("TaskCreate", { subject: "Read the file", description: "Read README.md", activeForm: "Reading" }), { kind: "todo", title: "Plan", subject: "Read the file" });
    assert.deepEqual(cardOf("TaskUpdate", { taskId: "2", status: "in_progress" }), { kind: "todo", title: "Plan", subject: "task 2: doing" });
    assert.deepEqual(cardOf("TodoWrite", { todos: [{ content: "a", status: "pending", activeForm: "A" }] }), { kind: "todo", title: "Plan", subject: "1 item" });
    assert.deepEqual(cardOf("plan", { items: [] }), { kind: "todo", title: "Plan", subject: "0 items" });
  });

  // (fails before: yes — a path was cut at 90 characters, so a long one no longer named its file whole)
  test("a file's card names it by its whole path", () => {
    const path = `/work/${"deep/".repeat(25)}file.js`;
    for (const name of ["Read", "Write", "Edit"]) assert.equal(cardOf(name, { file_path: path }).subject, path, name);
  });
});

describe("work rows (AC1-6)", () => {
  // (fails before: yes — calls of mixed kinds were rows one by one; only a family's run folded)
  test("between the family runs, finished calls of mixed kinds make one work run; a family's run is still its own", () => {
    const tools = [
      call("read", { path: "a.js" }),
      call("grep", { pattern: "x" }),
      call("edit", { path: "a.js", edits: [] }),
      call("bash", { command: "npm test" }),
      call("web_fetch", { url: "https://example.com" }),
      call("bash", { command: "npm run lint" }),
      call("bash", { command: "git status" }),
    ];
    assert.deepEqual(groupRuns(tools), [
      { start: 0, length: 2, family: "explore" },
      { start: 2, length: 3, family: "work" },
      { start: 5, length: 2, family: "terminal" },
    ]);
  });

  // (fails before: yes — there were no work runs to keep these out of)
  test("a running call, a sub-agent, a plan, a question, memory and Filament's own tools never join a work run", () => {
    const edit = call("edit", { path: "a.js", edits: [] });
    const run = call("bash", { command: "npm test" });
    for (const odd of [
      call("bash", { command: "npm start" }, "running"),
      call("agent", { description: "look around", prompt: "look" }),
      call("plan", { items: [] }),
      call("ask", { question: "which?" }),
      call("filament_memory_search", { query: "x" }),
      call("tasks", { action: "add" }),
      call("wait", { seconds: 5 }),
    ])
      assert.deepEqual(groupRuns([edit, odd, run]), [], odd.name);
    assert.deepEqual(groupRuns([edit, call("mcp__github__search_issues", { q: "x" }), run]), [{ start: 0, length: 3, family: "work" }], "an MCP server's call joins");
    assert.deepEqual(groupRuns([edit, call("NotebookEdit", { path: "n.ipynb" }), run]), [{ start: 0, length: 3, family: "work" }], "a tool Filament does not know joins");
  });

  // (fails before: yes — a family switched off grouped nothing, but there were no work runs for it to stay out of)
  test("a family whose grouping is off keeps its calls out of work runs too", () => {
    const tools = [call("read", { path: "a.js" }), call("bash", { command: "npm test" }), call("edit", { path: "a.js", edits: [] })];
    assert.deepEqual(groupRuns(tools, { explore: false, terminal: true, changes: true }), [{ start: 1, length: 2, family: "work" }]);
    assert.deepEqual(groupRuns(tools, { explore: true, terminal: false, changes: true }), []);
  });

  // (fails before: yes — there was no sentence: a work row had nothing to say)
  test("the sentence: what changed something first, in the order it happened, the rest counted", () => {
    assert.equal(workSentence([call("read", { path: "a.js" }), call("bash", { command: "npm test" })]), "Read 1 file and ran 1 command");
    assert.equal(
      workSentence([call("read", { path: "a.js" }), call("read", { path: "b.js" }), call("read", { path: "a.js" }), call("edit", { path: "a.js", edits: [] }), call("bash", { command: "npm test" })]),
      "Changed 1 file, ran 1 command, and made 3 other calls",
      "a change and a command matter more than the reads, which are counted",
    );
    assert.equal(workSentence([call("grep", { pattern: "x" }), call("web_search", { query: "y" }), call("web_search", { query: "z" })]), "Searched once and searched the web twice");
    assert.equal(workSentence([call("web_fetch", { url: "https://a" }), call("mcp__github__search_issues", { q: "x" }), call("mcp__linear__list", {})]), "Used github and linear and fetched 1 page");
    assert.equal(workSentence([call("NotebookEdit", { path: "n.ipynb" }), call("Skill", { name: "x" })]), "Used 2 tools");
  });

  // (fails before: no — a guard the mutation pass asked for: no sentence here read one file twice or named more than
  // two servers)
  test("the sentence counts files, not calls, and names two servers at most", () => {
    assert.equal(workSentence([call("read", { path: "a.js" }), call("bash", { command: "npm test" }), call("read", { path: "a.js" })]), "Read 1 file and ran 1 command");
    const mcp = [call("mcp__github__search_issues", { q: "x" }), call("mcp__linear__list", {}), call("mcp__slack__post", {})];
    assert.equal(workSentence(mcp), "Used github, linear and 1 more server");
  });

  // (fails before: yes — a load through Filament's mcp tool read as a server of its own: "Used an MCP server and notes")
  test("E49: the mcp tool's load and find say what they did; a call through it names its server", () => {
    const load = call("mcp", { action: "load", tools: ["echo", "write_note"] });
    const through = { ...call("mcp__notes__echo", { text: "hi" }) };
    assert.equal(workSentence([load, through]), "Used notes and loaded 2 tools", "a server first, as every work row names one");
    assert.equal(workSentence([call("mcp", { action: "find", query: "issues" }), call("mcp", { action: "find", query: "pull" }), call("read", { path: "a.js" })]), "Looked for tools twice and read 1 file");
  });
});

describe("the live fold names the call running now (AC1-6)", () => {
  // (fails before: yes — there was no callWords: the fold read "running tools" for an agent's call)
  test("a call in a few words, from its card", () => {
    assert.equal(callWords(call("bash", { command: "bash -lc 'npm test'" }, "running")), "running npm test");
    assert.equal(callWords(call("read", { path: "README.md" }, "running")), "reading README.md");
    assert.equal(callWords(call("edit", { path: "src/app.js", edits: [] }, "running")), "editing src/app.js");
    assert.equal(callWords(call("web_search", { query: "acp spec" }, "running")), "searching the web for acp spec");
    assert.equal(callWords(call("agent", { description: "explore the repo", prompt: "go" }, "running")), "an agent works on “explore the repo”");
    assert.equal(callWords(call("mcp__github__search_issues", { q: "x" }, "running")), "using github: search_issues");
    assert.equal(callWords(call("wait", { seconds: 5 }, "running")), "waiting for agents");
    assert.equal(callWords({ name: "filament_memory_search", state: "running" }), "recalling");
    assert.equal(callWords({ name: "frobnicate", state: "running" }), "running frobnicate");
  });

  // (fails before: no — a guard the mutation pass asked for: no card here started, read or stopped a shell in the
  // background, or named more than the fold shows)
  test("a background shell's call says what it does to it; a long subject is clipped", () => {
    assert.equal(callWords(call("bash_background", { command: "npm run dev" }, "running")), "starting npm run dev");
    assert.equal(callWords(call("bash_output", { id: "bg_1" }, "running")), "reading the output of bg_1");
    assert.equal(callWords(call("bash_kill", { id: "bg_1" }, "running")), "stopping bg_1");
    assert.equal(callWords(call("read", { path: "a".repeat(100) }, "running")), `reading ${"a".repeat(59)}…`);
  });

  // (fails before: yes — there was no liveWords: the fold said the loop's state only, never which call ran)
  test("one call running is named; several are counted; none, and the loop's state speaks", () => {
    const start = (/** @type {string} */ id, /** @type {any} */ card) => ({ type: "tool-start", round: 1, id, name: "x", card });
    const read = { kind: "read", title: "Read", subject: "README.md" };
    const one = alignEvents([{ type: "round-start", round: 1 }, start("a", read)]);
    assert.equal(liveWords(one), "reading README.md");
    const two = alignEvents([{ type: "round-start", round: 1 }, start("a", read), start("b", read)]);
    assert.equal(liveWords(two), "running 2 tool calls");
    const none = alignEvents([{ type: "round-start", round: 1 }, start("a", read), { type: "tool-end", round: 1, id: "a", ok: true }, { type: "turn-state", from: "acting", to: "planning", why: "round 2" }]);
    assert.equal(liveWords(none), "thinking");
  });
});

describe("rounds side by side share a box (AC1-6)", () => {
  /** @param {number} r @param {Record<string, any>} [more] */
  const cellOf = (r, more = {}) => ({ round: r, tools: new Map([[`t${r}`, { id: `t${r}`, name: "read", state: "done" }]]), order: [`t${r}`], plan: null, hooks: [], marks: [], reports: [], compactions: [], detaches: [], steers: [], snapshots: [], vetoed: 0, ...more });
  const text = (/** @type {string} */ t) => ({ kind: "block", block: { type: t } });

  // (fails before: yes — every round drew its own box, so an agent's one-call rounds never folded together)
  test("rounds with nothing said between them share one box; words between them part it", () => {
    // Round 1 says something and calls; rounds 2 and 3 only call; round 4 says something first, then calls.
    const byRound = new Map([[1, { ...cellOf(1), blocksBefore: 0 }], [2, { ...cellOf(2), blocksBefore: 1 }], [3, { ...cellOf(3), blocksBefore: 1 }], [4, { ...cellOf(4), blocksBefore: 1 }]]);
    const segments = [text("text"), text("text")];
    assert.deepEqual(cardBoxes(segments, byRound, [1, 2, 3, 4], false), [[1, 2, 3], [4]]);
  });

  // (fails before: yes — there was no cardBoxes to keep a note where it happened)
  test("a round that drew a note ends its box, so the note stays after its own calls", () => {
    // Round 1 says something, calls and plans; rounds 2 and 3 only call.
    const byRound = new Map([[1, { ...cellOf(1, { plan: [{ text: "a", status: "doing" }] }), blocksBefore: 0 }], [2, { ...cellOf(2), blocksBefore: 1 }], [3, { ...cellOf(3), blocksBefore: 1 }]]);
    assert.deepEqual(cardBoxes([text("text")], byRound, [1, 2, 3], false), [[1], [2, 3]]);
    const steered = new Map([[1, { ...cellOf(1, { steers: [{ read: true }] }), blocksBefore: 0 }], [2, { ...cellOf(2), blocksBefore: 1 }]]);
    assert.deepEqual(cardBoxes([text("text")], steered, [1, 2], true), [[1], [2]], "live, a steer read in round 1 is a note there");
    // (fails before: yes — settled, a box that took round 2 in kept round 2's notes alone, and the message read in round
    // 1 left the work, though a settled turn keeps its messages where they joined since 10-29; the owner's of 11-05)
    assert.deepEqual(cardBoxes([text("text")], steered, [1, 2], false), [[1], [2]], "settled too: the message stands in the work, a note there");
  });

  // (fails before: yes — there was no mergedCell)
  test("one box's cell: the calls in order, each keeping its round; the last round's notes", () => {
    const merged = mergedCell([cellOf(2), cellOf(3, { hooks: [{ on: "post" }] })]);
    assert.deepEqual(merged.order, ["t2", "t3"]);
    assert.deepEqual([merged.tools.get("t2").round, merged.tools.get("t3").round, merged.round], [2, 3, null]);
    assert.deepEqual(merged.hooks, [{ on: "post" }]);
    assert.equal(merged.notesRound, 3, "its notes are the last round's, and say so");
    const alone = cellOf(5);
    assert.equal(mergedCell([alone]), alone, "a box of one round is that round's cell");
  });
});

describe("the rows themselves (AC1's drive)", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());
  /** One box's cell of calls. @param {any[]} tools @param {any[] | null} [plan] */
  const cellOf = (tools, plan = null) => ({ round: 1, order: tools.map((t) => t.id), tools: new Map(tools.map((t) => [t.id, t])), plan });
  /** What a row's summary says: its kind, its subject, the rest; null for a part it does not draw. @param {any} row */
  const parts = (row) => ["tool-kind", "tool-primary", "tool-secondary"].map((c) => row.querySelector(`.${c}`)?.textContent ?? null);

  // (fails before: no — a guard the mutation pass asked for: no card here had arguments that only said its subject or
  // its title again, so a row that said one twice went unseen)
  test("a card whose arguments only say its subject or its title again says it once", () => {
    /** @param {Record<string, any>} t */
    const row = (t) => parts(roundRows(cellOf([{ state: "done", ...t }]))[0]);
    assert.deepEqual(row({ id: "n1", name: "notify", args: "deploy finished", card: { kind: "other", title: "Notify", subject: "deploy finished" } }), ["Notify", "deploy finished", null]);
    assert.deepEqual(row({ id: "n2", name: "Fetch issue 42", args: "Fetch issue 42", card: { kind: "other", title: "Fetch issue 42" } }), ["Fetch issue 42", "", null]);
    assert.deepEqual(row({ id: "n3", name: "notify", args: { channel: "ops" }, card: { kind: "other", title: "Notify", subject: "deploy finished" } }), ["Notify", "deploy finished", '{"channel":"ops"}']);
  });

  // (fails before: no — a guard the mutation pass asked for: only the loop's own plan call stood beside a plan's card
  // here, so Claude Code's task tool drawn beside it went unseen)
  test("beside the plan's card no call that made the plan has a row of its own; with no plan's card, each has one", () => {
    const calls = [call("TaskCreate", { subject: "Read the readme" }), call("plan", { items: [] }), call("Read", { file_path: "README.md" })];
    /** @param {any[] | null} plan */
    const kinds = (plan) => roundRows(cellOf(calls, plan)).map((r) => r.querySelector(".tool-kind")?.textContent);
    assert.deepEqual(kinds([{ content: "Read the readme", status: "pending" }]), ["Read"]);
    assert.deepEqual(kinds(null), ["Plan", "Plan", "Read"]);
  });

  // (fails before: yes — each round whose todo call sent a plan drew its own Todo card, so an agent that ticked its list
  // five times showed five cards)
  test("a run's plan is one card, at its newest list: the rounds before it draw neither a card nor their todo call's row", () => {
    const todo = (/** @type {string} */ id, /** @type {number} */ round) => [
      { type: "tool-start", round, id, name: "TodoWrite", args: { todos: [] }, card: cardOf("TodoWrite", { todos: [] }) },
      { type: "tool-end", round, id, ok: true, preview: "ok" },
    ];
    const items = (/** @type {string} */ first) => [{ text: "Map", status: first }, { text: "Fix", status: "pending" }];
    const aligned = alignEvents([
      { type: "round-start", round: 1, blocksBefore: 0 }, ...todo("w1", 1), { type: "plan", round: 1, items: items("doing") },
      { type: "round-start", round: 2, blocksBefore: 0 }, { type: "tool-start", round: 2, id: "r1", name: "Read", args: { file_path: "a.js" }, card: cardOf("Read", { file_path: "a.js" }) }, { type: "tool-end", round: 2, id: "r1", ok: true, preview: "a" },
      { type: "round-start", round: 3, blocksBefore: 0 }, ...todo("w2", 3), { type: "plan", round: 3, items: items("done") },
    ]);
    const [one, two, three] = [1, 2, 3].map((r) => aligned.byRound.get(r));
    assert.deepEqual([one.plan, one.planLater, three.plan], [null, true, items("done")], "the newest list stands, on its own round");
    assert.deepEqual(roundRows(one).map((r) => r.querySelector(".tool-kind")?.textContent), [], "the first todo call's row stays out: the card says it");
    assert.deepEqual(roundRows(three).map((r) => r.querySelector(".tool-kind")?.textContent), []);
    assert.deepEqual([one.order, roundRows(two).map((r) => r.querySelector(".tool-kind")?.textContent)], [["w1"], ["Read"]], "the calls are there, a round without a plan draws its rows");
    assert.equal(mergedCell([one, two]).planLater, true, "a box its rounds share keeps the word");
    assert.equal(mergedCell([two]).planLater, undefined);
  });
});

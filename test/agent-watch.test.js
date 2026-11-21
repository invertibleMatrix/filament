// A background command watched as Claude Code's Monitor watches a process (the owner's word of 10-27: "Watching a
// running process: this needs to work like claude as well"): each new line of its output that the watch's pattern
// matches is told to the agent as it comes — redacted as its reads are — at its next step while its turn runs, or in a
// turn Filament starts by itself once it has ended; the lines that come before they are told join one item; its end is
// told after them; a pattern that does not compile is refused before anything starts.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHand, peekShellExits, takeShellExits, attendShells, onShellWake, wakeKindOf, disposeBackgroundShells } from "../src/adapters/tools/hands.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";

const dir = mkdtempSync(join(tmpdir(), "watch-"));
after(async () => {
  await disposeBackgroundShells();
  rmSync(dir, { recursive: true, force: true });
});
/** A command that prints four lines 80 ms apart, then ends: tick, ERROR, tick, ERROR (with a secret in the last). */
const PRINTS = `node -e "let i=0;const t=setInterval(()=>{i++;console.log(i===4?'ERROR 4 key=sk-abc123':i%2?'tick '+i:'ERROR '+i);if(i>=4)clearInterval(t)},80)"`;
const until = async (/** @type {() => boolean} */ ok, what) => {
  for (let i = 0; i < 100; i++) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
};

// (fails before: yes — a running command's lines reached the agent only through a bash_output that waited for them)
test("each matching line is told as it comes, redacted, in one item; the end after it; an idle chat is woken", async () => {
  const owner = { session: "s-watch-1", agent: null };
  /** @type {string[]} */
  const woke = [];
  const stop = onShellWake((s) => woke.push(s));
  try {
    const started = String(await runHand("bash_background", { command: PRINTS, watch: "^ERROR", grace: 0.05 }, { root: dir, owner, redact: (t) => t.replace(/sk-\w+/g, "[redacted]") }));
    assert.match(started, /Each new line of its output that matches \/\^ERROR\/ is told to you as it comes/);
    await until(() => peekShellExits(owner).some((x) => x.kind === "exit"), "the command's end");
    const news = peekShellExits(owner);
    assert.deepEqual(news.map((x) => x.kind), ["lines", "exit"], "the lines, then the end");
    const lines = news[0].text;
    assert.match(lines, /printed 2 lines you watch for \(\/\^ERROR\/\):\nERROR 2\nERROR 4 key=\[redacted\]\]$/, lines);
    assert.ok(!lines.includes("tick"), "only the lines it watches for");
    assert.ok(!lines.includes("sk-abc123"), "redacted as a read is");
    assert.equal(wakeKindOf("s-watch-1"), "mixed");
    assert.ok(woke.includes("s-watch-1"), "nobody's turn ran: the chat is woken");
    takeShellExits(owner);
    assert.equal(wakeKindOf("s-watch-1"), null);
  } finally {
    stop();
  }
});

test("while its turn runs, nobody is woken; told lines start a new item", async () => {
  const owner = { session: "s-watch-2", agent: null };
  /** @type {string[]} */
  const woke = [];
  const stop = onShellWake((s) => woke.push(s));
  const leave = attendShells(owner);
  try {
    await runHand("bash_background", { command: PRINTS, watch: "ERROR", grace: 0.05 }, { root: dir, owner });
    await until(() => peekShellExits(owner).some((x) => x.kind === "lines"), "the first line");
    const first = takeShellExits(owner).filter((x) => x.kind === "lines");
    assert.equal(first.length, 1);
    await until(() => peekShellExits(owner).some((x) => x.kind === "exit"), "the command's end");
    const rest = peekShellExits(owner).filter((x) => x.kind === "lines");
    for (const r of rest) assert.ok(!first.some((f) => r.text.includes(f.text.split("\n")[1])), "a told line is not told again");
    assert.deepEqual(woke, [], "its turn runs: it hears at its next step");
  } finally {
    leave();
    stop();
    takeShellExits(owner);
  }
});

test("a watch pattern that does not compile is refused, nothing started", async () => {
  await assert.rejects(runHand("bash_background", { command: "echo hi", watch: "(" }, { root: dir, owner: { session: "s-watch-3", agent: null } }), /watch is a regular expression, and this one does not compile/);
});

test("the loop tells watched lines with the results, and draws no end for them", async () => {
  /** @type {any[]} */
  const events = [];
  const bodies = [];
  let told = 0;
  const reply = (content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
  await runAgentTurn(/** @type {any} */ ({
    model: "m", messages: [{ role: "user", content: "go" }], system: "s", tools: toolSetFor({ delegateRead: false }), modeNow: () => "edit",
    root: dir, readerModel: "", maxTokens: 100, costOf: () => 0, delegateRead: null, mailbox: { read: () => [] }, permissions: null, tree: null,
    previewChars: 0, sink: { text() {}, thinking() {}, signThinking() {}, endBlock() {}, count: () => 0 }, signal: null, resume: null,
    onEvent: (e) => events.push(e),
    runHand: async () => "ok",
    shellNews: () => (told++ === 1 ? [{ id: "bg_x:watch", command: "tail -f log", code: null, text: "[Filament: background shell bg_x (tail -f log) printed a line you watch for (/ERROR/):\nERROR boom]", kind: "lines" }] : []),
    call: async ({ body }) => {
      bodies.push(structuredClone(body));
      return bodies.length === 1 ? reply([{ type: "tool_use", id: "r", name: "read", input: { path: "x" } }]) : reply([{ type: "text", text: "Done." }]);
    },
  }));
  assert.ok(JSON.stringify(bodies[1].messages.at(-1)).includes("ERROR boom"), "told with the round's results");
  assert.equal(events.filter((e) => e.type === "shell-exit").length, 0, "no end is drawn for lines");
});

// The Hunter's finds of 10-27 (sa_f48bd4fb, sa_b5822be2), each verified against the code before it was fixed.
// (fails before: yes — the lines caught while the early output came were told again at the next step)
test("a line the start's early output shows is not told again by the watch; one after it is", async () => {
  const owner = { session: "s-watch-grace", agent: null };
  // The early line comes inside the longest wait a start gives, however slowly node starts; the late one once the
  // start has answered and the test lets it come.
  const cmd = `node -e "const fs=require('fs');console.log('READY early');const t=setInterval(()=>{if(fs.existsSync('grace-late')){clearInterval(t);console.log('READY late')}},20)"`;
  const started = String(await runHand("bash_background", { command: cmd, watch: "^READY", grace: 5 }, { root: dir, owner }));
  assert.match(started, /Early output:\nREADY early/);
  assert.deepEqual(peekShellExits(owner).filter((x) => x.kind === "lines"), [], "the early output showed it");
  writeFileSync(join(dir, "grace-late"), "");
  await until(() => peekShellExits(owner).some((x) => x.kind === "lines"), "the line after the start");
  const lines = peekShellExits(owner).find((x) => x.kind === "lines")?.text || "";
  assert.match(lines, /printed a line you watch for \(\/\^READY\/\):\nREADY late\]$/, lines);
  takeShellExits(owner);
});

// (fails before: yes — the watch was taken and quietly never attached: nobody was told its lines)
test("watch where the request names no chat is refused in words, nothing started", async () => {
  await assert.rejects(runHand("bash_background", { command: "echo hi", watch: "hi" }, { root: dir, owner: { session: "", agent: null } }), /watch needs a chat to tell its lines to, and this request names none/);
  await assert.rejects(runHand("bash_background", { command: "echo hi", watch: "hi" }, { root: dir }), /watch needs a chat/);
});

// (fails before: yes — the stop's line replaced the item, and the lines caught before it were gone)
test("a pattern that takes too long keeps the lines it caught before, the stop after them", async () => {
  const owner = { session: "s-watch-slow", agent: null };
  const cmd = `node -e "setTimeout(()=>console.log('aaa'),100);setTimeout(()=>console.log('a'.repeat(40)+'!'),400)"`;
  await runHand("bash_background", { command: cmd, watch: "^(a+)+$", grace: 0.05 }, { root: dir, owner });
  await until(() => /stopped watching/.test(peekShellExits(owner).find((x) => x.kind === "lines")?.text || ""), "the watch to stop");
  const text = peekShellExits(owner).find((x) => x.kind === "lines")?.text || "";
  assert.match(text, /printed a line you watch for \(\/\^\(a\+\)\+\$\/\):\naaa\]\n\[Filament: stopped watching background shell bg_\w+ \(.*\): the pattern \/\^\(a\+\)\+\$\/ took too long over its output\. bash_output reads it\.\]$/, text);
  takeShellExits(owner);
});

// (fails before: yes — every item that rode with a message was said to be a shell's exit)
test("the next message's words tell a watch's lines and a come-back's note apart from a command's end", async () => {
  const { deliveredWords } = await import("../src/ui/harness/conversation/turn.js");
  assert.equal(deliveredWords({ deliveries: 1, shellExits: 1, shellWatch: 1 }), "with the lines a watch caught");
  assert.equal(deliveredWords({ deliveries: 3, shellExits: 3, shellWatch: 2 }), "with 1 background shell exit and the lines 2 watches caught");
  assert.equal(deliveredWords({ deliveries: 2, shellExits: 2, shellWake: 1 }), "with 1 background shell exit and the agent's come-back note");
  assert.equal(deliveredWords({ deliveries: 1, shellExits: 1 }), "with 1 background shell exit");
});

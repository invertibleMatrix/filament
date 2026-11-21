// P5 — agent-facing result paging (§7.1), the anti-bloat lever.
//
// With the client bridge on, a read or a command lands in TWO histories: the client's and the agent's, and both are
// re-sent as context on every later turn. The client's copy is the record — it ran the tool, rendered the card and
// kept the whole result — so the agent's copy is the one to bound. Paging makes it SMALLER than the client's rather
// than equal, which is what turns "paying twice" into one authoritative copy plus a bounded shadow.
//
// These tests pin the three things that make paging safe rather than lossy:
//   1. the agent is TOLD it got a page, and given a working way to ask for the next one;
//   2. a read keeps the head (so `offset` walks forward) and command output keeps the tail (so the error survives);
//   3. nothing the agent needs can be pushed out of the page by the thing being paged — the exit code and the
//      timeout note are appended AFTER the cut.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pageResult, McpToolServer, DEFAULT_PAGE_LINES, DEFAULT_PAGE_CHARS } from "../src/mcp-server.js";
import { RESULT_BUDGET_BYTES } from "../src/adapters/tools/hands.js";
import { LocalHands } from "../src/local-hands.js";
import { SCHEMAS } from "../src/schema.js";

// The module's defaults must be the schema's defaults: a drift would make the number the dashboard shows a lie about
// what actually happens, and nothing else would catch it because both files look correct on their own.
test("the paging defaults in code are the defaults the schema documents", () => {
  const acp = SCHEMAS.UPSTREAM.acp;
  assert.equal(acp.nativePageLines.default, DEFAULT_PAGE_LINES, "lines per page agree");
  assert.equal(acp.nativePageChars.default, DEFAULT_PAGE_CHARS, "and so does the character ceiling");
  assert.equal(acp.nativePaging.default, true, "paging is on by default, as documented");
});

test("pageResult keeps the head for a read and the tail for output, and says how much it dropped", () => {
  const lines = (n, f = (i) => `line ${i + 1}`) => Array.from({ length: n }, (_, i) => f(i)).join("\n");
  // Head-kept: a read pages forward, so the first lines are the ones the agent asked for.
  const head = pageResult(lines(1000), { lines: 400, chars: 0 });
  assert.equal(head.truncated, true);
  assert.equal(head.totalLines, 1000, "it knows how many lines there were");
  assert.equal(head.keptLines, 400, "and how many it kept");
  assert.equal(head.droppedTail, 600, "the rest were dropped from the end");
  assert.equal(head.droppedHead, 0, "nothing was dropped from the start");
  assert.ok(head.text.startsWith("line 1\n") && head.text.endsWith("line 400"), "the first page, in order");
  assert.ok(!head.text.includes("line 401"), "and it really stops there");
  // Tail-kept: command output's last lines are the error and the exit status; the start is noise.
  const tail = pageResult(lines(1000), { lines: 400, chars: 0, keepTail: true });
  assert.equal(tail.droppedHead, 600, "the tail is kept by dropping from the START");
  assert.equal(tail.droppedTail, 0);
  assert.ok(tail.text.startsWith("line 601\n") && tail.text.endsWith("line 1000"), "the last 400 lines, in order");
  // Boundaries: exactly at the limit is not a truncation, and one over is.
  assert.equal(pageResult(lines(400), { lines: 400, chars: 0 }).truncated, false, "exactly the limit is not truncated");
  assert.equal(pageResult(lines(401), { lines: 400, chars: 0 }).truncated, true, "one line over is");
  assert.equal(pageResult(lines(3), { lines: 400, chars: 0 }).truncated, false, "a short result is untouched");
  // 0 means no cap — that is how `nativePaging: false` is expressed internally.
  const uncapped = pageResult(lines(5000), { lines: 0, chars: 0 });
  assert.equal(uncapped.truncated, false, "no cap, no truncation");
  assert.equal(uncapped.totalLines, 5000, "and the whole thing comes back");
  // Degenerate inputs must not throw or invent content.
  assert.equal(pageResult("", { lines: 10, chars: 100 }).text, "");
  assert.equal(pageResult(null, { lines: 10, chars: 100 }).text, "");
});

test("the character ceiling bites on long lines, and cuts on a LINE boundary so no page ends on a fragment", () => {
  // 400 lines of 200 characters: well under the line cap, four times over the character one. This is the case a
  // line-only cap misses entirely — minified JS, a CSV, a log with no newlines.
  const long = Array.from({ length: 400 }, (_, i) => `L${i + 1}:${"x".repeat(195)}`).join("\n");
  const head = pageResult(long, { lines: 400, chars: 1000 });
  assert.equal(head.truncated, true, "truncated by characters even though every line fit");
  assert.equal(head.byChars, true, "and it says which limit bit");
  assert.equal(head.splitLine, false, "no single line exceeded the ceiling, so this is an ordinary cut");
  assert.equal(head.droppedTail, 0, "no whole line was dropped by the LINE cap");
  assert.ok(head.text.length <= 1000, `the result is within the ceiling: ${head.text.length}`);
  // A page that ends mid-line hands the agent a fragment it can see but not match, and makes the continuation offset
  // ambiguous. Cutting back to the last whole line costs at most one line and makes the arithmetic exact.
  assert.ok(!head.text.endsWith("…"), "a head cut is not marked with an ellipsis, because it does not cut a line");
  assert.ok(head.text.length < 1000, `and it gave back the partial line rather than keeping it: ${head.text.length} chars for a 1000 ceiling`);
  const headLines = head.text.split("\n");
  assert.ok(headLines.every((l) => /^L\d+:x+$/.test(l)), `every line returned is complete, not a fragment: ${JSON.stringify(headLines.at(-1)?.slice(-24))}`);
  assert.equal(headLines.at(-1), `L${headLines.length}:${"x".repeat(195)}`, "and the last one is the whole of its line");
  const tail = pageResult(long, { lines: 400, chars: 1000, keepTail: true });
  assert.ok(tail.text.startsWith("…"), "a tail cut IS marked, because text before it was dropped");
  assert.ok(tail.text.includes("L400:"), "and it really is the end of the output");
  const tailLines = tail.text.split("\n");
  assert.ok(tailLines.slice(1).every((l) => /^L\d+:x+$/.test(l)), "and every line after the marker is complete");
});

test("a single line longer than the whole ceiling is flagged, because no offset can page past it", () => {
  // Minified bundles and one-line JSON. Advertising a continuation offset here would return the identical page
  // forever, and the rest of the line would be unreachable through Read — so the caller has to be told.
  const one = pageResult(`${"y".repeat(30000)}\ntail line`, { lines: 400, chars: 1000 });
  assert.equal(one.truncated, true);
  assert.equal(one.byChars, true);
  assert.equal(one.splitLine, true, "the first line alone exceeds the ceiling");
  assert.ok(one.text.endsWith("…"), "and the cut is marked, since a line really was split");
  const tailOne = pageResult(`head line\n${"y".repeat(30000)}`, { lines: 400, chars: 1000, keepTail: true });
  assert.equal(tailOne.splitLine, true, "same from the other end");
  // A file whose lines are long but each under the ceiling is NOT this case.
  assert.equal(pageResult(Array.from({ length: 50 }, () => "z".repeat(500)).join("\n"), { lines: 400, chars: 1000 }).splitLine, false);
});

test("a trailing newline is not counted as a line, so no empty page is ever advertised", () => {
  // Nearly every text file ends in a newline, and `split("\n")` produces a phantom empty element for it. Counting
  // that made a 400-line file report 401 lines and promise a page that is always empty.
  const withNl = pageResult("l1\nl2\nl3\n", { lines: 10, chars: 0 });
  assert.equal(withNl.truncated, false, "three lines under the cap is not a truncation");
  assert.equal(withNl.totalLines, 3, "and the trailing newline is not a fourth line");
  assert.equal(withNl.text, "l1\nl2\nl3\n", "but the bytes come back EXACTLY as they went in when nothing is cut");
  const exact = pageResult(Array.from({ length: 400 }, (_, i) => `n${i + 1}`).join("\n") + "\n", { lines: 400, chars: 0 });
  assert.equal(exact.truncated, false, "a 400-line file with a trailing newline is exactly at the cap, not over it");
  assert.equal(exact.totalLines, 400);
  const over = pageResult(Array.from({ length: 401 }, (_, i) => `n${i + 1}`).join("\n") + "\n", { lines: 400, chars: 0 });
  assert.equal(over.truncated, true, "401 real lines is over it");
  assert.equal(over.totalLines, 401, "and the count is of real lines");
});

// ---------------------------------------------------------------------------------------------------
// Through the tool server, with a real LocalHands and a real temp file: this is the path an agent actually takes.
// ---------------------------------------------------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), "filament-mcp-"));
const hands = new LocalHands();
const clientTools = (roles) => ({
  has: (r) => roles.includes(r),
  buildRead: (a) => ({ name: "Read", input: a }),
  buildBash: (a) => ({ name: "Bash", input: a }),
  buildWrite: (a) => ({ name: "Write", input: a }),
  nameFor: (k) => k,
  summary: () => [...roles],
});
// `askClient` is what the bridge calls when the chat client has the tool; the fake answers like a client that returns
// the whole file, because that is the point — the client's copy stays full fidelity and only the agent's is bounded.
const makeServer = (askClient = null) => new McpToolServer({
  bridge: { askClient: askClient || (async () => { throw new Error("no client in this test"); }), permitLocal: async () => null, contextForMcpToken: () => null },
  hands,
});
const ctx = (acp, tools = null) => ({ turn: tools ? { done: false, clientTools: tools } : null, cwd: dir, upstream: { id: "u", acp }, native: true });

const BIG = join(dir, "big.txt");
writeFileSync(BIG, Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join("\n"));
const LONG = join(dir, "long.txt");
writeFileSync(LONG, Array.from({ length: 400 }, (_, i) => `L${i + 1}:${"y".repeat(195)}`).join("\n"));

test("Read: the agent gets a page and a working way to ask for the next one", async () => {
  const srv = makeServer();
  const sink = {};
  const out = await srv.call("Read", { file_path: BIG }, ctx({}), sink);
  assert.equal(sink.via, "filament", "no client tools here, so Filament's own hands read it");
  assert.ok(out.startsWith("     1\tline 1\n"), `the first page starts at the beginning, in cat -n form: ${out.slice(0, 60)}`);
  assert.ok(out.includes("line 400") && !out.includes("line 401\n"), "and stops at the page size");
  assert.equal(sink.paged, `400/1000 lines`, "the record of what was paged");
  // The continuation hint has to be the offset that actually continues it, or the agent skips or re-reads lines.
  assert.match(out, /offset=401/, `the next page is 401: ${out.slice(-220)}`);
  assert.match(out, /400 of 1000 lines/, "and it says how much of the read this was");
  assert.match(out, /The rest is still on disk/, "and it says where the rest is — honestly: Filament's own hands read this, so there is no client copy to point at");
  // The one genuinely new hazard paging introduces: an agent that has seen a page and then uses Write replaces the
  // whole file with the part it read. Edit is safe on a partial read, Write is not, so the note has to say so.
  assert.match(out, /use Edit — Write would replace all 1000 lines/, "and it warns against the one way paging can lose data");
  // Following the hint lands exactly where the first page stopped — no gap, no overlap.
  const sink2 = {};
  const page2 = await srv.call("Read", { file_path: BIG, offset: 401 }, ctx({}), sink2);
  assert.match(page2, /line 401\b/, "page 2 starts at 401");
  assert.ok(!page2.includes("\tline 400\n"), "and does not repeat page 1's last line");
  assert.match(page2, /offset=801/, "and points at page 3");
  // An explicit offset still pages from there.
  const sink3 = {};
  const mid = await srv.call("Read", { file_path: BIG, offset: 900 }, ctx({}), sink3);
  assert.match(mid, /line 900\b/, "starts where asked");
  assert.ok(!mid.includes("Filament:"), "101 lines is under the cap, so no paging note at all");
});

test("Read: a character ceiling reports what is actually visible and continues from the next whole line", async () => {
  const srv = makeServer();
  const sink = {};
  const out = await srv.call("Read", { file_path: LONG }, ctx({}), sink);
  assert.match(out, /cut at the character ceiling/, "it says the character limit was what bit");
  const m = /(\d+) of 400 lines/.exec(out);
  assert.ok(m, `it reports how many lines are actually visible: ${out.slice(-240)}`);
  const shown = Number(m[1]);
  // The whole point: a character ceiling shows FEWER lines than the line cap allowed, and reporting the line cap's
  // number would tell the agent it has 400 lines when it has a fifth of that.
  assert.ok(shown > 1 && shown < 400, `the visible count reflects the character cut, not the line cap (${shown})`);
  // The cut is on a line boundary now, so the next page starts immediately after the last whole line shown: no gap,
  // no overlap, and no fragment for the agent to mistake for complete text.
  const off = Number(/offset=(\d+)/.exec(out)[1]);
  assert.equal(off, shown + 1, `continues from the line after the last complete one (${shown})`);
  assert.equal(sink.paged, `${shown}/400 lines`, "and the record agrees with what the agent was told");
  const page2 = await srv.call("Read", { file_path: LONG, offset: off }, ctx({}));
  assert.ok(page2.includes(`L${off}:`), `page 2 starts exactly where page 1 stopped: ${page2.slice(0, 90)}`);
  assert.ok(!page2.includes(`L${off - 1}:`), "and does not repeat page 1's last line");
});

test("Read: one line longer than the ceiling says so instead of advertising an offset that loops", async () => {
  // A minified bundle. The old note computed `offset = start` here, so an agent following it got the byte-identical
  // page back and looped forever, with the rest of the line unreachable through Read.
  const huge = join(dir, "huge.txt");
  writeFileSync(huge, `${"Q".repeat(60000)}\nshort line after\n`);
  const srv = makeServer();
  const sink = {};
  const out = await srv.call("Read", { file_path: huge }, ctx({ nativePageChars: 20000 }), sink);
  assert.match(out, /longer than the 20000-character page ceiling/, `it names the real problem: ${out.slice(-260)}`);
  assert.match(out, /would return this same one/, "and says why an offset would not help");
  assert.match(out, /Grep/, "then points at what will work");
  assert.ok(!/offset=\d+/.test(out), `and does NOT advertise a continuation offset: ${out.slice(-200)}`);
  assert.ok(sink.paged, "it is still recorded as paged");
});

test("Read: a trailing newline does not produce a phantom page", async () => {
  // The normal case for a text file, and the one that made every count off by one.
  const nl = join(dir, "nl.txt");
  writeFileSync(nl, Array.from({ length: 400 }, (_, i) => `nl ${i + 1}`).join("\n") + "\n");
  const srv = makeServer();
  const sink = {};
  const out = await srv.call("Read", { file_path: nl }, ctx({}), sink);
  assert.ok(!out.includes("(Filament:"), `exactly 400 lines is at the cap, not over it: ${out.slice(-160)}`);
  assert.equal(sink.paged, undefined, "and nothing is recorded as paged");
  assert.ok(!/\n\s*401\t/.test(out), "no phantom numbered line 401 is invented");
  // One line more really does page, and the total it reports is of real lines.
  writeFileSync(nl, Array.from({ length: 401 }, (_, i) => `nl ${i + 1}`).join("\n") + "\n");
  const sink2 = {};
  const out2 = await srv.call("Read", { file_path: nl }, ctx({}), sink2);
  assert.match(out2, /400 of 401 lines/, "the count is of real lines, not of split() elements");
  assert.match(out2, /offset=401/, "and the next page is the real last line");
  const page2 = await srv.call("Read", { file_path: nl, offset: 401 }, ctx({}));
  assert.match(page2, /nl 401/, "which is not empty");
});

test("Read: nativePaging off returns the whole file, and a custom page size is honoured", async () => {
  const srv = makeServer();
  const off = await srv.call("Read", { file_path: BIG }, ctx({ nativePaging: false }));
  assert.ok(off.includes("line 1000"), "all 1000 lines come back");
  assert.ok(!off.includes("(Filament:"), "with no paging note");
  const small = await srv.call("Read", { file_path: BIG }, ctx({ nativePageLines: 50 }));
  assert.ok(small.includes("line 50") && !small.includes("line 51\n"), "a 50-line page");
  assert.match(small, /offset=51/, "and the hint follows the configured size, not the default");
  // A nonsense value falls back to the documented default rather than to "no cap": an unset knob must not silently
  // turn paging off, which is the same trap as `Number(undefined) || 0` elsewhere in this codebase.
  const junk = await srv.call("Read", { file_path: BIG }, ctx({ nativePageLines: "abc" }));
  assert.match(junk, /offset=401/, "a non-numeric page size means the default, not uncapped");
});

test("Read through the client: the client's answer is paged for the agent, and the record says the client did it", async () => {
  // The client returns the whole file (that is what a client does); what goes back into the agent's context is
  // bounded. The client's own history keeps everything, which is why this costs nothing on the client side.
  const whole = Array.from({ length: 1000 }, (_, i) => `client line ${i + 1}`).join("\n");
  const srv = makeServer(async (turn, req) => { assert.equal(req.kind, "read"); return req.parse(whole, false); });
  const sink = {};
  const out = await srv.call("Read", { file_path: BIG }, ctx({}, clientTools(["read"])), sink);
  assert.equal(sink.via, "client", "the chat client ran the read, so it rendered a native card");
  assert.ok(out.includes("client line 400") && !out.includes("client line 401"), "and the agent still only got a page");
  assert.match(out, /offset=401/, "with a way to continue");
  // The two paths must not claim the same thing. On the client path the client ran the read and keeps its own copy;
  // on Filament's own hands there is no client copy at all and the rest is simply on disk. Saying "your client has the
  // whole file" when Filament's hands did the work is the exact fallback this visibility work exists to expose.
  assert.match(out, /chat client ran this read and keeps its own copy/, "the client path credits the client");
  assert.ok(!out.includes("still on disk"), "and does not use the hands-path wording");
  // A client may itself have capped what it returned, so the total is qualified as what THIS read produced rather
  // than asserted as the length of the file.
  assert.match(out, /of 1000 lines from this read/, "the count is of this read, not a claim about the file");
});

test("Bash: the tail survives, and the exit code can never be pushed out of the page", async () => {
  // A fake terminal so the test is deterministic and platform-independent: 1000 lines of noise, then a failure.
  const loudHands = {
    runTerminal: (a, term) => { term.output = Array.from({ length: 1000 }, (_, i) => `noise ${i + 1}`).join("\n"); term.exit = { exitCode: 3 }; return Promise.resolve(); },
    kill: () => {},
  };
  const srv = new McpToolServer({ bridge: { askClient: async () => "", permitLocal: async () => null }, hands: loudHands });
  const sink = {};
  const out = await srv.call("Bash", { command: "npm test" }, ctx({}), sink);
  assert.equal(sink.via, "filament");
  assert.ok(out.includes("noise 1000"), "the last line of output is there");
  assert.ok(!out.includes("noise 1\n"), "and the first was dropped — the tail is what a failure needs");
  assert.match(out, /kept the last 400 of 1000 lines/, "the agent is told what it got");
  // THE PART THAT MATTERS: the exit code is appended AFTER the cut. If it were part of the paged text, a long enough
  // output would push the single most important fact about a failed command out of the agent's view.
  assert.ok(out.trimEnd().endsWith("Exit code: 3"), `the exit code is the very last thing: ${out.slice(-160)}`);
  assert.match(out, /Narrow the command, or redirect it to a file/, "and it is told how to get the rest");
});

test("Bash: the exit code survives a CHARACTER ceiling too, not just a line cap", async () => {
  // The line-cap case is the easy one. Here every line is long, so the character ceiling is what bites — and the
  // property that matters is unchanged: the exit code is appended after the cut, so no amount of output can push the
  // single most important fact about a failed command out of the agent's view.
  const loudHands = {
    runTerminal: (a, term) => { term.output = Array.from({ length: 1000 }, (_, i) => `n${i + 1}:${"w".repeat(290)}`).join("\n"); term.exit = { exitCode: 7 }; return Promise.resolve(); },
    kill: () => {},
  };
  const srv = new McpToolServer({ bridge: { askClient: async () => "", permitLocal: async () => null }, hands: loudHands });
  const sink = {};
  const out = await srv.call("Bash", { command: "build" }, ctx({ nativePageChars: 20000 }), sink);
  assert.match(out, /cut at the character ceiling/, "it says which limit bit");
  assert.ok(out.trimEnd().endsWith("Exit code: 7"), `the exit code is still the very last thing: ${out.slice(-190)}`);
  assert.ok(out.includes("n1000:"), "and the tail of the output is what was kept");
  assert.ok(!out.includes("n1:"), "not the head");
  assert.ok(out.length < 21000, `the page respects the ceiling even with the note and the exit code added: ${out.length}`);
  // Every line kept is whole: a fragment of a build log is worse than one line fewer.
  const keptLines = out.split("\n(Filament:")[0].split("\n").filter((l) => l.startsWith("n"));
  assert.ok(keptLines.every((l) => /^n\d+:w+$/.test(l)), `no line is cut in half: ${JSON.stringify(keptLines[0]?.slice(-20))}`);
  assert.ok(sink.paged, "and it is recorded as paged");
});

test("Bash: a command that finishes does not leave its timeout timer running", async () => {
  // The kill timer raced against the command was never cleared when the command won, so every Bash call left a
  // 120 s timer alive: one per call in production, and this whole test FILE took two minutes to exit — which, with
  // files run in parallel, set the wall time of the entire suite. Counted with Node's own resource introspection so
  // the assertion is about the leak, not about how long the process took.
  const quickHands = { runTerminal: (a, term) => { term.output = "done\n"; term.exit = { exitCode: 0 }; return Promise.resolve(); }, kill: () => {} };
  const srv = new McpToolServer({ bridge: { askClient: async () => "", permitLocal: async () => null }, hands: quickHands });
  const timersBefore = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  const out = await srv.call("Bash", { command: "quick" }, ctx({}));
  assert.equal(out.trim(), "done", "the command's output is returned as usual");
  const timersAfter = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  assert.ok(timersAfter <= timersBefore, `no timer survives the finished command: ${timersBefore} before, ${timersAfter} after`);
});

test("Bash: a timeout note also survives the cut, and a killed command says so", async () => {
  // Same reasoning as the exit code, for the other note that must never be the thing paging drops.
  const slowHands = {
    runTerminal: (a, term) => { term.output = Array.from({ length: 2000 }, (_, i) => `spinning ${i + 1}`).join("\n"); term.exit = { exitCode: null }; return new Promise(() => {}); }, // never resolves: the timeout fires
    kill: () => {},
  };
  const srv = new McpToolServer({ bridge: { askClient: async () => "", permitLocal: async () => null }, hands: slowHands });
  const out = await srv.call("Bash", { command: "hang", timeout: 1000 }, ctx({}));
  assert.match(out, /command killed after 1 s/, "the timeout is reported");
  assert.ok(out.trimEnd().endsWith("command killed after 1 s)"), `and it is the last thing the agent reads: ${out.slice(-160)}`);
  assert.ok(out.includes("spinning 2000"), "with the tail of what the command produced before it was killed");
});

test("Bash through the client, and a short command that needs no paging", async () => {
  const srv = makeServer(async (turn, req) => { assert.equal(req.kind, "terminal"); return req.parse(Array.from({ length: 900 }, (_, i) => `c${i + 1}`).join("\n"), false); });
  const sink = {};
  const out = await srv.call("Bash", { command: "ls" }, ctx({}, clientTools(["bash"])), sink);
  assert.equal(sink.via, "client", "the client ran the command");
  assert.ok(out.includes("c900") && !out.includes("c1\n"), "and its output was paged from the tail for the agent");
  // Under the cap: nothing added, so a normal command's output is byte-for-byte what it was.
  const quiet = new McpToolServer({ bridge: { askClient: async () => ({ output: "all good", isErr: false }), permitLocal: async () => null }, hands });
  const s2 = {};
  const out2 = await quiet.call("Bash", { command: "echo hi" }, ctx({}, clientTools(["bash"])), s2);
  assert.equal(out2, "all good", "a short result is returned untouched, with no paging note");
  assert.equal(s2.paged, undefined, "and is not recorded as paged");
});

test("who did the work is recorded per call, so the dashboard can show the LocalHands fallback", async () => {
  const srv = makeServer(async () => "from the client");
  // Read: client when it has the tool, Filament's own hands when it does not. That fallback is invisible to the user
  // today — the agent's card says nothing about who actually touched the file.
  const a = {}; await srv.call("Read", { file_path: BIG, limit: 2 }, ctx({}, clientTools(["read"])), a);
  assert.equal(a.via, "client");
  const b = {}; await srv.call("Read", { file_path: BIG, limit: 2 }, ctx({}, clientTools([])), b);
  assert.equal(b.via, "filament", "a client with no read tool falls back to Filament's hands, and says so");
  const c = {}; await srv.call("Read", { file_path: BIG, limit: 2 }, ctx({}), c);
  assert.equal(c.via, "filament", "and so does no client at all");
  // Search always runs locally, whatever the client offers.
  const d = {}; await srv.call("Glob", { pattern: "big.txt" }, ctx({}, clientTools(["read", "bash"])), d);
  assert.equal(d.via, "filament", "Glob runs on Filament's machine even when the client has tools");
  const e = {}; await srv.call("Grep", { pattern: "line 7$", path: BIG, output_mode: "content" }, ctx({}, clientTools(["read"])), e);
  assert.equal(e.via, "filament", "and so does Grep");
  // The sink is per call, not per server: a batched JSON-RPC message runs its calls concurrently, so an instance
  // field would interleave and attribute one call's path to another.
  const f = {}; const g = {};
  await Promise.all([srv.call("Read", { file_path: BIG, limit: 2 }, ctx({}, clientTools(["read"])), f), srv.call("Read", { file_path: BIG, limit: 2 }, ctx({}), g)]);
  assert.equal(f.via, "client", "concurrent calls keep their own attribution");
  assert.equal(g.via, "filament");
});

test("Write and Edit are not paged — they return a short confirmation, and their input is never truncated", async () => {
  // Paging results is safe because a result is only read. Truncating an input would corrupt a file, so the agent's
  // `content` and `old_string`/`new_string` go through whole however long they are.
  const target = join(dir, "written.txt");
  const big = Array.from({ length: 2000 }, (_, i) => `written line ${i + 1}`).join("\n");
  const srv = makeServer();
  const sink = {};
  const out = await srv.call("Write", { file_path: target, content: big }, ctx({}), sink);
  assert.equal(out, `Wrote ${target}`, "the confirmation is short");
  assert.equal(sink.paged, undefined, "and nothing was recorded as paged");
  const { readFileSync } = await import("node:fs");
  assert.equal(readFileSync(target, "utf8"), big, "the whole content reached the file, not a page of it");
  const sink2 = {};
  const edited = await srv.call("Edit", { file_path: target, old_string: "written line 1500", new_string: "WRITTEN LINE 1500" }, ctx({}), sink2);
  assert.match(edited, /Successfully replaced 1 block in .*written\.txt/);
  assert.equal(sink2.paged, undefined);
  assert.ok(readFileSync(target, "utf8").includes("WRITTEN LINE 1500"), "and an edit deep inside a long file still lands");
});

test("walking every page of a large file reconstructs it exactly, and never loops", async () => {
  // The property the whole feature rests on. An off-by-one in the continuation offset does not look like a bug from
  // any single page: it silently skips a line, or repeats one, or — worst — returns the same page forever. So walk
  // the file the way an agent would, following only the hints in the text, and compare against the file.
  const srv = makeServer();
  const walk = async (file, acp) => {
    const pages = []; let offset = 1;
    for (let guard = 0; guard < 200; guard++) {
      const out = await srv.call("Read", { file_path: file, offset }, ctx(acp), {});
      pages.push(out.replace(/\n\(Filament:[\s\S]*$/, "")); // drop the note, keep the page
      const m = /offset=(\d+)/.exec(out);
      if (!m) return pages;
      const next = Number(m[1]);
      assert.ok(next > offset, `the hint always advances: offset ${offset} -> ${next}`);
      offset = next;
    }
    throw new Error("the walk never ended — the hints looped");
  };
  const unnumber = (pages) => pages.join("\n").split("\n").map((l) => l.replace(/^\s*\d+\t/, "")).join("\n").replace(/\n$/, "");
  const { readFileSync } = await import("node:fs");
  for (const [file, acp, what] of [[BIG, {}, "1000 plain lines"], [LONG, {}, "400 long lines (character ceiling)"]]) {
    const pages = await walk(file, acp);
    assert.ok(pages.length > 1, `${what}: it really took several pages (${pages.length})`);
    assert.equal(unnumber(pages), readFileSync(file, "utf8").replace(/\n$/, ""), `${what}: every page together is the file, with no gap and no overlap`);
  }
  // A custom page size walks the same way, in more, smaller pages.
  const small = await walk(BIG, { nativePageLines: 100 });
  assert.equal(small.length, 10, "1000 lines at 100 per page is ten pages");
  assert.equal(unnumber(small), readFileSync(BIG, "utf8").replace(/\n$/, ""), "and still reconstructs exactly");
});

test("CRLF line endings survive paging, so an Edit built from a page still matches the file", async () => {
  // `LocalHands.readTextFile` split on /\r?\n/ and rejoined with "\n", so ANY read that passed an offset or a limit
  // silently converted a CRLF file to LF — while a whole-file read preserved it. The Edit path reads the file raw and
  // compares against the bytes on disk, so an agent that paged through a Windows-checked-out file and then built an
  // `old_string` from what it saw got "old_string was not found". Paging is what sends agents down that path.
  const crlf = join(dir, "crlf.txt");
  writeFileSync(crlf, Array.from({ length: 900 }, (_, i) => `win line ${i + 1}`).join("\r\n") + "\r\n");
  const srv = makeServer();
  const page2 = await srv.call("Read", { file_path: crlf, offset: 401 }, ctx({}), {});
  assert.ok(page2.includes("\r\n"), `the carriage returns survive a paged read: ${JSON.stringify(page2.slice(0, 60))}`);
  // Take a line straight out of the page and use it as an Edit target — the thing that used to fail.
  const target = page2.replace(/\n\(Filament:[\s\S]*$/, "").split("\n")[5].replace(/^\s*\d+\t/, "").replace(/\r$/, "");
  assert.match(target, /^win line \d+$/, `a usable line came out of the page: ${JSON.stringify(target)}`);
  const edited = await srv.call("Edit", { file_path: crlf, old_string: target, new_string: "REPLACED" }, ctx({}), {});
  assert.match(edited, /Successfully replaced 1 block/, "and an Edit built from a paged read matches the file");
  // Whole-file and paged reads must agree about the same file, or the agent gets two different versions of it.
  const whole = await srv.call("Read", { file_path: crlf }, ctx({ nativePaging: false }), {});
  assert.ok(whole.includes("\r\n"), "a whole-file read keeps them too");
});

// (fails before: yes — Filament's own Edit read and wrote the raw text: an old_string with LF lines missed a CRLF file,
// and a file that is not UTF-8 had every byte the edit did not touch rewritten)
test("Edit on Filament's hands is the loop's edit: a CRLF file with a BOM takes LF lines and keeps both; one not UTF-8 is refused untouched", async () => {
  const srv = makeServer();
  const win = join(dir, "bom-crlf.txt");
  writeFileSync(win, "\uFEFFone\r\ntwo\r\nthree\r\n");
  assert.equal(await srv.call("Edit", { file_path: win, old_string: "one\ntwo", new_string: "ONE\nTWO" }, ctx({}), {}), `Successfully replaced 1 block in ${win}`);
  assert.equal(readFileSync(win, "utf8"), "\uFEFFONE\r\nTWO\r\nthree\r\n");
  const latin1 = join(dir, "latin1.txt");
  const bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a, 0x6f, 0x6e, 0x65, 0x0a]); // café, one: the é one Latin-1 byte
  writeFileSync(latin1, bytes);
  await assert.rejects(() => srv.call("Edit", { file_path: latin1, old_string: "one", new_string: "two" }, ctx({})), /latin1\.txt is not UTF-8 text/);
  assert.deepEqual(readFileSync(latin1), bytes, "its bytes as they were");
  // Refused in its own words: the field the agent sends is replace_all.
  const twice = join(dir, "twice.txt");
  writeFileSync(twice, "beta\nbeta\n");
  await assert.rejects(() => srv.call("Edit", { file_path: twice, old_string: "beta", new_string: "B" }, ctx({})), /set replace_all to replace every one/);
  // (fails before: no — a guard the mutation pass asked for: replace_all was not handed to the edit)
  assert.equal(await srv.call("Edit", { file_path: twice, old_string: "beta", new_string: "B", replace_all: true }, ctx({}), {}), `Successfully replaced 2 blocks in ${twice}`);
  assert.equal(readFileSync(twice, "utf8"), "B\nB\n");
});

// (fails before: yes — the agent's pattern ran on the proxy's thread: one that backtracks without end on one line held
// every chat for seconds)
test("Grep is the loop's search: a pattern that backtracks never holds the proxy's thread; paths whole, the files by default", async () => {
  const where = join(dir, "grep");
  mkdirSync(where);
  writeFileSync(join(where, "a.txt"), "aaa\nbeta\ngamma\n");
  writeFileSync(join(where, "b.txt"), `${"a".repeat(29)}b\n`);
  const srv = makeServer();
  let last = Date.now();
  let worst = 0;
  const tick = setInterval(() => {
    worst = Math.max(worst, Date.now() - last);
    last = Date.now();
  }, 20);
  let found;
  try {
    found = await srv.call("Grep", { pattern: "(a+)+$", path: where }, ctx({}), {});
    await new Promise((r) => setTimeout(r, 50)); // a tick held back by a stall lands first, and counts it
  } finally {
    clearInterval(tick);
  }
  assert.ok(worst < 1000, `the proxy's thread stalled ${worst} ms`);
  // ripgrep answers at once; without it the walk is stopped at the search's time, with what it found.
  assert.equal(found.split("\n")[0], join(where, "a.txt"));
  // Claude Code's words: -i, -A, and the output mode's own name.
  const lines = await srv.call("Grep", { pattern: "BETA", path: where, output_mode: "content", "-i": true, "-A": 1 }, ctx({}), {});
  assert.equal(lines, `${join(where, "a.txt")}:2:beta\n${join(where, "a.txt")}-3-gamma`);
});

// (fails before: no — a guard the mutation pass asked for: the search was fenced to the project folder)
test("Grep searches where the agent says, outside the project folder too", async () => {
  const outside = mkdtempSync(join(tmpdir(), "filament-mcp-out-"));
  try {
    writeFileSync(join(outside, "far.txt"), "needle\n");
    assert.equal(await makeServer().call("Grep", { pattern: "needle", path: outside }, ctx({}), {}), join(outside, "far.txt"));
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

// (fails before: yes — the search returned up to 200 matching lines of 300 characters, past what a model's window
// takes in one result)
test("Grep's result fits a model's budget, cut in words", async () => {
  writeFileSync(join(dir, "wide.txt"), Array.from({ length: 100 }, (_, i) => `needle ${i} ${"x".repeat(400)}`).join("\n"));
  const out = await makeServer().call("Grep", { pattern: "needle \\d", path: join(dir, "wide.txt"), output_mode: "content" }, ctx({}), {});
  assert.ok(Buffer.byteLength(out) <= RESULT_BUDGET_BYTES, `${Buffer.byteLength(out)} bytes`);
  assert.match(out, /past this result's budget/);
});

test("a failed tool call still reports the error, not a page of it", async () => {
  const srv = makeServer();
  await assert.rejects(() => srv.call("Read", { file_path: join(dir, "nope.txt") }, ctx({})), /cannot read/, "a missing file is an error, and paging never swallows it");
  await assert.rejects(() => srv.call("Read", {}, ctx({})), /file_path is required/);
  await assert.rejects(() => srv.call("Nope", {}, ctx({})), /unknown tool/);
});

test("cleanup", () => { rmSync(dir, { recursive: true, force: true }); });

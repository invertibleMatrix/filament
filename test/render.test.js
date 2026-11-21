import { test } from "node:test";
import assert from "node:assert/strict";
import { lineDiff, unifiedHunks, renderDiff, renderOutput, renderPlan, describeStopReason, mapStopReason, ActivityRenderer, ThoughtInliner, sanitizeUnicodeTags } from "../src/acp-render.js";

test("lineDiff finds the minimal line changes and renderDiff shows them with context", () => {
  const ops = lineDiff("a\nb\nc\nd\ne", "a\nB\nc\nd\ne\nf");
  assert.deepEqual(ops.map((o) => o.t).join(""), "=-+===+");
  const h = unifiedHunks(ops, { context: 1 }); assert.equal(h.added, 2); assert.equal(h.removed, 1);
  const d = renderDiff("src/x.js", "a\nb\nc\nd\ne", "a\nB\nc\nd\ne\nf");
  assert.ok(d.startsWith("```diff\n--- src/x.js\n+++ src/x.js\n") && d.includes("-b\n+B") && d.includes("+f"), d);
  assert.ok(renderDiff("new.txt", null, "x\ny").includes("--- /dev/null\n+++ new.txt\n+x\n+y"));
  assert.equal(renderDiff("same.txt", "one\ntwo", "one\ntwo"), null, "identical content shows nothing");
  const big = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n");
  const dd = renderDiff("big.txt", big, big.replace("line 150", "changed").replace("line 10", "x"));
  assert.ok(dd.includes("-line 10\n+x") && dd.includes("-line 150\n+changed") && dd.includes("@@ … @@") && dd.split("\n").length < 30, dd);
  const huge = renderDiff("h.txt", "a\n".repeat(200), Array.from({ length: 200 }, (_, i) => `l${i}`).join("\n"));
  assert.ok(huge.includes("more line") || huge.includes("too large") || huge.split("\n").length <= 70, huge.slice(0, 200));
});

test("renderOutput keeps the tail, strips colours, notes the exit code", () => {
  const o = renderOutput("\x1b[32mok\x1b[0m\n" + Array.from({ length: 50 }, (_, i) => `row ${i}`).join("\n"), { exitCode: 2 });
  assert.ok(o.startsWith("```text\n… 21 earlier lines not shown · exit code 2\n") && o.includes("row 49") && !o.includes("\x1b"), o);
  assert.equal(renderOutput("", { exitCode: null }), null);
  assert.ok(renderOutput("has ``` fence").startsWith("````text"));
});

test("renderPlan shows the checklist once, then only the steps that changed", () => {
  const a = renderPlan([{ content: "one", status: "pending", priority: "high" }, { content: "two", status: "pending" }], null);
  assert.ok(a.text.includes("**Plan**") && a.text.includes("- [ ] one ·high") && a.text.includes("- [ ] two"));
  const b = renderPlan([{ content: "one", status: "completed", priority: "high" }, { content: "two", status: "in_progress" }], a.state);
  assert.equal(b.text, "✓ one\n▸ two\n");
  const c = renderPlan([{ content: "one", status: "completed" }, { content: "two", status: "in_progress" }], b.state); assert.equal(c.text, null);
  const d = renderPlan([{ content: "different", status: "pending" }], c.state); assert.ok(d.text.includes("**Plan** (updated)"));
});

// (fails before: yes — a sub-agent's plan printed as the turn's, and the turn's next update was read against it)
test("an outside client's chat: a sub-agent's plan never prints as the turn's, whose next update shows only what changed", () => {
  const r = new ActivityRenderer({ agentName: "Claude Code" });
  assert.match(r.handle({ type: "plan", entries: [{ content: "one", status: "pending" }, { content: "two", status: "pending" }] }) || "", /\*\*Plan\*\*/);
  assert.equal(r.handle({ type: "plan", entries: [{ content: "its own step", status: "pending" }], subagent: "S1" }), null);
  assert.equal(r.handle({ type: "plan", entries: [{ content: "one", status: "completed" }, { content: "two", status: "pending" }] }), "✓ one\n");
});

test("stop reasons get words and the right wire vocabulary", () => {
  assert.match(describeStopReason("refusal", "Cursor"), /Cursor refused/); assert.equal(describeStopReason("end_turn", "x"), null);
  assert.equal(mapStopReason("refusal", "anthropic"), "refusal"); assert.equal(mapStopReason("refusal", "openai"), "content_filter");
  assert.equal(mapStopReason("max_tokens", "openai"), "length"); assert.equal(mapStopReason("cancelled", "anthropic"), "end_turn");
});

test("ActivityRenderer announces a tool once, when its target is known, and nests sub-agent work", () => {
  const r = new ActivityRenderer({ toolMode: "text", agentName: "fake" });
  assert.equal(r.handle({ type: "tool", id: "t1", title: "Read File", kind: "read", status: "pending" }), null, "generic pending title waits");
  assert.equal(r.handle({ type: "tool", id: "t1", title: "Read src/a.js", kind: "read", status: "completed" }), "⚙ Read src/a.js\n");
  assert.equal(r.handle({ type: "tool", id: "t1", title: "Read src/a.js", kind: "read", status: "completed" }), null, "not twice");
  const e = r.handle({ type: "tool", id: "e1", title: "Edit src/a.js", kind: "edit", status: "completed", content: [{ type: "diff", path: "src/a.js", oldText: "x", newText: "y" }] });
  assert.ok(e.startsWith("⚙ Edit src/a.js\n```diff"), e);
  assert.equal(r.handle({ type: "tool", id: "c1", title: "Read src/b.js", kind: "read", status: "completed", parentToolCallId: "a1" }), "  ↳ ⚙ Read src/b.js\n");
  assert.equal(r.handle({ type: "tool", id: "x1", title: "npm test", kind: "execute", status: "failed" }), "⚙ run `npm test`\n✗ failed: npm test\n");
  const hidden = new ActivityRenderer({ toolMode: "hide" }); assert.equal(hidden.handle({ type: "tool", id: "t", title: "Read a.js", status: "completed" }), null);
});

test("quiet feed: two lines per call at most, updates silenced, edits summarised, output only on failure", () => {
  const r = new ActivityRenderer({ toolMode: "quiet", agentName: "fake" });
  // §9.1 — the generic first title does not get announced, and intermediate updates emit NOTHING.
  assert.equal(r.handle({ type: "tool", id: "t1", title: "tool call", kind: "read", status: "pending" }), null, "a generic pending title is not announced");
  assert.equal(r.handle({ type: "tool", id: "t1", title: "Read src/a.js", kind: "read", status: "in_progress" }), "⚙ Read src/a.js\n", "announced once, as soon as the target is known");
  for (let i = 0; i < 20; i++) assert.equal(r.handle({ type: "tool", id: "t1", title: "Read src/a.js", kind: "read", status: "in_progress" }), null, `update ${i} is merged silently`);
  assert.equal(r.handle({ type: "tool", id: "t1", title: "Read src/a.js", kind: "read", status: "completed" }), null, "a plain success adds no second line — the announce was enough");
  assert.equal(r.stats.updates, 20, "and the silenced updates are counted");
  assert.equal(r.stats.calls, 1);

  // §9.2 — an edit is a `+A −R path` summary, never a fenced diff block.
  const e = new ActivityRenderer({ toolMode: "quiet" });
  const out = e.handle({ type: "tool", id: "e1", title: "Edit src/proxy.js", kind: "edit", status: "completed", content: [{ type: "diff", path: "src/proxy.js", oldText: "a\nb\nc", newText: "a\nB\nc\nd" }] });
  assert.equal(out, "⚙ Edit src/proxy.js\n✓ +2 −1 src/proxy.js\n", "one announce plus one summary line (a,b,c → a,B,c,d is one changed line and one added)");
  assert.ok(!out.includes("```"), "no fenced block reaches the chat in quiet mode");
  assert.ok(!out.includes("@@"), "and no hunk headers");

  // A failing command carries its exit code and the tail of its output on the ✗ line, and no fence.
  const f = new ActivityRenderer({ toolMode: "quiet" });
  const failOut = f.handle({ type: "tool", id: "x1", title: "npm test", kind: "execute", status: "failed", exitCode: 1, terminalOutput: { output: "line1\nline2\nFAIL auth.test.js\nexit", exitCode: 1 } });
  assert.match(failOut, /^⚙ run `npm test`\n/, "announced first");
  assert.match(failOut, /✗ npm test — exit 1: /, "then one failure line with the exit code");
  assert.match(failOut, /FAIL auth\.test\.js/, "carrying the tail of the output");
  assert.ok(!failOut.includes("```"), "and still no fenced dump");
  assert.ok(failOut.split("\n").filter(Boolean).length <= 3, `at most a few lines total (got ${failOut.split("\n").filter(Boolean).length})`);

  // A PASSING command shows no output at all — the whole point of `outputMode: failure`.
  const ok = new ActivityRenderer({ toolMode: "quiet" });
  const okOut = ok.handle({ type: "tool", id: "p1", title: "npm test", kind: "execute", status: "completed", terminalOutput: { output: "1200 passing\n".repeat(40), exitCode: 0 } });
  assert.equal(okOut, "⚙ run `npm test`\n", "a passing command's transcript never reaches the chat");

  // Nested calls keep the ↳ indent, and sub-agents stay one line each.
  const n = new ActivityRenderer({ toolMode: "quiet" });
  assert.equal(n.handle({ type: "tool", id: "c1", title: "Read src/b.js", kind: "read", status: "completed", parentToolCallId: "a1" }), "  ↳ ⚙ Read src/b.js\n");
  assert.equal(n.handle({ type: "subagent", id: "s1", state: "started", name: "researcher", description: "d" }), "⚙ sub-agent researcher started: d\n");
  assert.equal(n.handle({ type: "subagent", id: "s1", state: "started", name: "researcher" }), null, "not announced twice");
  assert.equal(n.handle({ type: "subagent", id: "s1", state: "completed", name: "researcher" }), "✓ sub-agent researcher finished\n");
  // hide still means hide
  const h = new ActivityRenderer({ toolMode: "hide" });
  assert.equal(h.handle({ type: "tool", id: "t", title: "Read a.js", status: "completed" }), null);
  assert.equal(h.handle({ type: "plan", entries: [{ content: "step", status: "pending" }] }), null);
});

test("quiet feed dedupes by TOOL ID, not by the formatted title", () => {
  // The old `lines` Set keyed on the rendered string, which merged two genuinely different calls that happened to
  // share a title (reading the same file twice) and missed a repeat when the agent renamed a call mid-flight.
  const r = new ActivityRenderer({ toolMode: "quiet" });
  const first = r.handle({ type: "tool", id: "a", title: "Read src/a.js", kind: "read", status: "completed" });
  const second = r.handle({ type: "tool", id: "b", title: "Read src/a.js", kind: "read", status: "completed" });
  assert.equal(first, "⚙ Read src/a.js\n");
  assert.equal(second, "⚙ Read src/a.js\n", "a SECOND call with the same title is still announced — it really happened");
  assert.equal(r.stats.announced, 2);
  // and one call whose title changes mid-flight is announced exactly once, not once per title
  const r2 = new ActivityRenderer({ toolMode: "quiet" });
  assert.equal(r2.handle({ type: "tool", id: "c", title: "Edit file", kind: "edit", status: "pending" }), null, "the generic title waits");
  assert.equal(r2.handle({ type: "tool", id: "c", title: "Edit src/x.js", kind: "edit", status: "in_progress" }), "⚙ Edit src/x.js\n");
  assert.equal(r2.handle({ type: "tool", id: "c", title: "Edit src/x.js (2 files)", kind: "edit", status: "in_progress" }), null, "a renamed title does not announce again");
  assert.equal(r2.stats.announced, 1);
  // the same id replayed after completion still emits nothing new
  assert.equal(r.handle({ type: "tool", id: "a", title: "Read src/a.js", kind: "read", status: "completed" }), null);
});

test("text and verbose modes keep the fenced behaviour; the dashboard knobs override it", () => {
  const t = new ActivityRenderer({ toolMode: "text" });
  const out = t.handle({ type: "tool", id: "e1", title: "Edit src/a.js", kind: "edit", status: "completed", content: [{ type: "diff", path: "src/a.js", oldText: "x", newText: "y" }] });
  assert.ok(out.startsWith("⚙ Edit src/a.js\n```diff"), `text mode still fences the diff: ${out.slice(0, 60)}`);
  const tOut = new ActivityRenderer({ toolMode: "text" }).handle({ type: "tool", id: "p", title: "npm test", kind: "execute", status: "completed", terminalOutput: { output: "all good", exitCode: 0 } });
  assert.match(tOut, /```text/, "and still shows a passing command's output");
  // verbose raises the caps rather than changing the shape
  const v = new ActivityRenderer({ toolMode: "verbose" });
  assert.equal(v.maxDiffs, 8, "verbose shows more files per call");
  assert.ok(v.maxOutputLines > 30, "and more output lines");
  // explicit overrides beat the mode's defaults, which is what makes every combination playable from the dashboard
  const quietWithDiffs = new ActivityRenderer({ toolMode: "quiet", diffStyle: "fenced" });
  assert.match(quietWithDiffs.handle({ type: "tool", id: "e", title: "Edit a.js", kind: "edit", status: "completed", content: [{ type: "diff", path: "a.js", oldText: "x", newText: "y" }] }), /```diff/, "quiet lines plus real diffs, if you ask for it");
  const quietWithOutput = new ActivityRenderer({ toolMode: "quiet", outputMode: "always" });
  assert.match(quietWithOutput.handle({ type: "tool", id: "p", title: "npm test", kind: "execute", status: "completed", terminalOutput: { output: "all good", exitCode: 0 } }), /```text/, "an explicit `always` overrides quiet's failures-only default");
  const noDiffs = new ActivityRenderer({ toolMode: "text", diffStyle: "off" });
  assert.equal(noDiffs.handle({ type: "tool", id: "e", title: "Edit a.js", kind: "edit", status: "completed", content: [{ type: "diff", path: "a.js", oldText: "x", newText: "y" }] }), "⚙ Edit a.js\n", "`off` announces the edit but never shows it");
  const neverOut = new ActivityRenderer({ toolMode: "text", outputMode: "never" });
  assert.equal(neverOut.handle({ type: "tool", id: "p", title: "npm test", kind: "execute", status: "completed", terminalOutput: { output: "all good", exitCode: 0 } }), "⚙ run `npm test`\n");
  // a pre-rendered diffText is summarised from its own +/- lines in quiet mode
  const pre = new ActivityRenderer({ toolMode: "quiet" });
  const preOut = pre.handle({ type: "tool", id: "d", title: "Edit b.js", kind: "edit", status: "completed", diffText: "--- b.js\n+++ b.js\n@@ -1,2 +1,3 @@\n keep\n-old\n+new\n+extra\n" });
  assert.match(preOut, /✓ \+2 −1 b\.js/, `a pre-rendered diff still becomes a summary: ${preOut}`);
  assert.ok(!preOut.includes("```"));
});

test("an edit that changes nothing is not announced as a change", () => {
  const r = new ActivityRenderer({ toolMode: "quiet" });
  const out = r.handle({ type: "tool", id: "s", title: "Edit same.js", kind: "edit", status: "completed", content: [{ type: "diff", path: "same.js", oldText: "identical\n", newText: "identical\n" }] });
  assert.equal(out, "⚙ Edit same.js\n", "the call is announced, but no +0 −0 line is invented");
  // a new file and a deletion say so, since the counts alone would be ambiguous
  const n = new ActivityRenderer({ toolMode: "quiet" });
  assert.match(n.handle({ type: "tool", id: "n", title: "Write new.js", kind: "edit", status: "completed", content: [{ type: "diff", path: "new.js", oldText: null, newText: "a\nb" }] }), /\+2 −0 new\.js \(new\)/);
  const d = new ActivityRenderer({ toolMode: "quiet" });
  assert.match(d.handle({ type: "tool", id: "d", title: "Delete gone.js", kind: "edit", status: "completed", content: [{ type: "diff", path: "gone.js", oldText: "a\nb", newText: null }] }), /\+0 −2 gone\.js \(deleted\)/);
});

test("a long target is clipped to one line, so a 4 KB command cannot flood the reply", () => {
  const r = new ActivityRenderer({ toolMode: "quiet" });
  const out = r.handle({ type: "tool", id: "l", title: `node -e ${"x".repeat(4000)}`, kind: "execute", status: "completed" });
  assert.ok(out.split("\n").filter(Boolean).length === 1, "still exactly one line");
  assert.ok(out.length < 200, `and it is short (${out.length} chars)`);
  assert.match(out, /…/, "clipped with an ellipsis");
  // a failure's detail is clipped too
  const f = new ActivityRenderer({ toolMode: "quiet" });
  const fo = f.handle({ type: "tool", id: "lf", title: "npm test", kind: "execute", status: "failed", exitCode: 2, terminalOutput: { output: Array.from({ length: 400 }, (_, i) => `noise line ${i}`).join("\n"), exitCode: 2 } });
  assert.ok(fo.length < 600, `the failure line stays compact (${fo.length} chars)`);
  assert.match(fo, /exit 2/);
  assert.match(fo, /noise line 399/, "and keeps the LAST lines, where the real error is");
});


test("a diff that arrives on a LATER update is not lost — the case most real agents produce", () => {
  // The P1 this pins. The ACP listener forwards each update's OWN content, not an accumulation, and agents commonly
  // put the path in the title at `tool_call` (so the call is announced immediately) and deliver the diff on a later
  // update. An early return on "already announced" discarded that payload entirely: no fence in text mode, and no
  // `✓ +A −R` summary in quiet mode — the feature's own headline output, silently missing for most real edits.
  const events = [
    { type: "tool", id: "e1", title: "Edit src/late.js", kind: "edit", status: "pending" },
    { type: "tool", id: "e1", title: "Edit src/late.js", kind: "edit", status: "in_progress" },
    { type: "tool", id: "e1", title: "Edit src/late.js", kind: "edit", status: "in_progress", content: [{ type: "diff", path: "src/late.js", oldText: "a\nb", newText: "a\nB\nc" }] },
    { type: "tool", id: "e1", title: "Edit src/late.js", kind: "edit", status: "completed" },
  ];
  const q = new ActivityRenderer({ toolMode: "quiet" });
  const qOut = events.map((e) => q.handle(e)).filter(Boolean).join("");
  assert.equal(qOut, "⚙ Edit src/late.js\n✓ +2 −1 src/late.js\n", `quiet still summarises an edit whose diff rode an intermediate update: ${JSON.stringify(qOut)}`);
  const t = new ActivityRenderer({ toolMode: "text" });
  const tOut = events.map((e) => t.handle(e)).filter(Boolean).join("");
  assert.match(tOut, /^⚙ Edit src\/late\.js\n/, "text mode announces it");
  assert.match(tOut, /```diff/, "and still emits the fence that arrived mid-call");
  assert.match(tOut, /-b\n\+B\n\+c/, "with the real diff content");
  // the same for a pre-rendered diffText on an intermediate update
  const q2 = new ActivityRenderer({ toolMode: "quiet" });
  const q2Out = [
    { type: "tool", id: "d1", title: "Edit b.js", kind: "edit", status: "in_progress" },
    { type: "tool", id: "d1", title: "Edit b.js", kind: "edit", status: "in_progress", diffText: "--- b.js\n+++ b.js\n@@\n keep\n-old\n+new\n" },
    { type: "tool", id: "d1", title: "Edit b.js", kind: "edit", status: "completed" },
  ].map((e) => q2.handle(e)).filter(Boolean).join("");
  assert.match(q2Out, /✓ \+1 −1 b\.js/, `a mid-call diffText is summarised too: ${JSON.stringify(q2Out)}`);
  // and command output that streams mid-call still reaches text mode
  const t2 = new ActivityRenderer({ toolMode: "text" });
  const t2Out = [
    { type: "tool", id: "c1", title: "npm test", kind: "execute", status: "in_progress" },
    { type: "tool", id: "c1", title: "npm test", kind: "execute", status: "in_progress", terminalOutput: { output: "3 passing", exitCode: 0 } },
    { type: "tool", id: "c1", title: "npm test", kind: "execute", status: "completed" },
  ].map((e) => t2.handle(e)).filter(Boolean).join("");
  assert.match(t2Out, /```text/, "text mode shows output that arrived mid-call");
  assert.match(t2Out, /3 passing/);
});

// HarnessV3-ACP AC2-1. (fails before: yes — the first piece was drawn as it came and the rest dropped: Codex's command
// showed its first line only, and Claude's output, sent before its exit code, was drawn without it and left out of the
// failure line)
test("a command's output in pieces is drawn once, whole, with its exit code, when the call ends", () => {
  const run = (/** @type {any} */ r, /** @type {any[]} */ evs) => evs.map((e) => r.handle(e)).filter(Boolean).join("");
  const call = { type: "tool", id: "c1", title: "npm test", kind: "execute" };
  // Codex: the output streams, and the call's end carries all of it.
  const codex = run(new ActivityRenderer({ toolMode: "text" }), [
    { ...call, status: "in_progress" },
    { ...call, status: "in_progress", terminalOutput: { output: "ok 1\n" } },
    { ...call, status: "in_progress", terminalOutput: { output: "ok 2\n" } },
    { ...call, status: "completed", exitCode: 0, content: [{ type: "content", content: { type: "text", text: "ok 1\nok 2\n" } }] },
  ]);
  assert.equal(codex.match(/```text/g)?.length, 1, codex);
  assert.match(codex, /```text\nok 1\nok 2\n```/);
  // Claude: the output whole, then the end with the exit code and no words.
  const claude = [
    { ...call, status: "in_progress" },
    { type: "tool", id: "c1", terminalOutput: { output: "1 failing\nFAIL a.test.js" } },
    { ...call, status: "failed", exitCode: 1, content: [{ type: "terminal", terminalId: "t1" }] },
  ];
  assert.match(run(new ActivityRenderer({ toolMode: "text" }), claude), /```text\nexit code 1\n1 failing\nFAIL a\.test\.js\n```/);
  assert.match(run(new ActivityRenderer({ toolMode: "quiet" }), claude), /✗ npm test — exit 1: 1 failing · FAIL a\.test\.js\n/);
});

test("a call that never reaches a terminal status is still announced", () => {
  // A cancelled turn, or an agent that dies mid-tool, sends no completed/failed update. Requiring a terminal status
  // (or a path character) made such a call vanish from the chat AND from the record's tool list. Short titles like
  // `Read`, `grep` and `TodoWrite` carry no path character at all, so `status !== "pending"` is what announces them.
  for (const title of ["Read", "grep", "TodoWrite", "Task", "ls", "Bash"]) {
    const r = new ActivityRenderer({ toolMode: "quiet" });
    const out = r.handle({ type: "tool", id: "x", title, kind: title === "Bash" || title === "ls" || title === "grep" ? "execute" : "other", status: "in_progress" });
    assert.ok(out && out.includes("⚙"), `${title}: announced while still in progress, got ${JSON.stringify(out)}`);
    assert.equal(r.lines.length, 1, `${title}: and it is in the record's tool list`);
    // a pending generic-or-targetless placeholder still waits for more information
    const p = new ActivityRenderer({ toolMode: "quiet" });
    assert.equal(p.handle({ type: "tool", id: "y", title, kind: "other", status: "pending" }), null, `${title}: a pending title with no target waits`);
  }
  // Generic placeholders never get announced, in any status. This list is exactly what the regex (unchanged from
  // before this work) treats as generic — `shell: command` is NOT in it, so it is announced like any real title.
  for (const g of ["tool call", "Tool", "terminal", "Read File", "shell: call", "command: tool", "mcp", "search"]) {
    const r = new ActivityRenderer({ toolMode: "quiet" });
    const out = r.handle({ type: "tool", id: "g", title: g, kind: "other", status: "completed" });
    assert.equal(out, null, `${g}: a generic placeholder is not announced (got ${JSON.stringify(out)})`);
  }
  // and a title that merely looks generic but is not, IS announced — the regex is a placeholder list, not a guess
  const real = new ActivityRenderer({ toolMode: "quiet" });
  assert.match(real.handle({ type: "tool", id: "r", title: "shell: command --force", kind: "execute", status: "completed" }), /⚙/, "a real command is announced");
});

test("a failure with no title says nothing in text mode, and the quiet fallback marks the call announced", () => {
  // text mode used to require a title; without the guard it emitted a bare "✗ failed: " with no subject.
  const t = new ActivityRenderer({ toolMode: "text" });
  assert.equal(t.handle({ type: "tool", id: "f", title: "", kind: "", status: "failed" }), null, "no subject, no line");
  const t2 = new ActivityRenderer({ toolMode: "text" });
  assert.equal(t2.handle({ type: "tool", id: "f2", title: "   ", kind: "", status: "failed" }), null, "whitespace-only is no subject either");
  // quiet still reports the FAILURE for a title-less call (the ✗ line names the kind), but announces nothing — an
  // empty title has nothing to say, and inventing "⚙ tool call" would be noise. The failure is the information.
  const q = new ActivityRenderer({ toolMode: "quiet" });
  const first = q.handle({ type: "tool", id: "q", title: "", kind: "read", status: "failed" });
  assert.equal(first, "✗ read\n", `quiet names the kind on the failure line and adds no announce: ${JSON.stringify(first)}`);
  assert.equal(q.lines.length, 0, "nothing was announced, so the record's tool list is empty — honest, not padded");
  assert.equal(q.handle({ type: "tool", id: "q", title: "", kind: "read", status: "failed" }), null, "and a repeated terminal update does not repeat the failure");
  // a whitespace-only title behaves the same in quiet
  const q2 = new ActivityRenderer({ toolMode: "quiet" });
  assert.equal(q2.handle({ type: "tool", id: "w", title: "   ", kind: "edit", status: "failed" }), "✗ edit\n");
});

test("toolDiffMaxFiles is authoritative in every mode, and 0 means none", () => {
  const manyDiffs = (n) => Array.from({ length: n }, (_, i) => ({ type: "diff", path: `f${i}.js`, oldText: "a", newText: "b" }));
  // quiet: caps the summary lines
  for (const cap of [1, 2, 5]) {
    const r = new ActivityRenderer({ toolMode: "quiet", maxDiffFiles: cap });
    const out = r.handle({ type: "tool", id: "m", title: "Edit many", kind: "edit", status: "completed", content: manyDiffs(6) });
    const summaries = (out.match(/✓ \+1 −1 f\d+\.js/g) || []).length;
    assert.equal(summaries, Math.min(cap, 6), `quiet with maxDiffFiles ${cap} shows ${Math.min(cap, 6)} summaries (got ${summaries})`);
  }
  // text: caps the fenced blocks — the knob was inert here before
  const t = new ActivityRenderer({ toolMode: "text", maxDiffFiles: 2 });
  const tOut = t.handle({ type: "tool", id: "m", title: "Edit many", kind: "edit", status: "completed", content: manyDiffs(6) });
  assert.equal((tOut.match(/```diff/g) || []).length, 2, "text mode honours the cap too");
  const v = new ActivityRenderer({ toolMode: "verbose", maxDiffFiles: 1 });
  assert.equal((v.handle({ type: "tool", id: "m", title: "Edit many", kind: "edit", status: "completed", content: manyDiffs(6) }).match(/```diff/g) || []).length, 1, "and verbose does not override an explicit number");
  // the mode defaults still apply when the knob is unset
  assert.equal(new ActivityRenderer({ toolMode: "verbose" }).maxDiffs, 8, "verbose defaults to 8");
  assert.equal(new ActivityRenderer({ toolMode: "text" }).maxDiffs, 3, "text defaults to 3");
  assert.equal(new ActivityRenderer({ toolMode: "quiet", maxDiffFiles: null }).maxDiffs, 3, "null means follow the mode");
  // 0 means none, in both styles
  const zero = new ActivityRenderer({ toolMode: "quiet", maxDiffFiles: 0 });
  const zOut = zero.handle({ type: "tool", id: "z", title: "Edit many", kind: "edit", status: "completed", content: manyDiffs(4) });
  assert.equal(zOut, "⚙ Edit many\n", "0 summaries");
  const zeroText = new ActivityRenderer({ toolMode: "text", maxDiffFiles: 0 });
  assert.ok(!zeroText.handle({ type: "tool", id: "z", title: "Edit many", kind: "edit", status: "completed", content: manyDiffs(4) }).includes("```diff"), "0 fences");
});

test("verbose really reaches its raised caps, not just claims them", () => {
  // Property-peeking (maxDiffs === 8) would pass even if #content never consulted the value, so render enough
  // content to hit the caps and count what came out.
  const bigOld = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
  const bigNew = Array.from({ length: 400 }, (_, i) => (i % 2 ? `CHANGED ${i}` : `line ${i}`)).join("\n");
  const v = new ActivityRenderer({ toolMode: "verbose" });
  const out = v.handle({ type: "tool", id: "b", title: "Edit big.js", kind: "edit", status: "completed", content: [{ type: "diff", path: "big.js", oldText: bigOld, newText: bigNew }] });
  const shown = (out.match(/^[+-]/gm) || []).length;
  assert.ok(shown > 60, `verbose shows far more diff lines than the default 60 (got ${shown})`);
  const tx = new ActivityRenderer({ toolMode: "text" });
  const txOut = tx.handle({ type: "tool", id: "b", title: "Edit big.js", kind: "edit", status: "completed", content: [{ type: "diff", path: "big.js", oldText: bigOld, newText: bigNew }] });
  assert.ok((txOut.match(/^[+-]/gm) || []).length < shown, "text mode shows fewer, so the raised cap is doing something");
  // output lines
  const longOut = Array.from({ length: 300 }, (_, i) => `out ${i}`).join("\n");
  const vOut = new ActivityRenderer({ toolMode: "verbose" }).handle({ type: "tool", id: "o", title: "npm test", kind: "execute", status: "completed", terminalOutput: { output: longOut, exitCode: 0 } });
  const tOut = new ActivityRenderer({ toolMode: "text" }).handle({ type: "tool", id: "o", title: "npm test", kind: "execute", status: "completed", terminalOutput: { output: longOut, exitCode: 0 } });
  assert.ok(vOut.split("\n").length > tOut.split("\n").length, `verbose keeps more output lines (${vOut.split("\n").length} vs ${tOut.split("\n").length})`);
  assert.match(vOut, /out 299/, "and still keeps the tail, where the interesting part is");
});

test("renderer state survives across the replies of one live turn, without re-announcing", () => {
  // server.js keeps one renderer per live turn (`liveTurn.renderer`), so a turn that ends on a client tool call and
  // resumes in a later HTTP reply reuses the same instance. Announce state must survive; nothing may repeat.
  const r = new ActivityRenderer({ toolMode: "quiet" });
  assert.equal(r.handle({ type: "tool", id: "a", title: "Read src/a.js", kind: "read", status: "in_progress" }), "⚙ Read src/a.js\n");
  // ... the reply ends, the client runs its tool, a new reply starts on the SAME renderer ...
  assert.equal(r.handle({ type: "tool", id: "a", title: "Read src/a.js", kind: "read", status: "completed" }), null, "the resumed reply does not announce it again");
  assert.equal(r.handle({ type: "tool", id: "b", title: "Edit src/a.js", kind: "edit", status: "completed", content: [{ type: "diff", path: "src/a.js", oldText: "x", newText: "y" }] }), "⚙ Edit src/a.js\n✓ +1 −1 src/a.js\n", "but a NEW call in the resumed reply is announced");
  assert.deepEqual(r.lines.map((l) => l.replace(/^⚙ /, "")), ["Read src/a.js", "Edit src/a.js"], "and the record lists both, once each");
  assert.equal(r.summary.calls, 2);
  assert.equal(r.summary.announced, 2);
  assert.equal(r.summary.failures, 0);
  // a failure in the second reply is still reported once
  assert.match(r.handle({ type: "tool", id: "c", title: "npm test", kind: "execute", status: "failed", exitCode: 1, terminalOutput: { output: "boom", exitCode: 1 } }), /✗ npm test — exit 1/);
  assert.equal(r.handle({ type: "tool", id: "c", title: "npm test", kind: "execute", status: "failed", exitCode: 1 }), null, "and not twice");
  assert.equal(r.summary.failures, 1);
});

test("toolIcons off turns the glyphs into words, everywhere the renderer emits them", () => {
  const evs = [
    { type: "tool", id: "r1", title: "Read src/a.js", kind: "read", status: "completed" },
    { type: "tool", id: "e1", title: "Edit src/b.js", kind: "edit", status: "completed", content: [{ type: "diff", path: "src/b.js", oldText: "x", newText: "y" }] },
    { type: "tool", id: "x1", title: "npm test", kind: "execute", status: "failed", exitCode: 1, terminalOutput: { output: "boom", exitCode: 1 } },
    { type: "subagent", id: "s1", state: "spawned", name: "explorer" },
    { type: "subagent", id: "s1", state: "completed", name: "explorer" },
  ];
  const run = (r) => evs.map((e) => r.handle(e)).filter(Boolean).join("");
  const on = run(new ActivityRenderer({ toolMode: "quiet" }));
  const off = run(new ActivityRenderer({ toolMode: "quiet", icons: false }));
  // Applied at the edge of handle(), so a line built in some other branch cannot slip through undecorated.
  assert.match(on, /⚙/, "glyphs are on by default");
  assert.ok(!/[⚙✓✗]/.test(off), `no glyph survives anywhere, including the sub-agent lines: ${JSON.stringify(off)}`);
  assert.match(off, /tool: /, "the announce glyph becomes a word");
  assert.match(off, /ok: /, "and so does the success one");
  assert.match(off, /failed: /, "and the failure one");
  // Same information, different dress: nothing was lost by dropping the glyphs.
  for (const want of ["Read src/a.js", "Edit src/b.js", "+1 −1", "npm test", "exit 1", "explorer"]) assert.ok(off.includes(want), `still says ${want}`);
  // The record's tool list matches what the user saw, rather than being a different rendering of the same turn.
  const rOff = new ActivityRenderer({ toolMode: "quiet", icons: false }); run(rOff);
  assert.ok(rOff.lines.length >= 1 && rOff.lines.every((l) => !/[⚙✓✗]/.test(l)), `the record is decorated too: ${JSON.stringify(rOff.lines)}`);
  const rOn = new ActivityRenderer({ toolMode: "quiet" }); run(rOn);
  assert.ok(rOn.lines.some((l) => l.includes("⚙")), "and glyphed when icons are on");
  // Unset means on: a config that predates the knob keeps the behaviour it has always had. Only an explicit false
  // turns the glyphs off, which is why the server passes the value through untouched.
  assert.match(run(new ActivityRenderer({ toolMode: "quiet", icons: undefined })), /⚙/, "undefined leaves them on");
  assert.match(run(new ActivityRenderer({ toolMode: "quiet", icons: null })), /⚙/, "and so does null");
  // Text mode asserted only weakly before (a `/tool: /` match on an announce line), which would have passed even if
  // the failure line kept its literal `✗ failed: ` prefix. Render a failure and pin the whole line.
  const txt = new ActivityRenderer({ toolMode: "text", icons: false });
  const tOut = [
    txt.handle({ type: "tool", id: "a", title: "Read src/a.js", kind: "read", status: "completed" }),
    txt.handle({ type: "tool", id: "b", title: "npm test", kind: "execute", status: "failed" }),
  ].filter(Boolean).join("");
  assert.match(tOut, /^tool: Read src\/a\.js/m, "the announce line is worded");
  assert.match(tOut, /^failed: npm test$/m, `and so is the failure line, without doubling the word: ${JSON.stringify(tOut)}`);
  assert.ok(!/[⚙✓✗▸]/.test(tOut), `no glyph survives in text mode either: ${JSON.stringify(tOut)}`);
  const txtOn = new ActivityRenderer({ toolMode: "text" });
  const tOn = [txtOn.handle({ type: "tool", id: "a", title: "Read src/a.js", kind: "read", status: "completed" }), txtOn.handle({ type: "tool", id: "b", title: "npm test", kind: "execute", status: "failed" })].filter(Boolean).join("");
  assert.match(tOn, /⚙ Read src\/a\.js/, "with icons on, text mode is byte-for-byte what it has always been");
  assert.match(tOn, /✗ failed: npm test/, "including the old failure wording");

  // A STOPPED sub-agent is not a finished one. It used to get the success marker either way, which the glyph half
  // hid and the word form stated outright ("ok: sub-agent x finished" for a sub-agent that was cancelled).
  const sg = new ActivityRenderer({ toolMode: "quiet" });
  sg.handle({ type: "subagent", id: "g", state: "spawned", name: "explorer" });
  assert.equal(sg.handle({ type: "subagent", id: "g", state: "stopped", name: "explorer" }), "sub-agent explorer stopped\n", "stopped says stopped, with no success marker");
  const sg2 = new ActivityRenderer({ toolMode: "quiet" });
  sg2.handle({ type: "subagent", id: "h", state: "spawned", name: "builder" });
  assert.equal(sg2.handle({ type: "subagent", id: "h", state: "completed", name: "builder" }), "✓ sub-agent builder finished\n", "and completed still says finished");
  const sg3 = new ActivityRenderer({ toolMode: "quiet", icons: false });
  sg3.handle({ type: "subagent", id: "i", state: "spawned", name: "runner" });
  assert.equal(sg3.handle({ type: "subagent", id: "i", state: "completed", name: "runner" }), "ok: sub-agent runner finished\n", "worded when icons are off");
  // (fails before: yes — a cancelled sub-agent, or a failed one, the words ACP's sub-agents RFD ends them in from
  // claude-agent-acp 0.93, said nothing at all)
  const sg4 = new ActivityRenderer({ toolMode: "quiet" });
  sg4.handle({ type: "subagent", id: "j", state: "spawned", name: "sleeper" });
  assert.equal(sg4.handle({ type: "subagent", id: "j", state: "cancelled" }), "sub-agent sleeper stopped\n", "a cancelled one is stopped, its name from its start");
  sg4.handle({ type: "subagent", id: "k", state: "spawned", name: "builder" });
  assert.equal(sg4.handle({ type: "subagent", id: "k", state: "failed" }), "✗ sub-agent builder ended in an error\n");
  const sg5 = new ActivityRenderer({ toolMode: "quiet", icons: false });
  sg5.handle({ type: "subagent", id: "k", state: "spawned", name: "builder" });
  assert.equal(sg5.handle({ type: "subagent", id: "k", state: "failed" }), "failed: sub-agent builder ended in an error\n", "worded once when icons are off");
  assert.equal(run(new ActivityRenderer({ toolMode: "hide", icons: false })), "", "and hide still shows nothing at all");

  // THE PART THAT MATTERS MOST: the substitution is anchored to a line Filament built, never applied to assembled
  // output. A global replace also rewrote glyphs INSIDE a fenced diff or command output — the agent's own bytes.
  // Test runners print `✓ passing` (mocha, vitest, pytest all do), and rewriting it to `ok: passing` corrupts the
  // record of what the command said, which the archive then persists as what the agent produced.
  const loud = new ActivityRenderer({ toolMode: "verbose", icons: false });
  const outLine = loud.handle({ type: "tool", id: "n1", title: "npm test", kind: "execute", status: "completed", terminalOutput: { output: "  ✓ passing test one\n  ✓ passing test two\n\n2 passing", exitCode: 0 } });
  assert.match(outLine, /^tool: run `npm test`/, "the marker line is still rewritten");
  assert.ok(outLine.includes("✓ passing test one") && outLine.includes("✓ passing test two"), `the command's OWN output is untouched: ${JSON.stringify(outLine)}`);
  assert.ok(!outLine.includes("ok: passing"), "and was not rewritten inside the fence");
  const loud2 = new ActivityRenderer({ toolMode: "verbose", icons: false });
  const diffOut = loud2.handle({ type: "tool", id: "n2", title: "Edit a.js", kind: "edit", status: "completed", content: [{ type: "diff", path: "a.js", oldText: "✓ done\nplain", newText: "✓ done\nchanged" }] });
  assert.ok(diffOut.includes("✓ done"), `file content keeps its glyphs: ${JSON.stringify(diffOut.slice(0, 200))}`);
  // A plan's progress lines are marked too, per line, and the step text after the marker is left alone.
  const pl = new ActivityRenderer({ toolMode: "quiet", icons: false });
  const p1 = pl.handle({ type: "plan", entries: [{ content: "first step", status: "pending" }, { content: "✓ already ticked by the user", status: "pending" }] });
  assert.match(p1, /^\*\*Plan\*\*$/m, "the first plan is the whole checklist");
  assert.match(p1, /- \[ \] first step/, "which uses ASCII boxes, not glyphs");
  assert.ok(p1.includes("- [ ] ✓ already ticked by the user"), `and a step whose own text has a glyph keeps it: ${JSON.stringify(p1)}`);
  const p2 = pl.handle({ type: "plan", entries: [{ content: "first step", status: "completed" }, { content: "✓ already ticked by the user", status: "in_progress" }] });
  assert.match(p2, /^ok: first step/m, "a completed step is marked with a word");
  assert.match(p2, /^now: ✓ already ticked by the user/m, "and a step whose OWN text starts with a glyph keeps it");
  assert.ok(!/[⚙▸]/.test(p2), `no marker glyph survives: ${JSON.stringify(p2)}`);
});

test("P6: the leak rate is measured even when the narration is hidden", () => {
  // `toolActivity: hide` suppresses the text, not the measurement — and hiding the narration is exactly when the
  // number matters most, because the evidence is no longer on screen to eyeball.
  const r = new ActivityRenderer({ toolMode: "hide" });
  assert.equal(r.handle({ type: "tool", id: "a", title: "Read x", kind: "read", status: "completed", routed: true }), null, "hide still renders nothing at all");
  r.handle({ type: "tool", id: "b", title: "Grep y", kind: "search", status: "completed" });
  r.handle({ type: "tool", id: "b", title: "Grep y", kind: "search", status: "completed" }); // a second update, same call
  r.handle({ type: "tool", id: "c", title: "npm test", kind: "execute", status: "failed" });
  const s = r.summary;
  assert.equal(s.calls, 3, "three calls, not four events");
  assert.equal(s.routed, 1, "one went through Filament's toolset");
  assert.equal(s.builtIn, 2, "two used the agent's own tools");
  assert.equal(s.leakRate, 67, "and the leak rate is the built-in share, rounded");
  assert.equal(s.routed + s.builtIn, s.calls, "the invariant that makes it a rate");
  assert.equal(r.lines.length, 0, "nothing was announced, because hide means hide");
});

test("P6: a call whose routing is only revealed later is reclassified, and the counts still add up", () => {
  const r = new ActivityRenderer({ toolMode: "quiet" });
  r.handle({ type: "tool", id: "x", title: "tool call", status: "pending" }); // nothing known yet
  assert.equal(r.summary.builtIn, 1, "counted as a leak on the first event, because that is all it knows");
  r.handle({ type: "tool", id: "x", title: "Read a.js", status: "completed", routed: true }); // revealed on the update
  const s = r.summary;
  assert.equal(s.routed, 1, "the later flag wins");
  assert.equal(s.builtIn, 0, "and the count MOVES with it, rather than leaving the call in both columns");
  assert.equal(s.calls, 1, "still one call");
  assert.equal(s.routed + s.builtIn, s.calls, "so the invariant survives a reclassification");
});

test("P6: leakRate is null, not 0, when there was nothing to measure", () => {
  const r = new ActivityRenderer({ toolMode: "quiet" });
  assert.equal(r.summary.leakRate, null, "no calls means no measurement — 0% would claim every call was routed");
  assert.equal(r.summary.calls, 0);
  r.handle({ type: "plan", entries: [{ content: "a step", status: "pending" }] });
  assert.equal(r.summary.leakRate, null, "and a turn with no tool calls still has none");
  const one = new ActivityRenderer({ toolMode: "quiet" });
  one.handle({ type: "tool", id: "a", title: "Read x", status: "completed", routed: true });
  assert.equal(one.summary.leakRate, 0, "a single routed call really is 0% leak");
});

test("P6: a tool event with no id is still counted, so the leak rate cannot be flattered by malformed input", () => {
  // `#track` used to bail on a missing id while the render path still incremented `calls`, which produced
  // {calls: 1, routed: 0, builtIn: 0, leakRate: 0} — a "perfect" 0% leak on an agent that omits toolCallId, and an
  // invariant (`routed + builtIn === calls`) that quietly stopped holding. Skipping the event instead would be worse:
  // it keeps the invariant true by discarding the evidence.
  const r = new ActivityRenderer({ toolMode: "quiet" });
  r.handle({ type: "tool", title: "Read a.js", kind: "read", status: "completed" }); // no id at all
  const s = r.summary;
  assert.equal(s.calls, 1, "the call is counted");
  assert.equal(s.routed + s.builtIn, s.calls, "and lands in exactly one routing column");
  assert.equal(s.builtIn, 1, "unrouted by default, which is the honest assumption");
  assert.equal(s.leakRate, 100);
  // A second idless event is a second call: with no id there is nothing to dedupe on, and pretending otherwise would
  // understate the count.
  r.handle({ type: "tool", title: "Grep b", kind: "search", status: "completed" });
  assert.equal(r.summary.calls, 2, "two idless events are two calls, not one");
  assert.equal(r.summary.routed + r.summary.builtIn, r.summary.calls, "and the invariant still holds");
  // An idless event that IS routed is classified correctly.
  const r2 = new ActivityRenderer({ toolMode: "quiet" });
  r2.handle({ type: "tool", title: "Read c.js", status: "completed", routed: true });
  assert.equal(r2.summary.routed, 1, "a routed call with no id is still routed");
  assert.equal(r2.summary.builtIn, 0);
});

test("sanitizeUnicodeTags strips the invisible U+E0000 block and nothing else", () => {
  // These characters are invisible in a terminal and in a diff, so every assertion is on code points or on the
  // surrounding text — never on what the string looks like.
  const tagged = `a\u{E0041}\u{E0042}\u{E0043}b`;
  assert.equal(sanitizeUnicodeTags(tagged), "ab", "the tag block is removed and the text closes up");
  assert.equal(sanitizeUnicodeTags("plain text with no tags"), "plain text with no tags", "ordinary text is untouched");
  // The fast path returns the SAME string object when there is nothing to strip: this runs on every chunk of every
  // agent reply, so it must not allocate for the 99% case.
  const clean = "no tags here";
  assert.equal(sanitizeUnicodeTags(clean), clean, "identical by value");
  assert.ok(Object.is(sanitizeUnicodeTags(clean), clean), "and by identity — no copy allocated");
  // The whole Tags block, at both ends
  assert.equal(sanitizeUnicodeTags("\u{E0000}x\u{E007F}"), "x", "the whole E0000–E007F block");
  // Things that must NOT be stripped. The variation-selector ranges are the ones worth pinning: U+E0100–U+E01EF sits
  // immediately after the Tags block and WAS stripped by an earlier draft of this function, which silently changes
  // which glyph a CJK ideograph renders as — corruption dressed up as cleaning. U+FE00–FE0F does the same for emoji.
  for (const keep of [
    "héllo wörld", "emoji 🎉🔥", "\uFEFFleading bom", "中文 テスト", "a\u200Db",
    "tab\tand\nnewline", "code `backticks` and \\backslash",
    "\u{E0100}", "\u{E01EF}", "\u{FE0F}", "\u{FE00}",          // variation selectors, both ranges
    "\u{82A6}\u{E0101}",                                        // a real CJK ideographic variation sequence
    "👨\u200D👩\u200D👧\u{FE0F}",                                 // an emoji ZWJ sequence with a selector
  ]) {
    assert.equal(sanitizeUnicodeTags(keep), keep, `preserved: ${JSON.stringify(keep)}`);
  }
  // A tag character embedded in otherwise-legitimate text is still removed, and the neighbours survive
  assert.equal(sanitizeUnicodeTags("\u{82A6}\u{E0041}\u{FE0F}"), "\u{82A6}\u{FE0F}", "only the tag goes");
  // Degenerate inputs
  assert.equal(sanitizeUnicodeTags(""), "", "empty stays empty");
  assert.equal(sanitizeUnicodeTags(null), "", "null becomes an empty string, not 'null'");
  assert.equal(sanitizeUnicodeTags(undefined), "");
  assert.equal(sanitizeUnicodeTags(42), "42", "a non-string is coerced, not thrown");
  // A string that is ONLY tags becomes empty, and the caller must not then emit an empty delta
  assert.equal(sanitizeUnicodeTags("\u{E0041}\u{E0042}"), "");
});

test("ThoughtInliner quotes a thought in order, holds trailing newlines, and closes with a blank line", () => {
  const q = new ThoughtInliner();
  assert.equal(q.thought("\n  first line\n", "Some text"), "\n\n> 💭 first line");
  assert.equal(q.thought("second\n", "Some text\n\n> 💭 first line"), "\n> second");
  assert.equal(q.close("Some text\n\n> 💭 first line\n> second"), "\n\n");
  assert.equal(q.close("x"), "", "closing twice adds nothing");
  assert.equal(q.thought("fresh", ""), "> 💭 fresh", "no blank line at the very start of a reply");
  assert.equal(q.thought("", ""), "", "empty chunks add nothing");
  assert.equal(q.close("> 💭 fresh\n"), "\n");
});

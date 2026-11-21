// @ts-check
// The UI/UX review of 2026-09-30 (Detach, report delivery, the turn's cards): what the owner sees said plainly.
// - The Detach buttons named who gets the report ("Detach — auto-report" / "Detach — report to me"); a detach left
//   only a toast, never a row; the status panel had no Detach; a report reaching the main agent was a faint line.
// - The per-edit +/− chip counted nothing (no one wrote its counts) and would have counted tokens; the turn could end
//   with two "N files changed" cards.
// - Detach is Run in background since the owner's word of 10-27 ("instead of detach then that should be renamed to run
//   in background on both buttons"): the buttons, the status panel's, the toasts, the row and the window's head.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { alignEvents } from "../src/ui/harness/lib/labels.js";

const read = (/** @type {string} */ p) => readFileSync(p, "utf8");

// (fails before: no case for subagent-detached — nothing on the timeline)
test("a detach is a row of its own at the launching round, saying where the report goes", () => {
  const a = alignEvents([
    { type: "tool-start", round: 2, id: "a1", name: "agent", args: "Long" },
    { type: "subagent-start", round: 2, parent: "a1", agentId: "sa_1", description: "Long review" },
    { type: "subagent-detached", round: 2, parent: "a1", agentId: "sa_1", report: true },
    { type: "tool-start", round: 2, id: "a2", name: "agent", args: "Other" },
    { type: "subagent-start", round: 2, parent: "a2", agentId: "sa_2", description: "Other" },
    { type: "subagent-detached", round: 2, parent: "a2", agentId: "sa_2", report: false },
  ]);
  assert.deepEqual(a.byRound.get(2)?.detaches, [
    { agentId: "sa_1", report: true, description: "Long review" },
    { agentId: "sa_2", report: false, description: "Other" },
  ]);
  const timeline = read("src/ui/harness/conversation/timeline.js");
  assert.match(timeline, /kept\("detach", cell\.detaches \|\| \[\], detachNote\)/);
  assert.match(timeline, /You sent \$\{who\} to the background — it keeps running; its report joins the conversation when it finishes/);
  assert.match(timeline, /You sent \$\{who\} to the background — it keeps running; its report comes to you/);
  assert.doesNotMatch(timeline, /You detached/);
  assert.match(timeline, /cell\.compactions\?\.length \|\| cell\.detaches\?\.length/, "a round with only such a row is still drawn");
});

test("the window's Run in background buttons say who gets the report, and its head says it runs in the background", () => {
  const viewer = read("src/ui/harness/subagent-viewer.js");
  assert.match(viewer, /label: "Run in background — auto-report"/);
  assert.match(viewer, /label: "Run in background — report to me"/);
  assert.doesNotMatch(viewer, /label: "Detach/, "no button says Detach any more");
  assert.match(viewer, /sa\.detached === "report" \? "in the background — its report goes to the main agent"/);
  assert.match(viewer, /the turn waits for that report before it ends/);
  const reg = read("src/app/agent/subagents.js");
  assert.match(reg, /detached: sa\.run\?\.detached \|\| null,/, "the row says how it was detached while it runs");
  assert.match(reg, /\|\| run\.detached === "aside"\)\s*\n\s*mark\(sa, "arrival",/, "a kept report's arrival is marked");
});

// (fails before: yes — found by E15 step 1's look at the page: a sub-agent gone with a restart opened a window that
// offered Apply, Send, both Detaches, Stop and a follow-up box, none of which could do anything, beside an empty pill)
test("a window with no sub-agent to show offers nothing: its buttons start away, and one that is gone takes its follow-up with it", () => {
  const viewer = read("src/ui/harness/subagent-viewer.js");
  // Apply stands in its work box alone since 10-28 (test/apply-in-thread.test.js): the head holds no second one.
  assert.match(viewer, /const actions = \[detachBtn, takeBtn, stopBtn\];/);
  assert.doesNotMatch(viewer, /passBtn/, "Send stands under each answer, not in the head (BW-8)");
  // Its context's gauge goes with its pill: a thread that is gone holds nothing to say a share of.
  assert.match(viewer, /const offerNothing = \(\) => \{\s*\n\s*for \(const b of actions\) b\.classList\.add\("hidden"\);\s*\n\s*pill\.className = "sav-status hidden";\s*\n\s*ctx\.className = "sav-ctx hidden";\s*\n\s*input\.disabled = true;\s*\n\s*send\.toggleAttribute\("disabled", true\);/);
  assert.match(viewer, /\n  offerNothing\(\);\n/, "before the first look at the registry lands");
  assert.match(viewer, /sa = null;\s*\n\s*for \(const v of views\.splice\(0\)\) v\.stop\(\);\s*\n\s*offerNothing\(\);\s*\n\s*foot\.classList\.add\("hidden"\);\s*\n\s*body\.replaceChildren\(h\("div", \{ class: "sav-empty" \}, `This thread is gone:/);
  for (const b of ["stopBtn", "detachBtn", "takeBtn"]) assert.match(viewer, new RegExp(`${b}\\.classList\\.toggle\\("hidden",`), `${b} shows by the sub-agent's state alone`);
});

test("the status panel offers Run in background on a running launch the main agent waits on", () => {
  const panel = read("src/ui/harness/conversation/status-panel.js");
  assert.match(panel, /r\.status === "running" && !r\.background && r\.origin === "agent" && cb\.onDetachSubagent/);
  assert.match(panel, /onclick: \(\) => cb\.onDetachSubagent\?\.\(r\.id\) \}, "Run in background"\)/);
  const app = read("src/ui/harness/app.js");
  assert.match(app, /onDetachSubagent: detachSubagent,/);
  assert.match(app, /subagentRoutes\(chainId\)\.detach\(id, true\)/);
});

test("a report that reached the main agent reads as an arrival, not a faint note", () => {
  const timeline = read("src/ui/harness/conversation/timeline.js");
  assert.match(timeline, /h\("div", \{ class: "tool-note sub-report sub-mark tone-ok" \},\s*\n\s*h\("span", \{ class: "sub-mark-ic" \}, "✓"\)/);
  // The arrival is named by the card the sub-agent ran as (HarnessV4_Tasks E15 step 4).
  assert.match(timeline, /\$\{name \|\| "Agent"\} \$\{who\} reported — its report joined the conversation here/);
});

test("an edit's chip counts lines from its own round's snapshot; one files card per turn", () => {
  const render = read("src/ui/harness/conversation/tools/render.js");
  assert.doesNotMatch(render, /const plus = Number\(t\.added\)/, "the dead token count is gone");
  // A box's calls keep their own rounds (HarnessV3-ACP AC1-6): the stub's round, else the box's.
  assert.match(render, /const round = Number\.isInteger\(t\.round\) \? t\.round : o\.round \?\? null;/);
  assert.match(render, /inlineEditDiff\(runId, target, \{\s*\n\s*round,\s*\n\s*call,\s*\n\s*onCounts:/);
  assert.match(render, /o = \{ \.\.\.o, round: Number\.isInteger\(cell\.round\) \? cell\.round : null \};/);
  const diff = read("src/ui/harness/lib/diff-render.js");
  assert.match(diff, /const counts = !file\.binary && mine \? \[Number\(file\.added\) \|\| 0, Number\(file\.removed\) \|\| 0\] : null;/, "counts only for the call's own change");
  assert.match(diff, /const own = round \? all\.filter\(\(\/\*\* @type \{any\} \*\/ x\) => x\.round === round\) : \[\];/);
  const timeline = read("src/ui/harness/conversation/timeline.js");
  assert.match(timeline, /if \(s\.kind === "files"\) s\.el\.querySelector\?\.\("\.file-card"\)\?\.classList\.toggle\("hidden", !!v\.tree\);/);
});

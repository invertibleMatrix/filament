// @ts-check
// core/turns.js replaced three implementations of the same idea (autofit's turnStarts, trim's turnGroups, view's
// segmentTurns). This test keeps verbatim copies of the originals and proves the merged module agrees with each of
// them on the golden conversations and on random message sequences in both wire formats — so the merge changed the
// home of the code and nothing else. If a future change to core/turns.js is meant to change a cut, update the
// reference copies here deliberately.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isToolLeg, turnStarts, segmentTurns, turnGroups } from "../src/core/turns.js";
import { convo } from "./fixtures/golden/cases.js";

// ---- the originals, verbatim (2026-09-19) ----------------------------------------------------------------------------
const oldIsToolLeg = (m, format) => {
  if (format === "anthropic")
    return Array.isArray(m?.content) && m.content.length > 0 && m.content[0]?.type === "tool_result";
  return m?.role === "tool";
};
const oldTurnStarts = (messages, format, from) =>
  messages
    .map((m, i) => ({ m, i }))
    .slice(from)
    .filter(({ m }) => m?.role === "user" && !oldIsToolLeg(m, format))
    .map(({ i }) => i);
function oldTurnGroups(messages, format) {
  const n = Array.isArray(messages) ? messages.length : 0;
  if (!n) return [];
  const starts = oldTurnStarts(messages, format, 0);
  if (!starts.length) return [{ from: 0, to: n }];
  const groups = [];
  if (starts[0] > 0) groups.push({ from: 0, to: starts[0] });
  for (let i = 0; i < starts.length; i++)
    groups.push({ from: starts[i], to: i + 1 < starts.length ? starts[i + 1] : n });
  return groups;
}
function oldSegmentTurns(messages, format) {
  const n = Array.isArray(messages) ? messages.length : 0;
  let lead = 0;
  while (lead < n && (messages[lead]?.role === "system" || messages[lead]?.role === "developer")) lead++;
  const starts = oldTurnStarts(messages, format, lead);
  const groups = [];
  if (!starts.length) return { lead, groups: n > lead ? [{ from: lead, to: n, prologue: true }] : [] };
  if (starts[0] > lead) groups.push({ from: lead, to: starts[0], prologue: true });
  for (let i = 0; i < starts.length; i++)
    groups.push({ from: starts[i], to: i + 1 < starts.length ? starts[i + 1] : n });
  return { lead, groups };
}

// ---- shapes -----------------------------------------------------------------------------------------------------------
// A small deterministic generator (LCG) so a failure is reproducible from the seed printed with it.
function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => (x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
const MESSAGE_SHAPES = {
  anthropic: [
    () => ({ role: "system", content: "s" }),
    () => ({ role: "developer", content: "d" }),
    () => ({ role: "user", content: "hi" }),
    () => ({ role: "user", content: [{ type: "text", text: "hi" }] }),
    () => ({ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] }),
    () => ({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t", content: "ok" },
        { type: "text", text: "and" },
      ],
    }),
    () => ({
      role: "user",
      content: [
        { type: "text", text: "and" },
        { type: "tool_result", tool_use_id: "t", content: "ok" },
      ],
    }),
    () => ({ role: "user", content: [] }),
    () => ({ role: "assistant", content: [{ type: "text", text: "yes" }] }),
    () => ({ role: "assistant", content: [{ type: "tool_use", id: "t", name: "Read", input: {} }] }),
    () => ({ role: "tool", content: "stray" }),
    () => null,
    () => ({}),
  ],
  openai: [
    () => ({ role: "system", content: "s" }),
    () => ({ role: "developer", content: "d" }),
    () => ({ role: "user", content: "hi" }),
    () => ({ role: "user", content: [{ type: "text", text: "hi" }] }),
    () => ({ role: "assistant", content: "yes" }),
    () => ({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "c", type: "function", function: { name: "Read", arguments: "{}" } }],
    }),
    () => ({ role: "tool", tool_call_id: "c", content: "ok" }),
    () => null,
    () => ({}),
  ],
};
function randomMessages(seed, format) {
  const r = rng(seed);
  const shapes = MESSAGE_SHAPES[format];
  const n = Math.floor(r() * 14);
  return Array.from({ length: n }, () => shapes[Math.floor(r() * shapes.length)]());
}

const FORMATS = ["anthropic", "openai"];
const check = (messages, format, label) => {
  assert.deepEqual(
    turnStarts(messages, format, 0),
    oldTurnStarts(messages, format, 0),
    `${label}: turnStarts`,
  );
  assert.deepEqual(turnGroups(messages, format), oldTurnGroups(messages, format), `${label}: turnGroups`);
  assert.deepEqual(
    segmentTurns(messages, format),
    oldSegmentTurns(messages, format),
    `${label}: segmentTurns`,
  );
  for (const m of messages)
    assert.equal(isToolLeg(m, format), oldIsToolLeg(m, format), `${label}: isToolLeg`);
};

test("core/turns agrees with the three original implementations on the golden conversations", () => {
  for (const format of FORMATS) {
    for (const turns of [0, 1, 2, 6]) {
      const ms = convo(turns, { format });
      check(ms, format, `${format} convo(${turns})`);
      check([{ role: "system", content: "s" }, ...ms], format, `${format} system+convo(${turns})`);
      check(ms.slice(1), format, `${format} convo(${turns}) minus its first message`);
      check(ms.slice(0, -1), format, `${format} convo(${turns}) mid-turn`);
    }
  }
});

test("core/turns agrees with the originals on 4,000 random message sequences per format", () => {
  for (const format of FORMATS) {
    for (let seed = 1; seed <= 4000; seed++)
      check(randomMessages(seed, format), format, `${format} seed ${seed}`);
  }
});

test("core/turns: the edge cases each caller relied on", () => {
  assert.deepEqual(turnGroups([], "anthropic"), []);
  assert.deepEqual(segmentTurns([], "anthropic"), { lead: 0, groups: [] });
  assert.deepEqual(turnGroups(/** @type {any} */ (null), "anthropic"), []);
  const onlySystem = [{ role: "system", content: "s" }];
  assert.deepEqual(
    turnGroups(onlySystem, "openai"),
    [{ from: 0, to: 1 }],
    "trim keeps a system-only list as one group",
  );
  assert.deepEqual(
    segmentTurns(onlySystem, "openai"),
    { lead: 1, groups: [] },
    "the fold sees no conversation",
  );
  const assistantFirst = [
    { role: "assistant", content: "hello" },
    { role: "user", content: "hi" },
  ];
  assert.deepEqual(turnGroups(assistantFirst, "anthropic"), [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
  ]);
  assert.deepEqual(segmentTurns(assistantFirst, "anthropic").groups, [
    { from: 0, to: 1, prologue: true },
    { from: 1, to: 2 },
  ]);
});

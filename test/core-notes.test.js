// @ts-check
// The note registry: every kind renders both ways, and the sentences are the ones the records and hints carried
// before the registry existed (copied verbatim from the old template strings and regex branches).
import test from "node:test";
import assert from "node:assert/strict";
import {
  NOTE_KINDS,
  renderRecord,
  renderHints,
  pushNote,
  appendNotes,
  cwdSourceText,
} from "../src/core/notes.js";
import { determineCwd } from "../src/acp.js";

/** @typedef {import("../src/core/notes.js").Note} Note */

const ctx = { agentName: "Cursor", firstTurn: true };

/** @type {{ note: Note, record: string, hints: { mustSay: boolean, text: string }[] }[]} */
const samples = [
  {
    note: { kind: "cwd", cwd: "C:\\work\\app", where: "system prompt", blocked: null, ignored: [] },
    record: "acp: cwd C:\\work\\app (system prompt)",
    hints: [],
  },
  {
    note: { kind: "cwd", cwd: "C:\\Users\\me", where: "home", blocked: null, ignored: [] },
    record: "acp: cwd C:\\Users\\me (home (no project path found))",
    hints: [
      {
        mustSay: false,
        text: "no project folder came with this chat, so Cursor works in C:\\Users\\me; open the chat inside a project folder, or set acp.cwdDefault under Destinations → Upstreams.",
      },
    ],
  },
  {
    note: {
      kind: "cwd",
      cwd: "D:\\allowed",
      where: "first allowlisted folder",
      blocked: "C:\\elsewhere",
      ignored: ["allow-all", "read-only"],
    },
    record:
      "acp: cwd D:\\allowed (first allowlisted folder; C:\\elsewhere is outside cwdAllowlist; cwdAllowlist entries “allow-all”, “read-only” ignored: not a folder path)",
    hints: [
      {
        mustSay: true,
        text: "this chat's folder C:\\elsewhere is not among the folders Cursor may work in (acp.cwdAllowlist), so it works in D:\\allowed instead; add the folder to that list under Destinations → Upstreams.",
      },
      {
        mustSay: false,
        text: "the allowed-folders list of Cursor (acp.cwdAllowlist) contains “allow-all”, “read-only”, which is not a folder path; it was ignored. Fix the list under Destinations → Upstreams.",
      },
    ],
  },
  {
    note: { kind: "cwd", cwd: "C:\\Users\\me", where: "home", blocked: "C:\\proj", ignored: ["x"] },
    record:
      "acp: cwd C:\\Users\\me (home; C:\\proj is outside cwdAllowlist; cwdAllowlist entry “x” ignored: not a folder path)",
    hints: [
      {
        mustSay: true,
        text: "this chat's folder C:\\proj is not among the folders Cursor may work in (acp.cwdAllowlist), so it works in C:\\Users\\me instead; add the folder to that list under Destinations → Upstreams.",
      },
      {
        mustSay: false,
        text: "the allowed-folders list of Cursor (acp.cwdAllowlist) contains “x”, which is not a folder path; it was ignored. Fix the list under Destinations → Upstreams.",
      },
    ],
  },
  {
    note: { kind: "model-not-offered", model: "gpt-9", offers: ["sonnet", "opus"], keeping: "sonnet" },
    record: "acp: model gpt-9 not offered by this agent (offers sonnet, opus); keeping sonnet",
    hints: [
      {
        mustSay: false,
        text: "“gpt-9” is not a model Cursor offers, so it kept sonnet (it offers sonnet, opus).",
      },
    ],
  },
  {
    note: { kind: "mode-not-offered", mode: "yolo", has: ["agent", "plan"] },
    record: "acp: mode yolo not offered by this agent (has agent/plan)",
    hints: [
      { mustSay: false, text: "mode @yolo is not one Cursor has (agent/plan); the current mode stays." },
    ],
  },
  {
    note: { kind: "effort-not-applied", effort: "xhigh", reason: "grok-4 offers low/medium/high" },
    record: "acp: effort xhigh not applied: grok-4 offers low/medium/high",
    hints: [{ mustSay: false, text: "effort xhigh was not applied: grok-4 offers low/medium/high." }],
  },
  {
    note: { kind: "model-name-ignored", ignored: ["turbo", "v2"] },
    record: "acp: ignored in the model name: turbo, v2",
    hints: [
      {
        mustSay: false,
        text: "“turbo, v2” in the model name means nothing to Cursor; the rest of the name was applied.",
      },
    ],
  },
  {
    note: { kind: "images-dropped", count: 2 },
    record: "acp: 2 image(s) dropped (this agent does not accept images)",
    hints: [{ mustSay: false, text: "2 image(s) were not sent: Cursor does not accept images." }],
  },
  {
    note: { kind: "files-undelivered", count: 1 },
    record: "acp: 1 binary file(s) could not be delivered to this agent",
    hints: [
      {
        mustSay: false,
        text: "1 attached file(s) could not be delivered to Cursor; paste the text or give it the file's path.",
      },
    ],
  },
  {
    note: { kind: "permissions-unanswerable" },
    record: "acp: permissions ask: the client has no question tool, so the prompt was allowed once",
    hints: [
      {
        mustSay: true,
        text: "Cursor's permission policy is “ask”, but this chat tool declares no question tool, so its prompts were allowed once; Claude Code offers AskUserQuestion and gets real prompts.",
      },
    ],
  },
  {
    note: { kind: "question-unasked", asked: "Which database?", why: "this chat tool declares no question tool", heard: "skipped" },
    record: "acp: the agent asked “Which database?”, but this chat tool declares no question tool; it heard “skipped”",
    hints: [
      {
        mustSay: true,
        text: "Cursor asked “Which database?”, but this chat tool declares no question tool, so it went on without your answer (it heard “skipped”).",
      },
    ],
  },
  {
    note: { kind: "other-model", chosen: "claude-fable-5-2[1m]", answered: "claude-opus-5-5" },
    record: "acp: answered by claude-opus-5-5, not claude-fable-5-2[1m], the model asked for",
    hints: [
      {
        mustSay: true,
        text: "This reply came from claude-opus-5-5, not claude-fable-5-2[1m], the model this chat names: Cursor answered on its own model, most likely because this account is not offered that one. To get the model you choose, pick one Cursor lists for this account in the model menu.",
      },
    ],
  },
];

test("every kind has both renderers and at least one sample", () => {
  const kinds = Object.keys(NOTE_KINDS).sort();
  for (const k of kinds) {
    const r = /** @type {any} */ (NOTE_KINDS)[k];
    assert.equal(typeof r.record, "function", `${k}.record`);
    assert.equal(typeof r.hints, "function", `${k}.hints`);
  }
  assert.deepEqual([...new Set(samples.map((s) => s.note.kind))].sort(), kinds);
});

test("each sample renders the sentence the records and hints carried before", () => {
  for (const s of samples) {
    assert.equal(renderRecord(s.note), s.record);
    assert.deepEqual(renderHints(s.note, ctx), s.hints, s.record);
  }
});

test("the first-turn advice is only given on the first turn", () => {
  /** @type {Note} */
  const home = { kind: "cwd", cwd: "C:\\Users\\me", where: "home", blocked: null, ignored: [] };
  assert.equal(renderHints(home, { ...ctx, firstTurn: false }).length, 0);
  // a refused folder is said whatever the turn
  const blocked = { ...home, blocked: "C:\\proj" };
  assert.equal(renderHints(blocked, { ...ctx, firstTurn: false }).filter((h) => h.mustSay).length, 1);
});

test("an unknown kind is an error, not a silent blank", () => {
  assert.throws(() => renderRecord(/** @type {any} */ ({ kind: "nope" })), /unknown note kind "nope"/);
});

test("pushNote keeps the two lists aligned", () => {
  /** @type {string[]} */
  const notes = ["acp: conversation x"];
  /** @type {import("../src/core/notes.js").Positioned[]} */
  const structured = [];
  pushNote(notes, structured, { kind: "images-dropped", count: 1 });
  pushNote(notes, structured, { kind: "files-undelivered", count: 3 });
  assert.deepEqual(
    structured.map((s) => [s.at, s.note.kind]),
    [
      [1, "images-dropped"],
      [2, "files-undelivered"],
    ],
  );
  assert.equal(notes[structured[1].at], renderRecord(structured[1].note));
  // an attachment scan's lists are re-based onto the turn's
  /** @type {{ notes: string[], structured: import("../src/core/notes.js").Positioned[] }} */
  const att = { notes: ["acp: 1 image(s) attached"], structured: [] };
  pushNote(att.notes, att.structured, { kind: "images-dropped", count: 2 });
  appendNotes(notes, structured, att);
  assert.equal(notes.length, 5);
  assert.deepEqual(structured.at(-1), { at: 4, note: { kind: "images-dropped", count: 2 } });
  assert.equal(notes[4], renderRecord({ kind: "images-dropped", count: 2 }));
});

test("determineCwd's source is the registry's rendering of what it returns", () => {
  const r = determineCwd(
    { cwdAllowlist: ["allow-all"] },
    [{ role: "system", text: "Working directory: Z:\\definitely\\missing" }],
    null,
  );
  assert.equal(r.where, "home");
  assert.equal(r.blocked, null);
  assert.deepEqual(r.ignored, ["allow-all"]);
  assert.equal(r.source, cwdSourceText(r));
  assert.equal(
    r.source,
    "home (no project path found); cwdAllowlist entry “allow-all” ignored: not a folder path",
  );
});

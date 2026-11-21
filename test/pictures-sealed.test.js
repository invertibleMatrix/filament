// @ts-check
// HarnessV4_DesignPass_Plan UX1: pictures and artifacts reach the agent sealed. A report — or an answer the developer
// passes on — names what its agent drew, each picture with its size and how to open it, and what it published, with the
// artifact tool's read; never the code. The agent opens one picture by its name with Filament's envelope tool and reads
// its code whole: Filament's loop (test/visuals.test.js, through the app) and a coding agent's door (here) alike.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { drewLine, madeLine } from "../src/app/agent/subagents.js";
import { pictureAnswer } from "../src/app/agent/envelopes.js";
import { createAgentInbox } from "../src/app/agent-inbox.js";
import { ENVELOPE_TOOL, argSummary } from "../src/app/agent/tools.js";
import { TOOL_TEXT } from "../src/app/agent/prompt.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { stubDocument } from "./helpers/dom-stub.js";

const NEW_CHAT = { id: "toolu_1", title: "new_chat_every_control", bytes: 14_723, session: /** @type {const} */ (true) };
const STRIP = { id: "toolu_2", title: "chat_strip_controls_in_place", bytes: 13_822, session: /** @type {const} */ (true) };
/** One picture as an agent opens it. @param {Record<string, any>} [o] @returns {import("../src/app/agent/subagents.js").PictureOf} */
const view = (o = {}) => ({ id: "toolu_1", title: "new_chat_every_control", bytes: 14_723, by: "Designer (sa_1)", task: "what to propose", at: Date.UTC(2026, 9, 23, 13, 58), ...o });

describe("the line a report ends with", () => {
  // (fails before: yes — the agent that asked read the names alone, and nothing it could do with them)
  test("each picture with its size and how to open it, where the agent can; as before where it cannot", () => {
    assert.equal(drewLine([], true), "");
    assert.equal(drewLine([NEW_CHAT, STRIP]), "It drew new_chat_every_control, chat_strip_controls_in_place, shown to the developer.", "no envelope tool: the names, as before");
    assert.equal(drewLine([NEW_CHAT], true), 'It drew new_chat_every_control (14 KB), shown to the developer. It waits sealed for you: open it with Filament\'s envelope tool, {"picture": "new_chat_every_control"}, to read its code whole.');
    assert.equal(drewLine([NEW_CHAT, STRIP, { ...STRIP, id: "toolu_3", title: "tiny", bytes: 600 }], true),
      'It drew 3 pictures: new_chat_every_control (14 KB), chat_strip_controls_in_place (13 KB), tiny (600 bytes), shown to the developer. They wait sealed for you: open the one you need with Filament\'s envelope tool, {"picture": "<its name>"}, to read its code whole.');
  });

  // (fails before: yes — an artifact's line named its address, and nothing said the artifact tool reads it)
  test("an artifact with the artifact tool's read, where the agent has it; as before where it has not", () => {
    const page = { name: "expense-tracker-k3f9", v: 2, title: "Expense tracker", address: "http://127.0.0.1:20300/a/expense-tracker-k3f9/" };
    assert.equal(madeLine([page]), "It made Expense tracker (v2) at http://127.0.0.1:20300/a/expense-tracker-k3f9/, shown to the developer.");
    assert.equal(madeLine([page], true), 'It made Expense tracker (v2) at http://127.0.0.1:20300/a/expense-tracker-k3f9/, shown to the developer. Read it with Filament\'s artifact tool, {"action": "read", "id": "expense-tracker-k3f9"}.');
    assert.equal(madeLine([page, { ...page, name: "notes-x1", title: "Notes", v: 1, address: "" }], true),
      'It made Expense tracker (v2) at http://127.0.0.1:20300/a/expense-tracker-k3f9/; Notes (v1), shown to the developer. Read one with Filament\'s artifact tool, {"action": "read", "id": "<its name>"} — their names: expense-tracker-k3f9, notes-x1.');
  });
});

describe("a picture opened", () => {
  // (fails before: yes — no way to open one)
  test("the one asked for whole, who drew it, for what and when; the older ones of its name by their ids; asked with envelopes, they stay sealed", () => {
    const code = "<svg viewBox='0 0 10 10'></svg>";
    const one = pictureAnswer("new_chat_every_control", { found: { ...view(), code }, gone: null, older: [], names: [] });
    assert.equal(one, `[Filament: picture new_chat_every_control, opened — drawn by Designer (sa_1) for "what to propose", 2026-10-23 13:58 UTC, 14 KB. Its code, whole:]\n${code}`);
    const two = pictureAnswer("new_chat_every_control", { found: { ...view(), code }, gone: null, older: [view({ id: "toolu_0", by: "Designer (sa_0)" })], names: [] }, true);
    assert.ok(two.endsWith(`${code}\n\n[Filament: an older picture has the same name: toolu_0, drawn by Designer (sa_0) — open one by its id.]\n\n[Filament: the sealed envelopes stay sealed: open them with a call of their own.]`), two);
  });

  test("one listed whose code is gone says so; a name that matches none lists the chat's pictures, newest first, twenty at most", () => {
    assert.equal(pictureAnswer("x", { found: null, gone: view(), older: [], names: [] }),
      'The picture new_chat_every_control (toolu_1), drawn by Designer (sa_1) for "what to propose" is listed, but its code is no longer kept: the developer saw it; describe what you need from its agent\'s report instead.');
    assert.equal(pictureAnswer("x", { found: null, gone: null, older: [], names: [] }), 'No picture named "x": no agent of this chat drew one.');
    assert.equal(pictureAnswer("x", null), 'No picture named "x": no agent of this chat drew one.');
    const names = Array.from({ length: 22 }, (_, i) => view({ id: `toolu_${i}`, title: `p${i}`, task: "" }));
    const listed = pictureAnswer("x", { found: null, gone: null, older: [], names });
    assert.ok(listed.startsWith('No picture named "x". The pictures this chat\'s agents drew, newest first:\n- p0 (toolu_0), drawn by Designer (sa_1)\n'), listed);
    assert.ok(listed.endsWith("- p19 (toolu_19), drawn by Designer (sa_1)\n- and 2 older\nOpen one by its name or its id."), listed);
  });

  // (fails before: yes — a coding agent's envelope call opened the oldest sealed result whatever it asked)
  test("a coding agent's envelope call by a picture's name opens that picture: the sealed results stay sealed", () => {
    /** @type {string[]} */
    const notes = [];
    /** @type {string[]} */
    const asked = [];
    let opens = 0;
    const door = {
      close: () => {},
      inbox: /** @type {any} */ ({
        take: () => [],
        open: () => {
          opens++;
          return [];
        },
        sealed: () => [{ n: 1 }],
        picture: (/** @type {string} */ key) => {
          asked.push(key);
          return { found: { ...view(), code: "<svg/>" }, gone: null, older: [], names: [] };
        },
      }),
    };
    const box = createAgentInbox({ door, emit: () => {}, note: (t) => notes.push(t), mailbox: () => null, reach: () => null, signal: new AbortController().signal, reader: "the agent", opens: () => true });
    const text = box.open({ picture: "new_chat_every_control" }, "call-1");
    assert.ok(text.startsWith("[Filament: picture new_chat_every_control, opened — drawn by Designer (sa_1)"), text);
    assert.deepEqual([asked, opens], [["new_chat_every_control"], 0], "the picture alone: no sealed result opened");
    assert.deepEqual(notes, ["agent: picture new_chat_every_control (toolu_1) opened"]);
    assert.ok(box.open({ picture: "x", all: true }).endsWith("[Filament: the sealed envelopes stay sealed: open them with a call of their own.]"));
  });
});

describe("the tool and its row", () => {
  test("the envelope tool takes a picture's name, and its words say so", () => {
    assert.equal(/** @type {any} */ (ENVELOPE_TOOL.input_schema.properties).picture.type, "string");
    assert.ok(TOOL_TEXT.envelope.includes("A picture another agent drew waits sealed under the name its report gives; open only the ones you need."), TOOL_TEXT.envelope);
    assert.match(/** @type {any} */ (ENVELOPE_TOOL.input_schema.properties).picture.description, /^A picture another agent drew, by the name its report gives \(or its id\): opens that picture alone/, "picture, its name, opens that one alone");
  });

  // (fails before: yes — a call that opened a picture would have read "Opened envelopes · the oldest")
  test("the transcript's row: Opened a picture and its name — Filament's call and a coding agent's", () => {
    const dom = stubDocument();
    try {
      /** @param {any[]} evs */
      const rowOf = (evs) => roundRows(alignEvents([{ type: "round-start", round: 0 }, ...evs]).byRound.get(0), { runId: "run-1" })[0];
      assert.equal(argSummary("envelope", { picture: " new_chat_every_control " }), "picture new_chat_every_control");
      const done = rowOf([
        { type: "tool-start", id: "p1", name: "envelope", args: argSummary("envelope", { picture: "new_chat_every_control" }) },
        { type: "tool-end", id: "p1", ok: true, preview: "<svg/>" },
      ]);
      assert.deepEqual([done.querySelector(".tool-kind")?.textContent, done.querySelector(".tool-primary")?.textContent], ["Opened a picture", "new_chat_every_control"]);
      assert.ok(done.textContent.includes("What it read"));
      const theirs = rowOf([{ type: "tool-start", id: "p2", name: "mcp__filament__envelope", args: argSummary("mcp__filament__envelope", { picture: "overview_one_screen" }) }]);
      assert.deepEqual([theirs.querySelector(".tool-kind")?.textContent, theirs.querySelector(".tool-primary")?.textContent], ["Opening a picture", "overview_one_screen"]);
    } finally {
      dom.restore();
    }
  });
});

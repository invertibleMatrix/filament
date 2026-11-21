// HarnessV3-Facade Phase FA (D4–D6, D5's sentence, D6's effort): what a card may be, the writer's change card,
// the two forms' one set of values, the cue's byte-for-byte sentence, and the model name a harness turn carries.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CARD_KINDS, cardProblem } from "../src/core/cards.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { settingsChangeCard } from "../src/services/session-settings.js";
import { MemoryService } from "../src/memory-service.js";
import { settingsListReply } from "../src/app/commands/settings.js";
import { goalCard } from "../src/app/commands/goal.js";
import { cueText } from "../src/services/memory/brain.js";
import { withEffort } from "../src/core/routing.js";

describe("cards: what a card may be (D4)", () => {
  test("the kinds and the validator's refusals", () => {
    assert.deepEqual(CARD_KINDS, ["settings-change", "settings-list", "goal", "autofit"]);
    assert.equal(cardProblem({ kind: "settings-change", v: 1, changes: [{ path: "a.b", from: 1, to: 2, fromSource: "global", toSource: "session" }] }), null);
    assert.match(cardProblem(null) || "", /not an object/);
    assert.match(cardProblem({ kind: "other", v: 1 }) || "", /unknown kind/);
    assert.match(cardProblem({ kind: "goal", v: 2 }) || "", /expected v/);
    assert.match(cardProblem({ kind: "settings-change", v: 1, changes: [] }) || "", /no changes/);
    assert.match(
      cardProblem({ kind: "settings-change", v: 1, changes: [{ path: "a.b", from: 1, to: 2 }] }) || "",
      /fromSource/,
    );
    // Actions: each is label + command, and nothing else.
    assert.equal(cardProblem({ kind: "goal", v: 1, state: "proposed", title: "t", actions: [{ label: "Accept", command: "/goal accept" }] }), null);
    assert.match(cardProblem({ kind: "goal", v: 1, state: "p", title: "t", actions: [{ label: "Go" }] }) || "", /no command/);
    assert.match(cardProblem({ kind: "goal", v: 1, state: "p", title: "t", actions: [{ label: "Go", command: "/x", href: "https://e" }] }) || "", /more than label and command/, "a button that is not chat text is refused");
    assert.match(cardProblem({ kind: "settings-list", v: 1, title: "t", rows: [] }) || "", /no rows/);
    assert.match(cardProblem({ kind: "preset-list", v: 1, presets: [] }) || "", /unknown kind/, "there are no presets (the owner's of 11-07): a kept one is drawn as its text");
  });
  // (fails before: yes — a card had no place for words of its own: `/team builders` answered "2 settings changed" and
  // its rows, and nothing of what changed for the person)
  test("a card's lead: what changed for the person, in words, on any kind — drawn first, the card's rows under it", async () => {
    const change = { kind: "settings-change", v: 1, changes: [{ path: "engine.mode", from: "model", to: "team", fromSource: "default", toSource: "session" }] };
    const lead = "Builders is in charge of this chat.";
    assert.equal(cardProblem({ ...change, lead }), null);
    assert.equal(cardProblem({ kind: "goal", v: 1, state: "proposed", title: "t", lead }), null, "any kind takes one");
    assert.equal(cardProblem({ ...change, lead: " " }), "lead is not words");
    assert.equal(cardProblem({ ...change, lead: ["a"] }), "lead is not words");
    assert.equal(cardProblem({ ...change, lead: "x".repeat(601) }), "lead is longer than 600 characters");
    const { cardEl } = await import("../src/ui/harness/conversation/cards.js");
    const drawn = /** @type {any} */ (cardEl({ ...change, lead }, {}, { h: fakeH }));
    // (fails before: yes — the real team of 11-11: under the sentence stood "2 settings changed" and both rows whole,
    // `engine.mode` and `engine.team` among them, the mechanism the sentence was written to spare the person)
    assert.deepEqual(drawn.kids.map((/** @type {any} */ k) => [k.tag, k.attrs.class]), [["p", "card-lead"], ["details", "card-detail"]]);
    assert.equal(textOf(drawn.kids[0]), lead);
    assert.equal(drawn.kids[1].attrs.open, undefined, "the rows stay as the detail they are, folded until asked for");
    assert.deepEqual(drawn.kids[1].kids.map((/** @type {any} */ k) => [k.tag, k.attrs.class]), [["summary", "card-title"], ["div", "card-row"]]);
    assert.equal(textOf(drawn.kids[1].kids[0]), "Setting changed");
    assert.deepEqual(/** @type {any} */ (cardEl(change, {}, { h: fakeH })).kids.map((/** @type {any} */ k) => k.attrs.class), ["card-title", "card-row"], "no lead, none drawn");
    for (const card of [
      { kind: "settings-list", v: 1, title: "Settings in force", rows: [{ path: "p", value: 1, source: "session" }], lead },
      { kind: "goal", v: 1, state: "proposed", title: "Goal proposed", text: "x", lead },
      { kind: "autofit", v: 1, title: "/autofit", lines: ["a"], lead },
    ]) {
      const el = /** @type {any} */ (cardEl(card, {}, { h: fakeH }));
      assert.deepEqual([el.kids[0].attrs.class, textOf(el.kids[0])], ["card-lead", lead], card.kind);
    }
  });
  // (fails before: yes — HarnessV3-Readiness RD1 a: the kind was unknown, so every /autofit card was refused and logged
  // "a autofit was refused by the validator (unknown kind …)")
  test("an /autofit card: a title, its lines and its note, each in words — and the harness draws all three", async () => {
    const card = { kind: "autofit", v: 1, title: "/autofit — compacted to fit", lines: ["window 2,500 · compacts at 2,125", "before 2,400 → after 900 tokens", "turn 1 → one summary"], note: "compacted turn 1 into one summary: the next request weighs ~900 of the 2,500-token window (line 2,125), under the 85%-of-the-line target (1,806)." };
    assert.equal(cardProblem(card), null);
    assert.equal(cardProblem({ ...card, note: undefined }), null, "the note is the answer's; a card may come without one");
    assert.equal(cardProblem({ ...card, v: undefined }), "expected v 1");
    assert.equal(cardProblem({ ...card, title: " " }), "autofit has no title");
    assert.equal(cardProblem({ ...card, lines: [] }), "autofit has no lines");
    assert.equal(cardProblem({ ...card, lines: "one" }), "autofit has no lines");
    assert.equal(cardProblem({ ...card, lines: ["a", 2] }), "autofit lines must be words");
    assert.equal(cardProblem({ ...card, note: 3 }), "autofit note must be words");
    const { cardEl, DRAWN_KINDS } = await import("../src/ui/harness/conversation/cards.js");
    assert.deepEqual(DRAWN_KINDS, CARD_KINDS, "the page draws every kind the server may attach");
    const drawn = /** @type {any} */ (cardEl(card, {}, { h: fakeH }));
    assert.equal(drawn.attrs.class, "shim-card card-autofit");
    assert.deepEqual(drawn.kids.map((/** @type {any} */ k) => [k.attrs.class, textOf(k)]), [
      ["card-title", "/autofit — compacted to fit"],
      ...card.lines.map((l) => ["card-row", l]),
      ["card-row card-note", card.note],
    ], "the title, a row per line, then the note: the card hides nothing the answer's text says");
    assert.equal(/** @type {any} */ (cardEl({ ...card, note: undefined }, {}, { h: fakeH })).kids.length, 4, "no note, no note row");
  });
});

describe("cards: the writer's settings-change card (D4, FA 9)", () => {
  const doc = (flat, sources) => ({ flat, sources });
  test("from and to with sources for /set and /unset", () => {
    const card = settingsChangeCard(
      doc({ "context.view.stubChars": 160 }, { "context.view.stubChars": "global" }),
      doc({ "context.view.stubChars": 200 }, { "context.view.stubChars": "session" }),
      { changes: [{ path: "context.view.stubChars", from: 160, to: 200 }] },
    );
    assert.equal(cardProblem(card), null);
    assert.deepEqual(card.changes, [{ path: "context.view.stubChars", from: 160, to: 200, fromSource: "global", toSource: "session" }]);
    // The session's own layer had no value before (it came from the global layer): /unset restores exactly that.
    assert.deepEqual(card.actions, [{ label: "Undo", command: "/unset context.view.stubChars" }]);
    const unset = settingsChangeCard(
      doc({ "context.view.stubChars": 200 }, { "context.view.stubChars": "session" }),
      doc({}, {}),
      { changes: [{ path: "context.view.stubChars", from: 200, to: undefined }] },
    );
    assert.equal(unset.changes[0].to, null, "an unset's new value travels as null");
    assert.deepEqual(unset.actions, [{ label: "Undo", command: "/set context.view.stubChars 200" }], "the session's value was removed; /set puts it back");
  });
  test("undo rides only when exactly one setting changed and /set can set it", () => {
    const two = settingsChangeCard(doc({}, {}), doc({}, {}), {
      changes: [
        { path: "context.view.stubChars", from: 160, to: 200 },
        { path: "loop.permissions", from: "edit", to: "ask" },
      ],
    });
    assert.equal(two.actions, undefined);
    const unknown = settingsChangeCard(doc({}, {}), doc({}, {}), {
      changes: [{ path: "no.such.knob", from: null, to: 1 }],
    });
    assert.equal(unknown.actions, undefined, "a path /set cannot set has no undo");
  });
});

describe("cards: two forms, one set of values (D4, FA 10)", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-cards-"));
  /** @type {any} */
  let svc;
  before(() => {
    svc = new MemoryService({
      getConfig: () => ({ memory: { enabled: true, folder: join(dir, "mem"), privacy: { encryptArchive: false } } }),
      dataDir: dir,
      log: () => {},
    });
    svc.start();
  });
  after(async () => {
    await svc.shutdown();
    for (let i = 0; i < 10; i++) {
      try { rmSync(dir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 150)); }
    }
  });
  const sit = (key) => ({ key, headers: {}, quiet: false, project: { id: "none", cwd: "" }, client: "opencode", model: "gpt-x", trace: null, composed: true });

  test("/settings: every card row is the same value as its text line", () => {
    const chain = svc.chainFor(sit("h:cards-1"));
    svc.patchSessionSettings(chain.id, { patch: { "context.view.stubChars": 200 } }, { via: "test" });
    const r = settingsListReply(svc, chain.id, { arg: "context.view" });
    assert.ok(r.card, "the list form carries a card");
    assert.equal(r.card.kind, "settings-list");
    for (const row of r.card.rows) {
      const line = r.text.split("\n").find((l) => l.startsWith(`\`${row.path}\``));
      assert.ok(line, `the row ${row.path} has a text line`);
      assert.ok(line.includes(row.valueText), `the text and the card agree on ${row.path}'s value (${row.valueText})`);
      assert.ok(line.includes(row.sourceText), `the text and the card agree on ${row.path}'s source (${row.sourceText})`);
    }
    const stub = r.card.rows.find((x) => x.path === "context.view.stubChars");
    assert.deepEqual({ ...stub, value: undefined }, { ...stub, value: undefined });
    assert.equal(stub.value, 200);
    assert.equal(stub.source, "session");
    assert.equal(stub.isDefault, false);
    assert.equal(stub.reach, "filament");
  });

  test("the writer builds a change card only for a caller that asks — the sidebar's display writes and the editors' writes get none", () => {
    const chain = svc.chainFor(sit("h:cards-3"));
    const plain = svc.patchSessionSettings(chain.id, { patch: { display: { unread: true } } }, { via: "sidebar" });
    assert.equal(plain.changes.length, 1, "the write happened");
    assert.equal(plain.card, undefined, "no card nobody reads");
    const editor = svc.patchSessionSettings(chain.id, { patch: { context: { results: "keep" } } }, { via: "editor" });
    assert.equal(editor.card, undefined);
    const asked = svc.patchSessionSettings(chain.id, { patch: { context: { results: "dedupe-to-tail" } } }, { via: "/set", card: true });
    assert.equal(asked.card?.kind, "settings-change", "a command that answers with a card gets one");
    assert.deepEqual(asked.card.changes.map((c) => [c.path, c.from, c.to]), [["context.results", "keep", "dedupe-to-tail"]]);
  });

  test("the goal card agrees with the status text (FA 10's two forms for /goal)", async () => {
    const { goalStatusText } = await import("../src/services/memory/goal.js");
    const goal = {
      status: "active",
      text: "ship the parser",
      slice: "one developer-week slice",
      estimate: { sizeClass: "days", achievableSlice: "one developer-week slice", assumptions: ["no legacyIE"], firstStep: "write the lexer", model: "cheap", at: 1000 },
      drive: { on: true, round: 12, cap: 20, halted: null },
    };
    const card = goalCard(goal);
    const text = goalStatusText(goal, { chainId: "c1" });
    assert.ok(text.includes(goal.slice), "the text names the slice");
    assert.equal(card.slice, goal.slice);
    assert.ok(text.includes("days"), "the text names the size class");
    assert.equal(card.estimate.sizeClass, "days");
    // Its drive, in the same words (core/goal-drive.js) — and no money anywhere (the owner's of 11-05).
    assert.ok(text.includes(`- drive: ${card.drive}`), text);
    assert.match(card.drive, /^driving: round 12 of 20/);
    assert.deepEqual(["spentUsd" in card, "turns" in card, /spend|\$/.test(text)], [false, false, false]);
    assert.deepEqual(card.actions, [
      { label: "Hold", command: "/goal hold" },
      { label: "Done", command: "/goal done" },
      { label: "Abandon", command: "/goal abandon" },
    ]);
  });

  test("the goal card: its state's actions, the estimate's four parts, its drive", () => {
    const proposed = goalCard({
      status: "proposed",
      text: "ship the thing",
      slice: "one developer-week slice",
      estimate: { sizeClass: "days", achievableSlice: "slice", assumptions: ["a"], firstStep: "step one" },
    });
    assert.equal(cardProblem(proposed), null);
    assert.equal(proposed.title, "Goal proposed");
    assert.deepEqual(proposed.estimate, { sizeClass: "days", achievableSlice: "slice", assumptions: ["a"], firstStep: "step one" });
    assert.deepEqual(proposed.actions, [{ label: "Accept", command: "/goal accept" }]);
    // An outside client's: no drive, so neither Hold nor Go on.
    const active = goalCard({ status: "active", text: "x", slice: "s" });
    assert.equal(active.title, "Goal active");
    assert.equal(active.drive, undefined);
    assert.deepEqual(active.actions, [
      { label: "Done", command: "/goal done" },
      { label: "Abandon", command: "/goal abandon" },
    ]);
    // Halted — the agent said it is done —: Go on, with its words.
    const halted = goalCard({ status: "active", text: "x", slice: "s", drive: { on: true, round: 4, cap: 20, halted: { kind: "done", at: 1 } } });
    assert.match(halted.drive, /^the agent says the slice is done \(after round 4\): check it, then \/goal done closes it, or \/goal go drives on$/);
    assert.deepEqual(halted.actions.map((a) => a.label), ["Go on", "Done", "Abandon"]);
    assert.equal(goalCard(null), null);
  });
});

describe("the cue's sentence (D5, FA 11)", () => {
  test("cueText gives today's sentence byte for byte", () => {
    const one = cueText({ items: 2, sessions: [{ id: "abc123", title: "Refactor auth" }] });
    assert.equal(one, 'Memory: 2 related items, 1 earlier session here (abc123 Refactor auth). Say "@mem load <session>" to bring one in.');
    const onlyItems = cueText({ items: 2, sessions: [] });
    assert.equal(onlyItems, 'Memory: 2 related items. Say "@mem load <session>" to bring one in.', "items without sessions");
    const three = cueText({
      items: 3,
      sessions: [
        { id: "s1", title: "Refactor auth" },
        { id: "s2", title: "Fix CI" },
        { id: "s3", title: "API docs" },
        { id: "s4", title: "never shown in the sentence" },
      ],
    });
    assert.equal(three, 'Memory: 3 related items, 4 earlier sessions here (s1 Refactor auth; s2 Fix CI; s3 API docs). Say "@mem load <session>" to bring one in.', "the count is the whole list, the names the first three");
    const titles = cueText({ items: 0, sessions: [{ id: "s1", title: "" }, { id: "s2", title: "t".repeat(40) }] });
    assert.ok(titles.includes("(s1; s2 tttttttttt"), "a titleless session shows its id alone, and a long title is clipped");
  });
});

describe("the model name a harness turn carries (D6, FA 12)", () => {
  const cfg = { rules: { effort: { suffixes: ["low", "medium", "high", "xhigh", "max"] } } };
  test("x-high with model.effort low goes out as x-low", () => {
    assert.equal(withEffort("x-high", "low", cfg), "x-low");
    assert.equal(withEffort("x-high", "high", cfg), "x-high");
  });
  test("with no setting the name is kept as stored", () => {
    assert.equal(withEffort("x-high", null, cfg), "x-high");
    assert.equal(withEffort("x-high", "", cfg), "x-high");
    assert.equal(withEffort("x-high", "sideways", cfg), "x-high", "an unknown effort is not a setting");
  });
  test("a -fast suffix survives; a suffixed name is split, not doubled", () => {
    assert.equal(withEffort("x-fast", "high", cfg), "x-high-fast");
    assert.equal(withEffort("model/claude-x-high", "low", cfg), "model/claude-x-low");
    const noStrip = { rules: { effort: { suffixes: ["low", "high"], stripSuffix: false } } };
    assert.equal(withEffort("x-high", "low", noStrip), "x-high-low", "stripSuffix off: the suffix is part of the name");
  });
});

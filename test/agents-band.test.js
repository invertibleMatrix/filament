// @ts-check
// A sub-agent's copy's parts in the Changes tab (the Designer's of 10-27, on the owner's "i did not even see the work
// done by parallel agent, what node was parallel agent was running on, where it made changes, how merged those
// changes"): its Apply said before and after the press, what stops it, Compare, Send back to rebase, the dry runs read
// again; and the dot on the Changes tab and button while something waits for you.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentsMark, createBand } from "../src/ui/harness/panes/agents-band.js";
import { createPaneHost } from "../src/ui/harness/panes/pane-host.js";
import { createPaneButtons } from "../src/ui/harness/panes/pane-buttons.js";
import { stubDocument } from "./helpers/dom-stub.js";

const NOW = 1_000_000;
const COPY = "H:\\filament\\.git\\filament-worktrees\\sa_1";
/** @param {Record<string, any>} over @returns {any} */
const sub = (over) => ({ id: "sa_1", status: "done", may: "edit", model: "glm-5.3", startedAt: NOW - 60_000, work: null, progress: null, ...over });
/** @param {Record<string, any>} over @returns {any} */
const work = (over) => ({ pending: 0, added: 0, removed: 0, applied: 0, open: true, folder: COPY, lastApplied: null, files: [], ...over });

// (fails before: yes — the Designer's of 10-28: an apply that left receipt.js with conflict markers, the tab said nothing)
test("the tab's mark names what waits for you: one asking, work waiting for Apply, a file left with conflict markers", () => {
  const marked = sub({ id: "m", work: work({ lastApplied: { at: 1, files: 2, by: "owner", marked: ["receipt.js"], repo: "H:\\filament" } }) });
  const resolved = sub({ id: "m", work: work({ lastApplied: { at: 1, files: 2, by: "owner" } }) });
  assert.equal(agentsMark([marked, sub({ id: "w", work: work({ pending: 2 }) }), sub({ id: "r", status: "running", progress: { asking: { question: "?" } } })]),
    "1 agent asks you · 1 agent's work waits for your Apply · receipt.js has conflict markers");
  assert.equal(agentsMark([resolved]), null);
  // (fails before: yes — the Hunter's of 10-28: work sent back to rebase waits for its agent, and the mark said it
  // waited for your Apply)
  assert.equal(agentsMark([sub({ id: "rb", work: work({ pending: 2 }), rebaseDue: true })]), null);
  // (fails before: yes — the real team of 11-11: a worker's change its lead applied seconds later was "1 agent's work
  // waits for your Apply" on the Changes button)
  const worker = sub({ id: "w", origin: "agent", team: { key: "builders", name: "Builders", role: "builder", charge: true }, work: work({ pending: 2 }) });
  assert.equal(agentsMark([worker], true), null, "its lead at its turn: the lead's to apply");
  assert.equal(agentsMark([worker, sub({ id: "w2", origin: "agent", status: "running", team: worker.team })]), null, "its lead due back for a worker still at work");
  assert.equal(agentsMark([worker]), "1 agent's work waits for your Apply", "the lead gone: yours");
  assert.equal(agentsMark([{ ...worker, team: { ...worker.team, charge: false } }], true), "1 agent's work waits for your Apply", "the chat handed back: yours");
});

// (fails before: yes — the Hunter's of 10-28: a refused Send back read "It couldn't be sent back: Nothing applied: …")
test("a refused Send back to rebase says its own words, and no apply", async () => {
  const { applyFailure, rebaseFailure } = await import("../src/ui/harness/lib/subagents.js");
  const e = new Error("sa_1 can't go on with task t1: Filament restarted since it ran");
  assert.equal(rebaseFailure(e), "sa_1 can't go on with task t1: Filament restarted since it ran");
  assert.equal(applyFailure(e), "Nothing applied: sa_1 can't go on with task t1: Filament restarted since it ran", "an apply's stays its own");
});

// (fails before: yes — the Designer's of 10-28: the result line, in a toast's place, went out of sight the moment the
// Apply was done; and work left with markers said nothing of how it leaves)
test("after its Apply the copy's block says what it did; with markers left, which file and the way out", async () => {
  const { restore } = stubDocument();
  try {
    const { el, at } = hostWith({
      preview: async () => ({ repo: "H:\\filament", came: CLEAN, conflicts: [] }),
      apply: async () => ((at.s = sub({ id: "sa_1", work: work({ lastApplied: { at: 1, files: 2, by: "owner", came: { took: 2, merged: [], deleted: 0, same: 0 } } }) })), { ok: true }),
    }, sub({ id: "sa_1", work: work({ pending: 2, added: 3, removed: 1, sig: "b:h" }) }));
    await settle();
    buttonOf(el, "Apply 2 files").dispatch("click");
    await settle();
    assert.match(textOf(el, ".agb-result"), /^Applied .+ by you — 2 files\. Nothing staged\.$/);

    at.s = sub({ id: "sa_1", work: work({ lastApplied: { at: 1, files: 2, by: "owner", came: { took: 1, merged: [], deleted: 0, same: 0, markers: ["receipt.js"] }, marked: ["receipt.js"], repo: "H:\\filament" } }) });
    at.draw();
    assert.equal(textOf(el, ".agb-marked-words"), "1 file has conflict markers");
    assert.deepEqual(el.querySelector(".agb-marked-file").querySelectorAll("button").map((/** @type {any} */ b) => b.getAttribute("data-path")), ["H:\\filament\\receipt.js"]);
    // (fails before: yes — found reviewing the Space work: it named Earlier, which the pane by place has no more)
    assert.equal(textOf(el, ".agb-marked-note"), "Resolve them and save: the mark goes by itself once they are.");
  } finally {
    restore();
  }
});

// (fails before: yes — the tab and the button had a count of files alone: nothing said work waited for your Apply)
test("the Changes tab and its button carry a dot while something waits for you, its words their title, and lose it after", () => {
  const { document, restore } = stubDocument();
  const g = /** @type {any} */ (globalThis);
  const saved = { local: g.localStorage, session: g.sessionStorage };
  /** @param {Map<string, string>} kept */
  const storage = (kept) => ({ getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)), removeItem: (/** @type {string} */ k) => void kept.delete(k) });
  g.localStorage = storage(new Map());
  g.sessionStorage = storage(new Map());
  try {
    const frame = document.createElement("aside");
    document.body.append(frame);
    const pane = (/** @type {string} */ id, /** @type {string} */ label) => ({ id, label, icon: "fileDiff", render: (/** @type {any} */ body) => void body.append(document.createElement("div")) });
    const host = createPaneHost(/** @type {any} */ (frame), {
      panes: [pane("changes", "Changes"), pane("terminal", "Terminal")],
      room: () => ({ row: 1600, win: 1920, height: 900 }),
      paint: () => {},
    });
    host.setChat({ id: "p1", chainId: "c1" });
    host.openTab("changes");
    const slot = document.createElement("span");
    const buttons = createPaneButtons({ host, slot: /** @type {any} */ (slot), layoutSlot: /** @type {any} */ (document.createElement("span")), header: /** @type {any} */ (document.createElement("header")) });
    const words = "1 agent's work waits for your Apply";
    host.mark("changes", words);
    buttons.mark("changes", words);
    const tabDot = frame.querySelector(".tile-mark");
    const btnDot = slot.querySelectorAll(".pbtn").find((/** @type {any} */ b) => b.getAttribute("data-pane") === "changes")?.querySelector(".pbtn-dot");
    assert.deepEqual([tabDot?.getAttribute("title"), btnDot?.getAttribute("title")], [words, words]);
    host.mark("changes", null);
    buttons.mark("changes", null);
    assert.deepEqual([frame.querySelector(".tile-mark"), slot.querySelector(".pbtn-dot")], [null, null]);
  } finally {
    g.localStorage = saved.local;
    g.sessionStorage = saved.session;
    restore();
  }
});

/** The promises the band waits on settle, and it draws again. */
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
/** @param {any} el @param {string} sel */
const textOf = (el, sel) => String(el.querySelector(sel)?.textContent || "");
/** @param {any} el @param {string} label */
const buttonOf = (el, label) => el.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === label) || null;
const NOW_JS = { path: "lib/now.js", why: "2 changes overlap yours", kind: "lines", overlaps: 2, choices: ["yours", "its", "both"] };
const CLEAN = [{ path: "a.js", how: "took" }, { path: "b.js", how: "took" }];
/**
 * The band's parts for one sub-agent whose work waits, drawn as the Changes tab's copy block draws them (`workOf`),
 * its doors recorded. `at.s`: its row, which a test may move; `at.draw`: the block drawn again.
 * @param {Record<string, any>} doors @param {any} [s]
 */
const hostWith = (doors, s = sub({ id: "sa_1", work: work({ pending: 3, added: 9, removed: 2, sig: "b:h" }) })) => {
  /** @type {any[]} */
  const calls = [];
  const el = /** @type {any} */ (document.createElement("section"));
  document.body.append(el);
  const at = { s, draw: () => el.replaceChildren(...band.workOf(at.s)) };
  const band = createBand(/** @type {any} */ ({
    openSubagent: () => {}, openChat: () => {}, stopSubagent: () => {}, diffOf: async () => ({ diff: "" }),
    modelName: (/** @type {string} */ m) => m.toUpperCase(),
    editorButton: (/** @type {string} */ path, /** @type {string} */ what) => {
      const b = document.createElement("button");
      b.setAttribute("data-path", path);
      b.setAttribute("aria-label", what);
      return b;
    },
    repaint: () => at.draw(),
    shown: () => el.isConnected,
    ...Object.fromEntries(Object.entries(doors).map(([k, fn]) => [k, (/** @type {any[]} */ ...a) => (calls.push([k, ...a]), fn(...a))])),
  }));
  at.draw();
  return { band, el, calls, at };
};

// (fails before: yes — a stuck Apply listed its files and stopped: no choices, no Compare, no rebase)
test("a stuck Apply: what stops it file by file, the choices each offers, Compare, the clean files folded; Apply with my choices once each has one; Send back to rebase first", async () => {
  const { restore } = stubDocument();
  try {
    const { el, calls } = hostWith({
      preview: async (/** @type {string} */ _id, /** @type {any} */ choices) =>
        choices ? { repo: "H:\\filament", came: [...CLEAN, { path: "lib/now.js", how: "kept" }], conflicts: [] } : { repo: "H:\\filament", folder: COPY, came: CLEAN, conflicts: [NOW_JS] },
      apply: async () => ({ ok: true }),
      compare: async () => ({ repo: "H:\\filament", folder: COPY, overlaps: [{ at: 7, yours: ["four, yours"], start: ["4"], its: ["FOUR, its"] }] }),
      rebase: async () => ({ ok: true }),
    });
    await settle();
    assert.equal(textOf(el, ".agb-effect"), "Can't apply as it stands — 1 of 3 files overlaps your edits. Nothing would be written.");
    assert.equal(textOf(el, ".agb-conf-head"), "now.js — 2 changes overlap yoursCompare");
    assert.deepEqual(el.querySelectorAll(".agb-choice").map((/** @type {any} */ c) => c.textContent), ["Keep yours", "Take its", "Both, with markers"]);
    assert.equal(textOf(el, ".agb-clean"), "2 files come in cleanly");
    const acts = el.querySelector(".agb-acts").querySelectorAll("button").map((/** @type {any} */ b) => b.textContent);
    assert.deepEqual(acts.slice(0, 2), ["Send back to rebase", "Apply with my choices"], "Send back first");
    assert.equal(buttonOf(el, "Apply with my choices").getAttribute("disabled"), "", "not before every file has a choice");
    assert.match(el.textContent, /One more run on GLM-5\.3\./);

    // Compare: its overlap at its line, yours over its, the two files to open.
    buttonOf(el, "Compare").dispatch("click");
    await settle();
    assert.deepEqual([textOf(el, ".agb-ov-head"), textOf(el, ".is-yours"), textOf(el, ".is-its")], ["Line 7", "Yours now7four, yours", "ItsFOUR, its"]);
    assert.deepEqual(el.querySelector(".agb-cmp-open").querySelectorAll("button").map((/** @type {any} */ b) => b.getAttribute("data-path")), ["H:\\filament\\lib\\now.js", `${COPY}\\lib\\now.js`]);

    // A choice: what it does, and the dry run with it.
    el.querySelectorAll(".agb-choice input")[0].dispatch("change");
    await settle();
    assert.equal(textOf(el, ".agb-choice-effect"), "Its change to now.js is dropped.");
    assert.deepEqual(calls.filter((c) => c[0] === "preview").at(-1), ["preview", "sa_1", { "lib/now.js": "yours" }]);
    assert.equal(textOf(el, ".agb-chosen"), "Apply writes 2 files into H:\\filament: 2 as it left them; now.js kept as yours (its change to it dropped). Nothing is staged or committed.");
    const apply = buttonOf(el, "Apply with my choices");
    assert.equal(apply.getAttribute("disabled"), null);
    apply.dispatch("click");
    await settle();
    assert.deepEqual(calls.find((c) => c[0] === "apply"), ["apply", "sa_1", { "lib/now.js": "yours" }]);
    // Send back to rebase.
    buttonOf(el, "Send back to rebase")?.dispatch("click");
    await settle();
    assert.deepEqual(calls.find((c) => c[0] === "rebase"), ["rebase", "sa_1"]);
  } finally {
    restore();
  }
});

// (fails before: yes — Changes' Read again read the turn alone: a file resolved since kept its "has conflict markers"
// line until something else moved the list, and a dry run stood for its 15 s)
test("Read again reads the band again too: the sub-agents' list, and each dry run at once", async () => {
  const { restore } = stubDocument();
  try {
    const { band, calls } = hostWith({ preview: async () => ({ repo: "H:\\filament", came: CLEAN, conflicts: [] }), reread: async () => {} });
    await settle();
    const asked = calls.filter((c) => c[0] === "preview").length;
    assert.ok(asked >= 1);
    band.reread();
    await settle();
    assert.deepEqual([calls.filter((c) => c[0] === "reread").length, calls.filter((c) => c[0] === "preview").length], [1, asked + 1]);
  } finally {
    restore();
  }
});

// (fails before: yes — the Hunter's of 10-28: a dry run on show stood until something else drew the band, the
// developer's own edits in their editor moving nothing)
test("a dry run on show is read again on its own once it is 15 s old", async () => {
  const { restore } = stubDocument();
  const g = /** @type {any} */ (globalThis);
  const realSet = g.setTimeout;
  const realNow = Date.now;
  /** @type {(() => void)[]} */
  const later = [];
  let t = realNow();
  g.setTimeout = (/** @type {() => void} */ fn, /** @type {number} */ ms, /** @type {any[]} */ ...a) => (ms >= 15_000 ? (later.push(fn), { unref() {} }) : realSet(fn, ms, ...a));
  Date.now = () => t;
  try {
    const { calls } = hostWith({ preview: async () => ({ repo: "H:\\filament", came: CLEAN, conflicts: [] }) });
    await settle();
    const asked = calls.filter((c) => c[0] === "preview").length;
    assert.equal(later.length, 1, "one read set for later");
    t += 15_001;
    later.shift()?.();
    await settle();
    assert.equal(calls.filter((c) => c[0] === "preview").length, asked + 1);
  } finally {
    g.setTimeout = realSet;
    Date.now = realNow;
    restore();
  }
});

// (fails before: yes — the Hunter's of 10-28: Compare was read once per work, "Yours now" standing as the developer
// edited; and a read that landed while the 15 s timer stood was never read again once the timer had fired)
test("Compare on show is read again with the dry run once 15 s old, and a read that lands while the timer stands is read again too", async () => {
  const { restore } = stubDocument();
  const g = /** @type {any} */ (globalThis);
  const realSet = g.setTimeout;
  const realNow = Date.now;
  /** @type {(() => void)[]} */
  const later = [];
  let t = realNow();
  g.setTimeout = (/** @type {() => void} */ fn, /** @type {number} */ ms, /** @type {any[]} */ ...a) => (ms >= 15_000 ? (later.push(fn), { unref() {} }) : realSet(fn, ms, ...a));
  Date.now = () => t;
  const fire = async () => {
    for (const fn of later.splice(0)) fn();
    await settle();
  };
  try {
    const { el, calls, at } = hostWith({
      preview: async () => ({ repo: "H:\\filament", folder: COPY, came: CLEAN, conflicts: [NOW_JS] }),
      compare: async () => ({ repo: "H:\\filament", folder: COPY, overlaps: [{ at: 7, yours: ["four, yours"], start: ["4"], its: ["FOUR, its"] }] }),
    });
    await settle();
    buttonOf(el, "Compare").dispatch("click");
    await settle();
    const count = (/** @type {string} */ k) => calls.filter((c) => c[0] === k).length;
    assert.equal(count("compare"), 1);
    t += 15_001;
    await fire();
    assert.equal(count("compare"), 2, "read again on its own");

    // Its work moves 10 s on: a new read lands while the timer stands.
    t += 10_000;
    at.s = sub({ id: "sa_1", work: work({ pending: 3, added: 9, removed: 2, sig: "b:h2" }) });
    at.draw();
    await settle();
    const moved = count("preview");
    t += 5_001;
    await fire();
    assert.equal(count("preview"), moved, "5 s old: not yet");
    assert.ok(later.length >= 1, "a draw is set for it still");
    t += 10_000;
    await fire();
    assert.equal(count("preview"), moved + 1, "15 s old: read again");
  } finally {
    g.setTimeout = realSet;
    Date.now = realNow;
    restore();
  }
});

// (fails before: yes — 10-29, the owner's: a helper's change brought into the folder by hand still read "Apply 18 files",
// with no way to say it was in; a stuck Apply never said which of its files the folder held already)
test("Mark as applied: a stuck Apply says the files already the same and offers it; a refusal in its words; marked, its line says nothing was written, with Undo; none for a graph task's sub-agent", async () => {
  const { restore } = stubDocument();
  try {
    const waiting = sub({ id: "sa_1", work: work({ pending: 3, added: 9, removed: 2, sig: "b:h" }) });
    const marked = sub({ id: "sa_1", work: work({ applied: 1, lastApplied: { at: 1, files: 3, by: "owner", hand: true, undo: true } }) });
    let refuse = "";
    const { el, calls, at } = hostWith({
      preview: async () => ({ repo: "H:\\filament", folder: COPY, came: [{ path: "a.js", how: "same" }, { path: "b.js", how: "same" }], conflicts: [NOW_JS] }),
      apply: async () => ({ ok: true }),
      rebase: async () => ({ ok: true }),
      markApplied: async () => (refuse ? { ok: false, error: refuse } : ((at.s = marked), { ok: true })),
      unmarkApplied: async () => ((at.s = waiting), { ok: true }),
    }, waiting);
    await settle();
    assert.equal(textOf(el, ".agb-effect"), "Can't apply as it stands — 1 of 3 files overlaps your edits, and 2 are already the same in your folder. Nothing would be written.");
    const acts = el.querySelector(".agb-acts").querySelectorAll("button").map((/** @type {any} */ b) => b.textContent);
    assert.deepEqual(acts.slice(0, 3), ["Send back to rebase", "Apply with my choices", "Mark as applied"]);

    refuse = "sub-agent sa_1's work is being applied now";
    buttonOf(el, "Mark as applied").dispatch("click");
    await settle();
    assert.equal(textOf(el, ".agb-last"), "It couldn't be marked as applied: sub-agent sa_1's work is being applied now");
    assert.ok(el.querySelector(".is-stuck"), "still waiting");

    refuse = "";
    buttonOf(el, "Mark as applied").dispatch("click");
    await settle();
    assert.deepEqual(calls.filter((c) => c[0] === "markApplied"), [["markApplied", "sa_1"], ["markApplied", "sa_1"]]);
    assert.match(textOf(el, ".agb-result"), /^Marked as applied .+ by you — 3 files, in your folder already\. Filament wrote nothing\.$/);
    assert.equal(el.querySelector(".agb-last"), null, "the refusal goes with the mark that took");

    buttonOf(el, "Undo").dispatch("click");
    await settle();
    assert.deepEqual(calls.filter((c) => c[0] === "unmarkApplied"), [["unmarkApplied", "sa_1"]]);
    assert.equal(el.querySelector(".agb-result"), null, "its work waits again");
    assert.ok(buttonOf(el, "Mark as applied"));

    // A mark that can't be undone now — its sub-agent worked since — has no Undo; a graph task's sub-agent has no Mark.
    at.s = sub({ id: "sa_1", work: work({ applied: 1, lastApplied: { at: 1, files: 3, by: "agent", hand: true } }) });
    at.draw();
    assert.match(textOf(el, ".agb-result"), /^Marked as applied .+ by your agent — 3 files/);
    assert.equal(buttonOf(el, "Undo"), null);
    at.s = sub({ id: "sa_1", task: "t1", work: work({ pending: 3, added: 9, removed: 2, sig: "b:h" }) });
    at.draw();
    await settle();
    assert.equal(buttonOf(el, "Mark as applied"), null);

    // An Apply that would go in cleanly offers it too, after Apply.
    const clean = hostWith({ preview: async () => ({ repo: "H:\\filament", came: CLEAN, conflicts: [] }), markApplied: async () => ({ ok: true }) });
    await settle();
    assert.deepEqual(clean.el.querySelector(".agb-acts").querySelectorAll("button").map((/** @type {any} */ b) => b.textContent), ["Show the diff", "Apply 3 files", "Mark as applied", "How Apply works"]);
  } finally {
    restore();
  }
});

// (fails before: yes — a mark's refusal stood under the row after an Apply or a rebase pressed since, as if they had said
// it)
test("a mark's refusal goes once Apply or Send back to rebase is pressed", async () => {
  const { restore } = stubDocument();
  try {
    const no = async () => ({ ok: false, error: "git would not keep the mark: its work waits as it did" });
    const clean = hostWith({ preview: async () => ({ repo: "H:\\filament", came: CLEAN, conflicts: [] }), apply: async () => ({ ok: true }), markApplied: no });
    await settle();
    buttonOf(clean.el, "Mark as applied").dispatch("click");
    await settle();
    assert.equal(textOf(clean.el, ".agb-last"), "It couldn't be marked as applied: git would not keep the mark: its work waits as it did");
    buttonOf(clean.el, "Apply 3 files").dispatch("click");
    await settle();
    assert.equal(clean.el.querySelector(".agb-last"), null, "Apply pressed: the mark's refusal went");

    const stuck = hostWith({ preview: async () => ({ repo: "H:\\filament", folder: COPY, came: CLEAN, conflicts: [NOW_JS] }), rebase: async () => ({ ok: true }), markApplied: no });
    await settle();
    buttonOf(stuck.el, "Mark as applied").dispatch("click");
    await settle();
    assert.match(textOf(stuck.el, ".agb-last"), /^It couldn't be marked as applied/);
    buttonOf(stuck.el, "Send back to rebase").dispatch("click");
    await settle();
    assert.equal(stuck.el.querySelector(".agb-last"), null, "sent back: the mark's refusal went");
  } finally {
    restore();
  }
});

// (fails before: yes — the drive of 10-29: the Apply box in a copy's place was the place's whole width plus its 44 px of
// margins, so its words and Compare ran under the pane's right edge, cut)
test("the Apply box fits its place: as wide as its margins leave, never the place's whole width beside them", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../src/ui/harness/panes/panes.css", import.meta.url), "utf8");
  const rule = /\n\.agb-apply-box \{([^}]*)\}/.exec(css)?.[1];
  assert.ok(rule, "its rule");
  assert.doesNotMatch(rule, /(^|;)\s*width:/);
  assert.match(css, /\.chp-place \.agb-apply-box, [^{]*\{ margin: 4px 12px 12px 32px; \}/, "its margins in a place");
});

// (fails before: yes — the Hunter's of 10-28: a refused Apply kept its conflicts over every dry run after it, Apply locked)
test("a refused Apply is said, and the dry run asked after it says how things stand: clean now, Apply works again", async () => {
  const { restore } = stubDocument();
  try {
    let stuck = false;
    const { el: box } = hostWith({
      preview: async () => ({ repo: "H:\\filament", came: [...CLEAN, { path: "lib/now.js", how: "merged" }], conflicts: [] }),
      apply: async () => (stuck = true, { ok: false, error: "1 file does not come through cleanly — lib/now.js: 2 changes overlap yours", conflicts: [NOW_JS] }),
    });
    await settle();
    const el = () => box;
    buttonOf(el(), "Apply 3 files").dispatch("click");
    await settle();
    assert.ok(stuck);
    assert.equal(el().querySelector(".is-stuck"), null, "the dry run after it is clean: no stuck block");
    assert.equal(textOf(el(), ".agb-last"), "Your last Apply: 1 file does not come through cleanly — lib/now.js: 2 changes overlap yours");
    assert.equal(buttonOf(el(), "Apply 3 files")?.getAttribute("disabled"), null, "Apply works again");
  } finally {
    restore();
  }
});

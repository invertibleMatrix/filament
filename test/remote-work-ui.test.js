// @ts-check
// Bring changes back from the desk (the remote desk's s2d; src/ui/harness/desk-work.js): a chat started with Run on works
// in a copy on another machine, and what it changes there waits until the person brings it back. The desk looks once its
// turn there ends — never while it works or waits for you —, its row says what waits, and Bring back says what would
// come and what would stop it, takes a choice for each such file, and brings it in; a second round brings only what
// changed since (the server's: test/remote-work.test.js).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";
import { LOOK_AGAIN_MS, cameWords, dueLooks, readWorks, waitWords } from "../src/ui/harness/desk-work.js";

/** A record as this computer says one. @param {Record<string, any>} [o] */
const work = (o = {}) => ({ id: "w1", machine: { id: "m-studio", name: "Studio" }, project: "widgets", folder: "/w/widgets", chat: "c-there", state: "running", waiting: null, seen: 0, ...o });
/** A desk with one machine: its chats, and those at work or waiting for you. @param {{ when?: number, works?: boolean, needs?: boolean, status?: string }} [o] */
const deskOf = ({ when = 5000, works = false, needs = false, status = "online" } = {}) => {
  const row = { there: { chain: "c-there", thread: null } };
  return /** @type {any} */ ({
    here: { id: "here", name: "This computer", color: "blue", icon: "monitor" },
    machines: [{ id: "m-studio", name: "Studio", color: "orange", icon: "monitor", status, refused: false, flags: [], rows: { needs: needs ? [row] : [], works: works ? [row] : [], done: [] }, recent: [{ ...row, when }] }],
  });
};

describe("when the desk looks", () => {
  // (fails before: yes — the remote desk's s2d: nothing said what a Run on chat changed there until a bring back)
  test("once a turn there ended since the last look: never while it works or waits for you, its machine away, its copy gone, a look just refused", () => {
    const o = { looking: new Set(), failed: new Map(), now: 100_000 };
    const works = readWorks({ works: [work()] });
    assert.deepEqual(dueLooks(works, deskOf(), o), [{ id: "w1", seen: 5000 }]);
    assert.deepEqual(dueLooks(readWorks({ works: [work({ seen: 5000 })] }), deskOf(), o), [], "looked at that moment already");
    assert.deepEqual(dueLooks(works, deskOf({ works: true }), o), [], "at work");
    assert.deepEqual(dueLooks(works, deskOf({ needs: true }), o), [], "waits for you");
    const threadWaits = deskOf();
    threadWaits.machines[0].rows.needs = [{ there: { chain: "c-there", thread: "t1" } }];
    assert.equal(dueLooks(works, threadWaits, o).length, 1, "a thread of it that waits for you is no turn of its own");
    assert.deepEqual(dueLooks(works, deskOf(), { ...o, refused: new Map([["w1", 5000]]) }), [], "refused for good at this moment");
    assert.equal(dueLooks(works, deskOf({ when: 6000 }), { ...o, refused: new Map([["w1", 5000]]) }).length, 1, "and looked at again once it moves");
    assert.deepEqual(dueLooks(works, deskOf({ status: "offline" }), o), []);
    assert.deepEqual(dueLooks(readWorks({ works: [work({ state: "gone" })] }), deskOf(), o), []);
    assert.deepEqual(dueLooks(readWorks({ works: [work({ state: "placed", chat: "" })] }), deskOf(), o), [], "no chat named yet");
    assert.deepEqual(dueLooks(works, deskOf(), { ...o, looking: new Set(["w1"]) }), [], "a look under way");
    assert.deepEqual(dueLooks(works, deskOf(), { ...o, failed: new Map([["w1", o.now - 1000]]) }), [], "a look refused a moment ago");
    assert.equal(dueLooks(works, deskOf(), { ...o, failed: new Map([["w1", o.now - LOOK_AGAIN_MS]]) }).length, 1, "and asked again after");
    assert.deepEqual(dueLooks(works, null, o), []);
  });

  test("records read field by field; what waits and what came said", () => {
    assert.deepEqual(readWorks({ works: [{ id: 3 }, { id: "x" }, work({ waiting: { at: "a", files: 0, conflicts: 0 } })] }).map((w) => [w.id, w.waiting]), [["w1", null]], "nothing waits where no file does");
    const [w] = readWorks({ works: [work({ waiting: { at: "abc", files: 3, conflicts: 1 } })] });
    assert.deepEqual(waitWords(w), {
      label: "3 files changed on Studio",
      title: "3 files its chat changed on Studio wait to come back into widgets — 1 overlaps your edits, and you choose what comes. Bring back brings them in as uncommitted edits.",
    });
    assert.equal(cameWords(w, { unchanged: true }), "Nothing changed on Studio since it went.");
    assert.equal(cameWords({ ...w, state: "brought" }, { unchanged: true }), "Nothing changed on Studio since you last brought it back.");
    assert.equal(
      cameWords(w, { files: [{}, {}], came: [{ path: "a.js", how: "took" }, { path: "b.js", how: "merged" }], left: [{ path: ".env", why: "a secret's file by its name" }] }),
      "2 files came back from Studio into widgets (1 as it left it, 1 merged with your edits), as uncommitted edits. Stayed in its copy on Studio, not brought here — a secret's file by its name: 1 (.env).",
    );
  });
});

test("the left bar: made where the app tells the page the desk, told each time, its card under Now's row and its pill on the row under its project", async () => {
  const { readFileSync } = await import("node:fs");
  const bar = readFileSync("src/ui/harness/sidebar.js", "utf8");
  assert.match(bar, /const work = typeof \(\/\*\* @type \{any\} \*\/ \(globalThis\)\.filamentMachines\?\.onDesk\) === "function"\s+\? createDeskWork\(\{/);
  assert.match(bar, /bridge\.onDesk\(\(\/\*\* @type \{unknown\} \*\/ d\) => \{\s+desk = readDesk\(d\);\s+syncInbox\(\);\s+now\.refresh\(\);\s+work\?\.sync\(desk\);/);
  assert.match(bar, /askCards: \(r, mk, w\) => \[\.\.\.\(inbox\?\.cardsOf\(r, mk, w\) \|\| \[\]\), \.\.\.\(work\?\.cardsOf\(r, mk\) \|\| \[\]\)\],\s+asksKey: \(\) => `\$\{inbox\?\.key\(\) \|\| ""\}\|\$\{work\?\.key\(\) \|\| ""\}`,/);
  const row = bar.slice(bar.indexOf("function deskChatRow("), bar.indexOf("function spaceRows("));
  assert.ok(row.includes("work?.pill(c.machine.id, c.there.chain) ?? null,"), "its pill on its row under its project");
});

describe("the desk's rows and Bring back, in a stand-in page", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());

  /**
   * A stand-in for this computer: its records, its looks and bring backs, each call kept.
   * @param {{ look?: (body: any) => any, back?: (body: any) => any }} o
   */
  const computer = (o) => {
    /** @type {string[]} */
    const calls = [];
    /** @type {Record<string, any>} */
    let rec = work();
    const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
      calls.push(`${init.method || "GET"} ${path} ${JSON.stringify(init.body ?? null)}`);
      if (path === "/remote-work") return { works: [rec] };
      if (path.endsWith("/check")) {
        const out = o.look?.(init.body) ?? { unchanged: true, files: [], count: 0, came: [], conflicts: [], at: "c1", left: [] };
        rec = { ...rec, ...(init.body?.seen ? { seen: init.body.seen } : {}), waiting: out.unchanged ? null : { at: out.at, files: out.count, conflicts: out.conflicts.length } };
        return { work: rec, ...out };
      }
      if (path.endsWith("/back")) {
        const out = o.back?.(init.body);
        if (out instanceof Error) throw out;
        rec = { ...rec, state: "brought", waiting: null };
        return { ok: true, work: rec, ...out };
      }
      throw new Error(`no ${path}`);
    };
    return { api, calls };
  };
  /** A stand-in dialog: its title, body and actions kept, closed as the page's is — its guard asked unless forced. */
  const dialogs = () => {
    /** @type {{ title: string, body: any, actions: any[], open: boolean }[]} */
    const shown = [];
    const dialog = (/** @type {any} */ o) => {
      const d = { title: o.title, body: o.body, actions: o.actions, open: true };
      shown.push(d);
      return {
        close: (/** @type {boolean} */ force = false) => {
          if (!force && o.guard && !o.guard()) return;
          if (d.open) {
            d.open = false;
            o.onClose?.();
          }
        },
      };
    };
    return { shown, dialog };
  };
  /** The dialog's action pressed. @param {{ actions: any[] }} d @param {string} label */
  const press = (d, label) => d.actions.find((/** @type {any} */ a) => a.label === label).onClick();

  test("a turn ended there: looked at once, its row says what waits; Bring back brings it in, and the mark goes", async () => {
    const { createDeskWork } = await import("../src/ui/harness/desk-work.js");
    const { h } = await import("../src/ui/lib/dom.js");
    const files = [{ path: "src/a.js", status: "M", added: 1, removed: 1 }, { path: "src/b.js", status: "M", added: 2, removed: 0 }, { path: "src/c.js", status: "A", added: 1, removed: 0 }];
    const pc = computer({ look: () => ({ unchanged: false, files, count: 3, came: files.map((f) => ({ path: f.path, how: "took" })), conflicts: [], at: "c1", left: [] }), back: () => ({ unchanged: false, files, came: files.map((f) => ({ path: f.path, how: "took" })), left: [] }) });
    const d = dialogs();
    /** @type {string[]} */
    const toasts = [];
    let changes = 0;
    const desk = createDeskWork({ api: pc.api, toast: (w) => void toasts.push(w), dialog: d.dialog, onChange: () => void changes++ });
    desk.sync(deskOf({ when: 5000 }));
    await until(() => desk.waiting("m-studio", "c-there"), "the look found what waits");
    assert.deepEqual(pc.calls, ["GET /remote-work null", 'POST /remote-work/w1/check {"seen":5000}']);
    assert.ok(changes > 0);
    desk.sync(deskOf({ when: 5000 }));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(pc.calls.length, 2, "the same moment: no look again");
    // Its card under its row in Now, and its pill under its project.
    const row = /** @type {any} */ ({ machine: { id: "m-studio", name: "Studio" }, there: { chain: "c-there", thread: null }, group: "done" });
    const [card] = desk.cardsOf(row, h);
    assert.match(String(card.textContent), /3 files changed on Studio.*Bring back/);
    assert.equal(desk.pill("m-studio", "c-there")?.textContent, "↩ 3");
    assert.equal(desk.cardsOf({ ...row, there: { chain: "other", thread: null } }, h).length, 0);
    // Bring back: looked at again, what would come shown, brought in on the press.
    /** @type {any} */ (card.querySelector(".desk-ask-btn")).dispatch("click");
    await until(() => d.shown.length === 1, "what would come, asked");
    assert.equal(d.shown[0].title, "Bring back 3 files from Studio?");
    assert.match(String(d.shown[0].body.textContent), /src\/a\.js.*src\/b\.js.*src\/c\.js/);
    press(d.shown[0], "Bring back");
    await until(() => toasts.length === 1, "what came, said");
    assert.match(toasts[0], /^3 files came back from Studio into widgets, as uncommitted edits\.$/);
    assert.equal(d.shown[0].open, false);
    assert.equal(pc.calls.at(-1), 'POST /remote-work/w1/back {"at":"c1"}', "the capture shown, and nothing else");
    assert.equal(desk.waiting("m-studio", "c-there"), null, "the mark goes");
    assert.deepEqual(desk.cardsOf(row, h), []);
  });

  // (fails before: yes — the review of s2d: every overlapping file was drawn with a choice of its own, however many)
  test("past 200 overlapping files, the rest take one choice for them all, sent for each", async () => {
    const { createDeskWork, STOPS_SHOWN } = await import("../src/ui/harness/desk-work.js");
    const stops = Array.from({ length: STOPS_SHOWN + 5 }, (_, i) => ({ path: `src/f${i}.js`, why: "2 changes overlap yours", kind: "lines" }));
    /** @type {any[]} */
    const backs = [];
    const pc = computer({
      look: () => ({ unchanged: false, files: stops.map((s) => ({ path: s.path, status: "M", added: 1, removed: 1 })), count: stops.length, came: [], conflicts: stops, at: "c1", left: [] }),
      back: (b) => (backs.push(b), { unchanged: false, files: stops, came: stops.map((s) => ({ path: s.path, how: "replaced" })), left: [] }),
    });
    const d = dialogs();
    const desk = createDeskWork({ api: pc.api, toast: () => {}, dialog: d.dialog, onChange: () => {} });
    desk.sync(deskOf());
    await until(() => desk.waiting("m-studio", "c-there"), "read");
    const brought = desk.bringBack("w1");
    await until(() => d.shown.length === 1, "asked");
    const picks = /** @type {any[]} */ (d.shown[0].body.querySelectorAll(".desk-work-pick"));
    assert.equal(picks.length, STOPS_SHOWN + 1, "200 of their own, and one for the rest");
    assert.match(String(d.shown[0].body.textContent), /and 5 more files/);
    for (const p of picks.slice(0, STOPS_SHOWN)) {
      p.value = "yours";
      p.dispatch("change");
    }
    picks.at(-1).value = "its";
    picks.at(-1).dispatch("change");
    press(d.shown[0], "Bring back");
    await brought;
    assert.equal(Object.keys(backs[0].choices).length, STOPS_SHOWN + 5);
    assert.deepEqual([backs[0].choices["src/f0.js"], backs[0].choices[`src/f${STOPS_SHOWN + 4}.js`]], ["yours", "its"]);
  });

  // (fails before: yes — the review of s2d: one look at a time for every record, so a machine that never answered held
  // every other record's look, for good)
  test("a look that never answers holds no other machine's looks, and is let go of past its wait, to be asked again", async () => {
    const { createDeskWork } = await import("../src/ui/harness/desk-work.js");
    /** @type {(() => void)[]} */
    const timers = [];
    const api = (/** @type {string} */ path, /** @type {any} */ init = {}) => {
      if (path === "/remote-work") return Promise.resolve({ works: [work({ id: "w-hung", machine: { id: "m-hung", name: "Hung" }, chat: "c-hung" }), work()] });
      if (path.includes("w-hung")) return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("The operation timed out."), { name: "TimeoutError" }))));
      return Promise.resolve({ work: work({ seen: init.body?.seen, waiting: { at: "c1", files: 1, conflicts: 0 } }) });
    };
    const two = deskOf();
    two.machines.push({ id: "m-hung", name: "Hung", color: "teal", icon: "server", status: "online", refused: false, flags: [], rows: { needs: [], works: [], done: [] }, recent: [{ there: { chain: "c-hung", thread: null }, when: 5000 }] });
    const desk = createDeskWork({ api, toast: () => {}, dialog: dialogs().dialog, onChange: () => {}, lookMs: 300, later: (fn) => void timers.push(fn) });
    desk.sync(two);
    await until(() => desk.waiting("m-studio", "c-there"), "the other machine's record looked at");
    await until(() => timers.length === 1 || null, "the hung look let go of, and asked again later");
  });

  test("a file both changed takes the person's choice, for the capture they saw; one that moved since is looked at again; nothing changed is said so", async () => {
    const { createDeskWork } = await import("../src/ui/harness/desk-work.js");
    const conflict = { path: "src/a.js", why: "2 changes overlap yours", kind: "lines" };
    // The capture there now: a look says it, a bring back for another says `moved`.
    let cap = "c1";
    /** @type {any[]} */
    let stops = [conflict];
    /** @type {any[]} */
    const backs = [];
    const pc = computer({
      look: () => ({ unchanged: false, files: [{ path: "src/a.js", status: "M", added: 1, removed: 1 }], count: 1, came: [], conflicts: stops, at: cap, left: [] }),
      back: (b) => {
        backs.push(b);
        if (b.at !== cap) return Object.assign(new Error("moved"), { status: 409, body: { ok: false, conflicts: stops, moved: true, at: cap, left: [] } });
        return { unchanged: false, files: [{}], came: [{ path: "src/a.js", how: stops.length ? "replaced" : "took" }], left: [] };
      },
    });
    const d = dialogs();
    /** @type {string[]} */
    const toasts = [];
    const desk = createDeskWork({ api: pc.api, toast: (w) => void toasts.push(w), dialog: d.dialog, onChange: () => {} });
    desk.sync(deskOf());
    await until(() => desk.waiting("m-studio", "c-there"), "read");
    const brought = desk.bringBack("w1");
    await until(() => d.shown.length === 1, "asked");
    press(d.shown[0], "Bring back");
    await new Promise((r) => setTimeout(r, 5));
    assert.match(String(d.shown[0].body.textContent), /Choose what comes for each file that overlaps your edits first/);
    assert.equal(backs.length, 0, "nothing sent without a choice");
    const pick = /** @type {any} */ (d.shown[0].body.querySelector(".desk-work-pick"));
    pick.value = "its";
    pick.dispatch("change");
    // It changed there while the person chose, and no file overlaps now (the review of s2d: the dialog asked to choose
    // again with nothing to choose, for good).
    cap = "c2";
    stops = [];
    press(d.shown[0], "Bring back");
    await until(() => d.shown.length === 2, "looked at again: it changed there since");
    assert.deepEqual(backs[0], { at: "c1", choices: { "src/a.js": "its" } });
    assert.equal(d.shown[0].open, false);
    assert.match(String(d.shown[1].body.textContent), /It changed again on Studio since you looked: this is what comes now/);
    assert.equal(d.shown[1].body.querySelector(".desk-work-pick"), null, "nothing to choose now");
    press(d.shown[1], "Bring back");
    await brought;
    assert.deepEqual(backs[1], { at: "c2" }, "the capture shown now");
    assert.match(toasts.at(-1) || "", /^1 file came back from Studio/);
    // Nothing changed since: said, nothing asked.
    const quiet = createDeskWork({ api: computer({}).api, toast: (w) => void toasts.push(w), dialog: d.dialog, onChange: () => {} });
    quiet.sync(deskOf());
    await new Promise((r) => setTimeout(r, 10));
    await quiet.bringBack("w1");
    assert.equal(toasts.at(-1), "Nothing changed on Studio since it went.");
    assert.equal(d.shown.length, 2);
  });

  // (fails before: yes — the review of s2b: a write the folder would not take was asked again as a file that overlaps your
  // edits, and Keep yours on it marked a change that never came)
  test("a bring back the folder will not take says why in the dialog, with nothing to choose; one written in part says which files to check, and closes", async () => {
    const { createDeskWork } = await import("../src/ui/harness/desk-work.js");
    const files = [{ path: "src/a.js", status: "M", added: 1, removed: 1 }];
    /** @type {any} */
    let answer = null;
    const pc = computer({ look: () => ({ unchanged: false, files, count: 1, came: [], conflicts: [], at: "c1", left: [] }), back: () => answer });
    const d = dialogs();
    /** @type {[string, string | undefined][]} */
    const toasts = [];
    const desk = createDeskWork({ api: pc.api, toast: (w, tone) => void toasts.push([w, tone]), dialog: d.dialog, onChange: () => {} });
    desk.sync(deskOf());
    await until(() => desk.waiting("m-studio", "c-there"), "read");
    const locked = "1 file does not come through cleanly — src/a.js: your folder would not take it (EBUSY)";
    answer = Object.assign(new Error(locked), { status: 409, body: { ok: false, error: locked, conflicts: [{ path: "src/a.js", why: "your folder would not take it (EBUSY)" }], at: "c1", left: [] } });
    const brought = desk.bringBack("w1");
    await until(() => d.shown.length === 1, "asked");
    press(d.shown[0], "Bring back");
    await until(() => String(d.shown[0].body.textContent).includes("EBUSY"), "its words in the dialog");
    assert.equal(d.shown.length, 1, "not asked again as an overlap");
    assert.equal(d.shown[0].open, true);
    assert.equal(d.shown[0].body.querySelector(".desk-work-pick"), null, "nothing to choose");
    // Pressed again, it was written in part and could not all be put back: which files to check, said, and the dialog closes.
    const partial = "Applied only in part: src/a.js: your folder would not take it (EBUSY), and 1 file could not be put back as it was — src/b.js. Check it by hand; the rest of the folder is as it was";
    answer = Object.assign(new Error(partial), { status: 409, body: { ok: false, partial: true, error: partial, conflicts: [{ path: "src/a.js", why: "your folder would not take it (EBUSY)" }], stuck: ["src/b.js"], at: "c1", left: [] } });
    press(d.shown[0], "Bring back");
    await brought;
    assert.equal(d.shown[0].open, false);
    assert.equal(d.shown.length, 1);
    assert.deepEqual(toasts.at(-1), [partial, "err"]);
  });

  // (fails before: yes — the review of s2d: Cancel while it brought back closed the dialog, and the folder was written all
  // the same)
  test("a bring back under way runs to its end: Cancel waits for it", async () => {
    const { createDeskWork } = await import("../src/ui/harness/desk-work.js");
    /** @type {(v: any) => void} */
    let answer = () => {};
    const files = [{ path: "src/a.js", status: "M", added: 1, removed: 0 }];
    const pc = computer({ look: () => ({ unchanged: false, files, count: 1, came: [], conflicts: [], at: "c1", left: [] }) });
    const api = (/** @type {string} */ path, /** @type {any} */ init) => (path.endsWith("/back") ? new Promise((r) => void (answer = r)) : pc.api(path, init));
    const d = dialogs();
    /** @type {string[]} */
    const toasts = [];
    const desk = createDeskWork({ api, toast: (w) => void toasts.push(w), dialog: d.dialog, onChange: () => {} });
    desk.sync(deskOf());
    await until(() => desk.waiting("m-studio", "c-there"), "read");
    const brought = desk.bringBack("w1");
    await until(() => d.shown.length === 1, "asked");
    press(d.shown[0], "Bring back");
    await new Promise((r) => setTimeout(r, 5));
    press(d.shown[0], "Cancel");
    assert.equal(d.shown[0].open, true, "it stays while its answer comes");
    answer({ ok: true, work: work({ state: "brought" }), unchanged: false, files: [{}], came: [{ path: "src/a.js", how: "took" }], left: [] });
    await brought;
    assert.equal(d.shown[0].open, false);
    assert.match(toasts[0], /^1 file came back from Studio/);
  });

  // (fails before: yes — the review of s2d: a look refused a moment was never asked again while the desk stayed quiet,
  // and one refused for good was asked again every 30 s, a capture there each time)
  test("a look refused a moment is asked again by itself; one refused for good waits for the chat to move there", async () => {
    const { createDeskWork } = await import("../src/ui/harness/desk-work.js");
    let clock = 1_000_000;
    /** @type {(() => void)[]} */
    const timers = [];
    /** @type {any[]} */
    const answers = [Object.assign(new Error("cut"), { status: 503, body: { kind: "cut" } }), { work: work({ seen: 5000, waiting: { at: "c1", files: 2, conflicts: 0 } }) }];
    let looks = 0;
    const api = async (/** @type {string} */ path) => {
      if (path === "/remote-work") return { works: [work()] };
      looks++;
      const a = answers.shift();
      if (a instanceof Error) throw a;
      return a;
    };
    const desk = createDeskWork({ api, toast: () => {}, dialog: dialogs().dialog, onChange: () => {}, now: () => clock, later: (fn) => void timers.push(fn) });
    desk.sync(deskOf());
    await until(() => looks === 1 && timers.length === 1, "refused a moment, and asked again later");
    clock += LOOK_AGAIN_MS + 100;
    timers.shift()?.();
    await until(() => desk.waiting("m-studio", "c-there"), "the desk quiet, looked at again all the same");
    assert.equal(looks, 2);
    // Refused for good: not asked again at the same moment, nor later; asked once the chat moves there.
    let refusedLooks = 0;
    const firm = createDeskWork({
      api: async (/** @type {string} */ path) => {
        if (path === "/remote-work") return { works: [work()] };
        refusedLooks++;
        throw Object.assign(new Error("another chat's copy"), { status: 422, body: { kind: "refused" } });
      },
      toast: () => {}, dialog: dialogs().dialog, onChange: () => {}, now: () => clock, later: (fn) => void timers.push(fn),
    });
    firm.sync(deskOf());
    await until(() => refusedLooks === 1, "looked at once");
    await new Promise((r) => setTimeout(r, 5));
    clock += LOOK_AGAIN_MS * 2;
    firm.sync(deskOf());
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual([refusedLooks, timers.length], [1, 0], "not again at the same moment, no timer");
    firm.sync(deskOf({ when: 9000 }));
    await until(() => refusedLooks === 2, "the chat moved there: looked at again");
  });

  // (fails before: yes — s5b's drive: a Run on chat whose turn ended within a minute of the records' last read was never
  // looked at, its record unknown here, and Bring back never offered)
  test("a record a Run on send made is read at once, though the desk moved since the last read: its ended turn is looked at", async () => {
    const { createDeskWork, READ_AGAIN_MS } = await import("../src/ui/harness/desk-work.js");
    let clock = 1_000_000;
    let made = false;
    /** @type {string[]} */
    const calls = [];
    const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
      calls.push(`${init.method || "GET"} ${path}`);
      if (path === "/remote-work") return { works: made ? [work()] : [] };
      return { work: work({ seen: init.body?.seen, waiting: { at: "c1", files: 1, conflicts: 0 } }) };
    };
    const desk = createDeskWork({ api, toast: () => {}, dialog: dialogs().dialog, onChange: () => {}, now: () => clock });
    desk.sync(deskOf({ when: 500 }));
    await until(() => calls.length === 1, "the records read");
    // The send makes its record; its turn ends there, and the desk moves within READ_AGAIN_MS: not read again.
    made = true;
    clock += READ_AGAIN_MS / 2;
    desk.sync(deskOf({ when: 5000 }));
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual([calls.length, desk.waiting("m-studio", "c-there")], [1, null]);
    await desk.reload();
    await until(() => desk.waiting("m-studio", "c-there"), "looked at, once read");
    assert.deepEqual(calls, ["GET /remote-work", "GET /remote-work", "POST /remote-work/w1/check"]);
    // (The send's own call of it: run-on.test.js, `recorded`.)
  });

  // (fails before: yes — the review of x26: a reload joined a read already under way, asked before the record was made,
  // and its answer without the record was all it read)
  test("a reload while a read is under way reads again after it: the record made meanwhile is read, and its chat looked at", async () => {
    const { createDeskWork } = await import("../src/ui/harness/desk-work.js");
    let made = false;
    /** @type {string[]} */
    const calls = [];
    /** The first read's answer, held until the test lets it go. @type {(v?: unknown) => void} */
    let letGo = () => {};
    const held = new Promise((r) => (letGo = r));
    const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
      calls.push(`${init.method || "GET"} ${path}`);
      if (path === "/remote-work") {
        // Asked before the record was made: it answers without it, however late.
        const had = made;
        if (calls.length === 1) await held;
        return { works: had ? [work()] : [] };
      }
      return { work: work({ seen: init.body?.seen, waiting: { at: "c1", files: 1, conflicts: 0 } }) };
    };
    const desk = createDeskWork({ api, toast: () => {}, dialog: dialogs().dialog, onChange: () => {}, now: () => 1_000_000 });
    desk.sync(deskOf({ when: 500 }));
    await until(() => calls.length === 1, "a read under way");
    made = true;
    const reread = desk.reload();
    letGo();
    await reread;
    await until(() => desk.waiting("m-studio", "c-there"), "looked at, once read");
    assert.deepEqual(calls, ["GET /remote-work", "GET /remote-work", "POST /remote-work/w1/check"]);
  });

  test("while its turn runs there, Bring back says so and asks nothing", async () => {
    const { createDeskWork } = await import("../src/ui/harness/desk-work.js");
    /** @type {string[]} */
    const toasts = [];
    const d = dialogs();
    let n = 0;
    const api = async (/** @type {string} */ path) => {
      if (path === "/remote-work") return { works: [work({ waiting: { at: "c1", files: 1, conflicts: 0 } })] };
      n++;
      throw Object.assign(new Error("Studio is still working in your chat there: bring its changes back once its turn ends"), { status: 409, body: { error: "Studio is still working in your chat there: bring its changes back once its turn ends", kind: "runs" } });
    };
    const desk = createDeskWork({ api, toast: (w, k) => void toasts.push(`${k}:${w}`), dialog: d.dialog, onChange: () => {} });
    desk.sync(deskOf({ works: true }));
    await until(() => desk.waiting("m-studio", "c-there"), "read");
    assert.equal(n, 0, "no look while it works");
    await desk.bringBack("w1");
    assert.deepEqual(toasts, ["err:Studio is still working in your chat there: bring its changes back once its turn ends"]);
    assert.equal(d.shown.length, 0);
  });
});

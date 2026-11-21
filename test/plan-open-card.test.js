// @ts-check
// The Plan page's Still open card (the owner's of 11-10: "a mess and un explainable"): drawn from each item's view in the
// person's words (still-open.js `OpenView`) — what waits, then what runs, a row each with one button (Review its change,
// Answer or Open its thread), what was left behind in one line whose button opens the project's Folders and worktrees,
// what the agent dismissed folded under them with Undo — posted, then the session read again; a refusal said in an error
// toast. The card reads nothing of its own. On the fake DOM; the toasts in the stub document.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { OPEN_AGAIN_MOST, OPEN_AGAIN_MS, OPEN_INFO, askOpenAgain, renderPlan } from "../src/ui/harness/views/plan.js";
import { createStillOpen } from "../src/app/agent/still-open.js";
import { state } from "../src/ui/harness/state.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { stubDocument } from "./helpers/dom-stub.js";

const g = /** @type {any} */ (globalThis);
const NOW = 1_320_700;
const settle = () => new Promise((r) => setImmediate(r));

/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** @param {any} n @param {string} cls */
const byClass = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls));
/** @param {any} n @param {string} cls */
const one = (n, cls) => byClass(n, cls)[0];
/** A button by its words. @param {any} n @param {string} words */
const press = (n, words) => buttonsOf(n).find((b) => textOf(b) === words);
/** A chat of the page's with a checklist, in a folder. @param {string} id */
const chatOf = (id) => ({ id, chainId: `chain-${id}`, title: id, cwd: "H:\\proj", turns: [{ n: 1, status: "done", aligned: alignEvents([{ n: 1, type: "plan", round: 1, items: [{ text: "Write the notes", status: "doing" }] }]) }], live: null, view: { settings: {} } });
/** The Still open card as drawn now. @param {any} body */
const cardOf = (body) => one(body, "pv-open");
/** Open the card as a press on its head does. @param {any} body */
const openCard = (body) => {
  const card = cardOf(body);
  card.attrs.open = "";
  card.dispatch("toggle", { currentTarget: { open: true } });
};

/** A view as still-open.js `OpenView` says one. @param {"waiting" | "running" | "left"} group @param {string} tone @param {string} title @param {string} detail @param {Record<string, any>} [more] */
const v = (group, tone, title, detail, more = {}) => ({ group, tone, title, detail, ...more });
const CMD = { key: "command:bg_1", line: "background command bg_1: `npm run dev` in H:\\proj, running for 3 min", dismissed: false, view: v("running", "run", "npm run dev", "Background command, running 3 min · in proj") };
const WORKS = { key: "agent:sa_1:working", line: "sub-agent sa_1 (\"Map the flow\"): still working; its report comes to you", dismissed: false, view: v("running", "run", "Map the flow", "Sub-agent at work: its report comes to the agent", { act: "thread", agent: "sa_1" }) };
const ASKS = { key: "agent:sa_2:asks", line: "sub-agent sa_2 (\"Review: auth\"): still working; it waits for the person's answer to its question; its report comes to you", dismissed: false, view: v("waiting", "ask", "Review: auth", "A sub-agent at work asks you a question", { act: "thread", agent: "sa_2" }) };
const WAITS = { key: "agent:sa_3:waits", line: "sub-agent sa_3 (\"add export\"): 3 files of its work wait to be applied (for 2 h)", dismissed: false, view: v("waiting", "wait", "add export", "3 files to apply · waiting 2 h", { act: "review", agent: "sa_3" }) };
const LETTER = { key: "letter:lt_1", line: "letter lt_1, \"Placeholders\", from the Website chat, 40 min ago: it waits for your reply — send it with Filament's envelope tool (answer: \"lt_1\"), or leave it", dismissed: false, view: v("waiting", "wait", "Placeholders", "Letter from the Website chat, 40 min ago · waits for the agent's reply") };
const FAILED = { key: "agent:sa_4:failed", line: "sub-agent sa_4 (\"port the parser\"): failed — rate limited; follow it up to try again, or leave it", dismissed: true, view: v("waiting", "fail", "port the parser", "Failed: rate limited", { act: "thread", agent: "sa_4" }) };
const COPIES = { key: "copies:H:/proj", line: "Filament's copies of H:/proj: 4 on disk, 3.0 GB — …", dismissed: false, view: v("left", "left", "Filament's copies of proj", "4 on disk · 3.0 GB", { what: "copies", count: 4, size: "3.0 GB" }) };
/** A merged worktree left behind. @param {string} name @param {boolean} [dismissed] */
const WT = (name, dismissed = false) => ({ key: `worktree:H:/${name}`, line: `worktree H:/${name} (branch ${name}): merged into main, nothing uncommitted — …`, dismissed, view: v("left", "left", name, "Worktree merged into main, nothing uncommitted", { what: "worktree" }) });
const BRANCH = { key: "branch:spike", line: "branch spike: merged into main and checked out nowhere — …", dismissed: false, view: v("left", "left", "spike", "Branch merged into main, checked out nowhere", { what: "branch" }) };
/** An answer whose Still open lists `items`, its live lines the agent's. @param {any[]} items @param {boolean} [told] */
const answerOf = (items, told = true) => ({ inForce: { graph: null, goal: null }, open: { lines: items.filter((i) => !i.dismissed).map((i) => `- ${i.line}`), told, items } });
/** The rows of a part of the card: each row's title, the line under it and its buttons. @param {any} n */
const rowsOf = (n) => byClass(n, "pv-open-row").map((r) => [textOf(one(r, "pv-open-t")), textOf(one(r, "pv-open-d")), buttonsOf(r).map(textOf).join(",")]);
/** A group of the card by its name. @param {any} card @param {string} name */
const groupOf = (card, name) => byClass(card, "pv-open-group").find((g) => textOf(one(g, "pv-open-gh")).startsWith(name));

/**
 * A stand-in for the admin API: the session's answer from `session()`, a post answered by `posted()`; what was asked, in
 * order — the card reads nothing of its own: a footprint or a places read fails the test.
 * @param {{ session: () => any, posted?: (path: string, init: any) => any }} o
 */
const server = (o) => {
  /** @type {{ path: string, init: any }[]} */
  const asked = [];
  const api = async (/** @type {string} */ path, /** @type {any} */ init) => {
    asked.push({ path, init: init || null });
    // A page that reads at every draw would read on for ever, each answer drawing it again: past a few, none answers.
    if (times(path) > 5) return new Promise(() => {});
    if (init?.method === "POST") return o.posted ? o.posted(path, init) : { ok: true };
    if (path.startsWith("/sessions/")) return o.session();
    throw new Error(`nothing at ${path}`);
  };
  /** How many times this path was asked. @param {string} path */
  const times = (path) => asked.filter((a) => a.path === path).length;
  return { api, asked, times };
};
/**
 * Draw the page for a chat against a stand-in server; `opened` records the project whose places were opened, `cleans`
 * the footprint sheets opened (space/footprint.js `openCleanUp`'s seam), `threads` and `reviews` the sub-agents whose
 * thread or change the card's buttons opened.
 * @param {any} chat @param {ReturnType<typeof server>} s
 */
const page = (chat, s) => {
  const body = fakeH("div");
  /** @type {string[]} */
  const opened = [];
  /** @type {{ cwd: string, o: { onCleaned: () => void, busy: (doing: string) => void } }[]} */
  const cleans = [];
  /** @type {string[]} */
  const threads = [];
  /** @type {string[]} */
  const reviews = [];
  const view = renderPlan(body, { chat, openAgent: (id) => threads.push(id), reviewAgent: (id) => reviews.push(id) }, { h: fakeH, api: s.api, now: () => NOW, openPlaces: (/** @type {string} */ p) => opened.push(p), cleanUp: async (/** @type {string} */ cwd, /** @type {any} */ o) => { cleans.push({ cwd, o }); } });
  return { body, view, opened, cleans, threads, reviews };
};
/** Draw it once its answer landed. @param {any} chat @param {ReturnType<typeof server>} s */
const drawn = async (chat, s) => {
  const p = page(chat, s);
  await settle();
  p.view.paint();
  return p;
};

describe("the Still open card", () => {
  /** @type {any[]} */
  let hadSessions = [];
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  before(() => {
    hadSessions = state.sessions;
    state.sessions = /** @type {any} */ (["left", "late-none", "tidy"].map((id) => ({ id: `chain-${id}`, project: "p1" })));
    doc = stubDocument();
    had.requestAnimationFrame = g.requestAnimationFrame;
    g.requestAnimationFrame = () => 0;
    g.window.setTimeout = () => 0;
  });
  after(() => {
    state.sessions = hadSessions;
    doc.restore();
    if (had.requestAnimationFrame === undefined) delete g.requestAnimationFrame;
    else g.requestAnimationFrame = had.requestAnimationFrame;
  });
  const toasts = () => doc.document.body.querySelectorAll(".zc-toast").map((/** @type {any} */ t) => [t.textContent, t.getAttribute("class")]);

  // (fails before: yes — the owner's of 11-10, "a mess and un explainable": the card listed the agent's own lines, its
  // ids, its tool's words and "the person" in them, with nothing to press but Undo)
  test("what waits, then what runs, in groups: a row each with its title, a line under it in the person's words, and one button — Review its change, Answer or Open its thread", async () => {
    const s = server({ session: () => answerOf([CMD, WORKS, ASKS, WAITS, LETTER]) });
    const { body, threads, reviews } = await drawn(chatOf("groups"), s);
    const card = cardOf(body);
    assert.equal(textOf(one(card, "pv-open-head")), "Still open|3 waiting|2 running", "its counts at a glance, folded");
    assert.deepEqual(byClass(card, "pv-open-gh").map(textOf), ["Waiting|3", "Running|2"]);
    assert.deepEqual(rowsOf(groupOf(card, "Waiting")), [
      ["Review: auth", "A sub-agent at work asks you a question", "Answer"],
      ["add export", "3 files to apply · waiting 2 h", "Review"],
      ["Placeholders", "Letter from the Website chat, 40 min ago · waits for the agent's reply", ""],
    ]);
    assert.deepEqual(rowsOf(groupOf(card, "Running")), [
      ["npm run dev", "Background command, running 3 min · in proj", ""],
      ["Map the flow", "Sub-agent at work: its report comes to the agent", "Open"],
    ]);
    assert.deepEqual(byClass(card, "pv-open-row").map((r) => r.attrs.class), ["pv-open-row is-ask", "pv-open-row is-wait", "pv-open-row is-wait", "pv-open-row is-run", "pv-open-row is-run"]);
    assert.doesNotMatch(textOf(card), /agent_id|apply_changes|envelope|bg_1|the person/, "none of the agent's words");
    press(groupOf(card, "Waiting"), "Review").dispatch("click");
    press(groupOf(card, "Waiting"), "Answer").dispatch("click");
    press(groupOf(card, "Running"), "Open").dispatch("click");
    assert.deepEqual([reviews, threads], [["sa_3"], ["sa_2", "sa_1"]]);
    assert.equal(one(card, "pv-open-due"), undefined, "told: nothing is due");
  });

  test("the agent compacted since it heard the list: said once, over the groups; how the list works rides the ⓘ", async () => {
    const s = server({ session: () => answerOf([CMD], false) });
    const { body } = await drawn(chatOf("due"), s);
    const card = cardOf(body);
    assert.match(textOf(one(card, "pv-open-due")), /^The agent compacted its context since it last heard this list: Filament tells it again with your next message\.$/);
    const info = one(card, "pv-open-info");
    assert.equal(info.attrs.title, OPEN_INFO);
    assert.match(OPEN_INFO, /tells the agent again after every compaction/);
    assert.match(OPEN_INFO, /dismiss a row that no longer holds; it comes back if that changes, and Undo puts it back/);
    assert.equal(one(card, "pv-quiet"), undefined, "no paragraph of how it works on the card");
    // (fails before: yes — the reviewer's of 11-10: a press on the ⓘ, inside the head, opened and closed the card)
    /** @type {string[]} */
    const did = [];
    info.dispatch("click", { preventDefault: () => did.push("kept closed"), stopPropagation: () => did.push("not the head's") });
    assert.deepEqual(did, ["kept closed", "not the head's"]);
  });

  // (fails before: yes — the reviewer's of 11-10: what was left behind is in the agent's list too, and the note was not said)
  test("the agent compacted since it heard a list of what was left behind alone: the note is said", async () => {
    const s = server({ session: () => answerOf([COPIES, WT("proj-fixes")], false) });
    const { body } = await drawn(chatOf("due-left"), s);
    assert.match(textOf(one(cardOf(body), "pv-open-due")), /^The agent compacted its context since it last heard this list/);
    const dismissed = await drawn(chatOf("due-gone"), server({ session: () => answerOf([WT("proj-fixes", true)], false) }));
    assert.equal(one(cardOf(dismissed.body), "pv-open-due"), undefined, "all of it dismissed: the agent hears none of it");
  });

  // (fails before: yes — the card listed every worktree left over, twice: the agent's lines, then its own reads of the
  // folder's places and footprint, each with a button of its own)
  test("what was left behind is one line, counted dismissed or not, its button opening the project's Folders and worktrees; the card reads nothing of its own", async () => {
    const s = server({ session: () => answerOf([WORKS, COPIES, WT("proj-fixes", true), WT("proj-harness"), BRANCH]) });
    const { body, opened, view } = await drawn(chatOf("left"), s);
    const card = cardOf(body);
    assert.equal(textOf(one(card, "pv-open-head")), "Still open|1 running|left behind");
    const left = one(card, "pv-open-left");
    assert.equal(textOf(left), "Left behind|4 Filament copies (3.0 GB) · 2 merged worktrees · 1 merged branch|Tidy up ›");
    assert.equal(one(left, "pv-open-text").attrs.title, "Filament's copies of proj — 4 on disk · 3.0 GB\nproj-fixes — Worktree merged into main, nothing uncommitted\nproj-harness — Worktree merged into main, nothing uncommitted\nspike — Branch merged into main, checked out nowhere");
    assert.equal(byClass(card, "pv-open-row").length, 1, "no row of its own for what was left behind");
    // (fails before: yes — the reviewer's of 11-10: it said Tidy up removes what nothing needs; a branch goes by Clean up…)
    // (fails before: yes — d-send's third follow-up: it said the sheet is "in the project's Space", which a project with
    // no Space has not; its menu in the left bar and ⋯ on its page open it either way)
    assert.equal(press(left, "Tidy up ›").attrs.title, "Opens the project's Folders and worktrees, as its menu in the left bar and ⋯ on its page do: Tidy up removes the merged worktrees with their branches, Clean up… Filament's copies and its routines' branches — nothing goes until you say so");
    assert.equal(one(card, "pv-open-gone"), undefined, "a dismissal of what was left behind is the agent's alone: no fold for it");
    press(left, "Tidy up ›").dispatch("click");
    assert.deepEqual(opened, ["p1"]);
    openCard(body);
    await settle();
    view.paint();
    assert.deepEqual(s.asked.filter((a) => !a.path.startsWith("/sessions/")).map((a) => a.path), [], "no footprint, no places");
  });

  // (fails before: yes — the re-read of 11-11: in no project the line counted a merged worktree, which its Clean up…
  // does not take, and with worktrees alone it stood there with nothing to press)
  test("a chat in no project: the line says what its Clean up… takes — the copies, a routine's branch, a deleted chat's work —, opens the footprint's sheet on the chat's folder, says what it does, and the session is read again after a clean; a merged worktree or a fork alone is not said", async () => {
    const s = server({ session: () => answerOf([COPIES, WT("proj-fixes")]) });
    const { body, view, cleans, opened } = await drawn(chatOf("noproj"), s);
    const left = () => one(cardOf(body), "pv-open-left");
    assert.equal(textOf(left()), "Left behind|4 Filament copies (3.0 GB)|Clean up…");
    assert.equal(one(left(), "pv-open-text").attrs.title, "Filament's copies of proj — 4 on disk · 3.0 GB", "the worktree is tidied nowhere the card opens");
    press(left(), "Clean up…").dispatch("click");
    assert.deepEqual([cleans.map((x) => x.cwd), opened], [["H:\\proj"], []]);
    const { o } = cleans[0];
    o.busy("reading");
    assert.ok(press(left(), "Reading…")?.attrs.disabled !== undefined, "no second press");
    o.busy("cleaning");
    assert.ok(press(left(), "Cleaning up…"));
    const before = s.times("/sessions/chain-noproj?open=fresh");
    o.onCleaned();
    view.paint();
    await settle();
    assert.equal(s.times("/sessions/chain-noproj?open=fresh"), before + 1, "read again");
    assert.ok(press(left(), "Clean up…"), "done");
    // A routine's branch or a deleted chat's work alone: Clean up… takes them too.
    const DELETED = { key: "deleted:c_gone", line: "a deleted chat's sub-agent's work — …", dismissed: false, view: v("left", "left", "A deleted chat's work", "Kept since its chat was deleted", { what: "deleted" }) };
    const b = await drawn(chatOf("branch-alone"), server({ session: () => answerOf([BRANCH, DELETED]) }));
    assert.equal(textOf(one(cardOf(b.body), "pv-open-left")), "Left behind|1 merged branch · 1 deleted chat's sub-agent's work|Clean up…");
    press(one(cardOf(b.body), "pv-open-left"), "Clean up…").dispatch("click");
    assert.deepEqual(b.cleans.map((x) => x.cwd), ["H:\\proj"]);
    // Worktrees and forks alone, in no project: Folders and worktrees is a project's, and Clean up… takes neither — the
    // card says no "Left behind" it gives no way to act on.
    const FORK = { key: "fork:c_gone", line: "fork of a deleted chat — …", dismissed: false, view: v("left", "left", "Fork of a deleted chat", "Its worktree is still there", { what: "fork" }) };
    const t = await drawn(chatOf("bare"), server({ session: () => answerOf([WT("proj-fixes"), FORK]) }));
    assert.equal(one(cardOf(t.body), "pv-open-left"), undefined);
    assert.equal(textOf(one(cardOf(t.body), "pv-open-head")), "Still open|nothing");
    assert.equal(buttonsOf(cardOf(t.body)).length, 0);
    // In no folder either: nothing to open the sheet on.
    const n = await drawn({ ...chatOf("nofolder"), cwd: "" }, server({ session: () => answerOf([COPIES]) }));
    assert.equal(one(cardOf(n.body), "pv-open-left"), undefined);
  });

  // (fails before: yes — the re-read of 11-11: the card read the list with none of the coding agent's own tasks)
  test("the coding agent's own background tasks are rows of the card, among what runs, as the list says them to a reader that runs none", async () => {
    const tasks = [
      { id: "bt-1", kind: "local_bash", description: "npm run dev", since: NOW - 120_000, background: true },
      { id: "bt-2", kind: "local_agent", description: "", since: NOW - 60_000, background: true },
    ];
    const so = createStillOpen({ archive: () => null, tasks: (_c, session) => (session === "s1" ? tasks : []), theirs: (_c, session) => (session === "s1" ? null : { who: "Claude Code", tasks }), now: () => NOW });
    const s = server({ session: () => ({ inForce: { graph: null, goal: null }, open: so.shown("chain-own") }) });
    const { body } = await drawn(chatOf("own"), s);
    const card = cardOf(body);
    assert.equal(textOf(one(card, "pv-open-head")), "Still open|2 running");
    assert.deepEqual(rowsOf(groupOf(card, "Running")), [
      ["npm run dev", "In Claude Code's session of this chat, running 2 min", ""],
      ["Background agent bt-2", "In Claude Code's session of this chat, running 1 min", ""],
    ]);
  });

  // (fails before: yes — the re-read of 11-11: Filament's own fold of the chat was said as the agent's compaction)
  test("Filament folded the chat since the agent heard the list: the note says whose compaction it was", async () => {
    const a = answerOf([CMD], false);
    const { body } = await drawn(chatOf("folded"), server({ session: () => ({ ...a, open: { ...a.open, folded: true } }) }));
    assert.equal(textOf(one(cardOf(body), "pv-open-due")), "Filament compacted this chat's context since the agent last heard this list: Filament tells it again with your next message.");
  });

  // (fails before: yes — the re-read of 11-11: the first look after a start had none of the folder's rows and no word
  // that they were being read: the card said "nothing" for half a minute)
  test("while the chat's folder is still being read the card says so, and its head says no nothing it cannot know yet; read, it says nothing", async () => {
    let stale = true;
    const s = server({ session: () => { const a = answerOf([]); return stale ? { ...a, open: { ...a.open, stale: true } } : a; } });
    const { body, view } = await drawn(chatOf("first-look"), s);
    assert.equal(textOf(one(cardOf(body), "pv-open-head")), "Still open|reading…");
    assert.equal(textOf(one(cardOf(body), "pv-open-reading")), "Filament is reading what this chat's folder holds: what was left behind may change in a moment.");
    stale = false;
    askOpenAgain();
    view.paint();
    await settle();
    view.paint();
    assert.equal(textOf(one(cardOf(body), "pv-open-head")), "Still open|nothing");
    assert.equal(one(cardOf(body), "pv-open-reading"), undefined);
    // With rows to show, the head counts them, and the line stands under them.
    const a = answerOf([CMD]);
    const r = await drawn(chatOf("re-read"), server({ session: () => ({ ...a, open: { ...a.open, stale: true } }) }));
    assert.equal(textOf(one(cardOf(r.body), "pv-open-head")), "Still open|1 running");
    assert.ok(one(cardOf(r.body), "pv-open-reading"));
  });

  // (fails before: yes — the reviewer's of 11-10: back from the Space's Tidy up within the half minute, the card said the
  // worktrees removed there)
  test("a worktree removed or put back in the Space has every chat's Plan read its session again at its next draw", async () => {
    const s = server({ session: () => answerOf([WT("proj-fixes")]) });
    const { view } = await drawn(chatOf("tidied"), s);
    const before = s.times("/sessions/chain-tidied?open=fresh");
    view.paint();
    await settle();
    assert.equal(s.times("/sessions/chain-tidied?open=fresh"), before, "within the half minute: the answer heard");
    askOpenAgain();
    view.paint();
    await settle();
    assert.equal(s.times("/sessions/chain-tidied?open=fresh"), before + 1, "read again");
  });

  // (fails before: yes — the review of 4569417b8: on a repository of many worktrees the read anew outlasts the answer's
  // wait, and the card kept what went for half a minute more)
  test("an answer whose Still open was still being read anew is asked for again shortly, a few times at most", async () => {
    let stale = true;
    const s = server({ session: () => { const a = answerOf([WT("proj-fixes")]); return stale ? { ...a, open: { ...a.open, stale: true } } : a; } });
    /** @type {(() => void)[]} */
    const timers = [];
    const had = g.window.setTimeout;
    g.window.setTimeout = (/** @type {() => void} */ fn, /** @type {number} */ ms) => (ms === OPEN_AGAIN_MS ? timers.push(fn) : 0);
    try {
      await drawn(chatOf("reading"), s);
      const path = "/sessions/chain-reading?open=fresh";
      assert.equal(s.times(path), 1);
      assert.equal(timers.length, 1, "asked again in a moment");
      /** @type {any} */ (timers.shift())();
      await settle();
      assert.equal(s.times(path), 2);
      stale = false;
      /** @type {any} */ (timers.shift())();
      await settle();
      assert.equal(s.times(path), 3);
      assert.equal(timers.length, 0, "read anew: no more");
      // Still read anew after every wait: a few times, then the page's own half minute.
      stale = true;
      const other = server({ session: () => { const a = answerOf([WT("proj-fixes")]); return { ...a, open: { ...a.open, stale: true } }; } });
      await drawn(chatOf("slow"), other);
      for (let i = 0; i < 20 && timers.length; i++) {
        /** @type {any} */ (timers.shift())();
        await settle();
      }
      assert.equal(other.times("/sessions/chain-slow?open=fresh"), 1 + OPEN_AGAIN_MOST);
    } finally {
      g.window.setTimeout = had;
    }
  });

  // (fails before: yes — the review of 11-09: the page drew again only where what it shows changed, and the project was
  // no part of that)
  test("Tidy up › is offered once the chat's project is known, though nothing else changed", async () => {
    const s = server({ session: () => answerOf([WT("proj-fixes")]) });
    const { body, view } = await drawn(chatOf("late"), s);
    // No project yet: a worktree is tidied in a project's Folders and worktrees, so the card says no line with nothing
    // to press (the re-read of 11-11: it said "Left behind" with no button).
    assert.equal(one(cardOf(body), "pv-open-left"), undefined, "no project yet");
    const had = state.sessions;
    try {
      state.sessions = /** @type {any} */ ([...had, { id: "chain-late", project: "p1" }]);
      view.paint();
      assert.equal(textOf(buttonsOf(one(cardOf(body), "pv-open-left"))[0]), "Tidy up ›");
    } finally {
      state.sessions = had;
    }
  });

  test("what the agent dismissed is folded under the rest, each with its button and Undo; the head counts the live ones, and what it dismissed; the fold stays open as the page draws again", async () => {
    const s = server({ session: () => answerOf([CMD, FAILED]) });
    const chat = chatOf("gone");
    const { body, view } = await drawn(chat, s);
    const card = cardOf(body);
    assert.equal(textOf(one(card, "pv-open-head")), "Still open|1 running|1 dismissed");
    const gone = one(card, "pv-open-gone");
    assert.equal(textOf(gone.kids[0]), "Dismissed by the agent · 1");
    assert.equal("open" in gone.attrs, false, "folded");
    assert.deepEqual(rowsOf(gone), [["port the parser", "Failed: rate limited", "Open,Undo"]]);
    assert.equal(byClass(gone, "pv-open-row")[0].attrs.class, "pv-open-row is-fail is-dismissed");
    gone.attrs.open = "";
    gone.dispatch("toggle", { currentTarget: { open: true } });
    /** @type {any} */ (chat).turns = [...chat.turns, { ...chat.turns[0], n: 2 }];
    view.paint();
    assert.equal("open" in one(cardOf(body), "pv-open-gone").attrs, true, "kept open");
  });

  // (fails before: yes — the owner's of 11-10: the card said "Nothing is waiting or running" while Changes showed 35
  // files waiting, the change the agent had dismissed folded under what was left behind, with only Undo)
  test("a change the agent dismissed still waits: counted in the head, the body says so, its row keeps Review beside Undo, and the fold comes before what was left behind", async () => {
    const s = server({ session: () => answerOf([{ ...WAITS, dismissed: true }, COPIES]) });
    const { body, reviews } = await drawn(chatOf("waits-gone"), s);
    const card = cardOf(body);
    assert.equal(textOf(one(card, "pv-open-head")), "Still open|left behind|1 dismissed");
    assert.equal(textOf(one(card, "pv-open-empty")), "Nothing is waiting or running that the agent still hears of. It dismissed one line, below.");
    const gone = one(card, "pv-open-gone");
    assert.deepEqual(rowsOf(gone), [["add export", "3 files to apply · waiting 2 h", "Review,Undo"]]);
    const kids = one(card, "pv-open-body").kids.filter(Boolean);
    assert.ok(kids.indexOf(gone) < kids.indexOf(one(card, "pv-open-left")), "the fold before what was left behind");
    press(gone, "Review").dispatch("click");
    assert.deepEqual(reviews, ["sa_3"]);
  });

  // (fails before: yes — no Undo)
  test("Undo posts the item's key, then reads the session again: the row is among the live ones once more", async () => {
    let dismissed = true;
    const s = server({
      session: () => answerOf([CMD, { ...FAILED, dismissed }]),
      posted: () => {
        dismissed = false;
        return { ok: true };
      },
    });
    const { body, view } = await drawn(chatOf("undo"), s);
    const before = s.times("/sessions/chain-undo?open=fresh");
    press(one(cardOf(body), "pv-open-gone"), "Undo").dispatch("click");
    assert.ok(press(one(cardOf(body), "pv-open-gone"), "Undoing…")?.attrs.disabled !== undefined, "pressed once, it waits");
    await settle();
    await settle();
    const post = s.asked.find((a) => a.init?.method === "POST");
    assert.deepEqual([post?.path, post?.init.body], ["/sessions/chain-undo/open/undismiss", { key: "agent:sa_4:failed" }]);
    assert.equal(s.times("/sessions/chain-undo?open=fresh"), before + 1, "the session read again");
    await settle();
    view.paint();
    const card = cardOf(body);
    assert.equal(one(card, "pv-open-gone"), undefined, "nothing dismissed now");
    assert.equal(textOf(one(card, "pv-open-head")), "Still open|1 waiting|1 running");
  });

  test("a refused Undo says why in an error toast, and gives the button back; nothing live or left: the head counts what was dismissed, the body says the agent dismissed it", async () => {
    const s = server({
      session: () => answerOf([FAILED]),
      posted: () => { throw new Error("no such item: agent:sa_4:failed"); },
    });
    const { body } = await drawn(chatOf("refused"), s);
    assert.equal(textOf(one(cardOf(body), "pv-open-head")), "Still open|1 dismissed");
    assert.equal(textOf(one(cardOf(body), "pv-open-empty")), "Nothing is waiting or running that the agent still hears of. It dismissed one line, below.");
    press(one(cardOf(body), "pv-open-gone"), "Undo").dispatch("click");
    await settle();
    await settle();
    assert.deepEqual(toasts().at(-1), ["Undo: no such item: agent:sa_4:failed", "zc-toast err"]);
    assert.equal(press(one(cardOf(body), "pv-open-gone"), "Undo")?.attrs.disabled, undefined, "pressable again");
  });

  // (fails before: yes — the review of 11-09: the card drew the agent's lines, cut at the most of a kind)
  test(`past the most of a kind, every item is a row of its own and counted: the agent's "and N more" is its alone`, async () => {
    const thirteen = Array.from({ length: 13 }, (_, i) => ({ ...CMD, key: `command:bg_${i}`, view: v("running", "run", `job ${i}`, "Background command, running 3 min · in proj") }));
    const s = server({ session: () => ({ inForce: { graph: null, goal: null }, open: { lines: [...thirteen.slice(0, 12).map((i) => `- ${i.line}`), "- and 1 more background commands: bg_12"], told: true, items: thirteen } }) });
    const { body } = await drawn(chatOf("many"), s);
    const card = cardOf(body);
    assert.equal(textOf(one(card, "pv-open-head")), "Still open|13 running");
    assert.equal(byClass(card, "pv-open-row").length, 13);
    assert.doesNotMatch(textOf(card), /and 1 more/);
  });

  test("an answer from before 11-10 — items with no view, or lines alone — draws each line as a row's title, among what runs", async () => {
    const items = await drawn(chatOf("noview"), server({ session: () => ({ inForce: { graph: null, goal: null }, open: { lines: ["- a line"], told: true, items: [{ key: "k", line: "a line", dismissed: false }] } }) }));
    assert.deepEqual(rowsOf(cardOf(items.body)), [["a line", "", ""]]);
    const lines = await drawn(chatOf("lines"), server({ session: () => ({ inForce: { graph: null, goal: null }, open: { lines: ["- one", "- two"], told: true } }) }));
    assert.equal(textOf(one(cardOf(lines.body), "pv-open-head")), "Still open|2 running");
    assert.deepEqual(rowsOf(cardOf(lines.body)).map((r) => r[0]), ["one", "two"]);
  });
});

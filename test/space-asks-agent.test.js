// @ts-check
// E42 AS5, SA-D7 (HarnessV4_AgentsSpace_Plan cases 4, 20, 21, 21a, 21b, 21c): an agent asks the person for a press that
// is theirs — Keep a dashboard's newest version, Switch on a proposed routine, Resume a paused dashboard, routine or
// Pause all, or Tell some of the project's chats its words —, each checked as it stands now and refused in words, "Not
// asked: …"; never Put back. A row of Needs you, after the chats' live asks and before drafts, its title the press in its
// sheet's words and the asker's reason under it; one per thing and chat — asked again, its old row opens again. It goes
// by itself once its press is done, there or anywhere, or once its thing moves under it (a line in What happened); Turn
// down is the person's no, which Bring back undoes; its own chat takes it back, another chat's done is refused. A Tell
// is told by a send that carries its words: each chat reads them as the asker's, never as the person's.
// Switched off for the chat (case 22), each new action is refused as a read is.
// (fails before: yes — an agent could not ask for any of the person's presses: it could only say so in its answer)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASK_LIMITS, askKey, askPress, askTitle, momentWords, needsWords } from "../src/core/space.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createSpaceSync } from "../src/app/space-sync.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { SPACE_SWITCHED_OFF, spaceCall, spaceGuide, spaceRun } from "../src/app/agent/space.js";
import { askButton, askEnded, askLine, needGroups, turnDownTitle } from "../src/ui/harness/lib/space-view.js";
import { needRows } from "../src/ui/harness/space/needs-rows.js";
import { syncCard } from "../src/ui/harness/space/sync-card.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { removeDirs, until } from "./helpers/wait.js";

const dirs = /** @type {string[]} */ ([]);
after(() => removeDirs(...dirs));
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), "filament-saa-"));
  dirs.push(d);
  return d;
};

/** Monday 26 October 2026, local. @param {number} h @param {number} [m] */
const at = (h, m = 0) => new Date(2026, 9, 26, h, m).getTime();
const FIELDS = { title: "Morning brief", when: "weekdays 09:00", task: "Read the open PRs and CI; say what needs the person.", writes: false };
const NAMES = /** @type {Record<string, string>} */ ({ c1: "Release", c2: "Deploy fixer", c3: "Billing api", c4: "Docs" });
const nameOf = (/** @type {string} */ c) => NAMES[c] || c;
const CALLS_ASK = '{"action":"needs","with":{"ask":"keep","dashboard":"deploys","why":"v3 reads the deploys of both regions"}}';
/** @param {any} r */
const words = (r) => (r.ok ? r.text : r.error);
const ask = (/** @type {Record<string, any>} */ w) => ({ action: "needs", with: w });

/**
 * A Space with Deploys kept at v2 of v3, CI a draft, Morning brief proposed; the dashboards' runner a stand-in that
 * shows them as they are set, and settles as the runner does.
 */
function worldOf({ dir = /** @type {string | null} */ (null) } = {}) {
  const clock = { at: at(9) };
  const spaces = createSpaceStore({ dir, now: () => clock.at });
  const boards = [
    { name: "deploys", title: "Deploys", state: "kept", v: 3, keptV: /** @type {number | null} */ (2), paused: false },
    { name: "ci", title: "CI", state: "draft", v: 1, keptV: /** @type {number | null} */ (null), paused: false },
  ];
  const dashboards = /** @type {any} */ ({ shown: () => boards, asksSettle: (/** @type {string} */ p) => spaces.asksSettle(p, boards) });
  spaces.routinePropose("p1", FIELDS, { chain: "c1", byName: "Release", model: "m" });
  let chats = Object.entries(NAMES).map(([chain, name]) => ({ chain, name }));
  /** Where a chat's call stands. @param {Record<string, any>} [o] @returns {import("../src/app/agent/space.js").SpaceAt} */
  const atOf = (o = {}) => ({ store: spaces, project: "p1", chain: "c2", name: null, nameOf, on: () => true, dashboards, chatsOf: () => chats, ...o });
  const rows = () => spaces.get("p1").needs.filter((n) => n.kind === "ask");
  const last = () => spaces.get("p1").log.at(-1);
  /** The needs read, as a chat calls it: its asks settled first. @param {string} [chain] */
  const read = (chain = "c2") => words(spaceCall(ask({}), atOf({ chain }), clock.at));
  return { clock, spaces, boards, atOf, rows, last, read, setChats: (/** @type {typeof chats} */ c) => (chats = c) };
}
const KEEP = { ask: "keep", dashboard: "deploys", why: "v3 reads the deploys of both regions" };

describe("an ask for Keep (case 20)", () => {
  test("a row of Needs you, its title the press, the asker and its reason; What happened says so; nothing is kept", () => {
    const w = worldOf();
    const r = spaceCall(ask(KEEP), w.atOf(), w.clock.at);
    const n = w.rows()[0];
    assert.equal(words(r), `${n.id} “Keep v3 of “Deploys”?” waits in the person's Needs you, with your reason under it: nothing happens until they press it. It goes by itself once it is pressed, there or anywhere, or once a newer version comes; {"action":"needs","with":{"id":"${n.id}","discard":true}} takes it back.`);
    assert.deepEqual(
      { kind: n.kind, text: n.text, dashboard: n.dashboard, title: n.title, state: n.state, ask: n.ask },
      { kind: "ask", text: "Keep v3 of “Deploys”?", dashboard: "deploys", title: "Deploys", state: "open", ask: { what: "keep", chain: "c2", byName: "Deploy fixer", why: "v3 reads the deploys of both regions", dashboard: "deploys", v: 3 } },
    );
    assert.deepEqual([w.last()?.by, w.last()?.text], [{ kind: "agent", chain: "c2" }, "Asks you to keep v3 of “Deploys”: v3 reads the deploys of both regions"]);
    assert.equal(w.boards[0].keptV, 2, "nothing kept");
    // By its title too; a first draft's reads "Keep “CI”?".
    const ci = spaceCall(ask({ ask: "keep", dashboard: "CI", why: "it reads CI" }), w.atOf(), w.clock.at);
    assert.equal(ci.ok, true, words(ci));
    assert.deepEqual([w.rows()[1].text, w.rows()[1].ask?.first], ["Keep “CI”?", true]);
  });

  test("kept, there or anywhere: to Done today by itself, \"kept\", no Bring back — the person's keep has its own line", () => {
    const w = worldOf();
    spaceCall(ask(KEEP), w.atOf(), w.clock.at);
    const id = w.rows()[0].id;
    const lines = w.spaces.get("p1").log.length;
    w.boards[0].keptV = 3;
    w.clock.at = at(9, 30);
    const read = w.read();
    assert.deepEqual([w.rows()[0].state, w.rows()[0].ask?.ended, w.rows()[0].doneAt], ["done", "kept", at(9, 30)]);
    assert.equal(w.spaces.get("p1").log.length, lines, "no line of its own");
    assert.ok(read.includes(`Done in the last two days: ${id} “Keep v3 of “Deploys”?”, kept by the person.`), read);
    assert.deepEqual(askEnded(/** @type {any} */ (w.rows()[0])), { words: "kept", back: false, title: "It was kept: pause or remove it from its tab's ⋯" });
    assert.throws(() => w.spaces.needChange("p1", id, { back: true }), { status: 409, message: "It was kept: its way back is the thing's own." });
  });

  test("v4 comes: it goes by itself, \"v4 came\", a line in What happened by Filament; taken out of the Space, the same", () => {
    const w = worldOf();
    spaceCall(ask(KEEP), w.atOf(), w.clock.at);
    const id = w.rows()[0].id;
    w.boards[0].v = 4;
    const read = w.read("c3");
    assert.deepEqual([w.rows()[0].state, w.rows()[0].ask?.ended, w.rows()[0].ask?.moved], ["done", "moved", "v4 came"]);
    assert.deepEqual([w.last()?.by, w.last()?.text], [{ kind: "filament" }, "Deploy fixer's ask to keep v3 of “Deploys” went by itself: v4 came."]);
    assert.ok(read.includes(`${id} “Keep v3 of “Deploys”?”, gone by itself: v4 came.`), read);
    assert.deepEqual(askEnded(/** @type {any} */ (w.rows()[0])), { words: "v4 came", back: false, title: "It went by itself: its chat asks again if it is still wanted" });
    assert.throws(() => w.spaces.needChange("p1", id, { back: true }), { status: 409, message: "It went by itself: v4 came. Ask its chat again if it is still wanted." });
    // A second, of CI, whose dashboard is taken out.
    spaceCall(ask({ ask: "keep", dashboard: "ci", why: "it reads CI" }), w.atOf(), w.clock.at);
    w.boards.splice(1, 1);
    w.read();
    assert.deepEqual([w.rows()[1].ask?.ended, w.rows()[1].ask?.moved], ["moved", "it was taken out of the Space"]);
  });

  test("with no dashboards' runner wired, an ask about a dashboard is let be; the store's own settle needs them", () => {
    const w = worldOf();
    spaceCall(ask(KEEP), w.atOf(), w.clock.at);
    w.boards[0].keptV = 3;
    assert.deepEqual(w.spaces.asksSettle("p1"), []);
    assert.equal(w.rows()[0].state, "open");
    assert.deepEqual(w.spaces.asksSettle("p1", w.boards).map((n) => n.ask?.ended), ["kept"]);
  });
});

describe("asking again, taking back, another chat's (cases 21, 4)", () => {
  test("the same chat asks again for the same thing: its old row opens again, with the new reason; another chat's is its own", () => {
    const w = worldOf();
    spaceCall(ask(KEEP), w.atOf(), w.clock.at);
    const id = w.rows()[0].id;
    w.clock.at = at(10);
    const again = spaceCall(ask({ ...KEEP, why: "v3 fixes the region filter too" }), w.atOf(), w.clock.at);
    assert.ok(words(again).startsWith(`${id} “Keep v3 of “Deploys”?” is open again in the person's Needs you`), words(again));
    assert.deepEqual([w.rows().length, w.rows()[0].id, w.rows()[0].ask?.why, w.rows()[0].at], [1, id, "v3 fixes the region filter too", at(10)]);
    // Turned down, then asked again: open again, its end forgotten.
    w.spaces.needChange("p1", id, { turnDown: true });
    spaceCall(ask(KEEP), w.atOf(), w.clock.at);
    assert.deepEqual([w.rows().length, w.rows()[0].state, w.rows()[0].ask?.ended], [1, "open", undefined]);
    spaceCall(ask(KEEP), w.atOf({ chain: "c3" }), w.clock.at);
    assert.deepEqual(w.rows().map((n) => n.ask?.chain), ["c2", "c3"], "one per thing and chat");
  });

  test("its own chat takes it back; another chat's done or discard is refused; its own done says how it goes", () => {
    const w = worldOf();
    spaceCall(ask(KEEP), w.atOf(), w.clock.at);
    const id = w.rows()[0].id;
    const theirs = `Not changed: ${id} is Deploy fixer's ask: the person answers it, or Deploy fixer takes it back.`;
    assert.equal(words(spaceCall(ask({ id, done: "kept it" }), w.atOf({ chain: "c3" }), w.clock.at)), theirs);
    assert.equal(words(spaceCall(ask({ id, discard: true }), w.atOf({ chain: "c3" }), w.clock.at)), theirs);
    assert.equal(words(spaceCall(ask({ id, done: "kept it" }), w.atOf(), w.clock.at)),
      `Not changed: ${id} is your ask: the person answers it with its press, or turns it down — {"action":"needs","with":{"id":"${id}","discard":true}} takes it back.`);
    assert.equal(w.rows()[0].state, "open");
    assert.equal(words(spaceCall(ask({ id, discard: true }), w.atOf(), w.clock.at)), `Your ask ${id} “Keep v3 of “Deploys”?” is taken back: it is in Done today, and What happened says so.`);
    assert.deepEqual([w.rows()[0].state, w.rows()[0].ask?.ended], ["done", "taken back"]);
    assert.deepEqual([w.last()?.by, w.last()?.text], [{ kind: "agent", chain: "c2" }, "Took back its ask to keep v3 of “Deploys”."]);
    assert.equal(words(spaceCall(ask({ id, discard: true }), w.atOf(), w.clock.at)), `Not changed: ${id} is taken back already.`);
    assert.throws(() => w.spaces.needChange("p1", id, { back: true }), { status: 409, message: "Deploy fixer took it back: it asks again if it is still wanted." });
    assert.ok(w.read().includes(`${id} “Keep v3 of “Deploys”?”, taken back by you.`));
    assert.ok(w.read("c3").includes(`${id} “Keep v3 of “Deploys”?”, taken back by Deploy fixer.`));
    assert.deepEqual(askEnded(/** @type {any} */ (w.rows()[0])), { words: "took it back", back: false, title: "Its chat took it back" });
  });
});

describe("Turn down (case 21a)", () => {
  test("the person's no: Done today, \"turned down\", Bring back; What happened tells its chat; done and discard are refused", () => {
    const w = worldOf();
    spaceCall(ask(KEEP), w.atOf(), w.clock.at);
    const id = w.rows()[0].id;
    assert.throws(() => w.spaces.needChange("p1", id, { done: true }), { status: 400, message: "an ask is answered by its press, or turned down ({ turnDown: true })" });
    assert.throws(() => w.spaces.needChange("p1", id, { discard: true }), { status: 400 });
    w.spaces.needChange("p1", id, { turnDown: true });
    assert.deepEqual([w.rows()[0].state, w.rows()[0].ask?.ended], ["done", "turned down"]);
    assert.deepEqual([w.last()?.by, w.last()?.text], [{ kind: "you" }, "You turned down Deploy fixer's ask: keep v3 of “Deploys”."]);
    assert.ok(w.read().includes(`${id} “Keep v3 of “Deploys”?”, turned down by the person.`));
    assert.deepEqual(askEnded(/** @type {any} */ (w.rows()[0])), { words: "turned down", back: true, title: "" });
    assert.throws(() => w.spaces.needChange("p1", id, { turnDown: true }), { status: 409, message: "It is turned down already." });
    // Settled while turned down: it stays the person's no.
    w.boards[0].keptV = 3;
    w.read();
    assert.equal(w.rows()[0].ask?.ended, "turned down");
    w.boards[0].keptV = 2;
    w.spaces.needChange("p1", id, { back: true });
    assert.deepEqual([w.rows()[0].state, w.rows()[0].ask?.ended], ["open", undefined]);
    assert.throws(() => w.spaces.needChange("p1", "n99", { turnDown: true }), { status: 404 });
  });
});

describe("Switch on, Resume (case 21c), Tell (case 21b)", () => {
  test("Switch on a proposed routine: switched on, or removed under it", () => {
    const w = worldOf();
    const r = spaceCall(ask({ ask: "on", routine: "r1", why: "the morning brief saves you the PR sweep" }), w.atOf(), w.clock.at);
    assert.equal(r.ok, true, words(r));
    assert.equal(w.rows()[0].text, "Switch on “Morning brief”?");
    w.spaces.routineOn("p1", "r1");
    w.read();
    assert.equal(w.rows()[0].ask?.ended, "switched on");
    assert.deepEqual(askEnded(/** @type {any} */ (w.rows()[0])).title, "It was switched on: pause or remove it from Routines' ⋯");
    // A watcher switched on is paused by its row's switch, on Watchers.
    // (fails before: yes — "from Routines' ⋯" of a watcher, which is on no row of Routines)
    assert.deepEqual(askEnded(/** @type {any} */ (w.rows()[0]), true).title, "It was switched on: its switch on Watchers pauses it, its ⋯ there removes it");
    const v = worldOf();
    spaceCall(ask({ ask: "on", routine: "r1", why: "x" }), v.atOf(), v.clock.at);
    v.spaces.routineRemove("p1", "r1");
    v.read();
    assert.deepEqual([v.rows()[0].ask?.ended, v.rows()[0].ask?.moved], ["moved", "it was removed"]);
    assert.equal(v.last()?.text, "Deploy fixer's ask to switch on “Morning brief” went by itself: it was removed.");
  });

  test("Resume a dashboard, a routine, Pause all: each \"resumed\" once it runs again; its button acts at once", () => {
    const w = worldOf();
    w.boards[0].paused = true;
    assert.equal(spaceCall(ask({ ask: "resume", dashboard: "deploys", why: "the deploy key is rotated" }), w.atOf(), w.clock.at).ok, true);
    w.spaces.routineOn("p1", "r1");
    w.spaces.routinePause("p1", "r1", true);
    assert.equal(spaceCall(ask({ ask: "resume", routine: "r1", why: "CI is green again" }), w.atOf(), w.clock.at).ok, true);
    w.spaces.pauseAll(true);
    assert.equal(spaceCall(ask({ ask: "resume", all: true, why: "the key is rotated" }), w.atOf(), w.clock.at).ok, true);
    assert.deepEqual(w.rows().map((n) => n.text), ["Resume “Deploys”?", "Resume “Morning brief”?", "Resume what runs by itself?"]);
    assert.deepEqual(w.rows().map((n) => askButton(/** @type {any} */ (n))), ["Resume", "Resume", "Resume"]);
    w.read();
    assert.deepEqual(w.rows().map((n) => n.state), ["open", "open", "open"], "all still paused");
    w.boards[0].paused = false;
    w.spaces.routinePause("p1", "r1", false);
    w.spaces.pauseAll(false);
    w.read();
    assert.deepEqual(w.rows().map((n) => n.ask?.ended), ["resumed", "resumed", "resumed"]);
  });

  test("Tell: the chats it names, its words; a send that carries them tells each chat as the asker's, and the ask is told", async () => {
    const w = worldOf();
    const r = spaceCall(ask({ ask: "tell", chats: ["Billing api", "c4", "billing api", "Deploy fixer"], words: "the API returns 404 for a missing user now" }), w.atOf(), w.clock.at);
    const n = w.rows()[0];
    assert.equal(words(r), `${n.id} “Tell Billing api and Docs?” waits in the person's Needs you, with your words under it: nothing happens until they press it. It is done once their Tell them carries your words; {"action":"needs","with":{"id":"${n.id}","discard":true}} takes it back.`);
    assert.deepEqual(n.ask?.chats, [{ chain: "c3", name: "Billing api" }, { chain: "c4", name: "Docs" }], "named once, never itself");
    assert.equal(w.last()?.text, "Asks you to tell Billing api and Docs: “the API returns 404 for a missing user now”");
    assert.equal(askLine(/** @type {any} */ (n)), "Deploy fixer: “the API returns 404 for a missing user now”");
    assert.equal(askButton(/** @type {any} */ (n)), "Tell the chats…");
    assert.ok(w.read("c1").includes(`- ${n.id} · Deploy fixer's ask, for the person's press · ${momentWords(n.at)}: Tell Billing api and Docs? (the words: the API returns 404 for a missing user now)`));
    assert.equal(w.rows()[0].state, "open", "a read tells no one");
    // The person's Tell them, carrying its words.
    /** @type {[string, string][]} */
    const posts = [];
    const reach = { busy: () => false, post: async (/** @type {string} */ c, /** @type {string} */ t) => (posts.push([c, t]), { status: 200, body: { ok: true } }), steer: () => ({ ok: true }) };
    const sync = createSpaceSync({ store: w.spaces, reach, projectOf: () => "p1", nameOf, settleMs: 1, now: () => w.clock.at });
    const out = sync.run("p1", { lanes: [{ chain: "c3" }, { chain: "c4" }, { chain: "c2" }], also: "", asks: [n.id] });
    assert.equal(out.ok, true, /** @type {any} */ (out).error);
    await until(() => posts.length === 3, "sent");
    const of = (/** @type {string} */ c) => posts.find(([x]) => x === c)?.[1] || "";
    assert.ok(of("c3").includes("\nDeploy fixer asked that you be told: the API returns 404 for a missing user now"), of("c3"));
    assert.ok(!of("c3").includes("The person adds"), "never as the person's words");
    assert.ok(!of("c2").includes("asked that you be told"), "the asker reads no ask of its own");
    assert.equal(w.spaces.get("p1").log.find((e) => e.by.kind === "sync")?.text, "Told 3 chats: Billing api, Docs, Deploy fixer, with Deploy fixer's words: the API returns 404 for a missing user now.");
    // Words that end in their own stop keep it, once (seen live: "once CI is green..").
    const ends = spaceCall(ask({ ask: "tell", chats: ["Docs"], words: "Redeploy once CI is green." }), w.atOf(), w.clock.at);
    assert.equal(ends.ok, true, words(ends));
    sync.run("p1", { lanes: [{ chain: "c4" }], asks: [w.rows().at(-1)?.id || ""] });
    assert.equal(w.spaces.get("p1").log.filter((e) => e.by.kind === "sync").at(-1)?.text, "Told 1 chat: Docs, with Deploy fixer's words: Redeploy once CI is green.");
    assert.deepEqual([w.rows()[0].state, w.rows()[0].ask?.ended], ["done", "told"]);
    assert.deepEqual(askEnded(/** @type {any} */ (w.rows()[0])), { words: "told", back: false, title: "What was told stays told" });
    // Told already: a second send carrying it is refused, nothing kept.
    const syncs = w.spaces.get("p1").syncs.length;
    assert.deepEqual(sync.run("p1", { lanes: [{ chain: "c3" }], asks: [n.id] }), { ok: false, error: `${n.id} is no open ask to tell the chats in this Space.` });
    assert.deepEqual(sync.run("p1", { lanes: [{ chain: "c3" }], asks: ["n99"] }), { ok: false, error: "n99 is no open ask to tell the chats in this Space." });
    assert.equal(w.spaces.get("p1").syncs.length, syncs);
  });
});

describe("refused in words, \"Not asked: …\"", () => {
  test("never Put back; a press that is none; no why; too long; as each thing stands now", () => {
    const w = worldOf();
    const no = (/** @type {Record<string, any>} */ x, /** @type {Record<string, any>} */ o = {}) => words(spaceCall(ask(x), w.atOf(o), w.clock.at));
    assert.equal(no({ ask: "put back", dashboard: "deploys", why: "x" }), "Not asked: putting back what was taken out is the person's, and an agent takes nothing out: there is nothing to ask for.");
    assert.equal(no({ ask: "launch", why: "x" }), `Not asked: an ask is for one of the person's presses — keep, on, resume or tell; "launch" is none of them. ${CALLS_ASK}`);
    assert.equal(no({ ask: "keep", dashboard: "deploys" }), `Not asked: say why, in a line ("why"): it is under the ask, for the person. ${CALLS_ASK}`);
    assert.equal(no({ ask: "tell", chats: ["Docs"] }), 'Not asked: say what to tell them, in "words".');
    assert.equal(no({ ...KEEP, why: "x".repeat(ASK_LIMITS.why + 1) }), `Not asked: "why" is 300 characters at most; this is 301.`);
    assert.equal(no({ ask: "tell", chats: ["Docs"], words: "x".repeat(ASK_LIMITS.words + 1) }), `Not asked: "words" is 1000 characters at most; this is 1001.`);
    // Keep.
    assert.equal(no({ ...KEEP, v: 2 }), `Not asked: “Deploys”'s newest version is v3: an ask keeps the newest — leave "v" out, or ask for v3.`);
    assert.equal(no({ ...KEEP, dashboard: "nope" }), 'Not asked: there is no dashboard "nope" in this Space: {"action":"dashboard"} lists them.');
    assert.equal(no(KEEP, { dashboards: null }), "Not asked: the dashboards are not wired in this Filament.");
    w.boards[0].keptV = 3;
    assert.equal(no(KEEP), "Not asked: v3 of “Deploys” is kept already.");
    // Switch on.
    assert.equal(no({ ask: "on", routine: "r9", why: "x" }), 'Not asked: there is no routine "r9" in this Space: the board\'s read lists them.');
    assert.equal(no({ ask: "resume", routine: "r1", why: "x" }), "Not asked: “Morning brief” is not paused.");
    w.spaces.routineOn("p1", "r1");
    assert.equal(no({ ask: "on", routine: "r1", why: "x" }), "Not asked: “Morning brief” is on already.");
    w.spaces.routineRemove("p1", "r1");
    assert.equal(no({ ask: "on", routine: "r1", why: "x" }), "Not asked: “Morning brief” was removed: putting it back is the person's.");
    // Resume.
    assert.equal(no({ ask: "resume", dashboard: "deploys", why: "x" }), "Not asked: “Deploys” is not paused.");
    assert.equal(no({ ask: "resume", dashboard: "ci", why: "x" }), "Not asked: “CI” is a draft: nothing of it runs to resume.");
    assert.equal(no({ ask: "resume", all: true, why: "x" }), "Not asked: Pause all is not on.");
    assert.equal(no({ ask: "resume", why: "x" }), 'Not asked: name what to resume: "dashboard", "routine", or "all":true for Pause all.');
    // Tell.
    assert.equal(no({ ask: "tell", chats: ["Ops"], words: "x" }), "Not asked: “Ops” is no chat of this project; its chats: Release, Deploy fixer, Billing api, Docs.");
    assert.equal(no({ ask: "tell", chats: ["Deploy fixer"], words: "x" }), 'Not asked: name the chats to tell, in "chats": their names as the lanes give them.');
    w.setChats(Array.from({ length: ASK_LIMITS.chats + 2 }, (_, i) => ({ chain: `x${i}`, name: `Chat ${i}` })));
    assert.equal(no({ ask: "tell", chats: Array.from({ length: ASK_LIMITS.chats + 1 }, (_, i) => `x${i}`), words: "x" }), "Not asked: one ask tells 20 chats at most.");
    assert.equal(w.rows().length, 0, "nothing asked");
  });
});

describe("its words, its order, its file", () => {
  test("its title in its sheet's words; its press as a line says it; its key, one per thing", () => {
    const base = { chain: "c2", byName: "Deploy fixer", why: "x" };
    assert.equal(askTitle({ ...base, what: "keep", dashboard: "deploys", v: 3 }, "Deploys"), "Keep v3 of “Deploys”?");
    assert.equal(askTitle({ ...base, what: "keep", dashboard: "deploys", v: 1, first: true }, "Deploys"), "Keep “Deploys”?");
    assert.equal(askTitle({ ...base, what: "on", routine: "r4" }, "Weekly deps"), "Switch on “Weekly deps”?");
    assert.equal(askTitle({ ...base, what: "resume", dashboard: "deploys" }, "Deploys"), "Resume “Deploys”?");
    assert.equal(askTitle({ ...base, what: "resume", all: true }, ""), "Resume what runs by itself?");
    const chats = (/** @type {number} */ k) => ["Billing api", "Docs", "Release", "Ops"].slice(0, k).map((name, i) => ({ chain: `c${i}`, name }));
    assert.deepEqual([1, 2, 3, 4].map((k) => askTitle({ ...base, what: "tell", chats: chats(k) }, "")), ["Tell Billing api?", "Tell Billing api and Docs?", "Tell Billing api, Docs and Release?", "Tell the other chats?"]);
    assert.equal(askPress("Keep v3 of “Deploys”?"), "keep v3 of “Deploys”");
    assert.deepEqual([askKey({ what: "keep", dashboard: "deploys" }), askKey({ what: "resume", all: true }), askKey({ what: "tell" })], ["keep|deploys", "resume|*", "tell|"]);
    assert.equal(turnDownTitle(/** @type {any} */ ({ ask: { byName: "Deploy fixer" } })), "Say no: What happened tells Deploy fixer; Bring back in Done today undoes it.");
  });

  test("an agent's read: its own and another chat's, its reason; where every open row is an ask, how one is taken back", () => {
    const w = worldOf();
    spaceCall(ask(KEEP), w.atOf(), w.clock.at);
    const n = w.rows()[0];
    const mine = w.read();
    assert.ok(mine.includes(`- ${n.id} · your ask, for the person's press · ${momentWords(n.at)}: Keep v3 of “Deploys”? (why: v3 reads the deploys of both regions)`), mine);
    assert.ok(mine.endsWith(`\nEach open row is an ask: the person answers it with its press. {"action":"needs","with":{"id":"${n.id}","discard":true}} takes back one of yours.`), mine);
    assert.ok(w.read("c3").includes(`- ${n.id} · Deploy fixer's ask, for the person's press ·`));
    assert.ok(spaceGuide("needs").ok && /** @type {any} */ (spaceGuide("needs")).text.includes(`- ${CALLS_ASK}: asks the person for a press that is theirs`));
  });

  test("after the chats' live asks, before drafts, what fails and what a watch brought", () => {
    const row = (/** @type {string} */ id, /** @type {string} */ kind, /** @type {number} */ t) => /** @type {any} */ ({ id, kind, text: id, why: "", dashboard: "", title: "", at: t, state: "open" });
    const g = needGroups([row("w", "watch", 5), row("d", "draft", 4), row("s", "source", 3), row("a", "ask", 1), row("b", "ask", 2)], 10);
    assert.deepEqual(g.open.map((n) => n.id), ["b", "a", "d", "s", "w"]);
  });

  test("kept across a restart: an open one as it was asked, a done one with its end; one that does not read as an ask is dropped", () => {
    const dir = fresh();
    const w = worldOf({ dir });
    spaceCall(ask(KEEP), w.atOf(), w.clock.at);
    spaceCall(ask({ ask: "resume", all: true, why: "x" }), w.atOf(), w.clock.at);
    w.spaces.pauseAll(true);
    spaceCall(ask({ ask: "resume", all: true, why: "the key is rotated" }), w.atOf(), w.clock.at);
    w.boards[0].v = 4;
    w.read();
    const file = join(dir, readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_"))[0]);
    const raw = JSON.parse(readFileSync(file, "utf8"));
    raw.needs.push(
      { id: "n90", kind: "ask", text: "Keep?", dashboard: "deploys", title: "Deploys", at: 1, state: "open", ask: { what: "keep", chain: "c2", why: "x", dashboard: "deploys" } },
      { id: "n91", kind: "ask", text: "Tell?", dashboard: "", title: "", at: 1, state: "open", ask: { what: "tell", chain: "c2", why: "x", chats: [] } },
      { id: "n92", kind: "ask", text: "Resume?", dashboard: "", title: "", at: 1, state: "open", ask: { what: "resume", chain: "c2", why: "x", all: true, ended: "kept" } },
      { id: "n93", kind: "watch", text: "Deploy failed", dashboard: "deploys", title: "Deploys", at: 1, state: "open" },
    );
    writeFileSync(file, JSON.stringify(raw));
    const again = createSpaceStore({ dir, now: () => w.clock.at });
    const asks = again.get("p1").needs.filter((n) => n.kind === "ask");
    assert.deepEqual(asks.map((n) => [n.id, n.state, n.ask?.ended, n.ask?.moved]), [
      [w.rows()[0].id, "done", "moved", "v4 came"],
      [w.rows()[1].id, "open", undefined, undefined],
      ["n92", "open", undefined, undefined],
    ], "a keep with no version and a tell with no chats are dropped; an open one keeps no end");
    assert.deepEqual(asks[1].ask, { what: "resume", chain: "c2", byName: "Deploy fixer", why: "the key is rotated", all: true });
    assert.throws(() => again.needChange("p1", "n93", { turnDown: true }), { status: 400, message: "only an ask is turned down: a row is done ({ done: true })" });
  });
});

describe("a coding agent's call (case 23)", () => {
  test("its ask and its take back over the agent tools, as Filament's loop gives them", async () => {
    const w = worldOf();
    const at = w.atOf();
    const tools = createAgentTools(/** @type {any} */ ({
      memory: null, memoryToolsOn: () => false, graphs: () => null, turns: { get: () => null }, subagents: () => null, membersOf: () => null,
      space: { store: w.spaces, projectOf: () => "p1", nameOf, on: () => true, dashboards: at.dashboards, chatsOf: at.chatsOf, runOf: () => null },
    }));
    const ctx = /** @type {any} */ ({ cwd: "/r", chain: "c2", permit: null });
    const r = await tools.call("space", ask({ ask: "tell", chats: ["Docs"], words: "the API returns 404 now" }), ctx);
    assert.equal(r.isError, undefined, r.text);
    assert.equal(w.rows()[0].text, "Tell Docs?");
    assert.deepEqual(await tools.call("space", ask({ ask: "put back", why: "x" }), ctx), { text: "Not asked: putting back what was taken out is the person's, and an agent takes nothing out: there is nothing to ask for.", isError: true });
    const back = await tools.call("space", ask({ id: w.rows()[0].id, discard: true }), ctx);
    assert.match(back.text, /^Your ask n\d+ “Tell Docs\?” is taken back/);
  });
});

describe("switched off for the chat (case 22)", () => {
  test("every new action is refused in words, as a read is, and nothing is asked or changed", async () => {
    const w = worldOf();
    const off = w.atOf({ on: () => false });
    const calls = [ask({}), ask(KEEP), ask({ id: "n1", done: "x" }), { action: "dashboard" }, { action: "lanes" }, { action: "routine", with: { id: "r1", pause: "x" } }, { action: "routine", with: { id: "r1", run: true } }, { action: "routine", with: { pauseAll: "x" } }];
    for (const c of calls) assert.deepEqual(await spaceRun(c, off, w.clock.at), { ok: false, error: SPACE_SWITCHED_OFF }, JSON.stringify(c));
    assert.deepEqual([w.rows().length, w.spaces.pausedSince(), w.spaces.get("p1").routines[0].paused ?? false], [0, null, false]);
  });
});

describe("on the page", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  const g = /** @type {any} */ (globalThis);
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
    HTMLElement: class {},
  };
  before(() => {
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
    g.window.setTimeout = () => 0;
  });
  after(() => {
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
  });
  const NOW = at(15, 6);
  /** @param {Record<string, any>} a @param {Record<string, any>} [o] @returns {any} */
  const askRow = (a, o = {}) => ({ id: "n4", kind: "ask", text: "Keep v3 of “Deploys”?", why: "", dashboard: a.dashboard || "", title: "Deploys", at: NOW - 5 * 60_000, state: "open", ask: { chain: "c2", byName: "Deploy fixer", why: "v3 reads both regions", ...a }, ...o });
  const mountRows = () => {
    const did = { posts: /** @type {any[]} */ ([]), keeps: /** @type {string[]} */ ([]), ons: /** @type {string[]} */ ([]), tells: /** @type {string[]} */ ([]), tabs: /** @type {any[]} */ ([]) };
    const rows = needRows({
      place: () => ({ id: "p1", name: "app", cwd: "/w", dashboards: [{ name: "deploys", title: "Deploys", paused: false, state: "kept" }] }),
      openTab: (p, name) => void did.tabs.push([p, name]),
      post: async (p, path, body) => (did.posts.push([p, path, body]), {}),
      keep: (n) => void did.keeps.push(n.id),
      switchOn: (n) => void did.ons.push(n.id),
      tell: (n) => void did.tells.push(n.id),
    });
    return { rows, did };
  };
  /** @param {any} el */
  const acts = (el) => el.querySelector(".sp-need-acts").querySelectorAll("button").map((/** @type {any} */ b) => b.textContent);
  /** @param {any} el @param {string} label */
  const press = (el, label) => {
    const b = el.querySelector(".sp-need-acts").querySelectorAll("button").find((/** @type {any} */ x) => x.textContent === label);
    assert.ok(b, `the button ${label}`);
    b.dispatch("click");
  };

  test("an ask's row: its press as its title, the asker and reason, its chip; Keep…, Not now, Turn down — a word, not ✓", () => {
    const { rows, did } = mountRows();
    const el = /** @type {any} */ (rows.row(askRow({ what: "keep", dashboard: "deploys", v: 3 }), NOW));
    assert.equal(el.getAttribute("class"), "sp-need is-out is-ask");
    assert.deepEqual([el.querySelector(".sp-need-t").textContent, el.querySelector(".sp-need-line").textContent], ["Keep v3 of “Deploys”?", "Deploy fixer: v3 reads both regions"]);
    assert.deepEqual(acts(el), ["Keep…", "Not now", "Turn down"]);
    press(el, "Keep…");
    assert.deepEqual(did.keeps, ["n4"], "its sheet, where this page has it");
    press(el, "Turn down");
    assert.deepEqual(did.posts, [["p1", "/needs/n4", { turnDown: true }]]);
    assert.equal(el.querySelector(".sp-need-turn").getAttribute("title"), "Say no: What happened tells Deploy fixer; Bring back in Done today undoes it.");
  });

  test("Resume acts at once — no sheet —, Switch on… and Tell the chats… open theirs", () => {
    const { rows, did } = mountRows();
    press(rows.row(askRow({ what: "resume", dashboard: "deploys" }, { text: "Resume “Deploys”?" }), NOW), "Resume");
    press(rows.row(askRow({ what: "resume", routine: "r1" }, { text: "Resume “Morning brief”?", title: "Morning brief" }), NOW), "Resume");
    assert.deepEqual(did.posts, [["p1", "/dashboards/deploys/pause", { paused: false }], ["p1", "/routines/r1/pause", { paused: false }]]);
    press(rows.row(askRow({ what: "on", routine: "r1" }, { id: "n5", text: "Switch on “Morning brief”?" }), NOW), "Switch on…");
    press(rows.row(askRow({ what: "tell", why: "the API returns 404", chats: [{ chain: "c3", name: "Billing api" }] }, { id: "n6", text: "Tell Billing api?" }), NOW), "Tell the chats…");
    assert.deepEqual([did.ons, did.tells], [["n5"], ["n6"]]);
    const tell = /** @type {any} */ (rows.row(askRow({ what: "tell", why: "the API returns 404", chats: [{ chain: "c3", name: "Billing api" }] }, { text: "Tell Billing api?" }), NOW));
    assert.equal(tell.querySelector(".sp-need-line").textContent, "Deploy fixer: “the API returns 404”", "its words quoted, as its chat's");
  });

  test("Done today: its chat and how it ended; Bring back only where it was turned down", () => {
    const { rows, did } = mountRows();
    const host = /** @type {any} */ (doc.document.createElement("div"));
    const kept = askRow({ what: "keep", dashboard: "deploys", v: 3, ended: "kept" }, { state: "done", doneAt: NOW });
    const no = askRow({ what: "keep", dashboard: "deploys", v: 3, ended: "turned down" }, { id: "n5", state: "done", doneAt: NOW });
    const moved = askRow({ what: "keep", dashboard: "deploys", v: 3, ended: "moved", moved: "v4 came" }, { id: "n6", state: "done", doneAt: NOW });
    host.replaceChildren(...rows.foot(host, { done: [kept, no, moved], later: [] }, NOW, { show: "done", toggle: () => {} }));
    const past = host.querySelectorAll(".sp-past").map((/** @type {any} */ e) => [e.getAttribute("data-need"), e.querySelector(".sp-past-when").textContent, e.querySelector(".sp-past-back")?.textContent || "", e.querySelector(".sp-past-when").getAttribute("title") || ""]);
    assert.deepEqual(past, [
      ["n4", "Deploy fixer · kept 15:06", "", "It was kept: pause or remove it from its tab's ⋯"],
      ["n5", "Deploy fixer · turned down 15:06", "Bring back", ""],
      ["n6", "Deploy fixer · v4 came 15:06", "", "It went by itself: its chat asks again if it is still wanted"],
    ]);
    host.querySelector('.sp-past[data-need="n5"] .sp-past-back').dispatch("click");
    assert.deepEqual(did.posts, [["p1", "/needs/n5", { back: true }]]);
  });

  test("Tell the chats card for an ask: its words quoted as its chat's, its chats ticked and no other, the asker \"it asked\"; × leaves them out", async () => {
    const CHATS = [
      { chain: "c1", name: "Release", chip: "main", main: true, works: false, lead: true },
      { chain: "c2", name: "Deploy fixer", chip: "fix", main: false, works: false, lead: true },
      { chain: "c4", name: "Docs", chip: "docs", main: false, works: false, lead: true },
      { chain: "c3", name: "Billing api", chip: "fix", main: false, works: false, lead: false },
    ];
    const mount = () => {
      const runs = /** @type {any[]} */ ([]);
      const s = syncCard({ chats: () => CHATS, last: () => null, run: async (b) => (runs.push(b), null), nameOf, now: () => NOW });
      doc.document.body.append(s.el);
      return { s, runs };
    };
    const n = askRow({ what: "tell", why: "the API returns 404 now", chats: [{ chain: "c1", name: "Release" }, { chain: "c3", name: "Billing api" }] }, { id: "n7", text: "Tell Release and Billing api?" });
    const { s, runs } = mount();
    s.open({ asks: [n] });
    assert.deepEqual(/** @type {any} */ (s.el).querySelectorAll(".sy-quote-words").map((/** @type {any} */ e) => e.textContent), ["From Deploy fixer: “the API returns 404 now”"]);
    const rows = () => /** @type {any} */ (s.el).querySelectorAll("label.sy-row").map((/** @type {any} */ r) => [r.getAttribute("data-chain"), r.querySelector("input").hasAttribute("checked"), r.querySelector(".sy-asked")?.textContent || ""]);
    assert.deepEqual(rows(), [["c1", true, ""], ["c2", false, "it asked"], ["c4", false, ""], ["c3", true, ""]], "More chats open: Billing api is under it");
    assert.equal(/** @type {any} */ (s.el).querySelector("input.sy-also").value, "", "never in Also tell them…");
    const tell = /** @type {any} */ (s.el).querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Tell them");
    tell.dispatch("click");
    await until(() => runs.length === 1, "the run");
    assert.deepEqual(runs[0], { lanes: [{ chain: "c1", when: "now" }, { chain: "c3", when: "now" }], also: "", asks: ["n7"] });
    // × leaves its words out of this send: its ask stays in Needs you.
    const other = mount();
    other.s.open({ asks: [n] });
    /** @type {any} */ (other.s.el).querySelector(".sy-quote-x").dispatch("click");
    assert.equal(/** @type {any} */ (other.s.el).querySelector(".sy-quote"), null);
    /** @type {any} */ (other.s.el).querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Tell them").dispatch("click");
    await until(() => other.runs.length === 1, "the run");
    assert.equal(other.runs[0].asks, undefined);
  });
});

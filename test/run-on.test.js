// @ts-check
// Run on (the remote desk's s2c; src/ui/harness/lib/run-on.js, conversation/empty.js): a new chat's Start says where it
// runs — this computer, one of the machines kept for this Filament's agents, or Auto, which picks the idlest one that
// has the project and says why. Its first message starts the chat there: in a clean clone at this folder's commit, or
// in a copy of this folder sent with your work, asked first; the chat named to the record, the message sent, the chat
// opened in place. A machine named that does not answer is said so, never swapped for another.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";
import { AUTO, HERE, atSend, autoPick, chipWords, cleanClone, cloneFolder, modelFor, placeFor, pointsOf, readPlaces, runOnSend, runOnStart, runOnTune, startThere, worksInFolder } from "../src/ui/harness/lib/run-on.js";
import { draftFor, keepStartWords, startKept, saveDraft } from "../src/ui/harness/state.js";

const HEAD = "a".repeat(40);
/** A machine as `places` says one. @param {Partial<import("../src/ui/harness/lib/run-on.js").Place> & { id: string }} o */
const place = (o) => ({ name: o.id, answers: true, words: null, personCopy: true, maker: null, cpus: 8, load1: 4, busy: null, memFree: 8, memTotal: 16, models: null, clones: null, ...o });
/** @param {any[]} machines @param {any} [here] @param {string | null} [last] */
const placesOf = (machines, here = { remote: "https://github.com/o/r", head: HEAD, branch: "main", dirty: true, sub: "" }, last = null) => ({ here, machines, last });

describe("Auto", () => {
  // (fails before: yes — there was no Run on)
  test("picks the idlest machine that takes a chat of yours, and says why", () => {
    const busy = place({ id: "studio", name: "Studio", load1: 7 });
    const idle = place({ id: "laptop", name: "Laptop", load1: 1 });
    const a = autoPick(placesOf([busy, idle]));
    assert.equal(a.pick?.id, "laptop");
    assert.match(a.why, /88% idle/);
    assert.match(a.why, /a copy of this folder, your work with it/);
    assert.deepEqual(chipWords(AUTO, placesOf([busy, idle])), { label: "Auto → Laptop", title: `Auto picked Laptop: ${a.why}` });
  });

  test("a clean clone at your commit outranks idleness where nothing here is uncommitted; a clone of any kind counts too", () => {
    const here = { remote: "r", head: HEAD, branch: "main", dirty: false, sub: "" };
    const cloned = place({ id: "studio", name: "Studio", load1: 6, clones: [{ path: "/w/r", head: HEAD, branch: "main", dirty: false }] });
    const idle = place({ id: "laptop", name: "Laptop", load1: 0 });
    assert.equal(autoPick(placesOf([idle, cloned], here)).pick?.id, "studio");
    assert.match(autoPick(placesOf([idle, cloned], here)).why, /a clean clone at your commit/);
    assert.ok(cleanClone(cloned, here));
    assert.equal(cleanClone(cloned, { ...here, dirty: true }), null, "work here not committed: the clone is not what you have");
    assert.equal(cleanClone(cloned, { ...here, head: "b".repeat(40) }), null, "another commit");
    assert.equal(pointsOf(place({ id: "x", clones: [{ path: "/w", head: null, branch: null, dirty: true }] }), { here }) - pointsOf(place({ id: "y" }), { here }), 2);
  });

  test("leaves out what does not answer or takes no chat of yours; counts chats at work there and a model that does not answer; a tie goes where it ran last", () => {
    const off = place({ id: "off", answers: false, load1: 0 });
    const old = place({ id: "old", personCopy: false, load1: 0 });
    const a = place({ id: "a" });
    const b = place({ id: "b" });
    assert.equal(autoPick(placesOf([off, old, a, b])).pick?.id, "a", "the list's order");
    assert.equal(autoPick(placesOf([off, old, a, b], undefined, "b")).pick?.id, "b", "where it ran last");
    assert.equal(autoPick(placesOf([a, b]), { running: new Map([["a", 3]]) }).pick?.id, "b");
    assert.equal(autoPick(placesOf([a, { ...b, models: ["other"] }]), { model: "mine" }).pick?.id, "a");
    assert.match(autoPick(placesOf([{ ...b, models: ["other"] }]), { model: "mine" }).why, /your model does not answer there/);
    assert.deepEqual(autoPick(placesOf([off])), { pick: null, why: "No machine answers now" });
    assert.match(autoPick(placesOf([old])).why, /takes a chat of yours/);
    assert.match(autoPick(placesOf([])).why, /switch Run on on/);
  });

  test("a machine named is never swapped: one that does not answer is said so", () => {
    const p = placesOf([place({ id: "studio", name: "Studio", answers: false, words: "it does not answer" }), place({ id: "laptop" })]);
    assert.deepEqual(placeFor("studio", p), { words: "Studio does not answer now (it does not answer): pick another in Run on, or This computer" });
    assert.equal(/** @type {any} */ (placeFor(AUTO, p)).place.id, "laptop");
    assert.match(/** @type {any} */ (placeFor("gone", p)).words, /no more/);
    assert.match(/** @type {any} */ (placeFor("laptop", null)).words, /could not be read/);
    assert.equal(chipWords(HERE, p).label, "This computer");
    assert.match(chipWords("studio", p).title, /does not answer now/);
  });

  test("another machine's answer is read field by field", () => {
    const r = readPlaces({
      here: { head: "nope", dirty: "yes", remote: "r\u0000x" },
      machines: [{ id: "../x" }, { id: "ok", name: "N\u0007ame", answers: true, load1: "2", clones: [{ path: "/w", head: HEAD }, { path: "" }], models: ["m", 3] }, { id: "ok" }],
      last: "elsewhere",
    });
    assert.deepEqual(r?.here, { remote: "r x", head: null, branch: null, dirty: null, sub: "" });
    assert.deepEqual(r?.machines.map((m) => [m.id, m.name, m.load1, m.clones?.length, m.models, m.maker]), [["ok", "N ame", null, 1, ["m"], null]]);
    assert.equal(r?.last, null);
    assert.equal(readPlaces({ machines: "no" }), null);
    const sub = (/** @type {unknown} */ s) => readPlaces({ here: { sub: s }, machines: [] })?.here?.sub;
    assert.deepEqual([sub("app/web"), sub("app/../x"), sub("D:/x"), sub("a\\b"), sub(3)], ["app/web", "", "", "", ""], "a folder within the repository, none a step up");
  });

  // (fails before: yes — the review of s2c: a chat started in a clean clone at its top, whatever folder of it was here,
  // and a model the machine does not have was left to its default)
  test("in a clean clone the chat starts in this folder's place in it; a model that does not answer there gives way to one that does", () => {
    assert.equal(cloneFolder({ path: "/w/r/" }, { remote: null, head: HEAD, branch: null, dirty: false, sub: "app/web" }), "/w/r/app/web");
    assert.equal(cloneFolder({ path: "D:\\src\\r" }, { remote: null, head: HEAD, branch: null, dirty: false, sub: "app/web" }), "D:\\src\\r\\app\\web");
    assert.equal(cloneFolder({ path: "/w/r" }, null), "/w/r");
    assert.equal(modelFor(place({ id: "s", models: ["a", "b"] }), "b"), "b");
    assert.equal(modelFor(place({ id: "s", models: ["a", "b"] }), "c"), "a");
    assert.equal(modelFor(place({ id: "s", models: [] }), "c"), "c", "none named — its models served by a pattern alone: the chat's own");
    assert.equal(modelFor(place({ id: "s" }), "c"), "c", "a machine that did not say: the chat's own");
    assert.doesNotMatch(autoPick(placesOf([place({ id: "s", models: [] })]), { model: "c" }).why, /model/, "nor counted against it");
  });
});

describe("the first message there", () => {
  /** What the stand-ins were asked, in order. @type {string[]} */
  let asked = [];
  /** @param {{ ask?: boolean, allow?: boolean, create?: any, turn?: any, me?: any }} [o] */
  const io = ({ ask = true, allow = true, create = { ok: true, json: { chat: "c-there" } }, turn = { ok: true }, me = { ok: true, json: { who: "device", device: "dev-1" } } } = {}) => ({
    api: async (/** @type {string} */ path, /** @type {any} */ init) => {
      asked.push(`${init?.method || "GET"} ${path}${init?.body?.allow ? ` allow=${init.body.allow.ask}` : ""}${init?.body?.chat ? ` chat=${init.body.chat}` : ""}`);
      if (path === "/remote-work" && ask && !init.body.allow) throw Object.assign(new Error("on your yes"), { status: 409, body: { ask: { id: "ask-1", machine: "Studio", project: "r" } } });
      if (path === "/remote-work") return { work: { id: "w1", cwd: "/copies/1/r" } };
      return { work: {} };
    },
    call: async (/** @type {any} */ p) => {
      asked.push(`${p.op} ${p.cwd || p.chat || p.machine}${p.model ? ` model=${p.model}` : ""}${p.mode ? ` mode=${p.mode}` : ""}`);
      return p.op === "me" ? me : p.op === "create" ? create : turn;
    },
    allow: async () => {
      asked.push("asked the person");
      return allow;
    },
    open: (/** @type {any} */ m, /** @type {string} */ chat) => void asked.push(`open ${m.id} ${chat}`),
    recorded: () => void asked.push("the desk reads its record"),
  });
  beforeEach(() => {
    asked = [];
  });

  test("Bring my work: asked, sent with your yes, the chat started in the copy, named here, the message sent, opened in place", async () => {
    const out = await runOnSend({ place: place({ id: "studio", name: "Studio", models: ["m1"], maker: "dev-1" }), here: placesOf([]).here, folder: "/w/r", text: "fix it", model: "m1", mode: "auto" }, io());
    assert.deepEqual(out, { ok: true, chat: "c-there", work: { id: "w1", cwd: "/copies/1/r" } });
    // (fails before: yes — the review of x26: the page read the records after the send, counted in its source) The desk
    // reads the record as soon as it names the chat, before the turn there can end.
    assert.deepEqual(asked, ["me studio", "POST /remote-work", "asked the person", "POST /remote-work allow=ask-1", "create /copies/1/r model=m1 mode=auto", "POST /remote-work/w1/chat chat=c-there", "the desk reads its record", "turn c-there", "open studio c-there"]);
  });

  test("a no sends nothing; a model that does not answer there gives way to one that does; a chat not started says the copy waits", async () => {
    assert.deepEqual(await runOnSend({ place: place({ id: "studio", name: "Studio" }), here: null, folder: "/w/r", text: "x" }, io({ allow: false })), { ok: false, words: "Nothing went to Studio: your message is back in the box", said: true });
    assert.deepEqual(asked, ["me studio", "POST /remote-work", "asked the person"]);
    asked = [];
    await runOnSend({ place: place({ id: "studio", models: ["other"] }), here: null, folder: "/w/r", text: "x", model: "m1" }, io({ ask: false }));
    assert.equal(asked[2], "create /copies/1/r model=other", "the first model that answers there");
    const failed = await runOnSend({ place: place({ id: "studio", name: "Studio" }), here: null, folder: "/w/r", text: "x" }, io({ ask: false, create: { ok: false, words: "Studio answered: no" } }));
    assert.deepEqual(failed, { ok: false, words: "Studio answered: no. The copy of your work waits there a quarter of an hour for a chat of yours" });
  });

  // (fails before: yes — the review of s2c: a window that is not the device the copy is placed for sent the project,
  // and the chat's start there was refused after it)
  test("a copy goes only from the device its chat starts from: a tailnet login, a tunnel or another device is told first, nothing sent", async () => {
    const studio = place({ id: "studio", name: "Studio", maker: "dev-1" });
    const tailnet = await runOnSend({ place: studio, here: null, folder: "/w/r", text: "x" }, io({ me: { ok: true, json: { who: "tailnet", device: null } } }));
    assert.match(/** @type {any} */ (tailnet).words, /by your tailnet login, not as a paired Full device.*pair Studio as Full with Add a machine/);
    const other = await runOnSend({ place: studio, here: null, folder: "/w/r", text: "x" }, io({ me: { ok: true, json: { who: "device", device: "dev-2" } } }));
    assert.match(/** @type {any} */ (other).words, /not the device that made this Filament's agents' device on Studio/);
    const away = await runOnSend({ place: studio, here: null, folder: "/w/r", text: "x" }, io({ me: { ok: false, words: "Studio did not answer" } }));
    assert.match(/** @type {any} */ (away).words, /did not say who this window is there: Studio did not answer/);
    assert.deepEqual(asked, ["me studio", "me studio", "me studio"], "nothing sent, nothing started");
  });

  test("a clean clone at your commit with nothing uncommitted here: the chat starts in it, in this folder's place, nothing sent", async () => {
    const here = { remote: "r", head: HEAD, branch: "main", dirty: false, sub: "web" };
    const out = await runOnSend({ place: place({ id: "studio", clones: [{ path: "/w/r", head: HEAD, branch: "main", dirty: false }] }), here, folder: "/w/r/web", text: "x" }, io({ me: null }));
    assert.equal(out.ok, true);
    assert.deepEqual(asked, ["create /w/r/web", "turn c-there", "open studio c-there"], "no record: its work comes back by git, not Bring back");
  });

  // (fails before: yes — the review of s2c: a message that did not go was dropped with the draft, the chat opened)
  test("a message that surely did not go: the chat there is kept for the next send, nothing opened; one whose answer never came opens it", async () => {
    const out = await runOnSend({ place: place({ id: "studio", name: "Studio" }), here: null, folder: "/w/r", text: "x" }, io({ ask: false, turn: { ok: false, words: "Studio refused it" } }));
    assert.deepEqual(out, { ok: false, words: "Your chat stands on Studio, and your message did not go: Studio refused it. Send it again to send it there, or pick another in Run on", started: { chat: "c-there", work: { id: "w1", cwd: "/copies/1/r" } } });
    assert.ok(!asked.some((a) => a.startsWith("open")));
    assert.ok(asked.includes("the desk reads its record"), "its record named: read, though the message did not go");
    asked = [];
    await runOnSend({ place: place({ id: "studio" }), here: null, folder: "/w/r", text: "x", started: { chat: "c-there", work: { id: "w1" } } }, io());
    assert.deepEqual(asked, ["the desk reads its record", "turn c-there", "open studio c-there"], "sent again in a copy's chat: its record read again");
    asked = [];
    const again = await runOnSend({ place: place({ id: "studio" }), here: null, folder: "/w/r", text: "x", started: { chat: "c-there", work: null } }, io());
    assert.deepEqual(again, { ok: true, chat: "c-there", work: null });
    assert.deepEqual(asked, ["turn c-there", "open studio c-there"], "the message alone goes to the chat that stands there");
    asked = [];
    const unsure = await runOnSend({ place: place({ id: "studio" }), here: null, folder: "/w/r", text: "x", started: { chat: "c-there", work: null } }, io({ turn: { ok: false, unsure: true, words: "Studio did not answer in time" } }));
    assert.deepEqual(unsure, { ok: true, chat: "c-there", work: null, unsure: "Studio did not answer in time" });
    assert.equal(asked.at(-1), "open studio c-there");
  });
});

describe("the page's send (startThere)", () => {
  /** What was asked, in order. @type {string[]} */
  let asked = [];
  /** The Start's one draft, as the tab keeps it. @type {Map<string, string>} */
  const kept = new Map();
  const was = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  before(() => {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)), removeItem: (/** @type {string} */ k) => void kept.delete(k) },
    });
  });
  after(() => {
    if (was) Object.defineProperty(globalThis, "sessionStorage", was);
    else delete (/** @type {any} */ (globalThis).sessionStorage);
  });
  beforeEach(() => {
    asked = [];
    kept.clear();
  });
  const studio = place({ id: "studio", name: "Studio", maker: "dev-1", load1: 7 });
  const laptop = place({ id: "laptop", name: "Laptop", maker: "dev-1", load1: 1 });
  /**
   * The page as `startThere` asks it: the machines read (`wait` holds the read), the box shown or not, what it says.
   * @param {any} chat @param {{ places?: any, shown?: boolean, wait?: Promise<void>, call?: (p: any) => Promise<any>, open?: () => void }} [o]
   */
  const page = (chat, { places = readPlaces(placesOf([studio, laptop])), shown = true, wait, call, open } = {}) => {
    const said = { refused: /** @type {string[]} */ ([]), toasts: /** @type {string[]} */ ([]) };
    const io = {
      places: async (/** @type {string} */ f) => {
        asked.push(`places ${f}`);
        await wait;
        return places;
      },
      running: () => new Map(),
      shown: () => shown,
      refuse: (/** @type {string} */ w) => (said.refused.push(w), false),
      keep: (/** @type {string} */ t) => keepStartWords(chat, t),
      toast: (/** @type {string} */ w) => void said.toasts.push(w),
      load: () => {},
      api: async (/** @type {string} */ path, /** @type {any} */ init) => {
        asked.push(`${init?.method || "GET"} ${path}${init?.body?.folder ? ` folder=${init.body.folder}` : ""}`);
        return path === "/remote-work" ? { work: { id: "w1", cwd: "/copies/1/r" } } : {};
      },
      call:
        call ||
        (async (/** @type {any} */ p) => {
          asked.push(`${p.op} ${p.cwd || p.chat || p.machine}${p.model ? ` model=${p.model}` : ""}${p.mode ? ` mode=${p.mode}` : ""}${p.tune ? ` tune=${JSON.stringify(p.tune)}` : ""}`);
          return p.op === "me" ? { ok: true, json: { who: "device", device: "dev-1" } } : p.op === "create" ? { ok: true, json: { chat: "c-there" } } : { ok: true };
        }),
      allow: async () => true,
      open: (/** @type {any} */ m, /** @type {string} */ c) => {
        asked.push(`open ${m.id} ${c}`);
        open?.();
      },
    };
    return { io, said };
  };
  const creates = () => asked.filter((a) => a.startsWith("create "));

  // (fails before: yes — the review of s2c: the mode was read from the one switch after the machines' read, so another
  // chat's Full access shown meanwhile went, and a mode nobody picked pinned this computer's over that machine's)
  test("the mode is the chat's own pick, read as the send begins; none picked, none goes", async () => {
    /** @type {() => void} */
    let release = () => {};
    const wait = new Promise((r) => (release = () => r(undefined)));
    const picked = { cwd: "/w/r", runOn: "studio", permTouched: true, pickedPerm: "auto" };
    const other = { cwd: "/w/r", permTouched: false, pickedPerm: null };
    const going = startThere(picked, { text: "fix it", folder: "/w/r", model: "" }, page(picked, { wait, shown: false }).io);
    // Meanwhile the person shows another new chat and switches it to Full access.
    Object.assign(other, { permTouched: true, pickedPerm: "full" });
    release();
    await going;
    assert.deepEqual(creates(), ["create /copies/1/r mode=auto"]);
    asked = [];
    const untouched = { cwd: "/w/r", runOn: "studio" };
    await startThere(untouched, { text: "x", folder: "/w/r", model: "" }, page(untouched).io);
    assert.deepEqual(creates(), ["create /copies/1/r"], "no mode: that machine's New chats start in holds");
    const board = { held: { "loop.permissions": "plan" } };
    assert.deepEqual(runOnStart(board, "/w/r"), { folder: "/w/r", mode: "plan" }, "the board's held mode is a pick too");
  });

  // (fails before: yes — the review of s2c: every Start shares one draft, and a refused send wrote its words over
  // another folder's; a finished one emptied it. Then the review of x21: a Start of the same folder typed in, or the
  // chat shown, wrote over them all the same)
  test("each Start keeps its own words: those that did not go never overwrite another Start's, nor are overwritten, and a finished send empties no Start", async () => {
    const g = { cwd: "/w/g" };
    saveDraft(g, "typed in G's Start");
    const f = { cwd: "/w/r", runOn: "gone" };
    saveDraft(f, ""); // its box, as the send left it
    const out = await startThere(f, { text: "fix it", folder: "/w/r", model: "" }, page(f, { shown: false }).io);
    assert.equal(out, undefined);
    assert.deepEqual(startKept(), { text: "typed in G's Start", cwd: "/w/g" }, "G's words stand, for a refresh too");
    assert.equal(draftFor(f), "fix it", "F's words wait on its chat, for its box");
    // F shown: its box saves its words — and G keeps its own, in the page.
    saveDraft(f, draftFor(f));
    assert.equal(draftFor(g), "typed in G's Start");
    // Another Start of the same folder, typed in meanwhile: each keeps its own.
    const b = { cwd: "/w/r" };
    saveDraft(f, "typed since in F");
    saveDraft(b, "B's words");
    await startThere(f, { text: "again", folder: "/w/r", model: "" }, page(f, { shown: false }).io);
    assert.equal(draftFor(f), "again\n\ntyped since in F", "above what was typed in F since");
    assert.equal(draftFor(b), "B's words");
    assert.deepEqual(startKept(), { text: "B's words", cwd: "/w/r" }, "the Start typed in last keeps the tab's words");
    // With no Start's words in the tab, a refresh finds them there too.
    kept.clear();
    const h = { cwd: "/w/r", runOn: "gone" };
    saveDraft(h, "");
    await startThere(h, { text: "only mine", folder: "/w/r", model: "" }, page(h, { shown: false }).io);
    assert.deepEqual(startKept(), { text: "only mine", cwd: "/w/r" });
    // A send that went: words typed meanwhile in a Start of the same folder stay.
    saveDraft({ cwd: "/w/r" }, "another Start's words");
    const went = { cwd: "/w/r", runOn: "studio" };
    assert.equal(await startThere(went, { text: "go", folder: "/w/r", model: "" }, page(went).io), undefined);
    assert.equal(asked.at(-1), "open studio c-there");
    assert.deepEqual(startKept(), { text: "another Start's words", cwd: "/w/r" });
    assert.equal(/** @type {any} */ (went).runOn, undefined, "the Start says This computer again");
  });

  // (fails before: yes — the review of s2c: Run on copied the Start's folder whatever Works in said, and dropped a new
  // worktree and the board's changes)
  test("Works in: another worktree is the folder that goes; a new worktree or the board's other changes are refused in words", async () => {
    const lane = { cwd: "/w/r", runOn: "studio", worksIn: { folder: "/w/r", path: "/w/r-lane", cwd: "/w/r-lane/web", name: "lane" } };
    await startThere(lane, { text: "x", folder: "/w/r", model: "" }, page(lane).io);
    assert.deepEqual(asked.slice(0, 3), ["places /w/r-lane/web", "me studio", "POST /remote-work folder=/w/r-lane/web"]);
    assert.equal(worksInFolder(lane.worksIn, "/w/r"), "/w/r-lane/web", "the chip reads that folder's machines too");
    for (const [chat, words] of /** @type {[any, RegExp][]} */ ([
      [{ cwd: "/w/r", runOn: "studio", worksIn: { folder: "/w/r", make: true, name: "fix-it" } }, /a new worktree is made on this computer alone/],
      [{ cwd: "/w/r", runOn: "studio", held: { "model.effort": "high", "loop.maxRounds": 5 } }, /holds another change to its settings: reset it, or run the chat on This computer/],
      // (fails before: yes — the review of x21: a chat handed from a Space went, and its Space never heard)
      [{ cwd: "/w/r", runOn: "studio", from: { space: "p-1" } }, /A chat handed from a Space runs on this computer/],
    ])) {
      asked = [];
      const { io, said } = page(chat);
      assert.equal(await startThere(chat, { text: "x", folder: "/w/r", model: "" }, io), false);
      assert.deepEqual(asked, [], "nothing read, nothing sent");
      assert.match(said.refused[0], words);
    }
  });

  // (fails before: yes — the review of x21: the composer's effort and tuning were dropped without a word)
  test("the composer's effort and tuning go with the chat there", async () => {
    const tune = runOnTune("high", { "model.fast": true, "model.window": 1_000_000, "model.thinking.budget": 16000, "model.other": 1 });
    assert.deepEqual(tune, { effort: "high", fast: true, window: 1_000_000, thinking: 16000 });
    assert.deepEqual(runOnTune("", {}), {});
    // The Start board's held effort and tuning go too, over the composer's, as a send here; its others are refused.
    assert.deepEqual(runOnTune("high", { "model.fast": true }, { "model.effort": "low", "model.window": 200_000, "loop.permissions": "auto" }), { effort: "low", fast: true, window: 200_000 });
    assert.deepEqual(runOnStart({ held: { "model.effort": "low", "model.fast": true, "loop.permissions": "auto" } }, "/w/r"), { folder: "/w/r", mode: "auto" });
    const chat = { cwd: "/w/r", runOn: "studio" };
    await startThere(chat, { text: "x", folder: "/w/r", model: "", tune }, page(chat).io);
    assert.deepEqual(creates(), [`create /copies/1/r tune=${JSON.stringify(tune)}`]);
  });

  // (fails before: yes — the review of s2c: the chip named one machine and the send went to another, a toast alone said;
  // then the review of x21: a fresh read that scored another a little higher refused send after send)
  test("Auto holds the machine its chip named while it takes the chat; one that no longer does is said, nothing goes, and the chip names the new pick", async () => {
    const chat = { cwd: "/w/r", runOn: AUTO, runOnSaw: "studio" };
    const p = readPlaces(placesOf([studio, laptop]));
    assert.equal(chipWords(AUTO, p, { held: "studio" }).label, "Auto → Studio", "though Laptop is idler now");
    assert.equal(autoPick(p).pick?.id, "laptop");
    await startThere(chat, { text: "x", folder: "/w/r", model: "" }, page(chat).io);
    assert.equal(asked.at(-1), "open studio c-there", "the send goes where the chip said");
    // Studio answers no more: Auto's fresh pick is said, and held from then.
    asked = [];
    const gone = { cwd: "/w/r", runOn: AUTO, runOnSaw: "studio" };
    const away = page(gone, { places: readPlaces(placesOf([{ ...studio, answers: false }, laptop])) });
    assert.equal(await startThere(gone, { text: "x", folder: "/w/r", model: "" }, away.io), false);
    assert.match(away.said.refused[0], /^Auto picks Laptop now \(.*% idle.*\), and nothing went: send again/);
    assert.deepEqual(asked, ["places /w/r"]);
    assert.equal(gone.runOnSaw, "laptop");
    asked = [];
    await startThere(gone, { text: "x", folder: "/w/r", model: "" }, page(gone).io);
    assert.equal(asked.at(-1), "open laptop c-there", "held: Studio back, the send goes to Laptop as said");
  });

  // (fails before: yes — the review of s2c: a model that machine lacks became its first, the hover alone said)
  test("a model that does not answer there is said with the one it would start on; the next send goes on it", async () => {
    const own = place({ id: "studio", name: "Studio", maker: "dev-1", models: ["other", "third"] });
    const chat = { cwd: "/w/r", runOn: "studio" };
    const p = readPlaces(placesOf([own]));
    const first = page(chat, { places: p });
    assert.equal(await startThere(chat, { text: "x", folder: "/w/r", model: "m1" }, first.io), false);
    assert.equal(first.said.refused[0], "Your model m1 does not answer on Studio, and nothing went: send again to start your chat there on other, or pick another model or machine");
    assert.deepEqual(creates(), []);
    await startThere(chat, { text: "x", folder: "/w/r", model: "m1" }, page(chat, { places: p }).io);
    assert.deepEqual(creates(), ["create /copies/1/r model=other"]);
    assert.equal(atSend("studio", own, /** @type {any} */ (p), { model: "other" }), null, "a model it has");
    assert.equal(atSend("studio", own, /** @type {any} */ (p), { model: "m1", told: "studio\nm2" })?.told, "studio\nm1", "told of another model: said again");
  });

  // (fails before: yes — the review of s2c, plausible: a call that threw left the words nowhere; then the review of x21:
  // a throw after the chat or its message went said it did not, and the next send made a second chat there)
  test("a call that throws before the chat starts gives the words back; one after is an answer, and nothing starts a second chat", async () => {
    const chat = { cwd: "/w/r", runOn: "studio" };
    const { io, said } = page(chat, { call: async () => Promise.reject(new Error("the bridge closed")) });
    assert.equal(await startThere(chat, { text: "x", folder: "/w/r", model: "" }, io), false);
    assert.equal(said.refused[0], "Your chat did not start on another machine: the bridge closed");
    assert.equal(/** @type {any} */ (chat).runOnBusy, false);
    // The page's own call after the message went throws: it went, and the Start says so.
    asked = [];
    const opened = { cwd: "/w/r", runOn: "studio" };
    const late = page(opened, {
      open: () => {
        throw new Error("the view broke");
      },
    });
    assert.equal(await startThere(opened, { text: "x", folder: "/w/r", model: "" }, late.io), undefined);
    assert.deepEqual(late.said.refused, []);
    assert.equal(/** @type {any} */ (opened).runOn, undefined, "it went: the Start says This computer again");
    // The turn's call throws: it may have gone — the chat stands there, and the next send goes to it alone.
    asked = [];
    const unsure = { cwd: "/w/r", runOn: "studio" };
    const turnFails = page(unsure, {
      call: async (p) => {
        asked.push(p.op);
        if (p.op === "turn") throw new Error("no answer");
        return p.op === "me" ? { ok: true, json: { who: "device", device: "dev-1" } } : { ok: true, json: { chat: "c-there" } };
      },
    });
    assert.equal(await startThere(unsure, { text: "x", folder: "/w/r", model: "" }, turnFails.io), false);
    assert.match(turnFails.said.refused[0], /its answer to your message never came: no answer/);
    assert.equal(/** @type {any} */ (unsure).runOnStarted?.chat, "c-there");
    asked = [];
    await startThere(unsure, { text: "x", folder: "/w/r", model: "" }, page(unsure).io);
    assert.deepEqual(asked, ["turn c-there", "open studio c-there"], "the message alone goes to the chat that stands there");
  });
});

// (fails before: yes — the review of s2c: a command or the agents a message names went as words to the chat there)
// The page's glue, which needs the desktop app's bridge, is pinned here by its lines; what it does is startThere's above.
test("the page's send: plain words alone go there; the model is read as the send begins; the choice holds while it goes", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  const send = app.slice(app.indexOf("async function sendMessage("), app.indexOf("async function stopCurrent("));
  assert.match(send, /if \(!away && fresh && !chat\.chainId && !chat\.making && \(chat\.runOn \|\| chat\.runOnBusy\)\) \{\s+if \(brief \|\| flowAsk != null \|\| planAsk != null \|\| goalAsk \|\| forkAsk != null \|\| useCards\.length \|\| useTeamRows\.length\)\s+return refuse\("Run on sends plain words[^"]*", true, false\);\s+return runOnFirst\(chat, text, attachments\);\s+\}\s+const ready = away/);
  const ask = app.slice(app.indexOf("async function askAgents("), app.indexOf("// The dock's decisions"));
  assert.ok(ask.indexOf("chat.runOn || chat.runOnBusy") > 0 && ask.indexOf("chat.runOn || chat.runOnBusy") < ask.indexOf("await readySession("), "asking agents before the first message there is refused before any session is made");
  const first = app.slice(app.indexOf("async function runOnFirst("), app.indexOf("function allowRunOnSend("));
  assert.match(first, /^async function runOnFirst\(chat, text, attachments\) \{\s+if \(chat\.runOnBusy\) return refuse\(/, "a second send while one goes is refused in words");
  assert.match(first, /return await startThere\(chat, \{ text, folder, model: composer\.modelName\(\) \|\| "", tune: runOnTune\(composer\.effortValue\(\), composer\.heldSettings\(\), chat\.held\) \}, \{/, "the model and its tuning read before any wait");
  assert.match(first, /keep: \(words\) => keepStartWords\(chat, words\)/);
  assert.match(first, /open: \(m, chain\) => \(shown\(\) \? sidebar\.openOnMachine\(/, "opened in place only while the chat is shown");
  assert.match(app, /set: \(choice, name\) => \{\s+const c = chatOf\(state\.currentId\);\s+(?:\/\/[^\n]*\n\s+)*if \(!c \|\| c\.chainId \|\| c\.runOnBusy\) return;/, "the choice holds while its send goes");
});

describe("the chip, in a stand-in page", () => {
  const g = /** @type {any} */ (globalThis);
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    fetch: async () => new Promise(() => {}),
  };
  before(() => {
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
    if (typeof g.window.setTimeout !== "function") g.window.setTimeout = () => 0;
  });
  after(() => {
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
  });

  // (fails before: yes — the Start said nothing of where the chat runs)
  test("beside the project: This computer, each machine, Auto with its pick; the choice is the draft's; a project on other machines says so", async () => {
    const { createEmptyState } = await import("../src/ui/harness/conversation/empty.js");
    const places = readPlaces(placesOf([place({ id: "studio", name: "Studio", load1: 7 }), place({ id: "laptop", name: "Laptop", load1: 1 })]));
    const draft = { runOn: HERE, runOnName: "" };
    let reads = 0;
    let settings = 0;
    const empty = createEmptyState({
      getFolder: () => "/w/r",
      setFolder: () => {},
      chatOf: () => draft,
      alsoOn: (cwd) => (cwd === "/w/r" ? ["Studio"] : []),
      runOn: {
        on: () => true,
        get: () => draft.runOn,
        set: (choice, name) => Object.assign(draft, { runOn: choice, runOnName: name }),
        places: async () => (reads++, places),
        known: () => (reads ? places : null),
        tried: () => reads > 0,
        running: () => new Map(),
        model: () => "",
        settings: () => void settings++,
      },
    });
    doc.document.body.replaceChildren(empty.el);
    empty.paintChip();
    const el = /** @type {any} */ (empty.el);
    const chip = el.querySelector(".run-on-chip");
    assert.equal(chip.classList.contains("hidden"), false);
    assert.equal(chip.querySelector(".chooser-label").textContent, "This computer");
    await chip.onclick({ stopPropagation() {} });
    await until(() => doc.document.body.querySelector(".zc-menu") && reads > 0, "the menu open, the machines read");
    const menuEl = doc.document.body.querySelector(".zc-menu");
    const rows = /** @type {any[]} */ (menuEl.querySelectorAll(".zc-menu-item"));
    const text = (/** @type {any} */ r) => (r.querySelector(".zc-menu-label-line") || r.querySelector(".zc-menu-text")).textContent;
    assert.deepEqual(rows.map(text).slice(0, 4), ["This computer", "Auto", "Studio", "Laptop"]);
    rows.find((r) => text(r) === "Auto").dispatch("click");
    assert.equal(draft.runOn, AUTO);
    assert.equal(chip.querySelector(".chooser-label").textContent, "Auto → Laptop");
    assert.match(chip.title, /Auto picked Laptop: .*% idle/);
    // A project's row says the other machines it is on.
    const { state } = await import("../src/ui/harness/state.js");
    state.projects = [{ id: "p-r", name: "r", cwd: "/w/r" }];
    doc.document.body.replaceChildren(empty.el);
    // Its menu opens at the press; what it asks of the disk after (a stand-in that never answers here) moves nothing.
    void el.querySelector(".chooser-chip").onclick({ stopPropagation() {} });
    const projectRow = /** @type {any} */ ([...doc.document.body.querySelectorAll(".zc-menu-item")].find((/** @type {any} */ r) => text(r) === "r"));
    assert.match(projectRow?.textContent || "", /also on Studio/);
  });

  // (fails before: yes — the review of s2c: a read that came back with nothing was asked again at each paint, which
  // asked a paint again — the page froze —, and the menu said Reading… for good; a choice held with no folder chosen
  // hid the chip and still sent the message away)
  test("machines that could not be read are said so and asked once; a draft with no folder runs here", async () => {
    const { createEmptyState } = await import("../src/ui/harness/conversation/empty.js");
    const draft = { runOn: AUTO, runOnName: "" };
    let folder = "/w/r";
    let reads = 0;
    const empty = createEmptyState({
      getFolder: () => folder,
      setFolder: () => {},
      chatOf: () => draft,
      runOn: {
        on: () => true,
        get: () => draft.runOn,
        set: (choice, name) => Object.assign(draft, { runOn: choice, runOnName: name }),
        places: async () => (reads++, null),
        known: () => null,
        tried: () => reads > 0,
        running: () => new Map(),
        model: () => "",
        settings: () => {},
      },
    });
    doc.document.body.replaceChildren(empty.el);
    empty.paintChip();
    await until(() => reads > 0, "the chip asked for the machines");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(reads, 1, "asked once, not at each paint");
    const el = /** @type {any} */ (empty.el);
    const chip = el.querySelector(".run-on-chip");
    assert.match(chip.title, /could not be read/);
    void chip.onclick({ stopPropagation() {} });
    await until(() => [...doc.document.body.querySelectorAll(".zc-menu-item")].some((/** @type {any} */ r) => /could not be read/.test(r.textContent)), "the menu says the machines could not be read");
    folder = "";
    empty.paintChip();
    assert.equal(draft.runOn, HERE, "no folder: this computer");
    assert.equal(chip.classList.contains("hidden"), true);
  });
});

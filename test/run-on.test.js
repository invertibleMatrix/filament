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
import { AUTO, HERE, autoPick, chipWords, cleanClone, cloneFolder, modelFor, placeFor, pointsOf, readPlaces, runOnSend } from "../src/ui/harness/lib/run-on.js";

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

// (fails before: yes — the review of s2c: a command or the agents a message names went as words to the chat there, a
// message that did not go was dropped with the draft, and a send whose chat was left meanwhile put its words in the box
// of the chat shown) The page's glue, which needs the desktop app's bridge, is pinned here by its lines.
test("the page's send: plain words alone go there; a chat standing there takes the next send; a chat left meanwhile keeps its words", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  const send = app.slice(app.indexOf("async function sendMessage("), app.indexOf("async function stopCurrent("));
  assert.match(send, /if \(!away && fresh && !chat\.chainId && !chat\.making && \(chat\.runOn \|\| chat\.runOnBusy\)\) \{\s+if \(brief \|\| flowAsk != null \|\| planAsk != null \|\| goalAsk \|\| forkAsk != null \|\| useCards\.length \|\| useTeamRows\.length\)\s+return refuse\("Run on sends plain words[^"]*", true, false\);\s+return runOnFirst\(chat, text, attachments\);\s+\}\s+const ready = away/);
  const ask = app.slice(app.indexOf("async function askAgents("), app.indexOf("// The dock's decisions"));
  assert.ok(ask.indexOf("chat.runOn || chat.runOnBusy") > 0 && ask.indexOf("chat.runOn || chat.runOnBusy") < ask.indexOf("await readySession("), "asking agents before the first message there is refused before any session is made");
  const first = app.slice(app.indexOf("async function runOnFirst("), app.indexOf("function allowRunOnSend("));
  assert.match(first, /^async function runOnFirst\(chat, text, attachments\) \{\s+if \(chat\.runOnBusy\) return refuse\(/, "a second send while one goes is refused in words");
  assert.match(first, /const started = kept && kept\.machine === chat\.runOn && runOnKey\(kept\.folder\) === runOnKey\(folder\) \? kept : null;/, "a chat standing there for this machine and folder takes the send");
  assert.match(first, /if \(shown\(\)\) return refuse\(words\);\s+keep\(\);/, "refused in the box shown, else kept in the chat's own draft");
  assert.match(first, /saveDraft\(chat, since && since !== text\.trim\(\) \? `\$\{text\}\\n\\n\$\{since\}` : text\);/, "above what was typed there since");
  assert.match(first, /if \(!out\.ok\) \{\s+if \(out\.started\) standing\(out\.started\);\s+return no\(out\.words\);\s+\}\s+if \(out\.unsure\) \{[^}]*standing\(out\);\s+return no\(/, "a message that did not go, or may not have, keeps the chat there and the words here");
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

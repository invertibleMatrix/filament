// @ts-check
// Ctrl+K across machines (the remote desk of 11-22, s1h): in the desktop app the command center finds chats on every
// other machine the left bar lists, beside this computer's own. One search a machine, through the app's bridge (the
// desk's `search`), once typing rests; each machine's under its name, after this computer's parts so none of its rows
// waits on another machine; every word read as that machine's (lib/desk.js `readDeskChats`); Enter opens it there.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";

// The page's API client keeps the `fetch` it finds when it is first imported: the stand-in goes first.
const g = /** @type {any} */ (globalThis);
const realFetch = g.fetch;
/** @param {string} url */
g.fetch = async (url) => {
  // This computer finds a chat for any words but "zzqq", for which it finds none.
  const body = String(url).startsWith("/api/memory/sessions?") ? { sessions: String(url).includes("zzqq") ? [] : [{ id: "here-1", title: "Parser refactor here", when: "" }] } : {};
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
};
const { createCommandCenter, SLOW_PARTS_MS, THERE_WAIT_MS, wholeCut } = await import("../src/ui/harness/command-center.js");
after(() => {
  g.fetch = realFetch;
});

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

const STUDIO = { id: "m-studio", name: "Studio", color: "teal", icon: "server", status: "online", refused: false };
const LAB = { id: "m-lab", name: "Lab", color: "orange", icon: "laptop", status: "online", refused: false };
const AWAY = { id: "m-away", name: "Away", color: "pink", icon: "cloud", status: "offline", refused: false };

/**
 * The command center opened on a stub page with the desk's machines and its bridge scripted: `answer` says what a
 * machine's search answers (a promise held lets a test hold it).
 * @param {import("node:test").TestContext} t
 * `bridge` false: the page outside the desktop app, no bridge to call. `settings`: the open chat's setting facts.
 * @param {{ machines?: any[], answer?: (p: any) => any, bridge?: boolean, settings?: () => any }} o
 */
function openOn(t, { machines = [STUDIO, LAB, AWAY], answer = () => ({ ok: true, status: 200, json: { chats: [] } }), bridge = true, settings } = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const doc = stubDocument();
  const was = { frame: g.requestAnimationFrame, element: g.HTMLElement, local: g.localStorage };
  g.requestAnimationFrame = (/** @type {() => void} */ fn) => setTimeout(fn, 0);
  g.HTMLElement = class {};
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  t.after(() => {
    g.requestAnimationFrame = was.frame;
    g.HTMLElement = was.element;
    g.localStorage = was.local;
    doc.restore();
  });
  /** @type {any[]} */
  const calls = [];
  /** @type {[string, string, string][]} */
  const opened = [];
  const d = /** @type {any} */ (globalThis.document);
  createCommandCenter({
    actions: () => [],
    onOpenTask: () => {},
    machines: () => machines,
    ...(bridge
      ? {
        deskCall: async (/** @type {any} */ p) => {
          calls.push(p);
          return answer(p);
        },
      }
      : {}),
    onOpenThere: (m, chain, name) => void opened.push([m, chain, name]),
    ...(settings ? { settings } : {}),
  }).open();
  const input = d.querySelector(".cc-input");
  return {
    calls,
    opened,
    /** @param {number} ms */
    wait: async (ms) => {
      t.mock.timers.tick(ms);
      await settle();
    },
    /** @param {string} v */
    type: (v) => {
      input.value = v;
      input.dispatch("input");
    },
    /** @param {string} key */
    key: (key) => input.dispatch("keydown", { key }),
    labels: () => /** @type {any[]} */ (d.querySelectorAll(".cc-label")).map((e) => e.textContent),
    rows: () => /** @type {any[]} */ (d.querySelectorAll(".cc-row")).map((e) => e.querySelector(".cc-name")?.textContent ?? e.textContent),
    details: () => /** @type {any[]} */ (d.querySelectorAll(".cc-detail")).map((e) => e.textContent),
    whys: () => /** @type {any[]} */ (d.querySelectorAll(".cc-why")).filter((e) => !String(e.className || "").includes("cc-there-wait")).map((e) => e.textContent),
    /** @param {string} sel */
    text: (sel) => d.querySelector(sel)?.textContent ?? null,
  };
}

/** A machine's chats as the desk's search answers them (watch.js `deskChats`). @param {string[]} titles */
const found = (titles) => ({ ok: true, status: 200, json: { chats: titles.map((title, i) => ({ chain: `c${i + 1}`, title, project: "shop", projectId: "p1", cwd: "/w/shop", when: Date.now() - 3 * 3600_000, unread: false, pinned: false, threadOf: null, from: "", kind: "interactive", remoteKey: null })) } });

// (fails before: yes — s1h: Ctrl+K found this computer's chats alone)
test("typing searches each machine the bar lists that answers now, once typing rests; each machine's chats under its name, after this computer's", async (t) => {
  const cc = openOn(t, { answer: (p) => (p.machine === "m-studio" ? found(["Parser refactor on Studio", "Parser docs"]) : found(["Parser bench"])) });
  await settle();
  assert.deepEqual(cc.calls, [], "nothing typed, nothing asked there");
  cc.type("par");
  await settle();
  cc.type("pars");
  await settle();
  cc.type("parser");
  await cc.wait(THERE_WAIT_MS);
  assert.deepEqual(cc.calls, [{ op: "search", machine: "m-studio", q: "parser" }, { op: "search", machine: "m-lab", q: "parser" }], "a word typed fast asks once, for its whole; a machine offline not at all");
  await cc.wait(SLOW_PARTS_MS);
  assert.deepEqual(cc.labels(), ["Recent chats", "On Studio", "On Lab"]);
  assert.deepEqual(cc.rows(), ["Parser refactor here", "Parser refactor on Studio", "Parser docs", "Parser bench"]);
  assert.deepEqual(cc.details(), ["shop · 3h", "shop · 3h", "shop · 3h"], "theirs say their project and age; this computer's here says none");
  // Enter on one of theirs opens it there, named as its row named it (the hunt on s1h: the bar's name at the press, or
  // its id where it had left the bar).
  cc.key("ArrowDown");
  cc.key("Enter");
  assert.deepEqual(cc.opened, [["m-studio", "c1", "Studio"]]);
});

// (and the hunt on s1h: a machine that had answered was held behind one before it still out, and said as searching)
test("a machine slow to answer holds none of this computer's rows, nor another machine's: each is drawn as it comes, below what is drawn, and the line names only those still out; one that fails says so", async (t) => {
  /** @type {(v: any) => void} */
  let studio = () => {};
  const cc = openOn(t, { machines: [STUDIO, LAB], answer: (p) => (p.machine === "m-studio" ? new Promise((r) => (studio = r)) : { ok: false, status: 0, words: "Lab is not reachable now" }) });
  cc.type("parser");
  await cc.wait(THERE_WAIT_MS);
  await cc.wait(SLOW_PARTS_MS);
  assert.deepEqual(cc.labels(), ["Recent chats", "On Lab"], "this computer's and Lab's drawn while Studio has not answered");
  // (fails before: yes — the hunt on s1h: every failure said the machine did not answer, whatever the app said)
  assert.deepEqual(cc.whys(), ["Lab is not reachable now"], "why, in the app's words");
  assert.equal(cc.text(".cc-there-wait"), "Searching Studio…");
  studio(found(["Parser on Studio"]));
  await settle();
  assert.deepEqual(cc.labels(), ["Recent chats", "On Lab", "On Studio"], "Studio's below what was drawn");
  assert.deepEqual(cc.rows(), ["Parser refactor here", "Parser on Studio"]);
  assert.equal(cc.text(".cc-there-wait"), null, "none out: no line");
});

// (fails before: yes — the hunt on s1h: the examples showed while a machine's search was out, and went as its rows came)
test("what else to type waits while a machine's search is out", async (t) => {
  /** @type {(v: any) => void} */
  let studio = () => {};
  const facts = { chat: true, client: false, line: { percent: 85, window: 200_000 }, permission: "edit", effort: { levels: ["low", "high"], now: "high", auto: true }, window: { options: [200_000], now: 200_000, standard: 200_000 }, model: "M", modelId: "a/m", families: [], memory: { on: true, source: "default" }, may: { tags: [], cards: [] }, mayOff: "" };
  const cc = openOn(t, { machines: [STUDIO], answer: () => new Promise((r) => (studio = r)), settings: () => facts });
  cc.type("zzqq");
  await cc.wait(THERE_WAIT_MS + SLOW_PARTS_MS);
  assert.equal(cc.text(".cc-there-wait"), "Searching Studio…");
  assert.equal(cc.text(".cc-also"), null, "no examples while Studio is out");
  studio(found([]));
  await settle();
  assert.ok(cc.text(".cc-also"), "nothing found anywhere: what else to type");
});

test("a failure the app gives no words for, or a call that threw, says the machine did not answer; its words are kept to a line", async (t) => {
  const cc = openOn(t, { machines: [STUDIO, LAB], answer: (p) => (p.machine === "m-studio" ? Promise.reject(new Error("gone")) : { ok: false, status: 502, words: `Lab answered:\u0007 ${"x".repeat(500)}` }) });
  cc.type("parser");
  await cc.wait(THERE_WAIT_MS);
  await cc.wait(SLOW_PARTS_MS);
  const [studio, lab] = cc.whys();
  assert.equal(studio, "Studio did not answer the search");
  assert.equal(lab.length, 300);
  assert.ok(lab.startsWith("Lab answered:") && !lab.includes("\u0007"), "no control characters");
});

// (fails before: yes — the hunt on s1h: a search longer than the desk's cap was refused there, and said the machine did not answer)
test("words longer than the desk takes search for their first 200, trimmed", async (t) => {
  const cc = openOn(t, { machines: [STUDIO], answer: () => found(["Parser bench"]) });
  cc.type(`  ${"p".repeat(260)}`);
  await cc.wait(THERE_WAIT_MS + SLOW_PARTS_MS);
  assert.deepEqual(cc.calls.map((c) => c.q), ["p".repeat(200)]);
});

// (fails before: yes — the hunt on s1h: an emoji at the cut went in two, and the search said the machine did not answer)
test("a cut at 200 keeps an emoji whole or leaves it out; a lone half of one never reaches the address", async (t) => {
  const cc = openOn(t, { machines: [STUDIO], answer: () => found(["Parser bench"]) });
  cc.type(`${"p".repeat(199)}🙂tail`);
  await cc.wait(THERE_WAIT_MS + SLOW_PARTS_MS);
  assert.deepEqual(cc.calls.map((c) => c.q), ["p".repeat(199)]);
  assert.deepEqual([wholeCut("ab🙂", 3), wholeCut("ab🙂", 4), wholeCut("a\uD83Db", 9)], ["ab", "ab🙂", "a�b"]);
});

// (fails before: yes — the hunt on s1h: a thread, or a team on a chat's side, came up though the left bar lists none of them)
test("a thread or a team on a chat's side is none of theirs listed: its chat is", async (t) => {
  const some = /** @type {any} */ (found(["Parser chat", "Parser thread", "Parser team"]));
  some.json.chats[1].threadOf = "c1";
  some.json.chats[2].kind = "team";
  const cc = openOn(t, { machines: [STUDIO], answer: () => some });
  cc.type("parser");
  await cc.wait(THERE_WAIT_MS + SLOW_PARTS_MS);
  assert.deepEqual(cc.rows().slice(1), ["Parser chat"]);
});

// (fails before: yes — the hunt on s1h: Enter on a chat of a machine gone from the window closed Ctrl+K onto nothing)
test("app.js: a chat opened on another machine's whole page that the app would not open says so", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  for (const said of [
    "function openWholeOn(machine, route, name = \"That machine\") {",
    "(ok) => void (ok === false && toast(`${name} is not in this window now: its chat did not open`, \"err\")),",
    "    else openWholeOn(m.id, route, m.name);",
    "    openWhole: (machine, route, name) => openWholeOn(machine, route, name),",
  ])
    assert.ok(app.includes(said), said);
  assert.equal(app.split("filamentApp?.openOn?.(").length - 1, 0, "no open of a whole page passes it by");
  const guest = readFileSync("src/ui/harness/lib/desk-guest.js", "utf8");
  assert.equal(guest.split("o.openWhole(m.id, route, m.name);").length - 1, 2, "the guest's name the press read");
});

// (fails before: yes — the review of s1h: each keystroke's search went at once, held a call of the machine's eight
// until its answer, and the newest words' was refused)
test("one search of a machine at a time: words typed while one is out go once it is back, the newest alone", async (t) => {
  /** @type {((v: any) => void)[]} */
  const held = [];
  const cc = openOn(t, { machines: [STUDIO], answer: (p) => new Promise((r) => held.push(() => r(found([`Found ${p.q}`])))) });
  cc.type("par");
  await cc.wait(THERE_WAIT_MS);
  cc.type("pars");
  await cc.wait(THERE_WAIT_MS);
  cc.type("parser");
  await cc.wait(THERE_WAIT_MS);
  assert.deepEqual(cc.calls.map((c) => c.q), ["par"], "the rest wait for it");
  /** @type {any} */ (held.shift())();
  await settle();
  assert.deepEqual(cc.calls.map((c) => c.q), ["par", "parser"], "then the newest words alone");
  /** @type {any} */ (held.shift())();
  await cc.wait(SLOW_PARTS_MS);
  assert.deepEqual(cc.rows().slice(1), ["Found parser"]);
});

test("a machine that refuses this window is not searched", async (t) => {
  const cc = openOn(t, { machines: [{ ...STUDIO, refused: true }, LAB], answer: () => found(["Parser bench"]) });
  cc.type("parser");
  await cc.wait(THERE_WAIT_MS + SLOW_PARTS_MS);
  assert.deepEqual(cc.calls.map((c) => c.machine), ["m-lab"]);
});

test("every word of theirs read as that machine's: a chat whose id is no id is none, its words clipped, six a machine", async (t) => {
  const many = found(Array.from({ length: 9 }, (_, i) => `Parser ${i}`));
  many.json.chats[0].chain = "../../remote/devices";
  many.json.chats[1].title = `Parser\u0007 ${"x".repeat(400)}`;
  const cc = openOn(t, { machines: [STUDIO], answer: () => many });
  cc.type("parser");
  await cc.wait(THERE_WAIT_MS);
  await cc.wait(SLOW_PARTS_MS);
  const theirs = cc.rows().slice(1);
  assert.equal(theirs.length, 6);
  assert.equal(theirs[0].length, 300, "clipped as the bar clips a title");
  assert.ok(!theirs[0].includes("\u0007"));
  assert.ok(!theirs.includes("Parser 0"), "the chat whose id would be a path is none");
});

test("in the Files scope no machine is asked; outside the desktop app — no bridge — none either", async (t) => {
  const cc = openOn(t, { machines: [STUDIO], answer: () => found(["Parser bench"]) });
  for (const k of ["Tab", "Tab", "Tab", "Tab"]) cc.key(k);
  cc.type("parser");
  await cc.wait(THERE_WAIT_MS + SLOW_PARTS_MS);
  assert.equal(cc.calls.length, 0, "Files");
  cc.key("Tab");
  await cc.wait(THERE_WAIT_MS + SLOW_PARTS_MS);
  assert.deepEqual(cc.calls.map((c) => c.machine), ["m-studio"], "All again: asked");
});

test("outside the desktop app no machine is asked", async (t) => {
  const cc = openOn(t, { machines: [STUDIO], bridge: false });
  cc.type("parser");
  await cc.wait(THERE_WAIT_MS + SLOW_PARTS_MS);
  assert.deepEqual(cc.calls, []);
  assert.deepEqual(cc.labels(), ["Recent chats"]);
  assert.equal(cc.text(".cc-there-wait"), null);
});

// @ts-check
// team_v2_plan §10 O3, the mock of 10-19: a team's result. The fixed list its lead ends with (core/beside.js
// `findingsFormat`, `findingsOf`) and the two leads that write it; the words a result says (lib/beside.js: its chips,
// what its top few leave out, where it stands with your agent, when an ended team folds to a row, the box's attachment);
// the Teams tab's result card and folded row; the transcript's marks, which say they are only on your page; the result
// beside the chat (panes/team-result.js); and the message box's attachment (composer/attachments.js).
// (fails before: yes — a result was its text cut short, Send to your agent sent it on one press, and nothing said the
// marks were the page's alone)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FINDING_LIMITS, RESULT_HEAD, findingsFormat, findingsOf } from "../src/core/beside.js";
import { SHIPPED_CARDS } from "../src/services/agent-cards.js";
import { FINDING_WORDS, ONLY_YOURS, findingChips, foldsToRow, missedWords, moreWords, resultAttachment, seenWords, sentTitle, tokenWords } from "../src/ui/harness/lib/beside.js";
import { createBesideView } from "../src/ui/harness/views/beside.js";
import { besideActions, besideMarkRow } from "../src/ui/harness/conversation/beside-marks.js";
import { renderResultPane } from "../src/ui/harness/panes/team-result.js";
import { createAttachments } from "../src/ui/harness/composer/attachments.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { stubDocument } from "./helpers/dom-stub.js";
import "./helpers/teams-on-page.js";

/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** The first node under `n` wearing a class. @param {any} n @param {string} cls */
const one = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls))[0];
/** @param {any} n @param {string} words */
const btn = (n, words) => /** @type {any} */ (buttonsOf(n).find((b) => textOf(b) === words));
/** @param {any} p @param {any[]} k */
const place = (p, k) => p.replaceChildren(...k);
const settle = () => new Promise((r) => setImmediate(r));

const NOW = 1_800_000_000_000;
/** As a Bug Hunter's lead ends its result. */
const HUNT = [
  "Merged the six reports; two were the same bug.",
  "",
  "Findings:",
  "- (an early draft)",
  "",
  "Then the checks.",
  "",
  "## Findings",
  "- **Found** | Notify while a question waits sends the result twice | `app/teams-beside.js:418` | Hunter 3 — a failing test",
  "- Found | a || b is read as one | core/pool.js:233 | Hunter 6",
  "- Plausible | Off by one in the lexer | lex.js:9",
  "- Not covered | P4's Verifier card | - | Hunter 9 had no slot until the end",
  "",
  "That is all.",
].join("\n");
const TOP = [
  { kind: /** @type {const} */ ("found"), title: "Notify while a question waits sends the result twice", where: "app/teams-beside.js:418", note: "Hunter 3 — a failing test" },
  { kind: /** @type {const} */ ("found"), title: "A 429 lowers a model's number but never raises it again", where: "core/pool.js:233", note: "" },
  { kind: /** @type {const} */ ("found"), title: "A done card still shows its switches", where: "lib/beside.js:82", note: "" },
];
const FINDINGS = { counts: { found: 7, confirmed: 0, plausible: 3, uncovered: 1, dismissed: 0 }, top: TOP, total: 11 };
/** A finding whose lead wrote code into its title and its note, and markup beside it. */
const CODE = { kind: /** @type {const} */ ("found"), title: "`flush()` sends twice while <img src=x onerror=alert(1)> waits", where: "app/teams-beside.js:418", note: "Hunter 3 — `npm test` fails <b>here</b>" };
/** A team on the side as the list answers it, done with a ranked result. @param {any} [o] @returns {any} */
const row = (o = {}) => ({
  id: "t1", main: "c1", team: { key: "bug-hunter", name: "Bug Hunter" }, ask: "find bugs in the last five phases", firedBy: "you", at: NOW - 20 * 60_000, model: "m-1", title: "",
  state: "done", workers: { running: 0, waiting: 0, total: 10 }, verify: false, notify: false, of: null, verifiedBy: null,
  result: { n: 1, text: "Merged the six reports.", more: true, at: NOW - 2 * 60_000 }, findings: FINDINGS, notified: null, cut: false, readOnly: true,
  on: { lead: "m-1", workers: ["m-2"], from: "team", fell: [] }, ...o,
});

describe("the fixed list a finding team's lead ends with", () => {
  test("read from the last Findings line: each kind, title, where and note in its lead's order; another line ends it; none is null", () => {
    const f = findingsOf(HUNT);
    assert.deepEqual(f?.items, [
      { kind: "found", title: "Notify while a question waits sends the result twice", where: "app/teams-beside.js:418", note: "Hunter 3 — a failing test" },
      { kind: "found", title: "a || b is read as one", where: "core/pool.js:233", note: "Hunter 6" },
      { kind: "plausible", title: "Off by one in the lexer", where: "lex.js:9", note: "" },
      { kind: "uncovered", title: "P4's Verifier card", where: "", note: "Hunter 9 had no slot until the end" },
    ], "bold and code marks gone, a title's || kept whole, a dash for no place");
    assert.deepEqual(f?.counts, { found: 2, confirmed: 0, plausible: 1, uncovered: 1, dismissed: 0 });
    const checked = findingsOf("Checked.\n\nFindings:\n1. Confirmed | the null read | parse.js:3 | read it\n2) Dismissed | the double send | - | it is sent once\n- Maybe | not a kind");
    assert.deepEqual(checked?.items.map((x) => [x.kind, x.title, x.where]), [["confirmed", "the null read", "parse.js:3"], ["dismissed", "the double send", ""]], "numbered too; an unknown kind ends it");
    assert.equal(findingsOf("Found: parse.js:3 reads a field of null. Plausible: none."), null, "a result its lead wrote freely");
    assert.equal(findingsOf("Findings:\n\nnone this time"), null);
    const long = findingsOf(`Findings:\n- Found | ${"x".repeat(500)} | a.js:1`);
    assert.equal(long?.items[0].title.length, FINDING_LIMITS.title);
  });

  test("BugHunters' lead ends its result with it, a hunt's and a check's alike", () => {
    assert.match(findingsFormat(), /^End your result with a line that says only "Findings:"[\s\S]*a hunt's ranked by harm, the worst first[\s\S]*\n- Found \| <the bug, in a few words> \| <file>:<line> \|[\s\S]*\n- Not covered \| <the area> \| - \|/);
    assert.match(findingsFormat(), /\n- Confirmed \|[\s\S]*\n- Dismissed \|/);
    assert.ok(String(SHIPPED_CARDS.huntlead.thinks).endsWith(findingsFormat()));
    // HarnessV4_Envelopes_Plan EN6: the drive's Bug Hunter lead wrote its list but no subject line, asked for one only at
    // the record's head; beside the list's ask, where it writes its result, its lead is asked for it.
    // (fails before: yes — neither lead's words asked for a subject)
    assert.match(String(SHIPPED_CARDS.huntlead.thinks), /Either way, start your result with one line, "Subject: " and your verdict in under 20 words: the main agent may read that line before the rest\.\n\nEnd your result/);
    // What the format asks for is what the parser reads.
    const example = findingsOf(`Findings:\n${findingsFormat().split("\n").slice(1).join("\n")}`);
    assert.deepEqual(example?.items.map((x) => x.kind), ["found", "confirmed", "plausible", "dismissed", "uncovered"]);
  });
});

describe("a result's words", () => {
  test("its chips, what its top few leave out, where it stands with your agent, when it folds, the box's attachment", () => {
    assert.deepEqual(findingChips(FINDINGS), [{ kind: "found", words: "7 found", tone: "red" }, { kind: "plausible", words: "3 more unsure", tone: "orange" }, { kind: "uncovered", words: "1 area not covered", tone: "gray" }]);
    assert.deepEqual(findingChips({ counts: { confirmed: 2, dismissed: 3, uncovered: 2 } }).map((c) => c.words), ["2 confirmed", "2 areas not covered", "3 dismissed"]);
    // (fails before: yes — U13 W3: "plausible" said nothing to a newcomer) Unsure — "more" after what was found.
    assert.deepEqual(findingChips({ counts: { plausible: 2, uncovered: 1 } }).map((c) => c.words), ["2 unsure", "1 area not covered"]);
    assert.deepEqual(findingChips({ counts: { confirmed: 1, plausible: 1 } }).map((c) => c.words), ["1 confirmed", "1 more unsure"]);
    assert.deepEqual(findingChips(null), []);
    assert.equal(moreWords(FINDINGS), "+ 4 more found · 3 unsure · 1 area not covered");
    assert.equal(moreWords({ counts: { found: 1 }, top: [TOP[0]] }), "");
    assert.deepEqual(Object.keys(FINDING_WORDS), ["found", "confirmed", "plausible", "uncovered", "dismissed"]);
    assert.equal(seenWords(row()), "your agent has not seen it");
    assert.equal(seenWords(row({ verifiedBy: "t2" })), "BugHunters checks it first");
    assert.equal(seenWords(row({ notified: { n: 1, at: NOW, how: "steered" } })), "Sent to your agent: its running turn read it");
    // (fails before: yes — a result its switch was to hand on, and that did not go, said only "your agent has not seen
    // it": the row's `missed`, the server's reason, was read by the agent's tool alone)
    const tried = "Filament tried to hand it to your agent when the team ended and could not";
    const still = "your agent has not seen it — Send to your agent… still sends it";
    for (const [missed, why] of [
      ["Filament stopped before it could go", "Filament stopped before it could go"],
      ["the result could not reach the main agent: HTTP 502", "HTTP 502"],
      ["the result could not reach the main agent: this chat is archived", "this chat is archived"],
      ["its main chat is gone", "its main chat is gone"],
      ["it was refused", "it was refused"],
    ]) {
      assert.equal(missedWords(row({ notify: true, missed })), `${tried} (${why})`);
      assert.equal(seenWords(row({ notify: true, missed })), `${tried} (${why}): ${still}`);
      assert.equal(seenWords(row({ notify: true, missed }), { send: false }), `${tried} (${why}): your agent has not seen it`, "where no Send to your agent… stands beside it");
    }
    assert.deepEqual([missedWords(row()), missedWords(row({ missed: null })), missedWords(row({ missed: "it was refused", notified: { n: 1, at: NOW, how: "sent" } })), missedWords(row({ missed: "it was refused", verifiedBy: "t2" }))], ["", "", "", ""], "none missed; one sent since; one BugHunters checks");
    assert.equal(seenWords(row({ missed: "it was refused", main: null })), `${tried} (it was refused): your agent has not seen it`, "its main chat gone: no Send to your agent… to name");
    // Each reason as the server keeps it (app/teams-beside.js): the words the page reads past, and the ones it says whole.
    const server = readFileSync(new URL("../src/app/teams-beside.js", import.meta.url), "utf8");
    for (const kept of ["`the result could not reach the main agent: ${", '"Filament stopped before it could go"', '"its main chat is gone"', '"it was refused"']) assert.ok(server.includes(kept), kept);
    assert.deepEqual([row(), row({ notified: { n: 1, at: NOW, how: "sent" } }), row({ verifiedBy: "t2" }), row({ state: "stopped" }), row({ state: "stopped", cut: true }), row({ state: "working" })].map(foldsToRow),
      [false, true, true, false, false, false], "a result that waits for you keeps its card; one that stopped before it finished keeps its card, with Resume…");
    assert.equal(sentTitle(row({ firedBy: "agent" })), "Your agent sent the Bug Hunter team on the side");
    assert.equal(sentTitle(row()), "You sent the Bug Hunter team on the side");
    assert.equal(ONLY_YOURS, "only on your page — your agent can't see this");
    assert.equal(tokenWords("x".repeat(12_400)), "≈3k tokens");
    const message = `${RESULT_HEAD}: …]\n\n<team-result team="Bug Hunter">\n${HUNT}\n</team-result>`;
    assert.deepEqual(resultAttachment({ id: "t1", n: 1, team: { key: "bug-hunter", name: "Bug Hunter" }, ask: "x", firedBy: "you", at: NOW, text: HUNT, message, findings: { items: [], counts: FINDINGS.counts } }, "c1"), {
      kind: "team", name: "Bug Hunter's result", line: "7 found, 3 more unsure", size: message.length, text: message, team: { id: "t1", n: 1, main: "c1", key: "bug-hunter" },
    });
  });
});

describe("the Teams tab: a result's card, an ended team's row", () => {
  /** @param {any[]} rows */
  const make = (rows) => {
    const rec = { notes: /** @type {string[]} */ ([]), results: /** @type {string[]} */ ([]), opens: /** @type {string[]} */ ([]), verifies: /** @type {string[]} */ ([]) };
    const v = createBesideView(/** @type {any} */ ({
      rows: () => rows, brief: () => {}, set: () => {}, stop: () => {}, resume: () => {},
      notify: (/** @type {string} */ id) => rec.notes.push(id), verify: (/** @type {string} */ id) => rec.verifies.push(id),
      open: (/** @type {string} */ id) => rec.opens.push(id), openResult: (/** @type {string} */ id) => rec.results.push(id), now: () => NOW,
    }), { h: fakeH, place, drawIn: fakeDrawIn });
    v.paint({ chainId: "c1" });
    return { v, rec };
  };
  /** @param {any} el @param {string} id */
  const cardOf = (el, id) => all(el, (x) => x.attrs?.["data-beside"] === id)[0];

  test("its chips, its top three with where each is, the rest a press from beside; Send to your agent… fills the box (the host's)", () => {
    const { v, rec } = make([row()]);
    const card = cardOf(v.el, "t1");
    assert.deepEqual(all(card, (x) => String(x.attrs?.class || "").startsWith("trp-chip")).map(textOf), ["7 found", "3 more unsure", "1 area not covered"]);
    assert.equal(textOf(one(card, "bes-findings")),
      "Notify while a question waits sends the result twice|app/teams-beside.js:418|A 429 lowers a model's number but never raises it again|core/pool.js:233|A done card still shows its switches|lib/beside.js:82|+ 4 more found · 3 unsure · 1 area not covered — open beside");
    assert.equal(one(card, "bes-result-text"), undefined, "its findings stand for its text");
    assert.deepEqual(buttonsOf(one(card, "bes-card-foot")).map(textOf), ["Send to your agent…", "Verify, then send…", "Ask its lead", "Open beside"]);
    assert.equal(textOf(one(card, "bes-seen")), "your agent has not seen it");
    btn(card, "Send to your agent…").attrs.onclick();
    btn(card, "Open beside").attrs.onclick();
    one(card, "bes-more").attrs.onclick();
    assert.deepEqual([rec.notes, rec.results], [["t1"], ["t1", "t1"]]);
    // A result its lead wrote freely: its text in short, Open beside for the rest.
    const free = cardOf(make([row({ findings: null })]).v.el, "t1");
    assert.equal(textOf(one(free, "bes-card-result")), "Merged the six reports.|Open beside for the rest");
  });

  // (fails before: yes — seen in a real page, 11-11: a title its lead wrote with code in it stood with its backticks)
  test("a finding's title on the card: its code drawn as code, and markup in it text", () => {
    const card = cardOf(make([row({ findings: { counts: { found: 1 }, top: [CODE], total: 1 } })]).v.el, "t1");
    const title = one(card, "bes-finding-t");
    assert.deepEqual(title.kids.map((/** @type {any} */ k) => (typeof k === "string" ? k : [k.tag, textOf(k)])), [["code", "flush()"], " sends twice while <img src=x onerror=alert(1)> waits"]);
    assert.deepEqual([all(card, (x) => x.tag === "img").length, "html" in title.attrs], [0, false], "its markup is text: none of it is read as a tag");
  });

  // (fails before: yes — a result Hand its result to your agent was to send on, and that did not go, stood on its
  // card as any result nobody sent: "your agent has not seen it")
  test("a result its switch could not hand on: its card's foot says what was tried and why, Send to your agent… still there; in the team's own chat, without it", () => {
    const missed = row({ notify: true, missed: "the result could not reach the main agent: HTTP 502" });
    const card = cardOf(make([missed]).v.el, "t1");
    const seen = one(card, "bes-seen");
    assert.deepEqual([seen.attrs.class, textOf(seen)], ["bes-seen is-missed", "Filament tried to hand it to your agent when the team ended and could not (HTTP 502): your agent has not seen it — Send to your agent… still sends it"]);
    assert.deepEqual(buttonsOf(one(card, "bes-card-foot")).map(textOf), ["Send to your agent…", "Verify, then send…", "Ask its lead", "Open beside"]);
    assert.equal(one(cardOf(make([row()]).v.el, "t1"), "bes-seen").attrs.class, "bes-seen", "one nobody tried to send: as it was");
    // The team's own chat shows its card with no Send to your agent…: the words name none.
    const own = createBesideView(/** @type {any} */ ({ rows: () => [], self: () => missed, main: () => "c1", openMain: () => {}, brief: () => {}, set: () => {}, stop: () => {}, resume: () => {}, notify: () => {}, verify: () => {}, open: () => {}, now: () => NOW }), { h: fakeH, place, drawIn: fakeDrawIn });
    own.paint({ chainId: "t1" });
    const here = cardOf(own.el, "t1");
    assert.deepEqual([textOf(one(here, "bes-seen")), btn(here, "Send to your agent…")], ["Filament tried to hand it to your agent when the team ended and could not (HTTP 502): your agent has not seen it", undefined]);
  });

  test("sent to your agent, it folds to a row: how it ended and where its result went; the row opens again into its card", () => {
    const { v, rec } = make([row({ notified: { n: 1, at: NOW, how: "sent" } })]);
    const r = cardOf(v.el, "t1");
    assert.equal(r.attrs.class, "bes-row is-done");
    assert.equal(textOf(r), "Bug Hunter|Done · 7 found · 3 more unsure · Sent to your agent · 2 min ago|Open beside|Ask its lead");
    btn(r, "Open beside").attrs.onclick();
    btn(r, "Ask its lead").attrs.onclick();
    assert.deepEqual([rec.results, rec.opens], [["t1"], ["t1"]]);
    all(r, (x) => x.attrs?.["aria-label"] === "Unfold the Bug Hunter team's card")[0].attrs.onclick();
    const card = cardOf(v.el, "t1");
    assert.equal(card.attrs.class, "bes-card is-done");
    assert.equal(textOf(one(card, "bes-card-sent")), "Sent to your agent");
    assert.equal(btn(card, "Send to your agent…"), undefined, "once per result");
  });
});

describe("the transcript's marks of a result, and the result beside the chat", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => {
    Object.assign(besideActions, { row: null, watch: null, set: null, notify: null, verify: null, open: null, openResult: null });
    doc.restore();
  });

  test("a result's mark: who, its chips, its top three, the rest, each hand-off a press; only on your page", () => {
    /** @type {any[]} */
    const did = [];
    Object.assign(besideActions, {
      row: () => row(),
      watch: () => () => {},
      notify: (/** @type {string} */ id) => did.push(["notify", id]),
      verify: (/** @type {string} */ id) => did.push(["verify", id]),
      open: (/** @type {string} */ id) => did.push(["open", id]),
      openResult: (/** @type {string} */ id) => did.push(["beside", id]),
    });
    const mark = /** @type {any} */ (besideMarkRow({ type: "team", event: "result", id: "t1", at: NOW, afterTurn: 1 }));
    assert.match(mark.textContent, /^Bug Hunter's result7 found3 more unsure1 area not coveredonly on your page — your agent can't see thisNotify while a question waits sends the result twiceapp\/teams-beside\.js:418/);
    assert.match(mark.textContent, /\+ 4 more found · 3 unsure · 1 area not coveredSend to your agent…Verify, then send…Ask its leadOpen besideyour agent has not seen it$/);
    for (const words of ["Send to your agent…", "Verify, then send…", "Ask its lead", "Open beside"]) mark.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === words).dispatch("click");
    assert.deepEqual(did, [["notify", "t1"], ["verify", "t1"], ["open", "t1"], ["beside", "t1"]]);
    // (fails before: yes — "your agent has not seen it" stood in the green of a result that went: seen by eye with a
    // real team) Quiet while your agent has not seen it; green once it went.
    assert.equal(mark.querySelector(".bes-mark-sent").className, "bes-mark-sent");
    Object.assign(besideActions, { row: () => row({ notified: { n: 1, at: NOW, how: "sent" } }) });
    const went = /** @type {any} */ (besideMarkRow({ type: "team", event: "result", id: "t1", at: NOW, afterTurn: 1 })).querySelector(".bes-mark-sent");
    assert.deepEqual([went.className, went.textContent], ["bes-mark-sent is-sent", "Sent to your agent"]);
    const aqua = readFileSync(new URL("../src/ui/harness/aqua.css", import.meta.url), "utf8");
    assert.match(aqua, /\n\.bes-mark-sent \{ font-size: 12px; color: var\(--aq-label-3\); \}\n\.bes-mark-sent\.is-sent \{ color: var\(--color-sys-green-text\); \}/);
    // (fails before: yes — the mark of a result its switch could not hand on said "your agent has not seen it" alone)
    Object.assign(besideActions, { row: () => row({ notify: true, missed: "Filament stopped before it could go" }) });
    const lost = /** @type {any} */ (besideMarkRow({ type: "team", event: "result", id: "t1", at: NOW, afterTurn: 1 }));
    const sent = lost.querySelector(".bes-mark-sent");
    assert.deepEqual([sent.className, sent.textContent, !!lost.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Send to your agent…")],
      ["bes-mark-sent is-missed", "Filament tried to hand it to your agent when the team ended and could not (Filament stopped before it could go): your agent has not seen it — Send to your agent… still sends it", true]);
  });

  test("beside the chat: its found ones as cards, the rest folded, the whole result under them; a place opens its file; the foot follows its row", async () => {
    let r = row();
    /** @type {Set<() => void>} */
    const watchers = new Set();
    /** @type {any[]} */
    const did = [];
    const body = /** @type {any} */ (document.createElement("div"));
    const letGo = renderResultPane(body, {
      load: async () => ({ id: "t1", n: 1, team: { key: "bug-hunter", name: "Bug Hunter" }, ask: "x", firedBy: "you", at: NOW - 60_000, text: HUNT, message: "m", findings: findingsOf(HUNT) }),
      row: () => r,
      watch: (fn) => (watchers.add(fn), () => watchers.delete(fn)),
      send: () => did.push("send"),
      verify: () => did.push("verify"),
      ask: () => did.push("ask"),
      openFile: (where) => did.push(["file", where]),
      now: () => NOW,
    });
    assert.match(body.textContent, /Reading its result…/);
    await settle();
    const text = body.textContent;
    assert.match(text, /^Bug Hunter · resultdone 1 min ago · 10 workers2 found1 more unsure1 area not coveredranked by its lead/);
    assert.match(text, /Notify while a question waits sends the result twiceapp\/teams-beside\.js:418Hunter 3 — a failing testa \|\| b is read as one/);
    assert.match(text, /Unsure · 1Off by one in the lexerlex\.js:9Not covered · 1P4's Verifier card/);
    assert.match(text, /The whole result, as its lead wrote it/);
    assert.match(text, /Send to your agent…Verify, then send…Ask its leadyour agent has not seen it$/);
    body.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "app/teams-beside.js:418").dispatch("click");
    for (const words of ["Send to your agent…", "Verify, then send…", "Ask its lead"]) body.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent.endsWith(words)).dispatch("click");
    assert.deepEqual(did, [["file", "app/teams-beside.js:418"], "send", "verify", "ask"]);
    // (fails before: yes — the foot of a result its switch could not hand on said "your agent has not seen it" alone)
    r = row({ notify: true, missed: "the result could not reach the main agent: HTTP 502" });
    for (const fn of watchers) fn();
    const seen = body.querySelector(".trp-seen");
    assert.deepEqual([seen.className, seen.textContent, !!body.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent.endsWith("Send to your agent…"))],
      ["trp-seen is-missed", "Filament tried to hand it to your agent when the team ended and could not (HTTP 502): your agent has not seen it — Send to your agent… still sends it", true]);
    // Sent: the foot says so, and offers it no more.
    r = row({ notified: { n: 1, at: NOW, how: "sent" } });
    for (const fn of watchers) fn();
    assert.match(body.textContent, /Ask its leadSent to your agent$/);
    letGo();
    assert.equal(watchers.size, 0, "let go: it follows nothing");
  });

  // (fails before: yes — seen in a real page, 11-11: a title and a note kept their backticks in the transcript's mark
  // and beside the chat)
  test("a finding's title in the mark and beside the chat, and its note there: code drawn as code, and markup in them text", async () => {
    const coded = row({ findings: { counts: { found: 1 }, top: [CODE], total: 1 } });
    Object.assign(besideActions, { row: () => coded, watch: () => () => {} });
    const mark = /** @type {any} */ (besideMarkRow({ type: "team", event: "result", id: "t1", at: NOW, afterTurn: 1 }));
    const inMark = mark.querySelector(".bes-finding-t");
    assert.deepEqual([inMark.querySelectorAll("code").map((/** @type {any} */ c) => c.textContent), inMark.textContent, inMark.innerHTML, mark.querySelectorAll("img").length],
      [["flush()"], "flush() sends twice while <img src=x onerror=alert(1)> waits", "", 0]);
    const text = "Merged.\n\nFindings:\n- Found | `flush()` sends twice while <img src=x onerror=alert(1)> waits | app/teams-beside.js:418 | Hunter 3 — `npm test` fails <b>here</b>";
    const body = /** @type {any} */ (document.createElement("div"));
    const letGo = renderResultPane(body, {
      load: async () => ({ id: "t1", n: 1, team: { key: "bug-hunter", name: "Bug Hunter" }, ask: "x", firedBy: "you", at: NOW, text, message: "m", findings: findingsOf(text) }),
      row: () => coded,
      watch: () => () => {},
      send: () => {},
      verify: () => {},
      ask: () => {},
      openFile: () => {},
      now: () => NOW,
    });
    await settle();
    const top = body.querySelector(".trp-f-top b");
    const note = body.querySelector(".trp-f-note");
    assert.deepEqual([top.querySelectorAll("code").map((/** @type {any} */ c) => c.textContent), top.textContent, top.innerHTML],
      [["flush()"], "flush() sends twice while <img src=x onerror=alert(1)> waits", ""]);
    assert.deepEqual([note.querySelectorAll("code").map((/** @type {any} */ c) => c.textContent), note.textContent, note.innerHTML, note.querySelectorAll("b").length, body.querySelector(".trp-f").querySelectorAll("img").length],
      [["npm test"], "Hunter 3 — npm test fails <b>here</b>", "", 0, 0]);
    letGo();
  });

  // (fails before: yes — found by the Bug Hunter, 10-19: Dismissed findings fell under "Not covered · N", N theirs alone)
  test("beside the chat: Not covered and Dismissed, each under its own head with its own count", async () => {
    const text = "Checked.\n\nFindings:\n- Confirmed | A real one | a.js:1 | yes\n- Dismissed | Not a bug | b.js:2 | the guard exists\n- Dismissed | Nor this | c.js:3 | tested\n- Not covered | The adapters | - | not read";
    const body = /** @type {any} */ (document.createElement("div"));
    const letGo = renderResultPane(body, {
      load: async () => ({ id: "t2", n: 1, team: { key: "verifier", name: "Verifier" }, ask: "x", firedBy: "you", at: NOW, text, message: "m", findings: findingsOf(text) }),
      row: () => row(),
      watch: () => () => {},
      send: () => {},
      verify: () => {},
      ask: () => {},
      openFile: () => {},
      now: () => NOW,
    });
    await settle();
    assert.match(body.textContent, /Not covered · 1The adapters[\s\S]*Dismissed · 2Not a bug/);
    letGo();
  });

  // (fails before: yes — seen on the stage, 11-11: the page reloaded with a result's tab open drew the tab before the
  // chat was read, asked `/sessions//beside/<id>/result`, and said "could not be read: no team beside this chat answers
  // to that id" for as long as the tab stood, Open beside showing the same tab again)
  test("beside the chat: a result that could not be read is read again when the teams beside are, and stands once read", async () => {
    /** @type {Set<() => void>} */
    const watchers = new Set();
    let ready = false;
    let asked = 0;
    const body = /** @type {any} */ (document.createElement("div"));
    const letGo = renderResultPane(body, {
      load: async () => {
        asked += 1;
        if (!ready) throw new Error("no team beside this chat answers to that id");
        return { id: "t1", n: 1, team: { key: "bug-hunter", name: "Bug Hunter" }, ask: "x", firedBy: "you", at: NOW - 60_000, text: HUNT, message: "m", findings: findingsOf(HUNT) };
      },
      row: () => row(),
      watch: (fn) => (watchers.add(fn), () => watchers.delete(fn)),
      send: () => {},
      verify: () => {},
      ask: () => {},
      now: () => NOW,
    });
    await settle();
    assert.match(body.textContent, /^Its result could not be read: no team beside this chat answers to that id/);
    // The list beside is read (the chat known by then): the result is asked for again, once.
    ready = true;
    for (const fn of watchers) fn();
    for (const fn of watchers) fn();
    await settle();
    assert.match(body.textContent, /^Bug Hunter · resultdone 1 min ago · 10 workers2 found/);
    assert.equal(asked, 2, "one read under way at a time");
    // Read: the list read again asks for nothing more.
    for (const fn of watchers) fn();
    await settle();
    assert.equal(asked, 2);
    letGo();
  });

  test("the message box's attachment: a team's result as a card of its own, one per team", () => {
    let changes = 0;
    const atts = createAttachments({ onChange: () => changes++ });
    const item = { kind: "team", name: "Bug Hunter's result", line: "7 found, 3 plausible", size: 12_400, text: "x".repeat(12_400), team: { id: "t1", n: 1, main: "c1" } };
    atts.put(item);
    atts.put({ ...item, line: "8 found" });
    assert.equal(atts.list().length, 1, "the newest in its place");
    assert.equal(changes, 2);
    const el = /** @type {any} */ (atts.el);
    assert.equal(el.textContent, "Bug Hunter's result · 8 found≈3k tokens · whole, as its lead wrote it");
    assert.ok(el.querySelectorAll(".att")[0].classList.contains("is-team"));
    el.querySelectorAll("button")[0].dispatch("click");
    assert.equal(atts.list().length, 0);
  });
});

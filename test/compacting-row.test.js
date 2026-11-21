// The Compacting row (HarnessV4_Tasks U3-5, UX-8): a compaction under way, said at the transcript's end while it
// runs — who writes, what has been written, how long it has run, how long since the last byte, and its Stop — from
// what the server says of it on the events feed (`compaction-progress`). Before this step the server said all of it
// and no page read it: a Compact was a wait on silence. Its words and its row on the fake DOM, and where the page
// wires it; then the finished row's own words.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compactingParts, compactingRow, ranFor, QUIET_MS } from "../src/ui/harness/conversation/compacting.js";
import { compactionFacts, compactionCostWords, undoWords } from "../src/ui/harness/lib/labels.js";
import { afterCompactionCost } from "../src/ui/harness/conversation/history.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";

const T0 = 1_800_000_000_000;
/** What the server says of a compaction, 42 s in. @param {Record<string, any>} [o] */
const said = (o = {}) => ({ door: "manual", since: T0, step: "claude-opus-5-5 writes the summary in one call", percent: null, calls: { running: 1, done: 0 }, thinkingChars: 0, textChars: 0, lastByteAt: null, ...o });
const NOW = T0 + 42_000;

describe("the Compacting row's words", () => {
  test("a clock for the time run: minutes and seconds, an hour's as h:mm:ss, never under zero", () => {
    assert.deepEqual([ranFor(0), ranFor(42_999), ranFor(72_000), ranFor(3_727_000), ranFor(-5000)], ["0:00", "0:42", "1:12", "1:02:07", "0:00"]);
  });

  test("who writes, what has been written as tokens (an estimate, said as one), the time run", () => {
    assert.deepEqual(compactingParts(said({ textChars: 4960, lastByteAt: NOW - 900 }), NOW), ["claude-opus-5-5 writes the summary in one call", "≈1,240 tokens written", "0:42"]);
  });

  test("before its first step, and while its model only thinks", () => {
    assert.deepEqual(compactingParts(said({ step: null, calls: { running: 0, done: 0 } }), T0 + 400), ["getting ready", "0:00"]);
    assert.deepEqual(compactingParts(said({ thinkingChars: 4000, lastByteAt: NOW - 100 }), NOW), ["claude-opus-5-5 writes the summary in one call", "thinking, ≈1,000 tokens so far", "0:42"]);
    // Once it writes, what it wrote is the figure, with the thinking it did before: a figure that fell from ≈10,000
    // to a few written read as the call begun again (the owner's of 11-07: glm-5.3-flash thought ≈10,500 first).
    assert.deepEqual(compactingParts(said({ thinkingChars: 4000, textChars: 400, lastByteAt: NOW - 100 }), NOW)[1], "≈100 tokens written after ≈1,000 of thinking");
  });

  test("the time since the last byte, once it is a silence; a call that has said nothing yet", () => {
    const quiet = (/** @type {number} */ ms) => compactingParts(said({ textChars: 400, lastByteAt: NOW - ms }), NOW).at(-1);
    assert.equal(quiet(QUIET_MS - 1), "0:42", "a stream that flows says no silence");
    assert.equal(quiet(8000), "last byte 8 s ago");
    assert.equal(quiet(65_000), "last byte 1:05 ago");
    assert.equal(compactingParts(said(), NOW).at(-1), "waiting for the first byte");
    assert.equal(compactingParts(said({ calls: { running: 0, done: 0 } }), NOW).at(-1), "0:42", "no call out: nothing is waited for");
  });

  // (fails before: yes — HarnessV4_Tasks C27: the total was the calls begun so far, so the third slice of eight read
  // "2 of 3 calls done")
  test("a slice pass: its calls done of the total it planned before it began, and its percent — only where the pass knows one", () => {
    const parts = compactingParts(said({ step: "summarizing slice 3", percent: 31.4, calls: { running: 1, done: 2, planned: 8 }, textChars: 8000, lastByteAt: NOW - 200 }), NOW);
    assert.deepEqual(parts, ["summarizing slice 3", "≈2,000 tokens written", "2 of about 8 calls done", "31%", "0:42"]);
    // The pass read more than it planned: the total is never under the calls it has begun.
    assert.equal(compactingParts(said({ calls: { running: 1, done: 9, planned: 8 } }), NOW)[1], "9 of about 10 calls done");
    // With no total planned (digests, written side by side), the calls are counted, never out of a total made up.
    assert.equal(compactingParts(said({ calls: { running: 2, done: 3 } }), NOW)[1], "3 done, 2 running");
    assert.ok(!compactingParts(said({ textChars: 8000, lastByteAt: NOW }), NOW).some((p) => p.endsWith("%")), "no percent is made up for one call");
  });

  test("a coding agent compacting its own session: who, and its summary as it streams it", () => {
    const own = said({ own: true, step: "Claude Code compacts its own session", calls: { running: 0, done: 0 }, textChars: 4960, lastByteAt: NOW - 300 });
    assert.deepEqual(compactingParts(own, NOW), ["Claude Code compacts its own session", "≈1,240 tokens written", "0:42"]);
    assert.equal(compactingParts(said({ own: true, step: null, calls: { running: 0, done: 0 } }), NOW)[0], "the agent compacts its own session");
  });
});

describe("the row", () => {
  test("says the words, ticks its clocks between the server's words, and shows Stop only where there is one", async () => {
    const row = compactingRow({ h: fakeH });
    row.set(said({ textChars: 4960, lastByteAt: NOW - 900 }), {}, NOW);
    assert.equal(textOf(row.el), "⌁ Compacting| · claude-opus-5-5 writes the summary in one call · ≈1,240 tokens written · 0:42|Stop");
    const [stop] = buttonsOf(row.el);
    assert.equal(stop.classList.contains("hidden"), true, "no stop was given: none is shown");
    row.tick(NOW + 9000);
    assert.equal(textOf(row.el), "⌁ Compacting| · claude-opus-5-5 writes the summary in one call · ≈1,240 tokens written · 0:51 · last byte 9 s ago|Stop");

    let stops = 0;
    /** @type {() => void} */
    let settle = () => {};
    row.set(said({ stoppable: true }), { onStop: () => (stops++, new Promise((res) => (settle = () => res(undefined)))), stopTitle: "Stop writing: nothing is compacted" }, NOW);
    assert.equal(stop.classList.contains("hidden"), false);
    assert.equal(stop.attrs.title, "Stop writing: nothing is compacted");
    stop.dispatch("click");
    stop.dispatch("click");
    assert.deepEqual([stops, stop.disabled], [1, true], "one stop, however often it is pressed while it is asked");
    settle();
    await new Promise((r) => setImmediate(r));
    assert.equal(stop.disabled, false, "a stop that did not end it can be pressed again");
  });
});

// (fails before: yes — U5 phase 3: the card's progress had no bar; the mock draws one under its words)
describe("the card's bar", () => {
  test("filled to the percent the server says, held to 0..100; moving where it says none — no figure made up", () => {
    const row = compactingRow({ h: fakeH, bar: true });
    assert.ok(row.el.attrs.class.includes("has-bar"));
    const track = row.el.kids.find((/** @type {any} */ k) => k?.attrs?.class?.includes("compacting-bar"));
    const fill = track.kids[0];
    row.set(said(), {}, NOW);
    assert.deepEqual([track.classList.contains("is-busy"), fill.attrs.style], [true, ""], "no percent: it moves");
    row.set(said({ percent: 40 }), {}, NOW);
    assert.deepEqual([track.classList.contains("is-busy"), fill.attrs.style], [false, "width:40%"]);
    row.set(said({ percent: 140 }), {}, NOW);
    assert.equal(fill.attrs.style, "width:100%");
    row.set(said({ percent: "soon" }), {}, NOW);
    assert.deepEqual([track.classList.contains("is-busy"), fill.attrs.style], [true, ""], "a percent that is no number: it moves");
    assert.equal(textOf(row.el), "⌁ Compacting| · claude-opus-5-5 writes the summary in one call · 0:42 · waiting for the first byte|Stop", "the bar says no words");
    assert.equal(compactingRow({ h: fakeH }).el.attrs.class, "compacting-row", "the transcript's row has none");
  });
});

describe("where the page wires it", () => {
  const src = (/** @type {string} */ f) => readFileSync(new URL(`../src/ui/harness/${f}`, import.meta.url), "utf8");

  test("the transcript keeps a place for it after the last turn, and one clock for it", () => {
    const t = src("conversation/timeline.js");
    // After the turns, outside their column — the card `/compaction` brings up stands over it (10-18); the waiting line
    // under it (waiting-on.js).
    assert.match(t, /const tail = h\("div", \{ class: "transcript-tail" \}, liveLine\.el, compactSlot, waitSlot\);[\s\S]{0,900}?scroller\.append\(inner, summonedSlot, tail\);/);
    // Its own place in the tail, under the live line (proposal_ux §4.3): a row it adds or takes leaves the line be.
    assert.match(t, /compactSlot\.replaceChildren\(row\.el\);/);
    // A card's Compact and send shows it on the card instead (HarnessV4_Tasks U11), no row beside it.
    assert.match(t, /compacting\(progress, o = \{\}\) \{\s+compactingSaid = progress \? \{ p: progress, o \} : null;\s+\/\/ [^\n]+\n\s+if \(cardWork\) \{\s+cardWork\(progress, o\);\s+progress = null;\s+\}\s+if \(!progress\) \{\s+clearInterval\(compactingTimer\);/);
    assert.match(t, /compactingTimer = setInterval\(\(\) => row\.tick\(\), 1000\);/);
  });

  test("the feed's word of a compaction is kept by its session, and the open chat's is drawn; a chat opened later draws its own", () => {
    const app = src("app.js");
    assert.match(app, /onBus\(\(msg\) => \{\s+if \(msg\?\.type !== "compaction-progress" \|\| !msg\.chainId\) return;\s+state\.compactingHeard\.set\(String\(msg\.chainId\), Date\.now\(\)\);\s+noteCompacting\(String\(msg\.chainId\), msg\.progress \|\| null\);\s+\}\);/);
    const select = app.slice(app.indexOf("function selectChat("), app.indexOf("\n}\n", app.indexOf("function selectChat(")));
    assert.match(select, /if \(drawnChat\.chat !== chat \|\| drawnChat\.turns !== chat\.turns\) drawChat\(chat\);\s+paintCompacting\(chat\);/);
    // The transcript's word of it is taken only where the feed has said nothing newer: a read that comes back after the
    // compaction's end must not stand its row up again.
    assert.match(app, /if \(\(state\.compactingHeard\.get\(String\(chat\.chainId\)\) \|\| 0\) < asked\) noteCompacting\(String\(chat\.chainId\), tr\.compacting \|\| null\);/);
  });

  test("its stop: the compaction's own where the server says it has one, else the turn's it runs in; a stop the person asked for is no error", () => {
    const app = src("app.js");
    const paint = app.slice(app.indexOf("function paintCompacting("), app.indexOf("\n}\n", app.indexOf("function paintCompacting(")));
    assert.match(paint, /if \(p\.stoppable\) return transcript\.compacting\(p, \{ onStop: \(\) => stopCompaction\(chat\), stopTitle: "Stop writing: nothing is compacted" \}\);/);
    assert.match(paint, /if \(chat\.live\) return transcript\.compacting\(p, \{ onStop: \(\) => stopCurrent\(\), stopTitle: "Stop the turn: its compaction stops with it, and your message is not sent" \}\);/);
    assert.match(paint, /transcript\.compacting\(p\);\s*$/);
    assert.match(app, /api\(`\/sessions\/\$\{encodeURIComponent\(String\(chat\.chainId\)\)\}\/compact\/stop`, \{ method: "POST", body: \{\} \}\)/);
    assert.match(app, /const stopped = \/\*\* @type \{any\} \*\/ \(e\)\?\.body\?\.stopped === true;[\s\S]{0,500}?\n\s+if \(sending\) return stopped \? "Stopped: nothing was compacted, and your message waits here\." : [^\n]+\n\s+if \(stopped\) toast\("Compaction stopped: nothing was written"\);\s+else toast\(errText\(e\), "err"\);/);
  });

  test("a dropped end leaves no row standing: the five-second resync reads the compactions running now", () => {
    const app = src("app.js");
    assert.match(app, /sidebar\.loadHolders\(\)\.then\(\(r\) => \{\s+syncCompacting\(r\);/);
    // The read also sets the running commands right (E38) — and the flows, the Spaces' buttons running (10-29) and each
    // chat's work stretch (11-03) — before it answers: the window is theirs too.
    assert.match(src("sidebar.js"), /const r = await api\("\/sessions\/holders"\);[\s\S]{0,3600}?return r;\s+\} catch \{\s+return null;\s+\}/);
  });
});

describe("the finished compaction's row", () => {
  // (fails before: yes — the time was printed only for a coding agent's own compaction; a summary Filament wrote had none
  // to print, and none was kept)
  test("says how long any compaction took: seconds under a minute, minutes and seconds from one", () => {
    assert.equal(compactionFacts({ detail: { before: 380_000, after: 41_000, exact: false, model: "claude-opus-5-5", how: "call", ms: 72_000 } }), " · 380k → ≈41k · 1m 12s · claude-opus-5-5");
    assert.equal(compactionFacts({ detail: { before: 131_000, after: 68_000, exact: false, model: "agent/grok-4.6", how: "slices", calls: 3, ms: 8400 } }), " · 131k → ≈68k · 8.4 s · grok-4.6, in 3 slices");
    assert.equal(compactionFacts({ detail: { before: 120_000, after: 18_000, exact: true, model: "ag/fake-a", how: "agent-own", ms: 31_000 } }), " · 120k → 18k · 31.0 s · ag/fake-a", "an agent's own, as before");
    assert.equal(compactionFacts({ detail: { before: 50_000, after: 20_000, exact: true, model: null, how: "local", ms: 0 } }), " · 50k → 20k", "a fold takes no time worth saying");
  });

  // (fails before: yes — HarnessV4_Tasks U3-11, V4-D89: the row never said what its compaction cost)
  test("the row says what the compaction cost, after who wrote it: paid, a plan beside its list price, a list price alone, nothing where none is known", () => {
    const d = { before: 380_000, after: 41_000, exact: true, model: "claude-opus-5-5", how: "call", ms: 72_000 };
    const facts = (/** @type {any} */ cost) => compactionFacts({ detail: { ...d, cost } });
    assert.equal(facts({ paid: 0.0421, list: 0.0421, calls: 1 }), " · 380k → 41k · 1m 12s · claude-opus-5-5 · cost $0.0421");
    assert.equal(facts({ paid: 0, list: 0.29, calls: 3 }), " · 380k → 41k · 1m 12s · claude-opus-5-5 · on your plan ($0.2900 at list price)");
    assert.equal(facts({ paid: 0, list: null, calls: 1 }), " · 380k → 41k · 1m 12s · claude-opus-5-5 · on your plan");
    assert.equal(facts({ paid: 0.05, list: 0.29, calls: 1 }), " · 380k → 41k · 1m 12s · claude-opus-5-5 · cost $0.0500 ($0.2900 at list price)", "a provider's own charge");
    assert.equal(facts({ paid: null, list: 0.05, calls: 1 }), " · 380k → 41k · 1m 12s · claude-opus-5-5 · $0.0500 at list price");
    assert.equal(facts({ paid: 0, list: 0, calls: 1 }), " · 380k → 41k · 1m 12s · claude-opus-5-5 · cost $0.0000", "a model priced at nothing");
    assert.equal(facts({ paid: null, list: null, calls: 1 }), " · 380k → 41k · 1m 12s · claude-opus-5-5");
    assert.equal(facts(undefined), " · 380k → 41k · 1m 12s · claude-opus-5-5");
    assert.equal(compactionCostWords(null), "");
    // Before what came back: the cost is the summary's, the files are after it.
    assert.equal(compactionFacts({ detail: { ...d, cost: { paid: 0.01, list: 0.01, calls: 1 }, attached: { shown: 2 } } }), " · 380k → 41k · 1m 12s · claude-opus-5-5 · cost $0.0100 · 2 files brought back");
  });

  // (fails before: yes — HarnessV4_Tasks U3-11: the cost lands a beat after the row is drawn; nothing put it on the
  // row until the chat was read again)
  test("a cost said on the feed lands on its row: the turn that carries it is drawn again, no other", () => {
    const turns = [
      { n: 1, boundaries: [], boundariesAfter: [] },
      { n: 2, boundaries: [], boundariesAfter: [{ type: "compaction", id: 4, detail: { before: 9, after: 3 } }, { type: "settings" }] },
      { n: 3, boundaries: [{ type: "compaction", id: 5, detail: null }], boundariesAfter: [] },
    ];
    const cost = { paid: 0.04, list: 0.04, calls: 2 };
    assert.deepEqual(afterCompactionCost(turns, 4, cost).map((t) => t.n), [2]);
    assert.deepEqual(turns[1].boundariesAfter[0].detail, { before: 9, after: 3, cost });
    assert.deepEqual(afterCompactionCost(turns, 5, cost).map((t) => t.n), [3]);
    assert.deepEqual(turns[2].boundaries[0].detail, { cost }, "a row that kept no figures takes it");
    assert.deepEqual(afterCompactionCost(turns, 4, cost), [], "said again: nothing to draw");
    assert.deepEqual(afterCompactionCost(turns, 99, cost), [], "a row this page does not hold");
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /msg\?\.type !== "compaction-cost"[\s\S]{0,700}afterCompactionCost\(chat\.turns, Number\(msg\.id\), msg\.cost\)[\s\S]{0,200}transcript\.drawBoundaries\(t\)/, "the page hears it on the events feed");
  });

  // (fails before: yes — the look of U3-11: at 1,000 wide the row's words, never wrapping, pushed Show summary and Undo
  // past the transcript's column, their own words broken over two lines)
  test("narrow, the row's words wrap inside its pill and its buttons stay whole", () => {
    const css = readFileSync(new URL("../src/ui/harness/aqua.css", import.meta.url), "utf8");
    assert.match(css, /\.boundary-row\.is-compaction \.boundary-label \{[^}]*white-space: normal;[^}]*height: auto;[^}]*min-height: 24px;[^}]*min-width: 0;/);
    assert.match(css, /\.boundary-row\.is-compaction \.boundary-toggle \{[^}]*flex: none;[^}]*white-space: nowrap;/);
  });

  // (fails before: yes — HarnessV4_Tasks U3.6: Undo said the same of every compaction; after an agent's own, nothing
  // said whether its session from before comes back or a fresh one starts)
  test("Undo says what it does: an agent's own compaction forked first, one in its live session, any other", () => {
    assert.equal(undoWords({ method: "summary" }), "Take this compaction back: the next request sees those turns as it did before");
    assert.equal(undoWords({ method: "own", detail: { forked: true } }), "Take this compaction back: the agent's session from before it comes back (it was forked first)");
    assert.equal(undoWords({ method: "own", detail: {} }), "Take this compaction back: the agent starts a fresh session from Filament's copy of the chat (its own session was not forked first)");
    const t = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
    assert.match(t, /class: "boundary-toggle is-undo", type: "button", title: undoWords\(b\), onclick:/);
  });

  test("its summary opens under words that say what opens", () => {
    const t = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
    assert.match(t, /toggle\.textContent = text\.hidden \? "Show summary" : "Hide summary";/);
    assert.match(t, /\}, "Show summary"\);/);
  });
});

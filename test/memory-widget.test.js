// @ts-check
// The Memory instrument (HarnessV3-Memory M6-4): the pill counts the turn's memories and wears a dot when memory spoke
// at a call or asks something; the popover draws what memory did for the turn from the view (`view.memory`, the app's
// read of M6-1) — at the calls, this turn, said this turn, memory asks — and every action goes through the context's
// memory door with the claim's id. DOM-free: the fake `h` and a recording popover.
import { test } from "node:test";
import assert from "node:assert/strict";
import { featureWidget } from "../src/ui/harness/widgets/frame.js";
import { memoryWidget } from "../src/ui/harness/widgets/memory.js";
import { claimLine, questionWords, mayConfirm, kindWord, eventWords, SURE_LINE } from "../src/ui/lib/claims.js";
import { CONFIDENCE_GATE } from "../src/services/memory/brain.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf, recordingPopover } from "./helpers/fake-dom.js";

const ON = { effective: { memory: { enabled: true } }, sources: { "memory.enabled": "default" } };
const rule = { id: "i12", kind: "rule", text: "Don't run npm test bare here: run it with env -u CLAUDECODE.", status: "confirmed", trust: "user corrected", sure: 0.91, backed: 2, flags: [], triggers: [{ shape: "npm test", unless: "env -u CLAUDECODE", source: "words", fired: 3, followed: 1 }] };
const fact = { id: "i7", kind: "fact", text: "The api listens on port 8080.", status: "inferred", trust: "inferred", sure: 0.62, backed: 1, flags: ["file changed since"] };
const old = { id: "i5", text: "We use pnpm for package installs.", status: "superseded" };
const bun = { id: "i20", kind: "rule", text: "We use bun for package installs.", status: "confirmed", trust: "user corrected", sure: 0.95, backed: 1, flags: [], replaces: [old] };
const question = { id: "q3", kind: "retire", proposal: { action: "retire", id: 7 }, reason: "its file src/api.js changed", claims: [{ id: "i7", text: fact.text }] };
const TURN = {
  session: "c1", turn: 4, project: "p1", count: 3, tokens: 1240,
  briefing: { turn: 1, count: 6, tokens: 900 },
  shown: [
    { ...rule, layers: ["briefing", "pitfall"], used: true },
    { ...fact, layers: ["turn", "brief"], used: false },
    { id: "s:c0:2", kind: "words", session: "c0", turn: 2, title: "Port move", layers: ["turn"], used: null },
  ],
  reminders: [{ kind: "pitfall", shape: "npm test", unless: "env -u CLAUDECODE", times: 2, followed: true, claim: rule }, { kind: "thread", file: "src/api.js", times: 1, claim: { id: "i9", kind: "thread", text: "Finish the port move in src/api.js." } }],
  said: [bun],
  asks: { count: 4, first: [question] },
};

/** A context over a fixed view whose memory door records each call; `engine` is where memory's engine stands. @param {any} view @param {any} [engine] */
function ctxOf(view, engine = null) {
  /** @type {any[]} */
  const calls = [];
  const door = (/** @type {string} */ name) => async (/** @type {any[]} */ ...a) => { calls.push([name, ...a]); return { ok: true }; };
  const ctx = /** @type {any} */ ({
    view: () => view,
    hasSession: () => true,
    write: () => {},
    command: () => {},
    openPage: (/** @type {string} */ page) => calls.push(["openPage", page]),
    memoryEngine: () => engine,
    toast: (/** @type {string} */ msg, /** @type {string} */ kind) => calls.push(["toast", msg, kind]),
    memory: { confirm: door("confirm"), correct: door("correct"), forget: door("forget"), answer: door("answer") },
  });
  return { ctx, calls };
}
/** The widget opened on a recording popover. @param {any} view @param {any} [engine] */
function open(view, engine = null) {
  const { ctx, calls } = ctxOf(view, engine);
  const spec = memoryWidget(ctx, { h: fakeH, drawIn: fakeDrawIn });
  const { popover, pops } = recordingPopover();
  const w = featureWidget(spec, { h: fakeH, drawIn: fakeDrawIn, popover });
  /** @type {any} */ (w.el).dispatch("click");
  return { spec, w, calls, body: () => pops[0].body };
}
/** A button by its accessible name. @param {any} body @param {string} name */
const button = (body, name) => buttonsOf(body).find((b) => b.attrs["aria-label"] === name);
/** The classes of the popover's notes that speak of the engine, in order. @param {any} el @returns {string[]} */
const engineNotes = (el) => {
  /** @type {string[]} */
  const out = [];
  /** @param {any} n */
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (String(n.attrs?.class || "").startsWith("inst-note") && /engine/i.test(textOf(n))) out.push(n.attrs.class);
    for (const k of n.kids || []) walk(k);
  };
  walk(el);
  return out;
};
const settle = () => new Promise((r) => setImmediate(r));

test("the pill: the turn's memories counted, a dot when memory spoke at a call or asks something; the figures before the read lands", () => {
  const { spec } = open({ settings: ON, memory: TURN });
  assert.equal(spec.state(), "3");
  assert.deepEqual(spec.marks?.(), { acted: false, asking: true }, "a question waits on the user: its dot wins");
  assert.equal(spec.title?.(), "Memory: 3 in the last turn · 2 reminders at its calls · 4 questions for you");
  const quiet = open({ settings: ON, memory: { ...TURN, asks: { count: 0, first: [] } } }).spec;
  assert.deepEqual(quiet.marks?.(), { acted: true, asking: false });
  const before = open({ settings: ON, facts: { memory: { injected: 2, tokens: 80 } } }).spec;
  assert.deepEqual([before.state(), before.marks?.()], ["2", { acted: false, asking: false }], "until the read lands, the turn's figures");
  const muted = open({ settings: { effective: { memory: { enabled: false } }, sources: { "memory.enabled": "session" } }, memory: TURN }).spec;
  assert.deepEqual([muted.state(), muted.marks?.()], ["Muted", { acted: false, asking: false }]);
});

// (fails before: yes — the widget read the session's own switch alone: a chat Memory settings leave out was drawn as one
// memory works in — the pill "3" with the asking dot and "recalled", "On · learning from this session", the switches as
// though they decided)
test("a chat Memory settings leave out: the pill says Left out, the popover and the tile say why and that nothing is recalled or learned, and no switch of the session's decides it", () => {
  const OUT = 'model "brain-out" is excluded in Memory settings';
  const view = { settings: { ...ON, engine: { leftOut: OUT } }, memory: TURN };
  const { spec, body } = open(view, { state: "missing", error: "memory engine uv: download failed" });
  assert.deepEqual([spec.state(), spec.marks?.(), spec.more?.()], ["Left out", { acted: false, asking: false }, ""]);
  assert.equal(spec.title?.(), `Memory: left out of this chat — ${OUT}`);
  const text = textOf(body());
  assert.match(text, new RegExp(`Left out · ${OUT.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&")}`));
  assert.match(text, /Memory settings leave this chat out: nothing is recalled into it, nothing is learned from it, and no other chat reads it\. Its turns are kept for the chat itself\./);
  assert.doesNotMatch(text, /learning from this session|At the call|This turn|Memory asks|its engine/i, "nothing of what memory does elsewhere");
  /** Every node of a drawn tree whose attributes `ok` takes. @param {any} n @param {(a: any) => boolean} ok @returns {any[]} */
  const nodesOf = (n, ok) => (!n || typeof n !== "object" ? [] : [...(ok(n.attrs || {}) ? [n] : []), ...(n.kids || []).flatMap((/** @type {any} */ k) => nodesOf(k, ok))]);
  const switches = nodesOf(body(), (a) => a.role === "switch");
  assert.equal(switches.length, 4);
  assert.ok(switches.every((s) => "disabled" in s.attrs), "no switch of the session's decides it");
  const drawn = /** @type {any} */ (spec);
  const trail = textOf(fakeH("div", {}, drawn.tileTrail(fakeH)));
  const tile = textOf(fakeH("div", {}, ...drawn.tile(fakeH)));
  assert.equal(trail, "left out here");
  assert.match(tile, new RegExp(`^Left out.*Memory settings leave this chat out \\(${OUT.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&")}\\): nothing is recalled into it and nothing is learned from it\\.$`));
});

test("the popover: at the call, this turn, said this turn and memory asks, each memory with what memory knows of it", () => {
  const { body } = open({ settings: ON, memory: TURN });
  const text = textOf(body());
  for (const want of [
    "3|memories",
    "in the last turn · 1.2K tokens · 2 reminders at its calls",
    "At the call",
    "On npm test · said 2 times · followed",
    "Open thread · on src/api.js",
    "This turn",
    "in the briefing, at a call · used · user corrected · ✓2 · 91% sure",
    "recalled, in an agent's brief · inferred · 62% sure · file changed since",
    "Words from “Port move”, turn 2",
    "Said this turn",
    "replaces “We use pnpm for package installs.” · user corrected · 95% sure",
    "Memory asks (4)",
    "Retire “The api listens on port 8080.”",
    "its file src/api.js changed",
  ])
    assert.ok(text.includes(want), `${want}\n---\n${text}`);
  assert.ok(text.indexOf("At the call") < text.indexOf("This turn") && text.indexOf("This turn") < text.indexOf("Said this turn") && text.indexOf("Said this turn") < text.indexOf("Memory asks"));
  // A confirmed claim offers no Confirm; past words and the reminders offer nothing to do.
  assert.equal(button(body(), "Confirm i12: it is right"), undefined);
  assert.ok(button(body(), "Confirm i7: it is right"));
  assert.equal(buttonsOf(body()).filter((b) => /s:c0:2/.test(String(b.attrs["aria-label"]))).length, 0);
});

// (fails before: yes — the pill said the turn's count and nothing said the engine was installing)
test("memory getting ready (HarnessV3-AtHome AH-D2): the install's percent is the pill; its words say how it installs and what memory does meanwhile", () => {
  const installing = { state: "installing", percent: 40, source: "bundle", auto: true };
  const { spec, body } = open({ settings: ON, memory: TURN }, installing);
  assert.equal(spec.state(), "40%");
  assert.deepEqual(spec.marks?.(), { acted: false, asking: false }, "the percent stands alone");
  // (fails before: no — added for the mutant that let the reminders' dot through) with no question asked, too
  const quiet = open({ settings: ON, memory: { ...TURN, asks: { count: 0, first: [] } } }, installing).spec;
  assert.deepEqual(quiet.marks?.(), { acted: false, asking: false }, "the reminders' dot waits for the install as well");
  assert.equal(spec.title?.(), "Memory is getting ready — 40%: installing its engine from the copy that came with Filament");
  const text = textOf(body());
  assert.ok(text.includes("On · getting ready — 40%"), text);
  assert.ok(text.includes("Memory is getting ready — 40%: installing its engine from the copy that came with Filament. Until it's ready, memory recalls by matching words only, not by meaning; sessions are recorded and learned from as usual."), text);
  assert.ok(text.includes("3|memories"), "the turn is drawn as ever");
  // Before the install has said where it takes its packages from, it says only that it installs.
  assert.equal(open({ settings: ON, memory: TURN }, { ...installing, source: null, percent: 0 }).spec.title?.(), "Memory is getting ready — 0%: installing its engine");
  // Memory switched off: the switch is what the pill says, whatever the engine does.
  const muted = open({ settings: { effective: { memory: { enabled: false } }, sources: { "memory.enabled": "session" } }, memory: TURN }, installing);
  assert.deepEqual([muted.spec.state(), muted.spec.title?.()], ["Muted", "Memory: muted for this session"]);
  assert.ok(!textOf(muted.body()).includes("getting ready"));
  // Ready: as ever.
  const ready = open({ settings: ON, memory: TURN }, { state: "ready", source: "bundle" });
  assert.deepEqual([ready.spec.state(), ready.spec.title?.()], ["3", "Memory: 3 in the last turn · 2 reminders at its calls · 4 questions for you"]);
  assert.ok(textOf(ready.body()).includes("On · learning from this session") && !textOf(ready.body()).includes("its engine"));
});

// (fails before: yes — a missing engine was said nowhere in the harness)
test("memory with no engine says so (AH-D2): what memory does without it, and the Memory page installs it", () => {
  const { spec, body, calls } = open({ settings: ON, memory: TURN }, { state: "missing", error: null });
  assert.equal(spec.state(), "3", "the turn's count as ever");
  assert.equal(spec.title?.(), "Memory: 3 in the last turn · 2 reminders at its calls · 4 questions for you · its engine isn't installed");
  const text = textOf(body());
  assert.ok(text.includes("On · its engine isn't installed"), text);
  assert.ok(text.includes("Its engine isn't installed, so memory recalls by matching words only, not by meaning; sessions are recorded and learned from as usual."), text);
  const install = buttonsOf(body()).find((b) => textOf(b) === "Install it on the Memory page");
  assert.ok(install, "a way to install it");
  install.dispatch("click");
  assert.deepEqual(calls, [["openPage", "memory"]]);
  // An install that failed says why.
  const failed = open({ settings: ON, memory: TURN }, { state: "missing", error: "memory engine uv: download failed: getaddrinfo ENOTFOUND github.com" });
  assert.equal(failed.spec.title?.(), "Memory: 3 in the last turn · 2 reminders at its calls · 4 questions for you · its engine didn't install");
  assert.ok(textOf(failed.body()).includes("Its engine didn't install (memory engine uv: download failed: getaddrinfo ENOTFOUND github.com), so memory recalls by matching words only, not by meaning; sessions are recorded and learned from as usual."));
  // (fails before: no — added for the mutants that dropped the warning's tone and said the engine to a muted session)
  // A failure is a warning; an engine not installed yet is not. A session with memory muted hears nothing of the engine.
  assert.deepEqual(engineNotes(failed.body()), ["inst-note is-warn"]);
  assert.deepEqual(engineNotes(body()), ["inst-note"]);
  const muted = open({ settings: { effective: { memory: { enabled: false } }, sources: { "memory.enabled": "session" } }, memory: TURN }, { state: "missing", error: "memory engine uv: download failed" });
  assert.deepEqual([muted.spec.title?.(), engineNotes(muted.body())], ["Memory: muted for this session", []]);
  assert.ok(!/its engine/i.test(textOf(muted.body())), textOf(muted.body()));
  // Before the page has read where the engine stands, nothing is said of it.
  const unread = open({ settings: ON, memory: TURN });
  assert.equal(unread.spec.title?.(), "Memory: 3 in the last turn · 2 reminders at its calls · 4 questions for you");
  assert.equal(buttonsOf(unread.body()).find((b) => textOf(b) === "Install it on the Memory page"), undefined);
  // (fails before: yes — the second Hunter's find: the link sent the person to an Install no page offers) This Filament
  // came without its engine: why, and no Install to go to.
  const why = "this Filament has no memory engine bundle for win32-x64 in C:\\f: reinstall Filament, or in a checkout build it with npm run engine:bundle";
  const none = open({ settings: ON, memory: TURN }, { state: "missing", error: null, why });
  assert.ok(textOf(none.body()).includes(`Its engine isn't installed, and can't be: ${why}.`), textOf(none.body()));
  assert.equal(buttonsOf(none.body()).find((b) => textOf(b) === "Install it on the Memory page"), undefined);
});

// (fails before: yes — lead 1 of the 11-02 privacy round: the popover said "Turn capture is off in Memory settings: nothing
// is learned from this chat." right above "…sessions are recorded and learned from as usual.", while the engine
// installed and while it was missing alike)
test("where memory learns nothing from the chat, the engine's note says what recall does without it, and nothing of learning or recording", () => {
  const why = "turn capture is off in Memory settings: nothing is learned from this chat";
  const view = { settings: { ...ON, engine: { learnsNothing: why } }, memory: TURN };
  for (const engine of [{ state: "installing", percent: 40, source: "bundle", auto: true }, { state: "missing", error: null }, { state: "missing", error: "no network" }, { state: "missing", error: null, why: "no bundle here" }]) {
    const text = textOf(open(view, engine).body());
    assert.ok(text.includes("Turn capture is off in Memory settings: nothing is learned from this chat."), text);
    assert.ok(text.includes("memory recalls by matching words only, not by meaning."), `${engine.state}: ${text}`);
    assert.doesNotMatch(text, /learned from as usual|sessions are recorded/, `${engine.state} ${engine.error || engine.why || ""}`);
  }
  // An outside client's chat whose new turns are kept no more: nothing says they are recorded either.
  const outside = { settings: { ...ON, engine: { learnsNothing: "turn capture is off in Memory settings: none of its new turns is kept" } }, memory: TURN };
  assert.doesNotMatch(textOf(open(outside, { state: "missing", error: null }).body()), /recorded|learned from as usual/);
  // Where memory learns from the chat, the note says so as ever.
  assert.ok(textOf(open({ settings: ON, memory: TURN }, { state: "missing", error: null }).body()).includes("sessions are recorded and learned from as usual."));
});

test("an empty turn draws the hero and the switches alone", () => {
  const { body } = open({ settings: ON, memory: { ...TURN, count: 0, tokens: 0, shown: [], reminders: [], said: [], asks: { count: 0, first: [] } } });
  const text = textOf(body());
  assert.ok(text.includes("0|memories"), text);
  for (const gone of ["At the call", "This turn", "Said this turn", "Memory asks"]) assert.ok(!text.includes(gone), gone);
  assert.ok(text.includes("Memory for this session") && text.includes("Recall into each turn"));
});

test("each action goes through the memory door with its id; Correct opens the words in place, and Save sends what is true now", async () => {
  const { body, calls } = open({ settings: ON, memory: TURN });
  button(body(), "Confirm i7: it is right").dispatch("click");
  await settle();
  button(body(), "Retire i12: it is not true").dispatch("click");
  await settle();
  button(body(), "Accept q3: Retire “The api listens on port 8080.”").dispatch("click");
  await settle();
  button(body(), "Reject q3: memory will not ask it again").dispatch("click");
  await settle();
  assert.deepEqual(calls, [["confirm", "i7"], ["forget", "i12"], ["answer", "q3", "accept"], ["answer", "q3", "reject"]]);
  button(body(), "Correct i7").dispatch("click");
  const field = /** @type {any} */ (body()).querySelector(".inst-field");
  assert.ok(field, "the words in a field");
  assert.equal(field.value, fact.text);
  const save = () => buttonsOf(body()).find((b) => textOf(b) === "Save");
  assert.equal(save()?.attrs.disabled, "", "unchanged words save nothing");
  save()?.dispatch("click");
  await settle();
  assert.equal(calls.length, 4, "nothing sent");
  field.dispatch("input", { target: { value: "The api listens on port 9090." } });
  assert.equal("disabled" in (save()?.attrs || {}), false, "new words can be saved, as they are typed");
  save()?.dispatch("click");
  await settle();
  assert.deepEqual(calls.at(-1), ["correct", "i7", "The api listens on port 9090."]);
  assert.equal(/** @type {any} */ (body()).querySelector(".inst-field"), null, "the row is a row again");
});

test("a refusal is said in a toast", async () => {
  const { ctx, calls } = ctxOf({ settings: ON, memory: TURN });
  ctx.memory.forget = async () => ({ ok: false, error: "i12 is already superseded by i20" });
  const spec = memoryWidget(ctx, { h: fakeH, drawIn: fakeDrawIn });
  const { popover, pops } = recordingPopover();
  /** @type {any} */ (featureWidget(spec, { h: fakeH, drawIn: fakeDrawIn, popover }).el).dispatch("click");
  button(pops[0].body, "Retire i12: it is not true").dispatch("click");
  await settle();
  assert.deepEqual(calls, [["toast", "i12 is already superseded by i20", "err"]]);
});

test("Confirm is offered when it says something new: a claim not confirmed yet, or a confirmed one whose file changed since", () => {
  assert.equal(mayConfirm(fact), true);
  assert.equal(mayConfirm(rule), false, "confirmed, nothing changed");
  assert.equal(mayConfirm({ ...rule, flags: ["file changed since"] }), true, "a Confirm checks it afresh (M6-D7)");
  assert.equal(mayConfirm({ ...rule, flags: ["file changed since: no listen"] }), true);
  assert.equal(mayConfirm({ ...rule, flags: ["in question: the user is asked to retire it"] }), false);
  assert.equal(mayConfirm({ ...fact, status: "dismissed" }), false, "a retired one is brought back, not confirmed");
  // The user's own word, though not confirmed: a correction they typed, a thing they said (M6-7).
  const corrected = { ...fact, status: "inferred", trust: "user corrected", flags: [] };
  assert.equal(mayConfirm(corrected), false, "their correction is theirs already");
  assert.equal(mayConfirm({ ...corrected, trust: "user said" }), false);
  assert.equal(mayConfirm({ ...corrected, flags: ["file changed since"] }), true, "its file changed: a Confirm checks it afresh");
  assert.equal(mayConfirm({ ...corrected, trust: "user's words" }), true, "a sentence of theirs read as a preference is not their word on it");
  const { body } = open({ settings: ON, memory: { ...TURN, shown: [{ ...rule, flags: ["file changed since"], layers: ["turn"], used: null }] } });
  assert.ok(button(body(), "Confirm i12: it is right"));
});

test("a memory retired since the turn showed it offers nothing to do, and says so", () => {
  const { body } = open({ settings: ON, memory: { ...TURN, shown: [{ ...fact, status: "dismissed", sure: undefined, layers: ["turn"], used: null }], said: [], reminders: [] } });
  for (const name of ["Confirm i7: it is right", "Correct i7", "Retire i7: it is not true"]) assert.equal(button(body(), name), undefined, name);
  assert.ok(textOf(body()).includes("recalled · inferred · retired since · file changed since"), textOf(body()));
});

test("Esc puts a claim being corrected back, sending nothing", async () => {
  const { body, calls } = open({ settings: ON, memory: TURN });
  button(body(), "Correct i7").dispatch("click");
  const field = /** @type {any} */ (body()).querySelector(".inst-field");
  field.dispatch("input", { target: { value: "The api listens on port 9090." } });
  field.dispatch("keydown", { key: "Escape" });
  assert.equal(/** @type {any} */ (body()).querySelector(".inst-field"), null, "the row is a row again");
  await settle();
  assert.deepEqual(calls, []);
});

test("while one action is on its way the others wait: disabled, and a press does nothing", async () => {
  const { ctx, calls } = ctxOf({ settings: ON, memory: TURN });
  /** @type {(v: any) => void} */
  let release = () => {};
  ctx.memory.confirm = (/** @type {string} */ id) => {
    calls.push(["confirm", id]);
    return new Promise((r) => (release = r));
  };
  const spec = memoryWidget(ctx, { h: fakeH, drawIn: fakeDrawIn });
  const { popover, pops } = recordingPopover();
  /** @type {any} */ (featureWidget(spec, { h: fakeH, drawIn: fakeDrawIn, popover }).el).dispatch("click");
  button(pops[0].body, "Confirm i7: it is right").dispatch("click");
  const retire = button(pops[0].body, "Retire i12: it is not true");
  assert.equal(retire.attrs.disabled, "");
  retire.dispatch("click");
  await settle();
  assert.deepEqual(calls, [["confirm", "i7"]], "nothing else sent while it waits");
  release({ ok: true });
  await settle();
  assert.equal("disabled" in button(pops[0].body, "Retire i12: it is not true").attrs, false, "answered: the actions again");
});

test("a memory's line and a question's words", () => {
  assert.equal(claimLine(rule, ["recalled"]), "recalled · user corrected · ✓2 · 91% sure");
  assert.equal(claimLine({ ...fact, status: "dismissed", sure: undefined }), "inferred · retired since · file changed since");
  assert.equal(claimLine({ ...fact, status: "superseded", sure: undefined, flags: [] }), "inferred · replaced since", "a correction replaced it");
  // A sub-agent's finding names it (M7-D19); one stored by its own call knows no type.
  assert.equal(claimLine({ ...fact, trust: "a sub-agent found", finder: { agent: "sa_0000abcd", type: "explore", model: "m" }, sure: 0.55, flags: [] }), "a sub-agent found · sa_0000abcd (explore) · 55% sure");
  assert.equal(claimLine({ ...fact, trust: "a sub-agent found", finder: { agent: "sa_0000abcd", model: "m" }, sure: undefined, flags: [] }), "a sub-agent found · sa_0000abcd");
  assert.equal(kindWord("permission"), "Memory", "a kind the reader has no word for");
  assert.equal(eventWords({ action: "anchor", by: "filament", detail: { file: "src/api.js", state: "ok" } }), "src/api.js says it again");
  assert.equal(SURE_LINE, CONFIDENCE_GATE, "the pages draw the line where recall does");
  // Held off while the user is asked (M6-D16): waiting on them, not retired (M6-7).
  assert.equal(claimLine({ ...fact, status: "dismissed", sure: undefined, asked: "q3", flags: ["would replace i6 if you say so"] }), "inferred · held for your answer · would replace i6 if you say so");
  assert.equal(questionWords(question), "Retire “The api listens on port 8080.”");
  assert.equal(questionWords({ proposal: { id: 5, replacement: 20 }, claims: [{ id: "i5", text: "pnpm" }, { id: "i20", text: "bun" }] }), "Replace “pnpm” with “bun”");
  assert.equal(questionWords({ proposal: { action: "restore", text: "we deploy on fridays" }, claims: [] }), "Bring back: “we deploy on fridays”");
});

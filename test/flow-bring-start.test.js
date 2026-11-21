// @ts-check
// Bring my uncommitted edits, around Start and after it (HarnessV4_OneAgent_Plan OA5; the hunt of 11-02, bugs 1 and 2).
// Bug 1: a draft's Start waited for nothing — the note that the folder's files stay behind came once the count's route
// answered, and a failed count was nothing, said nowhere, asked again never. Now the route tells a failure from nothing
// to say, the list keeps whether the count is asked and why it failed, the card holds Start while the first count is
// asked and says so, says a failure with Count again, and lets Start go on a failure. Bug 2: a box whose Bring failed
// took its worktree back and failed, and nothing could switch Bring off — the switch lives on the draft's card alone —
// so Retry asked for the copy again. Now the runner marks the box (`failedOn: "bring"`) and its card offers Retry
// without my edits: the switch off for the flow, then the retry, which starts from the last commit alone.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createFlowRunner } from "../src/app/flow-runner.js";
import { createFlowStore } from "../src/services/flow-store.js";
import { SHIPPED_CARDS } from "../src/services/agent-cards.js";
import { OWN_CARDS } from "./helpers/flow-cards.js";
import { SHIPPED_TEAMS } from "../src/services/teams.js";
import { createTeamsBeside } from "../src/app/teams-beside.js";
import { flowRoutes } from "../src/http/admin/flows.js";
import { createRouter } from "../src/http/router.js";
import { BRING_FAILED_WORDS, COUNT_HELD_WORDS, bringFailed, bringNote, countNote, createFlowList } from "../src/ui/harness/lib/flow.js";
import { createFlowCards } from "../src/ui/harness/views/flow.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";

const settled = async () => {
  for (let i = 0; i < 15; i++) await new Promise((r) => setImmediate(r));
};
/** The button under `n` whose words are these. @param {any} n @param {string} words */
const btn = (n, words) => buttonsOf(n).find((b) => textOf(b) === words);
/** @param {any} p @param {any[]} k */
const place = (p, k) => p.replaceChildren(...k);

const ROSTER = {
  cards: [...Object.entries(SHIPPED_CARDS).map(([tag, c]) => ({ tag, name: c.name, goodFor: c.goodFor })), ...OWN_CARDS.map(({ tag, name, goodFor }) => ({ tag, name, goodFor }))],
  teams: Object.entries(SHIPPED_TEAMS).map(([key, t]) => ({ key, name: t.name, readOnly: /** @type {any} */ (t).readOnly === true })),
};
const TREE = { kind: "worktree", name: "flow-a-lexer", branch: "flow-a-lexer", folder: "H:/repo-flow-a-lexer", cwd: "H:/repo-flow-a-lexer" };
// (the plan's p6) Builders builds it: it does the four build teams' work.
const LEXER = { goal: "build a lexer", title: "A lexer", steps: [{ boxes: [{ kind: "team", agent: "builders", words: "Build it.", id: "build" }] }, { boxes: [{ agent: "skeptic", words: "Gate.", id: "check", gate: true, needs: ["build"] }] }] };

/**
 * The flow's runner over fakes: `fire` answers as `fireWith` says — a place, or a refusal thrown.
 * @param {{ uncommitted?: (() => Promise<any>) | null, fireWith?: (input: any) => Promise<any> }} [o]
 */
const world = ({ uncommitted = null, fireWith = async (input) => ({ id: "t1", state: "working", place: input.own?.use || { ...TREE } }) } = {}) => {
  /** @type {any[]} */
  const fired = [];
  const chains = new Map([["c1", { id: "c1", kind: "harness", meta: {} }]]);
  const runner = createFlowRunner({
    store: createFlowStore({ dir: null }),
    archive: () => ({ getChain: (/** @type {string} */ id) => chains.get(id) || null, mergeMeta: () => ({}), besideOf: () => [] }),
    registry: () => ({ notice: () => ({ ok: true }), get: () => null }),
    besides: () => ({
      fire: async (/** @type {string} */ _main, /** @type {any} */ input) => {
        fired.push(input);
        return fireWith(input);
      },
      row: () => null,
      list: () => [],
    }),
    sessions: { besideFacts: () => ({ last: null }) },
    roster: () => ROSTER,
    postTurn: async () => ({ status: 200, body: null }),
    events: { publish: () => {}, subscribe: () => () => {} },
    now: () => 0,
    uncommittedOf: uncommitted,
  });
  return { runner, fired };
};

/** The count's route through the router, as the page calls it. @param {any} runner */
const routeOf = (runner) => {
  const route = createRouter(flowRoutes({ flows: runner }));
  return async (/** @type {string} */ path) => {
    const m = route("GET", path);
    assert.ok(m, path);
    const res = { status: 0, body: "", headersSent: false, setHeader() {}, getHeader() {}, writeHead(/** @type {number} */ s) { this.status = s; this.headersSent = true; return this; }, write(/** @type {string} */ c) { this.body += c; }, end(/** @type {string} */ c = "") { this.body += c; }, on() {} };
    await m.handler(/** @type {any} */ ({ req: { headers: {}, method: "GET", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, path, method: "GET", params: m.params }), /** @type {any} */ ({}));
    return JSON.parse(res.body);
  };
};

describe("the count's route tells a failure from nothing to say (bug 1, the server)", () => {
  // (fails before: yes — git's failure, a throw, and a folder outside git were one `{ uncommitted: null }`)
  test("counted; nothing to say; git could not tell, why in words", async () => {
    const counted = world({ uncommitted: async () => ({ ok: true, count: 3 }) });
    counted.runner.create("c1", LEXER);
    assert.deepEqual(await routeOf(counted.runner)("/sessions/c1/flows/uncommitted"), { uncommitted: 3 });
    const none = world({ uncommitted: async () => ({ ok: true, count: null }) });
    none.runner.create("c1", LEXER);
    assert.deepEqual(await routeOf(none.runner)("/sessions/c1/flows/uncommitted"), { uncommitted: null }, "no worktree would be made: nothing to say");
    const failed = world({ uncommitted: async () => ({ ok: false, error: "git status timed out" }) });
    failed.runner.create("c1", LEXER);
    assert.deepEqual(await routeOf(failed.runner)("/sessions/c1/flows/uncommitted"), { uncommitted: null, error: "git status timed out" });
    const threw = world({ uncommitted: async () => { throw new Error("the folder is gone"); } });
    threw.runner.create("c1", LEXER);
    assert.deepEqual(await routeOf(threw.runner)("/sessions/c1/flows/uncommitted"), { uncommitted: null, error: "the folder is gone" });
  });
});

describe("the page's count: asked, known, failed, asked again (bug 1, the list)", () => {
  /** @param {(path: string) => Promise<any>} answer */
  const listOf = (answer) => {
    /** @type {string[]} */
    const reads = [];
    /** @type {string[]} */
    const seen = [];
    const list = createFlowList({
      call: async (path) => {
        reads.push(String(path));
        return String(path).endsWith("/uncommitted") ? answer(String(path)) : { flows: [{ id: "f1", chainId: "c1", state: "draft", steps: [{ boxes: [{ id: "b", kind: "team", writes: true }] }] }] };
      },
      later: () => 0,
      clear: () => {},
      now: () => 0,
    });
    list.onChange(() => seen.push(JSON.stringify(list.uncommitted())));
    return { list, reads, seen };
  };

  // (fails before: yes — `uncommitted()` was a number or null: nothing said the count was being asked, nor that it failed;
  // then a failed count was asked again on every read of the list, each ask holding Start for the length of a git status)
  test("asked while the route answers, then known; a failed route said in words, not asked again on a read of the list, and Count again asks once more", async () => {
    /** @type {(() => void)[]} */
    const answers = [];
    let fails = true;
    const { list, reads, seen } = listOf(() => new Promise((resolve, reject) => answers.push(() => (fails ? reject(new Error("HTTP 500")) : resolve({ uncommitted: 2 })))));
    const counts = () => reads.filter((p) => p.endsWith("/uncommitted")).length;
    list.setChain("c1");
    await settled();
    assert.deepEqual(list.uncommitted(), { files: null, asking: true, failed: null, answered: false }, "asked, nothing answered yet");
    answers.shift()?.();
    await settled();
    assert.deepEqual(list.uncommitted(), { files: null, asking: false, failed: "HTTP 500", answered: true }, "failed: why, in words");
    await list.refresh();
    await settled();
    assert.equal(counts(), 1, "the list read again, the drafts as they were: the failed count is not asked again");
    fails = false;
    list.recount();
    await settled();
    assert.equal(counts(), 2, "Count again asks");
    assert.deepEqual(list.uncommitted(), { files: null, asking: true, failed: "HTTP 500", answered: true }, "asked again, the failure standing until the answer");
    answers.shift()?.();
    await settled();
    assert.deepEqual(list.uncommitted(), { files: 2, asking: false, failed: null, answered: true });
    assert.ok(seen.includes(JSON.stringify({ files: null, asking: true, failed: null, answered: false })), "the page heard it was asked");
  });

  // (fails before: yes — a draft with reading teams alone asked the count, whose "nothing to say" marked the folder
  // answered, so the first count for a team that writes — the one Start waits for — held nothing)
  test("a draft with reading teams alone asks nothing, so the first count for one that writes holds Start until it answers", async () => {
    /** @type {((v: any) => void)[]} */
    const answers = [];
    /** @type {any[]} */
    let rows = [{ id: "f1", chainId: "c1", state: "draft", place: null, steps: [{ why: "", boxes: [{ id: "r", kind: "team", writes: false }] }] }];
    const list = createFlowList({ call: async (path) => (String(path).endsWith("/uncommitted") ? new Promise((resolve) => answers.push(resolve)) : { flows: rows }), later: () => 0, clear: () => {}, now: () => 0 });
    list.setChain("c1");
    await settled();
    assert.deepEqual(list.uncommitted(), { files: null, asking: false, failed: null, answered: false }, "no team that writes: no worktree, nothing asked");
    rows = [{ ...rows[0], steps: [{ why: "", boxes: [{ id: "r", kind: "team", writes: false }, { id: "w", kind: "team", writes: true }] }] }];
    await list.refresh();
    await settled();
    assert.deepEqual(list.uncommitted(), { files: null, asking: true, failed: null, answered: false }, "a team that writes: asked, and nothing answered for the folder yet");
    assert.equal(countNote(rows[0], list.uncommitted())?.held, true, "Start waits");
    answers.shift()?.({ uncommitted: 2 });
    await settled();
    assert.deepEqual(list.uncommitted(), { files: 2, asking: false, failed: null, answered: true });
  });

  // (fails before: yes — the count was the chat's, reset as the chat changed alone: a chat moved to another folder kept
  // the old folder's count, and Start free on it)
  test("the count is the chat's folder's: a chat moved to another folder drops it and holds Start for the new folder's first; a folder learned late is the one asked for", async () => {
    let n = 0;
    /** @type {any[]} */
    const rows = [{ id: "f1", chainId: "c1", state: "draft", place: null, steps: [{ why: "", boxes: [{ id: "w", kind: "team", writes: true }] }] }];
    const list = createFlowList({ call: async (path) => (String(path).endsWith("/uncommitted") ? { uncommitted: ++n } : { flows: rows }), later: () => 0, clear: () => {}, now: () => 0 });
    list.setChain("c1");
    await settled();
    assert.deepEqual(list.uncommitted(), { files: 1, asking: false, failed: null, answered: true });
    list.setChain("c1", "H:/repo");
    await settled();
    assert.deepEqual(list.uncommitted(), { files: 1, asking: false, failed: null, answered: true }, "the folder learned: the count was its");
    list.setChain("c1", "H:/repo-flow-x");
    assert.deepEqual(list.uncommitted(), { files: null, asking: true, failed: null, answered: false }, "moved: the old folder's count let go, the new one's asked and held");
    assert.equal(countNote(rows[0], list.uncommitted())?.held, true, "Start waits for the new folder's first count");
    await settled();
    assert.deepEqual(list.uncommitted(), { files: 2, asking: false, failed: null, answered: true });
    list.setChain("c1", "H:/repo-flow-x");
    list.setChain("c1");
    assert.deepEqual(list.uncommitted(), { files: 2, asking: false, failed: null, answered: true }, "the same folder, or none said: as it was");
    assert.equal(n, 2);
  });

  test("the route's own error is a failure too; nothing to say is neither a count nor a failure; both are answers", async () => {
    const failed = listOf(async () => ({ uncommitted: null, error: "git status timed out" }));
    failed.list.setChain("c1");
    await settled();
    assert.deepEqual(failed.list.uncommitted(), { files: null, asking: false, failed: "git status timed out", answered: true });
    const none = listOf(async () => ({ uncommitted: null }));
    none.list.setChain("c1");
    await settled();
    assert.deepEqual(none.list.uncommitted(), { files: null, asking: false, failed: null, answered: true });
    none.list.setChain("c2");
    assert.deepEqual(none.list.uncommitted(), { files: null, asking: false, failed: null, answered: false }, "another chat: another folder, nothing answered yet");
  });
});

describe("the draft's card: Start held while the folder is checked, free on a failure (bug 1, the card)", () => {
  /** A draft with a team that writes, as the list route answers it. @param {any} [more] @returns {any} */
  const draft = (more = {}) => ({
    id: "fl-1", chainId: "c1", title: "A lexer", goal: "build a lexer", state: "draft", place: null, tell: true, hold: null, end: null, drawn: "hand", at: 0, startedAt: null, endedAt: null, sentBack: 0,
    line: "", problem: null, seats: 1, usd: 0,
    steps: [{ why: "", boxes: [{ id: "build", kind: "team", agent: "tenx", name: "10x Engineer", words: "Build it.", needs: [], gate: false, readOnly: false, model: null, sees: null, state: "waits", run: null, result: null, verdict: null, goneOn: false, sentBack: 0, error: null, usd: 0, startedAt: null, endedAt: null, past: [], words_: "Waits", writes: true, needsOf: [], broken: [], waiting: null }] }],
    ...more,
  });
  /** @param {any} f @param {any} uncommitted */
  const cardOf = (f, uncommitted) => {
    /** @type {any[]} */
    const calls = [];
    let recounted = 0;
    const routes = new Proxy({}, { get: (_, name) => (/** @type {any[]} */ ...args) => { calls.push([name, ...args]); return Promise.resolve({ ok: true, flow: f }); } });
    const cards = createFlowCards({
      rows: () => [f], cards: () => [], teams: () => [{ key: "tenx", name: "10x Engineer" }], seats: () => 4, uncommitted: () => uncommitted, recount: () => { recounted += 1; },
      press: (/** @type {any} */ fn) => fn(routes), openThread: () => {}, openTeam: () => {}, openFlow: () => {}, now: () => 0,
    }, { h: fakeH, place });
    return { el: cards.card(f, "dock"), calls, recounted: () => recounted };
  };

  // (fails before: yes — every ask held, a failed count's re-ask too, for the length of a git status, its failure note gone meanwhile)
  test("the words: the first ask holds, a failure does not and says how the flow starts all the same, and stands while asked again; nothing where the count is known or not asked", () => {
    const failure = "Your folder's uncommitted files could not be counted: git status timed out. Its first team that writes starts a new branch from your folder's last commit, so whatever is uncommitted in your folder stays here.";
    assert.deepEqual(countNote(draft(), { files: null, asking: true, failed: null, answered: false }), { held: true, words: COUNT_HELD_WORDS });
    assert.deepEqual(countNote(draft(), { files: null, asking: false, failed: "git status timed out", answered: true }), { held: false, words: failure });
    assert.deepEqual(countNote(draft(), { files: null, asking: true, failed: "git status timed out", answered: true }), { held: false, words: failure }, "asked again after a failure: the failure stands, Start free");
    assert.deepEqual(countNote(draft({ bring: true }), { files: null, asking: false, failed: "git status timed out", answered: true }), { held: false, words: "Your folder's uncommitted files could not be counted: git status timed out. Its first team that writes starts a new branch from your folder's last commit, and whatever is uncommitted in your folder as it starts is copied into it as uncommitted edits." });
    assert.equal(countNote(draft(), { files: null, asking: true, failed: null, answered: true }), null, "asked again after nothing to say: nothing held");
    assert.equal(countNote(draft(), { files: 3, asking: true, failed: null, answered: true }), null, "known: a count asked again holds nothing");
    assert.equal(countNote(draft(), { files: null, asking: false, failed: null, answered: true }), null, "nothing to say");
    assert.equal(countNote(draft(), null), null, "never asked");
    assert.equal(countNote(draft({ steps: [{ why: "", boxes: [{ id: "read", kind: "team", writes: false }] }] }), { files: null, asking: true, failed: null, answered: false }), null, "no team that writes");
    assert.equal(countNote(draft({ state: "running" }), { files: null, asking: true, failed: null, answered: false }), null);
    assert.equal(bringNote(draft(), null), null, "the count's note speaks for an unknown count");
  });

  // (fails before: yes — Start was enabled while the count was still asked, and a draft could start before its card said what stays behind)
  test("Start and Start ▾ wait for the first count, saying so; once known, Start goes", async () => {
    const f = draft();
    const held = cardOf(f, { files: null, asking: true, failed: null, answered: false });
    assert.match(textOf(held.el), /Checking your folder for uncommitted files…/);
    const start = btn(held.el, "Start");
    assert.ok(start && "disabled" in start.attrs, "Start held");
    assert.equal(start.attrs.title, COUNT_HELD_WORDS);
    const more = buttonsOf(held.el).find((b) => String(b.attrs?.class || "").includes("fl-split-more"));
    assert.ok(more && "disabled" in more.attrs, "Start ▾ held too");
    start.dispatch("click");
    await settled();
    assert.equal(held.calls.length, 0, "a press on a held Start runs nothing");
    assert.equal(btn(held.el, "Count again"), undefined, "nothing to ask again");
    const known = cardOf(f, { files: 3, asking: false, failed: null, answered: true });
    assert.match(textOf(known.el), /your 3 uncommitted files stay here/);
    const go = btn(known.el, "Start");
    assert.ok(go && !("disabled" in go.attrs));
    go.dispatch("click");
    await settled();
    assert.deepEqual(known.calls.at(-1), ["start", "fl-1"]);
  });

  // (fails before: yes — a failed count said nothing, offered nothing, and the switch was gone with it)
  test("a failed count: said with Count again, the switch kept, Start free", async () => {
    const f = draft();
    const failed = cardOf(f, { files: null, asking: false, failed: "git status timed out", answered: true });
    const t = textOf(failed.el);
    assert.match(t, /Your folder's uncommitted files could not be counted: git status timed out\./);
    assert.match(t, /so whatever is uncommitted in your folder stays here\./);
    assert.ok(btn(failed.el, "Count again"));
    btn(failed.el, "Count again").dispatch("click");
    assert.equal(failed.recounted(), 1);
    assert.ok(buttonsOf(failed.el).some((b) => b.attrs?.["aria-label"] === "Bring my uncommitted edits" || String(b.attrs?.title || "").startsWith("Bring my")) || t.includes("Bring my uncommitted edits"), "the switch stands");
    const start = btn(failed.el, "Start");
    assert.ok(start && !("disabled" in start.attrs), "Start is not held on a failure");
    start.dispatch("click");
    await settled();
    assert.deepEqual(failed.calls.at(-1), ["start", "fl-1"]);
    // Asked again after the failure: the failure note stands, and so does Start.
    const again = cardOf(f, { files: null, asking: true, failed: "git status timed out", answered: true });
    assert.match(textOf(again.el), /could not be counted: git status timed out/);
    assert.doesNotMatch(textOf(again.el), /Checking your folder/);
    const go = btn(again.el, "Start");
    assert.ok(go && !("disabled" in go.attrs), "Start free while a failed count is asked again");
  });
});

describe("a box whose Bring failed: Retry without my edits (bug 2)", () => {
  const BRING_REFUSAL = Object.assign(new Error("your uncommitted edits could not be brought into its worktree: git restore exited 128"), { status: 409, bring: true });

  // (fails before: yes — the box failed in words alone; nothing marked it as the copy's failure, so no card could offer a way past it)
  test("the runner marks the box; Bring switched off while the flow has no place; Retry then fires without it", async () => {
    let refuse = true;
    const w = world({ fireWith: async (input) => { if (refuse) throw BRING_REFUSAL; return { id: "t2", state: "working", place: { ...TREE } }; } });
    const d = w.runner.create("c1", LEXER);
    w.runner.edit("c1", d.id, { bring: true });
    w.runner.start("c1", d.id);
    await settled();
    let f = w.runner.get("c1", d.id);
    assert.equal(f.state, "holds");
    assert.equal(f.steps[0].boxes[0].state, "failed");
    assert.equal(f.steps[0].boxes[0].failedOn, "bring");
    assert.match(String(f.steps[0].boxes[0].error), /your uncommitted edits could not be brought/);
    assert.equal(f.place ?? null, null, "the worktree went back: the flow has no place");
    assert.deepEqual(w.fired[0].own, { name: "flow-a-lexer", bring: true });
    // The page's words for it.
    assert.equal(bringFailed(f, f.steps[0].boxes[0]), true);
    assert.equal(bringFailed({ ...f, bring: false }, f.steps[0].boxes[0]), false, "switched off: the offer is spent");
    assert.equal(bringFailed(f, { ...f.steps[0].boxes[0], failedOn: undefined }), false, "another failure: no such offer");
    // Retry without my edits: the switch off, then the retry, which fires with no bring.
    refuse = false;
    assert.equal(w.runner.edit("c1", d.id, { bring: false }).bring, undefined);
    w.runner.box("c1", d.id, "build", "retry");
    await settled();
    f = w.runner.get("c1", d.id);
    assert.deepEqual(w.fired[1].own, { name: "flow-a-lexer" }, "from the last commit alone");
    assert.equal(f.steps[0].boxes[0].state, "working");
    assert.equal(f.steps[0].boxes[0].failedOn, undefined, "the mark goes as it starts again");
    assert.deepEqual(f.place, TREE);
  });

  // (fails before: yes — the mark that a worktree was being made stayed where the box's own end threw, and the flow's Bring could never change again)
  test("a box whose end itself threw does not keep the flow's Bring choice from changing", async () => {
    let boom = false;
    const chains = new Map([["c1", { id: "c1", kind: "harness", meta: {} }]]);
    const runner = createFlowRunner({
      store: createFlowStore({ dir: null }),
      archive: () => ({ getChain: (/** @type {string} */ id) => chains.get(id) || null, mergeMeta: () => ({}), besideOf: () => [] }),
      registry: () => ({ notice: () => ({ ok: true }), get: () => null }),
      // The fire is refused, and the bus is down as the box's end is said: the end itself throws.
      besides: () => ({ fire: async () => { boom = true; throw BRING_REFUSAL; }, row: () => null, list: () => [] }),
      sessions: { besideFacts: () => ({ last: null }) },
      roster: () => ROSTER,
      postTurn: async () => ({ status: 200, body: null }),
      events: { publish: () => { if (boom) { boom = false; throw new Error("the bus is down"); } }, subscribe: () => () => {} },
      now: () => 0,
    });
    const d = runner.create("c1", LEXER);
    runner.edit("c1", d.id, { bring: true });
    runner.start("c1", d.id);
    await settled();
    const f = runner.get("c1", d.id);
    assert.equal(f.steps[0].boxes[0].state, "failed");
    assert.equal(runner.edit("c1", d.id, { bring: false }).bring, undefined, "the choice changes: nothing is being made");
  });

  test("a failure of another kind is not marked; Bring cannot change while the worktree is being made", async () => {
    /** @type {((v: any) => void)[]} */
    const fires = [];
    const w = world({ fireWith: () => new Promise((resolve) => fires.push(resolve)) });
    const d = w.runner.create("c1", LEXER);
    w.runner.edit("c1", d.id, { bring: true });
    w.runner.start("c1", d.id);
    await settled();
    assert.throws(() => w.runner.edit("c1", d.id, { bring: false }), /its worktree is being made now/);
    fires.shift()?.(Promise.reject(Object.assign(new Error("the 10x Engineer team's lead could not start: HTTP 502"), { status: 502 })));
    await settled();
    const f = w.runner.get("c1", d.id);
    assert.equal(f.steps[0].boxes[0].state, "failed");
    assert.equal(f.steps[0].boxes[0].failedOn, undefined, "the lead's failure is not the copy's");
    assert.equal(bringFailed(f, f.steps[0].boxes[0]), false);
  });

  // (fails before: yes — the fire's refusal carried its words alone)
  test("teams beside: the copy's refusal says it was the copy's", async () => {
    const chains = new Map([["c1", { id: "c1", kind: "harness", meta: {} }]]);
    const teamsList = Object.entries(SHIPPED_TEAMS).map(([key, t]) => ({ key, name: t.name, readOnly: /** @type {any} */ (t).readOnly === true, models: [], leadModels: [], leadModel: null, lead: { tag: t.lead, name: t.name }, most: null, fired: { notify: false, verify: false } }));
    /** @type {string[]} */
    const back = [];
    const beside = createTeamsBeside({
      archive: () => ({ getChain: (/** @type {string} */ id) => chains.get(id) || null, mergeMeta: () => {}, mainOf: () => null, besideOf: () => [] }),
      sessions: /** @type {any} */ ({ launchInfo: () => ({ cwd: "H:/repo", model: "m-1", full: "m-1" }), settingsOf: () => ({ effective: { subagents: {} }, sources: {} }), recordFor: async () => "", create: () => { throw new Error("no chat is made"); }, besideFacts: () => ({}), teamMark: () => ({}), cancelTurn: () => false }),
      teams: /** @type {any} */ ({ find: (/** @type {unknown} */ k) => teamsList.find((t) => t.key === String(k ?? "")) || null, list: () => teamsList }),
      registry: () => ({ list: () => [], modelChoice: async (/** @type {string} */ name) => ({ model: name, why: "" }), cardModels: () => [] }),
      postTurn: async () => ({ status: 200, body: null }),
      reach: { busy: () => false, post: async () => ({ status: 200, body: null }), steer: () => ({ ok: false }) },
      remove: async () => {},
      events: { publish: () => {} },
      now: () => 0,
      settleMs: 0,
      places: /** @type {any} */ ({
        own: async () => ({ ok: true, name: "flow-x", branch: "flow-x", folder: "H:/repo-flow-x", cwd: "H:/repo-flow-x", main: "H:/repo", place: "H:/repo", commit: "abc123" }),
        bring: async () => ({ ok: false, error: "git restore exited 128" }),
        takeBack: async (/** @type {any} */ m) => { back.push(m.folder); return null; },
      }),
    });
    await assert.rejects(beside.fire("c1", { team: "builders", ask: "Your part: Build it.", by: "flow", flow: { id: "f1", box: "build" }, own: { name: "flow-x", bring: true } }), (/** @type {any} */ e) => e.status === 409 && e.bring === true && /could not be brought into its worktree: git restore exited 128/.test(e.message));
    assert.deepEqual(back, ["H:/repo-flow-x"]);
  });

  // (fails before: yes — the held box's card and its sheet offered Retry, Skip and Stop alone, and the draft's switch was gone)
  test("the card offers Retry without my edits where the box's Bring failed: the switch off, then the retry; nowhere else", async () => {
    const box = { id: "build", kind: "team", agent: "tenx", name: "10x Engineer", words: "Build it.", needs: [], gate: false, readOnly: false, model: null, sees: null, state: "failed", run: null, result: null, verdict: null, goneOn: false, sentBack: 0, error: "it could not start: your uncommitted edits could not be brought into its worktree: git restore exited 128", usd: 0, startedAt: 0, endedAt: 0, past: [], words_: "Failed", writes: true, needsOf: [], broken: [], waiting: null, failedOn: "bring" };
    /** @param {any} [more] @returns {any} */
    const flow = (more = {}) => ({ id: "fl-1", chainId: "c1", title: "A lexer", goal: "build a lexer", state: "holds", bring: true, place: null, tell: true, hold: { kind: "box", box: "build" }, end: null, drawn: "hand", at: 0, startedAt: 0, endedAt: null, sentBack: 0, line: "", problem: null, seats: 1, usd: 0, steps: [{ why: "", boxes: [{ ...box }] }], ...more });
    /** @param {any} f */
    const cardsOf = (f) => {
      /** @type {any[]} */
      const calls = [];
      const routes = new Proxy({}, { get: (_, name) => (/** @type {any[]} */ ...args) => { calls.push([name, ...args]); return Promise.resolve({ ok: true, flow: f }); } });
      const cards = createFlowCards({ rows: () => [f], cards: () => [], teams: () => [{ key: "tenx", name: "10x Engineer" }], press: (/** @type {any} */ fn) => fn(routes), openThread: () => {}, openTeam: () => {}, openFlow: () => {}, now: () => 0 }, { h: fakeH, place });
      return { cards, calls };
    };
    const f = flow();
    const dock = cardsOf(f);
    const el = dock.cards.card(f, "dock");
    assert.match(textOf(el), /your uncommitted edits could not be copied into it, so it was taken back\. Retry tries the copy again\./);
    const without = btn(el, BRING_FAILED_WORDS.label);
    assert.ok(without, "Retry without my edits, beside Retry");
    assert.equal(without.attrs.title, BRING_FAILED_WORDS.title);
    assert.ok(btn(el, "Retry"), "Retry stays");
    without.dispatch("click");
    await settled();
    assert.deepEqual(dock.calls, [["edit", "fl-1", { bring: false }], ["act", "fl-1", "build", "retry"]], "the switch off, then the retry");
    // The box's sheet on the Agents tab offers it too.
    const pane = cardsOf(f);
    pane.cards.pick("fl-1", "build");
    const sheet = pane.cards.card(f, "pane");
    assert.ok(btn(sheet, BRING_FAILED_WORDS.label));
    // Not where the switch is off already, nor where the flow has its worktree, nor for another failure.
    for (const other of [flow({ bring: false }), flow({ place: { ...TREE } }), flow({ steps: [{ why: "", boxes: [{ ...box, failedOn: undefined, error: "it could not start: HTTP 502" }] }] })]) {
      const c = cardsOf(other);
      assert.equal(btn(c.cards.card(other, "dock"), BRING_FAILED_WORDS.label), undefined);
    }
  });
});

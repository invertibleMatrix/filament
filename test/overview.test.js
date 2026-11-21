// @ts-check
// proposal_ux phase 4: Overview (§4.6, §5) — its figures, the person's layout, a widget's tile, the page's edit mode and
// every tile on a chat with nothing yet; what the page reads beside the session view; the setup sheets the tiles open;
// the Run pane's parts (§4.10, M1) and the Next request pane's asks (§4.11, M5); the Session inspector's old address
// (R1). A press on a tile opens, never starts (rule 1): the tests press every face's links and count what was written.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeH, fakeDrawIn, textOf, buttonsOf, recordingPopover } from "./helpers/fake-dom.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** What the page posted, in order. @type {{ url: string, body: any }[]} */
const posted = [];
/** What the stand-in server answers a GET, by its whole address: a body, or a promise of one. @type {(url: string) => any} */
let serve = () => undefined;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
  const method = String(init.method || "GET");
  if (method !== "GET") posted.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
  const body = method === "GET" ? await serve(String(url)) : { strategy: "fold", changed: 2, note: "ok", queued: 1 };
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { KNOBS } = await import("../src/services/session-settings.js");
const { foldColumns, activityOf, tokensOf, modelsOf, compactionsOf, turnNow, agentsNow, CHART_COLUMNS } = await import("../src/ui/harness/lib/overview.js");
const { WIDGETS, TILES, OVERVIEW_BANDS, overviewLayout, overviewGallery } = await import("../src/ui/harness/widgets/registry.js");
const { featureTile } = await import("../src/ui/harness/widgets/frame.js");
const { createOverview } = await import("../src/ui/harness/views/overview.js");
const { keyedRead, chatState } = await import("../src/ui/harness/lib/chat-reads.js");
const { SETUP_SHEETS, OLD_TABS } = await import("../src/ui/harness/setup-sheet.js");
const { RUN_PARTS, renderRun, refreshRun, showRunPart } = await import("../src/ui/harness/panes/run-pane.js");
const { renderNextRequest } = await import("../src/ui/harness/panes/next-request.js");
const prompt = await import("../src/ui/harness/panes/prompt.js");
const { h } = await import("../src/ui/lib/dom.js");
const { familyPatch, TAGS } = await import("../src/ui/harness/widgets/overview-setup.js");

after(() => {
  g.fetch = realFetch;
});

/** A moment for promises to settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("Overview's figures (lib/overview.js)", () => {
  test("a per-turn chart keeps its width: the oldest turns are summed into groups, the total kept", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ n: i + 1, value: 1 }));
    const cols = foldColumns(items);
    assert.ok(cols.length <= CHART_COLUMNS, `${cols.length} columns`);
    assert.equal(cols.reduce((s, c) => s + c.value, 0), 50);
    assert.deepEqual([cols[0].label, cols.at(-1)?.label], ["turns 1–3", "turns 49–50"]);
    assert.deepEqual(foldColumns([{ n: 1, value: 2 }, { n: 2, value: NaN }, { n: 3, value: 5 }]).map((c) => c.label), ["turn 1", "turn 3"], "a turn with no figure draws no column");
  });

  test("Activity counts the turns that ran, their rounds and calls where their tally was kept, and the failed requests", () => {
    const turns = [
      { n: 1, facts: { errors: 0 }, toolLegs: 2, toolCalls: 5 },
      { n: 2, facts: { errors: 1 }, toolLegs: 0, toolCalls: 0 },
      { n: 3, command: true, facts: {} },
      { n: 4, facts: {} },
      { n: 5 },
    ];
    assert.deepEqual(activityOf(turns), {
      turns: 3, rounds: 4, calls: 5, failed: 1, counted: 2,
      perTurn: [{ n: 1, value: 5 }, { n: 2, value: 0 }, { n: 4, value: 0 }],
    });
  });

  test("Tokens processed reads the session's ledger, with the share read back from the cache", () => {
    assert.equal(tokensOf(null), null);
    assert.deepEqual(tokensOf({ cacheRead: 600, cacheWrite: 100, input: 300, output: 50, requests: 4 }),
      { total: 1050, cacheRead: 600, cacheWrite: 100, input: 300, output: 50, readShare: 0.6, requests: 4 });
    assert.equal(tokensOf({ output: 9 })?.readShare, null, "nothing read: no share to say");
  });

  test("How models did: the main agent's models by calls, then the agents on the side, each group by its own calls", () => {
    const turns = [
      { n: 1, facts: { model: "glm-5.3", calls: 3, tokens: { output: 100 }, errors: 1 } },
      { n: 2, facts: { models: [{ model: "opus", output: 40 }, { model: "sonnet", output: 10 }], calls: 2, errors: 0 } },
      { n: 3, facts: { model: "glm-5.3", calls: 1, tokens: { output: 5 } } },
    ];
    const rows = [{ model: "flash", status: "done" }, { model: "flash", status: "failed" }, { model: "kimi", status: "done" }, { model: "" }];
    assert.deepEqual(modelsOf(turns, rows), [
      { model: "glm-5.3", who: "agent", calls: 4, output: 105, failed: 1 },
      { model: "opus", who: "agent", calls: 2, output: 40, failed: 0 },
      { model: "sonnet", who: "agent", calls: 0, output: 10, failed: 0 },
      { model: "flash", who: "side", calls: 2, output: 0, failed: 1 },
      { model: "kimi", who: "side", calls: 1, output: 0, failed: 0 },
    ]);
  });

  test("Compactions: each once, oldest first, wherever the page placed its row", () => {
    const turns = [
      { boundaries: [{ type: "compaction", id: "c2", at: 20 }], compactions: [{ type: "compaction", id: "c1", at: 10 }] },
      { boundariesAfter: [{ type: "compaction", id: "c2", at: 20 }, { type: "settings", at: 15 }] },
    ];
    assert.deepEqual(compactionsOf(turns).map((c) => c.id), ["c1", "c2"]);
  });

  test("This turn: none yet, the newest that ended or failed, the running one with its round and state, one that asks", () => {
    assert.equal(turnNow({ turns: [] }).phase, "none");
    const ended = turnNow({ turns: [{ n: 1, facts: { startedAt: 1, endedAt: 5 }, toolLegs: 2 }] });
    assert.deepEqual([ended.phase, ended.round, ended.startedAt, ended.endedAt], ["ended", 3, 1, 5]);
    const failed = turnNow({ turns: [{ n: 1, facts: {} }, { n: 2, status: "error", error: "overloaded" }] });
    assert.deepEqual([failed.phase, failed.error, failed.n], ["failed", "overloaded", 2]);
    const tools = new Map([["a", { state: "running", name: "bash" }], ["b", { state: "running", name: "read" }]]);
    const aligned = { maxRound: 2, byRound: new Map([[2, { order: ["a", "b"], tools }]]), turnState: { to: "acting" } };
    const running = turnNow({ live: { startedAt: 100, turn: { n: 3, aligned } }, turns: [] });
    assert.deepEqual([running.phase, running.round, running.state, running.doing, running.startedAt], ["running", 2, "acting", "running 2 tool calls", 100]);
    const asks = turnNow({ live: { startedAt: 100, turn: { n: 3, paused: true, aligned: null } }, turns: [] });
    assert.deepEqual([asks.phase, asks.asks], ["asks", "Waiting for your answer"]);
    // (fails before: yes — a message stopped to ask before it went read as Stopped, in red, while its card waited)
    for (const errorBody of [{ resumeQuestion: { why: "changed" } }, { resumeQuestion: { why: "cold" } }, { needsCompaction: true }, { switchQuestion: {} }]) {
      const card = turnNow({ turns: [{ n: 1, facts: {} }, { n: 2, status: "error", error: "asks", reply: { errorBody } }] });
      assert.deepEqual([card.phase, card.asks, card.error], ["asks", "Waiting for your answer", ""], JSON.stringify(errorBody));
    }
  });

  test("Agents for this chat: how many work and ended, the newest working first", () => {
    const rows = [{ id: "a", status: "done" }, { id: "b", status: "running" }, { id: "c", status: "running" }];
    const now = agentsNow(rows);
    assert.deepEqual([now.working, now.done, now.newest?.id], [2, 1, "b"]);
    assert.deepEqual(agentsNow([]), { working: 0, done: 0, newest: null });
  });
});

describe("the person's layout (§5.5)", () => {
  /** @param {any} saved */
  const ids = (saved) => Object.fromEntries(Object.entries(overviewLayout(saved)).map(([band, tiles]) => [band, tiles.map((t) => t.id)]));

  test("every tile is a registered widget in one of the three bands, its default size first", () => {
    assert.deepEqual(OVERVIEW_BANDS.map((b) => b.id), ["now", "sofar", "setup"]);
    for (const [id, t] of Object.entries(TILES)) {
      assert.ok(Object.hasOwn(WIDGETS, id), `${id} is registered`);
      assert.ok(OVERVIEW_BANDS.some((b) => b.id === t.band), `${id}'s band`);
      assert.ok(t.sizes.length > 0 && t.sizes.every((s) => ["S", "M", "L"].includes(s)), `${id}'s sizes`);
    }
  });

  test("the default: the table's order band by band, the gallery empty", () => {
    assert.deepEqual(ids(null), {
      now: ["context", "turn", "speed", "cache", "account", "agents"],
      sofar: ["tokens", "activity", "memory", "files", "compactions", "spend", "models", "goal"],
      setup: ["who", "may", "kept", "rules", "told", "fork", "changes"],
    });
    assert.equal(overviewLayout(null).now[0].size, "L", "Context starts large");
    assert.deepEqual(overviewGallery(null), []);
  });

  test("what was kept is made whole: an unknown id dropped, a tile once and in its own band, a size it does not take its default", () => {
    const saved = { order: { now: ["agents", "nope", "memory", "context", "agents", "windows"] }, sizes: { context: "M", speed: "L", cache: "M" }, off: ["turn"], on: ["windows"] };
    assert.deepEqual(ids(saved).now, ["agents", "context", "speed", "cache", "account"], "the kept order, then the band's others: a widget a later version adds shows up");
    assert.ok(ids(saved).sofar.includes("memory"), "a tile named in another band's order stays in its own");
    const sizes = Object.fromEntries(overviewLayout(saved).now.map((t) => [t.id, t.size]));
    assert.deepEqual([sizes.context, sizes.speed, sizes.cache], ["M", "S", "M"]);
    assert.deepEqual(overviewGallery({ off: ["memory"] }), ["memory"], "a tile taken off waits in the gallery");
    for (const junk of ["x", 5, { order: 5, off: "turn", sizes: null }]) assert.deepEqual(ids(junk), ids(null), `${JSON.stringify(junk)} reads as the default`);
  });
});

describe("what the page reads beside the session view (lib/chat-reads.js)", () => {
  test("one read per chat and state; the older answer stands meanwhile; another chat's is never shown; a failure says why", async () => {
    /** @type {{ chain: string, res: (v: any) => void, rej: (e: any) => void }[]} */
    const reads = [];
    let landed = 0;
    const r = keyedRead((chain) => new Promise((res, rej) => { reads.push({ chain, res, rej }); }), () => { landed++; }, (e) => ({ error: String(/** @type {any} */ (e).message) }));
    assert.deepEqual([r.get("", "0:idle"), reads.length], [null, 0], "no chat, no read");
    assert.equal(r.get("a", "1:idle"), null);
    r.get("a", "1:idle");
    assert.equal(reads.length, 1, "asked once for the state");
    reads[0].res({ n: 1 });
    await settle();
    assert.deepEqual([landed, r.get("a", "1:idle")], [1, { n: 1 }]);
    assert.deepEqual(r.get("a", "2:live"), { n: 1 }, "the chat moved: the older answer stands while the newer read runs");
    assert.equal(reads.length, 2);
    assert.equal(r.get("b", "1:idle"), null, "another chat's answer is never shown");
    reads[1].res({ n: 2 });
    await settle();
    assert.equal(landed, 1, "an answer for a state no longer asked lands nowhere");
    reads[2].rej(new Error("gone"));
    await settle();
    assert.deepEqual([landed, r.get("b", "1:idle")], [2, { error: "gone" }]);
    assert.deepEqual([chatState({ turns: [1, 2], live: {} }), chatState(null)], ["2:live", "0:idle"]);
  });
});

/**
 * A widget context with nothing yet — the session born, no turn — and every door recorded. `coder`: the chat runs on
 * a coding agent.
 * @param {{ coder?: boolean }} [o]
 */
const world = (o = {}) => {
  /** @type {string[]} */
  const did = [];
  const rec = (/** @type {string} */ what) => (/** @type {any[]} */ ...a) => { did.push(a.length ? `${what} ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}` : what); };
  const view = { settings: { effective: {}, flat: {}, sources: {}, engine: o.coder ? { active: false, coder: "claude" } : { active: false } }, windows: [] };
  const account = o.coder ? { upstream: "claude", agentName: "Claude Code", type: "acp", label: "Default", windows: [] } : null;
  const chat = { id: "c1", chainId: "c1", turns: /** @type {any[]} */ ([]), live: null };
  /** @type {any} */
  const ctx = {
    view: () => view,
    hasSession: () => true,
    knobs: () => KNOBS,
    live: () => ({ rec: null, usage: null, facts: null, liveOut: 0, estimate: 0, streaming: false }),
    turns: () => chat.turns,
    setWindow: () => {},
    write: rec("write"),
    command: rec("command"),
    openPane: rec("pane"),
    openPage: rec("page"),
    openView: rec("view"),
    openSetup: rec("setup"),
    openLibrary: rec("library"),
    showWidget: rec("show"),
    stopTurn: rec("stop"),
    memoryEngine: () => null,
    toast: () => {},
    summon: rec("summon"),
    openHow: rec("how"),
    stopAndCompact: rec("stop-and-compact"),
    undoCompaction: rec("undo"),
    preview: async () => null,
    models: () => [],
    scrollToTurn: () => true,
    dryRun: rec("dry run"),
    chat: () => chat,
    checklist: () => null,
    chatChanges: () => null,
    subagents: { rows: () => [], models: () => [], sessionModel: () => "m", cache: () => ({ state: "none", running: false, leftMs: 0, ttlMs: 0, tokens: 0, model: null }) },
    memory: { confirm: async () => ({ ok: true }), correct: async () => ({ ok: true }), forget: async () => ({ ok: true }), answer: async () => ({ ok: true }) },
    team: { open: rec("open team"), back: rec("back"), wait: () => null },
    accounts: { session: () => account, check: async () => {}, useResetCredit: async () => "reset", rows: () => [], signIn: rec("sign in"), switchTo: rec("switch to"), manage: rec("manage accounts") },
  };
  return { ctx, did, chat };
};

describe("a widget's tile (widgets/frame.js featureTile)", () => {
  test("its press opens the popover its pill opens; with a sheet, the sheet; its face is handed the same door", () => {
    const { popover, pops } = recordingPopover();
    const io = { h: fakeH, drawIn: fakeDrawIn, popover, rows: () => null };
    /** @type {string[]} */
    const did = [];
    const spec = { id: "x", label: "Spend", state: () => "$1.20", now: () => fakeH("p", {}, "now"), tile: (/** @type {any} */ mk, /** @type {any} */ size, /** @type {any} */ back) => mk("button", { class: "more", onclick: () => back.open() }, `face ${size}`) };
    const t = featureTile(/** @type {any} */ (spec), io, { size: "S" });
    const el = /** @type {any} */ (t.el);
    assert.deepEqual([el.attrs.class, el.attrs["data-widget"], t.size], ["ov-tile ov-S ov-w-x", "x", "S"]);
    assert.ok(textOf(t.el).includes("face S"));
    buttonsOf(t.el).find((b) => b.attrs.class === "ov-tile-open").dispatch("click");
    assert.equal(pops.length, 1, "the press opens the popover");
    t.close();
    buttonsOf(t.el).find((b) => b.attrs.class === "more").dispatch("click");
    assert.equal(pops.length, 2, "the face's link opens the same back");
    const sheet = featureTile(/** @type {any} */ ({ id: "y", label: "Who runs this chat", state: () => "", sheet: () => did.push("sheet") }), io);
    const press = buttonsOf(sheet.el).find((b) => b.attrs.class === "ov-tile-open");
    press.dispatch("click");
    assert.deepEqual([did, pops.length, press.attrs["aria-label"]], [["sheet"], 2, "Who runs this chat — change it"]);
    const bare = featureTile(/** @type {any} */ ({ id: "z", label: "Z", state: () => "7" }), io);
    assert.ok(textOf(bare.el).includes("7"), "no face of its own: its state as the hero");
  });
});

describe("the page (views/overview.js)", () => {
  /** @param {{ coder?: boolean, saved?: any }} [o] */
  const page = (o = {}) => {
    const w = world(o);
    let saved = o.saved ?? null;
    /** @type {any[]} */
    const kept = [];
    /** @type {any[][]} */
    const menus = [];
    /** @type {(() => void)[]} */
    const frames = [];
    const { popover, pops } = recordingPopover();
    const ov = createOverview({
      saved: () => saved,
      keep: (next) => { saved = next; kept.push(next); },
      mk: /** @type {any} */ (fakeH),
      menu: /** @type {any} */ ((/** @type {any[]} */ items) => { menus.push(items); return { el: fakeH("div"), close() {} }; }),
      frame: (fn) => { frames.push(fn); },
    });
    ov.attach(w.ctx, { h: fakeH, drawIn: fakeDrawIn, popover, rows: () => null });
    return { ov, w, kept, menus, frames, pops, saved: () => saved };
  };
  /** The tiles on the page, band by band. @param {any} ov */
  const onPage = (ov) => {
    const bands = ov.el.querySelector("ov-bands").kids;
    return bands.map((/** @type {any} */ b) => b.querySelector("ov-grid").kids.filter((/** @type {any} */ t) => t.attrs["data-widget"]).map((/** @type {any} */ t) => `${t.attrs["data-widget"]}:${t.attrs.class.match(/ov-([SML])\b/)[1]}`));
  };
  /** The button of a tile's edit bar. @param {any} ov @param {string} id @param {string} cls */
  const editButton = (ov, id, cls) => {
    const tile = ov.el.querySelector("ov-bands").kids.flatMap((/** @type {any} */ b) => b.querySelector("ov-grid").kids).find((/** @type {any} */ t) => t.attrs["data-widget"] === id);
    return buttonsOf(tile).find((b) => b.attrs.class === cls);
  };

  test("nothing is built until it shows; then the three bands, the add tile last; out of sight it paints nothing", () => {
    const { ov } = page();
    assert.deepEqual(ov.el.querySelector("ov-bands").kids, [], "attached, not shown: no tile built");
    ov.setShown(true);
    assert.deepEqual(onPage(ov).map((b) => b.length), [6, 8, 7]);
    assert.equal(onPage(ov)[0][0], "context:L");
    const setup = ov.el.querySelector("ov-bands").kids[2].querySelector("ov-grid").kids;
    assert.ok(setup.at(-1).attrs.class.includes("ov-add"), "+ Add a widget ends the last band");
    assert.equal(ov.show("memory"), true, "a widget's back opens from its tile while the page shows");
    ov.setShown(false);
    assert.equal(ov.show("memory"), false, "out of sight, the pill has it");
  });

  test("the live figures paint once a frame, however often they move", () => {
    const { ov, frames } = page();
    ov.paintLive();
    assert.equal(frames.length, 0, "not shown: nothing asked");
    ov.setShown(true);
    ov.paintLive();
    ov.paintLive();
    ov.paintLive();
    assert.equal(frames.length, 1);
    frames[0]();
    ov.paintLive();
    assert.equal(frames.length, 2, "the next move after the frame asks for the next");
  });

  test("Edit widgets: the grip's arrow keys move a tile in its band, the size menu resizes, × takes off, the gallery adds, Reset restores", () => {
    const { ov, kept, menus } = page();
    /** The menu opened last. */
    const last = () => /** @type {any[]} */ (menus.at(-1));
    ov.setShown(true);
    const edit = buttonsOf(ov.el.querySelector("ov-head")).find((b) => b.attrs.class.includes("ov-head-btn") && !b.attrs.class.includes("is-quiet"));
    edit.dispatch("click");
    assert.equal(ov.editing, true);
    assert.ok(textOf(edit).includes("Done"));
    editButton(ov, "context", "ov-edit-grip").dispatch("keydown", { key: "ArrowRight" });
    assert.deepEqual(kept.at(-1).order.now.slice(0, 2), ["turn", "context"]);
    assert.deepEqual(onPage(ov)[0].slice(0, 2), ["turn:M", "context:L"], "built again in the new order");
    editButton(ov, "context", "ov-edit-size").dispatch("click", { currentTarget: fakeH("button") });
    assert.deepEqual(last().map((i) => [i.label, i.checked]), [["Large · two by two", true], ["Wide · two cells", false]]);
    last()[1].onClick();
    assert.equal(onPage(ov)[0][1], "context:M");
    assert.ok(Object.hasOwn(editButton(ov, "turn", "ov-edit-size").attrs, "disabled"), "a tile with one size has no size menu");
    editButton(ov, "memory", "ov-edit-x").dispatch("click");
    assert.ok(!onPage(ov)[1].some((t) => t.startsWith("memory:")));
    const add = buttonsOf(ov.el.querySelector("ov-bands")).find((b) => b.attrs.class.includes("ov-add"));
    add.dispatch("click", { currentTarget: add });
    assert.deepEqual(last().map((i) => i.desc), ["This chat so far"], "the gallery: Memory taken off, under its band");
    last()[0].onClick();
    assert.ok(onPage(ov)[1].includes("memory:M"), "back in its band");
    const reset = buttonsOf(ov.el.querySelector("ov-head")).find((b) => b.attrs.class.includes("is-quiet"));
    reset.dispatch("click");
    assert.equal(kept.at(-1), null);
    assert.deepEqual(onPage(ov).map((b) => b.length), [6, 8, 7]);
    ov.setShown(false);
    assert.equal(ov.editing, false, "leaving the page leaves edit mode");
  });

  // (changed by the design pass of 10-24, UX4: a setting changes on its tile — a family's chip, a switch, ↺ —, and a
  // chip with a menu opens it, which the fake DOM does not draw; nothing on a face starts, sends or spends)
  test("every tile draws at each size it takes on a chat with nothing yet, for the loop and for a coding agent; no face's press starts, sends or spends — it opens, or changes a setting in place", () => {
    for (const coder of [false, true]) {
      const { ctx, did } = world({ coder });
      const { popover } = recordingPopover();
      const io = { h: fakeH, drawIn: fakeDrawIn, popover, rows: () => null };
      for (const [id, t] of Object.entries(TILES))
        for (const size of t.sizes) {
          const tile = featureTile(WIDGETS[id](ctx, io), io, { size });
          assert.ok(textOf(tile.el).length > 0, `${id} at ${size}${coder ? " (coding agent)" : ""} says something`);
          for (const b of buttonsOf(tile.el)) if (b.attrs.class !== "ov-tile-open" && b.attrs["aria-haspopup"] !== "menu") b.dispatch("click", { currentTarget: b });
          tile.close();
        }
      // Compact now… brings the card that asks (`summon`): a press there never compacts by itself.
      assert.deepEqual(did.filter((d) => /^(command|stop|stop-and-compact|undo|pin)\b/.test(d)), [], "a press opens, never starts (rule 1)");
      for (const d of did.filter((x) => x.startsWith("write "))) assert.match(d, /^write \{"(patch|unset)":/, "a write is a setting changed in place");
    }
  });

  test("each How it is set up tile opens a sheet that exists, or How earlier turns are kept's own", () => {
    const { ctx, did } = world();
    const { popover } = recordingPopover();
    const io = { h: fakeH, drawIn: fakeDrawIn, popover, rows: () => null };
    for (const [id, t] of Object.entries(TILES)) {
      if (t.band !== "setup") continue;
      const spec = WIDGETS[id](ctx, io);
      if (!spec.sheet) continue;
      did.length = 0;
      featureTile(spec, io).open();
      const opened = did[0] || "";
      assert.ok(opened === "how" || (opened.startsWith("setup ") && Object.hasOwn(SETUP_SHEETS, opened.slice(6))), `${id} opened ${opened}`);
    }
    for (const [tab, to] of Object.entries(OLD_TABS)) assert.ok(to === "next-request" || Object.hasOwn(SETUP_SHEETS, to), `#/context/${tab} lands on ${to}`);
  });

  test("the head names the engine, and for a coding agent says the greyed parts say why", () => {
    const loop = page();
    loop.ov.setShown(true);
    assert.equal(textOf(loop.ov.el.querySelector("ov-engine")), "Filament's agent loop");
    const coder = page({ coder: true });
    coder.ov.setShown(true);
    assert.equal(textOf(coder.ov.el.querySelector("ov-engine")), "Claude Code over ACP|greyed parts say why");
  });
});

describe("the panes that took the inspector's parts", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
    // A dialog asks what had the focus; nothing in the stub page is an element of the browser's.
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

  /** The compose answer the page caches: two earlier turns, the window and the line. */
  const PREVIEW = { current: { window: 200000, usable: 170000, fixed: 12000, tokens: 30000, perTurn: [{ n: 1, shape: "raw", tokens: 20000 }, { n: 2, shape: "fold", tokens: 10000 }] } };
  /** @param {{ coder?: string }} [o] */
  const nextRequest = (o = {}) => {
    const body = /** @type {any} */ (h("div", { class: "pane-body" }));
    doc.document.body.append(body);
    serve = (url) => (url.includes("/transcript") ? { turns: [{ n: 1, user: { content: "Fix the bug" } }, { n: 2, user: { content: "Now test it" } }] } : undefined);
    renderNextRequest(body, { chat: { chainId: "c1", turns: [{}, {}] }, preview: async () => PREVIEW, draft: () => "a draft of forty characters, near enough", onToast: () => {}, reload: () => {}, coder: () => o.coder || "" });
    return body;
  };

  test("Next request weighs the whole request on the window's scale and lists the turns with what you said", async () => {
    const body = nextRequest();
    await until(() => body.querySelector(".ctx-turn-snippet"), "the turns drawn");
    const fig = body.querySelector(".nr-fig").textContent;
    assert.match(fig, /^42,0\d\d of 200,000 tokens · 21%/, fig);
    assert.ok(body.querySelector(".ctx-ghost"), "the draft is a ghost at the top");
    assert.deepEqual(body.querySelectorAll(".ctx-turn-snippet").map((/** @type {any} */ x) => x.textContent), ["Fix the bug", "Now test it"]);
    body.remove();
  });

  test("a coding agent's chat: Next request says it builds its own requests, the turns greyed", async () => {
    const body = nextRequest({ coder: "Claude Code" });
    await until(() => body.querySelector(".ctx-turn"), "the turns drawn");
    assert.match(body.querySelector(".nr-line").textContent, /^Claude Code builds its own requests/);
    assert.ok(body.querySelector(".nr-turns").classList.contains("is-greyed"));
    assert.equal(body.querySelectorAll("button.ctx-turn").length, 0, "a turn is no press: there is no pin to set");
    body.remove();
  });

  // (fails before: yes — the bug hunt of 10-30, the side panes' Lows: a compose preview that failed left the turns
  // saying "Reading the chat…" for good)
  test("Next request: a preview that failed says the request was not weighed, and the turns why, rather than reading on", async () => {
    const body = /** @type {any} */ (h("div", { class: "pane-body" }));
    doc.document.body.append(body);
    serve = (url) => (url.includes("/transcript") ? { turns: [] } : undefined);
    renderNextRequest(body, { chat: { chainId: "c-unweighed", turns: [{}] }, preview: async () => { throw new Error("the engine is not answering"); }, draft: () => "", onToast: () => {}, reload: () => {}, coder: () => "" });
    await until(() => /could not be read/.test(body.querySelector(".nr-turns").textContent), "the turns' words", { timeoutMs: 2000 });
    assert.equal(body.querySelector(".nr-turns").textContent, "The turns could not be read: the engine is not answering");
    assert.equal(body.querySelector(".nr-parts").textContent, "The next request could not be weighed.");
    body.remove();
  });

  // (fails before: yes — the bug hunt of 10-30, the side panes' Lows: Calls' Expand all opened every card, and each read
  // its record at once — up to a hundred reads holding the browser's six connections to Filament)
  test("Calls' Expand all reads the records RECORD_READS_AT_ONCE at a time, every card filled with its own as before", async () => {
    const proto = Object.getPrototypeOf(doc.document.createElement("div"));
    // The page's own event dispatch, which Expand all uses to say each card opened.
    proto.dispatchEvent = function (/** @type {Event} */ ev) {
      this.dispatch(ev.type);
      return true;
    };
    const rows = Array.from({ length: 6 }, (_, i) => ({ id: `rx${i}`, model: "m", tokens: { input: 10, output: 2 }, stopReason: "end_turn", totalMs: 5 }));
    let out = 0;
    let most = 0;
    /** @type {(() => void)[]} */
    const held = [];
    serve = (url) => {
      if (url.includes("/sessions/c-expand/requests?limit=100")) return { requests: rows };
      const m = /\/api\/requests\/(rx\d)$/.exec(url);
      if (!m) return undefined;
      most = Math.max(most, ++out);
      return new Promise((r) => held.push(() => {
        out--;
        r({ shapedBody: JSON.stringify({ messages: [{ role: "user", content: `the ask of ${m[1]}` }] }) });
      }));
    };
    const body = /** @type {any} */ (h("div", { class: "pane-body" }));
    doc.document.body.append(body);
    try {
      prompt.renderPrompt(body, { chat: { chainId: "c-expand" } });
      await until(() => body.querySelectorAll("details.prompt-card").length === 6, "the cards");
      body.querySelector("button[title='Expand all']").dispatch("click");
      await until(() => held.length >= 2, "the first reads");
      await settle();
      assert.equal(most, prompt.RECORD_READS_AT_ONCE, "two at a time, the rest waiting their turn");
      // Each read let land in turn: the next waiting one starts as a slot comes free, never more at once.
      for (let landed = 0; landed < rows.length; landed++) {
        await until(() => held.length, "a read under way");
        held.shift()?.();
      }
      const asks = () => body.querySelectorAll("details.prompt-card").map((/** @type {any} */ d) => d.querySelector(".prompt-msg-text")?.textContent || "");
      await until(() => asks().every(Boolean), "every card filled");
      assert.deepEqual(asks(), rows.map((r) => `the ask of ${r.id}`));
      assert.deepEqual([most, prompt.RECORD_READS_AT_ONCE], [2, 2]);
    } finally {
      delete proto.dispatchEvent;
      body.remove();
    }
  });

  test("Run: three parts under one control; a door picks Calls before it opens, and the pulse draws it then", async () => {
    assert.deepEqual(RUN_PARTS.map((p) => p.label), ["Rounds", "Calls", "For developers"]);
    serve = () => undefined;
    const body = /** @type {any} */ (h("div", { class: "pane-body" }));
    doc.document.body.append(body);
    const ctx = { chat: { chainId: "c1", turns: [], live: null }, coder: () => "Claude Code" };
    showRunPart("rounds");
    renderRun(body, ctx);
    assert.equal(body.querySelector(".run-part").dataset.part, "rounds");
    showRunPart("calls");
    refreshRun(body, ctx);
    assert.equal(body.querySelector(".run-part").dataset.part, "calls", "the pulse follows the door");
    assert.match(body.querySelector(".run-greyed").textContent, /^Claude Code's own requests do not pass through Filament/);
    showRunPart("nope");
    refreshRun(body, ctx);
    assert.equal(body.querySelector(".run-part").dataset.part, "calls", "a part that does not exist picks nothing");
    showRunPart("rounds");
    body.remove();
  });
});

describe("the Session inspector's old address (R1)", () => {
  test("`#/context/<tab>` is replaced by the chat's Overview, with the sheet or pane that took the tab's place", () => {
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /location\.replace\(c\?\.chainId \? routeFor\("task", \{ id: c\.chainId, view: "overview" \}\) : backTo\(\)\);\s*if \(c\?\.chainId\) openOverviewAt\(route\.tab\);/);
    assert.doesNotMatch(app, /renderContextPage|ctx-page/);
  });
});

// (fails before: yes — the design pass of 10-24, UX4: the setup tiles said their values, with one tag for a whole tile;
// every change went through the sheet; a tile with nothing yet stood on the page; This turn said "round")
describe("Overview changed in place (the design pass of 10-24, UX4)", () => {
  /** Every node under `el` with class `cls`. @param {any} el @param {string} cls @returns {any[]} */
  const all = (el, cls) => {
    /** @type {any[]} */
    const out = [];
    /** @param {any} n */
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (String(n.attrs?.class || "").split(/\s+/).includes(cls)) out.push(n);
      for (const k of n.kids || []) walk(k);
    };
    walk(el);
    return out;
  };
  /** A tile's rows as they read. @param {any} tile */
  const rows = (tile) => all(tile.el, "ov-set").map(textOf);
  /** A tile at its size. @param {any} ctx @param {string} id @param {any} [size] */
  const tileOf = (ctx, id, size = "M") => featureTile(WIDGETS[id](ctx, { h: fakeH, drawIn: fakeDrawIn }), { h: fakeH, drawIn: fakeDrawIn }, { size });

  test("each row says where its value comes from; one this chat chose is marked and ↺ takes the chat's own back", () => {
    const { ctx, did } = world();
    const st = ctx.view().settings;
    st.sources = { "loop.permissions": "session", "context.compaction.mode": "project", "context.compaction.resumeQuestion": "global" };
    const may = tileOf(ctx, "may");
    const perm = all(may.el, "ov-set")[0];
    assert.equal(textOf(perm), "Permission|Edit automatically|this chat");
    assert.ok(perm.attrs.class.includes("is-chat"), "marked");
    assert.equal(all(perm, "ov-set-from")[0].attrs.title, TAGS.session.title);
    buttonsOf(perm).find((x) => x.attrs.class === "ov-set-back").dispatch("click");
    assert.deepEqual(did, ['write {"unset":["loop.permissions"]}']);
    const kept = tileOf(ctx, "kept", "L");
    assert.deepEqual(rows(kept).map((r) => r.split("|").at(-1)), ["default", "project", "default", "yours"], "the tag of each row: its own layer");
  });

  test("How earlier turns are kept changes in place: your line, asking first, how room is made, after a break — and a coding agent's way", () => {
    const { ctx, did } = world();
    const kept = tileOf(ctx, "kept", "L");
    assert.deepEqual(rows(kept), [
      "Your line|none: the window is unknown|default",
      "Ask before making room|default",
      "Makes room by|Same model|default",
      "Back after a break|Ask me|default",
    ]);
    const ask = all(kept.el, "ov-set-switch")[0];
    assert.equal(ask.checked, true, "asking first is the default");
    ask.checked = false;
    ask.dispatch("change", { target: ask });
    assert.deepEqual(did, ['write {"patch":{"context":{"compaction":{"mode":"auto"}}}}']);
    assert.ok(all(kept.el, "ov-set-pick").every((c) => c.attrs["aria-haspopup"] === "menu"), "a choice opens its menu");
    const coder = world({ coder: true });
    const ckept = tileOf(coder.ctx, "kept", "L");
    assert.equal(rows(ckept)[2], "Makes room by|Suggested|default");
    assert.equal(rows(ckept).length, 4, "no row for what each request carries: every turn goes whole until a compaction");
  });

  test("Forks and privacy change in place; Skills says how many are on; words and lists stay the sheet's", () => {
    const { ctx, did } = world();
    const fork = tileOf(ctx, "fork", "S");
    assert.deepEqual(rows(fork), ["A fork gets|As it was|default", "Memory reads it|default", "Searchable|default"]);
    assert.equal(WIDGETS.fork(ctx, { h: fakeH, drawIn: fakeDrawIn }).state(), "As it was", "the fork's state in its own name");
    const learn = all(fork.el, "ov-set-switch")[0];
    learn.checked = false;
    learn.dispatch("change", { target: learn });
    assert.deepEqual(did, ['write {"patch":{"privacy":{"learn":false}}}']);
    const rules = tileOf(ctx, "rules", "L");
    assert.deepEqual(rows(rules).map((r) => r.split("|")[0]), ["Also tell it", "Project files it reads", "Skills", "Hooks", "A new worktree gets"]);
    // (fails before: yes — HarnessV4_Skills_Plan S1-6: Skills was one switch over every skill; which are on is Library ›
    // Skills' now, a place at a time)
    assert.equal(all(rules.el, "ov-set-switch").length, 0, "no switch: Library › Skills turns each on");
    assert.match(rows(rules)[2], /^Skills\|none on/);
    const some = world();
    some.ctx.view().settings.flat["skills.on"] = [{ name: "pdf" }, { name: "deploy" }];
    assert.match(rows(tileOf(some.ctx, "rules", "L"))[2], /^Skills\|2 on/);
    // A coding agent takes the chat's skills through Filament's skill tool (HarnessV4_Skills_Plan S1-1): its row is
    // live, where its instruction files are its own.
    // (fails before: yes — the row was greyed for every coding agent)
    const coder = world({ coder: true });
    const crules = all(tileOf(coder.ctx, "rules", "L").el, "ov-set");
    assert.deepEqual(crules.map((r) => [textOf(r).split("|")[0], r.attrs.class.includes("is-dim")]).filter(([l]) => l === "Skills" || l === "Project files it reads"), [["Project files it reads", true], ["Skills", false]]);
  });

  test("a family's chip on What it may do switches it in place — the loop's tools as a whole object, the web's and the browser's own switches; greyed where Filament's loop does not run the tools", () => {
    assert.deepEqual(familyPatch({ names: ["read", "glob", "grep", "write", "edit"] }, false, { bash: false }), { patch: { loop: { tools: { bash: false, read: false, glob: false, grep: false, write: false, edit: false } } } });
    assert.deepEqual(familyPatch({ names: ["web_fetch", "web_search", "browser"] }, true, null), { patch: { plugins: { web: { fetch: true, search: true }, browser: true } } });
    const { ctx, did } = world();
    const files = buttonsOf(tileOf(ctx, "may").el).find((x) => textOf(x) === "Files");
    assert.equal(files.attrs["aria-pressed"], "true");
    files.dispatch("click");
    assert.match(did[0], /^write \{"patch":\{"loop":\{"tools":\{"read":false,"glob":false,"grep":false,"lsp":false,"write":false,"edit":false\}\}\}\}$/);
    const coder = world({ coder: true });
    assert.equal(buttonsOf(tileOf(coder.ctx, "may").el).some((x) => textOf(x) === "Files"), false, "a coding agent's own tools: words, no switch");
  });

  test("a tile with nothing yet stays off the page until it has something, and shows, dimmed, while the widgets are edited", () => {
    const w = world();
    const ov = createOverview({ saved: () => null, keep: () => {}, mk: /** @type {any} */ (fakeH), frame: (fn) => fn() });
    ov.attach(w.ctx, { h: fakeH, drawIn: fakeDrawIn, popover: recordingPopover().popover, rows: () => null });
    ov.setShown(true);
    const tiles = ov.el.querySelector("ov-bands").kids.flatMap((/** @type {any} */ b) => b.querySelector("ov-grid").kids).filter((/** @type {any} */ x) => x.attrs["data-widget"]);
    const off = tiles.filter((/** @type {any} */ x) => x.classList.contains("hidden")).map((/** @type {any} */ x) => x.attrs["data-widget"]).sort();
    assert.deepEqual(off, ["cache", "changes", "compactions"], "nothing yet: off the page — the Cache tile too, until a request says its cache numbers");
    buttonsOf(ov.el.querySelector("ov-head")).find((x) => /Edit widgets/.test(textOf(x))).dispatch("click");
    const editing = ov.el.querySelector("ov-bands").kids.flatMap((/** @type {any} */ b) => b.querySelector("ov-grid").kids).filter((/** @type {any} */ x) => x.attrs["data-widget"]);
    assert.deepEqual(editing.filter((/** @type {any} */ x) => x.classList.contains("hidden")), [], "edited: every tile shows");
    assert.deepEqual(editing.filter((/** @type {any} */ x) => x.classList.contains("is-empty")).map((/** @type {any} */ x) => x.attrs["data-widget"]).sort(), ["cache", "changes", "compactions"]);
  });

  // (fails before: yes — the owner's of 11-01: buttons blinking under a resting pointer, clicks lost — the Edit button's
  // glyph was made anew at every paint, every frame of a reply)
  test("the Edit button's face stays through the page's paints, and moves as editing turns on", () => {
    const w = world();
    const ov = createOverview({ saved: () => null, keep: () => {}, mk: /** @type {any} */ (fakeH), frame: (fn) => fn() });
    ov.attach(w.ctx, { h: fakeH, drawIn: fakeDrawIn, popover: recordingPopover().popover, rows: () => null });
    ov.setShown(true);
    const edit = buttonsOf(ov.el.querySelector("ov-head")).find((x) => /Edit widgets/.test(textOf(x)));
    const glyph = edit.kids[0];
    ov.setShown(true);
    ov.setShown(true);
    assert.equal(edit.kids[0], glyph, "the glyph that stood");
    edit.dispatch("click");
    assert.equal(textOf(edit), "Done");
    assert.notEqual(edit.kids[0], glyph, "a check in its place");
  });

  test("Overview says step where it said round", () => {
    const now = readFileSync(new URL("../src/ui/harness/widgets/overview-now.js", import.meta.url), "utf8");
    const sofar = readFileSync(new URL("../src/ui/harness/widgets/overview-sofar.js", import.meta.url), "utf8");
    for (const words of ["`step ${t.round}`", '`${t.round} step${t.round === 1 ? "" : "s"}`', "`Step ${t.round}`", 'label: "Steps"']) assert.ok(now.includes(words), words);
    assert.doesNotMatch(now, /`round \$\{|`Round \$\{|"Rounds"|\} round\$\{/);
    assert.doesNotMatch(sofar, /"rounds"|label: "Rounds"| rounds · /);
  });
});

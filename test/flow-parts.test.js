// @ts-check
// What Flow changes in what exists (HarnessV4_Flow_Plan F2; HarnessV4_OneAgent_Plan OA3): the registry takes a flow's
// box (`origin: "flow"`) — it waits for a seat where none is free (FL-D20), and its report goes to its flow, never
// aside — and a flow's start's notice for the main agent (OA-D8); teams beside takes a flow's fire — its hand-off a
// part of its own past the Brief's 4,000, a box's own Reads only, no mark in the main chat; and a flow's worktree
// (HarnessV4_OneAgent_Plan OA5): made by its first box that writes, used by those after it, outside git the folder, taken
// back where its chat does not start — and sends a message of Filament's own to the main agent, kept by whoever sends it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { saveOwnCards } from "./helpers/flow-cards.js";
import { createTeamsBeside } from "../src/app/teams-beside.js";
import { SHIPPED_TEAMS } from "../src/services/teams.js";

const root = tmpdir();
const NOW = Date.UTC(2026, 9, 22, 9, 0, 0);
const settle = () => new Promise((r) => setImmediate(r));
const settled = async (n = 20) => {
  for (let i = 0; i < n; i++) await settle();
};

/**
 * A registry over one chat whose model's limit, on its row, is `most`; each launch's request waits until the test lets it go (`finish`).
 * What it keeps aside for the developer and the marks it leaves in the chat are seen.
 * @param {{ most?: number, answer?: string }} [o]
 */
function registryWorld({ most = 1, answer = "PLAN: a tray first." } = {}) {
  const w = {
    /** @type {Map<string, () => void>} */ gates: new Map(),
    /** @type {string[]} */ posted: [],
    /** @type {any[][]} */ held: [],
    /** @type {any[]} */ marks: [],
    /** @type {any[]} */ calls: [],
    /** @type {ReturnType<typeof createSubagentRegistry>} */ registry: /** @type {any} */ (null),
    /** @param {string} id */
    finish: async (id) => {
      for (let i = 0; i < 200 && !w.gates.has(id); i++) await settle();
      /** @type {() => void} */ (w.gates.get(id))();
      await settled();
    },
  };
  let n = 0;
  const cards = createAgentCardStore({ dataDir: null });
  saveOwnCards(cards);
  w.registry = createSubagentRegistry({
    now: () => NOW,
    config: () => ({ agentLoop: { subagents: { slots: [{ upstream: "zai", model: "flash", n: most }] } } }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      card: (tag) => cards.find(tag),
      settings: () => ({ subagents: { pool: [{ model: "flash" }], view: "none" }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: root, model: "main", projectId: "p1" }),
      view: async () => ({ text: "", turns: 0 }),
      brief: async () => null,
      modelProblem: () => null,
      modelFacts: (name) => ({ problem: null, limit: null, at: { upstream: "zai", model: name }, seen: null }),
      agentOf: () => null,
      mark: (_chainId, m) => {
        w.marks.push(m);
        return { ...m, afterTurn: 1 };
      },
      saveHeld: (_chainId, list) => w.held.push(list),
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      w.calls.push(body);
      w.posted.push(id);
      const runId = `run-${++n}`;
      w.registry.attach(id, runId);
      await new Promise((res) => w.gates.set(id, () => res(undefined)));
      w.registry.finish(id, { status: "done", error: null, report: answer, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: answer }] }], rounds: 1, toolCalls: 0, tokensIn: 10, tokensOut: 5, spentUsd: 0.01, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: answer }], usage: { input_tokens: 10, output_tokens: 5 } }, id: runId, upstream: "zai", retryAfter: null, shouldRetry: null };
    },
  });
  return w;
}
/** A flow's box, as its runner launches it: drawn Reads only here, no verb (OA1). @param {string} as @param {Record<string, any>} [more] @returns {any} */
const BOX = (as, more = {}) => ({ origin: "flow", chainId: "c1", as, may: "read", prompt: `[Filament: you are one box of a flow]\n\nYour part: ${as}'s view`, description: `Flow: ${as}`, deliver: false, waits: true, ...more });

describe("the registry takes a flow's box (F2)", () => {
  // (fails before: yes — a launch past the chat's number was refused: `waits` was a lead's worker's alone)
  test("a box with no free seat waits for one, its card saying why, and starts once a seat frees", async () => {
    const w = registryWorld({ most: 1 });
    const a = /** @type {any} */ (w.registry.launch(BOX("pm")));
    const b = /** @type {any} */ (w.registry.launch(BOX("designer")));
    assert.deepEqual([a.ok, b.ok], [true, true], String(b.error || ""));
    await settled();
    assert.deepEqual(w.posted, [a.id], "the second waits, its request not sent");
    assert.equal(String(w.registry.get(b.id)?.waiting?.words), "flash, 1 of 1 busy");
    // The person's own ask is still refused in words, as today.
    const own = /** @type {any} */ (w.registry.launch({ origin: "owner", chainId: "c1", as: "skeptic", prompt: "Doubt it" }));
    assert.equal(own.ok, false);
    await w.finish(a.id);
    assert.deepEqual(w.posted, [a.id, b.id], "a seat freed: the waiting box started");
    await w.finish(b.id);
  });

  // (fails before: yes — its report ended "held": kept aside for the developer's Send, among the 20 a chat keeps)
  test("its report goes to its flow: delivery flow, nothing kept aside, no mark in the chat, the report on its outcome", async () => {
    const w = registryWorld({ most: 4 });
    const a = /** @type {any} */ (w.registry.launch(BOX("pm")));
    assert.equal(a.ok, true);
    await w.finish(a.id);
    const o = await a.done;
    assert.equal(o.report, "PLAN: a tray first.");
    const row = w.registry.get(a.id);
    assert.equal(row?.origin, "flow");
    assert.equal(row?.exchanges.at(-1)?.delivery, "flow");
    assert.equal(row?.aside, true, "it is the developer's: the main agent never hears it by itself");
    assert.deepEqual(w.held, [], "no report waits aside for a Send");
    assert.deepEqual(w.marks, [], "no dispatch or arrival mark in the chat: the flow's card shows it");
  });

  // (OA-D8: a flow's start is told to the main agent with its next message, as a launch notice is)
  test("a flow's start's notice waits for the chat's next message, by itself: no sub-agent, no mark, no call", () => {
    const w = registryWorld();
    assert.equal(/** @type {any} */ ("sideCall" in w.registry), false, "the page's side call is gone with the chip");
    w.registry.notice("c1", { text: "[Filament: the person started a flow beside this chat: …]", description: 'the flow "Plan"' });
    assert.deepEqual(w.registry.peekQueued("c1").map((d) => [d.kind, d.from, d.description, d.text.slice(0, 41)]), [["notice", "", 'the flow "Plan"', "[Filament: the person started a flow besi"]]);
    assert.deepEqual([w.calls.length, w.marks.length, w.held.length], [0, 0, 0]);
  });
});

/**
 * Teams beside over a fake archive and sessions: chats made, their meta merged, turns posted, marks kept; `places`, where
 * a flow's worktree is made (OA5); `refuse`, a lead's turn refused at its start.
 * @param {{ busy?: boolean, steers?: boolean, places?: any, refuse?: boolean }} [o]
 */
function besideWorld({ busy = false, steers = false, places = null, refuse = false } = {}) {
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", kind: "harness", meta: {} }]]);
  const w = {
    chains,
    /** @type {{ chain: string, body: any }[]} */ posted: [],
    /** @type {any[]} */ marks: [],
    /** @type {any[]} */ said: [],
    /** @type {{ chain: string, text: string }[]} */ steered: [],
    /** @type {{ chain: string, text: string }[]} */ sent: [],
    busy,
    steers,
    /** @type {Record<string, any>} */ facts: {},
    /** @type {string[]} */ removed: [],
    /** @type {ReturnType<typeof createTeamsBeside>} */ beside: /** @type {any} */ (null),
  };
  let n = 0;
  const archive = {
    getChain: (/** @type {string} */ id) => chains.get(id) || null,
    mergeMeta: (/** @type {string} */ id, /** @type {any} */ patch) => Object.assign(chains.get(id).meta, patch),
    mainOf: (/** @type {string} */ id) => chains.get(id)?.beside || null,
    besideOf: (/** @type {string} */ main) => [...chains.values()].filter((c) => c.beside === main).map((c) => c.id),
  };
  const teamsList = Object.entries(SHIPPED_TEAMS).map(([key, t]) => ({ key, name: t.name, readOnly: /** @type {any} */ (t).readOnly === true, models: [], leadModels: [], leadModel: null, lead: { tag: t.lead, name: t.name }, most: null, fired: { notify: false, verify: false } }));
  w.beside = createTeamsBeside({
    archive: () => archive,
    sessions: {
      launchInfo: () => ({ cwd: root, model: "m-1", full: "m-1" }),
      settingsOf: () => ({ effective: { subagents: {} }, sources: {} }),
      recordFor: async () => "<main-chat title=\"x\" turns=\"1\">the record</main-chat>",
      create: (/** @type {any} */ o) => {
        const id = `t${++n}`;
        chains.set(id, { id, kind: "team", beside: o.beside, model: o.model, title: o.title, settings: o.settings, cwd: o.cwd, meta: {} });
        return { id };
      },
      besideFacts: (/** @type {string} */ id) => w.facts[id] || { busy: true, asking: false, turns: 1, last: null },
      teamMark: (/** @type {string} */ main, /** @type {any} */ m) => {
        w.marks.push({ main, ...m });
        return { ...m, afterTurn: 1 };
      },
      cancelTurn: () => false,
    },
    teams: /** @type {any} */ ({ find: (/** @type {unknown} */ k) => teamsList.find((t) => t.key === String(k ?? "")) || null, list: () => teamsList }),
    registry: () => ({ list: () => [], modelChoice: async (/** @type {string} */ name) => ({ model: name, why: "" }), cardModels: () => [] }),
    postTurn: async (chain, body) => {
      w.posted.push({ chain, body });
      return refuse ? { status: 409, body: { error: "its model is gone" } } : { status: 200, body: null };
    },
    reach: {
      busy: () => w.busy,
      post: async (chain, text) => {
        w.sent.push({ chain, text });
        return { status: 200, body: null };
      },
      steer: (chain, text) => {
        if (!w.steers) return { ok: false, error: "no" };
        w.steered.push({ chain, text });
        return { ok: true };
      },
    },
    remove: async (/** @type {string} */ id) => {
      w.removed.push(id);
    },
    events: { publish: (_topic, msg) => w.said.push(msg) },
    now: () => NOW,
    settleMs: 0,
    places,
  });
  return w;
}

describe("teams beside make a flow's worktree (OA5)", () => {
  /** Where the fakes make worktrees, and what was asked of them. */
  const placesOf = (/** @type {any} */ answer) => {
    const p = {
      /** @type {any[]} */ asked: [],
      /** @type {any[]} */ back: [],
      /** @type {any[]} */ copied: [],
      /** What was done, in its order, as a fire that cannot start undoes it. @type {string[]} */ order: [],
      here: (/** @type {string} */ f) => f !== "H:/gone",
      own: async (/** @type {string} */ cwd, /** @type {string} */ name) => {
        p.asked.push([cwd, name]);
        return typeof answer === "function" ? answer(name) : answer;
      },
      takeBack: async (/** @type {any} */ made) => {
        p.back.push(made.folder);
        p.order.push("taken back");
        return null;
      },
      template: (/** @type {string} */ chat, /** @type {any} */ made) => p.copied.push([chat, made.folder]),
      untemplate: async (/** @type {string} */ chat, /** @type {string} */ why) => {
        p.order.push(`the copy into ${chat} stopped: ${why}`);
      },
    };
    return p;
  };
  /** @param {string} name */
  const made = (name) => ({ ok: true, name, branch: name, folder: `H:/filament-${name}`, cwd: `H:/filament-${name}/src`, main: "H:/filament", place: "H:/filament", commit: "abc" });
  const FIRE = { team: "builders", ask: "Your part: Build it.", by: "flow", flow: { id: "f1", box: "build" } };

  test("its first box that writes: made from the main chat's folder, its chat working in it, the template copied in, its place on its card", async () => {
    const places = placesOf(made);
    const w = besideWorld({ places });
    const row = await w.beside.fire("c1", { ...FIRE, own: { name: "flow-a-lexer" } });
    assert.deepEqual(places.asked, [[root, "flow-a-lexer"]]);
    assert.equal(w.chains.get(row.id).cwd, "H:/filament-flow-a-lexer/src", "its chat works in the worktree, never in the main chat's folder");
    assert.deepEqual(places.copied, [[row.id, "H:/filament-flow-a-lexer"]]);
    const place = { kind: "worktree", name: "flow-a-lexer", branch: "flow-a-lexer", folder: "H:/filament-flow-a-lexer", cwd: "H:/filament-flow-a-lexer/src" };
    assert.deepEqual(row.place, place);
    assert.deepEqual(w.chains.get(row.id).meta.beside.place, place, "kept with it");
  });

  test("a box after it works in that one; one that is gone refuses in words; none is asked of a fire that is not a flow's, nor of one that reads only", async () => {
    const places = placesOf(made);
    const w = besideWorld({ places });
    const use = { kind: "worktree", name: "flow-a-lexer", branch: "flow-a-lexer", folder: "H:/filament-flow-a-lexer", cwd: "H:/filament-flow-a-lexer" };
    const row = await w.beside.fire("c1", { ...FIRE, team: "bughunters", own: { use } });
    assert.equal(w.chains.get(row.id).cwd, use.cwd);
    assert.deepEqual(row.place, use);
    assert.deepEqual([places.asked.length, places.copied.length], [0, 0], "nothing made, nothing copied");
    await assert.rejects(w.beside.fire("c1", { ...FIRE, own: { use: { ...use, folder: "H:/gone", cwd: "H:/gone" } } }), /its flow's worktree H:\/gone is gone: put it back, or start the flow again/);
    await w.beside.fire("c1", { ...FIRE, readOnly: true, own: { name: "flow-x" } });
    await w.beside.fire("c1", { team: "builders", ask: "Build it.", own: { name: "flow-x" } });
    assert.equal(places.asked.length, 0);
  });

  test("outside git it works in the folder and says why; a worktree git will not make refuses the fire; one whose lead cannot start goes back", async () => {
    const outside = besideWorld({ places: placesOf({ ok: false, outside: "it is not in a git repository" }) });
    const row = await outside.beside.fire("c1", { ...FIRE, own: { name: "flow-a-lexer" } });
    assert.equal(outside.chains.get(row.id).cwd, root);
    assert.deepEqual(row.place, { kind: "folder", folder: root, why: "it is not in a git repository" });
    const refused = besideWorld({ places: placesOf({ ok: false, error: "the folder H:/filament-flow-a-lexer is not empty" }) });
    await assert.rejects(refused.beside.fire("c1", { ...FIRE, own: { name: "flow-a-lexer" } }), /its worktree could not be made: the folder H:\/filament-flow-a-lexer is not empty/);
    assert.equal(refused.posted.length, 0, "no chat, no turn");
    const places = placesOf(made);
    const cut = besideWorld({ places, refuse: true });
    await assert.rejects(cut.beside.fire("c1", { ...FIRE, own: { name: "flow-a-lexer" } }), /lead could not start: its model is gone/);
    assert.deepEqual([cut.removed.length, places.back], [1, ["H:/filament-flow-a-lexer"]], "its chat and its worktree both go");
    // (fails before: yes — the flows hunt of 10-23: the template's copy went on writing the folder back as it was taken)
    assert.deepEqual(places.order, ["the copy into t1 stopped: its team's lead could not start", "taken back"], "its copy ends first");
  });
});

describe("teams beside take a flow's box (F2)", () => {
  // (fails before: yes — a fire had no hand-off part: the results had to fit in the 4,000 a Brief's words take, and
  // every fire left its mark in the main chat)
  test("a flow's fire: the hand-off a part of its own between the record and the ask, no mark, its flow kept, its card the person's", async () => {
    const w = besideWorld();
    const handoff = `[Filament: you are one box of a flow]\n\n${"R".repeat(50_000)}`;
    const row = await w.beside.fire("c1", { team: "builders", ask: "Your part: Build it.", by: "flow", flow: { id: "f1", box: "b4" }, handoff });
    assert.equal(w.posted.length, 1);
    const content = w.posted[0].body.content;
    assert.deepEqual(content.map((/** @type {any} */ b) => b.text.slice(0, 20)), ["<main-chat title=\"x\"", "[Filament: you are o", "Your part: Build it."]);
    assert.equal(content[1].text.length, handoff.length, "the results whole");
    assert.deepEqual(w.marks, [], "no fired mark in the main chat");
    assert.deepEqual(row.flow, { id: "f1", box: "b4" });
    assert.equal(row.firedBy, "you");
    assert.equal(row.readOnly, false);
    assert.equal(w.said.at(-1).what, "fired");
  });

  // (fails before: yes — a box drawn Reads only ran a writing team writing)
  test("a box drawn Reads only runs its team read-only; a team that reads only stays so", async () => {
    const w = besideWorld();
    const row = await w.beside.fire("c1", { team: "builders", ask: "Your part: an architecture.", by: "flow", flow: { id: "f1", box: "b2" }, readOnly: true, reads: "words" });
    assert.equal(row.readOnly, true);
    assert.equal(w.chains.get(row.id).settings.loop?.permissions, "read-only");
    assert.deepEqual(w.posted[0].body.content.map((/** @type {any} */ b) => b.text.slice(0, 10)), ["Your part:"], "reads the words alone: no record");
  });

  test("a hand-off is a flow's alone, and a flow's send names its flow", async () => {
    const w = besideWorld();
    await assert.rejects(w.beside.fire("c1", { team: "builders", ask: "x", handoff: "results" }), /a hand-off rides with a flow's box alone/);
    await assert.rejects(w.beside.fire("c1", { team: "builders", ask: "x", by: "flow" }), /: a flow's send names its flow and its box$/);
    assert.equal(w.posted.length, 0);
  });

  // (fails before: yes — a flow's team box ended with a result mark in the main chat)
  test("a flow's team box that ends: its state said, no result mark, no switch acts", async () => {
    const w = besideWorld();
    const row = await w.beside.fire("c1", { team: "bughunters", ask: "Your part: hunt.", by: "flow", flow: { id: "f1", box: "b5" } });
    w.facts[row.id] = { busy: false, asking: false, turns: 1, last: { n: 1, final: true, text: "Findings: none", cut: false, endedAt: NOW } };
    w.said.length = 0;
    w.beside.released(row.id);
    assert.deepEqual(w.said.map((m) => m.what), ["state"]);
    assert.deepEqual(w.marks, []);
    assert.equal(w.beside.row(row.id)?.state, "done");
  });
});

describe("a message of Filament's own to the main agent (F2: the flow's end)", () => {
  test("into the running turn where it takes words; else a turn of its own", async () => {
    const steering = besideWorld({ busy: true, steers: true });
    assert.equal(await steering.beside.deliverOwn("c1", { id: "f1", text: "the end", sent: () => {} }), "steered");
    assert.deepEqual(steering.steered, [{ chain: "c1", text: "the end" }]);
    const free = besideWorld();
    assert.equal(await free.beside.deliverOwn("c1", { id: "f1", text: "the end", sent: () => {} }), "sent");
    assert.deepEqual(free.sent, [{ chain: "c1", text: "the end" }]);
  });
  // (fails before: yes — a waiting message noted its going on the team chat its id named: a flow's id names none, so
  // the flow never heard it went)
  test("held while a turn holds the chat, sent once it ends — and whoever sent it hears so", async () => {
    const w = besideWorld({ busy: true, steers: false });
    /** @type {any[]} */
    const heard = [];
    assert.equal(await w.beside.deliverOwn("c1", { id: "f1", text: "the end", sent: (how, why) => heard.push([how, why]) }), "waits");
    assert.deepEqual(w.sent, []);
    w.busy = false;
    w.beside.released("c1");
    await settled();
    assert.deepEqual(w.sent, [{ chain: "c1", text: "the end" }]);
    assert.deepEqual(heard, [["sent", undefined]]);
  });
});

// (fails before: yes — the bug round of 10-23: the teams a message named lived in Filament's memory alone, so after a
// restart its agent could no longer start the one its person named)
test("the teams a message names are kept on its chat: after a restart its agent may still start one", () => {
  const w = besideWorld();
  assert.deepEqual(w.beside.heard("c1", "then send BugHunters over the lexer"), ["bughunters"]);
  assert.deepEqual(w.chains.get("c1").meta.heardTeams, ["bughunters"]);
  const again = besideWorld();
  again.chains.get("c1").meta.heardTeams = ["bughunters"];
  assert.ok(again.beside.agentMay("c1").includes("bughunters"), "read back from the chat");
});

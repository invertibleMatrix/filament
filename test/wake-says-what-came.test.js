// @ts-check
// Each wake says what came (the nudge map of 11-10): a chat woken for a check's verdict, its agent's own command task's
// end, an apply's verdict or the person's answer to the side-by-side card was told "another agent's report has come",
// and a wait those ended said "a sub-agent reported". The registry keeps what each graph's word is about (`about`) —
// across a restart too — the wake's line is chosen by the kinds queued, several kinds saying what came, and the wait
// says the same. A report sealed in a turn no longer keeps the wake it came with, so it never reads as a letter still
// owed one. Driven directly: the registry with no launches, the loop with a scripted model call; no network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { ANY_WAKE_LINE, CARD_WAKE_LINE, CHECK_WAKE_LINE, COMMAND_WAKE_LINE, MERGE_WAKE_LINE, REPORT_WAKE_LINE, isWakeMessage, wakeLineFor } from "../src/app/sessions/wake.js";

const root = tmpdir();
/** A registry with no launches; `saved`: the queue a restart reads back. @param {{ saved?: any[] }} [o] */
const made = (o = {}) => {
  /** @type {string[]} */
  const woken = [];
  /** @type {{ saved: any[] }} */
  const kept = { saved: o.saved || [] };
  const registry = createSubagentRegistry(/** @type {any} */ ({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    now: Date.now,
    context: {
      settings: () => ({ subagents: { pool: [{ model: "", seats: 4 }] }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: root, model: "m", projectId: "p1" }),
      view: async () => ({ text: "", turns: 0 }),
      brief: async () => null,
      modelProblem: () => null,
      mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
      reportWaits: (/** @type {string} */ chain) => void woken.push(chain),
      saveQueue: (/** @type {string} */ _c, /** @type {any[]} */ q) => void (kept.saved = q),
      loadQueue: () => kept.saved,
    },
    call: async () => {
      throw new Error("no launch here");
    },
  }));
  return { registry, woken, kept };
};
/** A graph's word as the runner tells it: woken for, and what it is about. @param {string} text @param {any} [about] */
const word = (text, about) => ({ text, from: "", description: "the task graph", spends: [], wrote: false, wakes: true, ...(about ? { about } : {}) });

describe("the wake's words", () => {
  test("each kind its own line, Filament's line all the same; an unknown kind a command's end", () => {
    const lines = ["report", "check", "command", "merge", "card"].map(wakeLineFor);
    assert.deepEqual(lines, [REPORT_WAKE_LINE, CHECK_WAKE_LINE, COMMAND_WAKE_LINE, MERGE_WAKE_LINE, CARD_WAKE_LINE]);
    assert.equal(new Set(lines).size, 5, "each says its own");
    assert.match(CHECK_WAKE_LINE, /^\[Filament: a check's verdict has come for you;/);
    assert.match(CARD_WAKE_LINE, /^\[Filament: the person answered the card that suggested tasks to run side by side;/);
    for (const l of lines) assert.ok(isWakeMessage({ role: "user", content: [{ type: "text", text: "[Filament: t1 is done …]" }, { type: "text", text: l }] }), l);
    assert.equal(wakeLineFor("mixed"), ANY_WAKE_LINE);
  });
});

describe("the registry keeps what each word is about", () => {
  // (fails before: yes — the registry knew no kind of a graph's word, and the wake said each as a report)
  test("the kinds queued for the wake, each once in the order they came; a report or a worker's end is a report", () => {
    const { registry, woken } = made();
    registry.tell("c", word("[Filament: t1's check passed]", "check"));
    assert.deepEqual([registry.reportsDue("c"), registry.dueKinds("c"), woken], [true, ["check"], ["c"]]);
    registry.tell("c", word("[Filament: t2's check failed]", "check"));
    registry.tell("c", word("[Filament: t3 is done]"));
    registry.tell("c", word("[Filament: t4 merged]", "merge"));
    assert.deepEqual(registry.dueKinds("c"), ["check", "report", "merge"]);
    assert.deepEqual(made().registry.dueKinds("c"), [], "none waits");
  });

  // (fails before: yes — FabeleHelper's of 11-10: a worker's end held for the graph's other workers rides the wake
  // another end brings, yet the wake said only that one's kind)
  test("a worker's end held for the graph rides the wake a command task's end brings, and is said: a report; held alone, none is due", () => {
    const { registry } = made();
    registry.tell("c", { ...word("[Filament: t1 is done]"), wakes: false, held: true });
    assert.deepEqual([registry.reportsDue("c"), registry.dueKinds("c")], [false, []], "held: it wakes nothing");
    registry.tell("c", word("[Filament: t2's command ran]", "command"));
    assert.deepEqual([registry.reportsDue("c"), registry.dueKinds("c")], [true, ["report", "command"]]);
  });

  // (fails before: yes — kept for a restart, a word lost what it was about, and its wake said a report)
  test("kept across a restart: the wake it owes and what it is about", () => {
    const one = made();
    one.registry.tell("c", word("[Filament: the person ignored the card]", "card"));
    one.registry.tell("c", word("[Filament: cmd ran]", "command"));
    assert.deepEqual(one.kept.saved.map((d) => [d.wakes, d.about]), [[true, "card"], [true, "command"]]);
    const two = made({ saved: one.kept.saved });
    assert.deepEqual([two.registry.reportsDue("c"), two.registry.dueKinds("c")], [true, ["card", "command"]]);
  });

  // (fails before: yes — a waiting loop heard a check's verdict as a report, "a sub-agent reported")
  test("a running turn's wait hears what came: a word's kind alone, several kinds as mixed, a report as one", async () => {
    const { registry } = made();
    const door = registry.openTurn({ chainId: "c", runId: "turn-1", cwd: root, mode: "edit", model: "m", thinking: null, fork: null });
    const first = door.inbox.arrival();
    registry.tell("c", word("[Filament: t1's check failed]", "check"));
    assert.equal(await first, "check", "as it lands");
    assert.equal(await door.inbox.arrival(), "check", "one already waiting");
    assert.equal(door.inbox.came?.(), "check");
    registry.tell("c", word("[Filament: t2 is done]"));
    assert.equal(await door.inbox.arrival(), "mixed");
    door.inbox.take();
    registry.tell("c", word("[Filament: t3 is done]"));
    assert.equal(await door.inbox.arrival(), undefined, "a report");
    door.close();
  });
});

// (fails before: yes — the nudge map of 11-10: a report that woke the chat kept its wake once its turn sealed it, so the
// chat was said to be owed a wake for a letter — "a letter … waits sealed" — where no letter was sealed)
test("a report sealed in a turn keeps no wake: no letter is said to wait sealed once the turn ends", () => {
  // A background sub-agent's report that came while no turn ran, as the session keeps it.
  const { registry } = made({ saved: [{ text: "The report.", from: "sa_1", description: "Audit", kind: "report", seal: true, sender: 'sub-agent sa_1 ("Audit")', subject: "Audited", wakes: true }] });
  assert.deepEqual([registry.reportsDue("c"), registry.lettersDue("c")], [true, false], "it came while no turn ran: it wakes the chat");
  const door = registry.openTurn({ chainId: "c", runId: "turn-1", cwd: root, mode: "edit", model: "m", thinking: null, fork: null });
  const [line] = door.inbox.take({ seal: true });
  assert.equal(line.kind, "envelope", "the agent at work: it went sealed");
  door.close();
  assert.deepEqual(registry.envelopes("c").map((e) => e.n), [1], "it waits sealed, a report");
  assert.deepEqual([registry.lettersDue("c"), registry.reportsDue("c")], [false, false], "no letter is owed a wake, nor a report");
});

/**
 * The model's turn: it waits a second, then ends. `inbox`'s arrival and what its owed work does decide what the wait
 * says. What the wait answered. @param {any} inbox
 */
const waited = async (inbox) => {
  let n = 0;
  const out = await runAgentTurn(/** @type {any} */ ({
    model: "m",
    messages: [{ role: "user", content: "go" }],
    system: "s",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "auto",
    root: tmpdir(),
    readerModel: "",
    maxTokens: 100,
    call: async () => (++n === 1 ? { ok: true, status: 200, json: { content: [{ type: "tool_use", id: "w1", name: "wait", input: { seconds: 5 } }], usage: { input_tokens: 10, output_tokens: 5 } }, id: null } : { ok: true, status: 200, json: { content: [{ type: "text", text: "Done." }], usage: { input_tokens: 10, output_tokens: 5 } }, id: null }),
    costOf: () => 0,
    runHand: async (/** @type {string} */ name) => `${name} ran`,
    delegateRead: null,
    mailbox: { read: () => [] },
    permissions: null,
    tree: null,
    onEvent: () => {},
    previewChars: 0,
    sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } },
    signal: null,
    resume: null,
    inbox: { take: () => [], back() {}, hold() {}, sealed: () => [], held: () => 0, who: "sub-agents", ...inbox },
  }));
  assert.equal(out.status, "done", JSON.stringify(out).slice(0, 1500));
  return String(out.work[1].content[0].content);
};

describe("the wait says what came", () => {
  // (fails before: yes — each said "Waited 0 s: a sub-agent reported. Its report follows as a message.")
  test("a check's verdict, a command task's end, an apply's verdict, the card's answer, several at once; a report as ever", async () => {
    let owed = 0;
    /** @param {string | undefined} what */
    const came = (what) => waited({ owed: () => (++owed % 2 ? new Promise(() => {}) : null), arrival: () => Promise.resolve(what) });
    assert.equal(await came("check"), "Waited 0 s: a check's verdict came. It follows as a message.");
    assert.equal(await came("command"), "Waited 0 s: a command task of your plan ended. Its end follows as a message.");
    assert.equal(await came("merge"), "Waited 0 s: an apply's verdict came — whether a task's change went into the folder. It follows as a message.");
    assert.equal(await came("card"), "Waited 0 s: the person answered the card that suggested tasks to run side by side. Their answer follows as a message.");
    assert.equal(await came("mixed"), "Waited 0 s: more than one thing came for you. They follow as messages.");
    assert.equal(await came(undefined), "Waited 0 s: a sub-agent reported. Its report follows as a message.");
  });

  // (fails before: yes — a wait its owed work let go of said "a sub-agent reported" whatever waited)
  test("a wait the owed work let go of says what waits: an apply's verdict; with nothing said, a report", async () => {
    let asked = 0;
    /** @param {string | undefined} what */
    const settled = (what) => waited({ owed: () => (++asked % 2 ? Promise.resolve() : null), arrival: () => new Promise(() => {}), came: () => what });
    assert.equal(await settled("merge"), "Waited 0 s: an apply's verdict came — whether a task's change went into the folder. It follows as a message.");
    assert.equal(await settled(undefined), "Waited 0 s: a sub-agent reported. Its report follows as a message.");
  });
});

// HarnessV3-Views V6, the close: what the live team run on GLM 5.3 found, each fix pinned.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { compose } from "../src/app/sessions/compose.js";
import { resolveSettings } from "../src/services/session-settings.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { ruleFor, subjectsOf, UNCOVERABLE_WHY } from "../src/app/agent/rules.js";
import { redactSecrets } from "../src/core/redact.js";
import { ALWAYS_ONLY, permissionBlock } from "../src/ui/harness/conversation/interaction.js";
import { answerControls, questionOf, workerLine } from "../src/ui/harness/conversation/decisions.js";
import { foldSplit, settingsRowWords } from "../src/ui/harness/lib/labels.js";
import { teamBadge } from "../src/ui/harness/lib/team.js";

const settingsFor = (session) => resolveSettings({ session }).effective;
const NEW = { role: "user", content: [{ type: "text", text: "what now" }] };
const PERMISSION = "May I run this command? `node --test` — answer /allow to run it, or say what to do instead.";
const said = (/** @type {any} */ m) => JSON.stringify(m.content);
/** A command past the question's 160 characters, on two lines, with a key in it. @param {string} folder */
const longCommand = (folder) => `cd "${folder}" && ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz node --test --test-reporter=spec \\\n  ${"test/a-rather-long-name.test.js ".repeat(5).trim()}`;
/** The reader's reason a command asks, as a card says it beside the command. */
const REASON = /^Filament cannot tell that it only reads inside the working folder: .+\.$/;
/** The first node under `n` wearing a class. @param {any} n @param {string} cls @returns {any} */
const one = (n, cls) => {
  if (!n || typeof n !== "object") return null;
  if (String(n.attrs?.class || "").split(/\s+/).includes(cls)) return n;
  for (const k of n.kids || []) {
    const hit = one(k, cls);
    if (hit) return hit;
  }
  return null;
};

/**
 * A loop turn whose model runs `command` once in Edit mode — with bash, or the command hand `name` — then ends: a
 * session's turn, which pauses for the permission, or — with `asker` — a team's worker's, whose call waits in place
 * for the answer `asker` gives.
 * @param {string} command @param {{ root?: string, asker?: any, name?: string }} [o]
 */
const commandTurn = async (command, { root = tmpdir(), asker = null, name = "bash" } = {}) => {
  /** @type {any[]} */
  const events = [];
  let n = 0;
  const out = await runAgentTurn(
    /** @type {any} */ ({
      model: "m",
      messages: [{ role: "user", content: "run it" }],
      system: "s",
      tools: toolSetFor({ delegateRead: false }),
      modeNow: () => "edit",
      root,
      readerModel: "",
      maxTokens: 100,
      unattended: asker ? "worker" : false,
      asker,
      call: async () => {
        const content = n++ === 0 ? [{ type: "tool_use", id: "b1", name, input: { command } }] : [{ type: "text", text: "Done." }];
        return { ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null };
      },
      costOf: () => 0,
      runHand: async () => "ok",
      delegateRead: null,
      mailbox: null,
      permissions: null,
      tree: null,
      onEvent: (/** @type {any} */ e) => events.push(e),
      previewChars: 0,
      sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() {}, count() { return 0; } },
      signal: null,
      resume: null,
    }),
  );
  return { out, ask: events.find((e) => e.type === "ask") };
};

/** The agent read a file, then ran the suite: the turn paused on the command's permission, Filament's note its final. */
const asking = () => ({
  turnId: 101,
  n: 1,
  user: { role: "user", content: [{ type: "text", text: "Test the parser." }] },
  work: [
    { role: "assistant", content: [{ type: "text", text: "Reading." }, { type: "tool_use", id: "r1", name: "read", input: { path: "src/parse.js" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "r1", content: "export function parseLine() {}" }] },
  ],
  final: { role: "assistant", content: [{ type: "text", text: PERMISSION }] },
  meta: { notice: { kind: "permission", text: PERMISSION } },
});
/** The developer allowed it: the turn opens with the reply that asked (`resumes`), its call answered by its result. */
const answering = (n = 2, id = "a1", { user = "yes", resumes = "permission" } = {}) => ({
  turnId: 100 + n,
  n,
  user: { role: "user", content: [{ type: "text", text: user }] },
  work: [
    { role: "assistant", content: [{ type: "text", text: "Running the suite." }, { type: "tool_use", id, name: "bash", input: { command: "node --test" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "tests 10, pass 10" }] },
  ],
  final: { role: "assistant", content: [{ type: "text", text: "The suite passes." }] },
  meta: { resumes },
});

test("V6-11: an asking turn and the turn that answers it reach the model as the trajectory it ran — no note, no answer message (fails before: yes — the note read as the model's reply, then the answer, then its call)", async () => {
  const c = await compose({ turns: [asking(), answering()], settings: settingsFor({}), newUser: NEW, model: "m" });
  const msgs = c.body.messages;
  assert.deepEqual(msgs.map((m) => m.role), ["user", "assistant", "user", "assistant", "user", "assistant", "user"]);
  assert.ok(!msgs.some((m) => said(m).includes("May I run")), "Filament's note is not the model's words");
  assert.ok(!msgs.some((m) => m.role === "user" && /"yes"/.test(said(m))), "the answer rides the call's result, not a message");
  assert.equal(msgs[3].content[1].name, "bash", "the reply that asked follows the turn's own work");
  assert.deepEqual(c.report.turns.map((t) => t.shape), ["raw", "raw"]);
});

test("V6-11: a pause answered by a turn that pauses again joins all three — each note and each answer left out (fails before: yes — two notes and two answers read as conversation)", async () => {
  const middle = answering(2, "a1");
  middle.final = { role: "assistant", content: [{ type: "text", text: PERMISSION }] };
  middle.meta = { resumes: "permission", notice: { kind: "permission", text: PERMISSION } };
  const last = answering(3, "b1");
  const c = await compose({ turns: [asking(), middle, last], settings: settingsFor({}), newUser: NEW, model: "m" });
  const msgs = c.body.messages;
  assert.deepEqual(msgs.map((m) => m.role), ["user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant", "user"]);
  assert.ok(!msgs.some((m) => said(m).includes("May I run")));
  assert.ok(!msgs.some((m) => m.role === "user" && /"yes"/.test(said(m))));
  assert.deepEqual(msgs.filter((m) => m.role === "assistant").map((m) => m.content.find((b) => b.type === "tool_use")?.id || "final"), ["r1", "a1", "b1", "final"]);
});

test("V6-11: an asking turn a compaction folded folds without the note, and the raw answer keeps its message (fails before: yes — the fold carried the note as the model's words)", async () => {
  const ask = asking();
  ask.meta = { ...ask.meta, compacted: { shape: "fold", id: 1, at: 1 } };
  const c = await compose({ turns: [ask, answering()], settings: settingsFor({}), newUser: NEW, model: "m" });
  const msgs = c.body.messages;
  assert.deepEqual(c.report.turns.map((t) => t.shape), ["fold", "raw"]);
  assert.deepEqual(msgs.map((m) => m.role), ["user", "assistant", "user", "assistant", "user", "assistant", "user"]);
  assert.ok(!said(msgs[1]).includes("May I run"));
  assert.match(said(msgs[1]), /read src\/parse\.js/, "the fold keeps the turn's own work");
  assert.match(said(msgs[2]), /"yes"/, "a folded asking turn ends on an answer of its own, so the next turn's message stays");
});

test("V6-11: a question the model asked and the turn that answers it join too — its note and the answer left out (fails before: no — a guard the mutation pass asked for: every pause the loop makes joins its answer)", async () => {
  const question = "Which parser should I keep?\n1. the old one\n2. the new one\nReply with the number of your choice.";
  const ask = asking();
  ask.final = { role: "assistant", content: [{ type: "text", text: question }] };
  ask.meta = { notice: { kind: "ask", text: question } };
  const answer = answering(2, "q1", { user: "the new one", resumes: "ask" });
  answer.work = [
    { role: "assistant", content: [{ type: "text", text: "Asking." }, { type: "tool_use", id: "q1", name: "ask", input: { question: "Which parser should I keep?", options: [{ label: "the old one" }, { label: "the new one" }] } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "q1", content: "The developer chose: the new one" }] },
  ];
  const c = await compose({ turns: [ask, answer], settings: settingsFor({}), newUser: NEW, model: "m" });
  const msgs = c.body.messages;
  assert.deepEqual(msgs.map((m) => m.role), ["user", "assistant", "user", "assistant", "user", "assistant", "user"]);
  assert.ok(!msgs.some((m) => said(m).includes("Reply with the number")), "the question's card is not the model's words");
  assert.ok(!msgs.some((m) => m.role === "user" && m.content.some((/** @type {any} */ b) => b.type === "text" && b.text === "the new one")), "the answer rides the call's result");
});

test("V6-11: an asking turn sent raw whose run cannot go raw folds without its note, and says why (fails before: no — a guard the mutation pass asked for: it folds as a shaped asking turn does)", async () => {
  const broken = asking();
  broken.work[1] = { role: "user", content: [{ type: "tool_result", tool_use_id: "r9", content: "elsewhere" }] };
  const c = await compose({ turns: [broken, answering()], settings: settingsFor({}), newUser: NEW, model: "m" });
  assert.deepEqual(c.report.turns.map((t) => [t.shape, t.fallback || null]), [["fold", "tool_use r1 has no tool_result"], ["raw", null]]);
  assert.ok(!c.body.messages.some((m) => said(m).includes("May I run")), "the fold leaves the note out");
  assert.deepEqual(c.body.messages.map((m) => m.role), ["user", "assistant", "user", "assistant", "user", "assistant", "user"]);
});

test("V6-11: a raw asking turn before an answer a compaction folded keeps its note, and the fold its message (fails before: no — a guard the mutation pass asked for: only two raw turns join)", async () => {
  const answer = answering();
  answer.meta = { ...answer.meta, compacted: { shape: "fold", id: 1, at: 1 } };
  const c = await compose({ turns: [asking(), answer], settings: settingsFor({}), newUser: NEW, model: "m" });
  const msgs = c.body.messages;
  assert.deepEqual(c.report.turns.map((t) => t.shape), ["raw", "fold"]);
  assert.deepEqual(msgs.map((m) => m.role), ["user", "assistant", "user", "assistant", "user", "assistant", "user"]);
  assert.ok(said(msgs[3]).includes("May I run"), "the note ends the raw turn: the fold's own message answers it");
  assert.match(said(msgs[4]), /"yes"/);
});

test("V6-11: a pause nobody answered keeps its note — the turn after it is a new one, not its answer (fails before: no — a guard the join asks for: only the answer's own turn joins)", async () => {
  const next = answering(2, "a1", { user: "Never mind — explain the parser instead." });
  next.meta = {};
  next.work = [];
  const c = await compose({ turns: [asking(), next], settings: settingsFor({}), newUser: NEW, model: "m" });
  const msgs = c.body.messages;
  assert.ok(said(msgs[3]).includes("May I run"), "the note stays: the model asked, and the developer moved on");
  assert.match(said(msgs[4]), /Never mind/);
});

describe("On a session: a pause, the turn that answers it, and the turn after", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let folder;
  // A test that reads the session while the answer runs holds the answered call here; `answered` says it came.
  /** @type {Promise<void>} */
  let held = Promise.resolve();
  let answered = false;
  before(async () => {
    folder = mkdtempSync(join(tmpdir(), "filament-views-close-"));
    up = await fakeUpstream(async (call) => {
      const b = call.body || {};
      const now = JSON.stringify(b.messages || []);
      const model = String(b.model || "");
      const blocks = (/** @type {any[]} */ list, stop = "end_turn") => anthropicReply("", { model, stop, blocks: list, usage: { input_tokens: 5, output_tokens: 3 } });
      if (now.includes("TURN: and then?")) return blocks([{ type: "text", text: "THEN" }]);
      if (now.includes("TURN: the suite")) return blocks([{ type: "text", text: "Running the suite." }, { type: "tool_use", id: "toolu_long", name: "bash", input: { command: longCommand(folder) } }], "tool_use");
      if (JSON.stringify(b.messages?.at(-1)?.content || "").includes('"tool_use_id":"toolu_run"')) {
        answered = true;
        await held;
        return blocks([{ type: "text", text: "RAN" }]);
      }
      return blocks([{ type: "text", text: "Checking the version." }, { type: "tool_use", id: "toolu_run", name: "bash", input: { command: "node -p process.version" } }], "tool_use");
    });
    shim = await startApp({
      memory: true,
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(folder, shim.dataDir);
  });
  /** @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    return (await r.json()).content.filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("");
  };
  /** A request's messages as the provider's cache reads them. @param {any} body */
  const bare = (body) => /** @type {any[]} */ (JSON.parse(JSON.stringify(body.messages, (k, v) => (k === "cache_control" ? undefined : v))));
  /** A new session in `cwd` whose first turn paused on the permission to run its command. */
  const paused = async (first = "TURN: run it", cwd = folder) => {
    const c = await shim.api("/api/sessions", { method: "POST", body: { cwd, model: "m-1", preset: "plain" } });
    assert.equal(c.status, 200, await c.clone().text());
    const id = String((await c.json()).id);
    assert.match(await turn(id, first), /May I run this command\?/);
    return id;
  };
  /** @param {string} id */
  const transcript = async (id) => (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript?limit=5&work=0`)).json();

  // (fails before: yes — the third turn's request read "May I run this command? …" as the model's reply, then "yes",
  // and so began apart from the bytes the resumed turn had sent: the cache broke at the pause)
  test("V6-11: the third turn reads the run as the model ran it: no question, no 'yes', and the resumed request is its prefix", async () => {
    const id = await paused();
    assert.equal(await turn(id, "yes"), "RAN");
    const resumed = up.received.filter((x) => x.kind === "anthropic").at(-1)?.body;
    assert.equal(await turn(id, "TURN: and then?"), "THEN");
    const third = up.received.filter((x) => x.kind === "anthropic").at(-1)?.body;
    const msgs = bare(third);
    assert.ok(!JSON.stringify(msgs).includes("May I run this command"), "Filament's question is not the model's words");
    assert.ok(!msgs.some((m) => m.role === "user" && JSON.stringify(m.content).includes('"yes"')), "the answer rides the result");
    const prefix = bare(resumed);
    assert.deepEqual(msgs.slice(0, prefix.length), prefix, "the request the resumed turn sent is where this one begins");
  });

  // (fails before: yes — the transcript said the permission still waited while the turn that answered it ran: a client
  // that reads `paused` drew a question nobody could answer, and waited on it)
  test("V6-12: while the turn that answers a pause runs, the transcript says no decision waits", async () => {
    const id = await paused();
    /** @type {() => void} */
    let release = () => {};
    held = new Promise((r) => (release = r));
    answered = false;
    const answer = turn(id, "yes");
    try {
      for (let i = 0; i < 200 && !answered; i++) await new Promise((r) => setTimeout(r, 25));
      assert.ok(answered, "the answer's turn reached the model");
      const tr = await transcript(id);
      assert.ok(tr.live, "the answer's turn runs");
      assert.equal(tr.paused, null, "no decision waits while it runs");
    } finally {
      release();
    }
    assert.equal(await answer, "RAN");
    assert.equal((await transcript(id)).paused, null);
  });

  // (fails before: yes — HarnessV3-Views V6's fourth pass: the lead's question, answered, still waited in the
  // transcript for the 4 s memory took to prepare the answer's turn: the resume marks the pause only as the
  // agent's turn begins, after memory's preparation)
  test("V6-18: from the first moment of the turn that answers a pause, before the resume marks it, no decision waits", async () => {
    // A folder of its own: the allows here count apart from the suite's, under the five that offer an always-allow.
    const cwd = join(folder, "v6-18");
    mkdirSync(cwd, { recursive: true });
    const id = await paused("TURN: run it", cwd);
    /** @type {() => void} */
    let release = () => {};
    held = new Promise((r) => (release = r));
    answered = false;
    const answer = turn(id, "yes");
    try {
      for (let i = 0; i < 200 && !answered; i++) await new Promise((r) => setTimeout(r, 25));
      assert.ok(answered, "the answer's turn reached the model");
      // The answer's turn as it stands before the resume's mark: the mark taken off.
      const archive = /** @type {any} */ (shim.app.memory).archive;
      const { answeredBy, ...unmarked } = archive.getChain(id).meta.paused;
      assert.ok(answeredBy, "the resume marked it");
      archive.mergeMeta(id, { paused: unmarked });
      const tr = await transcript(id);
      assert.ok(tr.live, "the answer's turn runs");
      assert.equal(tr.paused, null, "no decision waits while it runs");
    } finally {
      release();
    }
    assert.equal(await answer, "RAN");
  });

  // (fails before: no — a guard the mutation pass asked for: the turn's age and the resume's mark each hide a pause on
  // their own — a turn running since before the pause was parked, as the pausing turn's own last moment is, leaves it
  // waiting, unless the resume marked it as that turn's)
  test("V6-18: a turn begun before the pause leaves it waiting, unless it is the turn the resume marked", async () => {
    const cwd = join(folder, "v6-18");
    mkdirSync(cwd, { recursive: true });
    const id = await paused("TURN: run it", cwd);
    /** @type {() => void} */
    let release = () => {};
    held = new Promise((r) => (release = r));
    answered = false;
    const answer = turn(id, "yes");
    try {
      for (let i = 0; i < 200 && !answered; i++) await new Promise((r) => setTimeout(r, 25));
      assert.ok(answered, "the answer's turn reached the model");
      const archive = /** @type {any} */ (shim.app.memory).archive;
      const marked = archive.getChain(id).meta.paused;
      const { answeredBy, ...unmarked } = marked;
      assert.ok(answeredBy, "the resume marked it");
      const later = Date.now() + 60_000;
      archive.mergeMeta(id, { paused: { ...marked, at: later } });
      assert.equal((await transcript(id)).paused, null, "the resume's mark hides it");
      archive.mergeMeta(id, { paused: { ...unmarked, at: later } });
      assert.equal((await transcript(id)).paused?.kind, "permission", "unmarked, it waits");
    } finally {
      release();
    }
    assert.equal(await answer, "RAN");
  });

  // (fails before: no — a guard the mutation pass asked for: the answer's mark keeps the pause it marks whole, so an
  // answer refused before it runs leaves the pause to wait as it was)
  test("V6-12: an answer refused before it runs — its working folder gone — leaves the pause waiting as it was, and the next answer runs it", async () => {
    const cwd = join(folder, "gone");
    mkdirSync(cwd);
    const c = await shim.api("/api/sessions", { method: "POST", body: { cwd, model: "m-1", preset: "plain" } });
    assert.equal(c.status, 200, await c.clone().text());
    const id = String((await c.json()).id);
    assert.match(await turn(id, "TURN: run it"), /May I run this command\?/);
    const waiting = (await transcript(id)).paused;
    rmSync(cwd, { recursive: true, force: true });
    assert.match(await turn(id, "yes"), /The working folder does not exist/);
    assert.deepEqual((await transcript(id)).paused, waiting, "the pause waits again, whole");
    mkdirSync(cwd);
    assert.equal(await turn(id, "yes"), "RAN");
  });

  // (fails before: no — a guard the fix asks for: an answer's mark leaves the pause out only while that request runs)
  test("V6-12: a pause marked by an answer that runs no more — Filament stopped mid-turn — waits again, and the next message answers it", async () => {
    const id = await paused();
    const archive = /** @type {any} */ (shim.app.memory).archive;
    archive.mergeMeta(id, { paused: { ...archive.getChain(id).meta.paused, answeredBy: "req_gone" } });
    const tr = await transcript(id);
    assert.equal(tr.live, null);
    assert.equal(tr.paused?.kind, "permission", "the question waits again");
    assert.equal(await turn(id, "yes"), "RAN");
  });

  // (fails before: yes — a page loaded while the permission waited named its question, the command cut at 160
  // characters onto one line, and had nothing more to show)
  test("V6-9: a page loaded while a command waits gets it whole, redacted, and the reason apart from it", async () => {
    const p = (await transcript(await paused("TURN: the suite"))).paused;
    assert.equal(p.command, redactSecrets(longCommand(folder)));
    assert.match(p.reason, REASON);
    assert.match(p.question, /^May I run this command\? `/, "the question's own words stay, for a client that draws no card");
  });
});

// (fails before: yes — the question cut the command at 160 characters, squashed onto one line, and nothing else carried
// it: the developer allowed what they could not read)
test("V6-9: a command that asks is shown whole — its lines, redacted — on the ask and on the pause, its reason apart", async () => {
  const command = longCommand(tmpdir());
  const { out, ask } = await commandTurn(command);
  assert.equal(out.pause?.kind, "permission");
  assert.equal(ask.command, redactSecrets(command));
  assert.ok(ask.command.includes("\n") && !ask.command.includes("abcdefghijklmnop"), "its lines kept, its key redacted");
  assert.match(ask.reason, REASON);
  assert.match(ask.question, /^May I run this command\? `/, "the question's own words stay, for a client that draws no card");
  assert.equal(out.pause.reason, ask.reason, "the pause keeps the reason for a page loaded while it waits");
});

// (fails before: yes — the V6 run: a worker's question carried its command cut at 160 characters, and its cd into its
// own worktree took most of them)
test("V6-9: a worker's waiting call carries its command whole and as it runs — a cd into its own folder left out", async () => {
  const root = tmpdir();
  /** @type {any[]} */
  const asked = [];
  const asker = async (/** @type {any} */ q) => {
    asked.push(q);
    return { text: "no" };
  };
  const tests = "test/a-rather-long-name.test.js ".repeat(6).trim();
  await commandTurn(`cd "${root}" && node --test ${tests}`, { root, asker });
  await commandTurn(`cd "${root}"; node x.js`, { root, asker });
  assert.deepEqual(asked.map((q) => [q.command, q.runs]), [[`cd "${root}" && node --test ${tests}`, `node --test ${tests}`], [`cd "${root}"; node x.js`, "node x.js"]]);
  assert.match(asked[0].reason, REASON);
});

// (fails before: no — a guard the fix asks for: the line never hides where a command goes)
test("V6-9: only a cd that takes the command nowhere is left out — into another folder, or joined by ||, it stays", async () => {
  const root = tmpdir();
  /** @type {any[]} */
  const asked = [];
  const asker = async (/** @type {any} */ q) => {
    asked.push(q);
    return { text: "no" };
  };
  await commandTurn(`cd "${join(root, "elsewhere")}" && node x.js`, { root, asker });
  await commandTurn(`cd "${root}" || node x.js`, { root, asker });
  assert.deepEqual(asked.map((q) => q.runs), [undefined, undefined]);
});

// (fails before: no — a guard the mutation pass asked for: a cd on a line of its own takes the command nowhere too)
test("V6-9: a worker's cd on a line of its own is left out of the command as it runs", async () => {
  const root = tmpdir();
  /** @type {any[]} */
  const asked = [];
  await commandTurn(`cd "${root}"\nnode x.js`, { root, asker: async (/** @type {any} */ q) => { asked.push(q); return { text: "no" }; } });
  assert.deepEqual(asked.map((q) => [q.command, q.runs]), [[`cd "${root}"\nnode x.js`, "node x.js"]]);
});

// (fails before: no — a guard the mutation pass asked for: a command started in the background says it keeps running)
test("V6-9: a command that asks to start in the background is shown whole, and says it keeps running", async () => {
  const command = longCommand(tmpdir());
  const { ask } = await commandTurn(command, { name: "bash_background" });
  assert.deepEqual([ask.tool, ask.command, ask.reason], ["bash_background", redactSecrets(command), "It starts in the background and keeps running across turns."]);
});

// (fails before: yes — the session's card showed the question, its command cut at 160 characters, and the same command
// again in the preview)
test("V6-9: the session's card shows the command whole, then the reason — the question's cut copy not at all", () => {
  const command = "cd /w && node --test \\\n  test/a.test.js";
  const reason = "Filament cannot tell that it only reads inside the working folder: `node` is not one of the programs known to only read.";
  const question = "May I run this command? `cd /w && node --test \\ test/a.test.js` — Filament cannot tell that it only reads inside the working folder: `node` is not one of the programs known to only read. Answer /allow to run it, or say what to do instead.";
  const block = permissionBlock({ paused: { kind: "permission", tool: "bash", question, command, reason } }, { onAnswer: () => {} }, { h: fakeH });
  assert.equal(textOf(one(block, "ix-preview")), command);
  assert.equal(textOf(one(block, "ix-reason")), "Filament cannot tell that it only reads inside the working folder: |node| is not one of the programs known to only read.");
  assert.ok(!textOf(block).includes("May I run"), "the question's words are the card's to leave out");
  const order = (block.kids || []).map((/** @type {any} */ k) => String(k.attrs?.class || ""));
  assert.ok(order.indexOf("ix-preview") < order.indexOf("ix-reason"), "the command first, then why it asks");
});

// (fails before: yes — the V6 run: the dock's line showed the command cut at 160 characters, mostly the worker's cd
// into its own worktree, and its tooltip the same cut)
test("V6-9: a worker's line in the dock shows its command as it runs, and the whole command on hover", () => {
  const command = `cd "C:\\w\\.git\\filament-worktrees\\sa_1" && node --test ${"test/a-rather-long-name.test.js ".repeat(6).trim()}`;
  const runs = `node --test ${"test/a-rather-long-name.test.js ".repeat(6).trim()}`;
  const row = { id: "sa_1", card: { tag: "tester", name: "Tester", kind: "worker" }, asked: false, may: "edit", status: "running", team: { team: "architect", role: "tester" }, progress: { asking: { tool: "bash", args: `${command.slice(0, 159)}…`, question: "May I run this command? …", command, runs } } };
  const line = workerLine(fakeH, row, { answer: async () => true, always: async () => true, reveal: () => {}, place: (/** @type {any} */ p, /** @type {any[]} */ k) => p.replaceChildren(...k) });
  const chip = one(line, "ask-cmd");
  assert.deepEqual([textOf(chip), chip.attrs.title], [runs, command]);
});

// (fails before: yes — the second read of 11-10: a worker whose agent offers only to always allow its call showed a
// plain Allow on the dock's line, so a yes kept a session-long grant in that agent unsaid)
test("a worker's line whose agent offers only to always allow: Allow always, no rule offered, and what a yes keeps under it", () => {
  const asking = { tool: "bash", args: "make", question: "May I run make?", command: "make", offer: { itemId: 2, tool: "bash", shape: "make *" } };
  const row = { id: "sa_1", card: { tag: "tester", name: "Tester", kind: "worker" }, asked: false, may: "edit", status: "running", team: { team: "architect", role: "tester" }, progress: { asking: { ...asking, always: true } } };
  const draw = (/** @type {any} */ r) => workerLine(fakeH, r, { answer: async () => true, always: async () => true, reveal: () => {}, place: (/** @type {any} */ p, /** @type {any[]} */ k) => p.replaceChildren(...k) });
  /** @param {any} n @returns {string[]} */
  const buttons = (n) => (!n || typeof n !== "object" ? [] : [...(n.tag === "button" && String(n.attrs?.class || "").includes("inst-btn") ? [textOf(n)] : []), ...(n.kids || []).flatMap(buttons)]);
  const line = draw(row);
  assert.deepEqual(buttons(line), ["Deny", "Allow always"]);
  assert.equal(textOf(one(line, "ix-reason")), ALWAYS_ONLY);
  const plain = draw({ ...row, progress: { asking } });
  assert.deepEqual(buttons(plain), ["Deny", "Always allow", "Allow"], "one that offers allow-once, as before");
  assert.equal(one(plain, "ix-reason"), null);
});

// (fails before: yes — the bug hunt of 5d57bbe8a: the thread's strip, the sub-agent viewer and the Team card spread
// `questionOf` and passed the project's offer, so they showed Always allow and a plain Allow, "Run it, this once")
test("every surface that spreads questionOf: an agent that offers only to always allow shows Allow always alone, its offer passed or not", () => {
  const asking = { tool: "bash", args: "make", command: "make", always: true, offer: { itemId: 2, tool: "bash", shape: "make *" } };
  assert.deepEqual(questionOf(asking), { onlyAlways: true });
  assert.deepEqual(questionOf({ ...asking, always: undefined }), {}, "a plain permission, as before");
  /** @param {any} n @returns {string[]} */
  const buttons = (n) => (!n || typeof n !== "object" ? [] : [...(n.tag === "button" ? [textOf(n)] : []), ...(n.kids || []).flatMap(buttons)]);
  const draw = (/** @type {any} */ a) => answerControls(fakeH, { id: "sa_1", who: "the worker", offer: a.offer, answer: async () => true, always: async () => true, place: (/** @type {any} */ p, /** @type {any[]} */ k) => p.replaceChildren(...k), ...questionOf(a) }).el;
  assert.deepEqual(buttons(draw(asking)), ["Deny", "Allow always"]);
  assert.deepEqual(buttons(draw({ ...asking, always: undefined })), ["Deny", "Always allow", "Allow"]);
});

// (fails before: no — a guard the mutation pass asked for: a command with no cd to leave out shows whole on the line)
test("V6-9: a worker's command with nothing to leave out shows whole on the dock's line, not the question's cut", () => {
  const command = `node --test ${"test/a-rather-long-name.test.js ".repeat(6).trim()}`;
  const row = { id: "sa_1", card: { tag: "tester", name: "Tester", kind: "worker" }, asked: false, may: "edit", status: "running", team: { team: "architect", role: "tester" }, progress: { asking: { tool: "bash", args: `${command.slice(0, 159)}…`, question: "May I run this command? …", command } } };
  const line = workerLine(fakeH, row, { answer: async () => true, always: async () => true, reveal: () => {}, place: (/** @type {any} */ p, /** @type {any[]} */ k) => p.replaceChildren(...k) });
  const chip = one(line, "ask-cmd");
  assert.deepEqual([textOf(chip), chip.attrs.title], [command, command]);
});

// (fails before: yes — the V6 run: "Settings changed", with no words, stood above "Switched to the Methodical team":
// the row said again, and less well, what the divider beside it said)
test("V6-10: a settings row beside the engine's divider says only what else moved, and stands only when something did", () => {
  const team = [{ path: "engine.mode", to: "team" }, { path: "engine.team", to: "methodical" }];
  assert.equal(settingsRowWords({ changes: team }, true), null, "the divider says the switch");
  assert.equal(settingsRowWords({}, true), null, "words not known yet: the divider says the one thing known");
  assert.deepEqual(settingsRowWords({ changes: [...team, { path: "engine.supervise", to: true }] }, true), ["The lead reads along with its workers"]);
  assert.deepEqual(settingsRowWords({ changes: team }, false), ["Engine: a team", "Team: methodical"], "no divider: the row says it all, as before");
  assert.deepEqual(settingsRowWords({}, false), [], "no divider and no words yet: the row says settings changed, as before");
});

// (fails before: yes — a row drawn as its turn started said "Settings changed" for good: its words reached the page
// only with a reload)
test("V6-10: the timeline draws a row with the divider in mind, and a turn's own row gets its words when the turn ends (pinned in the page's source: the timeline builds real DOM)", () => {
  const tl = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
  assert.match(tl, /keptBoundaries\(\(v\.keptBefore \|\|= new Map\(\)\), turn\.boundaries \|\| \[\], !!engine\)/);
  assert.match(tl, /const sig = JSON\.stringify\(\[b, divider, paired\]\);[\s\S]{0,200}const row = was\?\.isConnected \? was : made\?\.\(b\) \|\| boundaryRow\(b, divider\);/, "a row kept is the one drawn with the same divider in mind");
  assert.match(tl, /const words = settingsRowWords\(b, divider\);\n\s+if \(!words\) return null;/);
  assert.match(tl, /if \(mine && Array\.isArray\(moved\?\.changes\)\) mine\.changes = moved\.changes;/);
  assert.match(tl, /if \(\(turn\.boundaries \|\| \[\]\)\.some\(\(b\) => b\.type === "settings"\)\) api_\.drawBoundaries\(turn\);/);
});

// (fails before: no — a guard the mutation pass asked for: the words are those of the transcript's row before this very
// turn, set on this turn's own settings row)
test("V6-10: a turn's own row takes the words of the transcript's row before that turn (pinned in the page's source)", () => {
  const tl = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
  assert.match(tl, /const moved = row && \(tr\.boundaries \|\| \[\]\)\.find\(\(b\) => b\.type === "settings" && Number\(b\.beforeTurn\) === Number\(row\.n\)\);/);
  assert.match(tl, /const mine = \(turn\.boundaries \|\| \[\]\)\.find\(\(b\) => b\.type === "settings"\);/);
});

// (fails before: yes — the V6 run: the tab said 2 beside "Workers · 1 at work": it counted the lead)
test("V6-13: the Team tab's number is the workers at work, as the Workers row counts them; the lead's work is its dot", () => {
  const worker = { id: "w1", status: "running", team: { team: "methodical", role: "tester" }, progress: { round: 2 } };
  assert.deepEqual(teamBadge({ live: true, paused: false, rows: [worker], leads: true }), { text: "1", dot: "works", words: "1 at work" });
  assert.deepEqual(teamBadge({ live: true, paused: false, rows: [], leads: true }), { dot: "works", words: "the lead works" }, "the lead alone: a dot, no number");
});

// (fails before: yes — the V6 bench: the rule's note on a worker's `node --test test/money.test.js 2>&1` named
// `node --test test/money.test.js 2>`: the `&` of `2>&1` cut the command in two, and `1` stood as a command of its own)
test("V6-15: the & of a descriptor's copy cuts nothing — a lone & still does — and a stopped allow names its segment whole", () => {
  assert.deepEqual(subjectsOf("bash", { command: "node --test x 2>&1 | tail -5" }), ["node --test x 2>&1 | tail -5", "node --test x 2>&1", "tail -5"]);
  assert.deepEqual(subjectsOf("bash", { command: "node --test x >&2 <&0" }), ["node --test x >&2 <&0"]);
  assert.deepEqual(subjectsOf("bash", { command: "echo done & rm -rf /" }), ["echo done & rm -rf /", "echo done", "rm -rf /"]);
  const hit = ruleFor([{ tool: "bash", pattern: "node --test*", verdict: "allow" }], "bash", { command: "node --test test/money.test.js 2>&1" }, { root: "/home/dev/proj", shell: "bash" });
  assert.deepEqual(hit && "why" in hit ? [hit.verdict, hit.subject, hit.why] : null, ["gate", "node --test test/money.test.js 2>&1", UNCOVERABLE_WHY], "the gate decides, as before: what a rule covers past a redirection is the owner's call");
});

// (fails before: yes — the V6 run's answered proposal: the Scout's order row stood between the lead's question and the
// Approve that answered it; a turn's website and files cards stood there too)
test("V6-14: settled, Filament's closing note is the turn's last word — under its cards, order rows and tree card, right over its answer", () => {
  const text = (/** @type {string} */ t) => ({ kind: "block", block: { type: "text", text: t } });
  const cards = { kind: "cards" };
  const web = { kind: "web" };
  const files = { kind: "files" };
  const words = text("Scout confirms two callers. Launching the Builder now.");
  const asked = text(PERMISSION);
  const note = { kind: "permission", text: PERMISSION };
  assert.deepEqual(foldSplit([cards, words, asked, web, files], { note }), { lastText: words, lead: [], pictures: [], fold: [cards], after: [web, files], closing: asked }, "the words stand with their cards; the note closes the turn");
  assert.deepEqual(foldSplit([words, cards, asked], { note }), { lastText: null, lead: [], pictures: [], fold: [words, cards], after: [], closing: asked }, "a note after the work closes the turn too");
  assert.deepEqual(foldSplit([cards, words, asked, files], { live: true, note }), { lastText: words, lead: [], pictures: [], fold: [cards], after: [asked, files], closing: null }, "live, the order it happened in");
  const tl = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
  assert.match(tl, /const \{ asked, rest \} = askedApart\(segmentsShown\(turn\)\);\s+const \{ lastText, lead, pictures, fold, after, closing \} = foldSplit\(rest, \{ live, note: turn\.note \}\);/);
  assert.match(tl, /\.\.\.after\.map\(\(s\) => s\.el\), v\.notices, v\.orders, .*, v\.tree, v\.shim, v\.unused \|\| null, v\.offer \|\| null, closing \? closing\.el : null, v\.foot\]/, "the page draws it after the order rows, the tree card and Run as a flow (OA6), before the footer");
});

// (fails before: no — a guard the mutation pass asked for: nothing checked that, live, a note that follows work with no
// words before it stays the answer, where it was said)
test("V6-14: live, a note after work is the answer where it was said", () => {
  const cards = { kind: "cards" };
  const asked = { kind: "block", block: { type: "text", text: PERMISSION } };
  const live = foldSplit([cards, asked], { live: true, note: { kind: "permission", text: PERMISSION } });
  assert.deepEqual([live.lastText, live.lead, live.fold, live.after], [asked, [], [cards], []]);
});

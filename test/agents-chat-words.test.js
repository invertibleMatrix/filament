// @ts-check
// An agents' chat's words are never the person's to memory (the remote-agents plan's fc-word): a chat another machine's
// agents started (`meta.agentDevice`, http/admin/sessions.js) — or one up its line: its fork, a chat made from it, a
// team's beside it — opens its turns with their agents' words, not the person's. The learner reads them with no "User:"
// line, a quote of them is not the person's word, a rule learned from them is no rule of the person's (`#saidByPerson`),
// the curator's grounding shows them as theirs, and search names them theirs. Fenced chats (memory off, as sessions.js
// starts them: `muted`) and Full control chats (memory on) alike: what memory reads is whose chat it is, no grant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/archive.js";
import { MemoryLearner } from "../src/memory-learn.js";
import { MemoryBrain, trustOf } from "../src/services/memory/brain.js";
import { GROUND_PROMPT, DOSSIER_PROMPT } from "../src/services/memory/curator.js";
import { executeMemoryTool } from "../src/app/memory-tools.js";
import { world } from "./fixtures/memory-world.mjs";

const WORDS = "always run the linter before you finish";
const RULE = "Always run the linter before finishing a task.";
/** Each line of a reading that opens as the person's. @param {string} s */
const userLines = (s) => s.split("\n").filter((l) => l.startsWith("User:"));

/**
 * A bare archive and brain, each chat said `WORDS` once: the person's, a fenced agents' chat, a Full control one, a fork
 * of the Full control chat, a chat made from it (its parent, its own meta silent), and a team's chat beside it.
 * @param {(o: any) => Promise<void>} body
 */
const chats = async (body) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-agents-words-"));
  const a = /** @type {any} */ (new Archive({ file: join(dir, "a.db") }));
  const brain = new MemoryBrain(/** @type {any} */ ({ archive: a }));
  try {
    let n = 0;
    /** @param {string} key @param {{ meta?: any, parentId?: string | null }} [o] */
    const chat = (key, { meta = null, parentId = null } = {}) => {
      const id = a.chainForKey(key, { cwd: "C:\\widgets", client: "harness", model: "m", parentId }).id;
      if (meta) a.mergeMeta(id, meta);
      return id;
    };
    /** @param {string} chainId @param {string} words */
    const said = (chainId, words, answer = "I will.") => {
      const t = a.beginTurn(chainId, { requestId: `r${++n}`, userMessage: { role: "user", content: words } });
      a.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: answer }, outputChars: answer.length });
      return t.turnId;
    };
    const mine = chat("k-mine");
    // As sessions.js starts a fenced chat: memory off for it (mirrored as `muted`), their device kept on it.
    const fenced = chat("k-fenced", { meta: { agentDevice: "d-fenced", agentFrom: "MacBook", muted: true } });
    // Full control: their agents act here as the person, memory on — their words are theirs all the same.
    const full = chat("k-full", { meta: { agentDevice: "d-full", agentFrom: "Workstation" } });
    for (const id of [mine, fenced, full]) said(id, WORDS);
    const fork = a.forkChain(full, { atTurn: 1, key: "k-fork" }).id;
    const child = chat("k-child", { parentId: full });
    said(child, WORDS);
    const team = chat("k-team");
    a.link(team, full, "beside", 1);
    said(team, WORDS);
    await body({ a, brain, mine, fenced, full, fork, child, team, chat, said });
  } finally {
    brain.stop();
    a.close();
    rmSync(dir, { recursive: true, force: true });
  }
};

// (fails before: yes — the learner read an agents' chat's turns as the person's: each opened "User: <their words>")
test("the learner reads an agents' chat's turns with no User: line — fenced and Full control, their fork, a chat made from one, a team's beside one; the person's chat keeps its own", () =>
  chats(async ({ a, brain, mine, fenced, full, fork, child, team, said }) => {
    const words = (/** @type {any} */ m) => ({ said: typeof m?.content === "string" ? m.content : "", rode: "" });
    const reading = (/** @type {string} */ id) => (a.turnsToRead(id, { words })?.turns ?? []).map((t) => t.text).join("\n\n");
    assert.deepEqual(userLines(reading(mine)), [`User: ${WORDS}`], "the person's words are theirs");
    for (const [name, id] of Object.entries({ fenced, full, fork, child, team })) {
      const read = reading(id);
      assert.ok(read.includes(WORDS), `${name}: its words are read: ${read}`);
      assert.deepEqual(userLines(read), [], `${name}: no line of it is the user's: ${read}`);
      assert.deepEqual(userLines((a.turnsToRead(id)?.turns ?? []).map((t) => t.text).join("\n")), [], `${name}: nor with no words told apart`);
    }

    // A learning run of the Full control chat and of the person's, each with a second turn that pushes back on the reply
    // before it: the model reads no User: line of theirs, a rule it makes of their words is a fact, and a turn it says
    // pushed back is no correction of the user's (M7-D50).
    const PUSH = "no, that is wrong: use eslint, not the lint script";
    /** The first turn's outcome, as the harness writes one. @param {string} id */
    const outcome = (id) => a.outcomes.add({ chain: id, turn: a.getTurns(id)[0].id, request: null, kind: "turn", agent: null, model: "m", did: "answered", counts: {}, ended: "done", rounds: 1, calls: 0, tokensIn: 0, tokensOut: 0, usd: null, ms: 1 });
    for (const id of [full, mine]) {
      said(id, PUSH);
      outcome(id);
    }
    /** @type {any[]} */
    const calls = [];
    const learner = new MemoryLearner(/** @type {any} */ ({
      archive: a,
      brain,
      callModel: async (/** @type {any} */ args) => (calls.push(args), JSON.stringify({ title: "Linter", items: [{ kind: "rule", text: RULE, importance: 0.9, turn: 1 }], corrected: [2] })),
      getConfig: () => ({ capture: { learn: true, idleMinutes: 30, dailyCap: 200 } }),
    }));
    await learner.learnChain(full, { reason: "idle" });
    await learner.learnChain(mine, { reason: "idle" });
    assert.equal(calls.length, 2);
    assert.ok(calls[0].user.includes(WORDS) && calls[0].user.includes(PUSH), calls[0].user);
    assert.deepEqual(userLines(calls[0].user), [], calls[0].user);
    assert.deepEqual(userLines(calls[1].user), [`User: ${WORDS}`, `User: ${PUSH}`], "the person's run reads their lines as theirs");
    const filed = (/** @type {string} */ id) => a.items.list({ projectId: a.getChain(id).project_id }).filter((/** @type {any} */ i) => i.chain_id === id).map((/** @type {any} */ i) => `${i.kind}: ${i.text}`);
    assert.deepEqual(filed(full), [`fact: ${RULE}`], "no rule of the person's");
    const corrected = (/** @type {string} */ id) => a.db.prepare("SELECT corrected FROM outcomes WHERE chain_id = ?").get(id)?.corrected ?? null;
    assert.equal(corrected(full), null, "their pushing back is no correction by the user");
    assert.equal(corrected(mine), "user", "the person's is");
  }));

// (fails before: yes — #saidByPerson read the opening words of any turn as the person's)
test("a rule, a preference or a decision learned from an agents' chat's words is filed a fact (#saidByPerson): the same words in the person's chat stand", () =>
  chats(async ({ a, brain, mine, fenced, full, fork, child, team }) => {
    const project = a.getChain(mine).project_id;
    const turnOf = (/** @type {string} */ id) => a.getTurns(id).at(-1).id;
    const kinds = [];
    for (const [i, id] of [mine, fenced, full, fork, child, team].entries()) {
      const r = await brain.fileLearned({ projectId: project, chainId: id, turnId: turnOf(id), kind: "rule", text: `${RULE} (${i})`, importance: 0.9 });
      kinds.push(a.items.get(r.id).kind);
    }
    assert.deepEqual(kinds, ["rule", "fact", "fact", "fact", "fact", "fact"]);
  }));

// (fails before: yes — searchInputs gave an agents' chat's opening words as `role: "user"`, the person's input)
test("search gives an agents' chat's words as theirs, never the person's (searchInputs)", () =>
  chats(async ({ a, mine, fenced, full, fork, child, team }) => {
    const theirs = new Set([fenced, full, fork, child, team]);
    for (const o of [{}, { distinct: true, kinds: ["interactive", "fork"], apartToo: false }]) {
      const hits = a.searchInputs("linter", { limit: 20, ...o });
      assert.ok(hits.some((/** @type {any} */ h) => h.chainId === mine && h.role === "user"), JSON.stringify(hits));
      const users = hits.filter((/** @type {any} */ h) => theirs.has(h.chainId) && h.role === "user");
      assert.deepEqual(users, [], JSON.stringify(o));
      assert.ok(hits.some((/** @type {any} */ h) => theirs.has(h.chainId)), "their words are still found");
    }
    assert.ok(a.searchInputs("linter", { limit: 20 }).filter((/** @type {any} */ h) => theirs.has(h.chainId)).every((/** @type {any} */ h) => h.role === "agents"));
  }));

/** A model's handle in a chat, as the tools' context makes it. @param {any} w @param {string} project @param {string} chain @param {number} turn */
const modelIn = (w, project, chain, turn) => w.svc.scope({ role: "model", project, chain, turn });
/** A memory tool's call on a handle, its answer parsed. @param {any} scope @param {string} op @param {any} args */
const call = async (scope, op, args) => JSON.parse(await executeMemoryTool(scope, `filament_memory_${op}`, args));

// (fails before: yes — a quote of an agents' chat's words was heard as the person's: "user's words")
test("a quote of an agents' chat's words is not the person's word: fenced, Full control, a fork and a chat made from one; the person's chat is heard", async () => {
  await world({}, async (w) => {
    const a = w.svc.archive;
    const quote = "the staging database lives on port 5433";
    /** A chat that said it, then went on. @param {string} id @param {any} meta */
    const chatSaid = async (id, meta) => {
      const s = w.session(id);
      const first = await s.send(`${quote} by the way`);
      if (meta) a.mergeMeta(first.prep.chain, meta);
      const sent = await s.send("ok now look at the migration script");
      return { project: sent.sit.project.id, chain: sent.prep.chain, turn: sent.prep.turn };
    };
    const mine = await chatSaid("w-mine", null);
    const fenced = await chatSaid("w-fenced", { agentDevice: "d-fenced" });
    const full = await chatSaid("w-full", { agentDevice: "d-full" });
    const forked = a.forkChain(full.chain, { atTurn: 2, key: "w-fork" }).id;
    const fork = { project: full.project, chain: forked, turn: a.getTurns(forked).at(-1).id };
    // A chat made from the Full control chat whose own meta does not say so: its parent's is what counts.
    const childId = a.chainForKey("w-child", { cwd: "C:\\evals", client: "harness", model: "m", parentId: full.chain }).id;
    const t = a.beginTurn(childId, { requestId: "rc", userMessage: { role: "user", content: `${quote} on every machine` } });
    a.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: "Noted." }, outputChars: 6 });
    const child = { project: a.getChain(childId).project_id, chain: childId, turn: t.turnId };

    const r = await call(modelIn(w, mine.project, mine.chain, mine.turn), "remember", { text: "The staging database listens on port 5433.", quote });
    assert.match(r.quote, /^found in what the user typed/);
    assert.equal(trustOf(a.items.get(Number(String(r.id).slice(1)))), "user's words");
    for (const [name, at] of Object.entries({ fenced, full, fork, child })) {
      const got = await call(modelIn(w, at.project, at.chain, at.turn), "remember", { text: `The staging database (${name}) listens on port 5433.`, quote });
      assert.match(got.quote, /another machine's agents/, `${name}: ${JSON.stringify(got)}`);
      const it = a.items.get(Number(String(got.id).slice(1)));
      assert.deepEqual([it.origin, trustOf(it)], ["model", "assistant noted"], name);
    }
  });
});

/**
 * A scripted curator model: a grounding call answers each note unsure, every other call with nothing to do.
 * @returns {any}
 */
const scripted = () => {
  /** @type {{ system: string, user: string }[]} */
  const calls = [];
  const fn = async (/** @type {any} */ a) => {
    calls.push({ system: a.system, user: a.user });
    if (a.system === GROUND_PROMPT) return JSON.stringify({ notes: [...String(a.user).matchAll(/^(\d+)\. Note /gm)].map((m) => ({ n: Number(m[1]), verdict: "unsure", why: "not settled" })) });
    if (a.system === DOSSIER_PROMPT) return JSON.stringify({ sections: [] });
    return JSON.stringify({ slots: [], pairs: [] });
  };
  return Object.assign(fn, { grounding: () => calls.filter((c) => c.system === GROUND_PROMPT) });
};

// (fails before: yes — the curator's grounding showed an agents' chat's words as "User: …", what the user said)
test("the curator's grounding shows an agents' chat's words as theirs, with no User: line; the person's turn keeps its own", () => {
  const model = scripted();
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const a = w.svc.archive;
    /** A turn of a chat and a learned claim on it. @param {string} id @param {string} ask @param {any} meta @param {string} text */
    const learnedIn = async (id, ask, meta, text) => {
      const t = await w.session(id).send(ask, { reply: "We deploy with pnpm build and then the deploy script." });
      if (meta) a.mergeMeta(t.prep.chain, meta);
      await w.svc.brain.fileLearned({ projectId: t.prep.project, chainId: t.prep.chain, turnId: t.prep.turn, kind: "fact", text, importance: 0.7 });
      await w.settle();
      return t.prep;
    };
    const mine = await learnedIn("g-mine", "how do we deploy this?", null, "deploys run pnpm build and the deploy script");
    await learnedIn("g-full", "how do we ship the widgets build?", { agentDevice: "d-full" }, "widgets ship with pnpm build and the deploy script");
    await learnedIn("g-fenced", "where do the widgets builds go?", { agentDevice: "d-fenced" }, "widgets builds go out with the pnpm deploy script");
    await w.svc.curator.run(mine.project);
    const shown = model.grounding().map((/** @type {any} */ c) => c.user).join("\n");
    assert.ok(shown.includes("User: how do we deploy this?"), shown);
    for (const ask of ["how do we ship the widgets build?", "where do the widgets builds go?"]) {
      assert.ok(shown.includes(ask), `${ask}: its words are shown: ${shown}`);
      assert.ok(!shown.includes(`User: ${ask}`), `${ask}: not as the user's: ${shown}`);
    }
    assert.deepEqual(userLines(shown), ["User: how do we deploy this?"], shown);
  });
});

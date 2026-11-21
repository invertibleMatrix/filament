// @ts-check
// Unused findings lapse (the memory plan's d5): a finding — what a sub-agent or an agent outside Filament found — that
// sessions were shown and none used, and no other session said again, is retired by the curator's pass, with no model
// and no erratum, where one session's look, a showing nobody judged, a use, a second session's word, a procedure or a
// claim of another origin keeps it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryCommand } from "../src/app/commands/mem.js";
import { world } from "./fixtures/memory-world.mjs";

// (fails before: yes — a finding no session used stood for good, faded from conservative briefings at most)
test("a finding two sessions were shown three times and none used lapses at the curator's pass, words and undo with it; one session's look, an unjudged showing, a use, a second session's word, a procedure and a learned claim stay", () =>
  world({}, async (w) => {
    const { sit } = await w.session("open").send("hello");
    const projectId = sit.project.id;
    // The two sessions that are shown the findings.
    const s1 = (await w.session("s1").send("hello")).prep.chain;
    const s2 = (await w.session("s2").send("hello")).prep.chain;
    const finder = { agent: "sa_0000abcd", type: "explore", model: "m" };
    /** @param {string} text @param {{ kind?: string, origin?: string }} [o] */
    const file = async (text, { kind = "fact", origin = "subagent" } = {}) => {
      const r = await w.svc.brain.fileLearned({ projectId, chainId: "found-in", kind, text, importance: 0.6 }, origin === "learner" ? {} : { via: `filament-${origin}`, origin, finder });
      await w.settle();
      return /** @type {number} */ (r.id);
    };
    let req = 0;
    /**
     * Shown in a session, judged used or unused — or, `used` undefined, never judged (a sub-agent's brief).
     * @param {number} id @param {string} chain @param {boolean} [used]
     */
    const show = (id, chain, used) => {
      const requestId = `lapse-r${++req}`;
      w.svc.archive.injections.add({ requestId, chainId: chain, kind: used === undefined ? "brief" : "turn", ids: [`i${id}`] });
      if (used !== undefined) w.svc.archive.injections.markUsed(requestId, used, used ? [`i${id}`] : []);
    };
    const idle = await file("The api's request log rotates every night at midnight.");
    const oneLook = await file("The worker pool holds eight threads by default.");
    const used = await file("The migration scripts live under db/migrations.");
    const said = await file("The cache directory is .cache/build at the root.");
    const brief = await file("The docs site builds with the static generator in docs/.");
    const steps = await file("How to rebuild the search index: 1. run `npm run index:clear` 2. run `npm run index:build`", { kind: "procedure" });
    const learned = await file("The release notes are drafted in CHANGES.md.", { origin: "learner" });
    const outside = await file("The lint step runs eslint with the repo's flat config.", { origin: "agent" });
    // A sub-agent's own rule (its memory tools file one), and a finding the dossier cites, shown in briefings.
    const rule = Number(String((await w.svc.brain.remember("Run the formatter before each commit in this repo.", { kind: "rule", projectId, chainId: "found-in", by: "model", finder })).id).slice(1));
    await w.settle();
    const cited = await file("The api's rate limit is 600 requests a minute.");
    for (const id of [idle, said, steps, learned, outside, rule]) {
      show(id, s1, false);
      show(id, s1, false);
      show(id, s2, false);
    }
    for (let i = 0; i < 3; i++) show(oneLook, s1, false);
    show(used, s1, false);
    show(used, s2, false);
    show(used, s2, true);
    for (let i = 0; i < 5; i++) show(brief, `b${i}`);
    // In a briefing, judged unused in three sessions: a dossier line names it in its own words.
    for (const c of [s1, s2, "s3"]) {
      const requestId = `lapse-r${++req}`;
      w.svc.archive.injections.add({ requestId, chainId: c, kind: "briefing", ids: [`i${cited}`] });
      w.svc.archive.injections.markUsed(requestId, false, []);
    }
    w.svc.archive.items.note(said, "evidence", { by: "learner", detail: { chain: "s3" } });

    const reply = (await memoryCommand(w.svc, "@mem curate", sit))?.text || "";
    assert.match(reply, /^- retired 2 findings sessions were shown and none used$/m, reply);
    const status = (/** @type {number} */ id) => w.svc.archive.items.get(id).status;
    assert.deepEqual([idle, outside].map(status), ["dismissed", "dismissed"], "a sub-agent's and an outside agent's finding alike");
    assert.equal(w.svc.archive.items.get(idle).invalid_reason, "lapsed: 2 sessions were shown it 3 times and none used it, and no other session said it");
    assert.deepEqual([oneLook, used, said, brief, steps, learned, rule, cited].map(status), Array(8).fill("inferred"), "one session's look, a use, a second session's word, unjudged showings, a procedure, a learned claim, an agent's rule, a briefing's showings");
    assert.deepEqual([s1, s2].map((c) => w.svc.brain.takeErrata(c)), [[], []], "no erratum to the sessions shown it: it was never wrong");
    const brief1 = await w.svc.scope({ role: "agent", project: projectId, chain: s1 }).brief({ purpose: "subagent", task: "Where does the api write its request log?", tools: [] });
    assert.ok(!brief1.text.includes(`[i${idle}]`), `nor a line in a brief of a session shown it: ${brief1.text}`);
    // Undone with its pass, it stands again.
    const run = /** @type {string} */ (/pass `(r\d+)`/.exec(reply)?.[1]);
    await w.svc.scope({ role: "person", project: projectId }).undo(run);
    assert.equal(status(idle), "inferred");
  }));

// @ts-check
// HarnessV3-Launch RD-D3 (HarnessV3-Readiness RD-D3): a model's correction of the user's word applies at once and reaches
// the inbox. It used to retire their word without a word to them (M7-D47's as-built note): the sessions shown it heard an
// erratum, the user nothing. Now memory asks: keep the correction, or bring theirs back. No answer leaves the correction
// standing, since the agent read the code and holding the stale word up would serve it wrong meanwhile. A model that
// retires the user's word with nothing in its place (a forget, or a correction with no new words) asks the same way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { world } from "./fixtures/memory-world.mjs";
import { memoryCommand } from "../src/app/commands/mem.js";
import { questionWords, questionAnswers } from "../src/ui/lib/claims.js";

/** The @mem reply to a command typed in a session. @param {any} w @param {any} sit @param {string} text */
const mem = async (w, sit, text) => (await memoryCommand(w.svc, text, sit))?.text || "";
/** A claim's id as a number. @param {string} ref */
const num = (ref) => Number(String(ref).replace(/^i/, ""));
/** The claim the user's remember filed. @param {any} w @param {RegExp} re */
const filed = (w, re) => w.svc.archive.items.list({}).find((/** @type {any} */ it) => re.test(it.text));

// (fails before: yes — the correction retired the user's word and nothing reached the inbox)
test("an agent's correction of the user's word stands at once, and memory asks them: keep it, or bring theirs back", () =>
  world({}, async (w) => {
    const s = w.session("s1");
    const { sit } = await s.remember("the api listens on port 3000");
    await s.remember("the docs deploy from the gh-pages branch");
    await s.remember("the release notes live in CHANGES.md");
    await s.remember("the staging box is called kiwi");
    const pid = sit.project.id;
    const port = filed(w, /port 3000/);
    const docs = filed(w, /gh-pages/);
    const notes = filed(w, /CHANGES\.md/);
    const kiwi = filed(w, /kiwi/);
    // The session's agent, with its reason; an agent over MCP, with none; an agent that names no session; and a retirement.
    const agent = w.svc.scope({ role: "agent", project: pid, chain: "c-agent" });
    const fix = num((await agent.correct(`i${port.id}`, { text: "the api listens on port 8080", reason: "server.js binds 8080" })).id);
    const mcp = num((await w.svc.scope({ role: "agent", project: pid, finder: { agent: "Cursor", type: "MCP" } }).correct(`i${docs.id}`, { text: "the docs deploy from main" })).id);
    const bare = num((await w.svc.scope({ role: "model", project: pid }).correct(`i${notes.id}`, { text: "the release notes live in docs/CHANGELOG.md", reason: "moved in March" })).id);
    await agent.forget(`i${kiwi.id}`, { reason: "there is no staging box" });
    const now = (/** @type {number} */ id) => w.svc.archive.items.get(id);
    assert.deepEqual([now(port.id).status, now(port.id).superseded_by, now(fix).status, now(kiwi.id).status], ["superseded", fix, "inferred", "dismissed"], "each applies at once");
    const qs = w.svc.brain.questions(pid);
    assert.deepEqual(
      qs.map((/** @type {any} */ q) => [q.kind, q.proposal, q.claims.map((/** @type {any} */ c) => c.id).sort()]),
      [
        ["corrected", { action: "bring-back", id: fix, replacement: port.id }, [`i${port.id}`, `i${fix}`].sort()],
        ["corrected", { action: "bring-back", id: mcp, replacement: docs.id }, [`i${docs.id}`, `i${mcp}`].sort()],
        ["corrected", { action: "bring-back", id: bare, replacement: notes.id }, [`i${notes.id}`, `i${bare}`].sort()],
        ["corrected", { action: "bring-back", replacement: kiwi.id }, [`i${kiwi.id}`]],
      ],
      "one question each, naming what would go (the correction) and what would come back (their word), as every question does",
    );
    assert.deepEqual(qs.map((/** @type {any} */ q) => q.reason), [
      `the agent in session c-agent corrected your word: “${port.text}” → “the api listens on port 8080” (server.js binds 8080)`,
      `Cursor (an agent over MCP) corrected your word: “${docs.text}” → “the docs deploy from main”`,
      `an agent corrected your word: “${notes.text}” → “the release notes live in docs/CHANGELOG.md” (moved in March)`,
      `the agent in session c-agent retired your word: “${kiwi.text}” (there is no staging box)`,
    ]);
    // Their word is held for their answer; the correction is served meanwhile, and nothing on it says otherwise.
    const yours = w.svc.brain.card(`i${port.id}`);
    assert.equal(yours.asked, qs[0].id);
    assert.ok(yours.flags.includes(`would replace i${fix} if you say so`), yours.flags.join(" · "));
    const gone = w.svc.brain.card(`i${kiwi.id}`);
    assert.equal(gone.asked, qs[3].id);
    assert.ok(gone.flags.includes("would come back if you say so"), gone.flags.join(" · "));
    const theirs = w.svc.brain.card(`i${fix}`);
    assert.equal(theirs.asked, undefined);
    assert.ok(!theirs.flags.some((/** @type {string} */ f) => /if you say so/.test(f)), theirs.flags.join(" · "));
    // The chat's inbox says it in words, as the views do.
    const listed = await mem(w, sit, "@mem inbox");
    assert.ok(listed.includes(`- \`${qs[0].id}\` bring back your word \`i${port.id}\` "${port.text}" in place of \`i${fix}\` "the api listens on port 8080" — ${qs[0].reason}`), listed);
    assert.ok(listed.includes(`- \`${qs[3].id}\` bring back your word \`i${kiwi.id}\` "${kiwi.text}" — ${qs[3].reason}`), listed);
    assert.equal(questionWords(qs[0]), `Bring back your word “${port.text}” in place of “the api listens on port 8080”`);
    assert.equal(questionWords(qs[3]), `Bring back your word “${kiwi.text}”`);
  }));

// (fails before: no — a guard: only a model that takes the user's word away asks)
test("a change that takes nothing of the user's word asks nothing: their own correction or retirement, or a model's of a model's note", () =>
  world({}, async (w) => {
    const { sit } = await w.session("s1").remember("the api listens on port 3000");
    await w.session("s1").remember("the staging box is called kiwi");
    const pid = sit.project.id;
    const port = filed(w, /port 3000/);
    const mine = await w.svc.scope({ role: "person", project: pid }).correct(`i${port.id}`, { text: "the api listens on port 4000", reason: "I moved it" });
    await w.svc.scope({ role: "owner", project: pid }).correct(mine.id, { text: "the api listens on port 4100", reason: "moved again" });
    await w.svc.scope({ role: "person", project: pid }).forget(`i${filed(w, /kiwi/).id}`, { reason: "gone" });
    const agent = w.svc.scope({ role: "agent", project: pid });
    const note = await agent.remember("the cache lives in .cache/", { kind: "fact" });
    const moved = await agent.correct(note.id, { text: "the cache lives in .tmp/cache/", reason: "renamed" });
    // (fails before: no — L4's mutation pass: a question asked here was withdrawn by the forget below before anything
    // looked)
    assert.deepEqual(w.svc.brain.questions(pid), [], "a model's correction of a model's note");
    await agent.forget(moved.id, { reason: "no cache any more" });
    assert.deepEqual(w.svc.brain.questions(pid), []);
  }));

/** The user's word, an agent's correction of it, and memory's question. @param {any} w */
async function corrected(w) {
  const { sit } = await w.session("s1").remember("the api listens on port 3000");
  const pid = sit.project.id;
  const port = filed(w, /port 3000/);
  const fix = num((await w.svc.scope({ role: "agent", project: pid, chain: "c-agent" }).correct(`i${port.id}`, { text: "the api listens on port 8080", reason: "server.js binds 8080" })).id);
  const [q] = w.svc.brain.questions(pid);
  return { sit, pid, port, fix, q };
}

// (fails before: yes — nothing to answer: the user's word stayed replaced)
test("Bring mine back: the user's word is theirs again, confirmed; the correction is replaced by it, and the sessions shown it hear so", () =>
  world({}, async (w) => {
    const { sit, pid, port, fix, q } = await corrected(w);
    const shown = w.session("s-shown");
    const first = await shown.send("what port does the api listen on?");
    assert.ok(first.prep.ids.includes(`i${fix}`), "a session is shown the correction");
    assert.equal(await mem(w, sit, `@mem accept ${q.id}`), `Done: \`${q.id}\` accepted (\`i${port.id}\`).`);
    const back = w.svc.archive.items.get(port.id);
    const gone = w.svc.archive.items.get(fix);
    assert.deepEqual([back.status, back.superseded_by, gone.status, gone.superseded_by], ["confirmed", null, "superseded", port.id]);
    const brought = w.svc.archive.items.events(port.id).at(-1);
    assert.deepEqual([brought.action, brought.by, brought.detail.from, brought.detail.to], ["status", "person", "superseded", "confirmed"], "brought back as the user's own word");
    assert.match(brought.reason, new RegExp(`^brought back over i${fix} \\(accepted from memory's questions, ${q.id}\\)$`));
    assert.match(w.svc.archive.items.events(fix).at(-1).reason, new RegExp(`^the user brought back i${port.id} \\(accepted from memory's questions, ${q.id}\\)$`));
    assert.deepEqual(w.svc.brain.questions(pid, { status: "accepted" }).map((/** @type {any} */ x) => [x.id, x.by]), [[q.id, "person"]]);
    assert.deepEqual(w.svc.brain.questions(pid), [], "nothing open");
    const next = await shown.send("which port does the api listen on now?");
    assert.ok(next.seen.includes(`Memory correction: [i${fix}] "the api listens on port 8080" no longer holds — now [i${port.id}] "${port.text}" (the user, `), next.seen);
    // A retired word comes back alone: nothing stood in its place.
    await w.session("s1").remember("the staging box is called kiwi");
    const kiwi = filed(w, /kiwi/);
    await w.svc.scope({ role: "agent", project: pid }).forget(`i${kiwi.id}`, { reason: "there is no staging box" });
    const [r] = w.svc.brain.questions(pid);
    assert.equal(await mem(w, sit, `@mem accept ${r.id}`), `Done: \`${r.id}\` accepted (\`i${kiwi.id}\`).`);
    assert.equal(w.svc.archive.items.get(kiwi.id).status, "confirmed");
    assert.match(w.svc.archive.items.events(kiwi.id).at(-1).reason, new RegExp(`^brought back \\(accepted from memory's questions, ${r.id}\\)$`));
    // Taken away again, it is asked about again: each time a model takes the user's word away is a question of its own.
    await w.svc.scope({ role: "agent", project: pid }).forget(`i${kiwi.id}`, { reason: "really, there is none" });
    assert.deepEqual(w.svc.brain.questions(pid).map((/** @type {any} */ x) => x.reason), [`an agent retired your word: “${kiwi.text}” (really, there is none)`]);
  }));

// (fails before: yes — nothing to answer)
test("Keep the correction: the question closes for good, and the correction stands", () =>
  world({}, async (w) => {
    const { sit, pid, port, fix, q } = await corrected(w);
    assert.equal(await mem(w, sit, `@mem reject ${q.id}`), `Closed \`${q.id}\`: memory will not ask it again.`);
    assert.deepEqual([w.svc.archive.items.get(fix).status, w.svc.archive.items.get(port.id).status], ["inferred", "superseded"]);
    assert.deepEqual(w.svc.brain.questions(pid), []);
    assert.equal(w.svc.brain.questions(pid, { status: "rejected" })[0].id, q.id);
  }));

// (fails before: yes — nothing was asked to withdraw)
test("either claim changed since: the question is withdrawn — the correction retired meanwhile, or the user's word back in its place", () =>
  world({}, async (w) => {
    const one = await corrected(w);
    await w.svc.scope({ role: "owner", project: one.pid }).forget(`i${one.fix}`, { reason: "not true either" });
    assert.deepEqual(w.svc.brain.questions(one.pid), [], "withdrawn the moment the correction was retired");
    assert.equal(w.svc.brain.questions(one.pid, { status: "withdrawn" })[0].id, one.q.id);
    // The user says their word again in the chat: it is theirs again, and the question is moot.
    const s = w.session("s2");
    const { sit } = await s.remember("the docs deploy from the gh-pages branch");
    await s.remember("the staging box is called kiwi");
    const docs = filed(w, /gh-pages/);
    const kiwi = filed(w, /kiwi/);
    const agent = w.svc.scope({ role: "agent", project: one.pid, chain: "c-agent" });
    const fix = num((await agent.correct(`i${docs.id}`, { text: "the docs deploy from main", reason: "the workflow says main" })).id);
    await agent.forget(`i${kiwi.id}`, { reason: "there is no staging box" });
    const [q, r] = w.svc.brain.questions(one.pid);
    const person = w.svc.scope({ role: "person", project: one.pid });
    await person.remember(docs.text, { kind: docs.kind });
    await person.remember(kiwi.text, { kind: kiwi.kind });
    assert.deepEqual([w.svc.archive.items.get(docs.id).status, w.svc.archive.items.get(kiwi.id).status], ["confirmed", "confirmed"], "their words are back");
    assert.equal(await mem(w, sit, `@mem accept ${q.id}`), `Could not accept \`${q.id}\`: i${docs.id} is not replaced by i${fix} any more.`);
    assert.equal(await mem(w, sit, `@mem accept ${r.id}`), `Could not accept \`${r.id}\`: i${kiwi.id} is not retired any more.`);
    assert.deepEqual([w.svc.brain.questions(one.pid), w.svc.archive.items.get(fix).status], [[], "inferred"], "withdrawn, and nothing done");
  }));

// (fails before: no — L4's mutation pass: a bring-back read any replacement of their word as the correction's. Through
// memory's own paths their word cannot be replaced by another claim while the question is open — retiring it again
// withdraws the question — so the second half writes the archive itself, as a hand edit would)
test("their word replaced since by another claim: the question is withdrawn, and nothing comes back over the wrong one", () =>
  world({}, async (w) => {
    const one = await corrected(w);
    const person = w.svc.scope({ role: "person", project: one.pid });
    await person.remember(one.port.text, { kind: one.port.kind });
    const mine = num((await person.correct(`i${one.port.id}`, { text: "the api listens on port 4000", reason: "I moved it" })).id);
    assert.equal(w.svc.archive.items.get(one.port.id).superseded_by, mine, "their word is replaced again, by their own");
    assert.equal(w.svc.brain.questions(one.pid, { status: "withdrawn" })[0]?.id, one.q.id, "withdrawn at once");
    const two = await corrected(w);
    const other = num((await person.remember("the api listens on port 5000", { kind: two.port.kind })).id);
    w.svc.archive.items.setStatus(two.port.id, "superseded", { by: "owner", replacement: other, reason: "edited by hand" });
    assert.equal(await mem(w, two.sit, `@mem accept ${two.q.id}`), `Could not accept \`${two.q.id}\`: i${two.port.id} is not replaced by i${two.fix} any more.`);
    assert.deepEqual([w.svc.archive.items.get(two.port.id).superseded_by, w.svc.archive.items.get(two.fix).status], [other, "inferred"], "nothing done");
  }));

// (fails before: yes — the three views wrote Accept and Reject on every question, a correction's too)
test("the views take a question's answers from one place: a correction's are Bring mine back and Keep the correction, a retirement's Keep it retired", () => {
  const q = { id: "q7", kind: "corrected", proposal: { action: "bring-back", id: 12, replacement: 11 }, claims: [{ id: "i11", text: "port 3000" }, { id: "i12", text: "port 8080" }] };
  assert.equal(questionWords(q), "Bring back your word “port 3000” in place of “port 8080”");
  assert.deepEqual(questionAnswers(q), {
    accept: { label: "Bring mine back", aria: "Bring mine back q7: Bring back your word “port 3000” in place of “port 8080”" },
    reject: { label: "Keep the correction", aria: "Keep the correction q7: the correction stands" },
  });
  const gone = { id: "q9", kind: "corrected", proposal: { action: "bring-back", replacement: 11 }, claims: [{ id: "i11", text: "kiwi" }] };
  assert.deepEqual(questionAnswers(gone), {
    accept: { label: "Bring mine back", aria: "Bring mine back q9: Bring back your word “kiwi”" },
    reject: { label: "Keep it retired", aria: "Keep it retired q9: your word stays retired" },
  });
  const r = { id: "q8", kind: "retire", proposal: { action: "retire", id: 3 }, claims: [{ id: "i3", text: "old" }] };
  assert.deepEqual(questionAnswers(r), {
    accept: { label: "Accept", aria: "Accept q8: Retire “old”" },
    reject: { label: "Reject", aria: "Reject q8: memory will not ask it again" },
  });
  for (const [file, from, to] of [
    ["src/ui/harness/library/memory.js", "const questionCard = (q) =>", "How runs ended, as one bar"],
    ["src/ui/pages/memory-claims.js", "function paintQuestions()", "// ---- the panels ----"],
    ["src/ui/harness/widgets/memory.js", "const questionRow = (m, q) =>", "const body = (m, close) =>"],
  ]) {
    const src = readFileSync(file, "utf8");
    const part = src.slice(src.indexOf(from), src.indexOf(to));
    assert.match(part, /questionAnswers\(q\)/, file);
    assert.doesNotMatch(part, /"Accept"|"Reject"|`Accept |`Reject /, `${file}: no answer's words of its own`);
  }
});

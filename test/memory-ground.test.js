// @ts-check
// The curator checks a claim the dossier is about to be written from against the turn it was learned from (the memory
// plan's f2): what the person said, the calls that name it with what they returned, the answer. Holds adds to its
// confidence what a session saying it again adds; wrong retires it; unsure is kept, and none is asked twice. The user's
// word, an open thread and a finding are never checked, and a turn kept apart is never shown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUND_PROMPT, DOSSIER_PROMPT } from "../src/services/memory/curator.js";
import { confidenceOf } from "../src/services/memory/brain.js";
import { memoryCommand } from "../src/app/commands/mem.js";
import { world } from "./fixtures/memory-world.mjs";

/**
 * A scripted curator model: a grounding call answered by `ground`, every other call with nothing to do; every call kept.
 * @param {(u: string) => any} ground
 */
const scripted = (ground) => {
  /** @type {{ system: string, user: string }[]} */
  const calls = [];
  const fn = async (/** @type {any} */ a) => {
    calls.push({ system: a.system, user: a.user });
    if (a.system === GROUND_PROMPT) return JSON.stringify(ground(a.user));
    if (a.system === DOSSIER_PROMPT) return JSON.stringify({ sections: [] });
    return JSON.stringify({ slots: [], pairs: [] });
  };
  return Object.assign(fn, { calls, grounding: () => calls.filter((c) => c.system === GROUND_PROMPT) });
};
/** The notes of a grounding call, by number. @param {string} u */
const notesOf = (u) => [...u.matchAll(/^(\d+)\. Note \((i\d+), [^)]*\): (.*)$/gm)].map((m) => ({ n: Number(m[1]), id: m[2], text: m[3] }));
/** A grounding model that answers each note by its words. @param {Record<string, string>} verdicts */
const byWords = (verdicts) => (/** @type {string} */ u) => ({ notes: notesOf(u).map((x) => ({ n: x.n, verdict: verdicts[x.text] ?? "unsure", why: "the turn says so" })) });

/** A session's turn and a filer of learned claims on it. @param {any} w @param {string} ask @param {string} reply */
async function turnOf(w, ask, reply, session = "deploys") {
  const t = await w.session(session).send(ask, { reply });
  const { project, chain, turn } = t.prep;
  /** @param {string} text */
  const learned = async (text) => {
    const r = await w.svc.brain.fileLearned({ projectId: project, chainId: chain, turnId: turn, kind: "fact", text, importance: 0.7 });
    await w.settle();
    return Number(r.id);
  };
  return { ...t, project, chain, turn, learned };
}

const HOLDS = "deploys run pnpm build and the deploy script";
const WRONG = "the deploy uses npm run deploy";
const UNSURE = "the staging host sits in frankfurt";

// (fails before: yes — no step read the turn a claim came from)
test("a claim is checked against the turn it came from: borne out it gains what a session saying it again gives, wrong it is retired, unsure it is kept - none asked twice; undo puts them back", () => {
  const model = scripted(byWords({ [HOLDS]: "holds", [WRONG]: "wrong", [UNSURE]: "unsure" }));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const t = await turnOf(w, "how do we deploy this?", "We deploy with pnpm build and then the deploy script; npm is not used in this repo.");
    const [holds, wrong, unsure] = [await t.learned(HOLDS), await t.learned(WRONG), await t.learned(UNSURE)];
    const before = confidenceOf(w.svc.archive.items.get(holds), w.svc.archive.items.eventCounts([holds]).get(holds) || {});
    const reply = (await memoryCommand(w.svc, "@mem curate", t.sit))?.text || "";
    assert.match(reply, /^- checked 3 memories against the turns they came from: 1 borne out, 1 retired, 1 unsettled$/m, reply);
    const [call] = model.grounding();
    assert.match(call.user, /^## Session \S+, turn 1\nUser: how do we deploy this\?\nAssistant: We deploy with pnpm build[^\n]*\nNotes from it:\n1\. Note /m, call.user);
    assert.equal(call.user.split("## Session").length - 1, 1, "the turn is shown once for its three notes");
    const item = (/** @type {number} */ id) => w.svc.archive.items.get(id);
    assert.deepEqual([item(holds).status, item(wrong).status, item(unsure).status], ["inferred", "dismissed", "inferred"]);
    assert.equal(item(wrong).invalid_reason, `checked against session ${t.chain}, turn 1: the turn says so`);
    assert.equal(w.svc.archive.items.eventCounts([holds]).get(holds)?.grounded, 1);
    assert.equal(w.svc.archive.items.eventCounts([unsure]).get(unsure)?.grounded, undefined, "unsure counts nothing");
    const after = confidenceOf(item(holds), w.svc.archive.items.eventCounts([holds]).get(holds) || {});
    assert.equal(Math.round((after - before) * 100), 5, "borne out: as much as a session saying it again");
    await w.svc.curator.run(t.project);
    assert.equal(model.grounding().length, 1, "none is asked twice");
    // Undo takes the pass back: the retired claim stands again, and what was checked is checked again.
    const run = w.svc.archive.curator.list({ projectId: t.project, limit: 5 }).at(-1);
    await w.svc.brain.undoRun(Number(run.id), { by: "owner" });
    assert.equal(item(wrong).status, "inferred");
    assert.equal(w.svc.archive.items.eventCounts([holds]).get(holds)?.grounded, undefined);
    await w.svc.curator.run(t.project);
    assert.deepEqual(notesOf(model.grounding().at(-1)?.user ?? "").map((x) => x.id).sort(), [`i${holds}`, `i${unsure}`, `i${wrong}`].sort());
  });
});

// (fails before: yes — no step read the turn a claim came from)
test("the user's word is never checked against a turn, and a turn kept apart is never shown", () => {
  const model = scripted(byWords({}));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const t = await turnOf(w, "how do we deploy this?", "We deploy with pnpm build.");
    const learned = await t.learned(HOLDS);
    const theirs = (await w.svc.brain.remember("we always deploy from the main branch on fridays", { kind: "decision", projectId: t.project, chainId: t.chain, turnId: t.turn, by: "person" })).itemId;
    const apart = await w.session("deploys").send("the cormorant ledger codename stays between us", { reply: "Understood, the cormorant ledger stays private." });
    w.svc.archive.db.prepare("UPDATE turns SET meta_json = ? WHERE id = ?").run(JSON.stringify({ apart: true }), apart.prep.turn);
    const hidden = Number((await w.svc.brain.fileLearned({ projectId: t.project, chainId: t.chain, turnId: apart.prep.turn, kind: "fact", text: "the release codename is kept in the private ledger", importance: 0.7 })).id);
    await w.settle();
    const r = await w.svc.curator.run(t.project);
    const shown = model.grounding().map((c) => c.user).join("\n");
    assert.deepEqual(notesOf(shown).map((x) => x.id), [`i${learned}`], JSON.stringify(r));
    assert.ok(!shown.includes("cormorant"), "the kept-apart turn's words are never shown");
    assert.ok(!notesOf(shown).some((x) => x.id === `i${theirs}` || x.id === `i${hidden}`));
  });
});

// (fails before: yes — the turn was cut to its two ends, which left out every call and the middle of the answer, and a
// call's result was never shown; memory's own call showed the agent's note as proof of itself)
test("a turn is shown in parts around the notes' words: the calls that name them with what they returned, never memory's own calls", () => {
  const model = scripted(byWords({}));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const first = await w.session("ports").send("hello", { reply: "Hi." });
    const { project, chain } = first.prep;
    const long = `${"Some preamble about the repository layout and its history. ".repeat(30)}The api server listens on port 8080 in development. ${"More words about unrelated deploy matters. ".repeat(30)}`;
    const { turnId } = w.svc.archive.beginTurn(chain, { userMessage: { role: "user", content: "which port does the api listen on?" } });
    w.svc.archive.addWork(turnId, [
      { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "Bash", input: { command: "ls" } }, { type: "tool_use", id: "c2", name: "Read", input: { file_path: "src/server.js" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "README.md src test" }, { type: "tool_result", tool_use_id: "c2", content: `// the server\n${"// filler line\n".repeat(40)}app.listen(8080) // the api server in development\n` }] },
      { role: "assistant", content: [{ type: "tool_use", id: "c3", name: "mcp__filament__filament_memory_remember", input: { text: "The api server listens on port 8080 in development." } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c3", content: "kept as i99" }] },
    ]);
    w.svc.archive.finishTurn(turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: long }] } });
    const id = Number((await w.svc.brain.fileLearned({ projectId: project, chainId: chain, turnId, kind: "fact", text: "The api server listens on port 8080 in development.", importance: 0.7 })).id);
    await w.settle();
    await w.svc.curator.run(project);
    const user = model.grounding()[0]?.user ?? "";
    assert.deepEqual(notesOf(user).map((x) => x.id), [`i${id}`]);
    assert.match(user, /Calls that name these notes \(1 of 2\):\n- Read \{"file_path":"src\/server\.js"\}\n {2}returned: [\s\S]*app\.listen\(8080\)/, user);
    assert.ok(!user.includes("filament_memory_remember") && !user.includes("kept as i99"), "memory's own call is no proof");
    assert.ok(!user.includes("README.md"), "a call that names none of the notes is not shown");
    assert.match(user, /Assistant: …\n[^\n]*The api server listens on port 8080 in development\./, "the answer around the note's words");
    assert.ok(user.length < long.length, "cut where long");
  });
});

// (fails before: yes — memory's reminder on a result and /mcp/memory's search were shown as proof, an edit that wrote the
// note's words outranked the reads that returned it, the secrets were cut before they were blanked and redactSecrets
// knows none of these, and a failed call read as returned)
test("a call's result is shown as it was returned: memory's reminders and its tools left out, what it returned before what it was given, secrets blanked, a failure so named", () => {
  const model = scripted(byWords({}));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const first = await w.session("ports").send("hello", { reply: "Hi." });
    const { project, chain } = first.prep;
    const note = "The api server listens on port 8080 in development.";
    const env = `${"# a comment line of the env file\n".repeat(12)}NODE_ENV=development\nPORT=8080\nDATABASE_URL=postgres://admin:hunter2pass@db.internal:5432/app\nSTRIPE_KEY=sk_live_abcdefghijklmnop\n${"# more comments\n".repeat(12)}`;
    const { turnId } = w.svc.archive.beginTurn(chain, { userMessage: { role: "user", content: "which port does the api listen on?" } });
    w.svc.archive.addWork(turnId, [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "c1", name: "Write", input: { file_path: "docs/notes.md", content: note } },
          { type: "tool_use", id: "c2", name: "Read", input: { file_path: "src/server.js" } },
          { type: "tool_use", id: "c3", name: "Bash", input: { command: "cat .env" } },
          { type: "tool_use", id: "c4", name: "Bash", input: { command: "curl localhost:8080/health" } },
          { type: "tool_use", id: "c5", name: "Read", input: { file_path: "docs/x.md" } },
          { type: "tool_use", id: "c6", name: "mcp__filament-memory__search", input: { query: "api server port" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "c1", content: "File written." },
          { type: "tool_result", tool_use_id: "c2", content: "app.listen(8080) // the api server in development" },
          { type: "tool_result", tool_use_id: "c3", content: env },
          { type: "tool_result", tool_use_id: "c4", content: "curl: (7) Failed to connect to localhost port 8080: Connection refused", is_error: true },
          { type: "tool_result", tool_use_id: "c5", content: `Nothing on that here.\n\n[memory i12 · inferred] ${note}` },
          { type: "tool_result", tool_use_id: "c6", content: `i12 ${note}` },
        ],
      },
    ]);
    w.svc.archive.finishTurn(turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: note }] } });
    const id = Number((await w.svc.brain.fileLearned({ projectId: project, chainId: chain, turnId, kind: "fact", text: note, importance: 0.7 })).id);
    await w.settle();
    await w.svc.curator.run(project);
    const user = model.grounding()[0]?.user ?? "";
    assert.deepEqual(notesOf(user).map((x) => x.id), [`i${id}`]);
    assert.match(user, /Calls that name these notes \(3 of 5\):\n- Read \{"file_path":"src\/server\.js"\}\n/, user);
    assert.ok(!user.includes("[memory i12") && !user.includes("filament-memory__search"), "what memory said is no proof");
    assert.ok(!user.includes("docs/notes.md"), "an edit that wrote the note's words is not what bears it out");
    assert.match(user, /- Bash \{"command":"cat \.env"\}\n {2}returned: [\s\S]*PORT=8080/);
    assert.ok(!/hunter2pass|abcdefghijklmnop/.test(user), "secrets blanked");
    assert.match(user, /- Bash \{"command":"curl localhost:8080\/health"\}\n {2}failed: curl: \(7\)/);
  });
});

// (fails before: yes — a verdict the model did not give was taken for unsure and closed the claim for good; a thread
// and a finding were checked against a turn that was not where they came from)
test("a note the model left unanswered is asked next pass; an open thread and a finding are not checked", () => {
  let answer = /** @type {(u: string) => any} */ (() => ({ notes: [] }));
  const model = scripted((u) => answer(u));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const t = await turnOf(w, "how do we deploy this?", "We deploy with pnpm build.");
    const learned = await t.learned(HOLDS);
    const thread = Number((await w.svc.brain.fileLearned({ projectId: t.project, chainId: t.chain, turnId: t.turn, kind: "thread", text: "the deploy script still needs a dry-run flag", importance: 0.7 })).id);
    const finding = Number((await w.svc.brain.fileLearned({ projectId: t.project, chainId: t.chain, turnId: t.turn, kind: "fact", text: "the deploy script reads DEPLOY_ENV from the shell", importance: 0.7 }, { via: "filament-subagent", origin: "subagent", finder: { agent: "sa_1", type: "explorer", model: "m" } })).id);
    await w.settle();
    assert.equal(w.svc.archive.items.get(finding).origin, "subagent");
    await w.svc.curator.run(t.project);
    assert.deepEqual(notesOf(model.grounding()[0]?.user ?? "").map((x) => x.id), [`i${learned}`], "the thread and the finding are not asked");
    assert.equal(w.svc.archive.items.events(learned).some((/** @type {any} */ e) => e.action === "grounded"), false, "unanswered: nothing written");
    answer = byWords({ [HOLDS]: "Holds" });
    await w.svc.curator.run(t.project);
    assert.equal(model.grounding().length, 2, "asked again");
    assert.equal(w.svc.archive.items.eventCounts([learned]).get(learned)?.grounded, 1, "a verdict in any case");
    assert.equal(w.svc.archive.items.events(thread).some((/** @type {any} */ e) => e.action === "grounded"), false);
  });
});

// (fails before: yes — no step read the turn a claim came from)
test("two calls a pass, six claims to a call, the most shown first; the rest wait", () => {
  const model = scripted(byWords({}));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const t = await turnOf(w, "walk me through the services", "Here is how the services fit together.");
    const says = [
      "the billing worker retries charges three times",
      "invoices render through a headless chromium",
      "the search index rebuilds every night at two",
      "user avatars are stored in an s3 bucket",
      "feature flags come from a yaml file in config",
      "the mobile app talks graphql to the gateway",
      "emails go out through postmark templates",
      "the admin panel is a separate vite app",
      "rate limits live in redis with a sliding window",
      "audit logs are kept for ninety days",
      "the websocket hub runs on a single node",
      "pdf exports are queued on a bull queue",
      "translations are pulled from crowdin weekly",
    ];
    const ids = [];
    for (const s of says) ids.push(await t.learned(s));
    assert.equal(new Set(ids).size, 13, "thirteen claims");
    const most = ids.at(-1);
    for (let k = 0; k < 3; k++) w.svc.archive.injections.add({ requestId: `show-${k}`, chainId: `c-show-${k}`, kind: "turn", ids: [`i${most}`] });
    const r = await w.svc.curator.run(t.project);
    const calls = model.grounding();
    assert.deepEqual([calls.length, r.groundUnsure, r.groundLeft], [2, 12, 1]);
    assert.deepEqual(calls.map((c) => notesOf(c.user).length), [6, 6]);
    assert.equal(notesOf(calls[0].user)[0].id, `i${most}`, "the most shown first");
    assert.deepEqual(notesOf(calls[1].user).at(-1)?.id, `i${ids[10]}`, "then by age: the newest unshown waits");
  });
});

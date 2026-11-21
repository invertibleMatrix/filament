// @ts-check
// HarnessV3-ACP AC2-4 through the app and the fake agent (fixtures/fake-acp-agent.mjs): what an agent asks the person —
// a form, a link to open, Cursor's questions and the plan it proposes, Claude's plan with its own ways on — waits in
// the harness turn's run until the page answers it (POST /api/runs/:id/answer), and goes back in the agent's own terms
// (the session's switch answers its other permissions: acp-permits.test.js). A
// question the agent withdraws, or a stop, settles it as cancelled. Without the page, an outside client's question
// tool carries it; with nobody to ask, the agent hears at once that it was skipped, and the record says why.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp, parseSse } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-acp-agent.mjs");

describe("an agent's questions to the person (HarnessV3-ACP AC2-4)", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-acp-asks-"));
  const projDir = join(root, "project");
  // Opened once the question is out: the agent withdraws it then (the fake's FAKE_ACP_WITHDRAW_GATE).
  const withdrawGate = join(root, "withdraw-gate");
  before(async () => {
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    /** @param {string} permissions */
    const acp = (permissions) => ({ command: process.execPath, args: [FAKE], env: { FAKE_ACP_WITHDRAW_GATE: withdrawGate }, cwdDefault: projDir, permissions, hints: false });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "plain", name: "plain", type: "acp", acp: acp("allow-all") },
          { id: "refuser", name: "refuser", type: "acp", acp: acp("reject") },
        ];
        cfg.routes = [
          { match: "plain/*", upstream: "plain", upstreamModel: "{1}", enabled: true },
          { match: "refuser/*", upstream: "refuser", upstreamModel: "{1}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });

  /** A harness session on a model. @param {string} model */
  const session = async (model) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** A harness turn, as the page sends one, and its run's id. @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
    assert.equal(res.status, 200);
    return { res, runId: String(res.headers.get("x-filament-request-id")) };
  };
  /** @param {string} runId @returns {Promise<any[]>} */
  const runEvents = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events;
  /** The page's answer to a question. @param {string} runId @param {Record<string, unknown>} body */
  const answer = (runId, body) => shim.api(`/api/runs/${encodeURIComponent(runId)}/answer`, { method: "POST", body });
  /** The run's question, once it waits. @param {string} runId @param {string} [id] */
  const asked = (runId, id = "q1") => until(async () => (await runEvents(runId)).find((e) => e.type === "ask" && e.id === id) || null, `question ${id}`);
  /** The reply's words, its run's events apart. @param {Response} res */
  const words = async (res) => {
    let said = "";
    for (const { event, data } of parseSse(await res.text()))
      if (event !== "filament_run" && data?.type === "content_block_delta") said += data.delta?.text ?? "";
    return said;
  };
  /** The run's settled questions: each one's id, call, outcome and words. @param {string} runId */
  const ended = async (runId) =>
    (await runEvents(runId))
      .filter((e) => e.type === "ask-end")
      .map((e) => ({ id: e.id, ...(e.call ? { call: e.call } : {}), outcome: e.outcome, words: e.words, ...(e.nobody ? { nobody: true } : {}) }));

  test("an agent's form goes to the page on the call it belongs to, and the page's answer reaches it in its own terms", async () => {
    const { res, runId } = await turn(await session("plain/fake-a"), "~elicit");
    const ask = await asked(runId);
    assert.deepEqual([ask.kind, ask.call, ask.waits, ask.question], ["question", "q_ask", true, "Which database?"]);
    const [q] = ask.form.questions;
    assert.deepEqual([q.id, q.choices.map((/** @type {any} */ c) => c.label), q.other, q.words], ["question_0", ["Postgres", "SQLite"], "question_0_custom", "text"]);
    assert.equal((await runEvents(runId)).find((e) => e.type === "tool-start" && e.id === "q_ask")?.card?.kind, "ask", "on the agent's own call");
    const wrong = await answer(runId, { ask: "q1", outcome: "answered", answers: { question_0: { chosen: ["MySQL"] } } });
    assert.deepEqual([wrong.status, (await wrong.json()).error], [400, "“MySQL” isn't one of the choices for “Which database?”"]);
    assert.equal((await answer(runId, { ask: "q1", outcome: "answered", answers: { question_0: { chosen: [], words: "DuckDB" } } })).status, 200);
    assert.match(await words(res), /elicit: \{"action":"accept","content":\{"question_0_custom":"DuckDB"\}\}/, "the person's own words, in the field that takes them");
    assert.deepEqual(await ended(runId), [{ id: "q1", call: "q_ask", outcome: "answered", words: ["Database: DuckDB"] }]);
    assert.equal((await answer(runId, { ask: "q1", outcome: "skipped" })).status, 409, "a question settled takes no answer");
  });

  test("a link: the agent seeing it completed ends the wait, opened; the person may decline one", async () => {
    const id = await session("plain/fake-a");
    const done = await turn(id, "~link-done");
    const ask = await asked(done.runId);
    assert.deepEqual([ask.kind, ask.form.link.url, ask.question], ["link", "https://example.com/login", "Sign in to the docs server"]);
    assert.match(await words(done.res), /link: accept/);
    assert.deepEqual(await ended(done.runId), [{ id: "q1", outcome: "accepted", words: ["Opened"] }]);
    const card = (await runEvents(done.runId)).filter((e) => e.id === "ask:q1").map((e) => [e.type, e.card?.title, e.ok ?? null, e.preview ?? null]);
    assert.deepEqual(card, [["tool-start", "Open a link", null, null], ["tool-end", "Open a link", true, "Opened"]], "a card of its own");
    const no = await turn(id, "~link");
    await asked(no.runId);
    assert.equal((await answer(no.runId, { ask: "q1", outcome: "declined" })).status, 200);
    assert.match(await words(no.res), /link: decline/);
  });

  test("Cursor's questions and the plan it proposes go to the page, answered in Cursor's terms", async () => {
    const id = await session("plain/fake-a");
    const q = await turn(id, "~cursorask");
    const ask = await asked(q.runId);
    assert.deepEqual([ask.kind, ask.call, ask.question], ["question", "c_ask", "Setup"]);
    assert.deepEqual(ask.form.questions.map((/** @type {any} */ x) => [x.id, x.several]), [["db", false], ["extras", true]]);
    const chose = await answer(q.runId, { ask: "q1", outcome: "answered", answers: { db: { chosen: ["lite"] }, extras: { chosen: ["auth", "jobs"] } } });
    assert.equal(chose.status, 200);
    assert.match(await words(q.res), /cursor-ask: \{"outcome":"answered","answers":\[\{"questionId":"db","selectedOptionIds":\["lite"\]\},\{"questionId":"extras","selectedOptionIds":\["auth","jobs"\]\}\]\}/);
    const p = await turn(id, "~cursorplan");
    const plan = await asked(p.runId);
    assert.deepEqual(
      [plan.kind, plan.call, plan.form.plan.name, plan.form.plan.todos.map((/** @type {any} */ t) => t.text)],
      ["proposal", "c_plan", "Add auth", ["Sessions", "A login page"]],
    );
    assert.equal((await answer(p.runId, { ask: "q1", outcome: "rejected", reason: "Use OAuth" })).status, 200);
    assert.match(await words(p.res), /plan: \{"outcome":"rejected","reason":"Use OAuth"\}/);
    assert.deepEqual((await ended(p.runId)).map((e) => e.words), [["Rejected: Use OAuth"]]);
  });

  test("the plan Claude proposes goes to the page whole, with its ways on in the card's words; the one chosen reaches it", async () => {
    const { res, runId } = await turn(await session("plain/fake-a"), "~permexit");
    const ask = await asked(runId);
    assert.deepEqual([ask.kind, ask.call, ask.question, ask.form.plan.text], ["proposal", "ce1", "Ready to code?", "# Plan\n1. Clean the build"]);
    assert.deepEqual(ask.form.questions[0].choices.map((/** @type {any} */ c) => [c.id, c.label]), [
      ["exit-plan-default", "Yes, build it"],
      ["exit-plan-clear-bypass", "Yes, in a fresh context"],
      ["reject", "No, keep planning"],
    ]);
    const wrong = await answer(runId, { ask: "q1", outcome: "answered", answers: { permission: { chosen: ["exit-plan-bypass"] } } });
    assert.deepEqual([wrong.status, (await wrong.json()).error], [400, "“exit-plan-bypass” isn't one of the choices for “Ready to code?”"], "its yes that decides by itself isn't offered");
    assert.equal((await answer(runId, { ask: "q1", outcome: "answered", answers: { permission: { chosen: ["exit-plan-default"] } } })).status, 200);
    assert.match(await words(res), /permexit: exit-plan-default/);
    assert.deepEqual(await ended(runId), [{ id: "q1", call: "ce1", outcome: "answered", words: ["Yes, build it"] }]);
  });

  test("a question the agent withdraws, and one a stop ends, settle as cancelled", async () => {
    const id = await session("plain/fake-a");
    const w = await turn(id, "~withdraw");
    await asked(w.runId);
    writeFileSync(withdrawGate, "");
    assert.match(await words(w.res), /withdrawn: cancel/);
    assert.deepEqual((await ended(w.runId)).map((e) => e.outcome), ["cancelled"]);
    assert.equal((await answer(w.runId, { ask: "q1", outcome: "answered", answers: { pick: { chosen: ["a"] } } })).status, 409);
    const s = await turn(id, "~elicit");
    await asked(s.runId);
    assert.equal((await shim.api(`/api/runs/${encodeURIComponent(s.runId)}/steer`, { method: "POST", body: { kind: "stop" } })).status, 200);
    assert.match(await words(s.res), /elicit: \{"action":"cancel"\}/);
    assert.deepEqual((await ended(s.runId)).map((e) => [e.outcome, e.words]), [["cancelled", ["Cancelled"]]]);
  });

  test("without the page, an outside client's question tool carries all of the agent's questions in one call", async () => {
    const tools = [{ name: "AskUserQuestion", description: "Ask the user", input_schema: { type: "object", properties: { questions: { type: "array" } } } }];
    const H = { "x-session-id": "client-asks" };
    const first = await (await shim.post("/v1/messages", { model: "plain/fake-a", max_tokens: 100, tools, messages: [{ role: "user", content: "~cursorask" }] }, H)).json();
    const use = first.content.find((/** @type {any} */ b) => b.type === "tool_use");
    assert.equal(use?.name, "AskUserQuestion");
    assert.deepEqual(
      use.input.questions.map((/** @type {any} */ x) => [x.question, x.options.map((/** @type {any} */ o) => o.label), x.multiSelect]),
      [["Which database?", ["Postgres", "SQLite"], false], ["Which extras?", ["Auth", "Jobs"], true]],
    );
    const said = 'User has answered your questions: "Which database?"="SQLite", "Which extras?"="Auth, Jobs".';
    const messages = [{ role: "user", content: "~cursorask" }, { role: "assistant", content: [use] }, { role: "user", content: [{ type: "tool_result", tool_use_id: use.id, content: said }] }];
    const second = await (await shim.post("/v1/messages", { model: "plain/fake-a", max_tokens: 100, tools, messages }, H)).json();
    const text = second.content.map((/** @type {any} */ b) => b.text || "").join("");
    assert.match(text, /cursor-ask: \{"outcome":"answered","answers":\[\{"questionId":"db","selectedOptionIds":\["lite"\]\},\{"questionId":"extras","selectedOptionIds":\["auth","jobs"\]\}\]\}/);
  });

  // (fails before: no — a guard the mutation pass asked for: no policy refused a call whose permission offered no
  // refusal; no question or form was one the card can't draw)
  test("a call an outside client's policy refused ends refused; what can't be drawn is said", async () => {
    const refused = await shim.post("/v1/messages", { model: "refuser/fake-a", max_tokens: 100, messages: [{ role: "user", content: "~permnoreject" }] }, { "x-session-id": "policy-noreject" });
    const refusedRun = String(refused.headers.get("x-filament-request-id"));
    assert.match((await refused.json()).content.map((/** @type {any} */ b) => b.text || "").join(""), /permnoreject: cancelled/);
    assert.ok((await runEvents(refusedRun)).some((e) => e.type === "tool-end" && e.refused === true), "the call ends refused, never left running");
    const odd = await turn(await session("plain/fake-a"), "~oddask");
    assert.match(await words(odd.res), /oddask: \{"outcome":"skipped".*\} decline/);
    const rec = await until(async () => {
      const x = await shim.record(odd.runId);
      return x?.acp?.run ? x : null;
    }, "the record");
    const notes = (rec.priorChanges || []).filter((/** @type {string} */ n) => n.startsWith("acp: the agent asked"));
    assert.equal(notes.length, 2, notes.join("\n"));
    assert.match(notes[0], /^acp: the agent asked “Odd”, but Filament can't show it: .+; it heard “Skipped”$/);
    assert.match(notes[1], /^acp: the agent asked “Odd form”, but Filament can't show it: .+; it heard “Declined”$/);
  });

  // (fails before: no — a guard the mutation pass asked for: no permission named a call announced before in a status
  // of its own, or came for a call that had ended)
  test("a permission keeps its call's status; a call that ended before its permission was refused stays as it ended", async () => {
    /** An outside client's turn: its words and its record. @param {string} model @param {string} content @param {string} sid */
    const outside = async (model, content, sid) => {
      const r = await shim.post("/v1/messages", { model, max_tokens: 100, messages: [{ role: "user", content }] }, { "x-session-id": sid });
      const text = (await r.json()).content.map((/** @type {any} */ b) => b.text || "").join("");
      const rec = await until(async () => {
        const x = await shim.record(String(r.headers.get("x-filament-request-id")));
        return x?.acp?.run ? x : null;
      }, "the record");
      return { text, rec };
    };
    const known = await outside("plain/fake-a", "~permknown", "perm-known");
    assert.match(known.text, /permknown: allow/);
    assert.ok(known.rec.acp.tools.some((/** @type {string} */ l) => /\bRead\b/.test(l)), JSON.stringify(known.rec.acp.tools));
    const done = await outside("refuser/fake-a", "~permended", "perm-ended");
    assert.match(done.text, /permended: no/);
    assert.doesNotMatch(done.text, /Not run/);
    assert.equal(done.rec.acp.toolStats.failures, 0);
  });

  // (fails before: no — a guard the mutation pass asked for: no question put to an outside client was withdrawn)
  test("a question withdrawn from an outside client's question tool: the agent hears it cancelled; the late answer settles nothing", async () => {
    const tools = [{ name: "AskUserQuestion", description: "Ask the user", input_schema: { type: "object", properties: { questions: { type: "array" } } } }];
    const H = { "x-session-id": "client-withdraw" };
    const r1 = await shim.post("/v1/messages", { model: "plain/fake-a", max_tokens: 100, tools, messages: [{ role: "user", content: "~withdraw" }] }, H);
    const runId = String(r1.headers.get("x-filament-request-id"));
    const use = (await r1.json()).content.find((/** @type {any} */ b) => b.type === "tool_use");
    assert.equal(use?.name, "AskUserQuestion");
    writeFileSync(withdrawGate, "");
    // The question's end waits in the turn for the client's next request: the turn says it waits on nothing, and is
    // done.
    const sid = await until(async () => (await shim.record(runId))?.acp?.sessionId || null, "the agent's session");
    await until(async () => {
      const s = await (await shim.api("/api/acp/status")).json();
      const t = s.turns.find((/** @type {any} */ x) => x.sessionId === sid);
      return t && t.done && !t.waiting.length ? true : null;
    }, "the question withdrawn");
    const late = 'User has answered your questions: "Pick one"="a".';
    const messages = [{ role: "user", content: "~withdraw" }, { role: "assistant", content: [use] }, { role: "user", content: [{ type: "tool_result", tool_use_id: use.id, content: late }] }];
    const second = await (await shim.post("/v1/messages", { model: "plain/fake-a", max_tokens: 100, tools, messages }, H)).json();
    assert.match(second.content.map((/** @type {any} */ b) => b.text || "").join(""), /withdrawn: cancel/);
  });

  // (fails before: yes — Cursor's question went unanswered (-32601), so cursor-agent asked it as a permission, and
  // allow-all answered that with the question's first choice: the agent heard Postgres chosen, by nobody)
  test("with nobody to ask, Cursor's questions are skipped and the record says why, never answered by a first choice", async () => {
    const r = await shim.post("/v1/messages", { model: "plain/fake-a", max_tokens: 100, messages: [{ role: "user", content: "~cursorask" }] }, { "x-session-id": "nobody-asks" });
    const out = await r.json();
    const text = out.content.map((/** @type {any} */ b) => b.text || "").join("");
    assert.match(text, /cursor-ask: \{"outcome":"skipped","reason":"nobody could be asked here"\}/);
    const rec = await until(async () => {
      const x = await shim.record(String(r.headers.get("x-filament-request-id")));
      return x?.acp?.run ? x : null;
    }, "the record");
    const notes = [...(rec.priorChanges || []), ...(rec.changes || [])];
    assert.ok(notes.includes("acp: the agent asked “Setup”, but this chat tool declares no question tool; it heard “Skipped”"), notes.join("\n"));
    // (fails before: no — a guard the mutation pass asked for: no run's question was settled by nobody)
    assert.deepEqual((await ended(String(r.headers.get("x-filament-request-id")))).map((e) => [e.outcome, e.nobody ?? false]), [["skipped", true]]);
  });
});

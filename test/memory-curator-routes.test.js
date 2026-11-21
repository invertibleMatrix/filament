// @ts-check
// The curator's admin surface (HarnessV3-Memory M4-1, M4-6, M4-7): memory's questions and their answers, a pass asked
// for, the passes listed and undone, the dossier and the topic pages read — each route through the real service on the
// fake engine, the owner's word through the port. And an owner's delete takes a claim's questions, events, dossier and
// pages with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KEY_PROMPT, DOSSIER_PROMPT } from "../src/services/memory/curator.js";
import { pageSource } from "../src/services/memory/brain.js";
import { world, adminCall } from "./fixtures/memory-world.mjs";

/** Keys every "port" note to the api's port; writes each fact into the dossier word for word. @param {any} a */
const judge = async (a) => {
  if (a.system === KEY_PROMPT)
    return JSON.stringify({ slots: [...a.user.matchAll(/^(\d+)\. (.*port (\d{4}).*)$/gm)].map((m) => ({ n: Number(m[1]), subject: "api", attribute: "port", value: m[3] })) });
  if (a.system === DOSSIER_PROMPT)
    return JSON.stringify({ sections: [{ title: "Facts", lines: [...a.user.matchAll(/^(i\d+) \[fact[^\]]*\] (.*)$/gm)].map((m) => ({ text: m[2], cites: [m[1]] })) }] });
  return JSON.stringify({ pairs: [] });
};

test("the inbox's routes: listed by project and status, answered accept or reject, a bad answer is a 400 and a stale one a 409", () =>
  world({ models: { summarizer: "judge" }, callModel: judge }, async (w) => {
    const { sit } = await w.session("a").remember("the api listens on port 3000");
    await w.session("b").remember("the api listens on port 8080 now");
    const project = sit.project.id;
    assert.deepEqual((await adminCall(w.svc, "GET", `/memory/inbox?project=${project}`)).body, { questions: [] });
    const ran = await adminCall(w.svc, "POST", "/memory/curator/run", { project });
    assert.equal(ran.status, 200);
    assert.equal(ran.body.questions, 1, JSON.stringify(ran.body));
    const listed = await adminCall(w.svc, "GET", `/memory/inbox?project=${project}`);
    assert.equal(listed.body.questions.length, 1);
    const q = listed.body.questions[0];
    assert.deepEqual([q.kind, q.status, q.run], ["retire", "open", ran.body.run]);
    assert.deepEqual((await adminCall(w.svc, "POST", `/memory/inbox/${q.id}`, { answer: "maybe" })).status, 400);
    const yes = await adminCall(w.svc, "POST", `/memory/inbox/${q.id}`, { answer: "accept" });
    assert.deepEqual([yes.status, yes.body.ok, yes.body.status], [200, true, "accepted"], JSON.stringify(yes.body));
    const again = await adminCall(w.svc, "POST", `/memory/inbox/${q.id}`, { answer: "reject" });
    assert.equal(again.status, 409, JSON.stringify(again.body));
    assert.equal((await adminCall(w.svc, "GET", `/memory/inbox?project=${project}&status=accepted`)).body.questions[0].by, "owner");
  }));

test("the curator's routes: a pass asked for, the passes listed with the model and the queue, a pass undone; an unknown pass is a 404", () =>
  world({ models: { summarizer: "judge" }, callModel: judge }, async (w) => {
    const { sit } = await w.session("a").send("hello");
    const project = sit.project.id;
    await w.svc.brain.fileLearned({ projectId: project, chainId: "c1", kind: "fact", text: "the cli entry point is bin/run.mjs", importance: 0.7 });
    const ran = (await adminCall(w.svc, "POST", "/memory/curator/run", { project })).body;
    assert.equal(ran.dossier, "v1");
    const runs = (await adminCall(w.svc, "GET", `/memory/curator/runs?project=${project}`)).body;
    assert.deepEqual([runs.model, runs.queued, runs.runs.map((/** @type {any} */ r) => `r${r.id}`)], ["judge", [], [ran.run]]);
    const undo = await adminCall(w.svc, "POST", `/memory/curator/runs/${ran.run}/undo`);
    assert.deepEqual([undo.status, undo.body.ok], [200, true], JSON.stringify(undo.body));
    assert.equal(w.svc.archive.dossiers.latest(project), null, "its dossier went with it");
    assert.equal((await adminCall(w.svc, "POST", "/memory/curator/runs/r999/undo")).status, 404);
  }));

test("the dossier's route: what a session starting now reads; no project is a 400, an unknown one a 404, memory closed a 503", () =>
  world({ models: { summarizer: "judge" }, callModel: judge }, async (w) => {
    const { sit } = await w.session("a").send("hello");
    const project = sit.project.id;
    const f = await w.svc.brain.fileLearned({ projectId: project, chainId: "c1", kind: "fact", text: "the cli entry point is bin/run.mjs", importance: 0.7 });
    const before = await adminCall(w.svc, "GET", `/memory/dossier?project=${project}`);
    assert.deepEqual([before.status, before.body.version, before.body.written, before.body.text], [200, null, null, ""], "one session said it: not yet a line");
    await w.svc.curator.run(project);
    const d = (await adminCall(w.svc, "GET", `/memory/dossier?project=${encodeURIComponent(project)}`)).body;
    assert.deepEqual([d.version, d.written.model, d.lines, d.hidden, d.cites], [1, "judge", 1, 0, [`i${f.id}`]]);
    assert.match(d.text, /^The project's dossier \(v1, [\d-]+; each line ends with the memories it rests on\):\nFacts:\n- the cli entry point is bin\/run\.mjs \[i\d+\]$/);
    assert.equal((await adminCall(w.svc, "GET", "/memory/dossier")).status, 400);
    assert.equal((await adminCall(w.svc, "GET", "/memory/dossier?project=nope")).status, 404);
    assert.equal((await adminCall({ isOpen: () => false, archiveWhy: () => "Memory has not started." }, "GET", `/memory/dossier?project=${project}`)).status, 503);
    assert.equal((await adminCall({ isOpen: () => false, archiveWhy: () => "Memory has not started." }, "GET", "/memory/inbox")).status, 503);
  }));

// (fails before: yes for the pages — the memory plan's f7)
test("the topic pages' route: each page as a search serves it now; no project is a 400, an unknown one a 404, memory closed a 503", () =>
  world({ models: { summarizer: "judge" }, callModel: judge }, async (w) => {
    const { sit } = await w.session("a").send("hello");
    const project = sit.project.id;
    const a = await w.svc.brain.fileLearned({ projectId: project, chainId: "c1", kind: "fact", text: "the cli entry point is bin/run.mjs", importance: 0.7 });
    const b = await w.svc.brain.fileLearned({ projectId: project, chainId: "c2", kind: "fact", text: "the cli reads its flags with node:util parseArgs", importance: 0.7 });
    assert.deepEqual((await adminCall(w.svc, "GET", `/memory/pages?project=${project}`)).body, { project, pages: [] });
    const lines = [{ text: "the cli entry point is bin/run.mjs", cites: [`i${a.id}`] }, { text: "the cli reads its flags with node:util parseArgs", cites: [`i${b.id}`] }];
    const sources = [a.id, b.id].map((id) => pageSource(w.svc.archive.items.get(id)));
    w.svc.archive.pages.add({ projectId: project, topic: "about:cli", slug: "cli", title: "cli", sections: [{ title: "Facts", lines }], cites: [a.id, b.id], sources, basis: "x", model: "judge" });
    const got = (await adminCall(w.svc, "GET", `/memory/pages?project=${encodeURIComponent(project)}`)).body.pages;
    assert.deepEqual(got.map((/** @type {any} */ p) => [p.slug, p.title, p.version, p.lines, p.hidden, p.written.model]), [["cli", "cli", 1, 2, 0, "judge"]]);
    assert.match(got[0].text, /^Topic page "cli" \(page:cli, v1, [\d-]+; each line ends with the memories it rests on\):\nFacts:\n- the cli entry point is bin\/run\.mjs \[i\d+\]\n- /);
    assert.equal((await adminCall(w.svc, "GET", "/memory/pages")).status, 400);
    assert.equal((await adminCall(w.svc, "GET", "/memory/pages?project=nope")).status, 404);
    assert.equal((await adminCall({ isOpen: () => false, archiveWhy: () => "Memory has not started." }, "GET", `/memory/pages?project=${project}`)).status, 503);
  }));

test("deleting a project takes its claims' questions, events, anchors, dossiers and topic pages with it; another project's stay", () =>
  world({ models: { summarizer: "judge" }, callModel: judge }, async (w) => {
    const { sit } = await w.session("a").remember("the api listens on port 3000");
    await w.session("b").remember("the api listens on port 8080 now");
    const project = sit.project.id;
    await w.svc.brain.fileLearned({ projectId: project, chainId: "c1", kind: "fact", text: "the cli entry point is bin/run.mjs", importance: 0.7 });
    await w.svc.curator.run(project);
    const ids = w.svc.archive.items.list({ projectId: project }).map((/** @type {any} */ it) => it.id);
    assert.equal(w.svc.archive.inbox.count(project), 1);
    assert.ok(w.svc.archive.dossiers.latest(project));
    const other = w.svc.archive.inbox.add({ projectId: "elsewhere", kind: "retire", key: "keep:1", itemIds: [987654], proposal: { action: "retire", id: 987654 }, reason: "kept" });
    const page = (/** @type {string} */ projectId) => w.svc.archive.pages.add({ projectId, topic: "about:cli", slug: "cli", title: "cli", sections: [], cites: [], sources: [], basis: "x" });
    page(project);
    const kept = page("elsewhere");
    await w.svc.deleteProject(project);
    const n = (/** @type {string} */ sql, /** @type {any[]} */ ...a) => Number(w.svc.archive.db.prepare(sql).get(...a).n);
    assert.equal(n(`SELECT COUNT(*) AS n FROM item_events WHERE item_id IN (${ids.join(",")})`), 0);
    assert.equal(n(`SELECT COUNT(*) AS n FROM item_anchors WHERE item_id IN (${ids.join(",")})`), 0);
    assert.equal(n("SELECT COUNT(*) AS n FROM inbox WHERE project_id = ?", project), 0);
    assert.equal(n("SELECT COUNT(*) AS n FROM dossiers WHERE project_id = ?", project), 0);
    assert.equal(n("SELECT COUNT(*) AS n FROM pages WHERE project_id = ?", project), 0);
    assert.ok(w.svc.archive.pages.get(kept.id), "another project's page stays");
    assert.ok(w.svc.archive.inbox.get(other.id), "another project's question stays");
    assert.ok(n("SELECT COUNT(*) AS n FROM curator_runs WHERE project_id = ?", project) >= 1, "its passes stay: counts only, and the day's budget");
  }));

test("deleting a session takes the questions about the claims it filed", () =>
  world({ models: { summarizer: "judge" }, callModel: judge }, async (w) => {
    const { sit } = await w.session("a").remember("the api listens on port 3000");
    const b = await w.session("b").remember("the api listens on port 8080 now");
    await w.svc.curator.run(sit.project.id);
    assert.equal(w.svc.archive.inbox.count(sit.project.id), 1);
    await w.svc.deleteSession(b.prep.chain);
    assert.equal(w.svc.archive.inbox.count(sit.project.id), 0, "the question cited a claim that session filed");
  }));

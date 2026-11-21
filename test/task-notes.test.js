// @ts-check
// HarnessV4_TaskNotes_Plan E33, the owner's words of 10-24: "what if you could extend the task graph such that behind
// each node there could be quite a lot of information saved that you can read on demand whenever you need … this could
// also include other files like screenshots, the artifacts produced by tool i mean anything". The tasks tool keeps notes
// and files behind each task — and behind the graph itself — on disk with the chat, never in its record nor in the
// conversation; it reads them on demand: a list, a note or a text file in parts an answer can carry, an image as an
// image. The graph's words and its page mark what each task keeps; a compaction and a restart lose none of it; a new
// graph starts with nothing; a deleted chat takes its notes with it.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NOTES_LIMITS, createTaskNotes, fileName } from "../src/services/task-notes.js";
import { applyTasks, graphView, hold, openGraphText, showText } from "../src/core/task-graph.js";
import { PART_BYTES, createGraphNotes, graphNoteSources, partOf } from "../src/app/agent/graph-notes.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createAgentTurns } from "../src/app/agent-inbox.js";
import { CODER_TASKS_TOOL, LEAD_TASKS_TOOL, TASKS_READS_TOOL, TASKS_TOOL, argSummary } from "../src/app/agent/tools.js";
import { drawGraph } from "../src/ui/harness/views/task-graph.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

/** A 1×1 PNG, whole. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const T0 = Date.UTC(2026, 9, 24, 12, 0);
const ADD = { action: "add", goal: "Finish the design pass", tasks: [{ id: "t1", name: "Read the reviews" }, { id: "t2", name: "Build the mocks", needs: ["t1"] }] };
/** A graph as its planner left it. @returns {any} */
const graphOf = () => {
  const r = applyTasks(null, ADD, { at: T0, crew: "agent" });
  assert.ok(r.ok);
  return r.graph;
};
/** A long note in lines, each its own, so its parts can be told apart. @param {number} chars */
const longNote = (chars) => {
  let s = "";
  for (let i = 0; s.length < chars; i++) s += `line ${i}: the Designer's review says every control stays on screen.\n`;
  return s.slice(0, chars);
};
/** @type {string[]} */
const made = [];
const tempDir = (/** @type {string} */ name) => {
  const d = mkdtempSync(join(tmpdir(), `filament-task-notes-${name}-`));
  made.push(d);
  return d;
};
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe("the store: on disk with the chat, a folder a task", () => {
  // (fails before: yes — nothing kept anything behind a task)
  test("a note kept whole under its title; the same title, case and spacing aside, replaces it; a graph keeps its own", () => {
    const dir = tempDir("store");
    const s = createTaskNotes({ dir, now: () => T0 });
    const text = longNote(150_000);
    assert.deepEqual(s.keepNote("c1", T0, "t1", { title: "Designer review", text, by: "the agent" }), { ok: true, replaced: null });
    assert.equal(readFileSync(join(dir, "c1", String(T0), "t1", "notes", "1.md"), "utf8"), text, "kept whole, in its own file");
    assert.deepEqual(s.keepNote("c1", T0, "t1", { title: "  designer   REVIEW ", text: "Shorter now.", by: "the agent" }), { ok: true, replaced: 150_000 });
    assert.deepEqual(s.list("c1", T0, "t1").notes.map((n) => [n.title, n.chars, n.first]), [["designer REVIEW", 12, "Shorter now."]]);
    assert.equal(s.note("c1", T0, "t1", "Designer review")?.text, "Shorter now.");
    // Behind the graph itself, and the counts the graph's words mark.
    assert.deepEqual(s.keepNote("c1", T0, null, { title: "Plan", text: "The plan.", by: "the agent" }), { ok: true, replaced: null });
    assert.deepEqual(s.keepFile("c1", T0, "t2", { name: "C:\\shots\\Login screen.png", data: PNG, by: "the agent" }), { ok: true, name: "Login screen.png", replaced: null });
    assert.deepEqual(s.counts("c1", T0), { "": { notes: 1, files: 0, bytes: 9, titles: ["Plan"] }, t1: { notes: 1, files: 0, bytes: 12, titles: ["designer REVIEW"] }, t2: { notes: 0, files: 1, bytes: PNG.length, titles: ["Login screen.png"] } });
    assert.deepEqual(readFileSync(/** @type {any} */ (s.file("c1", T0, "t2", "login SCREEN.png")).path), PNG);
    // A new graph whose ids repeat the old one's starts with nothing (case 11).
    assert.deepEqual(s.list("c1", T0 + 1, "t1"), { notes: [], files: [] });
    assert.deepEqual(s.counts("c1", T0 + 1), {});
    // Forget, by title or by name; one that is not there is said.
    assert.equal(s.forget("c1", T0, "t2", "Login screen.png"), "file");
    assert.equal(s.forget("c1", T0, "t1", "designer review"), "note");
    assert.equal(s.forget("c1", T0, "t1", "nothing of that name"), null);
    assert.deepEqual(s.counts("c1", T0), { "": { notes: 1, files: 0, bytes: 9, titles: ["Plan"] } });
    // A deleted chat takes its notes with it (case 12).
    s.drop("c1");
    assert.equal(existsSync(join(dir, "c1")), false);
  });

  // (fails before: yes — no limits existed)
  test("its limits are refused in words, and a store with no folder, or a name no folder of its own, keeps nothing", () => {
    const s = createTaskNotes({ dir: tempDir("limits") });
    for (let i = 0; i < NOTES_LIMITS.notes; i++) assert.ok(s.keepNote("c1", T0, "t1", { title: `n${i}`, text: "x", by: "a" }).ok);
    assert.deepEqual(s.keepNote("c1", T0, "t1", { title: "one more", text: "x", by: "a" }), { ok: false, error: "t1 holds 50 notes already: forget one, or keep this under one's title" });
    assert.ok(s.keepNote("c1", T0, "t1", { title: "n3", text: "replaced in place", by: "a" }).ok, "a title already kept replaces, past the count");
    const big = new Uint8Array(NOTES_LIMITS.fileBytes + 1);
    assert.deepEqual(s.keepFile("c1", T0, "t1", { name: "huge.bin", data: big, by: "a" }), { ok: false, error: "huge.bin is 10 MB: a file kept here is 10 MB at most" });
    assert.equal(s.keepNote("../c1", T0, "t1", { title: "t", text: "x", by: "a" }).ok, false);
    const none = createTaskNotes({ dir: null });
    assert.equal(none.on, false);
    assert.deepEqual(none.keepNote("c1", T0, "t1", { title: "t", text: "x", by: "a" }), { ok: false, error: "nothing can be kept here: this Filament keeps no notes" });
    assert.deepEqual([fileName("a/b/../c:d?.png"), fileName("..."), fileName(".env")], ["c_d_.png", "file", "env"]);
  });
});

describe("the call, checked as every tasks call is", () => {
  // (fails before: yes — keep and read were no actions)
  test("keep and read: refused in words where they cannot be, every problem at once; the graph never changes", () => {
    const g = graphOf();
    /** @param {any} graph @param {any} input */
    const no = (graph, input) => {
      const r = applyTasks(graph, input, { at: T0, crew: "agent" });
      assert.equal(r.ok, false, JSON.stringify(r));
      return /** @type {any} */ (r).error;
    };
    assert.equal(no(null, { action: "keep", title: "x", text: "y" }), "No graph yet: tasks add starts one, with its goal — then keep what its tasks need behind them.");
    assert.equal(no(g, { action: "read", id: "t9" }), "t9 is no task in the graph: keep and read name a task by its id, or none for the graph itself");
    assert.equal(no(g, { action: "keep", id: "t1" }), 'keep takes something to keep: title and text (a note), files (paths), picture (a picture\'s name) — or forget\nThe call: {"action":"keep","id":"t1","title":"Checkpoint","text":"where it stands, what is next"}');
    assert.ok(no(g, { action: "keep" }).endsWith('The call: {"action":"keep","title":"Checkpoint","text":"where it stands, what is next"}'), "behind the graph, as it was asked");
    assert.equal(no(g, { action: "keep", text: "words", files: "a.png", from: 3 }), "3 problems, so nothing of this call changed — one call can fix them all:\n- a note needs title: the name you read it back by\n- files is a list of paths\n- from is read's: where a long note's next part starts");
    assert.equal(no(g, { action: "keep", title: "x".repeat(121), text: " " }), "2 problems, so nothing of this call changed — one call can fix them all:\n- title is 121 characters: a title is 120 at most\n- text is empty: give the note's words, or forget it by its title");
    assert.equal(no(g, { action: "keep", title: "t", text: "x".repeat(200_001) }), "text is 200,001 characters: a note is 200,000 at most — keep it as two notes");
    assert.equal(no(g, { action: "read", id: "t1", text: "x", from: -1 }), "2 problems, so nothing of this call changed — one call can fix them all:\n- read takes id, title and from alone: text is keep's\n- from is a whole number: where a long note's or file's next part starts, as its last part said");
    assert.equal(no(g, { action: "read", from: 20 }), "from reads on in one note or file: give its title too");
    const ok = applyTasks(g, { action: "keep", id: "T1", title: " Designer  review ", text: "words", files: [" a.png "], picture: "login", forget: ["old"] }, { at: T0, crew: "agent" });
    assert.ok(ok.ok);
    assert.deepEqual(/** @type {any} */ (ok).notes, { kind: "keep", task: "t1", graph: T0, title: "Designer review", text: "words", files: ["a.png"], picture: "login", forget: ["old"], from: 0 });
    assert.equal(/** @type {any} */ (ok).graph, g, "the graph as it was");
    // A closed graph keeps and reads the same: what was learned stays (case 10).
    const closed = /** @type {any} */ (applyTasks(g, { action: "close", reason: "Done." }, { at: T0, crew: "agent" })).graph;
    assert.equal(/** @type {any} */ (applyTasks(closed, { action: "read", id: "t1" }, { at: T0, crew: "agent" })).notes.kind, "read");
    // Every planner's tool has them: the agent's, one that reads along, a lead's and a coding agent's.
    for (const tool of [TASKS_TOOL, TASKS_READS_TOOL, LEAD_TASKS_TOOL, CODER_TASKS_TOOL]) {
      const p = /** @type {any} */ (tool.input_schema.properties);
      assert.ok(p.action.enum.includes("keep") && p.action.enum.includes("read"), tool.description.slice(0, 40));
      for (const f of ["title", "text", "files", "picture", "forget", "from"]) assert.ok(p[f], f);
      // A coding agent's actions are said at its action field, and its id says what keep and read name (the owner's tool
      // plan of 11-08).
      if (tool === CODER_TASKS_TOOL) {
        assert.match(p.action.description, /keep: a note, files or a picture kept on disk behind a task or the graph, so a compaction loses none; forget takes them away\./);
        assert.match(p.id.description, /keep, read: the task it is kept behind \(left out: the graph itself\)\./);
      } else assert.match(tool.description, /keep: behind a task by id, or behind the graph itself with none/);
    }
    assert.match(/** @type {any} */ (CODER_TASKS_TOOL.input_schema.properties.action).description, /read: what is kept: a note or a text file in parts, an image as an image\./);
    assert.match(/** @type {any} */ (CODER_TASKS_TOOL.input_schema.properties.from).description, /^read: where a long note's or text file's next part starts, as its last part said\.$/);
    assert.deepEqual([argSummary("tasks", { action: "keep", id: "t1", title: "Review", files: ["a", "b"] }), argSummary("tasks", { action: "read" }), argSummary("tasks", { action: "keep", picture: "login", forget: ["x"] })], ['keep t1 "Review" +2 files', "read the graph", "keep the graph +picture login −1"]);
  });

  // (fails before: yes — the graph's words said nothing of what was kept: after a compaction it was lost to the agent)
  test("the graph's words mark what each task keeps, and the graph's own; its page's view carries the counts", () => {
    const g = graphOf();
    const kept = { "": { notes: 1, files: 0 }, t1: { notes: 2, files: 1 } };
    const shown = showText(g, "agent", kept);
    assert.ok(shown.includes('\nKept behind the graph itself: 1 note.\n- t1 "Read the reviews" — ready · keeps 2 notes, 1 file\n- t2 "Build the mocks" — waiting · needs t1\n'), shown);
    assert.ok(shown.endsWith("A task whole: tasks show with its id.\nWhat is kept: tasks read with a task's id — none for the graph's own — lists it; with a title too, reads that one."), shown);
    assert.equal(showText(g, "agent"), showText(g, "agent", {}), "nothing kept: the words as they were");
    const one = /** @type {any} */ (applyTasks(g, { action: "show", id: "t1" }, { at: T0, crew: "agent", kept })).text;
    assert.ok(one.startsWith('t1 "Read the reviews" — ready · keeps 2 notes, 1 file\nKept behind it: 2 notes, 1 file — tasks read with id t1 lists them'), one);
    assert.equal(openGraphText(g, "agent", kept), shown, "after a summary too (case 9)");
    const view = /** @type {any} */ (graphView(g, kept));
    assert.deepEqual([view.kept, view.tasks[0].kept, "kept" in view.tasks[1]], [{ notes: 1, files: 0 }, { notes: 2, files: 1 }, false]);
    assert.equal("kept" in /** @type {any} */ (graphView(g)), false);
  });
});

describe("kept and read: in parts an answer carries, an image as an image", () => {
  // (fails before: yes — the loop cuts a tool's answer at about 24 KB: a long note read whole would have been cut)
  test("a long text comes in parts under the answer's limit, each ending at a line's end, which join to the whole", () => {
    for (const text of [longNote(150_000), "ünïcödé ✓ ".repeat(9000), `${"é".repeat(PART_BYTES)}\n${"z".repeat(10)}`]) {
      /** @type {string[]} */
      const parts = [];
      let from = 0;
      for (let n = 0; n < 50; n++) {
        const p = partOf(text, from);
        assert.ok(Buffer.byteLength(p.part) <= PART_BYTES, `part ${n}: ${Buffer.byteLength(p.part)} bytes`);
        parts.push(p.part);
        if (p.next === null) break;
        from = p.next;
      }
      assert.equal(parts.join(""), text);
    }
    const lines = partOf(longNote(150_000), 0);
    assert.ok(lines.part.endsWith("\n") && lines.next !== null);
  });

  // (fails before: yes — Filament took no file into a task's keeping)
  test("a file comes from the chat's folder or a folder the agent may work in — copied in; a picture by its name", () => {
    const root = tempDir("root");
    const elsewhere = tempDir("elsewhere");
    writeFileSync(join(root, "shot.png"), PNG);
    mkdirSync(join(root, "docs"));
    writeFileSync(join(elsewhere, "secret.txt"), "not yours");
    let cfg = { agentLoop: { roots: [root] }, server: { host: "127.0.0.1" } };
    const src = graphNoteSources({
      config: { get: () => cfg },
      folderOf: () => root,
      picture: (_c, name) => (name === "login_wireframe" ? { found: { id: "v1", title: "login_wireframe", code: "<svg>LOGIN</svg>" }, gone: null, older: [], names: [] } : { found: null, gone: null, older: [], names: [{ id: "v1", title: "login_wireframe" }] }),
      ownPictures: () => [{ id: "v9", title: "my_chart", at: 5, code: () => "<div>CHART</div>" }],
    });
    const got = src.fileFrom("c1", "shot.png");
    assert.ok(got.ok);
    assert.deepEqual([got.ok && got.name, got.ok && Buffer.from(got.data).equals(PNG)], ["shot.png", true]);
    assert.deepEqual(src.fileFrom("c1", "missing.png"), { ok: false, error: `no such file (${join(root, "missing.png")})` });
    assert.deepEqual(src.fileFrom("c1", "docs"), { ok: false, error: "a folder: name the files in it to keep" });
    assert.deepEqual(src.fileFrom("c1", join(elsewhere, "secret.txt")), { ok: false, error: "it is outside this chat's folder and under no folder agentLoop.roots lists" });
    cfg = { agentLoop: { roots: [root, elsewhere] }, server: { host: "127.0.0.1" } };
    assert.equal(src.fileFrom("c1", join(elsewhere, "secret.txt")).ok, true, "a folder the agent may work in");
    assert.deepEqual(src.pictureFrom("c1", "login_wireframe"), { ok: true, name: "login_wireframe", code: "<svg>LOGIN</svg>" });
    assert.deepEqual(src.pictureFrom("c1", "MY_CHART"), { ok: true, name: "my_chart", code: "<div>CHART</div>" }, "the chat's own picture");
    assert.deepEqual(src.pictureFrom("c1", "nope"), { ok: false, error: "no picture of that name was drawn in this chat — its pictures: login_wireframe, my_chart" });
  });
});

/**
 * A session's graph kept in memory, a registry that refuses nothing it is asked, the bus, and the notes in a folder of
 * the test's — with the files and pictures the sources give.
 */
function rig() {
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", meta: {} }]]);
  /** @type {any[]} */
  const published = [];
  const root = tempDir("rig");
  writeFileSync(join(root, "shot.png"), PNG);
  writeFileSync(join(root, "notes.md"), longNote(60_000));
  const store = createTaskNotes({ dir: join(root, ".data", "task-notes"), now: () => T0 });
  const notes = createGraphNotes({
    notes: store,
    ...graphNoteSources({ config: { get: () => ({ agentLoop: { roots: [root] }, server: { host: "127.0.0.1" } }) }, folderOf: () => root, picture: () => ({ found: { id: "v1", title: "login_wireframe", code: "<svg>LOGIN</svg>" }, gone: null, older: [], names: [] }), ownPictures: () => [] }),
  });
  const registry = { slots: () => 4, tell: () => {}, stop: () => ({ ok: true }), resumable: () => null, launch: () => ({ ok: false, error: "no launches here" }), guard: () => {} };
  const archive = {
    /** @param {string} id */
    /** The meta's named keys, as the archive's `metaOf` reads them. @param {string} id @param {readonly string[]} keys */
    metaOf: (id, keys) => {
      const c = chains.get(id);
      return c ? Object.fromEntries(keys.filter((k) => c.meta?.[k] !== undefined).map((k) => [k, c.meta[k]])) : null;
    },
    /** @param {string} id @param {Record<string, any>} patch */
    mergeMeta: (id, patch) => {
      const c = chains.get(id);
      if (!c) return null;
      c.meta = structuredClone({ ...c.meta, ...patch });
      return c.meta;
    },
    openGraphs: () => [],
  };
  // Its clock moves, as a real one does: each graph starts at a time of its own.
  let t = T0;
  const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: (topic, e) => published.push({ topic, e }) }, crew: () => "agent", log: () => {}, now: () => t++, notes });
  return { runner, chains, published, root, store, graph: () => chains.get("c1").meta.graph };
}
/** @type {{ crew: import("../src/core/task-graph.js").Crew }} */
const AGENT = { crew: "agent" };
/** @param {any} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);

describe("the runner: keep and read change nothing in the graph, and let go of no stop", () => {
  // (fails before: yes — the owner watched me dig two reviews and four mocks back out of an old transcript)
  test("a 150,000-character note kept and read back whole in parts; a file and a picture kept; read lists them; show marks them", () => {
    const r = rig();
    ok(r.runner.apply("c1", ADD, AGENT));
    const text = longNote(150_000);
    const kept = ok(r.runner.apply("c1", { action: "keep", id: "t1", title: "Designer review", text }, AGENT));
    assert.equal(kept.text, 'Behind t1:\n- kept the note "Designer review", 150,000 characters\nTask t1 keeps 1 note now: tasks read with id t1 lists them.');
    assert.deepEqual([kept.changed, kept.view.tasks[0].kept], [true, { notes: 1, files: 0, bytes: 150_000, titles: ["Designer review"] }], "the page draws it again");
    const last = r.published.at(-1).e;
    assert.deepEqual([last.rev, last.graph.tasks[0].kept.notes], [r.graph().rev, 1], "on the bus, its rev one on");
    const files = ok(r.runner.apply("c1", { action: "keep", id: "t1", files: ["shot.png", "gone.png"], picture: "login_wireframe" }, AGENT));
    assert.equal(files.text, `Behind t1:\n- kept the file shot.png, ${PNG.length} bytes\n- kept the picture login_wireframe's code as the file login_wireframe.html, 16 bytes\nNot done:\n- gone.png: no such file (${join(r.root, "gone.png")})\nTask t1 keeps 1 note, 2 files now: tasks read with id t1 lists them.`);
    ok(r.runner.apply("c1", { action: "keep", title: "The plan", text: "Every control stays on screen.\nThen the mocks." }, AGENT));
    // The list: notes and files, a line each.
    const list = ok(r.runner.apply("c1", { action: "read", id: "t1" }, AGENT));
    assert.equal(list.text, `Kept behind t1: 1 note, 2 files.\nNotes:\n- "Designer review" — 150,000 characters, kept 2026-10-24 12:00 UTC by the agent: line 0: the Designer's review says every control stays on screen.\nFiles:\n- shot.png — ${PNG.length} bytes, kept 2026-10-24 12:00 UTC by the agent\n- login_wireframe.html — 16 bytes, kept 2026-10-24 12:00 UTC by the agent\nRead one: tasks read with id t1 and its title — a note's, or a file's name.\nKept elsewhere in this graph: the graph itself (1 note).`);
    // The note, whole, in parts.
    /** @type {string[]} */
    const parts = [];
    let from = 0;
    for (let n = 0; n < 20; n++) {
      const got = ok(r.runner.apply("c1", { action: "read", id: "t1", title: "designer review", ...(from ? { from } : {}) }, AGENT));
      assert.ok(Buffer.byteLength(got.text) < 24_000, `${Buffer.byteLength(got.text)} bytes`);
      const head = got.text.indexOf(":\n\n");
      assert.match(got.text.slice(0, head), /^The note "Designer review" behind t1, 150,000 characters, kept 2026-10-24 12:00 UTC by the agent — characters [\d,]+–[\d,]+ of 150,000$/);
      const more = got.text.match(/\n\n\[Filament: more follows — tasks read with id t1, title "designer review" and from (\d+) reads the next part\]$/);
      parts.push(got.text.slice(head + 3, more ? got.text.length - more[0].length : undefined));
      if (!more) break;
      from = Number(more[1]);
    }
    assert.ok(parts.length > 6);
    assert.equal(parts.join(""), text, "read back whole");
    // An image as an image; a picture's code as text.
    const img = ok(r.runner.apply("c1", { action: "read", id: "t1", title: "shot.png" }, AGENT));
    assert.equal(img.text, `The file shot.png behind t1, ${PNG.length} bytes, kept 2026-10-24 12:00 UTC by the agent: an image (image/png), shown with this answer.`);
    assert.deepEqual(img.media, [{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG.toString("base64") } }]);
    assert.equal(ok(r.runner.apply("c1", { action: "read", id: "t1", title: "login_wireframe.html" }, AGENT)).text, "The file login_wireframe.html behind t1, 16 bytes, kept 2026-10-24 12:00 UTC by the agent:\n\n<svg>LOGIN</svg>");
    assert.deepEqual(r.runner.apply("c1", { action: "read", id: "t1", title: "nothing" }, AGENT), { ok: false, error: 'Task t1 keeps no note titled "nothing" and no file of that name: it keeps "Designer review", shot.png, login_wireframe.html.' });
    // The graph's own, and the marks a show and a summary carry.
    assert.equal(ok(r.runner.apply("c1", { action: "read", title: "the plan" }, AGENT)).text, 'The note "The plan" behind the graph itself, 46 characters, kept 2026-10-24 12:00 UTC by the agent:\n\nEvery control stays on screen.\nThen the mocks.');
    const show = ok(r.runner.apply("c1", { action: "show" }, AGENT)).text;
    assert.ok(show.includes('Kept behind the graph itself: 1 note.\n- t1 "Read the reviews" — ready · keeps 1 note, 2 files\n'), show);
    // After a summary, by title (11-09).
    assert.ok(String(r.runner.open("c1", "agent")).includes('keeps "Designer review", "shot.png" and "login_wireframe.html"'), String(r.runner.open("c1", "agent")));
    assert.deepEqual(r.runner.kept("c1"), { "": { notes: 1, files: 0, bytes: 46, titles: ["The plan"] }, t1: { notes: 1, files: 2, bytes: 150_000 + PNG.length + 16, titles: ["Designer review", "shot.png", "login_wireframe.html"] } });
    // Forget; a file not there is said, and a keep that did nothing is refused, saying what the task keeps.
    assert.equal(ok(r.runner.apply("c1", { action: "keep", id: "t1", forget: ["shot.png"] }, AGENT)).text, "Behind t1:\n- forgot the file shot.png\nTask t1 keeps 1 note, 1 file now: tasks read with id t1 lists them.");
    assert.deepEqual(r.runner.apply("c1", { action: "keep", id: "t1", forget: ["shot.png"] }, AGENT), { ok: false, error: "Nothing changed behind t1:\n- shot.png: no note or file of that name is kept behind t1\nTask t1 keeps 1 note, 1 file now: tasks read with id t1 lists them." });
    // A new graph starts with nothing kept (case 11).
    ok(r.runner.apply("c1", { action: "close", reason: "Done." }, AGENT));
    ok(r.runner.apply("c1", { ...ADD, goal: "Again" }, AGENT));
    assert.equal(ok(r.runner.apply("c1", { action: "read", id: "t1" }, AGENT)).text, "Nothing is kept behind t1 yet: tasks keep keeps a note there — title and text — or files, or a picture by its name.");
  });

  // (fails before: yes — a guard the plan asked for: keep and read are no answer to the developer's stop)
  test("the developer's stop holds through a keep and a read; a text file reads in parts; no store, refused in words", () => {
    const r = rig();
    ok(r.runner.apply("c1", ADD, AGENT));
    r.chains.get("c1").meta.graph = hold(r.graph(), T0);
    ok(r.runner.apply("c1", { action: "keep", id: "t2", files: ["notes.md"] }, AGENT));
    ok(r.runner.apply("c1", { action: "read", id: "t2" }, AGENT));
    assert.ok(r.graph().held, "still held");
    const first = ok(r.runner.apply("c1", { action: "read", id: "t2", title: "notes.md" }, AGENT)).text;
    assert.match(first, /^The file notes\.md behind t2, 59 KB, kept 2026-10-24 12:00 UTC by the agent — characters 1–[\d,]+ of 60,000:\n\nline 0:/);
    assert.match(first, /\[Filament: more follows — tasks read with id t2, title "notes\.md" and from \d+ reads the next part\]$/);
    const off = createGraphRunner({ archive: { metaOf: () => ({ graph: r.graph() }), mergeMeta: () => null, openGraphs: () => [] }, registry: /** @type {any} */ ({}), events: { publish: () => {} }, crew: () => "agent", log: () => {}, notes: createGraphNotes({ notes: createTaskNotes({ dir: null }) }) });
    assert.deepEqual(off.apply("c1", { action: "keep", title: "x", text: "y" }, AGENT), { ok: false, error: "This Filament keeps no notes behind its tasks: it runs with no folder of its own to keep them in." });
  });

  // (fails before: yes — a coding agent's tasks over Filament's MCP server had no keep, and no image came back)
  test("a coding agent's tasks over Filament's server: keep and read, an image beside the words", async () => {
    const r = rig();
    ok(r.runner.apply("c1", ADD, AGENT));
    const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => /** @type {any} */ (r.runner), turns: createAgentTurns(), subagents: () => null, membersOf: () => null });
    const at = /** @type {any} */ ({ cwd: r.root, upstream: "claude", chain: "c1", turn: "t_1", graph: true });
    assert.equal((await tools.call("tasks", { action: "keep", id: "t1", files: ["shot.png"] }, at)).text, `Behind t1:\n- kept the file shot.png, ${PNG.length} bytes\nTask t1 keeps 1 file now: tasks read with id t1 lists them.`);
    const got = await tools.call("tasks", { action: "read", id: "t1", title: "shot.png" }, at);
    assert.equal(got.media?.[0]?.source?.media_type, "image/png");
    assert.equal(r.store.list("c1", r.graph().startedAt, "t1").files[0].by, "the coding agent");
  });
});

describe("the Plan tab: the task you pick lists what it keeps", () => {
  // (fails before: yes — the page drew nothing of it)
  test("what it keeps in its tooltip; the card: a note and a text file open in the reader, a picture shown, other files downloaded", () => {
    const g = graphOf();
    const view = graphView(g, { "": { notes: 1, files: 0 }, t1: { notes: 1, files: 3 } });
    /** @type {any[]} */
    const opened = [];
    let graphShown = false;
    const pane = {
      of: (/** @type {string | null} */ task) => ({
        list: task === "t1"
          ? { notes: [{ title: "Designer review", chars: 12345, at: T0, by: "the agent", first: "Every control stays." }], files: [{ name: "login.png", bytes: 2048, at: T0, by: "the agent" }, { name: "mock.html", bytes: 900, at: T0, by: "the agent" }, { name: "deck.pdf", bytes: 3_000_000, at: T0, by: "the agent" }] }
          : { notes: [{ title: "The plan", chars: 40, at: T0, by: "the agent", first: "Plan." }], files: [] },
        error: null,
      }),
      opened: (/** @type {string | null} */ task, /** @type {string} */ name) => (task === "t1" && name === "Designer review" ? { text: "THE WHOLE REVIEW", error: null } : null),
      onOpen: (/** @type {any} */ task, /** @type {any} */ name, /** @type {any} */ kind) => opened.push([task, name, kind]),
      fileUrl: (/** @type {string | null} */ task, /** @type {string} */ name) => `/api/sessions/c1/graph/kept?task=${task}&file=${name}`,
      graphShown,
      onGraph: () => { graphShown = true; },
      note: () => null,
    };
    const { el } = drawGraph(view, { h: fakeH, now: T0 + 120_000, chosen: "t1", kept: pane });
    const all = textOf(el);
    assert.ok(all.includes("Kept behind the graph: 1 note"), all);
    assert.ok(all.includes("Kept behind it|1 note · 3 files|Designer review|note · 12,345 characters · the agent · 2 min ago|Every control stays.|login.png|file · 2 KB · the agent · 2 min ago|mock.html|file · 900 bytes · the agent · 2 min ago|deck.pdf|file · 2.9 MB · the agent · 2 min ago · download"), all);
    /** @param {any} n @param {(n: any) => boolean} f @returns {any[]} */
    const find = (n, f) => (n && typeof n === "object" ? [...(f(n) ? [n] : []), ...(n.kids || []).flatMap((/** @type {any} */ k) => find(k, f))] : []);
    assert.deepEqual(find(el, (n) => n.tag === "img").map((n) => n.attrs.src), ["/api/sessions/c1/graph/kept?task=t1&file=login.png"]);
    assert.deepEqual(find(el, (n) => n.tag === "a" && "download" in n.attrs).map((n) => n.attrs.download), ["deck.pdf"]);
    // A task is one line (the redesign of 11-05): what it keeps is its tooltip's, and its card's.
    assert.ok(find(el, (n) => n.attrs?.["data-id"] === "t1")[0].attrs.title.includes("\nKeeps 1 note · 3 files — choose it to read them"), "t1's tooltip says what it keeps");
    for (const b of buttonsOf(el)) if (/Read mock\.html|Read Designer review/.test(String(b.attrs.title))) b.dispatch("click");
    assert.deepEqual(opened, [["t1", "Designer review", "note"], ["t1", "mock.html", "file"]]);
    buttonsOf(el).find((b) => String(b.attrs.class).includes("tg-kept-graph"))?.dispatch("click");
    assert.equal(graphShown, true);
    const shown = drawGraph(view, { h: fakeH, now: T0, kept: { ...pane, graphShown: true } }).el;
    assert.ok(textOf(shown).includes("Kept behind the graph|1 note|The plan|"), textOf(shown));
    assert.equal(textOf(drawGraph(view, { h: fakeH, now: T0, chosen: "t1" }).el).includes("Kept behind it"), false, "no pane: no card");
  });
});

describe("end to end on a native session: kept on disk, read on demand, gone with the chat", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  const toolUse = (/** @type {string} */ id, /** @type {any} */ input) => ({ type: "tool_use", id, name: "tasks", input });
  const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
  /** What a tool call answered in a request. @param {any} body @param {string} id */
  const resultIn = (body, id) => {
    for (const m of body?.messages || []) for (const b of Array.isArray(m.content) ? m.content : []) if (b?.type === "tool_result" && b.tool_use_id === id) return b;
    return null;
  };
  const textOfResult = (/** @type {any} */ b) => (typeof b?.content === "string" ? b.content : (b?.content || []).filter((/** @type {any} */ x) => x.type === "text").map((/** @type {any} */ x) => x.text).join(""));
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-task-notes-e2e-"));
    made.push(root);
    writeFileSync(join(root, "shot.png"), PNG);
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    rmSync(shim.dataDir, { recursive: true, force: true });
  });

  // (fails before: yes — the whole of E33)
  test("the agent keeps a long note and a screenshot behind a task, reads them back — the image as an image — and the page reads them too", async () => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    assert.equal(created.status, 200, await created.clone().text());
    const id = String((await created.json()).id);
    const text = longNote(30_000);
    let round = 0;
    brain = (call) => {
      if (!(call.body?.tools || []).some((/** @type {any} */ t) => t.name === "ask")) return reply([{ type: "text", text: "ok" }]);
      round++;
      if (round === 1) return reply([toolUse("k0", ADD)], "tool_use");
      if (round === 2) return reply([toolUse("k1", { action: "keep", id: "t1", title: "Designer review", text }), toolUse("k2", { action: "keep", id: "t1", files: ["shot.png"] })], "tool_use");
      if (round === 3) return reply([toolUse("k3", { action: "read", id: "t1", title: "shot.png" }), toolUse("k4", { action: "show" })], "tool_use");
      return reply([{ type: "text", text: "Kept." }]);
    };
    up.reset();
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "keep the review", stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    const calls = up.received.filter((/** @type {any} */ c) => (c.body?.tools || []).some((/** @type {any} */ t) => t.name === "ask"));
    assert.equal(textOfResult(resultIn(calls[2].body, "k1")), 'Behind t1:\n- kept the note "Designer review", 30,000 characters\nTask t1 keeps 1 note now: tasks read with id t1 lists them.');
    const img = resultIn(calls[3].body, "k3");
    assert.ok(Array.isArray(img?.content), JSON.stringify(img));
    assert.deepEqual(img.content.find((/** @type {any} */ b) => b.type === "image")?.source, { type: "base64", media_type: "image/png", data: PNG.toString("base64") });
    assert.match(textOfResult(resultIn(calls[3].body, "k4")), /- t1 "Read the reviews" — ready · keeps 1 note, 1 file/);
    // On disk with the chat, never in its record.
    const chain = /** @type {any} */ (shim.app).memory.archive.getChain(id);
    assert.equal(JSON.stringify(chain.meta).includes("Designer review"), false);
    const folder = join(shim.dataDir, "task-notes", id);
    assert.ok(existsSync(folder));
    // The page's reads: the session's answer marks it, the list, a note whole, a file's bytes.
    const answer = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}`)).json();
    assert.deepEqual(answer.inForce.graph.tasks[0].kept, { notes: 1, files: 1, bytes: 30_000 + PNG.length, titles: ["Designer review", "shot.png"] });
    const list = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/graph/kept?task=t1`)).json();
    assert.deepEqual([list.task, list.notes.map((/** @type {any} */ n) => n.title), list.files.map((/** @type {any} */ f) => f.name)], ["t1", ["Designer review"], ["shot.png"]]);
    const note = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/graph/kept?task=t1&note=${encodeURIComponent("designer review")}`)).json();
    assert.equal(note.note.text, text);
    const file = await shim.api(`/api/sessions/${encodeURIComponent(id)}/graph/kept?task=t1&file=shot.png`);
    assert.deepEqual([file.status, file.headers.get("content-type"), file.headers.get("content-security-policy")], [200, "image/png", "sandbox"]);
    assert.ok(Buffer.from(await file.arrayBuffer()).equals(PNG));
    assert.equal((await shim.api(`/api/sessions/${encodeURIComponent(id)}/graph/kept?task=t9`)).status, 404);
    // The chat deleted: its notes and files go with it (case 12).
    const del = await shim.api(`/api/memory/sessions/${encodeURIComponent(id)}/delete`, { method: "POST", body: {} });
    assert.equal(del.status, 200, await del.clone().text());
    assert.equal(existsSync(folder), false);
  });
});

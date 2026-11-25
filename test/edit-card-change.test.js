// @ts-check
// An Edit card opens its change (HarnessV4_Four_Plan E22): where git's snapshot of the turn holds nothing of the file —
// a file outside every git place, or a turn with no run on record — the card draws the change the call itself made,
// read from its input, which the archive keeps whole. The change as built, the route over a real turn of the loop,
// and the card's read on the page.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { madeChange } from "../src/app/agent/tools.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { removeDirs } from "./helpers/wait.js";

/** A patch's rows past its two heads. @param {string} patch */
const rows = (patch) => patch.split("\n").slice(2).filter(Boolean);

describe("the change a call made, from its input alone", () => {
  // (fails before: yes — nothing built a change from a call after it ran; the permission card's reads the file now,
  // where an edit already made shows nothing)
  test("an edit in any vocabulary: its replaced lines and their replacement, counted; each edit a hunk of its own", () => {
    const ours = madeChange("edit", { path: "notes\\a.md", edits: [{ oldText: "one\ntwo\n", newText: "one\nTWO\n" }] });
    assert.deepEqual(ours && { file: ours.file, rows: rows(ours.patch), added: ours.added, removed: ours.removed, wrote: ours.wrote, every: ours.every },
      { file: "notes/a.md", rows: ["@@ -1,2 +1,2 @@", " one", "-two", "+TWO"], added: 1, removed: 1, wrote: false, every: false });
    const claude = madeChange("Edit", { file_path: "C:\\t\\b.md", old_string: "x", new_string: "y\nz", replace_all: true });
    assert.deepEqual(claude && [claude.file, rows(claude.patch), claude.every], ["C:/t/b.md", ["@@ -1,1 +1,2 @@", "-x", "+y", "+z"], true]);
    const many = madeChange("MultiEdit", { file_path: "c.js", edits: [{ old_string: "a\nb", new_string: "a\nB" }, { old_string: "q", new_string: "Q" }] });
    assert.deepEqual(many && rows(many.patch), ["@@ -1,2 +1,2 @@", " a", "-b", "+B", "@@ -4,1 +4,1 @@", "-q", "+Q"], "the second numbered after the first, a line between");
    assert.deepEqual(many && [many.added, many.removed], [2, 2]);
  });

  // (fails before: yes)
  test("a write is its text, every line added, what it replaced not in the call; an empty one and a no-op say so by an empty patch", () => {
    const w = madeChange("write", { path: "n.md", content: "l1\nl2\n" });
    assert.deepEqual(w && [w.patch, w.added, w.removed, w.wrote], ["--- /dev/null\n+++ n.md\n@@ -0,0 +1,2 @@\n+l1\n+l2\n", 2, 0, true]);
    const empty = madeChange("Write", { file_path: "e.md", content: "" });
    assert.deepEqual(empty && [empty.patch, empty.wrote], ["", true]);
    const same = madeChange("edit", { path: "s.md", edits: [{ oldText: "k", newText: "k" }] });
    assert.deepEqual(same && [same.patch, same.added, same.removed, same.wrote], ["", 0, 0, false]);
  });

  // (fails before: yes)
  test("cut and redacted as a card's change; null for a call that changes no file, or whose record holds no change", () => {
    const long = madeChange("write", { path: "big.txt", content: Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n") });
    assert.deepEqual(long && [rows(long.patch).length, long.omitted, long.added], [301, 100, 400], "300 lines and the head; the count is the whole");
    const key = madeChange("edit", { path: "k.env", edits: [{ oldText: "KEY=old", newText: "KEY=sk-abcdefghijklmnopqrstuvwx" }] });
    assert.ok(key && key.patch.includes("+KEY=sk-abcd…") && !key.patch.includes("qrstuvwx"), key?.patch);
    assert.equal(madeChange("edit", { file_path: "codex.js" }), null, "Codex's edit names its file alone (FO-D10)");
    assert.equal(madeChange("read", { path: "r.md" }), null);
    assert.equal(madeChange("write", { path: "" , content: "x" }), null);
    assert.equal(madeChange("bash", { command: "echo hi > f" }), null);
  });
});

describe("the route: a turn of the loop that wrote outside git", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  /** @type {string} */ let sid;
  /** A loop request's tool results, by the calls they answer. @param {any} body */
  const answered = (body) => new Set((body?.messages || []).flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : []))
    .filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id));
  const use = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-edit-card-"));
    up = await fakeUpstream((call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
      const done = answered(call.body);
      const reply = (/** @type {any[]} */ blocks) => anthropicReply("", { model: "m-1", stop: "tool_use", blocks });
      if (!done.has("w1")) return reply([use("w1", "write", { path: "notes.md", content: "one\ntwo\n" })]);
      if (!done.has("e1")) return reply([use("r1", "read", { path: "notes.md" }), use("e1", "edit", { path: "notes.md", edits: [{ oldText: "two", newText: "TWO" }] })]);
      if (!done.has("e2")) return reply([use("e2", "edit", { path: "notes.md", edits: [{ oldText: "absent", newText: "x" }] })]);
      return anthropicReply("Done.", { model: "m-1" });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    sid = String((await made.json()).id);
    const turn = await shim.api(`/api/sessions/${sid}/turns`, { method: "POST", body: { content: "write the notes", stream: false } });
    assert.equal(turn.status, 200, await turn.clone().text());
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(root);
  });
  const change = async (/** @type {string} */ call, n = 1) => {
    const r = await shim.api(`/api/sessions/${sid}/turns/${n}/calls/${call}/change`);
    return { status: r.status, json: await r.json() };
  };

  // (fails before: yes — the route did not exist; the card of a file outside git had nothing to open)
  test("the write and the edit each answer the change their call made, the file being in no git place", async () => {
    assert.equal(readFileSync(join(root, "notes.md"), "utf8"), "one\nTWO\n", "the loop ran both");
    const w = await change("w1");
    assert.deepEqual([w.status, w.json.n, w.json.id, w.json.file, w.json.wrote, w.json.added, rows(w.json.patch)], [200, 1, "w1", "notes.md", true, 2, ["@@ -0,0 +1,2 @@", "+one", "+two"]]);
    const e = await change("e1");
    assert.deepEqual([e.status, e.json.wrote, e.json.added, e.json.removed, rows(e.json.patch)], [200, false, 1, 1, ["@@ -1,1 +1,1 @@", "-two", "+TWO"]]);
  });

  // (fails before: yes)
  test("a call the turn holds that is no change, one it does not hold, and a turn it does not have: 404 in words, with why", async () => {
    const read = await change("r1");
    assert.deepEqual([read.status, read.json.why], [404, "absent"], "a read is no change of a file");
    const none = await change("nope");
    assert.deepEqual([none.status, none.json.why, none.json.error], [404, "absent", "the turn's record does not hold this call"]);
    const turn = await change("w1", 9);
    assert.deepEqual([turn.status, turn.json.error], [404, "no such turn"]);
    const gone = await shim.api(`/api/sessions/nope/turns/1/calls/w1/change`);
    assert.equal(gone.status, 404);
  });
});

describe("the card's read on the page", () => {
  /** @type {any} */ let real;
  before(() => {
    stubDocument();
    real = globalThis.fetch;
  });
  after(() => {
    globalThis.fetch = real;
  });
  /** A fetch that answers the snapshot route with `rounds` and the call's route with `call`, and keeps what was asked.
   *  @param {any[]} rounds @param {{ ok: boolean, status?: number, json: any }} call */
  const serve = (rounds, call) => {
    /** @type {string[]} */
    const asked = [];
    globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url) => {
      asked.push(String(url));
      const r = String(url).includes("/calls/") ? call : { ok: true, status: 200, json: { rounds } };
      return { ok: r.ok, status: r.status ?? 200, json: async () => r.json };
    });
    return asked;
  };

  // (fails before: yes — a card with no run drew no body, and one whose run's snapshots held nothing of its file
  // drew an empty one)
  test("no run, or a snapshot that holds nothing of the file: the call's own change, its counts on the chip", async () => {
    const { inlineEditDiff } = await import("../src/ui/harness/lib/diff-render.js");
    const asked = serve([{ round: 1, files: [{ path: "other.js", added: 1, removed: 0, patch: "" }] }], { ok: true, json: { patch: "--- n.md\n+++ n.md\n@@ -1,1 +1,1 @@\n-a\n+b\n", added: 1, removed: 1, wrote: false, every: false, omitted: 0 } });
    /** @type {number[][]} */
    const seen = [];
    const el = /** @type {any} */ (await inlineEditDiff("run-e22", "n.md", { round: 1, call: { chain: "c1", n: 3, id: "e1" }, onCounts: (p, m) => seen.push([p, m]) }));
    assert.deepEqual(asked, ["/api/runs/run-e22/changes?patch=1&path=n.md&round=1", "/api/sessions/c1/turns/3/calls/e1/change"]);
    assert.deepEqual(seen, [[1, 1]]);
    assert.ok(el?.className === "inline-diff", "the change, drawn");
    const none = /** @type {any} */ (await inlineEditDiff(null, "n.md", { call: { chain: "c1", n: 3, id: "e2" } }));
    assert.equal(asked.at(-1), "/api/sessions/c1/turns/3/calls/e2/change", "no run: the call's own, asked at once");
    assert.ok(none?.className === "inline-diff");
  });

  // (fails before: yes)
  test("git's snapshot first: a card whose snapshot holds the file never asks its call", async () => {
    const { inlineEditDiff } = await import("../src/ui/harness/lib/diff-render.js");
    const asked = serve([{ round: 2, files: [{ path: "g.js", added: 4, removed: 0, patch: "" }] }], { ok: true, json: {} });
    const el = /** @type {any} */ (await inlineEditDiff("run-git", "g.js", { round: 2, call: { chain: "c1", n: 4, id: "g1" } }));
    assert.equal(el?.textContent, "No patch recorded for this file.");
    assert.ok(asked.every((u) => !u.includes("/calls/")), asked.join(", "));
  });

  // (fails before: yes)
  test("a write shows no count and says what is not kept; where nothing can be drawn the card says why, and asks again only for a turn that runs", async () => {
    const { inlineEditDiff } = await import("../src/ui/harness/lib/diff-render.js");
    serve([], { ok: true, json: { patch: "--- /dev/null\n+++ w.md\n@@ -0,0 +1,1 @@\n+hi\n", added: 1, removed: 0, wrote: true, every: false, omitted: 0 } });
    /** @type {number[][]} */
    const seen = [];
    const w = /** @type {any} */ (await inlineEditDiff(null, "w.md", { call: { chain: "c2", n: 1, id: "w" }, onCounts: (p, m) => seen.push([p, m]) }));
    assert.deepEqual(seen, [], "no count for a write (FO-D5)");
    assert.match(String(w?.textContent), /The text the call wrote: what the file held before is not kept\./);
    const said = async (/** @type {any} */ json, /** @type {string} */ id) => {
      const asked = serve([], { ok: false, status: 404, json });
      const one = /** @type {any} */ (await inlineEditDiff(null, "x.md", { call: { chain: "c2", n: 1, id } }));
      const two = /** @type {any} */ (await inlineEditDiff(null, "x.md", { call: { chain: "c2", n: 1, id } }));
      return [one?.textContent, two?.textContent === one?.textContent, asked.length];
    };
    assert.deepEqual(await said({ why: "none" }, "codex"), ["This call's record holds no change: its agent named the file alone.", true, 1], "kept: asked once");
    assert.deepEqual(await said({ why: "absent" }, "helper"), ["This call is not in the turn's record: a helper's call is kept with the helper.", true, 1]);
    assert.deepEqual(await said({ why: "later" }, "live"), ["Not in the turn's record yet: it shows once the turn has written it.", true, 2], "a running turn's: asked again");
    serve([], { ok: true, json: { patch: "", added: 0, removed: 0, wrote: true } });
    const empty = /** @type {any} */ (await inlineEditDiff(null, "e.md", { call: { chain: "c2", n: 1, id: "empty" } }));
    assert.equal(empty?.textContent, "The call wrote an empty file.");
  });

  // (fails before: yes — a card's body was its run's snapshot alone, and a failed edit opened on an empty slot)
  test("the card asks its call's change only for a call that ran; a failed one opens on why", () => {
    const render = readFileSync("src/ui/harness/conversation/tools/render.js", "utf8");
    // Another machine's call (a mirrored thread's, `there`, x22) asks this machine for nothing.
    assert.match(render, /const there = o\.turnAt\?\.there \|\| null;\n\s+const call = !there && t\.state === "done" && o\.turnAt && t\.id != null && !t\.idless \? \{ chain: o\.turnAt\.chain, n: o\.turnAt\.n, \.\.\.\(o\.turnAt\.agent \? \{ agent: o\.turnAt\.agent \} : \{\}\), id: String\(t\.id\) \} : null;/);
    assert.match(render, /if \(!running && t\.state !== "done" && t\.preview\) body = previewBody\(t\);\n\s*else if \(!running && there && \(subj \?\? a\.path\)\) body = h\("p", \{ class: "pane-note" \}, `The change is in the file on \$\{there\.name\}: its chat there shows it\.`\);\n\s*else if \(!running && \(o\.runId \|\| call\) && \(subj \?\? a\.path\)\) \{/);
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.match(timeline, /archivedRows\(p\.tools, \{ key: `\$\{turn\.turnId \?\? turn\.n\}-\$\{i\}`, turnAt: turnAtOf\(turn\) \}\)/, "a turn read from the archive alone");
    assert.match(timeline, /cardsEl\(cell, \{ live, lead: turn\.engine\?\.kind === "team", runId: turn\.runId, works: live && !waitsForYou\(turn\), turnAt,/, "a turn drawn from its run");
  });
});

// The memory note's data: what memory's briefing told the agent of the project's latest chats, and only that.
// (The owner's word of 10-27: "i don't know the purpose of it … not sure what does that memory contain at all".)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryBrain } from "../src/services/memory/brain.js";
import { Archive } from "../src/services/memory/archive.js";

const dir = mkdtempSync(join(tmpdir(), "memory-note-"));
/** @type {any[]} */
const opened = [];
after(() => {
  for (const a of opened) a.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Three earlier chats in one folder, each with a long summary, and a new one; a user's rule, so the briefing has a line. */
const world = (/** @type {string} */ name) => {
  const archive = /** @type {any} */ (new Archive({ file: join(dir, `${name}.db`) }));
  opened.push(archive);
  const long = "x".repeat(400);
  for (const i of [1, 2, 3]) {
    const c = archive.chainForKey(`${name}-k${i}`, { cwd: "C:/p" });
    archive.setTitle(c.id, `chat ${i}`);
    archive.setState(c.id, { summary: `summary ${i} ${long}`, open: [long, long, long] });
  }
  const me = archive.chainForKey(`${name}-k0`, { cwd: "C:/p" });
  archive.items.add({ projectId: me.project_id, kind: "rule", text: "Never push without the owner's word.", status: "confirmed", importance: 0.9 });
  const brief = (/** @type {number} */ briefingTokens) =>
    new MemoryBrain({ archive, getConfig: () => ({ enabled: true, autopilot: { briefingTokens } }) }).buildBriefing({
      chain: archive.getChain(me.id),
      sit: { project: { id: me.project_id, name: "p", cwd: "C:/p" }, newest: "hello there", key: `${name}-k0` },
      signals: { entities: [] },
    });
  return { brief };
};

test("the note's chats carry the day the briefing gave them, and how many memories it named — counts, never words", async () => {
  // Room for its three chats beside the header and the tools' line, which count in the budget since the memory plan's d2.
  const out = await world("roomy").brief(2400);
  const sessions = out.cue?.sessions || [];
  assert.equal(sessions.length, 3);
  for (const s of sessions) {
    assert.match(String(s.date), /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(out.text.includes(`- session ${s.id} "${s.title}" — ${s.date} — summary`), `as the briefing says it: ${s.id}`);
  }
  assert.equal(out.cue?.told, out.ids.length, "every memory the briefing named");
  assert.ok(out.cue.told >= 1, "the user's rule at least");
  assert.ok(!JSON.stringify(out.cue).includes("summary ") && !JSON.stringify(out.cue).includes("Never push"), "the record never quotes: " + JSON.stringify(out.cue));
});

// (fails before: yes — the live drive of 10-27: a new chat's note, opened, showed three empty rows — the briefing had
// quoted three past turns, whose cards carry where they were said and no text)
test("opened, the note words each memory as the Memory pane does: a quote by where it was said, never an empty row", async () => {
  const { claimWords } = await import("../src/ui/lib/claims.js");
  assert.equal(claimWords({ id: "s:k1:1", kind: "words", session: "k1", turn: 1, title: "Fix CI" }), "Words from “Fix CI”, turn 1");
  assert.equal(claimWords({ id: "s:k2:3", kind: "words", session: "k2", turn: 3 }), "Words from a past session, turn 3");
  assert.equal(claimWords({ id: "i4", kind: "rule", text: "Never push." }), "Never push.");
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
  assert.match(src, /\.includes\("briefing"\)\)\.map\(claimWords\)/, "the note's memories are worded by the one function");
});

// (fails before: yes — the Designer's reading of brain.js: a chat was put on the note before the briefing's budget was
// checked, so a briefing too full for its chats still named them on the note, and "briefed the agent" would be false)
// Since 10-29 a row that does not fit whole is told short and the rest left out (the owner's: three that did not fit
// together left none), so the smallest briefing tells some of the three, never all.
test("a chat the briefing had no room for is not on the note", async () => {
  const out = await world("tight").brief(300);
  const told = out.text.split("\n").filter((l) => l.startsWith("- session "));
  assert.ok(told.length < 3, `the briefing had no room for them all: ${out.text}`);
  assert.deepEqual(
    (out.cue?.sessions || []).map((/** @type {any} */ s) => s.id),
    told.map((l) => l.split(" ")[2]),
    "and the note names the ones it told, none of the others",
  );
  // (fails before: yes — the bug hunt of 10-27: the note waited for chats or recalled claims, so a briefing of the
  // user's rules alone drew none) The rule it named is still told.
  assert.ok(out.cue, "a briefing that named a memory has a note");
  assert.equal(out.cue.told, out.ids.length);
  assert.ok(out.cue.told >= 1);
});

// (fails before: yes — the bug hunt of 10-27: the cue named an untitled chat by its first words, which the briefing
// refuses to serve; the record counts and never quotes)
test("an untitled chat rides the record by its id alone, never its first words", async () => {
  const archive = /** @type {any} */ (new Archive({ file: join(dir, "untitled.db") }));
  opened.push(archive);
  const old = archive.chainForKey("u-k1", { cwd: "C:/u" });
  archive.db.prepare("UPDATE chains SET preview = ? WHERE id = ?").run("rename the billing tables", old.id);
  archive.setState(old.id, { summary: "short" });
  const me = archive.chainForKey("u-k0", { cwd: "C:/u" });
  const out = await new MemoryBrain({ archive, getConfig: () => ({ enabled: true, autopilot: { briefingTokens: 1200 } }) }).buildBriefing({
    chain: archive.getChain(me.id), sit: { project: { id: me.project_id, name: "u", cwd: "C:/u" }, newest: "hello", key: "u-k0" }, signals: { entities: [] },
  });
  const row = (out.cue?.sessions || []).find((/** @type {any} */ s) => s.id === old.id);
  assert.ok(row, JSON.stringify(out.cue));
  assert.equal(row.title, "", "no title: none on the record");
  assert.ok(!JSON.stringify(out.cue).includes("rename the billing"), JSON.stringify(out.cue));
});

// (fails before: yes — the bug hunt of 10-27: the briefing named the chats this one continues, the note did not)
test("the chats a session continues are on the note, marked so, when the briefing named them", async () => {
  const archive = /** @type {any} */ (new Archive({ file: join(dir, "arc.db") }));
  opened.push(archive);
  const parent = archive.chainForKey("a-k1", { cwd: "C:/a" });
  archive.setTitle(parent.id, "the parent");
  const me = archive.chainForKey("a-k0", { cwd: "C:/a" });
  archive.setParent(me.id, parent.id);
  archive.items.add({ projectId: me.project_id, kind: "rule", text: "Never push without the owner's word.", status: "confirmed", importance: 0.9 });
  const out = await new MemoryBrain({ archive, getConfig: () => ({ enabled: true, autopilot: { briefingTokens: 1200 } }) }).buildBriefing({
    chain: archive.getChain(me.id), sit: { project: { id: me.project_id, name: "a", cwd: "C:/a" }, newest: "hello", key: "a-k0" }, signals: { entities: [] },
  });
  assert.ok(out.text.includes("This session continues an effort"), out.text);
  const row = (out.cue?.sessions || []).find((/** @type {any} */ s) => s.id === parent.id);
  assert.deepEqual(row && { title: row.title, continues: row.continues }, { title: "the parent", continues: true }, JSON.stringify(out.cue));
});


// @ts-check
// The lines a made skill holds from memory (the owner's word of 10-27 on the skills questions: a memory added to a skill
// says so on its History, and writing the skill again keeps its words). Add to a skill… sends the memory, the section
// and the lines with its write; Filament notes them beside the skill and on the memory's History. When the crafter writes
// the SKILL.md again, the lines that still stood in it are put back where the new draft dropped them.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keepFromMemory, noteFromMemory, fromMemoryOf } from "../src/app/skill-from-memory.js";
import { withLines, holdsLines } from "../src/core/skill-sections.js";
import { eventWords } from "../src/ui/lib/claims.js";
import { startApp } from "./helpers/app.js";

const BEFORE = "---\nname: release\n---\n\n# Release\n\n## Rules\n\n- Run the full suite.\n- Tag only from main.\n\n## How to work\n\n### How to cut a release\n1. Bump.\n2. Tag.\n";
const DRAFT = "---\nname: release\ndescription: Releases\n---\n\n# Release\n\n## Rules\n\n- Run the full suite before a tag.\n\n## Where to look\n\n- docs/RELEASE.md\n";

describe("kept from memory", () => {
  /** @type {string} */
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-from-memory-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  // (fails before: yes — the crafter's draft replaced the SKILL.md whole, and the lines from memory went with it)
  test("a new draft gets back the lines from memory it dropped, under their section; one taken out by hand since is not put back", () => {
    noteFromMemory(dir, { memory: "i12", section: "Rules", lines: ["- Tag only from main."] }, 1);
    noteFromMemory(dir, { memory: "i30", section: "How to work", lines: ["### How to cut a release", "1. Bump.", "2. Tag."] }, 2);
    noteFromMemory(dir, { memory: "i40", section: "Facts", lines: ["- Taken out by hand."] }, 3);
    noteFromMemory(dir, { memory: "i12", section: "Rules", lines: ["- Tag only from main."] }, 4);
    assert.deepEqual(fromMemoryOf(dir).map((r) => r.memory), ["i30", "i40", "i12"], "the same lines once, the newest note kept");
    const got = keepFromMemory(dir, BEFORE, DRAFT);
    assert.equal(got.kept, 2);
    assert.ok(holdsLines(got.text, ["- Run the full suite before a tag.", "- Tag only from main."]), "the rule beside the model's own");
    assert.match(got.text, /## Rules\n\n- Run the full suite before a tag\.\n- Tag only from main\.\n\n## Where to look/);
    assert.match(got.text, /## How to work\n\n### How to cut a release\n1\. Bump\.\n2\. Tag\.\n$/, "a section the draft has not is made at its end");
    assert.ok(!got.text.includes("Taken out by hand"), "not in the SKILL.md before: not put back");
    assert.deepEqual(keepFromMemory(dir, BEFORE, got.text), { text: got.text, kept: 0 }, "a draft that holds them is left as it is");
  });

  test("a section's lines added at its end, its line ends kept; said already, the text as it was", () => {
    const crlf = BEFORE.replace(/\n/g, "\r\n");
    const got = withLines(crlf, "rules", ["- Never push on Friday."]);
    assert.ok(got.text.includes("- Tag only from main.\r\n- Never push on Friday.\r\n"));
    assert.deepEqual(withLines(BEFORE, "Rules", ["- Tag only from main."]), { text: BEFORE, already: true });
  });
});

describe("Add to a skill through Filament", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  before(async () => {
    shim = await startApp({ memory: true });
  });
  after(async () => {
    await shim.stop();
  });

  // (fails before: yes — the write took no `from`: the memory's History said nothing, and nothing was noted)
  test("the write that carries a memory's words notes them beside the skill and on the memory's History", async () => {
    const made = await shim.api("/api/skills", { method: "POST", body: { make: "release", description: "Releases" } });
    assert.equal(made.status, 200, await made.clone().text());
    const a = shim.app.memory.archive;
    assert.ok(a, "memory's archive is open");
    const item = a.items.add({ projectId: null, kind: "rule", text: "Tag only from main.", status: "confirmed", importance: 0.8, origin: "owner" });
    const put = await shim.api("/api/skills/release/file", { method: "PUT", body: { path: "SKILL.md", text: BEFORE, from: { memory: `i${item.id}`, section: "Rules", lines: ["- Tag only from main."] } } });
    assert.equal(put.status, 200, await put.clone().text());
    assert.equal((await put.json()).noted, true);
    const h = await (await shim.api(`/api/memory/items/${item.id}/history`)).json();
    const ev = (h.events || []).find((/** @type {any} */ e) => e.action === "skill");
    assert.ok(ev, JSON.stringify(h.events));
    assert.equal(eventWords(ev), "Added to the skill release, under Rules by you");
    const skill = await (await shim.api("/api/skills/release")).json();
    assert.deepEqual(fromMemoryOf(skill.path).map((r) => [r.memory, r.section, r.lines]), [[`i${item.id}`, "Rules", ["- Tag only from main."]]]);
    const bad = await shim.api("/api/skills/release/file", { method: "PUT", body: { path: "SKILL.md", text: BEFORE, from: { memory: "i1" } } });
    assert.equal(bad.status, 400);
  });
});

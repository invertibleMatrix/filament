// HarnessV2 Phase 1 — identity: the one project-id rule, the v4 migration (kinds, previews, the project merge), the
// chain kinds, the one-statement session list and the harness's project rows.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive, CHAIN_KINDS, PREVIEW_CHARS } from "../src/services/memory/archive.js";
import { normalizeCwd, projectIdOf, projectNameOf, NO_PROJECT_ID } from "../src/core/project-id.js";

const dir = mkdtempSync(join(tmpdir(), "filament-identity-"));
let seq = 0;
const opened = [];
let clock = 1_758_000_000_000;
const now = () => (clock += 1000);
const open = (opts = {}) => {
  const a = new Archive({ file: opts.file || join(dir, `a${++seq}.db`), now, ...opts });
  opened.push(a);
  return a;
};
after(() => {
  for (const a of opened) a.close();
  rmSync(dir, { recursive: true, force: true });
});
const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
const final = (text) => ({ role: "assistant", content: [{ type: "text", text }] });
function turn(a, chainId, text, answer) {
  const { turnId } = a.beginTurn(chainId, { requestId: `r${++seq}`, model: "m", upstream: "u", userMessage: user(text) });
  a.finishTurn(turnId, { finalMessage: final(answer), requestId: `r${seq}c` });
  return turnId;
}

test("project-id: one folder, one id, whatever the spelling; no folder is 'none'", () => {
  const spellings = ["H:\\filament", "h:\\filament", "H:/filament", "H:/filament/", "h:/FILAMENT\\", "  H:\\filament  "];
  const ids = new Set(spellings.map(projectIdOf));
  assert.equal(ids.size, 1, "every spelling of the folder derives the same id");
  assert.match([...ids][0], /^[0-9a-f]{12}$/);
  assert.equal(normalizeCwd("H:\\Northwind\\tiny-quest\\"), "h:/northwind/tiny-quest");
  assert.notEqual(projectIdOf("H:\\filament"), projectIdOf("H:Filament"), "a typo is a different folder, not a guess");
  assert.equal(projectIdOf(""), NO_PROJECT_ID);
  assert.equal(projectIdOf(null), NO_PROJECT_ID);
  assert.equal(projectNameOf("H:\\Northwind\\tiny-quest\\"), "tiny-quest");
  assert.equal(projectNameOf("/srv/app/"), "app");
  assert.equal(projectNameOf("test"), "test");
  assert.equal(projectNameOf(""), "");
});

test("chainForKey derives the project under the one rule, keeps the folder's spelling for the name, and types the chain", () => {
  const a = open();
  const c1 = a.chainForKey("k1", { cwd: "H:\\Northwind\\tiny-quest", client: "opencode" });
  const c2 = a.chainForKey("k2", { cwd: "h:/northwind/tiny-quest/", client: "harness" });
  assert.equal(c1.project_id, c2.project_id, "the importer's spelling and the live one land in the same project");
  assert.equal(c1.project_id, projectIdOf("H:\\Northwind\\tiny-quest"));
  assert.equal(a.getProject(c1.project_id).name, "tiny-quest");
  assert.equal(c1.kind, "interactive");
  assert.equal(a.chainForKey("k3", { cwd: "H:\\x", kind: "subagent" }).kind, "subagent");
  assert.throws(() => a.chainForKey("k4", { cwd: "H:\\x", kind: "weird" }), /unknown chain kind/);
  assert.ok(a.setChainKind(c1.id, "tick"));
  assert.equal(a.getChain(c1.id).kind, "tick");
  assert.throws(() => a.setChainKind(c1.id, "nope"), /unknown chain kind/);
  assert.equal(a.setChainKind("missing", "fork"), false);
  assert.deepEqual([...CHAIN_KINDS], ["interactive", "fork", "tick", "subagent", "mcp", "team"]);
  assert.equal(a.chainForKey("mcp:0123", { cwd: "H:\\x", kind: "mcp" }).kind, "mcp", "an outside agent's MCP session (HarnessV3-Memory M7-D40)");
  // settings: a document per chain, replaced whole, cleared with null
  assert.deepEqual(a.chainSettings(c1.id), {});
  assert.ok(a.setChainSettings(c1.id, { context: { strategy: "plain" } }));
  assert.deepEqual(a.chainSettings(c1.id), { context: { strategy: "plain" } });
  assert.deepEqual(a.getChain(c1.id).settings, { context: { strategy: "plain" } });
  assert.ok(a.setChainSettings(c1.id, null));
  assert.equal(a.getChain(c1.id).settings, null);
  assert.equal(a.setChainSettings("missing", {}), false);
});

// (fails before: yes — a request that brought an id and no folder renamed the project to the bare id)
test("a request with only the project id keeps the folder's name; the id stands in only until a folder is seen", () => {
  const a = open();
  const c = a.chainForKey("k1", { cwd: "H:\\Northwind\\tiny-quest" });
  a.chainForKey("k2", { project: c.project_id });
  assert.equal(a.getProject(c.project_id).name, "tiny-quest", "an id alone never renames the project");
  assert.equal(a.getProject(c.project_id).cwd, "H:\\Northwind\\tiny-quest", "nor forgets its folder");
  a.chainForKey("k3", { project: "p-bare" });
  assert.equal(a.getProject("p-bare").name, "p-bare", "no folder seen yet: the id stands in");
  a.chainForKey("k4", { project: "p-bare", cwd: "H:\\later\\found" });
  assert.equal(a.getProject("p-bare").name, "found", "the first folder names it");
});

// (fails before: yes — found walking a Space of your own, 10-29: its project is named for the Space, and the first chat
// started in its folder named it for the folder again; the Space's page then said "own", not "Northwind")
test("a name given to a project stays when a chat starts in its folder; a name its folder gave follows the folder's spelling", () => {
  const a = open();
  const c = a.chainForKey("k1", { cwd: "H:\\Spaces\\own" });
  assert.ok(a.setProjectName(c.project_id, "Northwind"));
  a.chainForKey("k2", { cwd: "H:\\Spaces\\own" });
  assert.equal(a.getProject(c.project_id).name, "Northwind");
  a.chainForKey("k3", { cwd: "h:/spaces/OWN" });
  assert.equal(a.getProject(c.project_id).name, "Northwind", "however the folder is spelled");
  const d = a.chainForKey("k4", { cwd: "H:\\Work\\app" });
  a.chainForKey("k5", { cwd: "h:/work/App" });
  assert.equal(a.getProject(d.project_id).name, "App", "the folder's name, in the spelling seen last");
});

test("beginTurn writes the preview once, at the first turn, only where the index is on", () => {
  const a = open();
  const c = a.chainForKey("k1", { cwd: "H:\\p" });
  turn(a, c.id, "  first   question\nabout   things  " + "x".repeat(200), "answer");
  const p = a.getChain(c.id).preview;
  assert.ok(p.startsWith("first question about things"), "whitespace is squashed");
  assert.equal(p.length, PREVIEW_CHARS + 1, "clipped to the preview length plus the ellipsis");
  turn(a, c.id, "second question", "answer 2");
  assert.equal(a.getChain(c.id).preview, p, "the second turn does not move the preview");
  const quiet = open({ index: false });
  const q = quiet.chainForKey("k1", { cwd: "H:\\p" });
  turn(quiet, q.id, "private text", "a");
  assert.equal(quiet.getChain(q.id).preview, null, "no plaintext preview when the search index is off");
});

test("forkChain types the fork and hands it the source's preview and settings", () => {
  const a = open();
  const c = a.chainForKey("k1", { cwd: "H:\\p" });
  a.setChainSettings(c.id, { memory: { enabled: false } });
  turn(a, c.id, "hello there", "hi");
  turn(a, c.id, "more", "ok");
  const f = a.forkChain(c.id, { atTurn: 1, key: "fork-key" });
  assert.equal(f.kind, "fork");
  assert.equal(f.preview, a.getChain(c.id).preview);
  assert.deepEqual(f.settings, { memory: { enabled: false } });
});

test("listChains: one statement — kinds, project, client, archived, a search's ids in their order", () => {
  const a = open();
  const p = a.chainForKey("i1", { cwd: "H:\\p", client: "harness" });
  a.chainForKey("i2", { cwd: "H:\\p", client: "opencode" });
  const t = a.chainForKey("t1", { cwd: "H:\\p", client: "opencode", kind: "tick" });
  a.chainForKey("s1", { cwd: "H:\\p", client: "opencode", kind: "subagent" });
  const f = a.chainForKey("f1", { cwd: "H:\\p", client: "harness", kind: "fork" });
  const other = a.chainForKey("o1", { cwd: "H:\\q", client: "harness" });
  a.mergeMeta(other.id, { archived: true });
  a.chainForKey("i2", {}); // touch → newest
  const ids = (rows) => rows.map((c) => c.id);
  const all = a.listChains({ archived: "all" });
  assert.equal(all.length, 6);
  assert.equal(all[0].key, "i2", "newest first");
  assert.equal(all[0].projectName, "p");
  assert.equal(all[0].projectCwd, "H:\\p");
  assert.deepEqual(new Set(ids(a.listChains({ kinds: ["interactive", "fork"], archived: "all" }))), new Set([p.id, a.chainIdForKey("i2"), f.id, other.id]));
  assert.deepEqual(ids(a.listChains({ kinds: ["tick"] })), [t.id]);
  assert.deepEqual(ids(a.listChains({ archived: "only" })), [other.id]);
  assert.equal(a.listChains({ archived: "exclude" }).some((c) => c.id === other.id), false);
  assert.deepEqual(new Set(ids(a.listChains({ client: "harness", archived: "all" }))), new Set([p.id, f.id, other.id]));
  assert.deepEqual(ids(a.listChains({ project: other.project_id, archived: "all" })), [other.id]);
  assert.deepEqual(ids(a.listChains({ ids: [f.id, p.id], archived: "all" })), [f.id, p.id], "a search's order is kept");
  assert.deepEqual(a.listChains({ ids: [] }), []);
  assert.equal(a.listChains({ archived: "all", limit: 2 }).length, 2);
});

// (fails before: yes — the bug hunt of 10-30, UIST-3: the list read from its newest row alone, so a chat past the first page was in no read, and Settings' auto-archive never reached the oldest)
test("listChains: an offset skips the rows a list read a page at a time has had, in its order and a search's", () => {
  const a = open();
  const made = ["p1", "p2", "p3", "p4", "p5"].map((k) => a.chainForKey(k, { cwd: "H:\\paged" }));
  const ids = (rows) => rows.map((c) => c.id);
  const newest = ids(a.listChains({}));
  assert.equal(newest.length, 5);
  assert.deepEqual(ids(a.listChains({ limit: 2, offset: 0 })), newest.slice(0, 2));
  assert.deepEqual(ids(a.listChains({ limit: 2, offset: 2 })), newest.slice(2, 4));
  assert.deepEqual(ids(a.listChains({ limit: 2, offset: 4 })), newest.slice(4));
  assert.deepEqual(a.listChains({ limit: 2, offset: 5 }), []);
  const asked = [made[3].id, made[0].id, made[4].id];
  assert.deepEqual(ids(a.listChains({ ids: asked, limit: 1, offset: 1 })), [made[0].id], "a search's rows in its order");
  assert.deepEqual(ids(a.listChains({ ids: asked, limit: 5, offset: 2 })), [made[4].id]);
  assert.deepEqual(ids(a.listChains({ limit: 2, offset: -3 })), newest.slice(0, 2), "no offset below the first row");
});

test("projects(): the harness's rows — ensureProject under the rule, the archived flag, the dossier's version", () => {
  const a = open();
  const row = a.ensureProject("H:\\New\\Thing\\");
  assert.equal(row.id, projectIdOf("H:\\New\\Thing"));
  assert.equal(row.name, "Thing");
  assert.equal(row.cwd, "H:\\New\\Thing");
  const again = a.ensureProject("h:/new/thing");
  assert.equal(again.id, row.id);
  assert.equal(again.cwd, "H:\\New\\Thing", "the first spelling stays");
  assert.throws(() => a.ensureProject(""), /folder is required/);
  const fresh = a.projects().find((p) => p.id === row.id);
  assert.deepEqual([fresh.dossier, fresh.archived, "settings_json" in fresh, "canon" in fresh], [null, false, false, false]);
  assert.ok(fresh.last_seen >= fresh.first_seen && fresh.first_seen > 0, "when it was last seen: the console's Last activity reads it");
  const v1 = a.dossiers.add({ projectId: row.id, sections: [], cites: [], basis: "a" });
  const v2 = a.dossiers.add({ projectId: row.id, sections: [], cites: [], basis: "b" });
  assert.equal(a.projects().find((p) => p.id === row.id).dossier, 2);
  a.dossiers.undone(v2.id);
  assert.equal(a.projects().find((p) => p.id === row.id).dossier, v1.version, "an undone version is not the project's");
  assert.ok(a.setProjectArchived(row.id, true));
  assert.equal(a.projects().find((p) => p.id === row.id).archived, true);
  assert.deepEqual(a.projectSettings(row.id), { display: { archived: true } }, "the flag rides in the settings document's display section");
  assert.ok(a.setProjectArchived(row.id, false));
  assert.deepEqual(a.projectSettings(row.id), {});
  assert.equal(a.setProjectArchived("missing", true), false);
});

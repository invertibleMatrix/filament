// @ts-check
// Every gated call asks whether a confirmed permission of its project covers its shape (services/memory/permissions.js
// `allowedBy`): the project's permission items were listed, up to 500, and matched one by one, on every call. Most
// calls have none of their shape: the archive's index on an item's words says so in one look, and only a shape that
// has one is matched as before.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/services/memory/archive.js";
import { createLearnedPermissions } from "../src/services/memory/permissions.js";

const dir = mkdtempSync(join(tmpdir(), "perm-lookup-"));
/** @type {any[]} */
const open = [];
after(() => {
  for (const a of open) a.close?.();
  rmSync(dir, { recursive: true, force: true });
});

// (fails before: yes — every call listed the project's permission items, whatever its shape)
test("a call with no permission of its shape lists nothing; one with a rule is matched as before", () => {
  const a = /** @type {any} */ (new Archive({ file: join(dir, "a.db") }));
  open.push(a);
  const p = "proj-1";
  for (let i = 0; i < 40; i++) a.items.add({ projectId: p, kind: "permission", text: `bash: tool${i} run`, status: "confirmed", origin: "person" });
  const kept = a.items.add({ projectId: p, kind: "permission", text: "bash: npm test", status: "confirmed", origin: "person" });
  a.items.add({ projectId: p, kind: "permission", text: "write: *.md", status: "dismissed", origin: "person" });
  a.items.add({ projectId: p, kind: "permission", text: "edit: *.js", status: "inferred", origin: "learner" });
  a.items.add({ projectId: "proj-2", kind: "permission", text: "bash: ls", status: "confirmed", origin: "person" });
  const realList = a.items.list;
  let lists = 0;
  a.items.list = (/** @type {any} */ o) => (lists++, realList(o));
  const learned = createLearnedPermissions({ archive: a });
  const allowed = (/** @type {string} */ tool, /** @type {any} */ input) => learned.allowedBy({ projectId: p, tool, input });
  assert.equal(allowed("bash", { command: "ls -la" }), null, "another project's rule is not this one's");
  assert.equal(allowed("bash", { command: "cargo build" }), null);
  assert.equal(allowed("write", { path: "README.md" }), null, "a dismissed one allows nothing");
  assert.equal(lists, 1, "only the dismissed one's shape was listed");
  assert.equal(allowed("bash", { command: "npm test -- --watch" })?.id, kept.id);
  assert.equal(allowed("bash", { command: "NPM TEST" })?.id, kept.id, "the shape is lower-cased as before");
  // What Always allow offers: none yet, an inferred one waiting, a dismissed one never again.
  const offered = (/** @type {string} */ tool, /** @type {any} */ input) => learned.offeredFor({ projectId: p, tool, input });
  lists = 0;
  assert.deepEqual(offered("bash", { command: "cargo build" }), { itemId: null, tool: "bash", shape: "cargo build" });
  assert.equal(lists, 0);
  assert.equal(offered("edit", { path: "a.js" })?.itemId, a.items.withText(p, "permission", "edit: *.js").id);
  assert.equal(offered("write", { path: "b.md" }), null);
  assert.equal(offered("bash", { command: "npm test" }), null, "confirmed: allowed already");
  // A yes counted to the threshold makes the item where there is none of its words, and none where there is one.
  const five = createLearnedPermissions({ archive: a, threshold: 1 });
  assert.equal(five.recordAllow({ projectId: p, tool: "bash", input: { command: "make all" } })?.offered?.text, "bash: make all");
  assert.equal(five.recordAllow({ projectId: p, tool: "bash", input: { command: "npm test" } })?.offered, null);
});

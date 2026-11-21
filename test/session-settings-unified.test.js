// HarnessV3 Step 1 — one settings document for every session. The proofs: the room Step 3 needs is left open (the
// source gate, the per-turn client stamp), a choice moves its own knob alone, and with no archive the refusal says why.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/services/memory/archive.js";
import { SessionPolicies } from "../src/services/memory/policy.js";
import { applyPatch, chosenDocument, readLayer, resolveSettings } from "../src/services/session-settings.js";
import { situate } from "../src/app/pipeline/stages/situate.js";
import { removeDirs } from "./helpers/wait.js";

const dir = mkdtempSync(join(tmpdir(), "filament-step1-"));
after(() => removeDirs(dir));

describe("the room Step 3 needs", () => {
  test("an outside client's request runs under only the knobs its session or project chose", () => {
    assert.equal(chosenDocument(null), null);
    assert.equal(chosenDocument(resolveSettings({ global: { loop: { permissions: "auto" } } })), null, "the global mirror is nobody's choice");
    const doc = chosenDocument(
      resolveSettings({
        global: { loop: { permissions: "auto" } },
        project: { instructions: { files: ["NOTES.md"] } },
        session: { context: { compaction: { model: "cheap-2" } } },
      }),
    );
    // Only the two chosen knobs: no sibling default rides along — no compaction threshold, no instruction session
    // text, no loop knob — so each consumer reads the config for those, as before the session had a document.
    assert.deepEqual(doc, { instructions: { files: ["NOTES.md"] }, context: { compaction: { model: "cheap-2" } } });
  });

  test("situate: an outside chain gets its chosen knobs, a composed request the session's whole document", async () => {
    const a = new Archive({ file: join(mkdtempSync(join(dir, "sit-")), "archive.db") });
    try {
      const outside = a.chainForKey("z:sit", { cwd: "C:\\demo", client: "opencode", model: "m" });
      a.setChainSettings(outside.id, { context: { compaction: { model: "cheap-2" } } });
      const bare = a.chainForKey("z:bare", { cwd: "C:\\demo", client: "opencode", model: "m" });
      const nat = a.chainForKey("n:sit", { cwd: "C:\\demo", client: "harness", model: "m" });
      a.mergeMeta(nat.id, { native: true });
      const trace = { steps: [], rebase() {}, mark() {}, toJSON() {} };
      const run = async ({ headers = {}, pre = null, found = null }) => {
        const memory = { trace: () => trace, situate: () => ({ client: "opencode" }), lookupChainId: () => found, archive: a, chainIdFor: () => found };
        const ctx = /** @type {any} */ ({ format: "anthropic", body: { model: "m", messages: [] }, pre, headers });
        await situate(ctx, /** @type {any} */ ({ memory, usage: { records: [] }, config: () => ({}) }));
        return ctx.memory.sit;
      };
      const out = await run({ found: outside.id });
      assert.equal(out.composed, false);
      assert.deepEqual(out.settings, { context: { compaction: { model: "cheap-2" } } }, "the chosen knob alone");
      assert.equal((await run({ found: bare.id })).settings, null, "a session that chose nothing runs on the config, as before");
      assert.equal((await run({})).settings, null, "nobody's session has no settings");
      // A loop tick riding the harness session by id runs under its whole document, as it always did.
      const tick = await run({ headers: { "x-filament-chain": nat.id } });
      assert.equal(tick.composed, true);
      assert.equal(tick.settings.loop.permissions, "edit", "every knob is stated, defaults included");
      assert.equal(tick.settings.context.compaction.thresholdPercent, 85);
      // A native turn brings its document resolved.
      const pre = { settings: { loop: { permissions: "auto" } } };
      assert.equal((await run({ pre })).settings, pre.settings);
    } finally {
      a.close?.();
    }
  });

  test("each turn records which client ran it; Filament's own writes carry none", () => {
    const a = new Archive({ file: join(mkdtempSync(join(dir, "d-")), "archive.db") });
    try {
      const ch = a.chainForKey("k", { cwd: "C:\\demo", client: "opencode", model: "m" });
      a.beginTurn(ch.id, { client: "opencode", userMessage: { role: "user", content: "hi" } });
      a.finishTurn(a.getTurns(ch.id).at(-1).id, { finalMessage: { role: "assistant", content: [{ type: "text", text: "ho" }] } });
      assert.equal(a.getTurns(ch.id).at(-1).meta?.client, "opencode");
    } finally {
      a.close?.();
    }
  });
});

describe("per knob, not per branch: a choice moves its own knob and nothing beside it", () => {
  test("a compaction model choice is that knob alone: no compaction threshold rides along", () => {
    const r = resolveSettings({ session: { context: { compaction: { model: "cheap-2" } } } });
    assert.deepEqual(chosenDocument(r), { context: { compaction: { model: "cheap-2" } } }, "no threshold rides along");
  });

  // (fails before: yes — the owner's of 11-09: display.notify and display.sound were knobs nothing read, read back from
  // every chat's layer that held them)
  test("a chat's stored layer that holds display.notify and display.sound loads: they name no knob, the rest of it stands", () => {
    const stored = { display: { notify: false, sound: true, pinned: true }, memory: { enabled: false } };
    assert.deepEqual(readLayer(stored, "session"), { "display.pinned": true, "memory.enabled": false });
    const r = resolveSettings({ session: stored });
    assert.deepEqual(r.effective.display, { pinned: true, title: null, archived: false, unread: false });
    assert.deepEqual([r.sources["display.pinned"], r.sources["memory.enabled"]], ["session", "session"]);
    // A change to such a chat is kept, as to any other.
    const out = applyPatch(stored, { patch: { display: { title: "Mine" } } }, { at: "session" });
    assert.deepEqual([out.errors, out.changes.map((c) => c.path)], [[], ["display.title"]]);
    assert.equal(resolveSettings({ session: out.layer }).effective.display.title, "Mine");
  });
});

// (fails before: yes — with no archive the policies said memory "has not started or its folder did not open (see the
// log)", whatever the service knew)
test("with no archive, a session's settings and goal are refused in the service's words", () => {
  const why = "H:/m/archive.db was written by another build of Filament (archive version 16; this build reads version 17). Run `npm run reset` for a clean slate.";
  const p = new SessionPolicies({ archive: () => null, archiveWhy: () => why, config: () => ({}), now: () => 0, enabled: () => true, summarizerModel: () => "" });
  for (const call of [() => p.patchSession("c1", { patch: {} }), () => p.setGoal("c1", "ship it")])
    assert.throws(call, (/** @type {any} */ e) => e.message === `no archive: ${why}`);
});

// BUG-28: an archive item and its engine twin are one memory. Forgetting it by the id a search shows (the engine's,
// for every mirrored item) only told the engine: the archive item stayed active and kept surfacing in search. And
// forgetting it by the item's own id left the engine's copy behind. Any of its ids now retires both. Since HarnessV3-Memory
// MD-1 nothing is deleted: the item is dismissed, with who and why, and the engine copy is invalidated, never forgotten.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryService } from "../src/memory-service.js";
import { MemoryEngine } from "../src/memory-engine.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-sidecar.mjs", import.meta.url));
let dir, svc, cfg, opsLog;
const PROJECT = "p-forget-twins";
/** The engine writes a verb queues go out through the outbox (HarnessV3-Memory M2-2); this waits for them. */
const settled = () => svc.brain.outbox.drain();

before(() => {
  dir = mkdtempSync(join(tmpdir(), "filament-forget-"));
  opsLog = join(dir, "sidecar-ops.jsonl");
  cfg = { server: { port: 20396, inboundKeys: ["k"] }, memory: { enabled: true, folder: join(dir, "memory"), engine: { embeddings: true, bank: "default" }, autopilot: { enabled: true, mode: "conservative", briefingTokens: 1200, turnTokens: 300, minScore: 0.2, tools: true, cue: true }, capture: { turns: true, learn: true }, commands: { enabled: true, prefix: "@mem" }, privacy: { encryptArchive: true }, models: { summarizer: "claude-haiku-4-5" } } };
  svc = new MemoryService({ getConfig: () => cfg, dataDir: dir, log: () => {}, selfBase: () => "http://127.0.0.1:20396" });
  svc.start();
  svc.store = new MemoryEngine({ command: process.execPath, args: [FAKE], env: { FAKE_SIDECAR_STATE: join(dir, "fake-state.json"), FAKE_SIDECAR_LOG: opsLog }, writeConfig: false });
  svc.brain.store = svc.store;
});
after(async () => {
  await svc.store?.stop?.();
  svc.stop();
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
});

/** The engine ids the fake sidecar was asked to act on with `op`, from its op log. */
const idsFor = (op) => {
  try {
    return readFileSync(opsLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((o) => o.op === op)
      .map((o) => String(o.args?.id));
  } catch {
    return [];
  }
};

test("forgetting by the engine id (what a search may show) retires the archive item too; its copy is invalidated, not deleted", async () => {
  const out = await svc.brain.remember("The staging box answers on port 8443 behind the corporate proxy.", { kind: "fact", projectId: PROJECT, by: "owner" });
  assert.equal(out.id, `i${out.itemId}`, "remember answers with the id a memory line shows");
  await settled();
  const engineId = svc.archive.items.get(out.itemId).memory_id;
  assert.ok(engineId, "the engine mirrored it");
  const r = await svc.brain.forget(engineId, { reason: "the box moved", by: "owner" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const it = svc.archive.items.get(out.itemId);
  assert.equal(it.status, "dismissed", "the archive item no longer stands");
  assert.equal(it.invalid_reason, "the box moved", "and says why");
  await settled();
  assert.ok(idsFor("invalidate").includes(engineId), "the engine copy is invalidated");
  assert.ok(!idsFor("forget").includes(engineId), "and never deleted");
  const rr = await svc.brain.retrieve({ query: "staging box port 8443 corporate proxy", projectId: PROJECT, mode: "search" });
  assert.ok(!rr.items.some((x) => x.id === out.id || x.id === `e:${engineId}`), JSON.stringify(rr.items.map((x) => x.id)));
});

test("forgetting by the item's id (i<n>) invalidates the engine's copy too", async () => {
  for (const [text, ref] of [
    ["Release builds are signed with the key in the team vault, never a local one.", (n) => `i${n}`],
  ]) {
    const out = await svc.brain.remember(text, { kind: "rule", projectId: PROJECT, by: "owner" });
    await settled();
    const engineId = svc.archive.items.get(out.itemId).memory_id;
    const r = await svc.brain.forget(ref(out.itemId), { by: "owner" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(svc.archive.items.get(out.itemId).status, "dismissed");
    await settled();
    assert.ok(idsFor("invalidate").includes(engineId), "the engine twin was invalidated");
    assert.ok(!idsFor("forget").includes(engineId), "and never deleted");
  }
});

test("an engine memory with no archive twin (imported) is adopted as an imported item and retired; an unknown id is said so", async () => {
  const mem = await svc.store.remember({ content: "Imported: the old CI ran on Jenkins.", source: "fact", importance: 0.5, metadata: { kind: "fact" } });
  const r = await svc.brain.forget(`e:${mem.id}`, { by: "owner" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const [adopted] = svc.archive.items.byMemoryId(mem.id);
  assert.ok(adopted, "the row has an item now");
  assert.equal(adopted.origin, "import");
  assert.equal(adopted.status, "dismissed");
  await settled();
  assert.ok(idsFor("invalidate").includes(String(mem.id)));
  assert.ok(!idsFor("forget").includes(String(mem.id)));
  const none = await svc.brain.forget("i987654", { by: "owner" });
  assert.equal(none.ok, false, "nothing by that id");
  assert.match(String(none.error), /no memory i987654/);
  const words = await svc.brain.forget("s:c_abc:3", { by: "owner" });
  assert.equal(words.ok, false, "a quote from a past session is not a stored memory");
});

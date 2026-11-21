// Memory's engine in any language (the memory plan's c2): the engine runs on the model its install warmed, a store
// whose vectors no record says that model made has them made again once (recall reading the archive alone meanwhile),
// and recall asks the engine by the person's own sentence for its rows nearest by meaning beside those sharing words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sidecarEnv } from "../src/adapters/sidecar/client.js";
import { engineState, EMBEDDING_MODEL } from "../src/memory-install.js";
import { world } from "./fixtures/memory-world.mjs";

const FAKE = fileURLToPath(new URL("./fixtures/fake-sidecar.mjs", import.meta.url));
const MULTI = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2";
const row = (id, content) => ({ id, content, source: "filament", importance: 0.6, scope: "global", veracity: "stated", timestamp: "2026-11-01T00:00:00Z" });
const reindexes = (/** @type {any} */ w) => w.ops().filter((/** @type {any} */ o) => o.op === "reindex").length;

test("the engine runs on the model its install warmed; none named, its own; embeddings off, none", () => {
  const base = { memoryFolder: "M", engineDir: "E" };
  assert.equal(sidecarEnv({ ...base, embeddingModel: MULTI }).MNEMOSYNE_EMBEDDING_MODEL, MULTI);
  assert.equal("MNEMOSYNE_EMBEDDING_MODEL" in sidecarEnv(base), false);
  const off = sidecarEnv({ ...base, embeddings: false, embeddingModel: MULTI });
  assert.equal(off.MNEMOSYNE_NO_EMBEDDINGS, "1");
  assert.equal("MNEMOSYNE_EMBEDDING_MODEL" in off, false);
  assert.equal(EMBEDDING_MODEL, MULTI, "this build's model is the multilingual one");
  const dataDir = mkdtempSync(join(tmpdir(), "filament-engine-"));
  try {
    mkdirSync(join(dataDir, "memory-engine"), { recursive: true });
    writeFileSync(join(dataDir, "memory-engine", "engine.json"), JSON.stringify({ installed: true, embeddingModel: MULTI }));
    assert.equal(engineState(dataDir).embeddingModel, MULTI);
    writeFileSync(join(dataDir, "memory-engine", "engine.json"), JSON.stringify({ installed: true }));
    assert.equal(engineState(dataDir).embeddingModel, "");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a store's vectors are made again once a model: none recorded, then another model; an empty store is recorded alone", async () => {
  await world({ engineRows: [row("m1", "Deploys go out on Thursdays."), row("m2", "Invoices go to accounting on Fridays.")] }, async (w) => {
    await w.svc.reembedEngine();
    assert.equal(reindexes(w), 1, "the store's two rows, made with no record of their model");
    assert.deepEqual({ ...w.svc.archive.schemaMetaGet("engineVectors"), at: 0 }, { model: "BAAI/bge-small-en-v1.5", rows: 2, at: 0 });
    await w.svc.reembedEngine();
    assert.equal(reindexes(w), 1, "recorded: not again for the same model");
    // A release's bundle changed the model: the restart's engine runs another one.
    const state = join(w.dir, "fake-state.json");
    const log = join(w.dir, "sidecar-ops.jsonl");
    process.env.FILAMENT_MEMORY_SIDECAR = JSON.stringify({ command: process.execPath, args: [FAKE], env: { FAKE_SIDECAR_STATE: state, FAKE_SIDECAR_LOG: log, MNEMOSYNE_EMBEDDING_MODEL: MULTI } });
    try {
      w.svc.start();
    } finally {
      delete process.env.FILAMENT_MEMORY_SIDECAR;
    }
    await w.svc.engineStart;
    await w.svc.reembedEngine();
    assert.equal(reindexes(w), 2);
    assert.equal(w.svc.archive.schemaMetaGet("engineVectors").model, MULTI);
  });
  await world({}, async (w) => {
    await w.svc.reembedEngine();
    assert.equal(reindexes(w), 0, "nothing to make again");
    assert.equal(w.svc.archive.schemaMetaGet("engineVectors").rows, 0);
  });
});

test("recall asks the engine by the person's sentence for its rows nearest by meaning, and leaves the engine out while its vectors are made again", async () => {
  await world({ engineRows: [row("m1", "Deploys go out on Thursdays after the standup.")] }, async (w) => {
    await w.svc.reembedEngine();
    const s = w.session("s1");
    const asked = "On which weekday do our deploys go out?";
    await s.send("Starting work on the release checklist for this week.");
    let before = w.ops().length;
    await s.send(asked);
    const dense = w.ops().slice(before).filter((/** @type {any} */ o) => o.op === "dense");
    assert.ok(dense.length >= 1, JSON.stringify(w.ops().slice(before).map((/** @type {any} */ o) => o.op)));
    assert.equal(dense[0].args.text, asked, "the sentence, not its keywords");
    assert.ok(w.ops().slice(before).some((/** @type {any} */ o) => o.op === "recall"), "the words' recall beside it");
    w.svc.brain.reembedding = true;
    before = w.ops().length;
    await s.send("Which weekday do deploys go out again?");
    assert.deepEqual(w.ops().slice(before).filter((/** @type {any} */ o) => o.op === "recall" || o.op === "dense"), [], "the archive answers alone");
    w.svc.brain.reembedding = false;
  });
});

// @ts-check
// HarnessV3-Responsiveness R7 (2026-10-01): with `storeBodies` at `full`, the owner's request log (six files of 50 MB)
// reached back 25 minutes when a question about requests from earlier that session came — and nothing said so. The
// reach is now worked out from the oldest file's first record, carried by /api/state, and shown in Settings and on
// the tray while bodies are stored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, truncateSync, statSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLogReach, UsageStore, MAX_LOG_BYTES, LOG_GENERATIONS } from "../src/services/records.js";
import { startApp } from "./helpers/app.js";

const scratch = () => mkdtempSync(join(tmpdir(), "filament-log-reach-"));
const line = (id, ts, pad = 0) => JSON.stringify({ id, ts, status: "ok", model: "m", body: "x".repeat(pad) }) + "\n";

// (fails before: there was no reach)
test("the reach is the oldest file's first record, however long its line, with every file's bytes", () => {
  const dir = scratch();
  try {
    const path = join(dir, "requests.jsonl");
    writeFileSync(`${path}.4`, line("a", "2026-10-01T08:00:00.000Z", 200_000) + line("b", "2026-10-01T08:05:00.000Z"));
    writeFileSync(`${path}.2`, line("c", "2026-10-01T09:00:00.000Z"));
    writeFileSync(path, line("d", "2026-10-01T10:00:00.000Z"));
    const r = readLogReach(path);
    assert.equal(r.since, "2026-10-01T08:00:00.000Z", "the oldest generation's first record, past a gap (.3 is missing)");
    assert.equal(r.files, 3);
    assert.equal(r.bytes, statSync(`${path}.4`).size + statSync(`${path}.2`).size + statSync(path).size);
    assert.equal(r.maxBytes, MAX_LOG_BYTES * (LOG_GENERATIONS + 1));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an oldest file with no record to read gives way to the next; no log at all is no reach", () => {
  const dir = scratch();
  try {
    const path = join(dir, "requests.jsonl");
    assert.deepEqual(readLogReach(path), { since: null, files: 0, bytes: 0, maxBytes: MAX_LOG_BYTES * (LOG_GENERATIONS + 1) });
    writeFileSync(`${path}.1`, "");
    writeFileSync(path, line("d", "2026-10-01T10:00:00.000Z"));
    assert.equal(readLogReach(path).since, "2026-10-01T10:00:00.000Z");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the store reads the reach again after a rotation, and counts its appends' bytes in between", async () => {
  const dir = scratch();
  try {
    const path = join(dir, "requests.jsonl");
    writeFileSync(`${path}.${LOG_GENERATIONS}`, line("old", "2026-09-30T08:00:00.000Z"));
    writeFileSync(path, line("cur", "2026-10-01T10:00:00.000Z"));
    const store = new UsageStore({ dataDir: dir, options: { logFile: "requests.jsonl", broadcast: false } });
    const before = store.logReach();
    assert.equal(before?.since, "2026-09-30T08:00:00.000Z");
    store.persist({ id: "r1", ts: "2026-10-01T10:01:00.000Z", status: "ok" });
    await store.flush();
    const grown = store.logReach();
    assert.equal(grown?.since, before?.since, "no rotation: the same oldest record");
    assert.equal(grown?.bytes, statSync(`${path}.${LOG_GENERATIONS}`).size + statSync(path).size, "the append's bytes are counted");
    // Fill the current file past the limit: the next append rotates, the oldest generation is dropped, and the file
    // that was current (its first record "cur") is now the oldest one left.
    appendFileSync(path, "");
    truncateSync(path, MAX_LOG_BYTES + 1);
    store.persist({ id: "r2", ts: "2026-10-01T10:02:00.000Z", status: "ok" });
    await store.flush();
    assert.equal(store.logReach()?.since, "2026-10-01T10:00:00.000Z", "read again after the rotation");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("/api/state carries the reach", async () => {
  const shim = await startApp({});
  try {
    const st = await (await shim.api("/api/state")).json();
    assert.ok("logReach" in st, "the field is there");
    if (st.logReach) assert.equal(typeof st.logReach.files, "number");
  } finally {
    await shim.stop();
  }
});

// @ts-check
// A file kept behind a task graph (`tasks keep`) in a chat another machine's agents started here (x-keep, after the
// review of cp-root): their chat's fence keeps to what it keeps too. Without Full control, from their chat's folder
// alone, never a credentials folder in it nor a path named by another name, whatever agentLoop.roots lists; with it,
// what the person's chat keeps, never in Filament's data folder. The person's own chat keeps as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { graphNoteSources } from "../src/app/agent/graph-notes.js";
import { agentFileRefusal } from "../src/http/admin/remote.js";

// (fails before: yes — a chat of another machine's agents kept any file the folder rules let the person's agent read:
// with no roots listed, a key in ~/.ssh, then read it back with `tasks read`)
test("another machine's agents' chat keeps files from its own folder alone, never a credentials folder in it; with Full control, never the data folder; the person's chat as before", (t) => {
  const base = mkdtempSync(join(tmpdir(), "filament-x-keep-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const project = join(base, "project");
  const elsewhere = join(base, "elsewhere");
  const data = join(base, "data");
  for (const f of [join(project, ".ssh"), elsewhere, data]) mkdirSync(f, { recursive: true });
  writeFileSync(join(project, "notes.md"), "theirs");
  writeFileSync(join(project, ".ssh", "id_ed25519"), "KEY");
  writeFileSync(join(elsewhere, "secret.txt"), "not theirs");
  writeFileSync(join(data, "secret.key"), "KEY");
  /** @type {string[]} */
  let roots = [];
  /** @type {Record<string, "fenced" | "full">} */
  const agents = { theirs: "fenced", full: "full" };
  const src = graphNoteSources({
    config: { get: () => ({ agentLoop: { roots }, server: { host: "127.0.0.1" } }) },
    dataDir: data,
    folderOf: () => project,
    agentsChat: (chainId) => agents[chainId] ?? null,
    fileRefusal: agentFileRefusal,
    picture: () => ({ found: null, gone: null, older: [], names: [] }),
    ownPictures: () => [],
  });

  assert.equal(src.fileFrom("theirs", "notes.md").ok, true, "their own folder");
  const outside = { ok: false, error: "another machine's agents keep files from their chat's folder alone" };
  assert.deepEqual(src.fileFrom("theirs", join(elsewhere, "secret.txt")), outside);
  assert.deepEqual(src.fileFrom("theirs", join(project, "..", "elsewhere", "secret.txt")), outside, "out by ..");
  roots = [base];
  assert.deepEqual(src.fileFrom("theirs", join(elsewhere, "secret.txt")), outside, "a listed root holds it: still none of theirs");
  const key = src.fileFrom("theirs", join(".ssh", "id_ed25519"));
  assert.equal(key.ok, false);
  assert.match(key.ok ? "" : key.error, /never read a credentials folder/);
  const short = src.fileFrom("theirs", "SSH~1/id_ed25519");
  assert.equal(short.ok, false);
  assert.match(short.ok ? "" : short.error, /by its own names/);

  assert.equal(src.fileFrom("full", join(elsewhere, "secret.txt")).ok, true, "Full control keeps what the person's chat keeps");
  const sealed = src.fileFrom("full", join(data, "secret.key"));
  assert.equal(sealed.ok, false);
  assert.match(sealed.ok ? "" : sealed.error, /never .*Filament's data folder/);

  assert.equal(src.fileFrom("mine", join(elsewhere, "secret.txt")).ok, true, "the person's chat, a listed root");
  roots = [];
  assert.equal(src.fileFrom("mine", join(project, ".ssh", "id_ed25519")).ok, true, "the person's chat reads their own folder as before");
});

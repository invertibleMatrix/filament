// @ts-check
// Anchors (HarnessV3-Memory M3-3, MD-4): a claim about code holds the files it names as they were when it was filed. A
// changed file labels the line, a gone file or a gone symbol holds it back, a session shown it hears of the move on its
// next turn, and a claim proved right is anchored afresh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, unlinkSync, utimesSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { namedPaths, namedSymbols, holdsSymbol, anchorsFor, AnchorCheck, gitHead, worstOf, HASH_LIMIT } from "../src/services/memory/anchors.js";
import { executeMemoryTool } from "../src/memory-tools.js";
import { world, memoryLines, lineWith } from "./fixtures/memory-world.mjs";

/** A fresh project folder with these files (a name ending in "/" is a folder), removed after `fn`. @param {Record<string, string>} files @param {(dir: string) => Promise<void> | void} fn */
async function project(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "filament-anchors-"));
  try {
    for (const [p, body] of Object.entries(files)) {
      if (p.endsWith("/")) {
        mkdirSync(join(dir, p), { recursive: true });
        continue;
      }
      mkdirSync(join(dir, p, ".."), { recursive: true });
      writeFileSync(join(dir, p), body);
    }
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("what a claim names: paths as written, symbols that are identifiers, never a link or a plain word", () => {
  assert.deepEqual(namedPaths("src/config.js exports loadConfig, which reads settings.json."), ["src/config.js", "settings.json"]);
  assert.deepEqual(namedPaths("see https://example.com/docs/x.md and src\\app\\main.ts; e.g. the README"), ["src\\app\\main.ts"]);
  assert.deepEqual(namedPaths("the memory folder src/services/memory/ holds it"), ["src/services/memory/"]);
  assert.deepEqual(namedPaths("C:\\proj\\src\\x.js is the entry"), ["C:\\proj\\src\\x.js"]);
  assert.deepEqual(namedSymbols("src/config.js exports loadConfig, which reads settings.json."), ["loadConfig"]);
  assert.deepEqual(namedSymbols("`parse` calls slot_value and BuildCache, then run() exports the default"), ["parse", "slot_value", "BuildCache", "run"]);
  assert.deepEqual(namedSymbols("src/server.js exports listen, which takes the port"), ["listen"]);
  assert.deepEqual(namedSymbols("The server reads the config before it starts."), [], "plain words are not symbols");
  assert.deepEqual(namedSymbols("the `id` column and `x` are set by go()"), [], "one or two letters: any file holds them, so they say nothing");
  assert.equal(holdsSymbol("const loadConfig = () => 1;", "loadConfig"), true);
  assert.equal(holdsSymbol("const preloadConfig = () => 1; const loadConfigs = 2;", "loadConfig"), false, "a whole identifier, not a piece of one");
});

test("anchoring: what exists under the project's folder, with the symbols the file held; nothing outside it", () =>
  project({ "app/src/config.js": "export function loadConfig() {}\n", "app/src/util/": "", "outside.js": "export const x = 1;\n" }, (dir) => {
    const [a, ...rest] = anchorsFor("src/config.js exports loadConfig and readSettings; see src/util and ../outside.js", join(dir, "app"));
    assert.equal(a.kind, "file");
    assert.equal(a.name, "src/config.js");
    assert.deepEqual(a.symbols, ["loadConfig"], "readSettings was never in the file: not one of its symbols");
    assert.match(String(a.hash), /^[0-9a-f]{40}$/);
    assert.equal(a.state, "ok");
    assert.deepEqual(rest.map((r) => [r.name, r.kind]), [["src/util", "folder"]], "a folder is anchored; a path outside the folder is not");
    assert.deepEqual(anchorsFor("src/config.js exports loadConfig", ""), [], "no folder, no anchors");
  }));

test("the check: untouched, touched with the same bytes, changed, a symbol gone, deleted, a folder gone", () =>
  project({ "src/a.js": "export function keepMe() {}\nexport function dropMe() {}\n", "lib/x.js": "x\n" }, (dir) => {
    const cache = new AnchorCheck();
    const [a] = anchorsFor("src/a.js exports keepMe and dropMe", dir);
    const [folder] = anchorsFor("lib holds helpers: lib/", dir);
    assert.deepEqual(cache.run()(a), { state: "ok" });
    const later = new Date(Date.now() + 60_000);
    utimesSync(a.path, later, later);
    assert.deepEqual(cache.run()(a), { state: "ok" }, "a new mtime with the same bytes is no change");
    writeFileSync(a.path, "export function keepMe() {}\nexport function dropMe() { return 1; }\n");
    assert.deepEqual(cache.run()(a), { state: "changed" });
    writeFileSync(a.path, "export function keepMe() {}\n");
    assert.deepEqual(cache.run()(a), { state: "symbol", symbol: "dropMe" });
    unlinkSync(a.path);
    assert.deepEqual(cache.run()(a), { state: "gone" });
    assert.deepEqual(cache.run()(folder), { state: "ok" });
    rmSync(join(dir, "lib"), { recursive: true });
    assert.deepEqual(cache.run()(folder), { state: "gone" });
    assert.deepEqual(worstOf([{ state: "ok" }, { state: "changed" }]), { state: "changed" });
    assert.equal(worstOf([{ state: "changed" }, { state: "symbol", symbol: "x" }]).state, "symbol");
  }));

test("a file modified after the claim was said has no baseline: it is anchored as changed (M3-D7)", () =>
  project({ "src/a.js": "export const a = 1;\n" }, (dir) => {
    const path = join(dir, "src", "a.js");
    const said = statSync(path).mtimeMs - 60_000;
    const [a] = anchorsFor("src/a.js exports a", dir, { saidAt: said });
    assert.deepEqual([a.state, a.size, a.hash], ["changed", null, null]);
    assert.deepEqual(new AnchorCheck().run()(a), { state: "changed" }, "it stays changed while the file is there");
    const [b] = anchorsFor("src/a.js exports a", dir, { saidAt: statSync(path).mtimeMs });
    assert.equal(b.state, "ok", "said after the file's last change: a baseline");
  }));

test("a file over the hash limit is anchored by its size and mtime", () =>
  project({ "big.txt": "x".repeat(HASH_LIMIT + 1) }, (dir) => {
    const [a] = anchorsFor("big.txt holds the fixture", dir);
    assert.deepEqual([a.hash, a.size], [null, HASH_LIMIT + 1]);
    assert.deepEqual(new AnchorCheck().run()(a), { state: "ok" });
    writeFileSync(a.path, "y".repeat(HASH_LIMIT + 2));
    assert.deepEqual(new AnchorCheck().run()(a), { state: "changed" });
  }));

test("a file grown past the hash limit is changed, and never read for its symbols", () =>
  project({ "src/config.js": "export function loadConfig() {}\n" }, (dir) => {
    const [a] = anchorsFor("src/config.js exports loadConfig", dir);
    assert.deepEqual(a.symbols, ["loadConfig"]);
    writeFileSync(a.path, "z".repeat(HASH_LIMIT + 1));
    assert.deepEqual(new AnchorCheck().run()(a), { state: "changed" }, "over the limit the hot path reads no file (M3-D5)");
  }));

test("the git HEAD is read from .git: a loose ref, a packed one, a detached head", () =>
  project({ ".git/HEAD": "ref: refs/heads/main\n", ".git/refs/heads/main": `${"a".repeat(40)}\n` }, (dir) => {
    assert.equal(gitHead(dir), "a".repeat(40));
    unlinkSync(join(dir, ".git", "refs", "heads", "main"));
    writeFileSync(join(dir, ".git", "packed-refs"), `# pack-refs\n${"b".repeat(40)} refs/heads/main\n`);
    assert.equal(gitHead(dir), "b".repeat(40));
    writeFileSync(join(dir, ".git", "HEAD"), `${"c".repeat(40)}\n`);
    assert.equal(gitHead(dir), "c".repeat(40));
    rmSync(join(dir, ".git"), { recursive: true });
    assert.equal(gitHead(dir), null);
  }));

test("a changed file labels its claim, and the label is explained once", () =>
  project({ "src/server.js": "export function listen(port) {}\n" }, (dir) =>
    world({ cwd: dir }, async (w) => {
      await w.session("a").remember("src/server.js exports listen, which takes the port");
      const { seen: before } = await w.session("b").send("what does src/server.js export?");
      assert.match(String(lineWith(before, "exports listen")), /^- \[i\d+ fact · user said · [^\]]*\] /, "untouched: served as before, no flag");
      writeFileSync(join(dir, "src", "server.js"), "export function listen(port, host) {}\n");
      const { seen } = await w.session("c").send("what does src/server.js export?");
      assert.match(String(lineWith(seen, "exports listen")), / · file changed since\] /);
      assert.ok(seen.includes('A line marked "file changed since" names a file that changed after it was recorded'));
      const it = w.svc.archive.items.list({}).find((x) => /exports listen/.test(x.text));
      const h = w.svc.brain.history(`i${it.id}`);
      assert.deepEqual(h.anchors.map((a) => [a.file, a.state, a.symbols]), [["src/server.js", "changed", ["listen"]]]);
      assert.deepEqual(h.events.filter((e) => e.action === "anchor").map((e) => [e.detail.file, e.detail.from, e.detail.state]), [["src/server.js", "ok", "changed"]], "the move is in its history, once");
    })));

test("a gone file holds its claim back from the autopilot and its quote with it; search still shows it, labelled", () =>
  project({ "src/legacy.js": "export function importCsv() {}\n", "src/main.js": "export {};\n" }, (dir) =>
    world({ cwd: dir }, async (w) => {
      await w.session("a").remember("src/legacy.js holds the old CSV importer");
      unlinkSync(join(dir, "src", "legacy.js"));
      const { seen, prep, sit } = await w.session("b").send("where does the old CSV importer live?");
      assert.deepEqual(memoryLines(seen).filter((l) => l.includes("src/legacy.js")), [], "neither the claim nor the words that made it");
      const found = JSON.parse(await executeMemoryTool(w.svc.scope({ role: "model", project: sit.project.id, chain: prep.chain, turn: prep.turn }), "filament_memory_search", { query: "old CSV importer legacy" }));
      const hit = found.results.find((r) => /legacy\.js/.test(r.text) && /^i\d+$/.test(r.id));
      assert.deepEqual(hit?.flags, ["file gone"]);
    })));

test("a session shown a claim hears, at the top of its next turn, that the claim's file lost a symbol", () =>
  project({ "src/config.js": "export function loadConfig() { return {}; }\n" }, (dir) =>
    world({ cwd: dir }, async (w) => {
      await w.session("a").remember("src/config.js exports loadConfig, which reads settings.json");
      const b = w.session("b");
      const { seen } = await b.send("what does src/config.js export?");
      const line = lineWith(seen, "exports loadConfig");
      assert.ok(line, "shown first");
      const ref = /^- \[(i\d+) /.exec(String(line))?.[1];
      writeFileSync(join(dir, "src", "config.js"), "export function readSettings() { return {}; }\n");
      const { r, prep } = await b.send("ok, and how do I call it?");
      const newest = JSON.stringify(r.body.messages.at(-1).content);
      assert.ok(newest.includes(`Memory check: [${ref}]`), newest);
      assert.match(newest, /src\/config\.js no longer has loadConfig; the memory is held back/);
      assert.ok(prep.notes.some((n) => /the files of 1 memory this session was shown changed since/.test(n)), prep.notes.join(" | "));
      const { r: r3 } = await b.send("thanks, anything else?");
      assert.ok(!JSON.stringify(r3.body.messages.at(-1).content).includes("Memory check:"), "said once");
    })));

test("a file put back as it was is ok again: its history says so, and no session is told", () =>
  project({ "src/config.js": "export function loadConfig() { return {}; }\n" }, (dir) =>
    world({ cwd: dir }, async (w) => {
      const file = join(dir, "src", "config.js");
      const was = "export function loadConfig() { return {}; }\n";
      await w.session("a").remember("src/config.js exports loadConfig, which reads settings.json");
      const b = w.session("b");
      const ref = /^- \[(i\d+) /.exec(String(lineWith((await b.send("what does src/config.js export?")).seen, "exports loadConfig")))?.[1];
      writeFileSync(file, "export function loadConfig() { return { a: 1 }; }\n");
      const { r } = await b.send("ok, and how do I call it?");
      assert.match(JSON.stringify(r.body.messages.at(-1).content), /src\/config\.js changed since it was recorded/);
      writeFileSync(file, was);
      const { r: r3 } = await b.send("thanks, anything else?");
      assert.ok(!JSON.stringify(r3.body.messages.at(-1).content).includes("Memory check:"), "put back: nothing to tell");
      const h = w.svc.brain.history(String(ref));
      assert.deepEqual(h.events.filter((e) => e.action === "anchor").map((e) => [e.detail.from, e.detail.state]), [["ok", "changed"], ["changed", "ok"]]);
    })));

test("a claim proved right is anchored afresh: the change it survived is no longer flagged", () =>
  project({ "src/server.js": "export function listen(port) {}\n" }, (dir) =>
    world({ cwd: dir }, async (w) => {
      await w.session("a").remember("src/server.js exports listen, which takes the port");
      writeFileSync(join(dir, "src", "server.js"), "export function listen(port, host) {}\n");
      const { seen, prep, sit } = await w.session("b").send("what does src/server.js export?");
      const ref = /^- \[(i\d+) /.exec(String(lineWith(seen, "exports listen")))?.[1];
      assert.match(String(lineWith(seen, "exports listen")), /file changed since/);
      const out = JSON.parse(await executeMemoryTool(w.svc.scope({ role: "model", project: sit.project.id, chain: prep.chain, turn: prep.turn }), "filament_memory_confirm", { id: ref }));
      assert.equal(out.ok, true);
      const { seen: after } = await w.session("c").send("what does src/server.js export?");
      assert.doesNotMatch(String(lineWith(after, "exports listen")), /file changed since/);
    })));

test("a claim from before anchors is anchored on its first recall, as of when it was said (M3-D12)", () =>
  project({ "src/old.js": "export function oldThing() {}\n", "src/fresh.js": "export function freshThing() {}\n" }, (dir) =>
    world({ cwd: dir }, async (w) => {
      const { prep, sit } = await w.session("a").send("hello there, let's look at the code");
      const said = Date.now() - 3600_000;
      const old = w.svc.archive.items.add({ projectId: sit.project.id, chainId: prep.chain, kind: "fact", text: "src/old.js exports oldThing for the importer.", status: "inferred", origin: "learner" });
      const fresh = w.svc.archive.items.add({ projectId: sit.project.id, chainId: prep.chain, kind: "fact", text: "src/fresh.js exports freshThing for the importer.", status: "inferred", origin: "learner" });
      w.svc.archive.db.prepare("UPDATE items SET created_at = ? WHERE id IN (?, ?)").run(said, old.id, fresh.id);
      const before = new Date(said - 60_000);
      utimesSync(join(dir, "src", "fresh.js"), before, before);
      assert.deepEqual(w.svc.archive.anchors.of(old.id), [], "not anchored at filing: it was filed straight into the archive");
      const { seen } = await w.session("b").send("which exports does the importer use, oldThing or freshThing?");
      assert.match(String(lineWith(seen, "exports oldThing")), /file changed since/, "modified after it was said");
      assert.doesNotMatch(String(lineWith(seen, "exports freshThing")), /file changed since/, "untouched since it was said");
      assert.equal(w.svc.archive.anchors.of(old.id)[0].state, "changed");
    })));

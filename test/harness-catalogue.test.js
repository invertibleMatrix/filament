// @ts-check
// HarnessV3 §15 93 (Phase C): the model picker's catalogue kept fresh. The keeper's rules behaviourally — reads never
// paint out of order, a burst of saves reads once, a copy that never landed or grew old is stale — and the harness's
// wiring of it pinned in the boot file's source (app.js builds a DOM at import).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCatalogueKeeper } from "../src/ui/harness/lib/catalogue.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (/** @type {string} */ p) => readFileSync(join(ROOT, p), "utf8");
const flush = () => new Promise((r) => setImmediate(r));

/** Reads the test answers by hand, in any order. */
function manualReads() {
  /** @type {{ resolve: (v: any) => void, reject: (e: any) => void }[]} */
  const pending = [];
  const read = () => new Promise((resolve, reject) => { pending.push({ resolve, reject }); });
  return { read, pending };
}

test("two reads in flight answer in any order: only the newest is painted", async () => {
  for (const order of [[1, 0], [0, 1]]) {
    const { read, pending } = manualReads();
    /** @type {any[]} */
    const painted = [];
    const keeper = createCatalogueKeeper({ read, paint: (c) => painted.push(c) });
    const answers = [keeper.load(), keeper.load()];
    for (const i of order) pending[i].resolve({ n: i });
    assert.deepEqual(await Promise.all(answers), [{ n: 0 }, { n: 1 }], "each caller still gets its own answer");
    assert.deepEqual(painted, [{ n: 1 }], `answered ${order.join(" then ")}: the older read is never painted`);
  }
});

test("a burst of saves reads once, after the quiet time — and what runs before the read failing never keeps it from happening", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reads = 0;
  let befores = 0;
  const keeper = createCatalogueKeeper({
    read: async () => ({ n: ++reads }),
    before: () => { befores++; throw new Error("the state read failed"); },
    paint: () => {},
  });
  keeper.refresh();
  keeper.refresh();
  t.mock.timers.tick(399);
  keeper.refresh();
  t.mock.timers.tick(399);
  await flush();
  assert.equal(reads, 0, "each refresh restarts the quiet time");
  t.mock.timers.tick(1);
  await flush();
  assert.equal(befores, 1, "one refresh ran");
  assert.equal(reads, 1, "three saves, one read — the failed step before it did not stop it");
});

test("a copy that never landed is stale, a failed read leaves it stale, and a fresh one is re-read only once it is older than asked", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let clock = 1_000;
  let fail = true;
  let reads = 0;
  const keeper = createCatalogueKeeper({
    read: async () => { reads++; if (fail) throw new Error("offline"); return {}; },
    paint: () => {},
    now: () => clock,
  });
  assert.equal(keeper.olderThan(30_000), true, "nothing landed yet — on a clock that starts near zero too");
  await keeper.load().catch(() => {});
  assert.equal(keeper.olderThan(30_000), true, "a failed read counts as stale, so the next look retries");
  fail = false;
  await keeper.load();
  clock += 30_000;
  keeper.refreshIfOlder(30_000);
  t.mock.timers.tick(400);
  await flush();
  assert.equal(reads, 2, "30 s old is not older than 30 s: no re-read");
  clock += 1;
  keeper.refreshIfOlder(30_000);
  t.mock.timers.tick(400);
  await flush();
  assert.equal(reads, 3, "a moment later it is");
});

// (fails before: yes — the owner's of 11-10: a model's window tuned, or a list asked again, moved the picker, while the
// open chat's Context popover kept the window its settings document said before, until its next turn)
test("a save anywhere and a list asked again re-read the open chat's settings document, so the Context popover's window follows the picker (source contract)", () => {
  const src = read("src/ui/harness/app.js");
  assert.match(
    src,
    /onBus\(\(msg\) => \{\s*if \(msg\?\.type !== "config-changed" && msg\?\.type !== "models-discovered"\) return;\s*const chat = chatOf\(state\.currentId\);\s*if \(chat\?\.chainId\) void refreshSessionDoc\(chat\);\s*\}\);/,
    "the open chat's document read again as the picker's catalogue is",
  );
});

test("the harness wires the keeper: a save anywhere, a tab back after 30 s, a tab left open five minutes — and only a painted read auto-picks (source contract)", () => {
  const src = read("src/ui/harness/app.js");
  assert.match(src, /onBus\(\(msg\) => \{ if \(msg\?\.type === "config-changed" \|\| msg\?\.type === "models-discovered"\) catalogue\.refresh\(\); \}\);/, "the dashboard's save, and the discovery a save started (Providers P0), reach the picker");
  assert.match(src, /addEventListener\("visibilitychange", \(\) => \{ if \(document\.visibilityState === "visible"\) catalogue\.refreshIfOlder\(30_000\); \}\);/);
  assert.match(src, /setInterval\(\(\) => \{ if \(document\.visibilityState === "visible"\) catalogue\.refreshIfOlder\(5 \* 60_000\); \}, 60_000\);/);
  const at = src.indexOf("const catalogue = createCatalogueKeeper({");
  // Its count, for the welcome tour, which opens by itself while nothing can answer (the owner's of 11-08).
  const end = src.indexOf("const modelsRead = catalogue.load().then((c) => (c?.models || c?.data || []).filter((/** @type {any} */ m) => m.answers).length, () => null);");
  assert.ok(at > 0 && end > at, "the keeper is built, then loaded once at boot");
  const paint = src.slice(src.indexOf("paint: (models) =>", at), end);
  assert.match(paint, /composer\.setFamilies\(models\.families \|\| \[\]\)/, "the families the picker offers are the catalogue's");
  // The auto-pick waits for the accounts too, so it never picks a coding agent the picker hides: the paint's, or the
  // accounts' read once a paint has given it the models — the painted list alone, which nothing else sets.
  assert.match(paint, /pickFirstModel\(\);/, "the paint picks");
  assert.equal(src.match(/state\.models = /g)?.length, 1, "the models the pick reads are set in one place");
  assert.match(paint, /state\.models = models\.models/, "the paint's: a read that lost the race never picks");
  const from = src.indexOf("function pickFirstModel()");
  const pick = src.slice(from, src.indexOf("\n}\n", from));
  assert.match(pick, /if \(composer\.modelName\(\) \|\| !accountsRead \|\| !state\.models\.length\) return;[\s\S]*firstModel\(state\.models, state\.accounts\)[\s\S]*composer\.setModel\(name\);/, "a model chosen already is kept; the painted list, with the accounts read, picks");
  assert.doesNotMatch(src.slice(end), /composer\.setModel\(name\)/, "and nowhere after the boot load");
});

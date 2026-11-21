// @ts-check
// The usage file holds up to KEEP_DAYS days and is saved every 1.5 s while traffic flows. Its I/O was already off the
// event loop; its text was not: every save stringified every day of the year (~6.7 MB at the ceiling), though a save
// changes only the days its records fell on. Each day's text is kept until a record changes the day, and the file is
// the same bytes a whole stringify gives.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DailyUsage } from "../src/services/daily-usage.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
const folder = () => {
  const d = mkdtempSync(join(tmpdir(), "daily-inc-"));
  made.push(d);
  return d;
};
const DAY = 86_400_000;
/** A finished request on a day so many back from now. @param {number} back @param {string} [model] */
const rec = (back, model = "m1") => ({ ts: Date.now() - back * DAY, status: "ok", upstream: "u", model, tokens: { input: 100, output: 20, cacheRead: 5 }, cost: 0.01, totalMs: 900, ttftMs: 100 });

/** The file as written, and what one stringify of the whole gives for it. @param {DailyUsage} d */
const onDisk = (d) => {
  const text = readFileSync(join(String(d.dataDir), "daily-usage.json"), "utf8");
  const j = JSON.parse(text);
  return { text, whole: JSON.stringify({ version: j.version, savedAt: j.savedAt, days: d.days }) };
};

/** How many day objects `fn` stringified, and how many times the whole of them. @param {DailyUsage} d @param {() => Promise<unknown> | null} fn */
const dayTexts = async (d, fn) => {
  const was = JSON.stringify;
  let n = 0;
  let whole = 0;
  JSON.stringify = /** @type {any} */ ((/** @type {any[]} */ ...a) => {
    if (a[0] && Object.values(d.days).includes(a[0])) n++;
    if (a[0]?.days === d.days) whole++;
    return was.apply(JSON, /** @type {any} */ (a));
  });
  try {
    await fn();
  } finally {
    JSON.stringify = was;
  }
  return { n, whole };
};

// (fails before: yes — a save stringified all of the year's days within one stringify of the whole file)
test("a save stringifies only the days its records changed, and the file is what one stringify of the whole gives", async () => {
  const dir = folder();
  const d = new DailyUsage({ dataDir: dir, log: () => {} });
  for (let back = 0; back < 60; back++) d.add(rec(back));
  const first = await dayTexts(d, () => d.flush());
  assert.deepEqual(first, { n: 60, whole: 0 }, "the first save: every day once, the whole never");
  assert.equal(onDisk(d).text, onDisk(d).whole);
  d.add(rec(0, "m2"));
  d.add(rec(0));
  d.add(rec(10));
  const next = await dayTexts(d, () => d.flush());
  assert.deepEqual(next, { n: 2, whole: 0 }, "today and the day ten back");
  const { text, whole } = onDisk(d);
  assert.equal(text, whole);
  // Read back as before.
  const again = new DailyUsage({ dataDir: dir });
  assert.deepEqual(again.list(), d.list());
  // A store read from its file keeps nothing stale: its first save writes the days it read, and what it adds.
  again.add(rec(1));
  await again.flush();
  assert.equal(onDisk(again).text, onDisk(again).whole);
  assert.equal(again.list().find((x) => x.day === d.list()[1].day)?.requests, 2);
});

test("days past the ceiling leave the file and their kept text with them", async () => {
  const dir = folder();
  const d = new DailyUsage({ dataDir: dir, log: () => {} });
  for (let back = 0; back < 405; back++) d.add(rec(back));
  await d.flush();
  assert.equal(Object.keys(d.days).length, 400);
  assert.equal(onDisk(d).text, onDisk(d).whole);
  d.add(rec(0));
  await d.flush();
  const { text, whole } = onDisk(d);
  assert.equal(text, whole);
  assert.equal(Object.keys(JSON.parse(text).days).length, 400);
});

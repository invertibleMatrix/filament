// @ts-check
// The ask for a star (the owner's of 11-22: "a Star filament card similar to how update card is shown, we will show
// this after few hours of usage on filament per user"): the hours counted from Usage's days, when it asks, its route
// (src/http/admin/star.js) and the card at the sidebar's foot (src/ui/harness/lib/star-notice.js).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stubDocument } from "./helpers/dom-stub.js";
import { startApp } from "./helpers/app.js";
import { STAR_AFTER_HOURS, STAR_URL, hoursUsed, starAsks } from "../src/http/admin/star.js";
import { STAR_LOOK_MS, starNotice, starShows } from "../src/ui/harness/lib/star-notice.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** @type {ReturnType<typeof stubDocument>} */
let doc;
beforeEach(() => {
  doc = stubDocument();
});
afterEach(() => doc.restore());

const flush = () => new Promise((r) => setImmediate(r));

// (fails before: yes — there was no ask for a star)
test("the hours used: each hour of each day with a model call in it; it asks once there are enough, never once asked nor beside the usage-stats notice", () => {
  const day = (/** @type {number[]} */ ...hs) => ({ hours: Array.from({ length: 24 }, (_, i) => hs.filter((h) => h === i).length) });
  assert.equal(hoursUsed([]), 0);
  assert.equal(hoursUsed([day(9, 9, 9, 10), day(23)]), 3, "three calls in one hour are one hour");
  assert.equal(hoursUsed([{ hours: undefined }, /** @type {any} */ (null)]), 0, "a day without hours counts none");
  assert.equal(STAR_AFTER_HOURS, 5);
  assert.equal(starAsks({ asked: false, hours: 5, telemetryNotice: false }), true);
  assert.equal(starAsks({ asked: false, hours: 4, telemetryNotice: false }), false, "not used long enough");
  assert.equal(starAsks({ asked: true, hours: 50, telemetryNotice: false }), false, "asked once");
  assert.equal(starAsks({ asked: false, hours: 50, telemetryNotice: true }), false, "the usage-stats notice first");
  assert.equal(STAR_URL, "https://github.com/invertibleMatrix/filament");
});

// (fails before: yes — 404: no /star route)
test("GET /star asks once five hours have a model call in them; POST /star/seen keeps it asked for the data folder", async () => {
  const shim = await startApp({});
  try {
    const first = await (await shim.api("/api/star")).json();
    assert.deepEqual(first, { asks: false, asked: false, hours: 0, after: 5, url: STAR_URL });
    const usage = /** @type {any} */ (shim.app.usage);
    const at = (/** @type {number} */ hour, /** @type {number} */ minute) => {
      const d = new Date(Date.now() - 86_400_000);
      d.setHours(hour, minute, 0, 0);
      return d.toISOString();
    };
    let n = 0;
    const call = (/** @type {number} */ hour, minute = 5) =>
      usage.dailyStore.add({ id: `c${++n}`, ts: at(hour, minute), status: "ok", model: "m1", upstream: "m", upstreamModel: "m1", tokens: { input: 10, output: 2 }, totalMs: 40 });
    for (const h of [9, 9, 10, 11, 12]) call(h, h === 9 ? 40 : 5);
    assert.deepEqual(await (await shim.api("/api/star")).json(), { asks: false, asked: false, hours: 4, after: 5, url: STAR_URL }, "two calls in one hour are one hour");
    call(14);
    assert.equal((await (await shim.api("/api/star")).json()).asks, true, "the fifth hour");
    const seen = await shim.api("/api/star/seen", { method: "POST", body: {} });
    assert.equal(seen.status, 200, await seen.clone().text());
    assert.deepEqual(await seen.json(), { asks: false, asked: true, hours: 0, after: 5, url: STAR_URL });
    call(16);
    assert.equal((await (await shim.api("/api/star")).json()).asks, false, "never again");
    assert.equal((await (await shim.api("/api/state")).json()).config?.ui?.star?.asked, true);
  } finally {
    await shim.stop();
  }
});

/** A fake `api`: what GET /star answers, from a list; the POSTs it was sent. */
function fakeApi(/** @type {any[]} */ answers) {
  /** @type {string[]} */
  const posted = [];
  let i = 0;
  const api = async (/** @type {string} */ path, /** @type {any} */ o) => {
    if (o?.method === "POST") return posted.push(path), { asks: false, asked: true };
    return answers[Math.min(i++, answers.length - 1)];
  };
  return { api, posted };
}

// (fails before: yes — there was no card)
test("the card: hidden until GET /star asks, looked at again each hour; Star on GitHub opens the repository and Not now hides it, both for good", async () => {
  const no = { asks: false, asked: false, hours: 2, after: 5, url: STAR_URL };
  const yes = { ...no, asks: true, hours: 5 };
  assert.equal(starShows(yes), true);
  assert.equal(starShows(no), false);
  assert.equal(starShows({ ...yes, url: "javascript:alert(1)" }), false, "an address that is no web page is never opened");

  /** @type {(() => void)[]} */
  const timers = [];
  /** @type {any[]} */
  const stopped = [];
  /** @type {string[]} */
  const opened = [];
  const { api, posted } = fakeApi([no, yes]);
  const n = starNotice({ api, open: (u) => opened.push(u), every: (f, ms) => (assert.equal(ms, STAR_LOOK_MS), timers.push(f), "t"), stopEvery: (t) => stopped.push(t) });
  const el = /** @type {any} */ (n.el);
  await flush();
  assert.equal(el.hidden, true, "two hours used: nothing yet");
  timers[0]();
  await flush();
  assert.equal(el.hidden, false, "an hour later it asks");
  assert.match(String(el.textContent), /^Enjoying Filament\?A star on GitHub helps other developers find it\.Star on GitHubNot now$/);
  assert.deepEqual(stopped, ["t"], "shown: no more looks");
  el.querySelector(".upd-go").dispatch("click");
  await flush();
  assert.deepEqual(opened, [STAR_URL]);
  assert.deepEqual(posted, ["/star/seen"]);
  assert.equal(el.hidden, true);

  // Not now: hidden, said asked, nothing opened
  const b = fakeApi([yes]);
  /** @type {string[]} */
  const opened2 = [];
  const m = starNotice({ api: b.api, open: (u) => opened2.push(u), every: () => "t", stopEvery: () => {} });
  await flush();
  const el2 = /** @type {any} */ (m.el);
  assert.equal(el2.hidden, false);
  el2.querySelector(".upd-later").dispatch("click");
  await flush();
  assert.equal(el2.hidden, true);
  assert.deepEqual([opened2, b.posted], [[], ["/star/seen"]]);

  // Asked already (another window said it): it stops looking
  const c = fakeApi([{ ...no, asked: true }]);
  /** @type {any[]} */
  const stopped3 = [];
  const k = starNotice({ api: c.api, every: () => "t3", stopEvery: (t) => stopped3.push(t) });
  await flush();
  assert.equal(/** @type {any} */ (k.el).hidden, true);
  assert.deepEqual(stopped3, ["t3"]);

  // (fails before: yes — the hourly look's timer kept every node process that built the sidebar alive: the suite's
  // sidebar files never ended)
  const kid = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { stubDocument } from ${JSON.stringify(pathToFileURL(join(HERE, "helpers", "dom-stub.js")).href)};
    import { starNotice } from ${JSON.stringify(pathToFileURL(join(HERE, "..", "src", "ui", "harness", "lib", "star-notice.js")).href)};
    stubDocument();
    starNotice({ api: async () => ({ asks: false, asked: false }) });
  `], { timeout: 20_000, encoding: "utf8" });
  assert.equal(kid.error, undefined, "a page built in node ends with the card's timer still set");
  assert.equal(kid.status, 0, kid.stderr);

  // A view-only device's page: no card, nothing asked
  let asked = 0;
  const v = starNotice({ api: async () => (asked++, yes), viewOnly: () => true, every: () => assert.fail("no timer") });
  await flush();
  assert.equal(/** @type {any} */ (v.el).hidden, true);
  assert.equal(asked, 0);
});

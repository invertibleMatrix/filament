// @ts-check
// The desktop app's tray (HarnessV3-Native NA3, NA3b), in plain Node: where its card stands, what the card's page may
// ask of the app (a chat opened by its route among it), the page the app draws while Filament gives none, what it says in
// notifications — Filament's alerts, and the harness's chats that need you or ended, watched as the harness's Now reads
// them —, its own settings, start at logon, and an attached app's look at the Filament it shows. Electron itself is
// driven by `npm run test:desktop`; no test here touches the system's login items.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BLUR_CLICK_MS, CARD_ACTS, CARD_SIZE, cardHears, cardPlace, downPage, downWords, harnessRoute, trayClick } from "../desktop/lib/card.js";
import { alertNote, backNote, balloonOf, endedNote, FAILOVER_QUIET_MS, needsNote, noteLine, restartingNote, spaceNote, tickNote } from "../desktop/lib/notes.js";
import { chatRoute, createFleet, createWatch, LONG_MS, OUTAGE_MS, SPACE_MS, WATCH_MS } from "../desktop/lib/watch.js";
import { trayRows, trayTip } from "../desktop/lib/tray.js";
import { railRows, railState } from "../desktop/lib/rail.js";
import { RECONNECT_MS } from "../desktop/lib/machines.js";
import http from "node:http";
import { keepSettings, readSettings, SETTINGS } from "../desktop/lib/settings.js";
import { logonItem } from "../desktop/lib/logon.js";
import { iconsOf } from "../desktop/lib/icons.js";
import { attachWatch, TAKE_OVER_MS } from "../desktop/lib/start.js";

const fresh = () => mkdtempSync(join(tmpdir(), "filament-desktop-tray-"));

// (fails before: yes — no card; NA-D9)
describe("the card's window", () => {
  const work = { x: 0, y: 0, width: 1920, height: 1032 };
  test("by the tray icon, inside the work area: over it with the taskbar at the foot, under it at the top, beside it at a side", () => {
    const { width, height } = CARD_SIZE;
    // The taskbar at the foot, the icon near the right end.
    assert.deepEqual(cardPlace({ x: 1500, y: 1040, width: 24, height: 24 }, work), { x: Math.round(1512 - width / 2), y: 1032 - height - 8, width, height });
    // Near the right edge: kept inside it.
    assert.equal(cardPlace({ x: 1900, y: 1040, width: 24, height: 24 }, work).x, 1920 - width - 8);
    // The taskbar at the top: under it.
    const top = { x: 0, y: 40, width: 1920, height: 1040 };
    assert.equal(cardPlace({ x: 1700, y: 8, width: 24, height: 24 }, top).y, 48);
    // At the right side: beside it, level with the icon where the screen allows.
    const right = { x: 0, y: 0, width: 1872, height: 1080 };
    assert.deepEqual(cardPlace({ x: 1880, y: 900, width: 24, height: 24 }, right), { x: 1872 - width - 8, y: 1080 - height - 8, width, height });
    assert.equal(cardPlace({ x: 1880, y: 300, width: 24, height: 24 }, right).y, Math.round(312 - height / 2));
    // At the left side.
    assert.equal(cardPlace({ x: 10, y: 300, width: 24, height: 24 }, { x: 48, y: 0, width: 1872, height: 1080 }).x, 56);
  });

  test("no place from the tray: the work area's corner at the foot and the right; a small screen: no bigger than it", () => {
    const { width, height } = CARD_SIZE;
    assert.deepEqual(cardPlace({ x: 0, y: 0, width: 0, height: 0 }, work), { x: 1920 - width - 8, y: 1032 - height - 8, width, height });
    assert.deepEqual(cardPlace(null, { x: 0, y: 0, width: 400, height: 500 }), { x: 8, y: 8, width: 384, height: 484 });
  });

  // (fails before: no trayClick, and the card stayed over everything until its × or Esc; the owner's of 11-08)
  test("a click anywhere else hides it; the tray's click that took its focus leaves it hidden, a later one opens it", () => {
    assert.equal(trayClick({ shown: true, blurredAt: 0, now: 5000 }), "hide");
    assert.equal(trayClick({ shown: false, blurredAt: 0, now: 5000 }), "open");
    assert.equal(trayClick({ shown: false, blurredAt: 5000, now: 5000 + 120 }), "none", "the click that hid it");
    assert.equal(trayClick({ shown: false, blurredAt: 5000, now: 5000 + BLUR_CLICK_MS }), "open");
    const main = readFileSync(fileURLToPath(new URL("../desktop/main.js", import.meta.url)), "utf8");
    assert.match(main, /w\.on\("blur", \(\) => \{\s*if \(w\.isDestroyed\(\) \|\| !w\.isVisible\(\)\) return;\s*cardBlurredAt = Date\.now\(\);\s*w\.hide\(\);/);
    assert.match(main, /tray\.on\("click", \(e\) => \{\n[^\n]*popUpContextMenu[^\n]*\n\s*const what = trayClick\(\{ shown: [^}]+, blurredAt: cardBlurredAt, now: Date\.now\(\) \}\);/);
  });

  test("the app hears only its acts, from Filament's own page", () => {
    const origin = "http://127.0.0.1:20300";
    assert.deepEqual([...CARD_ACTS], ["harness", "dashboard", "restart", "hide", "open"]);
    for (const act of CARD_ACTS.filter((a) => a !== "open")) assert.equal(cardHears(act, `${origin}/ui/tray-card.html`, origin), true, act);
    assert.equal(cardHears("quit", `${origin}/ui/tray-card.html`, origin), false, "not an act of the card's");
    assert.equal(cardHears("restart", "http://127.0.0.1:20301/ui/tray-card.html", origin), false, "another port's page");
    assert.equal(cardHears("restart", "data:text/html,x", origin), false, "the app's own page asks nothing");
    assert.equal(cardHears("restart", undefined, origin), false);
    assert.equal(cardHears(/** @type {any} */ ({ toString: () => "restart" }), `${origin}/`, origin), false, "a word, not an object");
  });

  // (fails before: yes — NA3b: a row of the card's Now opens its chat)
  test("open is heard with a chat's place in the harness alone", () => {
    const origin = "http://127.0.0.1:20300";
    const at = `${origin}/ui/tray-card.html`;
    for (const route of ["#/task/mvirh4xk-bd4b57d9", "#/task/c%202/side", "#/task/c2/team", "#/task/c2/overview"]) assert.equal(cardHears("open", at, origin, route), true, route);
    for (const route of [undefined, "", "#/settings/general", "#/task/", "#/task/a/b", "#/task/c2/elsewhere", "https://example.com/#/task/c", "#/task/c\njs", "#/task/" + "x".repeat(300), /** @type {any} */ (["#/task/c"])])
      assert.equal(cardHears("open", at, origin, route), false, String(route));
    assert.equal(cardHears("open", "http://127.0.0.1:20301/ui/tray-card.html", origin, "#/task/c"), false, "another port's page");
    assert.equal(harnessRoute("#/task/c2/side"), "#/task/c2/side");
    assert.equal(harnessRoute("#/library/memory"), null);
  });

  test("while Filament gives no card: the app's page says which state, in the card's theme, its words escaped", () => {
    assert.deepEqual(downWords("starting", 20300), { title: "Filament is starting", line: "The card shows once it answers." });
    assert.match(downWords("taken", 20300).line, /Port 20300 is another program's/);
    assert.match(downWords("failed", 1).title, /could not start/);
    assert.match(downWords("gone", 20301).line, /Nothing answers on port 20301\. If nothing does soon, the app starts Filament itself\./);
    for (const s of ["late", "restarting", "stopping", "stopped"]) assert.notEqual(downWords(s, 1).title, downWords("starting", 1).title, s);
    const page = (/** @type {boolean} */ dark) => decodeURIComponent(downPage({ title: "a <b>", line: 'x & "y"' }, dark).replace(/^data:text\/html;charset=utf-8,/, ""));
    assert.ok(downPage({ title: "t", line: "l" }, true).startsWith("data:text/html;charset=utf-8,"));
    assert.match(page(true), /a &lt;b&gt;/);
    assert.match(page(true), /x &amp; &quot;y&quot;/);
    assert.doesNotMatch(page(true), /a <b>/);
    assert.match(page(true), /background:#1d1d20/);
    assert.match(page(false), /background:#fbfbfd/);
    assert.doesNotMatch(page(true), /<script/i, "nothing runs in it");
  });
});

// (fails before: yes — no notifications; NA-D9)
describe("notifications", () => {
  const since = Date.parse("2026-10-22T10:00:00Z");
  test("each alert once, by its id; those raised before the app started are on the card, not said", () => {
    const seen = new Set();
    const old = { id: "budget:1", at: "2026-10-22T09:59:59Z", kind: "budget", text: "the day's budget is spent" };
    const late = { id: "failover:r1", at: "2026-10-22T10:00:05Z", kind: "failover", text: "a request was served by backup after 1 failover" };
    assert.equal(alertNote([old], seen, since), null, "older than the app");
    assert.ok(seen.has("budget:1"), "and not said later either");
    assert.deepEqual(alertNote([old, late], seen, since), { title: "Failover", text: late.text, tone: "warning" });
    assert.equal(alertNote([old, late], seen, since), null, "said once");
    assert.equal(alertNote(undefined, seen, since), null);
    assert.equal(alertNote(/** @type {any} */ ([null, { id: 7 }]), seen, since), null, "what is no alert is passed over");
  });

  test("several at once are one notification; long words are cut", () => {
    const seen = new Set();
    const list = [1, 2, 3].map((i) => ({ id: `cache:${i}`, at: "2026-10-22T10:01:00Z", kind: "cache", text: `${"churn ".repeat(60)}${i}` }));
    const note = /** @type {any} */ (alertNote(list, seen, since));
    assert.equal(note.title, "3 alerts");
    assert.match(note.text, /… — and 2 more on the card\.$/);
    assert.ok(note.text.length < 240);
    const one = /** @type {any} */ (alertNote([{ id: "x", at: "2026-10-22T10:02:00Z", kind: "budget", text: "y".repeat(400) }], seen, since));
    assert.equal(one.text.length, 240);
    assert.equal(alertNote([{ id: "no-date", kind: "flow", text: "a flow asks you" }], new Set(), since)?.title, "Flow", "no time: said");
  });

  // (fails before: yes — NA3b)
  test("memory's alerts are not told; a failover once in 15 minutes, the rest left to the card", () => {
    const seen = new Set();
    assert.equal(alertNote([{ id: "m1", at: "2026-10-22T10:01:00Z", kind: "memory", text: "the engine stopped" }], seen, since), null);
    assert.ok(seen.has("m1"), "and not later either");
    const quiet = {};
    const fo = (/** @type {number} */ i) => ({ id: `failover:${i}`, at: "2026-10-22T10:01:00Z", kind: "failover", text: `request ${i} served by backup` });
    const t0 = since + 60_000;
    assert.equal(alertNote([fo(1)], seen, since, quiet, t0)?.text, "request 1 served by backup");
    assert.equal(alertNote([fo(2), fo(3)], seen, since, quiet, t0 + 60_000), null, "within 15 minutes: not told");
    assert.equal(alertNote([fo(4)], seen, since, quiet, t0 + FAILOVER_QUIET_MS)?.text, "request 4 served by backup", "15 minutes on: told again");
    assert.equal(alertNote([fo(5), { id: "b", at: "2026-10-22T10:30:00Z", kind: "budget", text: "spent" }], seen, since, quiet, t0 + FAILOVER_QUIET_MS + 1)?.title, "Budget", "a quiet failover does not hold the rest back");
  });

  // (fails before: yes — NA3b)
  test("the harness's chats: one that needs you, in a few words — never the question or the command; several in one", () => {
    const row = (/** @type {string} */ title, /** @type {string} */ fact, project = "shop-api") => ({ title, project, fact, tone: "asks" });
    assert.deepEqual(needsNote([row("Parser refactor", "waits for your yes: Bash rm -rf build && npm i --token=s3cret")]), { title: "Parser refactor (shop-api)", text: "Waits for your yes.", tone: "warning" });
    assert.equal(needsNote([row("A", "asks: which database password should I use?", "")])?.text, "Asks you something.");
    assert.deepEqual(needsNote([row("A", "its plan waits for your yes")]), { title: "A (shop-api)", text: "Its plan waits for your yes.", tone: "warning" });
    const many = /** @type {any} */ (needsNote(["A", "B", "C", "D", "E"].map((t) => row(t, "asks: x"))));
    assert.deepEqual([many.title, many.text], ["5 chats need you", "A (shop-api), B (shop-api), C (shop-api) and 2 more."]);
    assert.equal(needsNote([]), null);
    assert.deepEqual(endedNote([{ title: "Release notes", project: "site", failed: false, ms: 7 * 60_000 }]), { title: "Release notes (site)", text: "Done, after 7 min.", tone: "info" });
    assert.deepEqual(endedNote([{ title: "CSV export", project: "", failed: true, ms: 1000 }]), { title: "CSV export", text: "Its turn stopped on an error.", tone: "warning" });
    assert.equal(endedNote([{ title: "A", failed: true, ms: 1 }, { title: "B", failed: false, ms: 3_900_000 }])?.title, "2 chats ended, 1 on an error");
    assert.equal(endedNote([{ title: "B", failed: false, ms: 3_900_000 }])?.text, "Done, after 1 h 5 min.");
    assert.equal(endedNote([]), null);
    assert.equal(trayTip({ owned: true, state: "up", port: 20300, needs: 2 }), "Filament · port 20300 · 2 chats need you");
    assert.equal(trayTip({ owned: true, state: "up", port: 20300, needs: 1 }), "Filament · port 20300 · 1 chat needs you");
    assert.equal(trayTip({ owned: false, state: "attached", port: 20300, needs: 1 }), "Filament · port 20300 · started elsewhere · 1 chat needs you");
    assert.equal(trayTip({ owned: true, state: "up", port: 20300, needs: 0 }), "Filament · port 20300");
  });

  // HarnessV4_Space_Plan S5b (S5-D10): what came to Your Space, counted by project; a row's words never.
  // (fails before: yes — the tray said nothing of Your Space)
  test("Your Space's new rows: how many, by project — never a row's words", () => {
    assert.deepEqual(spaceNote([{ project: "app", count: 2 }, { project: "api", count: 1 }]), { title: "Home", text: "3 new need you — app 2, api 1.", tone: "warning" });
    assert.equal(spaceNote([{ project: "app", count: 1 }])?.text, "1 new needs you — app 1.");
    assert.equal(spaceNote(["a", "b", "c", "d", "e"].map((project) => ({ project, count: 1 })))?.text, "5 new need you — a 1, b 1, c 1 and 2 more projects.");
    assert.equal(spaceNote([]), null);
    assert.equal(spaceNote([{ project: "app", count: 0 }]), null);
  });

  // (fails before: yes — Windows' blue info or yellow warning glyph in the large slot, and "Filament: done" under
  // Windows' own "Filament" header, the chat's name buried in the words; the owner's of 10-28)
  test("a notification wears Filament's logo, as other apps' wear theirs; its title never repeats Filament's name — one chat's is the chat's", () => {
    const logo = { isEmpty: () => false };
    const note = /** @type {import("../desktop/lib/notes.js").Note} */ (endedNote([{ title: "Release notes", project: "site", failed: false, ms: 7 * 60_000 }]));
    assert.deepEqual(balloonOf(note, logo), { title: "Release notes (site)", content: "Done, after 7 min.", icon: logo, iconType: "custom", largeIcon: true, respectQuietTime: true });
    const warn = /** @type {import("../desktop/lib/notes.js").Note} */ (needsNote([{ title: "A", fact: "asks: x" }]));
    assert.equal(balloonOf(warn, logo).iconType, "custom", "a warning wears it too");
    // where the logo did not load, Windows' glyph for the tone
    assert.deepEqual([balloonOf(note, { isEmpty: () => true }).iconType, balloonOf(warn, null).iconType], ["info", "warning"]);
    assert.equal("icon" in balloonOf(note, null), false);
    const all = [
      alertNote([{ id: "1", kind: "budget", text: "spent" }], new Set(), 0),
      alertNote([{ id: "1", text: "a" }, { id: "2", text: "b" }], new Set(), 0),
      needsNote([{ title: "A", fact: "asks: x" }]),
      needsNote([{ title: "A" }, { title: "B" }]),
      endedNote([{ title: "A", failed: true, ms: 1 }]),
      endedNote([{ title: "A", failed: false, ms: 1 }, { title: "B", failed: false, ms: 1 }]),
      spaceNote([{ project: "app", count: 1 }]),
    ];
    for (const n of all) assert.doesNotMatch(String(n?.title), /^Filament:/, String(n?.title));
    const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
    assert.match(main, /const logo = nativeImage\.createFromPath\(join\(ROOT, "src", "ui", "filament-icon\.png"\)\);/);
    assert.match(main, /if \(process\.platform === "win32"\) tray\.displayBalloon\(balloonOf\(note, logo\)\);/);
  });

  test("the ids remembered are kept to the newest thousand", () => {
    const seen = new Set();
    for (let i = 0; i < 1200; i++) alertNote([{ id: `a${i}`, at: "2026-10-22T09:00:00Z" }], seen, since);
    assert.equal(seen.size, 1000);
    assert.ok(seen.has("a1199") && !seen.has("a0"));
  });

  test("a Restart the person asked: restarting, with what is in flight; back, with its version and port", () => {
    assert.deepEqual(restartingNote(0), { title: "Restarting Filament", text: "Nothing in flight: back in a few seconds.", tone: "info" });
    assert.equal(restartingNote(1).text, "1 request in flight: Filament finishes it first, then starts again.");
    assert.equal(restartingNote(3).text, "3 requests in flight: Filament finishes them first, then starts again.");
    assert.deepEqual(backNote("0.9.4", 20300), { title: "Filament is back", text: "Filament 0.9.4 runs again on port 20300.", tone: "info" });
    assert.equal(backNote("", 20300).text, "Filament runs again on port 20300.");
    assert.equal(noteLine(backNote("1", 2), true), "told: Filament is back — Filament 1 runs again on port 2.");
    assert.match(noteLine(backNote("1", 2), false), /^not shown \(notifications are off\): Filament is back/);
  });
});

// (fails before: yes — no settings of the app's own; NA3)
test("the app's own settings: their first values where none are kept or they do not read; kept whole", () => {
  const dir = fresh();
  try {
    const file = join(dir, "desktop", "settings.json");
    assert.deepEqual(readSettings(file), SETTINGS);
    assert.deepEqual(keepSettings(file, { notify: false }), { notify: false, updates: true });
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { notify: false, updates: true });
    // (fails before: yes — NA5's mutation pass) and read back as kept, at the next start.
    assert.deepEqual(readSettings(file), { notify: false, updates: true });
    assert.deepEqual(keepSettings(file, { updates: false }), { notify: false, updates: false }, "updating itself is a choice kept the same way");
    writeFileSync(file, '{ "notify": "no" }');
    assert.deepEqual(readSettings(file), SETTINGS, "what does not read is its first value");
    writeFileSync(file, "[");
    assert.deepEqual(readSettings(file), SETTINGS);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — no start at logon; NA-D10)
test("start at logon: the installed app with --hidden; a checkout, Electron over its main script; a folder and port it was given go with it", () => {
  assert.deepEqual(logonItem({ exe: "C:\\Apps\\filament.exe", packaged: true, main: "x" }), { path: "C:\\Apps\\filament.exe", args: ["--hidden"] });
  assert.deepEqual(logonItem({ exe: "H:\\filament\\node_modules\\electron\\dist\\electron.exe", packaged: false, main: "H:\\filament\\desktop\\main.js" }).args, ["H:\\filament\\desktop\\main.js", "--hidden"]);
  assert.deepEqual(logonItem({ exe: "e", packaged: true, main: "m", dataDir: "D:\\d", port: "20400" }).args, ["--hidden", "--data-dir", "D:\\d", "--port", "20400"]);
});

// (fails before: yes — NA2's known gap: attached, the app did nothing once that Filament went)
test("attached: while that Filament gives no answer it is gone; after 45 s of none the app starts its own; an answer meanwhile is a fresh start", () => {
  assert.equal(TAKE_OVER_MS, 45_000);
  assert.deepEqual(attachWatch(null, true, 1000), { silentSince: null, gone: false, take: false });
  const a = attachWatch(null, false, 1000);
  assert.deepEqual(a, { silentSince: 1000, gone: true, take: false });
  assert.deepEqual(attachWatch(a.silentSince, false, 1000 + TAKE_OVER_MS - 1), { silentSince: 1000, gone: true, take: false });
  assert.deepEqual(attachWatch(a.silentSince, false, 1000 + TAKE_OVER_MS), { silentSince: 1000, gone: true, take: true });
  assert.deepEqual(attachWatch(a.silentSince, true, 1000 + TAKE_OVER_MS), { silentSince: null, gone: false, take: false }, "it answered again");
});

// (fails before: yes — NA3b: the harness watched from the tray)
describe("the harness, watched", () => {
  /** A fake Filament: its runs list, each run's events, the chats; what was asked. */
  const fake = () => {
    const f = {
      runs: /** @type {any[]} */ ([]),
      events: /** @type {Record<string, any[]>} */ ({}),
      chats: [{ id: "c1", title: "Parser refactor", cwd: "H:\\work\\shop-api" }, { id: "c2", title: "Release notes", projectName: "site" }],
      asked: /** @type {string[]} */ ([]),
      down: false,
    };
    /** @param {string} p */
    const call = async (p) => {
      f.asked.push(p);
      if (f.down) throw new Error("ECONNREFUSED");
      if (p === "/runs?limit=50") return { runs: f.runs };
      if (p.startsWith("/memory/sessions")) return { sessions: f.chats };
      const m = /^\/runs\/([^/]+)\/events/.exec(p);
      if (m) return { events: f.events[m[1]] || [] };
      return {};
    };
    return { f, call };
  };
  const turn = (/** @type {any} */ o) => ({ kind: "agent-turn", startedAt: 0, endedAt: null, events: 1, ...o, meta: { chain: o.chain, model: "m" } });

  test("what was there at the first look is not told; a chat that comes to need you is, once for each thing it waits on", async () => {
    let t = 1_000_000;
    const { f, call } = fake();
    const w = createWatch({ call, now: () => t });
    f.runs = [turn({ id: "r0", chain: "c2", status: "paused" })];
    const first = /** @type {any} */ (await w.look());
    assert.deepEqual([first.needs, first.needsNew.length], [1, 0], "waiting before the app looked: counted, not told");
    f.runs = [turn({ id: "r1", chain: "c1", status: "running" }), ...f.runs];
    f.events.r1 = [{ n: 1, type: "ask", kind: "permission", id: "a1", question: "Bash npm test", ts: t }];
    t += WATCH_MS;
    const second = /** @type {any} */ (await w.look());
    assert.deepEqual(second.needsNew.map((/** @type {any} */ r) => [r.chain, r.title, r.project, r.fact]), [["c1", "Parser refactor", "shop-api", "waits for your yes: Bash npm test"]]);
    assert.equal(second.needs, 2);
    t += WATCH_MS;
    assert.deepEqual((/** @type {any} */ (await w.look())).needsNew, [], "told once");
    f.events.r1 = [{ n: 2, type: "ask-end", id: "a1" }, { n: 3, type: "ask", kind: "question", id: "a2", question: "Which branch?", ts: t }];
    f.runs[0].events = 3;
    t += WATCH_MS;
    assert.deepEqual((/** @type {any} */ (await w.look())).needsNew.map((/** @type {any} */ r) => r.fact), ["asks: Which branch?"], "a new question in the same chat: told again");
    assert.equal(chatRoute(second.needsNew[0]), "#/task/c1");
    assert.equal(chatRoute({ chain: "c1", thread: "s1" }), "#/task/c1/side");
  });

  test("a turn that ended: told when it failed, ran long, or was a team's lead's; a short one, a stopped one, not", async () => {
    let t = 10_000_000;
    const { f, call } = fake();
    const w = createWatch({ call, now: () => t });
    f.runs = [turn({ id: "a", chain: "c1", status: "running", startedAt: t - 1000 }), turn({ id: "b", chain: "c2", status: "running", startedAt: t - LONG_MS })];
    await w.look();
    f.runs = [turn({ id: "a", chain: "c1", status: "done", startedAt: t - 1000, endedAt: t }), turn({ id: "b", chain: "c2", status: "done", startedAt: t - LONG_MS, endedAt: t })];
    t += WATCH_MS;
    const l = /** @type {any} */ (await w.look());
    assert.deepEqual(l.ended.map((/** @type {any} */ e) => [e.chain, e.title, e.failed, e.told]), [["c1", "Parser refactor", false, false], ["c2", "Release notes", false, true]], "every end, for the unread marks; the long one told");
    f.runs = [turn({ id: "c", chain: "c1", status: "running", startedAt: t }), turn({ id: "d", chain: "c2", status: "running", startedAt: t })];
    t += WATCH_MS;
    await w.look();
    f.runs = [turn({ id: "c", chain: "c1", status: "error", startedAt: t - WATCH_MS, endedAt: t }), turn({ id: "d", chain: "c2", status: "stopped", startedAt: t - WATCH_MS, endedAt: t })];
    t += WATCH_MS;
    const l2 = /** @type {any} */ (await w.look());
    assert.deepEqual(l2.ended.map((/** @type {any} */ e) => [e.chain, e.failed, e.told]), [["c1", true, true]], "a failure told; one you stopped, nothing");
    t += WATCH_MS;
    assert.deepEqual((/** @type {any} */ (await w.look())).ended, [], "an end is told once");
  });

  test("the chats' names read at once for a chat the list does not hold, else once a minute; Filament down: no look", async () => {
    let t = 0;
    const { f, call } = fake();
    const w = createWatch({ call, now: () => t });
    f.runs = [turn({ id: "a", chain: "c1", status: "done", endedAt: 1 })];
    await w.look();
    const reads = () => f.asked.filter((p) => p.startsWith("/memory/sessions")).length;
    assert.equal(reads(), 1);
    t += WATCH_MS;
    await w.look();
    assert.equal(reads(), 1, "known: not read again yet");
    f.runs = [turn({ id: "b", chain: "c9", status: "done", endedAt: 2 }), ...f.runs];
    t += WATCH_MS;
    await w.look();
    assert.equal(reads(), 2, "a chat it did not know");
    f.down = true;
    assert.equal(await w.look(), null);
  });

  // HarnessV4_Space_Plan S5b (A8): the rows a project's dashboards bring to Your Space — its first read only learns;
  // after, the rows open now that were not, counted by project, every 30 s; At a glance not read.
  // (fails before: yes — the tray said nothing of Your Space)
  test("Your Space read every 30 s, without At a glance: its first read learns; a row open since is counted by its project", async () => {
    let t = 0;
    const { f, call } = fake();
    /** @type {any[]} */
    let needs = [{ id: "w1", project: "p1", state: "open", text: "CI failed on main: run 8812" }, { id: "l1", project: "p1", state: "later" }];
    const projects = [{ id: "p1", name: "app" }, { id: "p2", name: "api" }];
    const space = async (/** @type {string} */ p) => (p === "/your-space?glance=0" ? (f.asked.push(p), { projects, needs }) : call(p));
    const w = createWatch({ call: space, now: () => t });
    const reads = () => f.asked.filter((p) => p.startsWith("/your-space")).length;
    assert.deepEqual((/** @type {any} */ (await w.look())).spaceNew, [], "there before the app looked: not told");
    assert.deepEqual(f.asked.filter((p) => p.startsWith("/your-space")), ["/your-space?glance=0"]);
    needs = [...needs, { id: "w2", project: "p1", state: "open" }, { id: "s1", project: "p2", state: "open" }, { id: "w3", project: "p2", state: "done" }];
    t += WATCH_MS;
    assert.deepEqual((/** @type {any} */ (await w.look())).spaceNew, [], "between its reads");
    assert.equal(reads(), 1);
    t = SPACE_MS;
    assert.deepEqual((/** @type {any} */ (await w.look())).spaceNew, [{ project: "app", count: 1 }, { project: "api", count: 1 }]);
    t += SPACE_MS;
    assert.deepEqual((/** @type {any} */ (await w.look())).spaceNew, [], "told once");
    // A row put off comes back by itself: it needs you again.
    needs = needs.map((n) => (n.id === "l1" ? { ...n, state: "open" } : n));
    t += SPACE_MS;
    assert.deepEqual((/** @type {any} */ (await w.look())).spaceNew, [{ project: "app", count: 1 }]);
    // Told only while you are not in the harness — on this computer's page: another machine's on the rail is not it —, as
    // the chats are; a press opens Your Space (pinned in the source; tickNote below).
    const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
    assert.match(main, /const showing = focused && focused === harness \? \(rail\?\.active\(\) \?\? LOCAL_ID\) : null;/);
    assert.match(main, /tick\.home \? "#\/your-space" : null;\n\s+say\(tick\.note, route, tick\.machine\);/);
  });

  // (fails before: yes — the owner's remote Filament of 11-06, p3-watch: a Filament that came back after a restart, or a
  // computer that woke, told everything that came while it went unseen, each turn cut by the restart a notification)
  test("back after an outage: what came meanwhile is learned, not told — its ended turns listed for their unread marks; one look missed is no outage", async () => {
    let t = 50_000_000;
    const { f, call } = fake();
    const w = createWatch({ call, now: () => t });
    f.runs = [turn({ id: "a", chain: "c1", status: "running", startedAt: t - LONG_MS }), turn({ id: "b", chain: "c2", status: "running", startedAt: t })];
    await w.look();
    // An outage: three looks find none, the next sees it again over OUTAGE_MS after the last that did.
    f.down = true;
    for (let i = 0; i < 3; i++) {
      t += WATCH_MS;
      assert.equal(await w.look(), null);
    }
    f.down = false;
    t += WATCH_MS;
    f.runs = [turn({ id: "a", chain: "c1", status: "error", startedAt: t - 2 * LONG_MS, endedAt: t - 1 }), turn({ id: "b", chain: "c2", status: "running", startedAt: t - LONG_MS, events: 1 })];
    f.events.b = [{ n: 1, type: "ask", kind: "permission", id: "q1", question: "Bash npm test", ts: t - 20_000 }];
    const back = /** @type {any} */ (await w.look());
    assert.ok(3 * WATCH_MS < OUTAGE_MS && OUTAGE_MS < 4 * WATCH_MS, "three looks missed are an outage, two are not");
    assert.deepEqual([back.needs, back.needsNew], [1, []], "the chat that came to need you meanwhile: counted, not told");
    assert.deepEqual(back.ended.map((/** @type {any} */ e) => [e.chain, e.failed, e.told]), [["c1", true, false]], "the turn that ended meanwhile: listed, for its unread mark, and not told");
    // After it, as before: a new question is told.
    f.events.b = [{ n: 2, type: "ask-end", id: "q1" }, { n: 3, type: "ask", kind: "question", id: "q2", question: "Which branch?", ts: t }];
    f.runs[1].events = 3;
    t += WATCH_MS;
    assert.deepEqual((/** @type {any} */ (await w.look())).needsNew.map((/** @type {any} */ r) => r.fact), ["asks: Which branch?"]);
    // One look missed is none: what came in it is told at the next.
    f.down = true;
    t += WATCH_MS;
    assert.equal(await w.look(), null);
    f.down = false;
    t += WATCH_MS;
    f.runs[1] = { ...f.runs[1], status: "done", endedAt: t - 1 };
    const next = /** @type {any} */ (await w.look());
    assert.deepEqual(next.ended.map((/** @type {any} */ e) => [e.chain, e.told]), [["c2", true]], "the long turn that ended in the look missed: told");
  });

  test("back after an outage, Your Space's rows that came meanwhile are learned, not told", async () => {
    let t = 0;
    const { f, call } = fake();
    /** @type {any[]} */
    let needs = [{ id: "w1", project: "p1", state: "open" }];
    const space = async (/** @type {string} */ p) => {
      if (f.down) throw new Error("ECONNREFUSED");
      return p === "/your-space?glance=0" ? { projects: [{ id: "p1", name: "app" }], needs } : call(p);
    };
    const w = createWatch({ call: space, now: () => t });
    await w.look();
    f.down = true;
    for (let i = 0; i < 4; i++) {
      t += WATCH_MS;
      await w.look();
    }
    f.down = false;
    needs = [...needs, { id: "w2", project: "p1", state: "open" }];
    t += WATCH_MS;
    assert.deepEqual((/** @type {any} */ (await w.look())).spaceNew, [], "learned at the look that sees it again");
    needs = [...needs, { id: "w3", project: "p1", state: "open" }];
    /** @type {any[]} */
    const after = [];
    for (let i = 0; i < SPACE_MS / WATCH_MS; i++) {
      t += WATCH_MS;
      after.push((/** @type {any} */ (await w.look())).spaceNew);
    }
    assert.deepEqual(after.at(-1), [{ project: "app", count: 1 }], "and told after it, at Your Space's next read");
  });

  // (fails before: yes — the review of p3-watch: unseen was counted from when a look's first answer came, so a machine
  // whose every look took long went quiet for good; and the outage fell on the tick's beat, two looks missed a coin toss)
  test("unseen is from the end of a look to the start of the next: a slow look is no outage; two looks missed are none, off the tick's beat", async () => {
    let t = 70_000_000;
    let slow = 0;
    const { f, call } = fake();
    // Every answer comes `slow` ms after it was asked.
    const late = async (/** @type {string} */ p) => {
      t += slow;
      return call(p);
    };
    const w = createWatch({ call: late, now: () => t });
    f.runs = [turn({ id: "r1", chain: "c1", status: "running", events: 1 })];
    slow = 8000;
    await w.look();
    f.events.r1 = [{ n: 1, type: "ask", kind: "permission", id: "a1", question: "Bash npm test", ts: t }];
    t += WATCH_MS;
    assert.deepEqual((/** @type {any} */ (await w.look())).needsNew.map((/** @type {any} */ r) => r.chain), ["c1"], "a machine slow to answer still tells");
    // Two looks missed, the clock a little late: no outage.
    slow = 0;
    f.down = true;
    for (let i = 0; i < 2; i++) {
      t += WATCH_MS;
      assert.equal(await w.look(), null);
    }
    f.down = false;
    t += WATCH_MS + 1500;
    f.events.r1 = [{ n: 2, type: "ask-end", id: "a1" }, { n: 3, type: "ask", kind: "question", id: "a2", question: "Which branch?", ts: t }];
    f.runs[0].events = 3;
    assert.deepEqual((/** @type {any} */ (await w.look())).needsNew.map((/** @type {any} */ r) => r.fact), ["asks: Which branch?"], "two looks missed: what came in them told");
  });

  // (fails before: yes — the review of p3-watch: this computer's watch went quiet after its Filament was gone a while, so
  // the turns a restart cut were told no more)
  test("a watch that never goes quiet (this computer's): after a long while unseen, what came is told", async () => {
    let t = 80_000_000;
    const { f, call } = fake();
    const w = createWatch({ call, now: () => t, outageMs: Infinity });
    f.runs = [turn({ id: "a", chain: "c1", status: "running", startedAt: t })];
    await w.look();
    f.down = true;
    t += 5 * 60_000;
    assert.equal(await w.look(), null);
    f.down = false;
    t += WATCH_MS;
    f.runs = [turn({ id: "a", chain: "c1", status: "error", startedAt: t - 5 * 60_000, endedAt: t - 1 })];
    assert.deepEqual((/** @type {any} */ (await w.look())).ended.map((/** @type {any} */ e) => [e.chain, e.failed, e.told]), [["c1", true, true]]);
  });

  // (fails before: yes — the review of p3-watch: a null among another Filament's rows threw out the whole look)
  test("what another Filament answers that is no row is passed over: the look stands on the rows it has", async () => {
    let t = 0;
    const { f, call } = fake();
    const odd = async (/** @type {string} */ p) => {
      if (p === "/your-space?glance=0") return { projects: [null, { id: "p1", name: "app" }], needs: [null, { id: "w1", project: "p1", state: "open" }] };
      const r = await call(p);
      if (r.runs) return { runs: [null, 7, ...r.runs] };
      if (r.sessions) return { sessions: [null, ...r.sessions] };
      if (r.events) return { events: [null, ...r.events] };
      return r;
    };
    const w = createWatch({ call: odd, now: () => t });
    f.runs = [turn({ id: "r1", chain: "c1", status: "paused", events: 1 })];
    f.events.r1 = [{ n: 1, type: "ask", kind: "permission", id: "a1", question: "Bash npm test", ts: 0 }];
    const l = /** @type {any} */ (await w.look());
    assert.equal(l.needs, 1);
    assert.equal(f.asked.filter((p) => p.startsWith("/memory/sessions")).length, 1);
  });
});

// (fails before: yes — the owner's remote Filament of 11-06, p3-watch: the tray and the notifications watched this
// computer's Filament alone; a machine on the rail said nothing until its page was opened)
describe("every machine, watched", () => {
  /** @type {import("../desktop/lib/machines.js").Machine[]} */
  const MACHINES = [
    { id: "m-box", name: "Studio", partition: "persist:machine-m-box", addedAt: 0, routes: [{ kind: "lan", url: "https://192.168.0.9:20343", fingerprint: `${"AB:".repeat(31)}CD` }] },
    { id: "m-mac", name: "Mac mini", partition: "persist:machine-m-mac.1", addedAt: 0, routes: [{ kind: "url", url: "https://mac.tail1234.ts.net" }] },
  ];
  /** Two fake Filaments, each by its origin: what it answers, whether it answers, what reached it and with which cookie. */
  const fleetOf = () => {
    // `hold`: its answers wait for it; `marks`: a chat's unread mark answered so, whatever else is (0: as the rest);
    // `letGo`: how many refusals' bodies were let go unread; `hits`: how many requests reached it.
    const at = /** @type {Record<string, { runs: any[], events: Record<string, any[]>, down: boolean, status: number, hold: Promise<unknown> | null, marks: number, letGo: number, hits: number }>} */ ({
      "https://192.168.0.9:20343": { runs: [], events: {}, down: false, status: 200, hold: null, marks: 0, letGo: 0, hits: 0 },
      "https://192.168.0.10:20343": { runs: [], events: {}, down: false, status: 200, hold: null, marks: 0, letGo: 0, hits: 0 },
      "https://mac.tail1234.ts.net": { runs: [], events: {}, down: false, status: 200, hold: null, marks: 0, letGo: 0, hits: 0 },
    });
    /** @type {{ kind: string, url: string, cookie: string, method: string, body: string }[]} */
    const asked = [];
    /** Which machines answer as themselves at their way. @type {Record<string, boolean>} */
    const answers = { "m-box": true, "m-mac": true };
    /** @type {string[]} */
    const picked = [];
    const pick = async (/** @type {any} */ m) => {
      picked.push(`${m.id} ${m.routes.length}`);
      return answers[m.id] ? { route: m.routes[0], name: m.name, version: "1", tried: [] } : { route: null, name: null, version: null, tried: [{ url: m.routes[0].url, why: `nothing listens at ${m.routes[0].url}` }] };
    };
    const fetchOf = (/** @type {any} */ route) => /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
      const u = new URL(url);
      const s = at[u.origin];
      asked.push({ kind: route.kind, url: `${u.pathname}${u.search}`, cookie: String(init.headers.cookie || ""), method: init.method || "GET", body: String(init.body || "") });
      s.hits++;
      if (s.hold) await s.hold;
      const mark = init.method === "PATCH" && s.marks > 0;
      if (s.down && !mark) throw new TypeError("fetch failed");
      const status = mark ? s.marks : s.status;
      if (status !== 200) return new Response(new ReadableStream({ pull: (c) => c.enqueue(new TextEncoder().encode("{}")), cancel: () => void s.letGo++ }), { status });
      const p = `${u.pathname}${u.search}`.replace(/^\/api/, "");
      const m = /^\/runs\/([^/]+)\/events/.exec(p);
      const body = p === "/runs?limit=50" ? { runs: s.runs } : p.startsWith("/memory/sessions") ? { sessions: [{ id: "c1", title: "Parser refactor", projectName: "shop-api" }] } : m ? { events: s.events[m[1]] || [] } : {};
      return new Response(JSON.stringify(body), { status: 200 });
    });
    return { at, asked, answers, picked, pick, fetchOf };
  };
  const turn = (/** @type {any} */ o) => ({ kind: "agent-turn", startedAt: 0, endedAt: null, events: 1, ...o, meta: { chain: o.chain, model: "m" } });
  const cookieOf = async (/** @type {string} */ partition, /** @type {string} */ origin) => `__Host-filament_device=${partition}@${new URL(origin).hostname}`;
  const settle = () => new Promise((r) => setImmediate(r));
  const ask = (/** @type {string} */ id) => ({ n: 1, type: "ask", kind: "permission", id, question: "Bash rm -rf build", ts: 1 });

  test("one watch per machine, at the way where it answers as itself, with the sign-in its partition holds; its first look learns", async () => {
    let t = 1_000_000;
    const x = fleetOf();
    const fleet = createFleet({ machines: () => MACHINES, cookieOf, pick: x.pick, fetchOf: x.fetchOf, now: () => t });
    x.at["https://192.168.0.9:20343"].runs = [turn({ id: "r1", chain: "c1", status: "paused" })];
    x.at["https://192.168.0.9:20343"].events.r1 = [ask("a1")];
    const first = await fleet.look();
    assert.deepEqual(first.map((m) => [m.id, m.status, m.look]), [["m-box", "reconnecting", null], ["m-mac", "reconnecting", null]], "its way is picked aside from the tick");
    assert.equal(x.asked.length, 0, "nothing sent before a way answered as the machine");
    await settle();
    t += WATCH_MS;
    const second = await fleet.look();
    assert.deepEqual(second.map((m) => [m.id, m.name, m.status, m.needs, m.look?.needsNew.length]), [["m-box", "Studio", "online", 1, 0], ["m-mac", "Mac mini", "online", 0, 0]], "what waited before it was watched: counted, not told");
    const runs = x.asked.filter((a) => a.url === "/api/runs?limit=50");
    assert.deepEqual(runs.map((a) => [a.kind, a.cookie]), [["lan", "__Host-filament_device=persist:machine-m-box@192.168.0.9"], ["url", "__Host-filament_device=persist:machine-m-mac.1@mac.tail1234.ts.net"]], "each over its own way — the network's pinned —, with its own partition's sign-in");
    assert.deepEqual(x.picked, ["m-box 1", "m-mac 1", "m-box 1", "m-mac 1"], "its way asked again before the look");
    // A chat on Studio comes to need you: Studio's look tells it, the Mac's nothing.
    x.at["https://192.168.0.9:20343"].runs = [turn({ id: "r2", chain: "c2", status: "running", events: 1 }), ...x.at["https://192.168.0.9:20343"].runs];
    x.at["https://192.168.0.9:20343"].events.r2 = [ask("a2")];
    t += WATCH_MS;
    const third = await fleet.look();
    assert.deepEqual(third.map((m) => [m.id, m.needs, m.look?.needsNew.map((r) => r.chain)]), [["m-box", 2, ["c2"]], ["m-mac", 0, []]]);
    // A chat's unread mark goes to its own machine, with its sign-in; a refusal there (a view-only device's) is all.
    await fleet.markUnread("m-mac", "c 9");
    assert.deepEqual(x.asked.at(-1), { kind: "url", url: "/api/sessions/c%209/settings", cookie: "__Host-filament_device=persist:machine-m-mac.1@mac.tail1234.ts.net", method: "PATCH", body: JSON.stringify({ patch: { display: { unread: true } } }) });
    x.at["https://mac.tail1234.ts.net"].status = 403;
    await fleet.markUnread("m-mac", "c9");
    await fleet.markUnread("m-gone", "c9");
  });

  test("a machine that stops answering as itself: nothing more goes there, its way is picked anew, and it is back without a flood; one that refuses the sign-in says so; one removed is forgotten", async () => {
    let t = 2_000_000;
    const x = fleetOf();
    let list = MACHINES;
    const fleet = createFleet({ machines: () => list, cookieOf, pick: x.pick, fetchOf: x.fetchOf, now: () => t });
    const mac = x.at["https://mac.tail1234.ts.net"];
    mac.runs = [turn({ id: "m1", chain: "c1", status: "running", startedAt: t - LONG_MS })];
    await fleet.look();
    await settle();
    t += WATCH_MS;
    await fleet.look();
    // The Mac's address answers as another machine now: its sign-in goes nowhere, and it is reconnecting, then offline.
    x.answers["m-mac"] = false;
    const sent = x.asked.length;
    t += WATCH_MS;
    const away = await fleet.look();
    assert.deepEqual(away.map((m) => [m.id, m.status, m.why]), [["m-box", "online", null], ["m-mac", "reconnecting", "nothing listens at https://mac.tail1234.ts.net"]]);
    assert.equal(x.asked.slice(sent).filter((a) => a.cookie.includes("m-mac")).length, 0, "nothing sent to an address that did not answer as the machine");
    for (let i = 0; i < 3; i++) {
      t += WATCH_MS;
      await fleet.look();
      await settle();
    }
    t += WATCH_MS;
    assert.equal((await fleet.look())[1].status, "offline", `silent ${RECONNECT_MS / 1000} s and more`);
    // Meanwhile its turn ended with an error and another chat came to need you: back, it learns both, tells neither.
    mac.runs = [turn({ id: "m1", chain: "c1", status: "error", startedAt: t - 2 * LONG_MS, endedAt: t - 1 }), turn({ id: "m2", chain: "c2", status: "paused", events: 1 })];
    mac.events.m2 = [ask("q1")];
    x.answers["m-mac"] = true;
    await settle();
    t += WATCH_MS;
    await fleet.look();
    await settle();
    t += WATCH_MS;
    const back = (await fleet.look())[1];
    assert.deepEqual([back.status, back.needs, back.look?.needsNew, back.look?.ended.map((e) => [e.chain, e.told])], ["online", 1, [], [["c1", false]]], "no flood after an outage; the ended turn listed for its unread mark");
    // Its Filament answers as itself and refuses this window's sign-in (revoked there): said, not counted.
    mac.status = 403;
    t += WATCH_MS;
    const refused = (await fleet.look())[1];
    assert.deepEqual([refused.status, refused.refused, refused.needs, refused.look], ["online", true, 0, null]);
    // Removed from the rail: forgotten, and nothing more asked of it.
    list = [MACHINES[0]];
    const before = x.asked.length;
    t += WATCH_MS;
    assert.deepEqual((await fleet.look()).map((m) => m.id), ["m-box"]);
    assert.equal(x.asked.slice(before).filter((a) => a.cookie.includes("m-mac")).length, 0);
    // Its Filament that does not answer at all: the way picked anew.
    x.at["https://192.168.0.9:20343"].down = true;
    t += WATCH_MS;
    assert.deepEqual((await fleet.look()).map((m) => [m.status, m.look]), [["reconnecting", null]]);
  });

  // (fails before: yes — the owner's of 11-08: a machine kept was watched and told of, whatever)
  test("a machine disconnected is watched no more: its ways not asked, nothing sent there, no row of it, no mark written; connected again, what came meanwhile is learned, not told", async () => {
    let t = 3_000_000;
    const x = fleetOf();
    /** @type {any[]} */
    let list = MACHINES;
    const fleet = createFleet({ machines: () => list, cookieOf, pick: x.pick, fetchOf: x.fetchOf, now: () => t });
    await fleet.look();
    await settle();
    t += WATCH_MS;
    await fleet.look();
    const mac = x.at["https://mac.tail1234.ts.net"];
    list = [MACHINES[0], { ...MACHINES[1], off: true }];
    const hits = mac.hits;
    const picks = x.picked.length;
    mac.runs = [turn({ id: "m2", chain: "c2", status: "paused", events: 1 })];
    mac.events.m2 = [ask("q1")];
    for (let i = 0; i < 3; i++) {
      t += WATCH_MS;
      assert.deepEqual((await fleet.look()).map((m) => m.id), ["m-box"]);
      await settle();
    }
    await fleet.markUnread("m-mac", "c2");
    assert.equal(mac.hits, hits, "nothing reached it");
    assert.deepEqual(x.picked.slice(picks).filter((p) => p.startsWith("m-mac")), [], "its ways not even asked");
    list = MACHINES;
    t += WATCH_MS;
    await fleet.look();
    await settle();
    t += WATCH_MS;
    const back = (await fleet.look()).find((m) => m.id === "m-mac");
    assert.deepEqual([back?.status, back?.needs, back?.look?.needsNew], ["online", 1, []], "no flood as it connects again");
  });

  test("Node's own fetch carries the partition's sign-in to a machine over an SSH tunnel's loopback address, after it answered as itself, and no Origin", async () => {
    /** @type {{ url: string, cookie: string, origin: string | undefined }[]} */
    const seen = [];
    const server = http.createServer((req, res) => {
      seen.push({ url: String(req.url), cookie: String(req.headers.cookie || ""), origin: req.headers.origin });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(req.url === "/.well-known/filament" ? { id: "m-tun", name: "Tunnel" } : req.url === "/api/runs?limit=50" ? { runs: [] } : { sessions: [] }));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
    try {
      const url = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
      const fleet = createFleet({ machines: () => [{ id: "m-tun", name: "Tunnel", partition: "persist:machine-m-tun", addedAt: 0, routes: [{ kind: "url", url }] }], cookieOf: async () => "filament_device=fdt_x" });
      // Its way picked aside from the tick: looked at again until it is watched.
      let [m] = await fleet.look();
      for (let i = 0; i < 100 && !m.look; i++) {
        await new Promise((r) => setTimeout(r, 20));
        [m] = await fleet.look();
      }
      assert.equal(m.status, "online", JSON.stringify(seen));
      assert.deepEqual(seen.map((s) => [s.url, s.cookie]).slice(0, 3), [["/.well-known/filament", ""], ["/.well-known/filament", ""], ["/api/runs?limit=50", "filament_device=fdt_x"]], "asked who answers cookie-less, then watched with its sign-in");
      assert.ok(seen.every((s) => s.origin === undefined), "a program sends no Origin");
    } finally {
      server.close();
    }
  });

  // (fails before: yes — the review of p3-watch: a null among one machine's runs threw out the tick, every machine's
  // look and this computer's with it; and the tick waited on the slowest machine)
  test("a machine whose rows are no rows, or slow to answer, costs no other its look: the slow one's is said at the tick after it lands", async () => {
    let t = 3_000_000;
    const x = fleetOf();
    const fleet = createFleet({ machines: () => MACHINES, cookieOf, pick: x.pick, fetchOf: x.fetchOf, now: () => t, wait: () => new Promise((r) => setTimeout(r, 50)) });
    const box = x.at["https://192.168.0.9:20343"];
    const mac = x.at["https://mac.tail1234.ts.net"];
    await fleet.look();
    await settle();
    t += WATCH_MS;
    await fleet.look();
    box.runs = [null, turn({ id: "r1", chain: "c1", status: "paused" })];
    box.events.r1 = [ask("a1")];
    t += WATCH_MS;
    const odd = await fleet.look();
    assert.deepEqual(odd.map((m) => [m.id, m.status, m.needs]), [["m-box", "online", 1], ["m-mac", "online", 0]]);
    // The Mac slow to answer: the tick waits on it no longer than its wait, Studio's look said, the Mac as it stood.
    let release = () => {};
    mac.hold = new Promise((r) => (release = () => r(null)));
    mac.runs = [turn({ id: "m2", chain: "c2", status: "paused" })];
    mac.events.m2 = [ask("q2")];
    t += WATCH_MS;
    const slow = await Promise.race([fleet.look(), new Promise((r) => setTimeout(() => r("held"), 2000))]);
    assert.notEqual(slow, "held", "the tick waits on no machine slow to answer");
    assert.deepEqual(/** @type {any[]} */ (slow).map((m) => [m.id, m.status, m.needs, m.look === null]), [["m-box", "online", 1, false], ["m-mac", "online", 0, true]]);
    release();
    mac.hold = null;
    await new Promise((r) => setTimeout(r, 20));
    const hits = mac.hits;
    t += WATCH_MS;
    const after = await fleet.look();
    assert.deepEqual(after.map((m) => [m.id, m.look?.needsNew.map((r) => r.chain)]), [["m-box", []], ["m-mac", ["c2"]]], "its look said at the tick after it landed");
    assert.equal(mac.hits, hits, "no other look of it begun before that one was said");
  });

  // (fails before: yes — the review of p3-watch: a machine removed while its look was under way was told of, and its
  // unread marks still written with its partition's sign-in)
  test("a machine removed while its look is under way is told of nothing, nor written to", async () => {
    let t = 4_000_000;
    const x = fleetOf();
    let list = MACHINES;
    const fleet = createFleet({ machines: () => list, cookieOf, pick: x.pick, fetchOf: x.fetchOf, now: () => t, wait: () => new Promise(() => {}) });
    await fleet.look();
    await settle();
    t += WATCH_MS;
    await fleet.look();
    const mac = x.at["https://mac.tail1234.ts.net"];
    let release = () => {};
    mac.hold = new Promise((r) => (release = () => r(null)));
    mac.runs = [turn({ id: "m1", chain: "c1", status: "paused" })];
    mac.events.m1 = [ask("q1")];
    t += WATCH_MS;
    const ticking = fleet.look();
    await settle();
    list = [MACHINES[0]];
    release();
    assert.deepEqual((await ticking).map((m) => m.id), ["m-box"], "its question not told");
    const hits = mac.hits;
    await fleet.markUnread("m-mac", "c1");
    assert.equal(mac.hits, hits, "nothing written to it");
  });

  // (fails before: yes — the review of p3-watch: the way kept was asked again as it was, though the machine no longer
  // listed it — an address another may hold now — and the sign-in went there)
  test("a way the machine no longer lists is asked nothing: its ways are picked anew", async () => {
    let t = 5_000_000;
    const x = fleetOf();
    let list = MACHINES;
    const fleet = createFleet({ machines: () => list, cookieOf, pick: x.pick, fetchOf: x.fetchOf, now: () => t });
    await fleet.look();
    await settle();
    t += WATCH_MS;
    await fleet.look();
    const old = x.at["https://192.168.0.9:20343"];
    const hits = old.hits;
    x.picked.length = 0;
    list = [{ ...MACHINES[0], routes: [{ kind: "lan", url: "https://192.168.0.10:20343", fingerprint: `${"AB:".repeat(31)}CD` }, { kind: "url", url: "https://studio.tail1234.ts.net" }] }, MACHINES[1]];
    t += WATCH_MS;
    await fleet.look();
    await settle();
    assert.deepEqual(x.picked.filter((p) => p.startsWith("m-box")), ["m-box 2"], "picked over every way it lists");
    assert.equal(old.hits, hits, "nothing more to the address it no longer lists");
    t += WATCH_MS;
    await fleet.look();
    assert.ok(x.at["https://192.168.0.10:20343"].hits > 0, "watched at its new way");
  });

  // (fails before: yes — the review of p3-watch: a chat's unread mark refused there, as a view-only device's is, landing
  // as the look's own call failed, said the machine refused this window's sign-in; and a refusal's body held its
  // connection until it was collected)
  test("a chat's unread mark refused there is no refusal of the look under way; a refusal's body is let go", async () => {
    let t = 6_000_000;
    const x = fleetOf();
    const fleet = createFleet({ machines: () => MACHINES, cookieOf, pick: x.pick, fetchOf: x.fetchOf, now: () => t, wait: () => new Promise(() => {}) });
    await fleet.look();
    await settle();
    t += WATCH_MS;
    await fleet.look();
    const mac = x.at["https://mac.tail1234.ts.net"];
    let release = () => {};
    mac.hold = new Promise((r) => (release = () => r(null)));
    mac.down = true;
    mac.marks = 403;
    t += WATCH_MS;
    const ticking = fleet.look();
    await settle();
    const marking = fleet.markUnread("m-mac", "c1");
    release();
    const got = await ticking;
    await marking;
    assert.deepEqual([got[1].refused, got[1].status], [false, "reconnecting"], "its Filament did not answer: that is all");
    assert.equal(mac.letGo, 1, "the mark's refusal: its body let go unread");
  });

  test("one notification a tick, over every machine: the one showing in the window you are in is left out; each chat named with its machine", () => {
    const row = (/** @type {string} */ title, /** @type {string} */ chain, fact = "asks: which branch?") => ({ title, project: "shop-api", fact, chain });
    const here = { machine: "local", needs: [row("Parser refactor", "c1")], ended: [], space: [] };
    const studio = { machine: "m-box", name: "Studio", needs: [row("CSV export", "c7", "waits for your yes: Bash rm -rf /")], ended: [{ title: "Release notes", project: "site", chain: "c8", failed: false, ms: 7 * 60_000 }], space: [{ project: "app", count: 2 }] };
    // One machine, one chat: its own note, as before, named with its machine where that is another's.
    assert.deepEqual(tickNote([here], null), { note: { title: "Parser refactor (shop-api)", text: "Asks you something.", tone: "warning" }, machine: "local", chat: here.needs[0], home: false });
    assert.deepEqual(tickNote([{ ...studio, ended: [], space: [] }], null)?.note, { title: "CSV export (shop-api) on Studio", text: "Waits for your yes.", tone: "warning" });
    assert.equal(tickNote([{ machine: "local", needs: [], ended: [], space: [{ project: "app", count: 1 }] }], null)?.home, true, "Your Space's alone: a press opens it");
    // Several machines, several kinds: one note.
    const both = /** @type {any} */ (tickNote([here, studio], null));
    assert.deepEqual([both.note.title, both.machine, both.chat, both.home], ["2 chats need you, 1 chat done, 2 new in Home", null, null, false]);
    assert.equal(both.note.text, "2 chats need you: Parser refactor (shop-api), CSV export (shop-api) on Studio. Release notes (site) on Studio: done, after 7 min. Home: 2 new need you — app (Studio) 2.");
    assert.equal(both.note.tone, "warning");
    assert.doesNotMatch(both.note.text, /rm -rf|which branch/, "never the question or the command");
    // Silenced only while that machine shows in the window you are in.
    assert.deepEqual(tickNote([here, studio], "local")?.machine, "m-box", "this computer's page is the one you are in: Studio's alone");
    assert.equal(tickNote([here, studio], "m-box")?.note.title, "Parser refactor (shop-api)", "Studio's page is the one you are in: this computer's alone");
    assert.equal(tickNote([here], "local"), null);
    assert.equal(tickNote([{ machine: "m-box", name: "Studio", needs: [], ended: [], space: [{ project: "app", count: 0 }] }], null), null, "nothing new: no note");
    const failed = /** @type {any} */ (tickNote([{ machine: "local", needs: [], ended: [{ title: "A", chain: "a", failed: true, ms: 1 }, { title: "B", chain: "b", failed: false, ms: LONG_MS }], space: [{ project: "app", count: 1 }] }], null));
    assert.equal(failed.note.title, "2 chats ended, 1 on an error, 1 new in Home");
    assert.ok(tickNote([{ machine: "local", needs: Array.from({ length: 40 }, (_, i) => row(`Chat ${"x".repeat(60)} ${i}`, `c${i}`)), ended: [{ title: "y".repeat(90), chain: "e", failed: true, ms: 1 }], space: [] }], null)?.note.text.length === 240, "long words are cut");
    // (fails before: yes — the remote desk of 11-22: a press on another machine's chat showed its machine, not the chat)
    // Another machine's one chat: the note says which, its chain and its thread with it, as this computer's does.
    const there = /** @type {any} */ (tickNote([{ ...studio, needs: [{ ...studio.needs[0], thread: "s2" }], ended: [], space: [] }], null));
    assert.deepEqual([there.machine, there.chat?.chain, there.chat?.thread, there.home], ["m-box", "c7", "s2", false]);
    assert.equal(tickNote([{ ...studio, needs: [], ended: [] }], null)?.home, true, "its Home's alone: a press opens its Home");
    // main.js: each machine's part, the one showing left out, and a press that opens the chat it names on its machine —
    // another's at that chat in its page in the window (rail.js `openOn`), else that machine shown (pinned in the source).
    const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
    assert.match(main, /\.\.\.others\.flatMap\(\(m\) => \(m\.look \? \[\{ machine: m\.id, name: m\.name, needs: m\.look\.needsNew, ended: m\.look\.ended\.filter\(\(e\) => e\.told\), space: m\.look\.spaceNew \}\] : \[\]\)\),\n\s+\],\n\s+showing,/);
    assert.match(main, /const route = tick\.chat\?\.chain \? chatRoute\(\{ chain: tick\.chat\.chain, thread: tick\.chat\.thread \}\) : tick\.home \? "#\/your-space" : null;/, "every machine's chat, not this computer's alone");
    assert.match(main, /const openSaid = \(route, machine\) => \(machine === null \? void openWindow\("harness"\) : machine !== LOCAL_ID \? showMachine\(machine, route\) : route \? void openWindow\("harness", route\) : openCard\(\)\);/);
    assert.match(main, /const showMachine = \(id, route = null\) => \{\n\s+openWindow\("harness"\);\n\s+if \(!route \|\| !rail\?\.openOn\(id, route\)\) rail\?\.select\(id\);\n\s+\};/);
    assert.match(main, /tray\.on\("balloon-click", \(\) => openSaid\(saidOf\.route, saidOf\.machine\)\);/);
  });

  test("each machine's watch reads through its partition's session; a turn's unread mark goes to its machine where no page of its harness is open here", () => {
    const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
    // One reader of a machine's sign-in, its partition's cookies, for the watch and the agents' switch alike (f-ui).
    assert.match(main, /const cookieOf = async \(partition, url\) => \(await session\.fromPartition\(partition\)\.cookies\.get\(\{ url \}\)\)\.map\(\(c\) => `\$\{c\.name\}=\$\{c\.value\}`\)\.join\("; "\);/);
    assert.match(main, /const fleet = createFleet\(\{ machines: \(\) => readKept\(machinesFile\), pick: pickHeld, cookieOf \}\);/);
    // (fails before: yes — the review of p3-watch: one machine's look that threw threw out this computer's with it)
    assert.match(main, /const \[w, others\] = await Promise\.all\(\[up \? watch\.look\(\)\.catch\(\(\) => null\) : null, fleet\.look\(\)\.catch\(\(\) => \[\]\)\]\);/, "every other machine watched whatever this computer's Filament does, each read on its own");
    // (fails before: yes — the review of p3-watch: this computer's watch went quiet after a restart)
    assert.match(main, /const watch = createWatch\(\{ call: [^\n]+, outageMs: Infinity \}\);/, "this computer's tells after a restart what the restart cut");
    assert.match(main, /for \(const m of others\) if \(m\.look && !holdsHarness\(m\.partition\)\) for \(const e of m\.look\.ended\) void fleet\.markUnread\(m\.id, e\.chain\);/);
    assert.match(main, /remotePages\.set\(contents, String\(\/\*\* @type \{any\} \*\/ \(o\.prefs\)\.partition \|\| ""\)\);/, "the rail's views, by their partition");
  });

  test("the tray: a row for each machine — its chats that wait on you, or why it is not watched —, and the tooltip counts them all, saying where", () => {
    /** @type {import("../desktop/lib/tray.js").MachineRow[]} */
    const machines = [
      { id: "local", name: "This computer", local: true, status: "online", needs: 1 },
      { id: "m-box", name: "Studio", status: "online", needs: 2 },
      { id: "m-mac", name: "Mac mini", status: "offline", needs: 0 },
      { id: "m-old", name: "Old laptop", status: "online", refused: true, needs: 0 },
      { id: "m-new", name: "New laptop", status: "reconnecting", needs: 0 },
      { id: "m-calm", name: "Calm", status: "online", needs: 0 },
    ];
    const rows = trayRows({ owned: true, state: "up", port: 20300, machines });
    const labels = rows.map((r) => ("type" in r ? "-" : `${r.id}: ${r.label}`));
    assert.deepEqual(labels.slice(0, 10), [
      "card: Show the card",
      "harness: Open Filament",
      "dashboard: Open the dashboard",
      "-",
      "machine:local: This computer — 1 chat needs you",
      "machine:m-box: Studio — 2 chats need you",
      "machine:m-mac: Mac mini — offline",
      "machine:m-old: Old laptop — signed out here",
      "machine:m-new: New laptop — reconnecting",
      "machine:m-calm: Calm",
    ]);
    assert.equal(labels[10], "-");
    // (fails before: yes — the owner's of 11-08) One disconnected: said so, whatever it counted before.
    const offRow = /** @type {any} */ (trayRows({ owned: true, state: "up", port: 20300, machines: [machines[0], { id: "m-off", name: "Old box", status: "disconnected", needs: 3 }] }).find((r) => "id" in r && r.id === "machine:m-off"));
    assert.equal(offRow?.label, "Old box — disconnected");
    assert.deepEqual(trayRows({ owned: true, state: "up", port: 20300, machines: [machines[0]] }).map((r) => ("type" in r ? "-" : r.id)), trayRows({ owned: true, state: "up", port: 20300 }).map((r) => ("type" in r ? "-" : r.id)), "no machine kept beside this computer: the menu as it was");
    assert.equal(trayTip({ owned: true, state: "up", port: 20300, needs: 9, machines }), "Filament · port 20300 · 3 chats need you, on 2 machines");
    assert.equal(trayTip({ owned: true, state: "up", port: 20300, machines: [{ ...machines[0], needs: 0 }, machines[1]] }), "Filament · port 20300 · 2 chats need you, on Studio");
    assert.equal(trayTip({ owned: true, state: "up", port: 20300, machines: [machines[0]] }), "Filament · port 20300 · 1 chat needs you");
    assert.equal(trayTip({ owned: true, state: "restarting", port: 20300, machines }), "Filament · restarting… · 2 chats need you, on Studio", "this computer's Filament away: the other machines' alone");
    assert.equal(trayTip({ owned: false, state: "attached", port: 20300, gone: true, machines }), "Filament · port 20300 · started elsewhere, not answering · 2 chats need you, on Studio");
    // main.js: a machine's row shows it in the harness window.
    const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
    assert.match(main, /if \(id\.startsWith\("machine:"\)\) return void showMachine\(id\.slice\("machine:"\.length\)\);/);
    assert.match(main, /const showMachine = \(id, route = null\) => \{\n\s+openWindow\("harness"\);\n\s+if \(!route \|\| !rail\?\.openOn\(id, route\)\) rail\?\.select\(id\);\n\s+\};/);
  });

  // (fails before: yes — the owner's of 11-08: the counts were a stylesheet put into the rail's page)
  test("each machine's count of chats that wait on you: its row in the popover and the chips' counts, as the watch last saw it — a number alone", () => {
    const rows = railRows(
      [{ id: "local", name: "This computer", routes: [], partition: "", addedAt: null, local: true }, { id: "m-box", name: "<b>Studio</b>", routes: [], partition: "persist:machine-m-box", addedAt: null }],
      () => ({ status: "online", silentSince: null, why: null }),
      "local",
      (id) => (id === "m-box" ? /** @type {any} */ ("120<script>") : 3),
    );
    assert.deepEqual(rows.map((r) => r.waiting), [3, 0], "not a number: none");
    const counted = railRows([{ id: "m-box", name: "Studio", routes: [], partition: "persist:machine-m-box", addedAt: null }], () => null, "local", () => 120);
    assert.match(railState(counted, { dark: true }).list, /<span class="ct">99\+<\/span>/);
    const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
    assert.match(main, /const waitingOn = \(id\) => Number\(machineRows\.find\(\(m\) => m\.id === id\)\?\.needs\) \|\| 0;/);
    assert.match(main, /localWatched,\n\s+waiting: waitingOn,/);
    assert.match(main, /machineRows = rows;\n\s+paintTray\(\);\n\s+rail\?\.paint\(\);/, "told as the counts move");
    assert.doesNotMatch(main, /railCountsCss|paintCounts/);
  });
});

// (fails before: yes — the owner's of 11-07: the tray and the windows took filament.ico on every system, which macOS's
// menu bar draws as a colour square and Linux's windows don't read)
test("each system's icons: Windows its .ico, macOS's menu bar a template with its @2x and no window icon, Linux colour PNGs; each file there and packed", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  assert.deepEqual(iconsOf(root, "win32"), { tray: join(root, "tray", "filament-tray.ico"), window: join(root, "tray", "filament.ico") });
  assert.deepEqual(iconsOf(root, "darwin"), { tray: join(root, "tray", "filament-trayTemplate.png") });
  assert.deepEqual(iconsOf(root, "linux"), { tray: join(root, "tray", "filament-tray.png"), window: join(root, "tray", "filament-window.png") });
  for (const f of ["filament-trayTemplate.png", "filament-trayTemplate@2x.png", "filament-tray.png", "filament-tray@2x.png", "filament-window.png"]) assert.ok(existsSync(join(root, "tray", f)), f);
  const yml = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");
  assert.match(yml, /^ {2}- tray\/filament-\*\.png$/m, "packed beside filament.ico");
  assert.match(yml, /^ {2}icon: build\/icon-mac\.png$/m);
  const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
  assert.match(main, /const tray = new Tray\(ICONS\.tray\);/);
  assert.equal((main.match(/\.\.\.\(ICONS\.window \? \{ icon: ICONS\.window \} : \{\}\),/g) || []).length, 2, "the harness's window and a popped pane's");
  assert.doesNotMatch(main, /"filament\.ico"/);
});

/** The sizes an .ico holds, from its directory: a width or height of 0 there is 256. @param {Buffer} b */
const icoSizes = (b) => Array.from({ length: b.readUInt16LE(4) }, (_, i) => [b[6 + i * 16] || 256, b[7 + i * 16] || 256]);

// (fails before: yes — the owner's of 11-10: the tray took filament.ico resized to 16 px, which Windows at 200% drew
// twice as large, faint and pixelated)
test("Windows's tray: an .ico of its own with a size for each scale, packed, read by its path and never resized; the windows keep filament.ico", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const tray = icoSizes(readFileSync(join(root, "tray", "filament-tray.ico")));
  for (const s of [16, 20, 24, 28, 32, 36, 40, 48]) assert.ok(tray.some(([w, h]) => w === s && h === s), `${s} px, for ${(s / 16) * 100}%`);
  assert.ok(icoSizes(readFileSync(join(root, "tray", "filament.ico"))).some(([w]) => w === 256), "the windows' and the installer's keep their large sizes");
  const yml = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");
  assert.match(yml, /^ {2}- tray\/filament-tray\.ico$/m, "packed");
  const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
  assert.doesNotMatch(main, /\.resize\(/, "a resized image loses the .ico's sizes: Windows scales the one left");
  const script = readFileSync(new URL("../scripts/make-icons.py", import.meta.url), "utf8");
  assert.match(script, /save\("tray\/filament-tray\.ico"/, "made with the others");
});

// (fails before: yes — the owner's Mac of 11-08: a click on the menu bar's icon opened the tray's menu over the card it
// opened, and the Filament menu beside the Apple held Edit's rows, with no Quit)
test("on a Mac the tray's menu opens at a right-click alone, and the menu bar's Filament menu is the app's own, with Quit", () => {
  const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
  assert.match(main, /trayMenu = Menu\.buildFromTemplate\(trayRows\(facts\(\)\)/);
  assert.match(main, /if \(process\.platform !== "darwin"\) tray\.setContextMenu\(trayMenu\);/, "Windows and Linux keep theirs on the icon");
  assert.match(main, /tray\.on\("right-click", \(\) => \{\n\s*if \(process\.platform === "darwin" && trayMenu\) tray\.popUpContextMenu\(trayMenu\);\n\s*\}\);/);
  assert.equal((main.match(/setContextMenu\(/g) || []).length, 1, "no other menu set on the icon");
  // A Mac's Ctrl-click is its right-click: it comes as a click with Ctrl held (the review of the change).
  assert.match(main, /tray\.on\("click", \(e\) => \{\n\s*if \(process\.platform === "darwin" && e\?\.ctrlKey && trayMenu\) return void tray\.popUpContextMenu\(trayMenu\);/);
  // Declared before the paint that sets it, which the watch and the supervisor call from earlier in the file.
  assert.ok(main.indexOf("let trayMenu = null;") < main.indexOf("function paintTray()"));
  assert.match(main, /Menu\.buildFromTemplate\(\[\n\s*\.\.\.\(process\.platform === "darwin" \? \[\{ role: \/\*\* @type \{const\} \*\/ \("appMenu"\) \}\] : \[\]\),\n\s*\{ label: "Edit",/, "the app's menu first: About, Hide, Quit");
  // Its Quit (⌘Q) is the tray's: the app's before-quit asks before it stops a Filament at work.
  assert.match(main, /app\.on\("before-quit", \(e\) => \{\n\s*if \(quitting\) return;\n\s*e\.preventDefault\(\);\n\s*void quit\(\);/);
});

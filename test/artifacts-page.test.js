// @ts-check
// HarnessV4_Artifacts_Plan E18 step 2, the page: an artifact's card in the answer, its tab in the side pane, its full
// view and the frame they show its page in. What is pure is tested here — its mark by its icon word, its address and
// origin at the page's port, where a page can frame it, the frame's name and flags, its tab, its words, its route, its
// place in the turn, and the words a failure in it is said in; the DOM's guards are pinned in its source, and it was
// driven in a browser (the Logs, step 2).
// (fails before: yes — none of it existed: step 1 said a publish as a tool row and nothing else)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as server from "../src/core/artifacts.js";
import { PAGE_SCRIPT_TEXT } from "../src/http/artifacts.js";
import { ICONS } from "../src/ui/harness/lib/icons.js";
import {
  APP_FRAME_ALLOW, APP_FRAME_SANDBOX, ART_DOMAIN, FRAME_ALLOW, FRAME_SANDBOX, ICON_MARKS, LOOK_MARK, artifactAddress, artifactOrigin, artifactTabId, frameableAt, isArtifactName,
  lookName, madeLine, markOf, parseArtifactTabId, portOf, titleOfName, typeWord, versionWords,
  askWords, askingChat, byMonth, dataWords, filterChoices, keepsWords, lastTouched, madeWhere, projectOf, shownArtifacts, sizeWords,
  touchedWords, versionAddress, versionBy, versionLine, stillAddress, stillOrigin,
} from "../src/ui/harness/lib/artifacts.js";
import { askText, clickedIn } from "../src/ui/harness/lib/frame-ask.js";
import { madeIn } from "../src/ui/harness/lib/subagents.js";
import { PREF_DEFAULTS } from "../src/ui/harness/prefs.js";
import { closedTabsOf, tabCanOpen } from "../src/ui/harness/panes/pane-data.js";
import { isScreen, onScreen, parseRoute, routeFor } from "../src/ui/harness/lib/router.js";
import { alignEvents, cardBoxes, foldSplit, roundDrew, websiteCardsFrom } from "../src/ui/harness/lib/labels.js";
import { ASK_MAX, failureLine, failureWords } from "../src/ui/harness/lib/visuals.js";

const read = (/** @type {string} */ p) => readFileSync(p, "utf8");

describe("the page's copy of the server's words (AF-D2, AF-D25)", () => {
  test("its domain, its frame's mark, a name; every icon word the tool takes has a mark the harness draws, and a word it does not know is a page's", () => {
    assert.equal(ART_DOMAIN, server.ART_DOMAIN);
    assert.equal(LOOK_MARK, server.LOOK_MARK);
    assert.deepEqual(Object.keys(ICON_MARKS).sort(), [...server.ARTIFACT_ICONS].sort());
    for (const [word, mark] of Object.entries(ICON_MARKS)) assert.ok(/** @type {Record<string, string>} */ (ICONS)[mark], `${word}: ${mark}`);
    assert.deepEqual([markOf("chart"), markOf("nope"), markOf(undefined)], ["chartColumn", "appWindow", "appWindow"]);
    for (const n of ["x-ab12", "a", "a-b", "-a", "a-", "A-b", "a_b", "a".repeat(63), "a".repeat(64), "", null]) assert.equal(isArtifactName(n), server.isArtifactName(n), String(n));
  });

  test("its address at the page's port is the server's; its origin is the address's, http's own port left out as the browser leaves it (AFC-50, AFC-72)", () => {
    for (const port of [20300, 8080, 80]) {
      assert.equal(new URL(artifactAddress("x-ab12", port)).href, new URL(server.artifactAddress("x-ab12", port)).href);
      assert.equal(artifactOrigin("x-ab12", port), new URL(artifactAddress("x-ab12", port)).origin, String(port));
    }
    assert.deepEqual([portOf({ port: "20300", protocol: "http:" }), portOf({ port: "", protocol: "http:" }), portOf({ port: "", protocol: "https:" })], ["20300", "80", "443"]);
  });
});

describe("where its page is shown (AF-D33, AF-D39, AFC-67)", () => {
  test("a page served from this machine by a name a policy can give frames it; an IPv6 address, or another machine, says why and where instead", () => {
    for (const host of ["127.0.0.1", "127.9.8.7", "localhost", "LOCALHOST", "llm.localhost"]) assert.deepEqual(frameableAt(host, 20300), { ok: true }, host);
    const v6 = frameableAt("[::1]", 20300);
    assert.equal(v6.ok, false);
    assert.equal(/** @type {any} */ (v6).why, "An artifact cannot be shown inside Filament opened at an IPv6 address. Open Filament at http://127.0.0.1:20300/ to see it here, or open it in your browser.");
    for (const host of ["mybox.lan", "192.168.1.5", "127.0.0.1.example.com", ""]) assert.equal(/** @type {any} */ (frameableAt(host, 20300)).why, "An artifact opens only on the machine Filament runs on. Open it there, in Filament or in a browser.", host);
  });

  test("its frame's name hands its page the theme and Motion — in the words the page's script reads — and its flags let it run as a page of its own", () => {
    const named = /named=\/(.+?)\/\.exec/.exec(PAGE_SCRIPT_TEXT);
    assert.ok(named, "the page's script reads its frame's name");
    const pattern = new RegExp(named[1]);
    for (const theme of /** @type {const} */ (["light", "dark"])) for (const motion of ["full", "reduced", "off", "", "fast"]) assert.match(lookName(theme, motion), pattern, `${theme} ${motion}`);
    assert.deepEqual([lookName("dark", "off"), lookName("light", "fast")], ["filament-look:dark:off", "filament-look:light:full"]);
    const flags = FRAME_SANDBOX.split(" ");
    for (const f of ["allow-scripts", "allow-same-origin", "allow-forms", "allow-downloads", "allow-popups", "allow-popups-to-escape-sandbox", "allow-modals"]) assert.ok(flags.includes(f), f);
    assert.ok(!flags.some((f) => f.startsWith("allow-top-navigation")), "it never moves the harness's own page");
    assert.equal(FRAME_ALLOW, "clipboard-write");
    // (fails before: yes — the Space Apps plan of 10-29: a game's frame) An app's frame: all of that, and the pointer
    // locked, the screen filled and a gamepad read; no other artifact's.
    assert.deepEqual(APP_FRAME_SANDBOX.split(" "), [...flags, "allow-pointer-lock"]);
    assert.ok(!flags.includes("allow-pointer-lock"));
    assert.equal(APP_FRAME_ALLOW, "clipboard-write; fullscreen; gamepad");
  });

  test("the frame hears only its own window from its own origin, is named before it loads, and its tile keeps it across draws and moves (pinned in the source)", () => {
    const frame = read("src/ui/harness/artifact-frame.js");
    assert.match(frame, /const from = framesNow\(\)\.find\(\(f\) => f\.contentWindow === e\.source\);\s+const at = from \? framed\.get\(from\) : null;\s+if \(at && e\.origin === spokenOrigin\(at\.origin\)\) at\.hear\(e\.data\);/);
    assert.ok(frame.indexOf("frame.name = lookName(look.theme, look.motion);") < frame.lastIndexOf("else frame.src = targetNow();"), "named, then loaded");
    assert.match(frame, /const motion = at\.still \? "off" : look\.motion;\s+f\.name = lookName\(look\.theme, motion, at\.still\);\s+f\.contentWindow\?\.postMessage\(\{ filament: "look", theme: look\.theme, motion \}, sentTo\(spokenOrigin\(at\.origin\)\)\);/, "the look goes to its origin alone — on the network's artifacts address, its frame's page, an origin of none —; a preview keeps still");
    const host = read("src/ui/harness/panes/pane-host.js");
    // A file's tab drawn already is read again in place (the owner's of 11-01) between the kept frame's guard and the
    // draw anew: it too returns before the body is let go.
    assert.match(host, /const kept = \/\*\* @type \{HTMLElement \| null\} \*\/ \(v\.body\.firstElementChild\);\n\s*if \(def\?\.artifact && kept\?\.dataset\.artifactTab === def\.artifact\) return;\n\s*if \(def\?\.thread && v\.letGo && kept\?\.dataset\.thread === def\.thread\) return;\n\s*if \(def\?\.result && v\.letGo && kept\?\.dataset\.result === def\.result\) return;\n(?:\s*\/\/[^\n]*\n)*\s*if \(def\?\.file && kept\?\.dataset\.fileTab === id\) \{\n\s*refreshCodeViewer\(v\.body\);\n\s*return;\n\s*\}\n\s*letGoOf\(v\);\n\s*v\.body\.replaceChildren\(\);/);
    // A new layout moves only the tiles whose place changed: a frame taken out of the document loads again.
    assert.match(host, /placeChildren\(col, kids\);[\s\S]{0,80}placeChildren\(grid, cols\);/);
    assert.doesNotMatch(host, /grid\.replaceChildren\(/);
  });

  test("a load its page said nothing on is the frame having left it: the line says so, with Back to its page (AFC-74, pinned in the source)", () => {
    const frame = read("src/ui/harness/artifact-frame.js");
    assert.match(frame, /if \(m\.kind === "here"\) \{[\s\S]{0,140}?here = true;\s+failures = \[\];\s+left = false;/, "its page, said as it starts");
    assert.match(frame, /frame\.addEventListener\("load", \(\) => \{[\s\S]{0,160}?left = !here;\s+here = false;\s+if \(left\) failures = \[\];\s+paint\(\);/, "a load with no word from it");
    assert.match(frame, /"The frame left this artifact's page\."\),\s+h\("button", \{[^}]*onclick: \(\) => show\(\) \}, "Back"\)/);
    assert.match(frame, /const show = \(\) => \{\s+here = false;\s+left = false;\s+failures = \[\];\s+paint\(\);\s+frame\.src = targetNow\(\);/, "Back loads its page from the start, at the version it shows, at its address now");
  });

  test("a card whose artifact cannot be read says why in words, and opens nothing (AFC-66, pinned in the source)", () => {
    const card = read("src/ui/harness/conversation/artifact.js");
    assert.match(card, /meta\.textContent = err\?\.status === 410 \? "Artifact · deleted" : `Artifact · it could not be read: \$\{String\(err\?\.message \|\| e\)\.replace\(\/\\\.\$\/, ""\)\}\.`;\s+desc\.classList\.add\("hidden"\);\s+open\.disabled = true;\s+linked\(\);/, "a deleted one says so (AFC-78)");
    assert.match(card, /if \(open\.disabled \|\| /, "the card's own click opens nothing either");
    assert.match(card, /whenShown\(el, \(\) => followRecord\(el, at\.name, read, unread\)\);/);
  });
});

describe("its tab, its words, its route", () => {
  test("a tab of its own, kept across reloads and in the recently closed; a name that is no artifact's is no tab (AFC-71)", () => {
    assert.equal(artifactTabId("x-ab12"), "artifact:x-ab12");
    assert.deepEqual(["artifact:x-ab12", "artifact:Bad_Name", "artifact:", "files", "file:x"].map(parseArtifactTabId), ["x-ab12", null, null, null, null]);
    const panes = [{ id: "changes" }, { id: "files" }];
    assert.deepEqual(["files", "artifact:x-ab12", "artifact:Bad_Name", "gone"].filter((id) => tabCanOpen(id, panes)), ["files", "artifact:x-ab12"]);
    assert.deepEqual([...closedTabsOf([{ id: "artifact:x-ab12", label: "Board", icon: "chartColumn", at: 5 }, { id: "artifact:no_no", label: "x" }], panes, 10).entries()], [["artifact:x-ab12", { label: "Board", icon: "chartColumn", at: 5 }]]);
    assert.deepEqual([titleOfName("expense-tracker-k3f9"), titleOfName("board"), titleOfName("q-ab12")], ["Expense tracker", "Board", "Q"]);
  });

  // (fails before: yes — the line read a chat's title from the page's own list, and knew no deleted chat or version
  // by you)
  test("a version on its card, and how many there are once there are more (AFC-65); its type; its full view's line", () => {
    assert.deepEqual([versionWords(1, 0), versionWords(1, 1), versionWords(1, 3), versionWords(3, 3)], ["v1", "v1", "v1 · 3 versions", "v3"]);
    assert.deepEqual([typeWord("page"), typeWord("slides"), typeWord(""), typeWord("nope")], ["Page", "Slides", "Page", "Page"]);
    const day = (/** @type {number} */ ms) => `day ${ms}`;
    const chats = { c1: { title: "Spend chat", gone: false }, c2: { title: "", gone: true } };
    const of = (/** @type {any} */ v) => ({ versions: [{ v: 1, at: 1, model: "m", chain: "c0" }, v], chats });
    assert.equal(madeLine(of({ v: 2, at: 9, model: "glm-5.3", chain: "c1" }), day), "v2 · day 9 · made in “Spend chat” (glm-5.3)");
    assert.equal(madeLine(of({ v: 2, at: 9, model: "glm-5.3", chain: "c3" }), day), "v2 · day 9 · made in a chat (glm-5.3)", "a chat the archive was not asked of");
    assert.equal(madeLine(of({ v: 2, at: 9, model: "glm-5.3", chain: "c2" }), day), "v2 · day 9 · made in a deleted session (glm-5.3)", "AFC-15");
    assert.equal(madeLine(of({ v: 2, at: 9, model: "", chain: null, from: 1 }), day), "v2 · day 9 · v1 made the newest again by you", "AFC-79");
    assert.equal(madeLine(of({ v: 2, at: 9, model: "", chain: null }), day), "v2 · day 9");
    assert.equal(madeLine({ versions: [] }, day), "");
  });

  test("its full view's address: a full-frame screen over the chat; a name that is no artifact's goes home (AF-D36)", () => {
    assert.deepEqual(parseRoute("#/artifacts/x-ab12"), { kind: "artifact", id: "x-ab12" });
    for (const hash of ["#/artifacts/Bad_Name", "#/artifacts/%3Cb%3E"]) assert.deepEqual(parseRoute(hash), { kind: "home" }, hash);
    assert.equal(routeFor("artifact", { id: "x-ab12" }), "#/artifacts/x-ab12");
    assert.deepEqual(parseRoute(routeFor(parseRoute("#/artifacts/x-ab12"))), { kind: "artifact", id: "x-ab12" });
    assert.ok(onScreen("#/artifacts/x-ab12") && !onScreen("#/task/c1"));
    const app = read("src/ui/harness/app.js");
    assert.match(app, /if \(route\.kind !== "artifact"\) frame\.querySelector\(":scope > \.artifact-view"\)\?\.remove\(\);/, "it goes when the address leaves it");
    // (proposal_ux R1: the Session inspector's old address is no screen: it leads to the chat's Overview)
    assert.match(app, /shell\.setScreen\(isScreen\(route\.kind\)\);/, "it covers the frame, the header and the panes with it");
    assert.deepEqual(
      ["settings", "control-room", "artifacts", "artifact", "library", "space", "context", "task", "home"].filter(isScreen),
      ["settings", "control-room", "artifacts", "artifact", "library", "space"],
    );
  });

  // (fails before: yes — the drive opened one from the list, went to a chat, then opened another by its address, and
  // its Back still said Artifacts)
  test("its Back goes to the Artifacts page only when the list opened it; any other address ends that (pinned in the source)", () => {
    const app = read("src/ui/harness/app.js");
    assert.match(app, /onOpen: \(name\) => \{ artifactFromList = true; location\.hash = routeFor\("artifact", \{ id: name \}\); \}/);
    assert.match(app, /if \(route\.kind !== "artifact"\) artifactFromList = false;/);
    assert.ok(app.indexOf('if (route.kind !== "artifact") artifactFromList = false;') < app.indexOf("fromList: artifactFromList,"), "ended before a route reads it");
    assert.equal(app.match(/(?<!let )artifactFromList = /g)?.length, 2, "set by the list's open, ended by any other route, and nowhere else");
  });
});

describe("where its card stands in the turn (AF-D34, AF-D38)", () => {
  test("a publish said on the run is its round's, once for each call; the round that published ends its box, so the card stands after its calls", () => {
    const al = alignEvents([
      { type: "round-start", round: 1 },
      { type: "tool-start", round: 1, id: "p1", name: "artifact", args: "Board" },
      { type: "artifact", round: 1, id: "p1", name: "board-k3f9", v: 1, title: "Board", address: "http://board-k3f9.art.localhost:20300/" },
      { type: "artifact", round: 1, id: "p1", name: "board-k3f9", v: 1, title: "Board", address: "http://board-k3f9.art.localhost:20300/" },
      { type: "tool-end", round: 1, id: "p1", ok: true },
      { type: "artifact", round: 1, id: "p2", name: "board-k3f9", v: 2, title: "Board" },
    ]);
    const c1 = al.byRound.get(1);
    assert.deepEqual(c1.artifacts, [{ id: "p1", name: "board-k3f9", v: 1, title: "Board" }, { id: "p2", name: "board-k3f9", v: 2, title: "Board" }]);
    assert.ok(roundDrew(c1));
    const cellOf = (/** @type {number} */ r, more = {}) => ({ round: r, tools: new Map(), order: [`t${r}`], plan: null, hooks: [], marks: [], reports: [], compactions: [], detaches: [], steers: [], snapshots: [], vetoed: 0, visuals: [], writing: new Map(), artifacts: [], blocksBefore: 1, ...more });
    const text = { kind: "block", block: { type: "text" } };
    const made = new Map([[1, cellOf(1)], [2, cellOf(2, { artifacts: [{ id: "p", name: "b-ab12", v: 1, title: "B" }] })], [3, cellOf(3)]]);
    assert.deepEqual(cardBoxes([text], made, [1, 2, 3], false), [[1, 2], [3]]);
  });

  test("its card never folds with the work, live or settled: before the answer it stands between the work and the words; after them it stays after", () => {
    const seg = (/** @type {string} */ name, kind = "block") => (kind === "block" ? { kind, name, block: { type: "text", text: name } } : { kind, name });
    const names = (/** @type {any} */ split) => Object.fromEntries(Object.entries(split).map(([k, v]) => [k, Array.isArray(v) ? v.map((s) => s.name) : v?.name ?? null]));
    const [cards, page, answer, page2] = [seg("cards", "cards"), seg("page", "artifact"), seg("answer"), seg("page2", "artifact")];
    for (const live of [true, false]) {
      const split = names(foldSplit([cards, page, answer, page2], { live }));
      assert.deepEqual([split.pictures, split.fold, split.lastText], [["page"], ["cards"], "answer"], String(live));
      assert.ok(split.after.includes("page2"), String(live));
    }
  });

  test("the timeline draws each card once by its call, after its round's box or, read from the archive, after the call that published it (pinned in the source)", () => {
    const tl = read("src/ui/harness/conversation/timeline.js");
    assert.match(tl, /let card = v\.made\.get\(k\.id\);\s+if \(!card\) v\.made\.set\(k\.id, \(card = artifactCard\(k, /);
    assert.match(tl, /const pages = published\.filter\(\(x\) => p\.tools\.some\(\(\/\*\* @type \{any\} \*\/ t\) => String\(t\.id\) === x\.call\)\);/);
    assert.match(tl, /\.\.\.\(cell\.artifacts \|\| \[\]\)\.map\(\(\/\*\* @type \{any\} \*\/ k\) => artifactSegment\(v, k\)\),/);
    assert.match(read("src/ui/harness/app.js"), /chat\.made = Array\.isArray\(tr\.artifacts\) \? tr\.artifacts : \[\];/);
  });

  // (fails before: yes — found in the live check: GLM 5.3 gave the page's address in its answer, and a Website card for
  // it stood under the artifact's own card)
  test("its address in the answer stays a link: no Website card beside its own (AFC-77)", () => {
    const said = `Published Tip calculator — http://tip-calculator-wjaf.${ART_DOMAIN}:49312/. See also https://example.com/docs.`;
    assert.deepEqual(websiteCardsFrom(said).map((c) => c.url), ["https://example.com/docs"]);
    assert.deepEqual(websiteCardsFrom(`http://x.${ART_DOMAIN}.evil.example/`).map((c) => c.title), [`x.${ART_DOMAIN}.evil.example`], "only a name under the domain is one");
  });
});

describe("what failed in its page, in words (AFC-25, AFC-8)", () => {
  const own = "http://board-k3f9.art.localhost:20300";
  const o = /** @type {const} */ ({ thing: "artifact", own });
  test("a file of its own by its path, an error in one with its line; a library by its name; a host it may not reach", () => {
    assert.equal(failureWords({ what: "load", url: `${own}/js/app.js` }, o), "js/app.js could not load");
    assert.equal(failureWords({ what: "error", message: "Uncaught TypeError: x is not a function", line: 12, url: `${own}/js/app.js` }, o), "Its script failed: TypeError: x is not a function (js/app.js, line 12)");
    assert.equal(failureWords({ what: "error", message: "boom", url: `${own}/` }, o), "Its script failed: boom (its page)");
    assert.equal(failureWords({ what: "error", message: "boom", line: 4 }, o), "Its script failed: boom (line 4)");
    assert.equal(failureWords({ what: "load", url: "https://cdn.jsdelivr.net/npm/chart.js@4" }, o), "Chart.js could not load from cdn.jsdelivr.net");
    assert.equal(failureWords({ what: "blocked", url: "https://evil.example/x" }, o), "It tried to reach evil.example, which an artifact cannot");
    assert.equal(failureWords({ what: "blocked", url: "https://evil.example/x" }), "It tried to reach evil.example, which a visual cannot", "a visual's words are as they were");
  });

  test("the line under its page, and what Tell the agent writes: the artifact by its title and name", () => {
    const line = failureLine("Board (board-k3f9)", [{ what: "error", message: "boom", line: 3, url: `${own}/a.js` }, { what: "error", message: "boom", line: 3, url: `${own}/b.js` }], o);
    assert.deepEqual(line, {
      line: "Its script failed: boom (a.js, line 3) · and 1 more",
      more: ["Its script failed: boom (a.js, line 3)", "Its script failed: boom (b.js, line 3)"],
      tell: "The artifact Board (board-k3f9) shows errors: Its script failed: boom (a.js, line 3); Its script failed: boom (b.js, line 3).",
    });
  });
});

describe("the Artifacts page (step 4, AF-D9, AF-D10)", () => {
  const day = (/** @type {number} */ ms) => `d${ms}`;
  /** An artifact as the admin API gives it, with what a case names. @param {any} o @returns {any} */
  const art = (o) => ({ name: "x-0000", title: "X", description: "", icon: "page", type: "page", createdAt: 0, updatedAt: 0, pinned: false, viewedAt: 0, folder: "", model: "", address: "", versions: [{ v: 1, at: 0, model: "", chain: "c1" }], chats: {}, ...o });

  // (fails before: yes — there was no Artifacts page)
  // (fails before: yes — proposal_ux V4: the entry stood under Search; it is the Library's fourth row now)
  test("its address, #/artifacts, is a full-frame screen; the Library's Artifacts at the left bar's foot goes there (AF-D10, V4)", () => {
    assert.deepEqual([parseRoute("#/artifacts"), parseRoute("#/artifacts/")], [{ kind: "artifacts" }, { kind: "artifacts" }]);
    assert.equal(routeFor("artifacts"), "#/artifacts");
    assert.ok(onScreen("#/artifacts"));
    const side = read("src/ui/harness/sidebar.js");
    assert.match(side, /\{ id: "artifacts", label: "Artifacts", icon: "shapes", tip: "The pages your agents made" \},\n\]\);/, "the Library's last row");
    assert.match(side, /onclick: \(\) => cb\.onLibrary\?\.\(it\.id\)/);
    assert.doesNotMatch(side, /sess-artifacts-row/, "no longer under Search");
    const app = read("src/ui/harness/app.js");
    assert.match(app, /onLibrary: \(page\) => \{ location\.hash = page === "artifacts" \? routeFor\("artifacts"\) : routeFor\("library", \{ page \}\); \}/);
    assert.match(app, /if \(route\.kind !== "artifacts"\) frame\.querySelector\(":scope > \.artifacts-page"\)\?\.remove\(\);/);
    for (const k of ["shapes", "layoutGrid", "list", "link"]) assert.ok(/** @type {any} */ (ICONS)[k], k);
  });

  // (fails before: yes — the same)
  test("what it lists: the tab's, the words found in a title or description, the filter's — the last opened or changed first (AFC-11, AFC-13, AFC-14)", () => {
    const all = [
      art({ name: "a-0001", title: "Expense tracker", description: "money by month", type: "page", folder: "H:\\work\\filament", model: "glm-5.3", updatedAt: 10, viewedAt: 50 }),
      art({ name: "b-0002", title: "Board", type: "dashboard", folder: "/home/me/site/", model: "sonnet", updatedAt: 40, pinned: true }),
      art({ name: "c-0003", title: "Notes", description: "an expense list", type: "doc", folder: "", model: "glm-5.3", updatedAt: 30 }),
    ];
    /** @type {import("../src/ui/harness/lib/artifacts.js").ListAsk} */
    const ask = { tab: "all", query: "", type: "", project: "", model: "" };
    const names = (/** @type {any} */ o) => shownArtifacts(all, { ...ask, ...o }).map((a) => a.name);
    assert.deepEqual(names({}), ["a-0001", "b-0002", "c-0003"], "opened at 50 is later than changed at 40");
    assert.deepEqual(names({ tab: "pinned" }), ["b-0002"]);
    assert.deepEqual(names({ query: " EXPENSE " }), ["a-0001", "c-0003"], "its title or its description");
    assert.deepEqual(names({ type: "dashboard" }), ["b-0002"]);
    assert.deepEqual(names({ project: "filament" }), ["a-0001"]);
    assert.deepEqual(names({ project: "site" }), ["b-0002"], "a folder's last name, its slash aside");
    assert.deepEqual(names({ model: "glm-5.3", query: "list" }), ["c-0003"]);
    assert.deepEqual(filterChoices(all), { types: ["page", "doc", "dashboard"], projects: ["filament", "site"], models: ["glm-5.3", "sonnet"] }, "the types in their own order; nothing empty");
    assert.deepEqual([projectOf("H:\\work\\filament\\"), projectOf("/a/b"), projectOf("")], ["filament", "b", ""]);
    assert.deepEqual([lastTouched(all[0]), touchedWords(all[0], day), touchedWords(all[1], day)], [50, "Viewed d50", "Updated d40"]);
    assert.equal(touchedWords(art({ updatedAt: 9, viewedAt: 9 }), day), "Viewed d9", "opened as it changed: viewed");
  });

  // (fails before: yes — the same)
  test("by month, the newest first, a year named where it is not this one (AF-D9)", () => {
    const at = (/** @type {number} */ y, /** @type {number} */ m, /** @type {number} */ d) => new Date(y, m, d, 12).getTime();
    const shown = [art({ name: "a", updatedAt: at(2027, 9, 20) }), art({ name: "b", updatedAt: at(2027, 9, 2) }), art({ name: "c", updatedAt: at(2027, 8, 30) }), art({ name: "d", updatedAt: at(2026, 9, 5) })];
    const months = byMonth(shown, at(2027, 9, 21), (ms, withYear) => `${new Date(ms).getMonth() + 1}${withYear ? `/${new Date(ms).getFullYear()}` : ""}`);
    assert.deepEqual(months.map((m) => [m.label, m.items.map((a) => a.name)]), [["10", ["a", "b"]], ["9", ["c"]], ["10/2026", ["d"]]]);
  });

  // (fails before: yes — the same)
  test("who made a version, in the Versions menu and Info; where a change is asked (AFC-28, AFC-79, AFC-84)", () => {
    const chats = { c1: { title: "Spend", gone: false }, c2: { title: "", gone: true } };
    assert.equal(versionLine({ v: 1, at: 5, model: "glm-5.3", chain: "c1" }, chats, day), "v1 · d5 · glm-5.3 · made in “Spend”");
    assert.equal(versionLine({ v: 2, at: 6, model: "m-h", chain: "c1", helper: "sa_1" }, chats, day), "v2 · d6 · m-h, a helper · made in “Spend”");
    assert.equal(versionLine({ v: 3, at: 7, model: "", chain: null, from: 1 }, chats, day), "v3 · d7 · by you, from v1");
    assert.equal(madeWhere({ v: 3, at: 7, model: "", chain: "c2" }, chats), "made in a deleted session", "AFC-15");
    // (fails before: yes — the menu put all of it on one line, cut at its width before the chat's title ended)
    assert.equal(versionBy({ v: 2, at: 6, model: "m-h", chain: "c1", helper: "sa_1" }, chats), "m-h, a helper · made in “Spend”", "the menu's second line");
    assert.equal(versionBy({ v: 3, at: 7, model: "", chain: null, from: 1 }, chats), "by you, from v1");
    assert.equal(versionBy({ v: 1, at: 5, model: "", chain: null }, chats), "", "nothing known");
    assert.match(read("src/ui/harness/artifact-view.js"), /label: `v\$\{v\.v\} · \$\{dayOf\(v\.at\)\}\$\{v\.v === newest \? " · the newest" : ""\}`,\n\s+desc: versionBy\(v, a\.chats\),/);
    const a = (/** @type {any[]} */ versions) => ({ versions, chats });
    assert.equal(askingChat(a([{ v: 1, chain: "c1" }, { v: 2, chain: "c9" }])), "c9", "the newest's chat");
    assert.equal(askingChat(a([{ v: 1, chain: "c1" }, { v: 2, chain: null, from: 1 }])), "c1", "past one made by you");
    assert.equal(askingChat(a([{ v: 1, chain: "c1" }, { v: 2, chain: "c2" }])), "c1", "past a chat that was deleted");
    assert.equal(askingChat(a([{ v: 1, chain: "c2" }])), null, "none left: a new task");
    // (fails before: yes — a version kept from a visual read as made by a model in its chat)
    const kept = { v: 1, at: 5, model: "", chain: "c1", visual: "v1" };
    assert.equal(versionLine(kept, chats, day), "v1 · d5 · by you · kept from a visual in “Spend”", "AFC-101");
    assert.equal(madeWhere({ ...kept, chain: "c2" }, chats), "kept from a visual in a deleted session");
    assert.equal(madeLine(a([kept]), day), "v1 · d5 · kept from a visual in “Spend”", "the full view's line");
    assert.equal(askingChat(a([kept])), "c1", "a change is asked in the chat it was drawn in");
    assert.equal(askWords("Expense tracker", "  make the totals bold \n"), "Change Expense tracker: make the totals bold");
    assert.deepEqual([sizeWords(900), sizeWords(2048), sizeWords(3 * 1024 * 1024)], ["900 B", "2 KB", "3.0 MB"]);
    assert.equal(versionAddress("x-ab12", "20300", 2), "http://x-ab12.art.localhost:20300/_filament/v/2/");
    assert.equal(stillAddress("x-ab12", "20300", 2), "http://x-ab12.still.art.localhost:20300/_filament/v/2/");
    assert.equal(stillOrigin("x-ab12", "80"), "http://x-ab12.still.art.localhost");
  });

  // (fails before: yes — the same)
  test("the grid's previews: each at its version's own address, loaded near the screen, still, nothing to click (AFC-81, pinned in the source)", () => {
    const frame = read("src/ui/harness/artifact-frame.js");
    const peek = frame.slice(frame.indexOf("export function artifactPreview"));
    assert.match(peek, /whenShown\(box, \(\) => \{/);
    assert.match(peek, /sandbox: "allow-scripts allow-same-origin"/, "no popups, forms or downloads");
    assert.match(peek, /tabindex: "-1"/);
    assert.match(peek, /frame\.name = lookName\(lookNow\(\)\.theme, "off", true\);/, "named still: a Doc or a deck shows its start alone (AFC-113)");
    assert.match(peek, /still: true/);
    assert.match(peek, /frame\.src = stillAddress\(name, port, v\);/, "never its address, which counts a view, and on its still origin, which writes nothing");
    assert.match(peek, /origin: stillOrigin\(name, port\)/, "its messages are its still origin's");
    assert.match(frame, /if \(p\.change === "renamed" \|\| p\.change === "pinned" \|\| p\.change === "data"\) return;/, "a rename, a pin or a change to its data leaves a page as it is");
    assert.match(read("src/ui/harness/aqua.css"), /\.artifact-peek-frame \{[^}]*pointer-events: none;/);
  });

  // (fails before: yes — the same)
  test("grid or list stays, in this browser (AFC-12); a deleted one's tab and full view say so (AFC-78, pinned in the source)", () => {
    assert.equal(PREF_DEFAULTS.artifactsLayout, "grid");
    const page = read("src/ui/harness/artifacts-page.js");
    assert.match(page, /onclick: \(\) => \{ prefs\.set\("artifactsLayout", kind\); draw\(\); \}/);
    assert.match(page, /const layout = prefs\.get\("artifactsLayout"\) === "list" \? "list" : "grid";/);
    for (const f of ["src/ui/harness/panes/artifact.js", "src/ui/harness/artifact-view.js"]) assert.match(read(f), /"Artifact · deleted"/, f);
  });

  // (fails before: yes — at 420 px the drive found the full view's Download and ⋮ past the window's edge, the cards in
  // two columns too thin for their words, and the page's title set in from its bar)
  test("on a narrow window its acts wrap inside the head, its cards take one column, its title lines up (pinned in the source)", () => {
    const css = read("src/ui/harness/aqua.css");
    const rule = (/** @type {string} */ sel) => css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.>]/g, (c) => `\\${c}`)} \\{([^}]*)\\}`))?.[1] || "";
    assert.match(rule(".artifact-view-acts"), /flex: 0 1 auto; min-width: 0; flex-wrap: wrap;/, "shrinks, so it can wrap");
    assert.match(rule(".artifacts-grid"), /minmax\(min\(220px, 100%\), 1fr\)/);
    assert.doesNotMatch(css, /minmax\(150px, 1fr\)/, "no thinner column on a narrow window");
    assert.match(css, /\.artifacts-scroll > \.set-title, \.artifacts-scroll > \.set-desc \{ max-width: none; padding-inline: 0; \}/);
  });
});

describe("what a page keeps and asks, in the harness (step 5, AF-D7, AF-D8)", () => {
  /**
   * Run `fn` with the page's focus on `active` and the person's activation as given, as a browser would have them.
   * @param {any} active @param {boolean} activation @param {() => void} fn
   */
  const asIf = (active, activation, fn) => {
    const had = Object.getOwnPropertyDescriptor(globalThis, "document");
    const hadNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "document", { value: { activeElement: active }, configurable: true, writable: true });
    Object.defineProperty(globalThis, "navigator", { value: { userActivation: { isActive: activation } }, configurable: true, writable: true });
    try {
      fn();
    } finally {
      if (had) Object.defineProperty(globalThis, "document", had);
      else delete (/** @type {any} */ (globalThis)).document;
      if (hadNav) Object.defineProperty(globalThis, "navigator", hadNav);
      else delete (/** @type {any} */ (globalThis)).navigator;
    }
  };

  // (fails before: yes — only a visual's card had the guard, as its own copy)
  test("a framed page's ask counts only right after the person's click in that frame; its words trimmed, cut as a visual's", () => {
    const frame = {};
    asIf(frame, true, () => assert.equal(clickedIn(/** @type {any} */ (frame)), true));
    asIf(frame, false, () => assert.equal(clickedIn(/** @type {any} */ (frame)), false, "a timer's ask, after the click's moment"));
    asIf({}, true, () => assert.equal(clickedIn(/** @type {any} */ (frame)), false, "a click elsewhere"));
    assert.deepEqual([askText("  Sum it up \n"), askText(null), askText(42), askText("x".repeat(ASK_MAX + 5)).length], ["Sum it up", "", "42", ASK_MAX]);
    const card = read("src/ui/harness/conversation/visual.js");
    assert.match(card, /import \{ askText, clickedIn \} from "\.\.\/lib\/frame-ask\.js";/, "the visual's card keeps the one rule");
    assert.match(card, /if \(!clickedIn\(frame\)\) return;\s+if \(m\.kind === "ask"\) \{\s+const text = askText\(m\.text\);/);
  });

  // (fails before: yes — an artifact's page could not ask)
  test("its page's ask: heard in its frame only after a click; the side pane's into the chat beside it, the full view's into the chat that made it; a preview asks nothing (AFC-98, AFC-99, pinned in the source)", () => {
    const frame = read("src/ui/harness/artifact-frame.js");
    assert.match(frame, /if \(m\.kind === "ask"\) \{\s+const text = clickedIn\(frame\) \? askText\(m\.text\) : "";\s+if \(text\) o\.onAsk\(text\);\s+return;\s+\}/);
    assert.match(frame.slice(frame.indexOf("export function artifactPreview")), /hear: \(\) => \{\}/, "a preview's messages go nowhere");
    assert.match(read("src/ui/harness/panes/artifact.js"), /artifactFrame\(o\.name, \{ title: titleOfName\(o\.name\), onTell: o\.onTell, onAsk: o\.onAsk, mayFill: \(\) => isTyped\(type\) \}\)/);
    assert.match(read("src/ui/harness/panes/pane-host.js"), /onAsk: \(text\) => cb\.artifact\?\.onAsk\(text\),/);
    const app = read("src/ui/harness/app.js");
    assert.match(app, /artifact: \{ onTell: \(text\) => composer\.add\(text\), onAsk: \(text\) => composer\.add\(text\), onFull: /, "selected, never sent");
    assert.match(app, /onAsk: \(chain, words\) => \{\s+if \(chain\) openChain\(chain\);\s+else \{ pushNextAddress = true; newChat\(\); leaveScreen\(\); \}\s+composer\.add\(words\);/);
    assert.match(read("src/ui/harness/artifact-view.js"), /onAsk: \(text\) => o\.onAsk\(record \? askingChat\(record\) : null, text\)/, "as the page wrote it, no Change prefix");
  });

  // (fails before: yes — the harness said nothing of a page's data)
  test("what its page keeps: the full view's line says it keeps data, Info names each collection with its count; a data change reads the record again and leaves its page and the list as they are (AFC-97)", () => {
    assert.equal(keepsWords(undefined), "");
    assert.equal(keepsWords([]), "");
    assert.equal(keepsWords([{ name: "expenses", count: 3 }]), "keeps data: 1 collection");
    const kept = [{ name: "budgets", error: "x" }, { name: "expenses", count: 1200 }, { name: "notes", count: 1 }];
    assert.equal(keepsWords(kept), "keeps data: 3 collections");
    assert.equal(dataWords(kept), "budgets (it could not be read), expenses (1,200 records), notes (1 record)");
    assert.equal(dataWords([]), "none kept");
    const view = read("src/ui/harness/artifact-view.js");
    assert.match(view, /meta\.textContent = \["Artifact", madeLine\(a, dayOf\), keepsWords\(a\.data\), reads \? `reads \$\{reads\}` : ""\]\.filter\(Boolean\)\.join\(" · "\);/);
    const acts = read("src/ui/harness/artifact-acts.js");
    assert.match(acts, /followRecord\(kept, a\.name, \(x\) => void \(kept\.textContent = dataWords\(x\.data\)\), /, "Info follows each write");
    assert.match(acts, /row\("Data", kept\),/);
    assert.match(read("src/ui/harness/artifacts-live.js"), /m\.change === "deleted" \|\| m\.change === "data" \? m\.change : ""/, "a data change is no new version");
    assert.match(read("src/ui/harness/artifacts-page.js"), /if \(!page\.isConnected\) return off\(\);\s+if \(p\.change === "data"\) return;/, "the list shows no data, so it is not read again");
  });

  // (fails before: yes — a helper's artifact was seen nowhere but its own run)
  test("what a helper published: its exchange's list while Filament holds it, else the chat's record by helper and exchange (AFC-100)", () => {
    const row = /** @type {any} */ ({ exchanges: [{ made: [{ name: "a-k3f9", v: 2, title: "A" }] }, {}] });
    const chat = { helpersMade: [{ helper: "sa_1", exchange: 1, name: "b-q7w2", v: 1, title: "B" }, { helper: "sa_2", exchange: 1, name: "c-zzzz", v: 3, title: "C" }] };
    assert.deepEqual(madeIn(row, chat, "sa_1", 0), [{ name: "a-k3f9", v: 2, title: "A" }]);
    assert.deepEqual(madeIn(row, chat, "sa_1", 1), [{ name: "b-q7w2", v: 1, title: "B" }], "nothing listed: the chat's record");
    assert.deepEqual(madeIn(null, chat, "sa_2", 1), [{ name: "c-zzzz", v: 3, title: "C" }], "Filament let it go");
    assert.deepEqual(madeIn(null, {}, "sa_2", 0), []);
  });

  // (fails before: yes — the same)
  test("its card's Made line names each, one opening its tab; the call stands apart from the work; its thread draws each card in its round, and what it made where its log is gone (AFC-100, pinned in the source)", () => {
    const card = read("src/ui/harness/conversation/agent-card.js");
    assert.match(card, /h\("span", \{ class: "ask-card-drew-label" \}, "Made"\),\s+\.\.\.made\.map\(\(m\) => h\("button", \{ class: "ask-card-drew-pic", type: "button", "data-key": m\.name, title: `Open \$\{m\.title\} \(v\$\{m\.v\}\) beside the chat`, onclick: \(\) => chipActions\.openArtifact\?\.\(m\.name\) \}, m\.title\)\),/);
    assert.match(card, /const line = h\("div", \{ class: "ask-card-made hidden" \}\);/, "a line of its own, in the Drew line's look");
    assert.match(card, /drew\.line,\s+drew\.box,\s+made\.line,/, "under the asked agent's card");
    assert.match(card, /drew\.paint\(\);\s+made\.paint\(\);/);
    const render = read("src/ui/harness/conversation/tools/render.js");
    assert.match(render, /return placed\(h\("div", \{ class: "sub-drew", "data-agent": agent, "data-self": "" \}, row, drew\.line, drew\.box, made\.line\)\);/, "under a helper's row");
    assert.match(render, /return !!chipActions\.drewOf\?\.\(id, exchange\)\?\.drew\.length \|\| !!chipActions\.madeOf\?\.\(id, exchange\)\?\.length;/, "no page behind Worked for");
    const app = read("src/ui/harness/app.js");
    assert.match(app, /chipActions\.madeOf = \(id, exchange\) => madeIn\(subagentStore\.row\(id\), chatOf\(state\.currentId\) \|\| \{\}, id, exchange\);/);
    assert.match(app, /chipActions\.openArtifact = \(name\) => rail\.openArtifactTab\(name\);/);
    assert.match(app, /chat\.helpersMade = Array\.isArray\(tr\.helpersMade\) \? tr\.helpersMade : \[\];/);
    const viewer = read("src/ui/harness/subagent-viewer.js");
    assert.match(viewer, /\.\.\.\(cell\.artifacts \|\| \[\]\)\.map\(\(\/\*\* @type \{any\} \*\/ k\) => \/\*\* @type \{Pictures\} \*\/ \(o\.pictures\)\.artifact\(k\)\),/);
    assert.match(viewer, /case "visual-writing":\s+case "artifact":\s+dirty\.add\(r\);/);
    assert.match(viewer, /\.\.\.\(current\.made \|\| \[\]\)\.filter\(\(m\) => !published\.has\(m\.name\)\)\.map\(/, "what its log no longer says");
  });
});

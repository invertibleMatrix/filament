// @ts-check
// HarnessV4_Four_Plan E20, the page: the Outputs pane drawn in a stub page against a stand-in server — its rows and
// what each says, a row opening its file beside the chat, Show in folder, the files no longer there, its words where
// it has nothing — the run's pulse reading it again; where a card's file chip reads a file; and the side pane's
// quiet add.
// (fails before: yes — the pane is new, and a chip of a file outside the chat's folder asked for it inside the folder)
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** The addresses the page asked for, in order. @type {string[]} */
const asked = [];
/** What the stand-in server answers by the whole address: a body, or undefined for a 404. @type {(url: string) => any} */
let serve = () => undefined;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => {
  asked.push(String(url));
  const body = serve(String(url));
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { renderOutputs, refreshOutputs, folderWords, markOf, rowFacts, goneWords, NOTHING_YET, NO_CHAT, SNAPSHOTS_OFF, COMMANDS_NOTE } = await import("../src/ui/harness/panes/outputs.js");
const { fileWhere } = await import("../src/ui/harness/panes/pane-data.js");
const { h } = await import("../src/ui/lib/dom.js");

after(() => {
  g.fetch = realFetch;
});

describe("the pane's words", () => {
  test("a folder short, a file's mark, a row's facts, the gone files' count", () => {
    assert.deepEqual(
      [folderWords("C:\\Users\\me\\AppData\\Local\\Temp\\notes"), folderWords("C:/tmp"), folderWords("/home/me/out/"), folderWords("/home/me/x/out"), folderWords("")],
      ["…/Temp/notes", "C:/tmp", "/home/me/out", "…/x/out", ""],
    );
    assert.deepEqual(["a.PNG", "n.md", "x.ts", "data.bin", "noext"].map(markOf), ["image", "fileText", "fileCode2", "file", "file"]);
    const now = Date.UTC(2026, 9, 17, 12, 0, 0);
    const f = { path: "C:/tmp/a/b/c.md", name: "c.md", folder: "C:/tmp/a/b", size: 2048, mtimeMs: now - 3 * 60_000, agent: "", turn: 2, ignoredIn: null };
    assert.equal(rowFacts(f, "Your agent", now), "…/a/b · 2 KB · 3m ago · Your agent");
    assert.equal(rowFacts({ ...f, folder: "C:/w/app", ignoredIn: "C:/w/app" }, "Reviewer", now), "C:/w/app · 2 KB · 3m ago · Reviewer · ignored by git, in app");
    assert.deepEqual([goneWords(1), goneWords(3)], ["1 is no longer where it was written", "3 are no longer where they were written"]);
  });

  // (fails before: yes — a chip of a whole path outside the chat's folder was read inside the folder and refused,
  // HarnessV4_Four_Plan FO-D26, FOC-43)
  test("where a card's file is read: in the chat's folder by its path there; outside it, in its own folder", () => {
    assert.deepEqual(
      [
        fileWhere("C:\\w\\app", "src/a.js"),
        fileWhere("C:\\w\\app", "c:/W/App/src/a.js"),
        fileWhere("C:\\w\\app", "C:\\Users\\me\\Temp\\notes.md"),
        fileWhere("C:/w/app", "C:/top.txt"),
        fileWhere("/home/me/app", "/tmp/out.png"),
        fileWhere("/home/me/app", "/home/me/app/x.js"),
        fileWhere("/home/me/App", "/home/me/app/x.js"),
        fileWhere("", "D:/n.md"),
      ],
      [
        { cwd: "C:\\w\\app", path: "src/a.js" },
        { cwd: "C:\\w\\app", path: "src/a.js" },
        { cwd: "C:/Users/me/Temp", path: "notes.md" },
        { cwd: "C:/", path: "top.txt" },
        { cwd: "/tmp", path: "out.png" },
        { cwd: "/home/me/app", path: "x.js" },
        { cwd: "/home/me/app", path: "x.js" },
        { cwd: "D:/", path: "n.md" },
      ],
      "a drive's path compares in one case; a POSIX one as written",
    );
  });
});

describe("the pane in a page", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
  };
  before(() => {
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
  });
  after(() => {
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
  });
  beforeEach(() => {
    asked.length = 0;
  });

  /** The pane mounted as the host mounts it. @param {any} chat @param {any[]} [subagents] */
  const mount = (chat, subagents = []) => {
    const body = h("div", { class: "pane-body" });
    doc.document.body.append(body);
    /** @type {number[]} */
    const badges = [];
    /** @type {{ path: string, cwd: string }[]} */
    const opened = [];
    /** @type {string[]} */
    const revealed = [];
    const ctx = {
      chat,
      setBadge: (/** @type {number} */ n) => void badges.push(n),
      openFileTab: (/** @type {{ path: string, cwd: string }} */ f) => void opened.push(f),
      subagents: () => subagents,
      reveal: (/** @type {string} */ p) => void revealed.push(p),
    };
    renderOutputs(body, ctx);
    return { body, ctx, badges, opened, revealed };
  };
  /** The pane once its read is drawn. @param {any} body */
  const settled = (body) => until(() => body.querySelector(".out-list") && body.querySelector(".out-list").textContent !== "Reading…", "the pane's read to be drawn");
  /** @param {any} root @param {string} sel */
  const texts = (root, sel) => root.querySelectorAll(sel).map((/** @type {any} */ e) => e.textContent);
  const NOW = Date.now();
  const A = { path: "C:\\Temp\\run\\chart.svg", name: "chart.svg", folder: "C:\\Temp\\run", size: 120, mtimeMs: NOW, agent: "sa_1", turn: 2, ignoredIn: /** @type {string | null} */ (null) };
  const B = { path: "C:\\w\\app\\.env", name: ".env", folder: "C:\\w\\app", size: 9, mtimeMs: NOW, agent: "", turn: 1, ignoredIn: "C:/w/app" };

  test("its rows, newest first: name, folder, size, when, who, the repository that ignores it; a row opens its file beside the chat; Show in folder (FOC-38, FOC-40, FOC-41, FOC-42)", async () => {
    serve = (u) => (u === "/api/memory/sessions/c1/outputs" ? { chainId: "c1", files: [A, B], gone: [{ path: "C:\\Temp\\old.txt", agent: "", turn: 1 }], errors: [] } : undefined);
    const chat = { chainId: "c1", cwd: "C:\\w\\app", turns: [{ n: 1, runId: "r1", status: "done" }], live: null };
    const { body, badges, opened, revealed } = mount(chat, [{ id: "sa_1", team: { role: "Charts" } }]);
    await settled(body);
    assert.deepEqual(texts(body, ".out-name"), ["chart.svg", ".env"]);
    assert.deepEqual(texts(body, ".out-facts"), ["C:/Temp/run · 120 bytes · just now · Charts", "C:/w/app · 9 bytes · just now · Your agent · ignored by git, in app"]);
    assert.deepEqual([body.querySelector(".out-count").textContent, badges.at(-1)], ["2 files", 2]);
    assert.equal(body.querySelector(".out-row").getAttribute("title"), A.path);
    body.querySelector(".out-row").dispatch("click");
    assert.deepEqual(opened, [{ cwd: "C:/Temp/run", path: "chart.svg" }], "in its own folder, as the folder rule reads it");
    body.querySelector(".out-row .out-btn").dispatch("click");
    assert.deepEqual([revealed, opened.length], [[A.path], 1], "Show in folder alone: the row does not open too");
    // The files no longer where they were written: folded, then their paths.
    const fold = body.querySelector(".out-fold");
    assert.equal(fold.textContent, "1 is no longer where it was written");
    assert.deepEqual(texts(body, ".out-gone"), []);
    fold.dispatch("click");
    assert.deepEqual(texts(body, ".out-gone"), ["C:\\Temp\\old.txt"]);
    assert.equal(body.querySelector(".out-note").textContent, COMMANDS_NOTE, "what the list never holds is said (FOC-48)");
  });

  test("its words where it has nothing: no turn yet, snapshots off, nothing written; a place git could not read (FOC-45, FOC-49)", async () => {
    serve = (u) => (u === "/api/memory/sessions/c2/outputs" ? { chainId: "c2", files: [], gone: [], errors: [] } : u === "/api/memory/sessions/c3/outputs" ? { chainId: "c3", files: [], gone: [], errors: [{ place: "C:/w/x", error: "fatal: bad" }] } : undefined);
    const none = mount({ chainId: null, turns: [] });
    await settled(none.body);
    assert.deepEqual([texts(none.body, ".pane-empty"), asked], [[NO_CHAT], []], "a chat with no turn asks nothing");
    const off = mount({ chainId: "c2", turns: [], view: { settings: { effective: { loop: { treeSnapshots: false } } } } });
    await settled(off.body);
    assert.deepEqual(texts(off.body, ".pane-empty"), [SNAPSHOTS_OFF]);
    const empty = mount({ chainId: "c2", turns: [] });
    await settled(empty.body);
    assert.deepEqual([texts(empty.body, ".pane-empty"), empty.body.querySelector(".out-note")], [[NOTHING_YET], null]);
    const bad = mount({ chainId: "c3", turns: [] });
    await settled(bad.body);
    assert.deepEqual(texts(bad.body, ".out-error"), ["x: fatal: bad"]);
  });

  test("the run's pulse reads it again when a round wrote, and when the turn ends; not otherwise (FOC-53)", async () => {
    let files = [A];
    serve = (u) => (u === "/api/memory/sessions/c4/outputs" ? { chainId: "c4", files, gone: [], errors: [] } : undefined);
    const turn = { n: 1, runId: "r4", status: "streaming" };
    const chat = /** @type {any} */ ({ chainId: "c4", turns: [turn], live: { turn, events: [] } });
    const m = mount(chat);
    await settled(m.body);
    const reads = () => asked.filter((u) => u === "/api/memory/sessions/c4/outputs").length;
    assert.equal(reads(), 1);
    refreshOutputs(m.body, m.ctx);
    assert.equal(reads(), 1, "nothing moved: no read");
    files = [A, B];
    chat.live.events.push({ type: "snapshot", round: 1 });
    refreshOutputs(m.body, m.ctx);
    await until(() => texts(m.body, ".out-name").length === 2, "the new file");
    assert.equal(reads(), 2);
    chat.live = null;
    refreshOutputs(m.body, m.ctx);
    await until(() => reads() === 3, "the read at the turn's end");
  });
});

describe("where it sits", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  const host = readFileSync(new URL("../src/ui/harness/panes/pane-host.js", import.meta.url), "utf8");

  test("Outputs joins the tabs without taking the view; closed by you it stays closed until a Show opens it (FO-D28, FOC-52)", () => {
    assert.match(host, /function addTab\(id\) \{\n {4}if \(only \|\| !paneOf\(id\)\) return false;\n {4}syncKey\(\);\n {4}measure\(\);\n {4}if \(!T\.addTab\(L, id, key, room\)\) return false;\n {4}persist\(\);\n {4}relayout\(\);\n {4}return true;\n {2}\}/,
      "a tab put in the tile in use: no openTab, no setOpen");
    const tiles = readFileSync(new URL("../src/ui/harness/panes/tiles.js", import.meta.url), "utf8");
    assert.match(tiles, /export function addTab\(L, id, chat, room\) \{\n {2}if \(tileOf\(L, id\) \|\| L\.held\.includes\(id\)\) return false;\n {2}if \(shownOf\(L, chat, room\)\.length\) place\(L, id, chat, room, "tabs"\);\n {2}else L\.held\.push\(id\);\n {2}return true;\n\}/,
      "as a tab, the tab shown, the tile in use and the panes shown or hidden left as they were; with no tile, it waits");
    // (a popped window's Bring back and a popped tab's window come before it: HarnessV4_BrowserSize_Plan BS4)
    assert.match(host, /function closeTabs\(ids\) \{[\s\S]{0,300}?\n {4}let any = false;\n {4}for \(const id of ids\) \{[\s\S]{0,200}?\n {6}cb\.onClosed\?\.\(id\);/, "a tab you close is told");
    assert.match(app, /onClosed: \(id\) => \{ if \(id === "outputs"\) store\.set\(OUTPUTS_CLOSED, "1"\); \}/);
    assert.match(app, /function offerOutputs\(\) \{\n {2}if \(store\.get\(OUTPUTS_CLOSED\) !== "1"\) rail\.addTab\("outputs"\);\n\}/);
    assert.match(app, /function openOutputs\(\) \{\n {2}store\.set\(OUTPUTS_CLOSED, "0"\);\n {2}rail\.openTab\("outputs"\);\n\}/);
    assert.match(app, /onOutputs: \(\) => openOutputs\(\),\n {2}onOutsideSeen: \(\) => offerOutputs\(\),/);
    // (fails before: yes — the review of 3b0b53c4c: a card read after its chat was switched away from offered Outputs to
    // the chat shown, its panes each chat's own now)
    const timeline = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
    assert.match(timeline, /if \(outside && card\.isConnected && !seen\) \{\n\s*seen = true;\n\s*onOutsideSeen\?\.\(\);/, "a turn's card: offered while it is on screen, once");
    assert.match(timeline, /const v = view\.get\(turn\);\n {8}if \(out\.outside\?\.length && v\?\.root\.isConnected\) cb\.onOutsideSeen\?\.\(\);/, "a turn's tree: the same");
  });

  test("a card's file chip and its picture are read where the file is (FO-D26)", () => {
    // Its lines (`#L10-40`) go to the file as found there too.
    assert.match(app, /chipActions\.open = \(path, range = ""\) => \{\n {2}const f = fileWhere\(chatOf\(state\.currentId\)\?\.cwd \|\| "", path\);\n {2}rail\.openFileTab\(f\);\n[^\n]*\n {2}if \(range\) showLines\(f\.cwd, f\.path, range\);/);
    assert.match(app, /const f = fileWhere\(chatOf\(state\.currentId\)\?\.cwd \|\| "", path\);\n {2}return api\(`\/files\/read\?cwd=\$\{encodeURIComponent\(f\.cwd\)\}&path=\$\{encodeURIComponent\(f\.path\)\}`\);/);
  });
});

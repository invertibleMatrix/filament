// @ts-check
// The new chat's project menu, one row per project (HarnessV4_Git_Plan GW-D46; the owner's of 10-31: "anytime i start a
// new task i see all the worktree showing up instead of just one ... even though the left side bar only show main
// project"): each folder the menu knows — the projects, this browser's recent folders, the chats' folders — is the
// project the server says it stands in, so a worktree's folder is its repository's row; the project the chooser's
// worktree stands in is the one ticked, and choosing it keeps the worktree; the chip names the project, and the Start
// says the project's Space.
// (fails before: yes — the menu listed app-space, app-hello and app-perf beside app, unticked, each as a project)
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** The stand-in server's answers: where each folder stands, and the folders that left the disk. */
/** @type {Record<string, any>} */
let stands = {};
/** @type {Set<string>} */
let gone = new Set();
/** The paths each ask of `/memory/projects/of` named. @type {string[][]} */
const askedOf = [];
/** How many asks of `/memory/projects/of` fail next, as a server restarting answers. */
let failing = 0;
/** While set, the server answers nothing until it settles: a busy server. @type {Promise<void> | null} */
let held = null;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url, /** @type {any} */ init) => {
  if (held) await held;
  const u = String(url);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  let out = null;
  if (u === "/api/memory/projects/of") {
    askedOf.push(body.paths);
    if (failing > 0) {
      failing--;
      return new Response(JSON.stringify({ error: "the server is starting" }), { status: 503, headers: { "content-type": "application/json" } });
    }
    out = { projects: body.paths.map((/** @type {string} */ p) => stands[p] ?? null) };
  } else if (u === "/api/files/exists") out = { ok: body.paths.map((/** @type {string} */ p) => !gone.has(p)) };
  return out == null ? new Promise(() => {}) : new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
};
/** This browser's preferences, the recent folders among them. @type {Map<string, string>} */
const kept = new Map();
const hadStorage = g.localStorage;
g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)), removeItem: (/** @type {string} */ k) => void kept.delete(k) };
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { projectRows, createEmptyState, projectFolderOf, readStanding } = await import("../src/ui/harness/conversation/empty.js");
const { state } = await import("../src/ui/harness/state.js");

const APP = { id: "p-app", cwd: "H:\\w\\app", name: "app", known: true };
const NOTES = { id: "p-notes", cwd: "H:\\w\\notes", name: "notes", known: true };
/** A drive's root, as the server spells its project's folder: without the slash (brain.js `projectOf`). */
const DRIVE = { id: "p-c", cwd: "C:", name: "C:", known: false };

describe("the rows: one per project", () => {
  // (fails before: yes, for the drive's root — its row went to "C:", the server's spelling, which names the folder the
  // server stands in on drive C, not its root; the review's find of 10-31)
  test("a worktree's folder is its project's row, named as the bar names it; a folder the server could not say stays itself, and one that is its own project stays as the menu has it", () => {
    const of = /** @type {Record<string, any>} */ ({ "H:\\w\\app": APP, "H:\\w\\app-space": APP, "h:/w/app-hello/": APP, "H:\\w\\notes": NOTES, "C:\\": DRIVE });
    const rows = projectRows(
      [
        { cwd: "H:\\w\\app-space", name: "" },
        { cwd: "H:\\w\\app", name: "app" },
        { cwd: "h:/w/app-hello/", name: "" },
        { cwd: "\\\\share\\x", name: "" },
        { cwd: "C:\\", name: "" },
        { cwd: "H:\\w\\notes", name: "notes" },
      ],
      (cwd) => of[cwd],
      [{ id: "p-app", name: "app" }, { id: "p-notes", name: "notes" }],
    );
    assert.deepEqual(rows, [
      { cwd: "H:\\w\\app", name: "app" },
      { cwd: "\\\\share\\x", name: "" },
      { cwd: "C:\\", name: "" },
      { cwd: "H:\\w\\notes", name: "notes" },
    ], "the first folder of a project puts its row where it stood; its other worktrees add none");
  });

  test("a worktree of a project the bar does not list (archived) is its main folder's row, unnamed as that folder was", () => {
    const rows = projectRows([{ cwd: "H:\\w\\old-wt", name: "" }], () => ({ id: "p-old", cwd: "H:\\w\\old" }), []);
    assert.deepEqual(rows, [{ cwd: "H:\\w\\old", name: "" }]);
  });
});

// A new chat with no folder named opens in its project's own folder (app.js `newChat`; the owner's of 11-08: "by default
// when Works in This folder is selected it should just open the main project folder and whatever that project folder's
// branch was set to and not some worktree branch").
describe("the folder a new chat opens in: its project's own", () => {
  // (fails before: yes — there was no such read: New task opened in the worktree the chat shown before worked in, the
  // chooser naming its project and the branch under the box the worktree's)
  test("a worktree's folder: its project's; the project's own folder, or one in none: none; one nobody has said: undefined until the server says", async () => {
    const NT = { id: "p-nt", cwd: "H:\\nt\\app", name: "nt", known: true };
    state.projects = [{ id: "p-nt", name: "nt", cwd: "H:\\nt\\app" }];
    state.sessions = [{ id: "n1", cwd: "H:\\nt\\app-builds", project: "p-nt" }, { id: "n2", cwd: "H:\\nt\\app", project: "p-nt" }, { id: "n3", cwd: "H:\\nt\\loose", project: "none" }];
    assert.equal(projectFolderOf("H:\\nt\\app-builds"), "H:\\nt\\app", "the list's project");
    assert.equal(projectFolderOf("h:/nt/app-builds/"), "H:\\nt\\app", "however its slashes and case are spelled");
    assert.equal(projectFolderOf("H:\\nt\\app"), null, "the project's own folder: it stays");
    assert.equal(projectFolderOf(""), null, "no folder: none");
    // A chat the list does not hold yet, filed in its project by its create (GW-D54).
    state.chats.set("nt-x", /** @type {any} */ ({ id: "nt-x", cwd: "H:\\nt\\app-new", projectId: "p-nt" }));
    try {
      assert.equal(projectFolderOf("H:\\nt\\app-new"), "H:\\nt\\app", "the chat's own project");
    } finally {
      state.chats.delete("nt-x");
    }
    // Neither the list nor the server has said: undefined, then the server's word.
    stands["H:\\nt\\app-late"] = NT;
    stands["H:\\nt\\loose"] = null;
    assert.deepEqual([projectFolderOf("H:\\nt\\app-late"), projectFolderOf("H:\\nt\\loose")], [undefined, undefined]);
    await readStanding(["H:\\nt\\app-late", "H:\\nt\\loose"]);
    assert.equal(projectFolderOf("H:\\nt\\app-late"), "H:\\nt\\app", "the server's word");
    assert.equal(projectFolderOf("H:\\nt\\loose"), null, "in no project: it stays");
  });

  test("New task, its shortcut and the left bar's New take it where they name no folder; a folder named stays as named (source contract)", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /const carried = cwd == null \? folderIn\.value\.trim\(\) : "";\n  const placed = carried \? projectFolderOf\(carried\) : null;\n  if \(cwd == null\) cwd = placed \?\? null;/);
    assert.match(app, /void readStanding\(\[carried\]\)\.then\(async \(\) => \{\n        const to = projectFolderOf\(carried\);\n        if \(to && \(await there\(to\)\) && stillIn\(carried\)\) setChooserFolder\(to\);/, "a folder nobody has said is asked, and the chat moved once the server says, to a folder on the disk");
    assert.match(app, /if \(placed\) void there\(placed\)\.then\(\(ok\) => \{ if \(!ok && stillIn\(placed\)\) setChooserFolder\(carried\); \}\);/, "a project's folder on no disk: back where it was carried from");
    assert.match(app, /const stillIn = [^\n]*\n      chooserSets === sets && chatOf\(state\.currentId\) === chat && !chat\.chainId/, "unless a folder was chosen meanwhile, the same one too");
    assert.equal(app.match(/if \(!chat\) chat = newChat\(\{ cwd: folderIn\.value\.trim\(\) \}\);/g)?.length, 2, "a send with no chat goes where its field says");
  });
});

describe("the menu and the chip, in a stand-in page", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  };
  before(() => {
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
    // The greeting's timer, the stub window's: none needed here (a real one would hold the run until the hour turns).
    if (typeof g.window.setTimeout !== "function") g.window.setTimeout = () => 0;
  });
  after(() => {
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
    g.fetch = realFetch;
    if (hadStorage === undefined) delete g.localStorage;
    else g.localStorage = hadStorage;
  });
  beforeEach(() => {
    doc.document.body.replaceChildren();
    askedOf.length = 0;
    gone = new Set(["D:\\gone-wt"]);
    failing = 0;
    held = null;
    stands = { "H:\\w\\app": APP, "H:\\w\\app-space": APP, "H:\\w\\app-hello": APP, "H:\\w\\app-perf": APP, "H:\\w\\notes": NOTES, "C:\\": DRIVE };
    kept.set("filament.harness.folders", JSON.stringify(["H:\\w\\app-space", "H:\\w\\app-hello", "C:\\"]));
    state.projects = [{ id: "p-app", name: "app", cwd: "H:\\w\\app" }, { id: "p-notes", name: "notes", cwd: "H:\\w\\notes" }];
    state.sessions = [{ id: "c1", cwd: "H:\\w\\app-perf", project: "p-app" }, { id: "c2", cwd: "H:\\w\\app", project: "p-app" }, { id: "c3", cwd: "D:\\gone-wt", project: "p-app" }];
  });

  /** The Start in the folder, the folders it was moved to, and what its parts say. @param {string} folder */
  const drawn = (folder) => {
    const o = { folder, set: /** @type {string[]} */ ([]) };
    const empty = createEmptyState({
      getFolder: () => o.folder,
      setFolder: (p) => { o.set.push(p); o.folder = p; },
      spaceOf: (cwd) => (cwd === "H:\\w\\app" ? { name: "app", own: false } : null),
    });
    doc.document.body.append(empty.el);
    const el = /** @type {any} */ (empty.el);
    return { o, empty, chip: el.querySelector(".chooser-chip"), label: () => el.querySelector(".chooser-label").textContent, space: () => el.querySelector(".chooser-space") };
  };
  const menuRows = async () => {
    await until(() => doc.document.body.querySelector(".zc-menu"), "the menu open");
    return /** @type {any[]} */ (doc.document.body.querySelector(".zc-menu").querySelectorAll(".zc-menu-item"));
  };
  /** A row's label: beside its path where it has one. @param {any} row */
  const labelOf = (row) => (row.querySelector(".zc-menu-label-line") || row.querySelector(".zc-menu-text")).textContent;

  test("in a worktree: the chip names its project, the Start says the project's Space, and the menu's rows are the projects, its own ticked", async () => {
    const { o, empty, chip, label, space } = drawn("H:\\w\\app-space");
    empty.paintChip();
    assert.equal(label(), "app-space", "until the server says, the folder's own name");
    await until(() => label() === "app", "the chip names the project once the server says where the folder stands");
    assert.equal(space().hidden, false, "a worktree's chat works in its project's Space");
    await chip.onclick({ stopPropagation() {} });
    const rows = await menuRows();
    const shown = rows.map((r) => [labelOf(r), r.getAttribute("aria-checked")]);
    assert.deepEqual(shown.slice(0, 3), [["app", "true"], ["notes", "false"], ["C:", "false"]], "no row for app-space, app-hello or app-perf");
    assert.ok(!shown.some(([l]) => /^app-/.test(l)), JSON.stringify(shown));
    assert.ok(!shown.some(([l]) => l === "gone-wt"), "a folder gone from the disk is dropped, as before");
    rows[0].dispatch("click");
    assert.deepEqual(o.set, [], "its own project chosen: the chat stays in its worktree");
    rows[1].dispatch("click");
    assert.deepEqual(o.set, ["H:\\w\\notes"], "another project: its folder");
    rows[2].dispatch("click");
    assert.deepEqual(o.set, ["H:\\w\\notes", "C:\\"], "the drive's root: the root, never the server's \"C:\"");
  });

  // (fails before: yes — the press waited on the disk's answer and the projects' before it opened anything: on a busy
  // server it opened nothing for seconds (the owner's of 11-01))
  test("the press opens the menu at once from what the page knows, and the server's word comes into it in place: a gone folder leaves, a worktree folds into its project, ticked, and the rows that stay are the elements they were", async () => {
    kept.set("filament.harness.folders", JSON.stringify(["H:\\w\\app-x1", "E:\\old"]));
    state.projects = [{ id: "p-app", name: "app", cwd: "H:\\w\\app" }];
    state.sessions = [];
    stands["H:\\w\\app-x1"] = APP;
    gone = new Set(["E:\\old"]);
    /** @type {(v?: any) => void} */
    let answer = () => {};
    held = new Promise((r) => { answer = r; });
    const { o, chip } = drawn("H:\\w\\app-x1");
    const pressed = chip.onclick({ stopPropagation() {} });
    const menu = doc.document.body.querySelector(".zc-menu");
    assert.ok(menu, "open at the press, the server not heard yet");
    const rows = () => /** @type {any[]} */ (menu.querySelectorAll(".zc-menu-item"));
    const said = () => rows().map((r) => [labelOf(r), r.getAttribute("aria-checked")]);
    const before = rows();
    assert.deepEqual(said(), [["app", "false"], ["app-x1", "true"], ["old", "false"], ["Open folder…", null], ["Work outside a project", "false"]], "each folder as the page knows it, the chooser's ticked");
    const search = /** @type {any} */ (menu.querySelector(".chooser-search"));
    search.value = "o";
    search.oninput();
    assert.deepEqual(rows().map((r) => r.classList.contains("hidden")), [true, true, false, false, false], "searched while the server is heard");
    answer();
    await pressed;
    assert.equal(doc.document.body.querySelector(".zc-menu"), menu, "the same menu");
    assert.deepEqual(said(), [["app", "true"], ["Open folder…", null], ["Work outside a project", "false"]], "the worktree is its project's row, ticked; the gone folder left");
    const after = rows();
    for (const [i, j] of [[0, 0], [1, 3], [2, 4]]) assert.equal(after[i], before[j], `${labelOf(after[i])}: the row that stood`);
    assert.equal(menu.querySelector(".chooser-search"), search, "the search field too");
    assert.deepEqual([search.value, after.map((r) => r.classList.contains("hidden"))], ["o", [true, false, false]], "what was typed still searches the rows");
    assert.ok(!JSON.parse(String(kept.get("filament.harness.folders"))).includes("E:\\old"), "the gone folder is forgotten");
    after[0].dispatch("click");
    assert.deepEqual(o.set, [], "its own project chosen: the chat stays in its worktree");
  });

  // (fails before: yes — the menu listed this computer's folders alone: another machine's projects were not there to pick,
  // the owner's of 11-10: "if i were to press New task, i should be able to see remote machine projects here as well";
  // then the review of pk-list: the machines' parts came in seconds later, every row above them moved, and a press
  // meant for a project here could open one on another machine)
  test("each machine the app keeps is a row of the menu from the press, named at once: its projects, read there, open beside it, and one picked opens a new chat there in its folder; the read changes no row's place; one that cannot be read says why", async () => {
    state.sessions = [];
    state.projects = [{ id: "p-app", name: "app", cwd: "H:\\w\\app" }];
    kept.set("filament.harness.folders", JSON.stringify([]));
    /** @type {string[][]} */
    const opened = [];
    /** @type {(v: any) => void} */
    let say = () => {};
    const o = { folder: "H:\\w\\app", set: /** @type {string[]} */ ([]) };
    const empty = createEmptyState({
      getFolder: () => o.folder,
      setFolder: (p) => void o.set.push(p),
      spaceOf: () => null,
      machineNames: async () => ({ machines: [{ id: "mac-1", name: "Kai’s MacBook Pro" }, { id: "box-2", name: "Studio" }, { id: "box-3", name: "Pi" }] }),
      otherMachines: () => new Promise((r) => (say = r)),
      openOn: (id, cwd) => void opened.push([id, cwd]),
    });
    doc.document.body.append(empty.el);
    const pressed = /** @type {any} */ (empty.el).querySelector(".chooser-chip").onclick({ stopPropagation() {} });
    const menu = doc.document.body.querySelector(".zc-menu");
    assert.ok(menu, "open at the press");
    const heads = () => [...menu.querySelectorAll(".zc-menu-label")].map((/** @type {any} */ x) => x.textContent);
    const rows = () => /** @type {any[]} */ ([...menu.querySelectorAll(".zc-menu-item")]);
    const descOf = (/** @type {any} */ r) => r.querySelector(".zc-menu-desc")?.textContent ?? null;
    await until(() => heads().length === 1, "the machines named");
    assert.deepEqual(heads(), ["Your other machines"]);
    assert.deepEqual(rows().map((r) => [labelOf(r), descOf(r)]).slice(1, 4), [["Kai’s MacBook Pro", "Reading its projects…"], ["Studio", "Reading its projects…"], ["Pi", "Reading its projects…"]]);
    const before = rows();
    say({
      machines: [
        { id: "mac-1", name: "Kai’s MacBook Pro", projects: [{ cwd: "/Users/kai/Filament/webshop", name: "webshop" }, { cwd: "/Users/kai/notes", name: "" }], words: null },
        { id: "box-2", name: "Studio", projects: null, words: "Studio does not answer: no way to it answers." },
        { id: "box-3", name: "Pi", projects: [], words: null },
      ],
    });
    await until(() => descOf(rows()[1]) === "2 projects", "the machines read");
    const after = rows();
    assert.deepEqual(after.map((r) => [labelOf(r), descOf(r), r.hasAttribute("disabled")]), [
      ["app", descOf(after[0]), false],
      ["Kai’s MacBook Pro", "2 projects", false],
      ["Studio", "Its projects can't be read", false],
      ["Pi", "No projects there yet", false],
      ["Open folder…", null, false],
      ["Work outside a project", "In Everything, a folder of Filament's own", false],
    ]);
    after.forEach((r, i) => assert.equal(r, before[i], `${labelOf(r)}: the row that stood`));
    // Its projects beside it: one picked opens a new chat there.
    after[1].dispatch("click");
    const beside = () => /** @type {any} */ ([...doc.document.body.querySelectorAll(".zc-menu")].at(-1));
    await until(() => beside() !== menu, "its projects beside it");
    assert.deepEqual([...beside().querySelectorAll(".zc-menu-item")].map((/** @type {any} */ r) => [labelOf(r), descOf(r)]), [["webshop", "/Users/kai/Filament/webshop"], ["notes", "/Users/kai/notes"]]);
    [...beside().querySelectorAll(".zc-menu-item")][0].dispatch("click");
    assert.deepEqual(opened, [["mac-1", "/Users/kai/Filament/webshop"]], "a new chat there, in its folder");
    assert.deepEqual(o.set, [], "this computer's chooser stays where it was");
    await pressed;
  });

  // (fails before: yes — the review of pk-list: a machine that could not be read showed no row to say why beside it)
  test("a machine whose projects cannot be read says why beside its row, greyed", async () => {
    state.sessions = [];
    state.projects = [];
    kept.set("filament.harness.folders", JSON.stringify([]));
    const empty = createEmptyState({ getFolder: () => "", setFolder: () => {}, spaceOf: () => null, otherMachines: async () => ({ machines: [{ id: "box-2", name: "Studio", projects: null, words: "Studio does not answer: no way to it answers." }] }), openOn: () => {} });
    doc.document.body.append(empty.el);
    const pressed = /** @type {any} */ (empty.el).querySelector(".chooser-chip").onclick({ stopPropagation() {} });
    const menu = doc.document.body.querySelector(".zc-menu");
    const studio = () => /** @type {any} */ ([...menu.querySelectorAll(".zc-menu-item")].find((r) => labelOf(r) === "Studio"));
    await until(() => !!studio(), "the machine's row");
    studio().dispatch("click");
    const beside = () => /** @type {any} */ ([...doc.document.body.querySelectorAll(".zc-menu")].at(-1));
    await until(() => beside() !== menu, "beside it");
    const why = [...beside().querySelectorAll(".zc-menu-item")];
    assert.deepEqual(why.map((/** @type {any} */ r) => [labelOf(r), r.querySelector(".zc-menu-desc")?.textContent, r.hasAttribute("disabled")]), [["Its projects can't be read", "Studio does not answer: no way to it answers.", true]]);
    await pressed;
  });

  // (fails before: no — it guards that a page with no app, or another machine's, shows this computer's folders alone)
  test("a page the app does not answer for another machine — a browser's, or another machine's own — shows no machine's part", async () => {
    state.sessions = [];
    state.projects = [{ id: "p-app", name: "app", cwd: "H:\\w\\app" }];
    kept.set("filament.harness.folders", JSON.stringify([]));
    const empty = createEmptyState({ getFolder: () => "H:\\w\\app", setFolder: () => {}, spaceOf: () => null, otherMachines: async () => null });
    doc.document.body.append(empty.el);
    await /** @type {any} */ (empty.el).querySelector(".chooser-chip").onclick({ stopPropagation() {} });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual([...doc.document.body.querySelector(".zc-menu").querySelectorAll(".zc-menu-label")], []);
  });

  // (fails before: yes — a failed ask kept null for the page's life: the chip named the worktree's folder until the menu
  // was opened; the review's find of 10-31)
  test("an ask that failed — the server starting — is asked again at the chip's next paint, never in a loop of its own", async () => {
    stands["H:\\w\\app-fresh"] = APP;
    failing = 1;
    const { empty, label } = drawn("H:\\w\\app-fresh");
    empty.paintChip();
    await until(() => askedOf.length === 1, "asked");
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual([label(), askedOf.length], ["app-fresh", 1], "failed: the folder's own name, and no ask again by itself");
    empty.paintChip();
    await until(() => label() === "app", "painted again: asked again, and the project named");
    assert.equal(askedOf.length, 2);
  });

  test("a folder the server cannot say keeps its own name and row, asked once however often the chip is painted", async () => {
    stands = {};
    const { empty, label } = drawn("H:\\w\\loose");
    empty.paintChip();
    empty.paintChip();
    await until(() => askedOf.length === 1, "asked");
    await new Promise((r) => setTimeout(r, 10));
    empty.paintChip();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(label(), "loose");
    assert.equal(askedOf.length, 1, "an unknown answer is kept: painting again does not ask again");
  });
});

// @ts-check
// Works in, at the start (HarnessV4_Git_Plan step 5; proposal_ux §4.13): the name made from the message (GW-D44,
// GWC-115), the place a folder is in and the same place in another (GWC-117), the row's and the line's words (GW-D45,
// GWC-103, GWC-105, GWC-106, GW-D50), the create body's part (GW-D49), and the row's control drawn in a stand-in page
// against a stand-in server: This folder, Another worktree with the other places and why one is greyed (GWC-116), a
// place chosen, A new worktree with its name checked and given way where taken (GWC-48), the name following the message
// until typed (GWC-102), another folder dropping the choice (GWC-101), and no choices outside a repository, said
// (GWC-99). The rows it reads are test/git-worktree-new.test.js's.
// (fails before: yes — the start had no Works in)
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** What the page asked the server, in order. @type {string[]} */
const asked = [];
/** What the stand-in server answers, by address; null leaves it unanswered. @type {(url: string) => any} */
let serve = () => null;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => {
  asked.push(String(url));
  const body = serve(String(url));
  return body == null ? new Promise(() => {}) : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { nameFromMessage, typedName, newWorktreeChoice, givenWorktreeChoice, placeHolding, samePlaceIn, placeNote, placeBlocked, worksInWords, whereWords, makeWords, createWorksIn } = await import("../src/ui/harness/conversation/works-in.js");
const { worksInPart, sessionStartBody } = await import("../src/ui/harness/session-start.js");
const { h } = await import("../src/ui/lib/dom.js");

describe("the words and the body", () => {
  test("a name made from the message: its first three words that say something, else task (GW-D44, GWC-115)", () => {
    assert.equal(nameFromMessage("Fix the login redirect: it loops forever"), "fix-login-redirect");
    assert.equal(nameFromMessage("Please can you do this now?"), "task");
    assert.equal(nameFromMessage("!!! ..."), "task");
    assert.equal(nameFromMessage("Rename the café menu"), "rename-cafe-menu");
    const long = nameFromMessage("internationalization reconfiguration documentation");
    assert.ok(long.length <= 40 && !long.endsWith("-"), long);
    assert.equal(long, "internationalization-reconfiguration");
    assert.equal(typedName("  my  fix "), "my-fix");
  });

  test("the place a folder is in, the deepest, in any spelling; the same place in another (GWC-117)", () => {
    const places = [{ path: "H:/w/proj" }, { path: "H:/w/proj/sub/inner" }, { path: "H:/w/proj-done" }];
    assert.equal(placeHolding(places, "h:\\W\\proj\\src")?.path, "H:/w/proj");
    assert.equal(placeHolding(places, "H:\\w\\proj\\sub\\inner\\x")?.path, "H:/w/proj/sub/inner");
    assert.equal(placeHolding(places, "H:/w/proj-done/")?.path, "H:/w/proj-done");
    assert.equal(placeHolding(places, "H:/w/projector"), null, "a name that only begins the same is no place's");
    assert.equal(samePlaceIn("H:\\w\\proj\\src", "H:/w/proj", "H:/w/proj-done"), "H:/w/proj-done/src");
    assert.equal(samePlaceIn("H:/w/proj", "H:/w/proj", "H:/w/proj-done/"), "H:/w/proj-done");
  });

  test("a place's row: who works there, or why it cannot be chosen (GWC-116)", () => {
    assert.equal(placeNote({ chats: [] }, true), "this folder");
    assert.equal(placeNote({ chats: [] }, false), "a worktree");
    // The repository's own folder is no worktree of its own (fails before: yes — it read "a worktree").
    assert.equal(placeNote({ main: true, chats: [] }, false), "the main folder");
    assert.equal(placeNote({ chats: [{ name: "Fix it" }] }, false), "“Fix it” works here");
    assert.equal(placeNote({ chats: [{}, {}] }, false), "2 chats work here");
    // A chat named by its first message ran the row to three lines (fails before: yes — step 6's drive).
    const long = "Add src/greet.js exporting greet(name) that returns a greeting";
    assert.equal(placeNote({ chats: [{ name: long }] }, false), "“Add src/greet.js exporting greet(name)…” works here");
    assert.equal(placeNote({ chats: [{ name: long.slice(0, 40) }] }, false), `“${long.slice(0, 40)}” works here`, "40 characters stand whole");
    assert.equal(placeBlocked({ missing: true }), "its folder is gone");
    assert.equal(placeBlocked({ ok: false, error: "H:/x is not under any folder listed in agentLoop.roots" }), "H:/x is not under any folder listed in agentLoop.roots");
    assert.equal(placeBlocked({ ok: true }), null);
  });

  // (fails before: yes — U5 phase 6: Works in was a chip naming the branch)
  test("the row: which of its three is chosen, the place chosen with its branch, and the note — its folder, or the chats already here", () => {
    assert.deepEqual(worksInWords({ make: true }, null, "H:\\w\\proj"), { on: "new", other: "Another worktree", note: "" });
    assert.deepEqual(worksInWords({ path: "H:/w/proj-done", cwd: "H:/w/proj-done/src", name: "proj-done", branch: "done" }, null, "H:\\w\\proj\\src"), { on: "other", other: "proj-done · done", note: "H:\\w\\proj-done\\src" });
    assert.deepEqual(worksInWords(null, { chats: [] }, "H:\\w\\proj"), { on: "here", other: "Another worktree", note: "" });
    assert.deepEqual(worksInWords(null, { chats: [{ name: "Fix it" }] }, "H:\\w\\proj"), { on: "here", other: "Another worktree", note: "“Fix it” works here" });
    // The sentence's folder and branch.
    assert.equal(whereWords("H:\\w\\proj", { branch: "main" }), "H:\\w\\proj · main");
    assert.equal(whereWords("H:\\w\\proj", { head: "abc1234" }), "H:\\w\\proj · detached at abc1234");
    assert.equal(whereWords("H:\\plain", null), "H:\\plain");
  });

  test("what the send will do, and the mark beside it: free, bad, taken with a free one, refused, a folder git lacks", () => {
    const plan = { ok: true, name: "fix", branch: "fix", folder: "H:/w/proj-fix", here: "proj", from: { branch: "main", head: "abc1234" }, uncommitted: 3, bad: null, taken: null, free: null, refused: null, lacks: null };
    const ok = makeWords(plan, "H:\\w\\proj");
    // What git ignores is the copy line's to say (HarnessV4_Four_Plan FO-D34; fails before: yes — the sentence said
    // none of it was copied, beside a line that copies it).
    assert.equal(ok.say, "Makes the branch fix from main's last commit (abc1234) and the folder H:\\w\\proj-fix when you send. Your 3 uncommitted files stay in proj.");
    assert.deepEqual([ok.mark, ok.use], [{ ok: true, text: "the name is free" }, null]);
    assert.match(makeWords({ ...plan, uncommitted: 1 }).say, /Your 1 uncommitted file stays in proj\.$/, "GWC-103");
    assert.match(makeWords({ ...plan, uncommitted: 0, from: { branch: null, head: "abc1234" } }).say, /from commit abc1234 .* when you send\.$/, "GWC-105");
    assert.deepEqual(makeWords({ ...plan, bad: "it cannot hold “..”", folder: null, branch: null }), { say: "", mark: { ok: false, text: "it cannot hold “..”" }, use: null }, "GWC-106");
    assert.deepEqual(makeWords({ ...plan, taken: "branch", free: "fix-2" }).mark, { ok: false, text: "the branch fix is there already" });
    assert.equal(makeWords({ ...plan, taken: "branch", free: "fix-2" }).use, "fix-2", "GWC-48");
    assert.equal(makeWords({ ...plan, taken: "folder", free: "fix-2" }, "H:\\w").mark.text, "the folder H:\\w\\proj-fix is there already");
    assert.equal(makeWords({ ...plan, refused: "H:/w/proj-fix would not be under any folder listed in agentLoop.roots" }).mark.ok, false, "GWC-107");
    assert.equal(makeWords({ ...plan, lacks: "scratch" }).mark.text, "scratch is not in git, so the new worktree would not have it", "GW-D50");
    assert.deepEqual(makeWords({ ok: false, error: "not in a git repository" }), { say: "", mark: { ok: false, text: "not in a git repository" }, use: null });
  });

  test("the create body: a place's folder as the chat's, a new worktree with its name — made, or typed (GW-D49, GW-D44)", () => {
    assert.deepEqual(worksInPart(undefined), {});
    assert.deepEqual(worksInPart({ folder: "H:/w/proj", path: "H:/w/proj-done", cwd: "H:/w/proj-done/src" }), { cwd: "H:/w/proj-done/src" });
    assert.deepEqual(worksInPart({ folder: "H:/w/proj", make: true, name: "fix", typed: false }), { worktree: { name: "fix", made: true } });
    assert.deepEqual(worksInPart({ folder: "H:/w/proj", make: true, name: "mine", typed: true }), { worktree: { name: "mine", made: false } });
    const placed = sessionStartBody({ worksIn: { folder: "H:/w/proj", path: "H:/w/proj-done", cwd: "H:/w/proj-done" } }, "H:/w/proj", "m");
    assert.deepEqual([placed.cwd, placed.worktree], ["H:/w/proj-done", undefined]);
    const fresh = sessionStartBody({ worksIn: { folder: "H:/w/proj", make: true, name: "fix", typed: false } }, "H:/w/proj", "m");
    assert.deepEqual([fresh.cwd, fresh.worktree], ["H:/w/proj", { name: "fix", made: true }]);
    // The paths the copy line left on (FO-D34; fails before: yes): sent once it read the list, else left to the server.
    assert.deepEqual(worksInPart({ folder: "H:/w/proj", make: true, name: "fix", typed: false, off: ["Library"], copy: [".env"] }), { worktree: { name: "fix", made: true, copy: [".env"] } });
    assert.deepEqual(worksInPart({ folder: "H:/w/proj", make: true, name: "fix", typed: false, copy: [] }), { worktree: { name: "fix", made: true, copy: [] } }, "every one left off copies none");
  });
});

// (fails before: yes — a folder picked at the start left the header on the folder the chat held before, its branch with it)
test("a folder picked at the start is the unborn chat's at once, and the header reads its place (app.js)", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  const at = app.indexOf("function setChooserFolder(p) {");
  assert.ok(at > 0 && app.includes("  setFolder: (p) => setChooserFolder(p),"), "the Start's folder is set by setChooserFolder");
  const pick = app.slice(at, app.indexOf("transcript.refreshFolder();", at));
  // The lines between keep the Start's words with the folder (state.js startKept): the same block, no "}" between.
  assert.match(pick, /if \(c && !c\.chainId && [^\n]*\{\n\s+c\.cwd = p;\n[^}]*headerModule\.refreshGit\(\);/);
});

describe("the chip, in a stand-in page", () => {
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
  });
  after(() => {
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
    g.fetch = realFetch;
  });
  beforeEach(() => {
    asked.length = 0;
    doc.document.body.replaceChildren();
  });

  const PLACES = {
    ok: true,
    name: "proj",
    places: [
      { path: "H:/w/proj", name: "proj", main: true, branch: "main", ok: true, chats: [] },
      { path: "H:/w/proj-done", name: "proj-done", main: false, branch: "done", ok: true, chats: [{ name: "Fix it" }] },
      { path: "H:/w/proj-gone", name: "proj-gone", main: false, branch: "gone", missing: true, chats: [] },
    ],
    removed: [],
  };
  /** The page as the start draws it: an unborn chat, its folder and its message; the row's three choices. */
  const drawn = (/** @type {{ folder?: string, text?: string }} */ o = {}) => {
    const state = { chat: /** @type {any} */ ({}), folder: o.folder ?? "H:\\w\\proj", text: o.text ?? "Fix the login redirect", changed: 0 };
    const w = createWorksIn({ chat: () => state.chat, folder: () => state.folder, text: () => state.text, changed: () => state.changed++ });
    doc.document.body.append(w.where, w.control, w.line);
    const ctl = /** @type {any} */ (w.control);
    return { w, state, ctl, here: ctl.querySelector(".works-in-here"), other: ctl.querySelector(".works-in-other"), make: ctl.querySelector(".works-in-new"), line: /** @type {any} */ (w.line) };
  };
  /** The menu's rows once it is open. */
  const rows = async () => {
    await until(() => doc.document.body.querySelector(".zc-menu"), "the menu open");
    return /** @type {any[]} */ (doc.document.body.querySelector(".zc-menu").querySelectorAll(".zc-menu-item"));
  };
  const labelOf = (/** @type {any} */ row) => row.querySelector(".zc-menu-label-line").textContent;
  const descOf = (/** @type {any} */ row) => row.querySelector(".zc-menu-desc").textContent;
  const checks = () => asked.filter((u) => u.startsWith("/api/git/places/new"));
  /** The choices shown: by the page's `hidden` class, which a control's own display cannot beat. @param {any} w */
  const shown = (w) => !w.control.querySelector(".works-in-seg").classList.contains("hidden");
  const nameIn = (/** @type {any} */ ctl) => ctl.querySelector(".works-in-name");
  const pressed = (/** @type {any} */ b) => b.getAttribute("aria-pressed");
  /** @param {any} line */
  const markOf = (line) => line.querySelector(".works-in-mark").textContent;

  // A new worktree chosen before the Start draws — the Space's New lane…, Pick up…, a pulled card's Start a chat on
  // this…, Reproduce… — in a folder git reads no repository in: the row hides its choices and says "it works in the
  // folder itself", and the send does. (fails before: yes — the hidden choice stayed on the chat, its send carried the
  // worktree and was refused 409 "not in a git repository", no chat made: found by d-word's builder, 11-12)
  test("a new worktree chosen for a folder git reads no repository in is dropped once the read says so: the send works in the folder itself, as the row says", async () => {
    serve = (u) => (u.startsWith("/api/git/places?") ? (u.includes("plain") ? { ok: false, error: "not in a git repository" } : PLACES) : u.startsWith("/api/git/places/new") ? { ok: true, name: "fix-login-redirect", free: true } : null);
    for (const choice of [newWorktreeChoice("H:\\plain", "Fix the login redirect"), givenWorktreeChoice("H:\\plain", "repro/play-91")]) {
      const { w, state, ctl } = drawn({ folder: "H:\\plain" });
      state.chat.worksIn = choice;
      assert.ok(worksInPart(state.chat.worksIn).worktree, "the choice would ride the create");
      w.refresh();
      await until(() => ctl.querySelector(".works-in-note").textContent === "Not a git repository: it works in the folder itself.", "the row to say so");
      assert.equal(state.chat.worksIn, undefined, "the choice is dropped");
      assert.deepEqual(worksInPart(state.chat.worksIn), {}, "the create carries no worktree");
      assert.equal(state.changed, 1, "the page is told, once");
      assert.equal(shown(w), false);
      doc.document.body.replaceChildren();
    }
    // In a repository the choice stays.
    const { w, state } = drawn();
    state.chat.worksIn = newWorktreeChoice("H:\\w\\proj", "Fix the login redirect");
    w.refresh();
    await until(() => shown(w), "the choices shown");
    assert.equal(state.chat.worksIn?.make, true);
    doc.document.body.replaceChildren();
  });

  test("outside a repository there are no choices, said; in one, This folder, the sentence's branch, and the other places listed, one greyed with why (GWC-99, GWC-116)", async () => {
    serve = (u) => (u.startsWith("/api/git/places?") ? (u.includes("plain") ? { ok: false, error: "not in a git repository" } : PLACES) : null);
    const plain = drawn({ folder: "H:\\plain" });
    plain.w.refresh();
    await until(() => asked.length === 1, "the places asked");
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(shown(plain.w), false, "GWC-99");
    assert.equal(plain.ctl.querySelector(".works-in-note").textContent, "Not a git repository: it works in the folder itself.");
    assert.equal(/** @type {any} */ (plain.w.where).textContent, "H:\\plain");
    doc.document.body.replaceChildren();
    const { w, ctl, here, other, make } = drawn();
    w.refresh();
    await until(() => shown(w), "the choices shown");
    assert.deepEqual([pressed(here), pressed(other), pressed(make), other.classList.contains("hidden")], ["true", "false", "false", false]);
    assert.equal(other.querySelector(".works-in-other-text").textContent, "Another worktree");
    assert.equal(/** @type {any} */ (w.where).textContent, "H:\\w\\proj · main");
    assert.equal(ctl.querySelector(".works-in-note").textContent, "");
    other.dispatch("click");
    const r = await rows();
    assert.deepEqual(
      r.map((x) => [labelOf(x), descOf(x), x.hasAttribute("disabled"), x.getAttribute("aria-checked")]),
      [
        ["proj-done · done", "“Fix it” works here", false, "false"],
        ["proj-gone · gone", "its folder is gone", true, "false"],
      ],
    );
    r[0].dispatch("click");
    assert.deepEqual([other.querySelector(".works-in-other-text").textContent, pressed(other), pressed(here)], ["proj-done · done", "true", "false"]);
    assert.equal(ctl.querySelector(".works-in-note").textContent, "H:\\w\\proj-done", "the folder it will work in");
    here.dispatch("click");
    assert.deepEqual([pressed(here), other.querySelector(".works-in-other-text").textContent], ["true", "Another worktree"]);
  });

  // (fails before: yes — while git answered, the row stood empty and said nothing: on a busy server, for seconds (the
  // owner's of 11-01))
  test("while git reads the repository the row says so, and its answer puts the choices there", async () => {
    serve = () => null;
    const { w, ctl } = drawn();
    w.refresh();
    await until(() => asked.length === 1, "the places asked");
    const note = ctl.querySelector(".works-in-note");
    assert.equal(note.textContent, "Reading the repository…");
    assert.equal(shown(w), false, "no choices before git says which there are");
    serve = (u) => (u.startsWith("/api/git/places?") ? PLACES : null);
    w.refresh();
    await until(() => shown(w), "the choices shown");
    assert.equal(note.textContent, "", "read: the folder's own place, with no chat in it, says nothing more");
  });

  test("a place chosen is the chat's folder, at the same place; another folder drops it (GW-D49, GWC-117, GWC-101)", async () => {
    serve = (u) => (u.startsWith("/api/git/places?") ? PLACES : null);
    const { w, state, other } = drawn({ folder: "H:\\w\\proj\\src" });
    w.refresh();
    await until(() => shown(w), "the choices shown");
    other.dispatch("click");
    (await rows())[0].dispatch("click");
    assert.deepEqual(state.chat.worksIn, { path: "H:/w/proj-done", cwd: "H:/w/proj-done/src", name: "proj-done", branch: "done", folder: "H:\\w\\proj\\src" });
    assert.equal(state.changed, 1, "the Start board weighs it again (GWC-118)");
    state.folder = "H:\\w\\other";
    w.refresh();
    assert.equal(state.chat.worksIn, undefined);
    assert.equal(state.changed, 2);
  });

  test("New worktree…: the name made from the message, a taken one giving way, the message followed once per new name (GW-D44, GWC-102)", async () => {
    const taken = new Set(["fix-login-redirect"]);
    serve = (u) => {
      if (u.startsWith("/api/git/places?")) return PLACES;
      const name = decodeURIComponent(new URL(u, "http://x").searchParams.get("name") || "");
      const isTaken = taken.has(name);
      return { ok: true, name, branch: name, folder: `H:/w/proj-${name}`, here: "proj", from: { branch: "main", head: "abc1234" }, uncommitted: 0, bad: null, taken: isTaken ? "branch" : null, free: isTaken ? `${name}-2` : null, refused: null, lacks: null };
    };
    const { w, state, ctl, make, line } = drawn();
    // The field takes the focus A new worktree gives it, as a browser's does.
    const field = nameIn(ctl);
    field.focus = () => (/** @type {any} */ (doc.document).activeElement = field);
    w.refresh();
    await until(() => shown(w), "the choices shown");
    make.dispatch("click");
    assert.equal(line.classList.contains("hidden"), false, "the line under the row shown");
    assert.equal(ctl.querySelector(".works-in-namechip").classList.contains("hidden"), false, "the branch's name beside the choices");
    assert.equal(pressed(make), "true");
    await until(() => markOf(line) === "the name is free", "the free name checked");
    assert.deepEqual([state.chat.worksIn.name, state.chat.worksIn.typed], ["fix-login-redirect-2", false]);
    // (fails before: yes — the focused field kept the taken name while the send would make the free one)
    assert.equal(field.value, "fix-login-redirect-2", "the field names what the send makes");
    // Emptied to type another: left empty, the made name in force as its placeholder.
    const asks = checks().length;
    field.value = "";
    field.dispatch("input");
    // Two asks: the made name, taken, then the free one it gives way to.
    await until(() => checks().length === asks + 2 && markOf(line) === "the name is free", "the made name in force again");
    assert.deepEqual([field.value, field.placeholder, state.chat.worksIn.name], ["", "fix-login-redirect-2", "fix-login-redirect-2"]);
    delete (/** @type {any} */ (doc.document)).activeElement;
    const before = checks().length;
    // A key that leaves the made name as it was asks nothing: it gave way to a free one, which it does not follow.
    state.text = "Fix the login redirect loop";
    w.draftChanged();
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(checks().length, before, "no ask per key");
    state.text = "Rename the header";
    w.draftChanged();
    await until(() => checks().at(-1)?.endsWith("name=rename-header") && markOf(line) === "the name is free", "the name follows the message");
    await new Promise((r) => setTimeout(r, 50));
    // (fails before: yes — the send empties the message before the chat is made, and the name became "task")
    const sent = checks().length;
    state.text = "";
    w.draftChanged();
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual([state.chat.worksIn.name, checks().length], ["rename-header", sent], "an emptied message keeps the made name");
  });

  test("a typed name stays, its taken name said with a free one to use (GWC-48, GWC-102)", async () => {
    serve = (u) => {
      if (u.startsWith("/api/git/places?")) return PLACES;
      const name = decodeURIComponent(new URL(u, "http://x").searchParams.get("name") || "");
      const isTaken = name === "my-fix";
      return { ok: true, name, branch: name, folder: `H:/w/proj-${name}`, here: "proj", from: { branch: "main", head: "abc1234" }, uncommitted: 0, bad: null, taken: isTaken ? "branch" : null, free: isTaken ? "my-fix-2" : null, refused: null, lacks: null };
    };
    const { w, state, ctl, make, line } = drawn();
    w.refresh();
    await until(() => shown(w), "the choices shown");
    make.dispatch("click");
    nameIn(ctl).value = "my  fix";
    nameIn(ctl).dispatch("input");
    await until(() => markOf(line).startsWith("the branch my-fix is there already"), "the taken name said");
    assert.deepEqual([state.chat.worksIn.name, state.chat.worksIn.typed], ["my-fix", true]);
    state.text = "Something else entirely";
    w.draftChanged();
    assert.equal(state.chat.worksIn.name, "my-fix", "a typed name does not follow the message");
    const use = line.querySelector(".works-in-use");
    assert.equal(use.textContent, "Use my-fix-2");
    use.dispatch("click");
    await until(() => markOf(line) === "the name is free", "the free one checked");
    assert.deepEqual([state.chat.worksIn.name, state.chat.worksIn.typed], ["my-fix-2", true]);
  });

  // (fails before: yes — the line said what git ignores was not copied, and nothing could be)
  test("New worktree…: what it gets a copy of, each entry switched for it alone, not here said; none, or your defaults' (HarnessV4_Four_Plan FO-D34, FOC-54, FOC-59, FOC-62, FOC-69)", async () => {
    const GB = 1024 ** 3;
    /** @type {any} */
    let template = {
      ok: true, project: "proj", from: "project", copy: ["Library", ".env", "gone.txt"],
      entries: [
        { path: "Library", dir: true, link: false, bytes: 8.4 * GB, files: 91204, missing: false },
        { path: ".env", dir: false, link: false, bytes: 20, files: 1, missing: false },
        { path: "gone.txt", dir: false, link: false, bytes: 0, files: 0, missing: true },
      ],
    };
    serve = (u) => {
      if (u.startsWith("/api/git/places?")) return PLACES;
      if (u.startsWith("/api/git/places/template?")) return template;
      const name = decodeURIComponent(new URL(u, "http://x").searchParams.get("name") || "");
      return { ok: true, name, branch: name, folder: `H:/w/proj-${name}`, here: "proj", from: { branch: "main", head: "abc1234" }, uncommitted: 0, bad: null, taken: null, free: null, refused: null, lacks: null };
    };
    const { w, state, make, line } = drawn();
    w.refresh();
    await until(() => shown(w), "the choices shown");
    make.dispatch("click");
    const copyRow = () => line.querySelector(".wt-copy");
    await until(() => copyRow().querySelector(".wt-copy-entry"), "the list read");
    const entries = () => copyRow().querySelectorAll(".wt-copy-entry").map((/** @type {any} */ e) => [e.querySelector(".wt-copy-name").textContent, e.querySelector(".wt-copy-size").textContent, e.classList.contains("is-off")]);
    assert.deepEqual(entries(), [["Library", "8.4 GB", false], [".env", "20 bytes", false], ["gone.txt", "not here", false]]);
    assert.equal(copyRow().querySelector(".wt-copy-total").textContent, "· 8.4 GB");
    assert.equal(copyRow().querySelector(".wt-copy-edit").textContent, "Edit the list…");
    assert.deepEqual(state.chat.worksIn.copy, ["Library", ".env", "gone.txt"], "the send copies the list; the one not here is named skipped on its row");
    const box = copyRow().querySelector(".wt-copy-entry input");
    box.checked = false;
    box.dispatch("change");
    assert.deepEqual([state.chat.worksIn.off, state.chat.worksIn.copy], [["Library"], [".env", "gone.txt"]], "FOC-59");
    assert.deepEqual(entries()[0], ["Library", "8.4 GB", true]);
    assert.equal(copyRow().querySelector(".wt-copy-total"), null, "one entry left on: its size is the total");
    assert.deepEqual(worksInPart(state.chat.worksIn).worktree?.copy, [".env", "gone.txt"]);
    // Your defaults' list, the project holding none (FOC-69).
    template = { ...template, from: "global", copy: [".env"], entries: [template.entries[1]] };
    w.refresh();
    await until(() => copyRow().querySelector(".wt-copy-from"), "the defaults said");
    assert.equal(copyRow().querySelector(".wt-copy-from").textContent, "from your defaults");
    assert.deepEqual([state.chat.worksIn.off, state.chat.worksIn.copy], [[], [".env"]], "a path left off that the list no longer holds is forgotten");
    // No list at all (FOC-54).
    template = { ...template, from: "default", copy: [], entries: [] };
    w.refresh();
    await until(() => copyRow().querySelector(".wt-copy-none"), "none said");
    assert.equal(copyRow().querySelector(".wt-copy-none").textContent, "What git ignores is not copied.");
    assert.equal(copyRow().querySelector(".wt-copy-edit").textContent, "Choose what to copy…");
    assert.deepEqual(state.chat.worksIn.copy, []);
  });
});

// @ts-check
// The Changes pane drawn in place (panes/changes.js, panes/agents-band.js) on the stub document. A read landing (every
// half minute while the pane shows, at a turn's end, as the sub-agents move), the per-minute paint and the band's draw
// as a dry run lands made the summary and every block anew — each agent's line and its ⋯, each file's row, an open
// diff's box and its header, the copy's Apply and Show the diff: new elements under a resting pointer (the owner's of
// 11-01: buttons blinking under a resting pointer, clicks lost). And the band kept its diff's box across draws by
// putting the one on the page inside each draw's tree, which took it off the page. Drawn in place, each part keyed by
// what it is, they are the elements that stood; a diff read again the same is drawn no more.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** Every address the page asked for. @type {string[]} */
const asked = [];
/** What the stand-in server answers by the whole address: a body, or undefined for a 404. @type {(url: string) => any} */
let serve = () => undefined;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => {
  asked.push(String(url));
  const body = await serve(String(url));
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { refreshChanges, renderChanges } = await import("../src/ui/harness/panes/changes.js");
const { createBand } = await import("../src/ui/harness/panes/agents-band.js");
const { h, morphChildren } = await import("../src/ui/lib/dom.js");

/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {Record<string, any>} */
const had = {};
const STUBS = {
  requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
  cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
  HTMLElement: class {},
};
before(() => {
  doc = stubDocument();
  for (const [k, v] of Object.entries(STUBS)) {
    had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
    g[k] = v;
  }
  g.window.setTimeout = () => 0;
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
});

/** A few turns of the event loop: what a read or a paint set off has landed. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

const PATCH_A = "diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1,2 +1,3 @@\n one\n-two\n+TWO\n+three\n";
const PATCH_A2 = "diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1,2 +1,4 @@\n one\n-two\n+TWO\n+three\n+four\n";
const PATCH_X = "diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1,4 @@\n x\n+y\n+z\n+w\n";
const URL_R = "/api/git/changes?cwd=%2Fr&chain=c1";
const URL_A = "/api/git/branch?cwd=%2Fr&place=%2Fr&part=uncommitted&path=src%2Fa.js";
/** The places as the server answers them: your folder, written by this chat and another; a sub-agent's copy; another chat's worktree. */
const ANSWER = {
  cwd: "/r",
  ok: true,
  error: null,
  at: 1,
  places: [
    {
      kind: "folder", cwd: "/r", ok: true, place: "/r", worktree: false, branch: "main", detached: false, base: "main", ahead: 0, behind: 0,
      files: [
        { path: "src/a.js", oldPath: null, status: "M", added: 2, removed: 1, binary: false, untracked: false, by: [{ chain: "c1", agent: "", at: 50 }] },
        { path: "k.js", oldPath: null, status: "M", added: 1, removed: 0, binary: false, untracked: false, by: [{ chain: "c1", agent: "", at: 50 }, { chain: "c2", agent: "", at: 40 }] },
        { path: "c.js", oldPath: null, status: "A", added: null, removed: null, binary: false, untracked: true, by: [] },
      ],
    },
    {
      kind: "copy", cwd: "/wt/sa_1", ok: true, place: "/wt/sa_1", worktree: true, branch: null, detached: true, base: "main", ahead: 0, behind: 0, sub: "sa_1",
      files: [{ path: "x.js", oldPath: null, status: "M", added: 3, removed: 0, binary: false, untracked: false, by: [{ chain: "c1", agent: "sa_1", at: 60 }] }],
    },
    {
      kind: "other", cwd: "/r-docs", ok: true, place: "/r-docs", worktree: true, branch: "docs-pass", detached: false, base: "main", ahead: 2, behind: 0,
      files: [{ path: "k.js", oldPath: null, status: "M", added: 1, removed: 0, binary: false, untracked: false, by: [{ chain: "c2", agent: "", at: 40 }] }],
    },
  ],
  chats: { c1: { title: "Changes drive", model: "claude-opus-5-5" }, c2: { title: "Fix login", model: "claude-sonnet-5-5" } },
  homes: {},
  atWork: ["c2"],
};
/** A sub-agent of the chat whose own copy holds a file that waits for its Apply. @param {any} [o] @returns {any} */
const scout = (o = {}) => ({
  id: "sa_1", card: { name: "Scout" }, description: "find the retry", model: "glm-5.3", may: "edit", status: "done", startedAt: 10, endedAt: 60,
  work: { pending: 1, added: 3, removed: 0, applied: 0, folder: "/wt/sa_1", sig: "s1", files: [{ path: "x.js", status: "M", added: 3, removed: 0 }] },
  ...o,
});
/** The doors the page hands the band; `diffsOf` counts the copy's diff reads. @param {string[]} diffsOf */
const doorsOf = (diffsOf) => ({
  openSubagent: () => {},
  openChat: () => {},
  stopSubagent: () => {},
  diffOf: async (/** @type {string} */ id) => {
    diffsOf.push(id);
    return { diff: PATCH_X };
  },
  preview: async () => ({ came: [{ path: "x.js", how: "took" }], conflicts: [], folder: "/wt/sa_1", repo: "/r" }),
  apply: async () => /** @type {const} */ ({ ok: true }),
  modelName: (/** @type {string} */ id) => id,
});
/** @param {any} root @param {string} path */
const rowsOf = (root, path) => root.querySelectorAll(".chg-file").filter((/** @type {any} */ r) => r.getAttribute("data-path") === path);
/** The lines a diff's box shows: the plain rows' words, or the rich diff's markup once it took their place. @param {any} box */
const linesOf = (box) => `${box.textContent}${box.querySelector(".pierre-diff")?.innerHTML || ""}`;
/** The button among `root`'s whose words are `label`. @param {any} root @param {string} label */
const buttonOf = (root, label) => root.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === label) || null;

// (fails before: yes — each paint drew the summary and the list anew: the line, its ⋯, the row, the diff's box, the
// copy's Apply all new elements)
test("the pane's parts stand across the per-minute paint and a read landing; an open diff is drawn again only as it changes; the row and the line act", async () => {
  let patchA = PATCH_A;
  serve = (u) => (u.startsWith(URL_R) ? ANSWER : u === URL_A ? { patch: patchA } : undefined);
  const clock = { now: 1_000_000 };
  /** @type {string[]} */
  const diffsOf = [];
  const body = h("div", { class: "pane-body" });
  doc.document.body.append(body);
  const ctx = /** @type {any} */ ({
    chat: { chainId: "c1", cwd: "/r", turns: [], live: null },
    setBadge: () => {},
    subagents: () => [scout()],
    openSubagent: () => {},
    model: () => "claude-opus-5-5",
    band: () => doorsOf(diffsOf),
    now: () => clock.now,
  });
  renderChanges(body, ctx);
  const reads = () => asked.filter((u) => u.startsWith(URL_R)).length;
  const diffReads = () => asked.filter((u) => u === URL_A).length;
  const copyBlock = () => body.querySelectorAll(".chp-place")[1];
  await until(() => body.querySelector(".chp-place"), "the places drawn");
  // The copy's dry run lands: the band draws the pane again, its Apply ready.
  await until(() => copyBlock()?.querySelector(".agb-apply") && !copyBlock().querySelector(".agb-apply").hasAttribute("disabled"), "the copy's dry run");
  rowsOf(body, "src/a.js")[0].dispatch("click");
  await until(() => body.querySelector(".chg-dh"), "the diff open under its row");
  assert.equal(diffReads(), 1);

  const parts = () => ({
    sum: body.querySelector(".chp-sum-t"),
    line: body.querySelector(".chp-agent"),
    more: body.querySelector(".agb-more"),
    row: rowsOf(body, "src/a.js")[0],
    box: body.querySelector(".chg-diff"),
    head: body.querySelector(".chg-dh"),
    apply: copyBlock().querySelector(".agb-apply"),
    show: buttonOf(copyBlock(), "Show the diff"),
  });
  const was = parts();
  const blocks = body.querySelectorAll(".chp-place");
  assert.ok(Object.values(was).every(Boolean) && blocks.length === 3, "the summary, a line and its ⋯, the row, the diff and its header, the copy's Apply and Show the diff");
  /** @param {string} when @param {string[]} [but]  the parts drawn anew on purpose */
  const same = (when, but = []) => {
    const now = parts();
    for (const k of /** @type {(keyof typeof was)[]} */ (Object.keys(was))) if (!but.includes(k)) assert.ok(now[k] === was[k], `${k} stands ${when}`);
    const places = body.querySelectorAll(".chp-place");
    assert.ok(places.length === blocks.length && places.every((/** @type {any} */ b, /** @type {number} */ i) => b === blocks[i]), `the blocks stand ${when}`);
  };

  // The per-minute paint: nothing read, the pane drawn again.
  clock.now += 20_000;
  refreshChanges(body, ctx);
  assert.equal(reads(), 1, "nothing read");
  same("across the per-minute paint");
  await settle();
  same("once the paint's microtasks ran");
  assert.equal(diffReads(), 1, "the diff open was not read again");

  // The pane's own look once the answer is old: the read lands, the pane is drawn again, the open diff read again — the
  // same, so its header stands.
  clock.now += 11_000;
  refreshChanges(body, ctx);
  await until(() => reads() === 2 && diffReads() === 2, "the read once the answer is old, and the diff's");
  await settle();
  same("across a read landing");
  assert.equal(body.querySelector(".chg-dh-path")?.textContent, "src/a.js");

  // The file moved: the next read draws the diff anew inside the box that stands.
  patchA = PATCH_A2;
  clock.now += 31_000;
  refreshChanges(body, ctx);
  await until(() => reads() === 3 && diffReads() === 3, "the third read, and the diff's");
  await until(() => linesOf(body.querySelector(".chg-diff")).includes("four"), "the new line drawn");
  same("as the diff changes", ["head"]);
  assert.notEqual(parts().head, was.head, "its header drawn anew with it");
  was.head = parts().head;

  // Show the diff in the copy's block: the band's box, read once; the per-minute paint keeps it and what it holds.
  was.show.dispatch("click");
  const band = await until(() => body.querySelector(".agb-diff"), "the copy's diff box");
  await until(() => band.querySelector(".diff-view"), "its diff read");
  assert.deepEqual(diffsOf, ["sa_1"]);
  const hide = buttonOf(copyBlock(), "Hide the diff");
  assert.ok(hide, "Show the diff became Hide the diff");
  clock.now += 20_000;
  refreshChanges(body, ctx);
  await settle();
  assert.equal(reads(), 3, "nothing read");
  same("across the paint with the copy's diff shown", ["show"]);
  assert.equal(body.querySelector(".agb-diff"), band, "the copy's diff box stands");
  assert.ok(band.querySelector(".diff-view"), "with its diff");
  assert.equal(buttonOf(copyBlock(), "Hide the diff"), hide, "Hide the diff stands");
  assert.deepEqual(diffsOf, ["sa_1"], "its diff read once");

  // The handlers act on what the newest draw showed: the row's press closes its diff, and the row stands; Enter on the
  // other chat's line unfolds its files.
  was.row.dispatch("click");
  assert.equal(body.querySelector(".chg-diff"), null, "the diff closed by its row");
  assert.equal(rowsOf(body, "src/a.js")[0], was.row, "the row stands as its diff closes");
  assert.equal(was.line.getAttribute("aria-expanded"), "false", "another chat's line, folded");
  was.line.dispatch("keydown", { key: "Enter" });
  assert.equal(body.querySelector(".chp-agent")?.getAttribute("aria-expanded"), "true", "unfolded by Enter");
  assert.equal(rowsOf(body, "k.js").length, 2, "its file under it, and under your agent");
  body.remove();
});

// (fails before: yes — the developer's reviewer of 11-02: the copy's buttons, keyless, were drawn over one another by
// order as its Apply came to be stuck, so the Show the diff that stood became Send back to rebase, its press a rebase)
test("a copy's Apply that comes to be stuck keeps each button the one it was: Show the diff stays Show the diff, and its press shows the diff", async () => {
  /** @type {string[]} */
  const diffsOf = [];
  /** @type {string[]} */
  const did = [];
  let s = scout();
  let stuck = false;
  const el = /** @type {any} */ (doc.document.createElement("section"));
  doc.document.body.append(el);
  const draw = () => morphChildren(el, band.workOf(s));
  const band = createBand(/** @type {any} */ ({
    ...doorsOf(diffsOf), editorButton: () => null, repaint: () => draw(), shown: () => el.isConnected,
    preview: async () => (stuck
      ? { came: [], conflicts: [{ path: "x.js", why: "2 changes overlap yours", kind: "lines", overlaps: 2, choices: ["yours", "its", "both"] }], folder: "/wt/sa_1", repo: "/r" }
      : { came: [{ path: "x.js", how: "took" }], conflicts: [], folder: "/wt/sa_1", repo: "/r" }),
    rebase: async () => (did.push("rebase"), { ok: true }),
  }));
  draw();
  await until(() => buttonOf(el, "Apply 1 file") && !buttonOf(el, "Apply 1 file").hasAttribute("disabled"), "the clean dry run");
  const diff = buttonOf(el, "Show the diff");
  assert.ok(diff, "Show the diff");
  // Your folder moved under it: the dry run read again says it is stuck.
  stuck = true;
  s = scout({ work: { ...scout().work, sig: "s2" } });
  draw();
  await until(() => buttonOf(el, "Send back to rebase"), "the stuck block");
  assert.equal(buttonOf(el, "Show the diff"), diff, "Show the diff stands");
  assert.equal(diff.textContent, "Show the diff", "and says what it does");
  diff.dispatch("click");
  await settle();
  assert.deepEqual(did, [], "no rebase");
  assert.ok(buttonOf(el, "Hide the diff"), "the diff shown");
  band.stop();
  el.remove();
});

// (fails before: yes — the band kept the box across draws and put it inside each draw's tree, which took it off the
// page: `workOf` left the page without it)
test("the band's diff box is each draw's own: the one on the page stays where it is, holds its diff across draws, and reads again only as the work moved", async () => {
  /** @type {string[]} */
  const diffsOf = [];
  let s = scout();
  const el = /** @type {any} */ (doc.document.createElement("section"));
  doc.document.body.append(el);
  const draw = () => morphChildren(el, band.workOf(s));
  const band = createBand(/** @type {any} */ ({ ...doorsOf(diffsOf), editorButton: () => null, repaint: () => draw(), shown: () => el.isConnected }));
  draw();
  /** @type {any} */ (buttonOf(el, "Show the diff")).dispatch("click");
  const box = await until(() => el.querySelector(".agb-diff"), "the box");
  await until(() => box.querySelector(".diff-view"), "its diff read");
  assert.deepEqual(diffsOf, ["sa_1"]);
  const hide = buttonOf(el, "Hide the diff");
  assert.ok(hide);

  // A draw's tree leaves the box where it is.
  const next = band.workOf(s);
  assert.ok(box.isConnected, "the box stays on the page while a draw is made");
  morphChildren(el, next);
  await settle();
  assert.equal(el.querySelector(".agb-diff"), box, "the box stands");
  assert.ok(box.querySelector(".diff-view"), "with its diff");
  assert.equal(buttonOf(el, "Hide the diff"), hide, "Hide the diff stands");
  assert.deepEqual(diffsOf, ["sa_1"], "read once");

  // Its work moved: read again, into the box that stands.
  s = scout({ work: { ...scout().work, sig: "s2", added: 4 } });
  draw();
  await until(() => diffsOf.length === 2, "read again as its work moved");
  await settle();
  assert.equal(el.querySelector(".agb-diff"), box, "the box stands as its work moves");
  assert.ok(box.querySelector(".diff-view"));

  // Hidden and shown again: drawn from what was read, nothing read.
  /** @type {any} */ (buttonOf(el, "Hide the diff")).dispatch("click");
  assert.equal(el.querySelector(".agb-diff"), null, "hidden");
  /** @type {any} */ (buttonOf(el, "Show the diff")).dispatch("click");
  const again = el.querySelector(".agb-diff");
  assert.ok(again, "shown again");
  await until(() => again.querySelector(".diff-view"), "drawn from what was read");
  assert.equal(diffsOf.length, 2, "nothing read");
  band.stop();
  el.remove();
});

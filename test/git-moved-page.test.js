// @ts-check
// The page hears a git mark that moved (the slowness of 11-02): the server answers `/git/place`, `/git/where` and
// `/git/places` at once from their last reads and reads each again behind its answer, and where that read differs the
// feed says `git-moved` — which read, and each spelling of the folder it was asked by. The header's chip asks again for
// the chat's place and for the place the agent works in now, the sidebar for each folder it reads that way; another
// read's word, or another folder's, asks nothing.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** What the stand-in server answers, by address (the page's api reads `fetch` as its module loads). @type {(url: string) => any} */
let serve = () => null;
/** The addresses asked. @type {string[]} */
const asked = [];
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => {
  asked.push(String(url));
  const body = await serve(String(url));
  return body == null ? new Promise(() => {}) : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
after(() => {
  g.fetch = realFetch;
});
const { gitMovedFor } = await import("../src/ui/harness/lib/git-moved.js");
const { createHeader } = await import("../src/ui/harness/header.js");
const { apiShared } = await import("../src/ui/harness/lib/api.js");
const tick = () => new Promise((r) => setImmediate(r));

test("a git-moved names a read and a folder however its slashes, case and last slash are spelled", () => {
  const msg = { type: "git-moved", what: "apart", folders: ["C:\\Work\\App", "c:/work/app-link"] };
  assert.equal(gitMovedFor(msg, "apart", ["c:/work/app/"]), true);
  assert.equal(gitMovedFor(msg, ["light", "apart"], [null, "C:/WORK/APP-LINK"]), true);
  assert.equal(gitMovedFor(msg, "light", ["c:/work/app"]), false, "another read");
  assert.equal(gitMovedFor(msg, "apart", ["c:/work/ap"]), false, "another folder");
  assert.equal(gitMovedFor({ type: "turn", what: "apart", folders: ["c:/work/app"] }, "apart", ["c:/work/app"]), false);
});

// (fails before: yes — the header read the place once per chat and at a turn's end; what the server read behind the
// answer it gave never reached the chip)
test("the header asks again for the chat's place, and for the place the agent works in now, where the feed says it moved", async () => {
  const doc = stubDocument();
  try {
    serve = (u) => (u.startsWith("/api/git/place?") ? { ok: true, place: "C:/work", branch: "main", worktree: false, also: [{ ok: true, cwd: "D:/also", place: "D:/also", branch: "x" }] } : null);
    const noop = () => {};
    const hd = /** @type {any} */ (createHeader({ onFork: noop, onReload: noop, onRenamed: noop, onArchived: noop, onToast: noop, getChat: () => null }));
    hd.folderIn.dispatchEvent = () => true;
    const chat = { id: "c1", chainId: "s1", cwd: "C:/work", turns: [] };
    hd.setChat(chat);
    await hd.refreshGit();
    const placeReads = () => asked.filter((u) => u.startsWith("/api/git/place?cwd=C%3A%2Fwork&chain=s1")).length;
    const n = placeReads();
    hd.gitMoved({ type: "git-moved", what: "apart", folders: ["C:/work"] });
    hd.gitMoved({ type: "git-moved", what: "place", folders: ["C:/elsewhere"] });
    await tick();
    assert.equal(placeReads(), n, "another read's word, or another folder's: nothing asked");
    hd.gitMoved({ type: "git-moved", what: "place", folders: ["c:\\work\\"] });
    await until(() => placeReads() === n + 1, "the chat's place asked again");
    await tick();
    hd.gitMoved({ type: "git-moved", what: "place", folders: ["D:/also"] });
    await until(() => placeReads() === n + 2, "one of its other places moved: asked again");
    // The agent works outside the chat's folder: its place read once, and again where it moved.
    const nowReads = () => asked.filter((u) => u === "/api/git/place?cwd=E%3A%2Fwt").length;
    hd.setNow({ place: "E:/wt", home: false });
    await until(() => nowReads() === 1, "the place the agent works in read");
    hd.setNow({ place: "E:/wt", home: false });
    await tick();
    assert.equal(nowReads(), 1, "read once while it works there");
    hd.gitMoved({ type: "git-moved", what: "place", folders: ["E:/wt"] });
    await until(() => nowReads() === 2, "asked again where it moved");
  } finally {
    doc.restore();
  }
});

// (fails before: yes — the review of 11-02: the header's ask again took the read on its way, begun before the move, and
// drew its answer — the move's was never asked for)
test("a move heard while the header's read is on its way: read again, and the newer answer stands", async () => {
  const doc = stubDocument();
  /** @type {Array<(body: any) => void>} */
  const held = [];
  try {
    serve = (u) => (u.startsWith("/api/git/place?cwd=C%3A%2Fheld") ? new Promise((land) => held.push(land)) : null);
    const noop = () => {};
    const hd = /** @type {any} */ (createHeader({ onFork: noop, onReload: noop, onRenamed: noop, onArchived: noop, onToast: noop, getChat: () => null }));
    hd.folderIn.dispatchEvent = () => true;
    const chat = { id: "h1", chainId: "sh", cwd: "C:/held", turns: [] };
    hd.setChat(chat);
    const first = hd.refreshGit();
    await until(() => held.length === 1, "the read on its way");
    hd.gitMoved({ type: "git-moved", what: "place", folders: ["C:/held"] });
    await until(() => held.length === 2, "read again, not the read begun before");
    held[1]({ ok: true, place: "C:/held", branch: "main", ahead: 2, also: [] });
    await until(() => hd.placeOf(chat)?.ahead === 2, "the newer answer drawn");
    held[0]({ ok: true, place: "C:/held", branch: "main", ahead: 1, also: [] });
    await first;
    await tick();
    assert.equal(hd.placeOf(chat)?.ahead, 2, "the older answer, landing after, draws nothing");
  } finally {
    doc.restore();
  }
});

test("a shared read: one begun before `since` is not shared; the one begun in its place is", async () => {
  /** @type {string[]} */
  const reads = [];
  const read = async (/** @type {string} */ p) => {
    const n = reads.push(p);
    return new Promise((r) => setTimeout(() => r(n), 5));
  };
  const a = apiShared("/x", { read });
  const b = apiShared("/x", { read });
  const c = apiShared("/x", { read, since: Date.now() });
  const d = apiShared("/x", { read });
  assert.deepEqual(await Promise.all([a, b, c, d]), [1, 1, 2, 2]);
  assert.equal(reads.length, 2);
});

// (fails before: yes — the sidebar read each folder once a minute; a mark the server read again behind its answer
// waited for that minute)
test("the sidebar asks again for a folder it reads, the way it reads it, where the feed says it moved", async () => {
  const doc = stubDocument();
  const had = { EventSource: g.EventSource, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener, localStorage: g.localStorage };
  const d = /** @type {any} */ (document);
  d.addEventListener = () => {};
  d.removeEventListener = () => {};
  /** The page's one stream of the feed, as the bus opened it. @type {any[]} */
  const streams = [];
  g.EventSource = class {
    constructor() {
      streams.push(this);
    }
    addEventListener() {}
    close() {}
  };
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const t = Date.now();
  let ahead = 2;
  const WT = () => ({ ok: true, cwd: "H:\\w\\app-space", place: "H:/w/app-space", worktree: true, main: "H:/w/app", branch: "space", detached: false, head: "abc1234", error: null, base: "main", onBase: false, ahead, behind: 0, uncommitted: { files: 0, added: 0, removed: 0 } });
  serve = (u) => {
    if (u.startsWith("/api/git/where?")) return { places: { "H:\\w\\app-space": WT() } };
    if (u.startsWith("/api/spaces")) return { open: {}, needs: {}, extended: true, next: null, own: [] };
    return { sessions: [{ id: "c1", title: "space", when: t, project: "p1", projectName: "app", cwd: "H:\\w\\app-space", places: [] }], projects: [{ id: "p1", name: "app", cwd: "H:\\w\\app" }], runs: [] };
  };
  try {
    const { createSidebar } = await import("../src/ui/harness/sidebar.js");
    const host = document.createElement("div");
    const sb = createSidebar(/** @type {any} */ (host), /** @type {any} */ ({ onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {}, onSpace() {}, onYourSpace() {} }));
    await sb.load();
    /** Every element under one, in order. @param {any} el @returns {any[]} */
    const all = (el) => [el, ...[...(el.children || [])].flatMap(all)];
    const marks = () => all(host).filter((x) => String(x.className).includes("row-apart")).map((x) => x.textContent);
    await until(() => marks().includes("↑2"), "the mark drawn");
    const reads = () => asked.filter((u) => u.startsWith("/api/git/where?apart=1&")).length;
    const n = reads();
    ahead = 3;
    /** @param {any} msg */
    const say = (msg) => streams[0].onmessage({ data: JSON.stringify(msg) });
    assert.equal(streams.length, 1, "the bus's one stream");
    say({ type: "git-moved", what: "light", folders: ["H:/w/app-space"] });
    say({ type: "git-moved", what: "apart", folders: ["H:/w/app"] });
    await tick();
    assert.equal(reads(), n, "read apart, the light read's word asks nothing; nor another folder's");
    say({ type: "git-moved", what: "apart", folders: ["C:/real/app-space", "h:/w/app-space"] });
    await until(() => marks().includes("↑3"), "asked again within the minute, and drawn");
    assert.equal(reads(), n + 1);
  } finally {
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
    doc.restore();
  }
});

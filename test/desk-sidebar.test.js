// @ts-check
// The desk in the left bar (the remote desk of 11-22, s1b): every other machine's chats beside This computer's. What
// the app tells the page is read field by field — every string in it is another machine's — and each row keyed by its
// machine, never a chat id of this computer's (lib/desk.js); Now draws their rows among its own, each with its machine's
// chip, greyed while that machine does not answer, a press opening it on its machine (now-list.js); and under the
// projects, a repository's chats on every machine stand as one — by a remote that names a host alone (sidebar.js).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeH, fakeDrawIn, textOf } from "./helpers/fake-dom.js";
import { createNow } from "../src/ui/harness/now-list.js";
import { ICONS } from "../src/ui/harness/lib/icons.js";
import { MACHINE_COLORS, MACHINE_ICONS, awayWords, deskGroups, deskListKey, deskMarks, deskProjects, deskRoute, mergeKey, ownKeysOf, readDesk } from "../src/ui/harness/lib/desk.js";

const mk = /** @type {any} */ (fakeH);
/** Every node under `el` that carries the class, in order. @param {any} el @param {string} c @returns {any[]} */
const every = (el, c) => {
  /** @type {any[]} */
  const out = [];
  /** @param {any} n */
  const walk = (n) => {
    for (const k of n?.kids || []) {
      if (!k || typeof k !== "object") continue;
      if (String(k.attrs?.class || "").split(/\s+/).includes(c)) out.push(k);
      walk(k);
    }
  };
  walk(el);
  return out;
};

const T = 90_000_000;
/** A row of a machine's Now as its watch gives it (lib/now.js NowRow). @param {Record<string, any>} o */
const nowRow = (o) => ({ key: `chat:${o.chain}`, thread: null, group: "works", title: "A chat", project: "shop", fact: "working", tone: "", icon: "messageSquare", tile: "model", model: "opus", at: T, under: [], team: "", step: "", ...o });
/** A chat as its watch lists it (desktop/lib/watch.js DeskChat). @param {Record<string, any>} o */
const chat = (o) => ({ title: "A chat", project: "shop", projectId: "p1", cwd: "/w/shop", when: T, unread: false, pinned: false, threadOf: null, from: "", remoteKey: null, ...o });
/** The desk as main.js tells it: This computer, Studio online, Laptop offline. */
const told = () => ({
  here: { id: "local", name: "This computer", color: "purple", icon: "monitor" },
  machines: [
    {
      id: "m-studio", name: "Studio", status: "online", refused: false, color: "teal", icon: "server", flags: ["remote-key"],
      rows: { needs: [nowRow({ chain: "s1", group: "needs", fact: "asks: Which branch?", tone: "asks", tile: "needs", at: T - 1000 })], works: [nowRow({ chain: "s2", at: T - 5000 })], done: [] },
      recent: [chat({ chain: "s1", remoteKey: "github.com/o/shop" }), chat({ chain: "s3", title: "Docs pass", remoteKey: "github.com/o/shop", when: T - 9000 }), chat({ chain: "s4", title: "Infra", project: "infra", projectId: "p9", remoteKey: "/srv/git/infra", when: T - 8000 })],
    },
    {
      id: "m-laptop", name: "Laptop", status: "offline", refused: false, color: "orange", icon: "laptop", flags: [],
      rows: { needs: [], works: [nowRow({ chain: "l1", at: T - 2000 })], done: [nowRow({ chain: "l2", group: "done", fact: "finished", tile: "done", at: T - 3000 })] },
      recent: [chat({ chain: "l3", title: "Laptop's shop chat", remoteKey: "github.com/o/shop", when: T - 4000 }), chat({ chain: "l4", title: "Laptop's infra", project: "infra", projectId: "q2", remoteKey: "/srv/git/infra", when: T - 7000 }), chat({ chain: "l5", title: "Blog", project: "blog", projectId: "q3", remoteKey: "gitlab.example/me/blog", when: T - 6000 })],
    },
  ],
});

describe("lib/desk.js: what the app tells, read", () => {
  // (fails before: yes — the page read no desk)
  test("each row keyed by its machine, its chat's id there apart; every field checked; a refused machine's rows none", () => {
    const raw = told();
    raw.machines[0].rows.works.push(nowRow({ chain: "s9", title: "x\u0007y".padEnd(400, "z"), icon: "constructor", tile: "evil", tone: "<b>", project: 5, space: undefined }), nowRow({ chain: "bad id!" }), nowRow({ chain: "s10", space: { project: "p", name: "Pulse" } }));
    raw.machines.push({ id: "m-gone", name: "Gone", status: "online", refused: true, color: "blue", icon: "cloud", flags: [], rows: { needs: [nowRow({ chain: "g1" })], works: [], done: [] }, recent: [chat({ chain: "g2" })] });
    raw.machines.push(/** @type {any} */ ({ id: "local", name: "Me again", rows: { needs: [nowRow({ chain: "z" })] } }), /** @type {any} */ ({ id: "m-studio", name: "Studio twin" }), /** @type {any} */ ({ name: "no id" }));
    const d = readDesk(raw);
    assert.ok(d);
    assert.deepEqual(d.machines.map((m) => [m.id, m.name, m.status, m.color, m.icon]), [
      ["m-studio", "Studio", "online", "teal", "server"],
      ["m-laptop", "Laptop", "offline", "orange", "laptop"],
      ["m-gone", "Gone", "online", "blue", "cloud"],
    ], "This computer's own id, a second of one id and one with none: none");
    const s = d.machines[0];
    assert.deepEqual(s.rows.needs.map((r) => [r.key, r.chain, r.there.chain, r.group, r.tone]), [["m:m-studio/chat:s1", "m:m-studio/chat:s1", "s1", "needs", "asks"]], "no chat of this computer's is found by it");
    const odd = s.rows.works.find((r) => r.there.chain === "s9");
    assert.ok(odd);
    assert.deepEqual([odd.title.length, odd.title.slice(0, 3), odd.icon, odd.tile, odd.tone, odd.project], [300, "x y", "messageSquare", "agent", "", ""], "words clipped, control characters gone, a glyph this page has, its marks as they may be");
    assert.equal(Object.prototype.hasOwnProperty.call(ICONS, "constructor"), false);
    assert.deepEqual(s.rows.works.map((r) => r.there.chain), ["s2", "s9"], "an id that is no id, and a Space's button: none");
    assert.deepEqual([d.machines[2].rows, d.machines[2].recent], [{ needs: [], works: [], done: [] }, []], "a machine that signed this window out: none of its rows");
    assert.deepEqual(s.flags, ["remote-key"]);
    const c = s.recent[0];
    assert.deepEqual([c.key, c.there.chain, c.remoteKey, c.merge, c.machine.name], ["m:m-studio/chat:s1", "s1", "github.com/o/shop", "github.com/o/shop", "Studio"]);
    assert.equal(s.recent[2].merge, null, "a remote that is a folder stands with nothing");
    assert.equal(readDesk(null), null);
    assert.equal(readDesk({ machines: "x" }), null);
    const bad = readDesk({ machines: [{ id: "m-x", color: "red; background:url(x)", icon: "<svg>", status: "pwned" }] });
    assert.deepEqual([bad?.machines[0].color, bad?.machines[0].icon, bad?.machines[0].status, bad?.machines[0].name], ["blue", "monitor", "reconnecting", "Another machine"], "a colour, an icon and a state this page knows, else its own");
    // (fails before: yes — the s1e review) A chat whose id is dots alone, which Clear would send up its path there
    // (/sessions/../settings), is no chat; a machine's no machine.
    const dots = readDesk({ machines: [{ id: "..", name: "Up" }, { id: "m-y", name: "Y", recent: [{ chain: "..", title: "up", when: 1 }, { chain: "c.1", title: "ok", when: 2 }] }] });
    assert.deepEqual([dots?.machines.map((m) => m.id), dots?.machines[0].recent.map((c) => c.there.chain)], [["m-y"], ["c.1"]]);
  });

  test("mergeKey: a key that names a host; a folder, a relative path, a drive, a home folder, none", () => {
    assert.equal(mergeKey("github.com/o/r"), "github.com/o/r");
    assert.equal(mergeKey("GitLab.Example/Group/Sub/R"), "gitlab.example/group/sub/r");
    assert.equal(mergeKey("gitserver/repo"), "gitserver/repo");
    for (const k of ["/srv/git/app", "../app", "./app", "C:/repos/app", "c:/x", "~/app", "\\\\server\\share", "github.com", "github.com/", "", "a b/c", null, 7]) assert.equal(mergeKey(k), null, String(k));
  });

  test("deskRoute: a chat's address on its machine's page, a thread's on its Sub Agents view", () => {
    assert.equal(deskRoute({ chain: "s1", thread: null }), "#/task/s1");
    assert.equal(deskRoute({ chain: "a/b", thread: "t1" }), "#/task/a%2Fb/side");
  });

  test("deskGroups: every machine's Now as one, newest first; a machine left out, none of its", () => {
    const d = readDesk(told());
    const g = deskGroups(d);
    assert.deepEqual(g.works.map((r) => r.key), ["m:m-laptop/chat:l1", "m:m-studio/chat:s2"]);
    assert.deepEqual(g.done.map((r) => r.key), ["m:m-laptop/chat:l2"]);
    assert.deepEqual(deskGroups(d, new Set(["m-laptop"])).works.map((r) => r.key), ["m:m-studio/chat:s2"]);
    assert.deepEqual(deskGroups(null), { needs: [], works: [], done: [] });
  });

  // (fails before: yes — no list said a chat's repository)
  test("deskProjects: a repository's chats under the project here that has it; the rest as one per repository, else per machine's project; by machine, apart", () => {
    const d = readDesk(told());
    const { joined, apart } = deskProjects(d, new Map([["github.com/o/shop", "own-shop"]]));
    assert.deepEqual(joined.get("own-shop")?.map((c) => c.key), ["m:m-studio/chat:s1", "m:m-laptop/chat:l3", "m:m-studio/chat:s3"], "both machines' chats of its repository, newest first");
    assert.deepEqual(apart.map((g) => [g.key, g.name, g.machines.map((m) => m.id), g.chats.map((c) => c.there.chain)]), [
      ["repo:gitlab.example/me/blog", "blog", ["m-laptop"], ["l5"]],
      ["m:m-laptop/project:q2", "infra", ["m-laptop"], ["l4"]],
      ["m:m-studio/project:p9", "infra", ["m-studio"], ["s4"]],
    ], "two machines' /srv/git/infra are two projects: a folder says nothing across machines");
    const none = deskProjects(d, new Map());
    assert.deepEqual(none.apart[0].key, "repo:github.com/o/shop");
    assert.deepEqual(none.apart[0].machines.map((m) => m.id), ["m-studio", "m-laptop"], "one repository on two machines: one group");
    const byMachine = deskProjects(d, new Map([["github.com/o/shop", "own-shop"]]), new Set(["m-laptop"]), { merge: false });
    assert.equal(byMachine.joined.size, 0);
    assert.deepEqual(byMachine.apart.map((g) => g.key), ["m:m-studio/project:p1", "m:m-studio/project:p9"], "one machine's, each project its own");
  });

  // (fails before: yes — the review of s1b: every chat with a row in their Now stood nowhere while Now hid it, and a
  // thread or a side team's chat stood as a project's own)
  test("deskProjects: what Now shows stands there alone; the rest here; a thread or a side team's none", () => {
    const raw = told();
    raw.machines[0].recent.push(chat({ chain: "s5", title: "Its thread", threadOf: "s3", remoteKey: "github.com/o/shop" }), chat({ chain: "s6", title: "Side team", kind: "team", remoteKey: "github.com/o/shop" }));
    const d = readDesk(raw);
    const keys = (/** @type {ReturnType<typeof deskProjects>} */ p) => [...(p.joined.get("own") || []), ...p.apart.flatMap((g) => g.chats)].map((c) => c.there.chain).sort();
    const own = new Map([["github.com/o/shop", "own"]]);
    assert.deepEqual(keys(deskProjects(d, own)), ["l3", "l4", "l5", "s1", "s3", "s4"], "Now folded: every one of theirs here");
    assert.deepEqual(keys(deskProjects(d, own, new Set(), { inNow: new Set(["m:m-studio/chat:s1"]) })), ["l3", "l4", "l5", "s3", "s4"], "one Now shows: there alone");
  });

  test("ownKeysOf: each project here by its repository, a key two share the first's; mergeKey's rule", () => {
    assert.deepEqual([...ownKeysOf([{ id: "p1", remoteKey: "github.com/o/shop" }, { id: "p2", remoteKey: "github.com/o/shop" }, { id: "p3", remoteKey: "/srv/git/x" }, { id: "p4" }, null])], [["github.com/o/shop", "p1"]]);
  });

  // (fails before: yes — the review of s1b: every word their agents said drew the bar whole)
  test("deskListKey moves with what the list shows — a chat's title, a machine's state, what stands in Now, a mark — and not with a Now row's words", () => {
    const d = readDesk(told());
    const base = deskListKey(d, new Set(), new Map());
    const moved = readDesk(told());
    if (!moved) throw new Error("no desk");
    moved.machines[0].rows.works[0].fact = "Edit src/app.js";
    assert.equal(deskListKey(moved, new Set(), new Map()), base, "Now draws that alone");
    moved.machines[1].status = "online";
    assert.notEqual(deskListKey(moved, new Set(), new Map()), base);
    assert.notEqual(deskListKey(d, new Set(["m:m-studio/chat:s1"]), new Map()), base);
    assert.notEqual(deskListKey(d, new Set(), deskMarks(deskGroups(d))), base);
    assert.deepEqual([...deskMarks(deskGroups(d))], [["m:m-laptop/chat:l1", "works"], ["m:m-studio/chat:s2", "works"], ["m:m-studio/chat:s1", "needs"]]);
  });

  // (fails before: yes — the review of s1b: a moment past a Date's threw where its row's age is written, and the bar drew no more)
  test("a moment no Date holds is none", () => {
    const raw = told();
    raw.machines[0].recent[0].when = 1e20;
    raw.machines[0].rows.works[0].at = 1e20;
    const d = readDesk(raw);
    assert.deepEqual([d?.machines[0].recent[0].when, d?.machines[0].rows.works[0].at], [0, 0]);
  });

  test("awayWords: none while it answers; why its rows stand as they last stood", () => {
    const d = readDesk(told());
    assert.equal(awayWords(d?.machines[0] ?? /** @type {any} */ ({})), "");
    assert.equal(awayWords(d?.machines[1] ?? /** @type {any} */ ({})), "Laptop is offline: its chats as they last stood");
    assert.match(awayWords({ id: "x", name: "Box", color: "blue", icon: "server", status: "disconnected", refused: false }), /disconnected in this window/);
  });

  test("the machine chip and the desk name the same colours and icons as the app (desktop/lib/machines.js)", async () => {
    const m = await import("../desktop/lib/machines.js");
    assert.deepEqual([...MACHINE_COLORS], [...m.MACHINE_COLORS]);
    assert.deepEqual([...MACHINE_ICONS], [...m.MACHINE_ICONS]);
    for (const i of MACHINE_ICONS) assert.ok(Object.prototype.hasOwnProperty.call(ICONS, i), `${i} drawn`);
  });
});

describe("Now lists every machine's rows (now-list.js)", () => {
  /** Now with one chat of its own at work, and the desk's rows. */
  async function deskNow() {
    const t = Date.now();
    const d = readDesk(told());
    // Their moments as now's: Now reads its own clock.
    for (const m of d?.machines || []) for (const g of /** @type {const} */ (["needs", "works", "done"])) for (const r of m.rows[g]) r.at = t - (T - r.at);
    const runs = [{ id: "r1", kind: "agent-turn", status: "running", startedAt: t - 3000, endedAt: null, events: 1, meta: { chain: "c1", model: "opus" } }];
    /** @type {any[]} */
    const opened = [];
    /** @type {any[]} */
    const openedThere = [];
    /** @type {any[]} */
    const seenThere = [];
    let more = /** @type {any} */ (deskGroups(d));
    /** What the rail's badge was told, each time. @type {[number, number][]} */
    const counts = [];
    const now = createNow({
      h: mk, drawIn: fakeDrawIn, call: /** @type {any} */ (async () => ({ events: [] })),
      chats: (c) => (c === "c1" ? { title: "Parser refactor", project: "filament", when: t, unread: false } : null),
      unread: () => new Set(), holders: () => new Map(), onOpen: (r) => void opened.push(r.chain), onSeen: () => {},
      more: () => more, onOpenMore: (r) => void openedThere.push([r.machine.id, r.there.chain]), onSeenMore: (rows) => void seenThere.push(rows.map((r) => r.key)),
      onCount: (n, w) => void counts.push([n, w]),
    });
    await now.update(/** @type {any} */ (runs));
    return { now, opened, openedThere, seenThere, counts, more: () => more, setMore: (/** @type {any} */ m) => { more = m; now.refresh(); } };
  }

  // (fails before: yes — the hunt on s1b: the rail's badge counted this computer's alone, and heard nothing of theirs moving)
  test("the rail's badge is told what needs you and what works anywhere, as Now's head counts it — again as only theirs move", async () => {
    const { counts, more, setMore } = await deskNow();
    const g = more();
    assert.ok(g.needs.length > 0 && g.works.length > 0, "the desk has rows of both");
    assert.deepEqual(counts.at(-1), [g.needs.length, 1 + g.works.length], "this computer's one at work, and theirs");
    setMore({ ...g, needs: [] });
    assert.deepEqual(counts.at(-1), [0, 1 + g.works.length], "theirs moved alone: told");
    setMore(null);
    assert.deepEqual(counts.at(-1), [0, 1], "the bar on This computer's alone");
  });

  // (fails before: yes — Now listed This computer's rows alone)
  test("their rows among its own, newest first, each with its machine's chip; keyed by machine, no chat id of this computer's; greyed while away", async () => {
    const { now } = await deskNow();
    const rows = every(now.el, "now-row");
    // Laptop's at work since 2 s ago, this computer's since 3 s, Studio's since 5 s.
    assert.deepEqual(rows.map((r) => [r.attrs["data-key"], r.attrs["data-chain"] ?? null, r.attrs["data-machine"] ?? null]), [
      ["m:m-studio/chat:s1", null, "m-studio"],
      ["m:m-laptop/chat:l1", null, "m-laptop"],
      ["chat:c1", "c1", null],
      ["m:m-studio/chat:s2", null, "m-studio"],
      ["m:m-laptop/chat:l2", null, "m-laptop"],
    ]);
    const chips = every(now.el, "now-machine");
    assert.deepEqual(chips.map((c) => [c.attrs.class, textOf(c)]), [["now-machine c-teal", "Studio"], ["now-machine c-orange", "Laptop"], ["now-machine c-teal", "Studio"], ["now-machine c-orange", "Laptop"]]);
    assert.equal(every(chips[0], "now-machine-ic")[0].attrs.html, ICONS.server);
    assert.deepEqual(rows.map((r) => String(r.attrs.class).includes("is-away")), [false, true, false, false, true], "Laptop does not answer: its rows as they last stood, greyed");
    assert.match(String(rows[1].attrs.title), /Laptop is offline/);
    assert.deepEqual(every(now.el, "now-count").map((c) => textOf(c)), ["1"], "what needs you there counts in Now's head");
  });

  test("a press opens it on its machine — never a chat here —; Done's Clear marks theirs seen there; none told, none drawn", async () => {
    const { now, opened, openedThere, seenThere, setMore } = await deskNow();
    const rows = every(now.el, "now-row");
    rows[0].dispatch("click");
    rows[3].dispatch("keydown", { key: "Enter" });
    rows[2].dispatch("click");
    assert.deepEqual(openedThere, [["m-studio", "s1"], ["m-studio", "s2"]]);
    assert.deepEqual(opened, ["c1"], "its own row opens its own chat");
    every(now.el, "now-clear")[0].dispatch("click");
    assert.deepEqual(seenThere, [["m:m-laptop/chat:l2"]]);
    setMore(null);
    assert.deepEqual(every(now.el, "now-row").map((r) => r.attrs["data-key"]), ["chat:c1"], "the bar on This computer's alone: its own rows");
  });
});

describe("the bar's own Now and the other machines' Done (now-list.js, place)", () => {
  /** The bar's own Now, nothing at work here, five of Studio's finished unread. */
  async function barNow() {
    const t = Date.now();
    const raw = told();
    raw.machines = [raw.machines[0]];
    raw.machines[0].rows = { needs: [], works: [], done: [1, 2, 3, 4, 5].map((i) => nowRow({ chain: `d${i}`, group: "done", fact: "finished", tile: "done", at: t - i * 1000 })) };
    const d = readDesk(raw);
    const now = createNow({
      h: mk, drawIn: fakeDrawIn, call: /** @type {any} */ (async () => ({ events: [] })), chats: () => null, unread: () => new Set(), holders: () => new Map(),
      onOpen: () => {}, onSeen: () => {}, place: true, held: () => 0, more: () => deskGroups(d),
    });
    await now.update([]);
    return now;
  }

  // (fails before: yes — the review of s1b: Earlier drew nothing where this computer's Done moved not)
  test("their Done past its newest three under Earlier, which shows them at once; Now says which of theirs it shows", async () => {
    const now = await barNow();
    const done = () => every(now.el, "now-row").map((r) => r.attrs["data-key"]);
    assert.deepEqual(done(), ["m:m-studio/chat:d1", "m:m-studio/chat:d2", "m:m-studio/chat:d3"]);
    assert.deepEqual([...now.theirsShown()], done(), "the rest stand in their projects");
    const earlier = every(now.el, "now-earlier");
    assert.deepEqual(earlier.map((b) => textOf(b)), ["Earlier (2)"]);
    earlier[0].dispatch("click");
    assert.equal(done().length, 5, "drawn at once");
    assert.equal(now.theirsShown().size, 5);
  });

  // (fails before: yes — the review of s1b: folded, theirs stood nowhere)
  test("folded, Now shows none of theirs: each stands in its project", async () => {
    const now = await barNow();
    const head = every(now.el, "now-head")[0] || now.el.kids?.[0];
    head.dispatch("click");
    assert.equal(every(now.el, "now-row").length, 0);
    assert.equal(now.theirsShown().size, 0);
  });
});

describe("the left bar's desk (sidebar.js, pinned in the source)", () => {
  const bar = readFileSync(new URL("../src/ui/harness/sidebar.js", import.meta.url), "utf8");
  const preload = readFileSync(new URL("../desktop/harness-preload.cjs", import.meta.url), "utf8");

  // (fails before: yes — the bar heard no desk)
  test("it hears the desk from the app alone, lists theirs while All machines is on, and leaves out a machine unticked", () => {
    assert.match(bar, /if \(typeof bridge\?\.onDesk === "function"\) \{\n\s+inbox = createDeskInbox\(\{\n\s+bridge,\n\s+onChange: \(\) => now\.refresh\(\),[\s\S]{0,400}?\}\);\n\s+bridge\.onDesk\(\(\/\*\* @type \{unknown\} \*\/ d\) => \{\n\s+desk = readDesk\(d\);\n\s+syncInbox\(\);\n\s+now\.refresh\(\);/);
    // Its inbox told which of their chats need you as the desk moves, and as Machines moves (desk-inbox.js).
    assert.match(bar, /const syncInbox = \(\) => inbox\?\.sync\(deskNow\(\)\?\.needs \|\| \[\], /);
    assert.equal(bar.match(/syncInbox\(\);\n\s+now\.refresh\(\);/g)?.length, 3, "at the desk's word, All machines or one machine's, and a machine ticked in or out");
    // The list drawn again where what it shows of theirs moved alone, Now at every word (the review of s1b).
    assert.match(bar, /if \(deskDrawn !== deskListNow\(\)\) draw\(\);\n\s+\}\);/);
    assert.match(bar, /const deskListNow = \(\) => \(deskListed\(\) \? deskListKey\(desk, now\.theirsShown\(\), deskMarks\(deskNow\(\)\)\) : ""\);/);
    assert.match(bar, /const deskListed = \(\) => deskOn\(\) && organizeBy !== "grouped" && !showArchived;/, "by time and in the Archived view, Now's alone");
    // A laptop that drives a workstation and has no project of its own lists the workstation's.
    assert.match(bar, /\[\.\.\.state\.chats\.values\(\)\]\.some\(\(c\) => c\.cwd\)\) \|\| deskOn\(\);/);
    assert.match(bar, /\[\.\.\.state\.chats\.values\(\)\]\.some\(\(c\) => c\.cwd\) \|\| deskListed\(\);/);
    // Ctrl+Shift+[ and ]: every chat the bar lists, another machine's shown in place — not one of a machine that does not answer.
    assert.ok(bar.includes('const inList = [...list.querySelectorAll(".sess-row:not(.desk-row.is-away)")];'));
    assert.match(bar, /const deskOn = \(\) => !!desk\?\.machines\.length && allMachines;/);
    assert.match(bar, /const g = deskGroups\(desk, hiddenMachines\);/);
    assert.match(bar, /allMachines = localStorage\.getItem\(MACHINES_KEY\) !== "here";/, "every machine's by default");
    assert.match(bar, /\{ type: "radio", label: "All machines", checked: allMachines, onClick: scope\(true\) \},/);
    assert.match(bar, /type: "check", label: m\.name, inset: true, checked: !hiddenMachines\.has\(m\.id\),/);
    assert.match(bar, /\.\.\.\(deskOn\(\) \? \[\{ type: "radio", label: "Machine", checked: organizeBy === "machine",/, "Group by Machine where there is another");
  });

  test("a row of theirs opens at its chat's address — in place beside the bar where the page can (desk-in-place.test.js), else on its machine through the app (`openOn`); Clear marks them seen there", () => {
    assert.match(bar, /openOnMachine\(r\.machine, deskRoute\(r\.there\)\);/);
    assert.match(bar, /if \(cb\.openThere\) return cb\.openThere\(\{ id: m\.id, name: m\.name, flags \}, route\);\n\s+void \(\/\*\* @type \{any\} \*\/ \(globalThis\)\.filamentApp\?\.openOn\?\.\(m\.id, route\)\)\?\.catch\?\.\(\(\) => \{\}\);/);
    assert.match(bar, /for \(const \[id, chains\] of by\) void bridge\?\.seen\?\.\(id, chains\)\?\.catch\?\.\(\(\) => \{\}\);/);
    assert.match(preload, /seen: \(id, chains\) => ipcRenderer\.invoke\("filament:desk-seen", \{ id: String\(id\), chains: Array\.isArray\(chains\) \? chains\.slice\(0, 50\)\.map\(String\) : \[\] \}\),/);
  });

  test("under the projects: one chat, one place — theirs Now shows stand nowhere else —; a project here takes its repository's chats from every machine", () => {
    assert.match(bar, /return deskProjects\(desk, only \? new Map\(\) : ownKeysOf\(state\.projects \|\| \[\]\), hidden, \{ merge: !only, inNow: now\.theirsShown\(\) \}\);/);
    assert.match(bar, /"\/memory\/projects\?remotes=1" : "\/memory\/projects"/, "the projects asked with their remotes in the app");
    // Their rows: no menu, no pin, no Delete — nothing of this computer's acts on them.
    const row = bar.slice(bar.indexOf("function deskChatRow(c)"), bar.indexOf("function deskChatRow(c)") + 1800);
    assert.doesNotMatch(row, /chatMenu|deleteChat|markSeen|pinned/);
    assert.match(row, /h\("span", \{ class: "sess-title" \}, c\.title\)/, "its words as text");
  });

  // (fails before: yes — the review of s2d: a folded project hid its rows' Bring back pills, and nothing on its head said
  // that changes waited)
  test("a folded project's head says how many of its chats on other machines have changes waiting; open, its rows say it", () => {
    const fn = bar.slice(bar.indexOf("function backCount(chats)"), bar.indexOf("function deskGroupEl(dg)"));
    assert.match(fn, /chats\.filter\(\(c\) => work\.waiting\(c\.machine\.id, c\.there\.chain\)\)\.length/);
    assert.match(fn, /`↩ \$\{n\}`/);
    const group = bar.slice(bar.indexOf("function deskGroupEl(dg)"), bar.indexOf("function deskChatRow(c)"));
    assert.ok(group.includes("backCount(dg.chats),"), "a project of the other machines' alone");
    assert.match(bar, /mark,\n\s+backCount\(theirs\),\n\s+own \? null : h\("span", \{ class: "proj-count"/, "a project here, for its repository's chats there");
    assert.ok(readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8").includes(".sess-group[open] > summary .desk-back-count { display: none; }"), "open, its rows' pills say it");
  });
});

// @ts-check
// Where a sub-agent runs, shown on both machines (the remote-agents plan's s-ui). On the machine that launched it, a
// sub-agent on another machine says "on Workstation" in its dispatch and arrival rows — a dot in its run's state beside
// it, the dispatch's following the page's store —, in its row of the Sub Agents tab and in its thread's head; one of
// this machine's reads as it did. On the machine it runs on, the chat another machine's agents' device started is
// marked in the sidebar "From MacBook's agents" — the full device that minted the agents' device, else that device's
// own name, else another machine's — and its header says the same: the sessions list carries `fromAgents` for such a
// chat alone, by name, never the device's id.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stubDocument } from "./helpers/dom-stub.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { agentRow, sideIO, sideSeams } from "./helpers/side-view.js";
import { until } from "./helpers/wait.js";
import { fakeUpstream, startApp } from "./helpers/app.js";

const g = /** @type {any} */ (globalThis);
// The page's api binds the fetch it finds when first loaded: the stand-in server answers the page's addresses, by
// `serve` (null leaves one unanswered), before any of the page's modules load; a whole address is the real server's.
/** @type {(url: string) => any} */
let serve = () => null;
const realFetch = g.fetch;
g.fetch = (/** @type {any} */ url, /** @type {any} */ init) => (/^https?:\/\//.test(String(url)) ? realFetch(url, init) : Promise.resolve(serve(String(url))).then((r) => r ?? new Promise(() => {})));
after(() => void (g.fetch = realFetch));
const { subagentMarkRow } = await import("../src/ui/harness/conversation/subagent-marks.js");
const { chipActions } = await import("../src/ui/harness/conversation/tools/layout.js");
const { sideRow } = await import("../src/ui/harness/lib/side.js");
const { fromAgentsWords } = await import("../src/ui/harness/lib/labels.js");
const { createSideView } = await import("../src/ui/harness/views/side.js");
const ON = { id: "m1", name: "Workstation" };
const THERE = { cwd: "/w/app", chat: "c_there", run: "run_there" };

/** Every node under a fake node that `pick` picks. @param {any} n @param {(x: any) => boolean} pick @param {any[]} [out] @returns {any[]} */
const every = (n, pick, out = []) => {
  if (n && typeof n === "object") {
    if (pick(n)) out.push(n);
    for (const k of n.kids || []) every(k, pick, out);
  }
  return out;
};
/** @param {any} n @param {string} cls */
const byClass = (n, cls) => every(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls));

describe("the machine that launched it", () => {
  // (fails before: yes — a mark said nothing of where its sub-agent ran: "You sent Builder “Run the suite” off · m-1")
  test("a remote sub-agent's dispatch and arrival rows say on its machine, its run's dot beside it; a local one's read as before", () => {
    const doc = stubDocument();
    /** @type {Map<string, any>} */
    const rows = new Map([
      ["sa_r", { id: "sa_r", status: "running", machine: ON, remote: THERE, exchanges: [{ status: "running" }] }],
      ["sa_l", { id: "sa_l", status: "running", exchanges: [{ status: "running" }] }],
    ]);
    /** @type {(() => void)[]} */
    const heard = [];
    Object.assign(chipActions, {
      subagentRow: (/** @type {string} */ id) => rows.get(id) ?? null,
      watchSubagents: (/** @type {() => void} */ fn) => (heard.push(fn), () => void heard.splice(heard.indexOf(fn), 1)),
    });
    try {
      const sent = (/** @type {string} */ id) => /** @type {any} */ (subagentMarkRow(/** @type {any} */ ({ event: "dispatch", agentId: id, exchange: 0, description: "Run the suite", model: "m-1", card: { tag: "builder", name: "Builder" } })));
      const back = (/** @type {string} */ id, /** @type {string} */ status) => /** @type {any} */ (subagentMarkRow(/** @type {any} */ ({ event: "arrival", agentId: id, exchange: 0, description: "Run the suite", status, ms: 4000, rounds: 2, card: { tag: "builder", name: "Builder" } }), { between: true }));
      const remote = sent("sa_r");
      doc.document.body.append(remote);
      assert.equal(remote.querySelector(".sub-mark-text").textContent, "You sent Builder “Run the suite” off · on Workstation · m-1");
      assert.equal(remote.querySelector(".sub-mark-at").className, "sub-mark-at tone-running", "its dot as its run stands: running");
      assert.ok(remote.querySelector(".sub-mark-at .sav-dot"), "the status dot's own style");
      // Its run there ends: the dot follows the store while the row stands.
      rows.set("sa_r", { ...rows.get("sa_r"), status: "done", exchanges: [{ status: "done" }] });
      for (const fn of [...heard]) fn();
      assert.equal(remote.querySelector(".sub-mark-at").className, "sub-mark-at tone-ok");
      const arrived = back("sa_r", "failed");
      assert.equal(arrived.querySelector(".sub-mark-text").textContent, "Builder “Run the suite” failed · on Workstation · 4s · 2 rounds — its report goes with the main agent's next turn");
      assert.equal(arrived.querySelector(".sub-mark-at").className, "sub-mark-at tone-error");
      // The mark's own machine stands where the store holds the sub-agent no more.
      const kept = /** @type {any} */ (subagentMarkRow(/** @type {any} */ ({ event: "dispatch", agentId: "sa_gone", exchange: 0, description: "Run the suite", card: { tag: "builder", name: "Builder" }, machine: ON })));
      assert.equal(kept.querySelector(".sub-mark-text").textContent, "You sent Builder “Run the suite” off · on Workstation");
      assert.equal(kept.querySelector(".sub-mark-at").className, "sub-mark-at", "no state known: the dot stays grey");
      // One of this machine's: as before, and nothing followed.
      const local = sent("sa_l");
      const heardBefore = heard.length;
      assert.equal(local.querySelector(".sub-mark-text").textContent, "You sent Builder “Run the suite” off · m-1");
      assert.equal(local.querySelector(".sub-mark-at"), null);
      assert.equal(heard.length, heardBefore, "a local dispatch follows no store");
      assert.equal(back("sa_l", "done").querySelector(".sub-mark-text").textContent, "Builder “Run the suite” reported · 4s · 2 rounds — its report goes with the main agent's next turn");
    } finally {
      Object.assign(chipActions, { subagentRow: null, watchSubagents: null });
      doc.restore();
    }
  });

  // (fails before: yes — the tab's row had no `where`: nothing said the agent worked on another machine)
  test("its row in the Sub Agents tab says on its machine beside its state's dot; a local row has none", () => {
    const remote = agentRow("sa_r", { asked: false, origin: "agent", status: "running", machine: ON, remote: THERE, provider: null, exchanges: [{ description: "Run the suite", startedAt: 1, endedAt: null }] });
    const local = agentRow("sa_l");
    assert.equal(sideRow(remote, 2).where, "on Workstation");
    assert.equal("where" in sideRow(local, 2), false, "a local row as it was");
    const io = sideIO({ rows: () => [remote, local] });
    const s = sideSeams();
    const view = createSideView(/** @type {any} */ (io), { h: fakeH, place: (/** @type {any} */ p, /** @type {any[]} */ k) => p.replaceChildren(...k), ...s.seams });
    view.paint(/** @type {any} */ ({ id: "chat-1", chainId: "c1", turns: [] }));
    const rowOf = (/** @type {string} */ id) => every(view.el, (x) => x.attrs?.["data-id"] === id && String(x.attrs?.class || "").includes("sd-row"))[0];
    const meta = byClass(rowOf("sa_r"), "sd-row-meta")[0];
    assert.deepEqual(byClass(meta, "sd-row-where").map(textOf), ["on Workstation"]);
    assert.equal(byClass(meta, "sd-dot").length, 1, "beside the dot its state already wears");
    assert.deepEqual(byClass(rowOf("sa_l"), "sd-row-where"), [], "a local row says no machine");
  });

  // (fails before: yes — its head named its model alone, the provider null: nothing said where it ran)
  test("its thread's head says on its machine; a local one's does not", async () => {
    const doc = stubDocument();
    const had = { requestAnimationFrame: g.requestAnimationFrame, MutationObserver: g.MutationObserver, EventSource: g.EventSource, addEventListener: g.addEventListener };
    /** @type {Record<string, any>} */
    const rows = {
      sa_r: agentRow("sa_r", { asked: false, origin: "agent", model: "m-1", status: "running", machine: ON, remote: THERE, provider: null }),
      sa_l: agentRow("sa_l", { asked: false, origin: "agent", model: "m-1", provider: "Anthropic" }),
    };
    serve = (url) => {
      const id = /\/subagents\/(sa_[a-z])(?:$|\?)/.exec(url)?.[1];
      return id ? new Response(JSON.stringify({ subagent: rows[id] }), { status: 200, headers: { "content-type": "application/json" } }) : null;
    };
    g.requestAnimationFrame = (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0);
    g.MutationObserver = class { observe() {} disconnect() {} };
    g.EventSource = class { close() {} };
    g.addEventListener = () => {};
    /** @type {{ close: () => void }[]} */
    const open = [];
    try {
      const { subagentConversation } = await import("../src/ui/harness/subagent-viewer.js");
      const { h } = await import("../src/ui/lib/dom.js");
      const MAIN = { state: () => /** @type {const} */ ("idle"), outside: () => null, start: () => {}, write: () => {} };
      const head = (/** @type {string} */ id) => {
        const conv = subagentConversation({ chainId: "c1", id, toast: () => {}, main: MAIN });
        open.push(conv);
        const scroll = h("div", { class: "scroll" }, conv.body);
        doc.document.body.append(h("div", {}, conv.head, scroll, conv.foot));
        conv.mount(scroll);
        return /** @type {any} */ (conv.head);
      };
      const facts = (/** @type {any} */ el) => el.querySelectorAll(".sav-meta span").map((/** @type {any} */ s) => s.textContent);
      const remote = head("sa_r");
      await until(() => facts(remote).includes("m-1"), "the remote one's head");
      assert.ok(facts(remote).includes("on Workstation"), `its facts: ${facts(remote).join(" · ")}`);
      assert.equal(facts(remote).indexOf("on Workstation"), facts(remote).indexOf("m-1") + 1, "where it runs, after its model");
      const local = head("sa_l");
      await until(() => facts(local).includes("m-1 on Anthropic"), "the local one's head");
      assert.equal(facts(local).some((/** @type {string} */ f) => /Workstation/.test(f)), false);
    } finally {
      for (const c of open) c.close();
      serve = () => null;
      for (const [k, v] of Object.entries(had)) {
        if (v === undefined) delete g[k];
        else g[k] = v;
      }
      doc.restore();
    }
  });
});

describe("the machine it runs on", () => {
  // (fails before: yes — no words said whose agents a chat was)
  test("a chat's words for another machine's agents: by the caller's name, else another machine's; none for any other", () => {
    assert.equal(fromAgentsWords({ fromAgents: { name: "MacBook" } }), "From MacBook's agents");
    assert.equal(fromAgentsWords({ fromAgents: { name: "Atlas" } }), "From Atlas' agents");
    assert.equal(fromAgentsWords({ fromAgents: { name: null } }), "From another machine's agents");
    assert.deepEqual([fromAgentsWords({}), fromAgentsWords(null), fromAgentsWords({ fromAgents: null })], ["", "", ""]);
  });

  // (fails before: yes — a chat another machine's agents started stood in the sidebar as one of the person's own)
  test("a sidebar row of a chat another machine's agents started says whose; the person's own says nothing", async () => {
    const doc = stubDocument();
    const had = { EventSource: g.EventSource, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener, localStorage: g.localStorage };
    const d = /** @type {any} */ (document);
    d.addEventListener = () => {};
    d.removeEventListener = () => {};
    g.EventSource = class { addEventListener() {} close() {} };
    g.addEventListener = () => {};
    g.removeEventListener = () => {};
    g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    const when = Date.now();
    const sessions = [
      { id: "c_theirs", title: "Run the suite", when, project: "p1", cwd: "/x", fromAgents: { name: "MacBook" } },
      { id: "c_unnamed", title: "Lint the docs", when, project: "p1", cwd: "/x", fromAgents: { name: null } },
      { id: "c_mine", title: "My own chat", when, project: "p1", cwd: "/x" },
    ];
    serve = () => ({ ok: true, status: 200, json: async () => ({ sessions, projects: [{ id: "p1", name: "/x" }], runs: [] }) });
    try {
      const { createSidebar } = await import("../src/ui/harness/sidebar.js");
      const host = /** @type {any} */ (document.createElement("div"));
      const sb = createSidebar(host, { onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {} });
      await sb.load();
      const row = (/** @type {string} */ id) => host.querySelector(`.sess-row[data-chain="${id}"]`);
      assert.ok(row("c_theirs") && row("c_mine"), "the rows are drawn");
      assert.equal(row("c_theirs").querySelector(".row-from")?.textContent, "From MacBook's agents");
      // On a line of its own under the name: beside it, the words cut a narrow bar's title to its first letters.
      assert.equal(row("c_theirs").querySelector(".row-title-line").textContent, "Run the suite", "its name keeps its line");
      assert.ok(row("c_theirs").className.split(/\s+/).includes("from"), "the row is laid out for the second line");
      assert.equal(row("c_unnamed").querySelector(".row-from")?.textContent, "From another machine's agents");
      assert.equal(row("c_mine").querySelector(".row-from"), null);
      assert.doesNotMatch(row("c_mine").textContent, /agents/);
    } finally {
      serve = () => null;
      for (const [k, v] of Object.entries(had)) {
        if (v === undefined) delete g[k];
        else g[k] = v;
      }
      doc.restore();
    }
  });

  // (fails before: yes — a chat at work stands under Now alone, and Now's row said nothing of whose agents started it:
  // while their turn ran, it read as one of the person's own; the s-ui hunt's)
  test("Now's row of a chat another machine's agents started says whose while it works there, in its hover too; the person's own says nothing", async () => {
    const doc = stubDocument();
    const had = { EventSource: g.EventSource, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener, localStorage: g.localStorage };
    const d = /** @type {any} */ (document);
    d.addEventListener = () => {};
    d.removeEventListener = () => {};
    g.EventSource = class { addEventListener() {} close() {} };
    g.addEventListener = () => {};
    g.removeEventListener = () => {};
    g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    const when = Date.now();
    const sessions = [
      { id: "c_theirs", title: "Run the suite", when, project: "p1", cwd: "/x", fromAgents: { name: "MacBook" } },
      { id: "c_mine", title: "My own chat", when, project: "p1", cwd: "/x" },
    ];
    const run = (/** @type {string} */ id, /** @type {string} */ chain) => ({ id, kind: "agent-turn", status: "running", startedAt: when - 60_000, endedAt: null, parentId: null, events: 1, meta: { chain, model: "opus" } });
    const runs = [run("r1", "c_theirs"), run("r2", "c_mine")];
    serve = () => ({ ok: true, status: 200, json: async () => ({ sessions, projects: [{ id: "p1", name: "/x" }], runs, events: [] }) });
    try {
      const { createSidebar } = await import("../src/ui/harness/sidebar.js");
      const host = /** @type {any} */ (document.createElement("div"));
      const sb = createSidebar(host, { onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {} });
      await sb.load();
      await sb.loadRuns();
      const nowRow = (/** @type {string} */ id) => host.querySelector(`.now-row[data-chain="${id}"]`);
      await until(() => nowRow("c_theirs") && nowRow("c_mine"), "both chats at work, under Now");
      assert.equal(host.querySelector('.sess-row[data-chain="c_theirs"]'), null, "at work, it stands under Now alone");
      assert.equal(nowRow("c_theirs").querySelector(".now-from")?.textContent, "From MacBook's agents");
      assert.match(nowRow("c_theirs").getAttribute("title"), /From MacBook's agents/);
      assert.equal(nowRow("c_mine").querySelector(".now-from"), null);
      assert.doesNotMatch(nowRow("c_mine").textContent, /agents/);
    } finally {
      serve = () => null;
      for (const [k, v] of Object.entries(had)) {
        if (v === undefined) delete g[k];
        else g[k] = v;
      }
      doc.restore();
    }
  });

  // (fails before: yes — the header named the chat alone, and app.js had no paintFromAgents; then its words pushed the
  // chat's name out of a narrow bar's crumb, so the crumb holds the mark and the words are its title)
  test("the chat's header marks whose agents once open, from the sessions list's row; another chat's header says nothing", async () => {
    const header = readFileSync(new URL("../src/ui/harness/header.js", import.meta.url), "utf8");
    assert.match(header, /const crumb = h\("div", \{ class: "c-crumb" \}, chip, h\("span", \{ class: "c-sep", "aria-hidden": "true" \}, "›"\), titleBtn, fromEl\);/, "after the chat's name");
    const { lift } = await import("./helpers/app-lift.js");
    const doc = stubDocument();
    try {
      const fromEl = /** @type {any} */ (document.createElement("span"));
      fromEl.className = "c-from hidden";
      const titleEl = /** @type {any} */ (document.createElement("span"));
      const state = { sessions: [{ id: "c_theirs", fromAgents: { name: "MacBook" } }, { id: "c_mine" }] };
      const { setTitle } = lift(["setTitle", "paintFromAgents?"], { titleEl, headerModule: { fromEl }, state, fromAgentsWords, chatTitle: (/** @type {any} */ c) => c.title, WORDS: { newChat: "New chat" } });
      setTitle({ chainId: "c_theirs", title: "Run the suite", turns: [{}] });
      assert.deepEqual([titleEl.textContent, fromEl.title, fromEl.getAttribute("aria-label"), fromEl.classList.contains("hidden")], ["Run the suite", "From MacBook's agents", "From MacBook's agents", false]);
      setTitle({ chainId: "c_mine", title: "My own chat", turns: [{}] });
      assert.deepEqual([fromEl.title, fromEl.classList.contains("hidden")], ["", true], "another chat: hidden again");
    } finally {
      doc.restore();
    }
  });

  describe("the sessions list", () => {
    const root = mkdtempSync(join(tmpdir(), "filament-from-agents-"));
    /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
    let up;
    /** @type {Awaited<ReturnType<typeof startApp>>} */
    let shim;
    /** The devices this machine keeps: MacBook's full device and the agents' device it minted; an agents' device whose full device is gone. */
    const DEVICES = [
      { id: "dev-full", name: "MacBook", scope: "full", kind: "desktop", hash: "a".repeat(64), grants: {}, createdAt: 1 },
      { id: "dev-agents", name: "Filament agents on MacBook", scope: "agent", kind: "agents", hash: "b".repeat(64), grants: { agents: true }, createdAt: 2, of: "dev-full" },
      { id: "dev-orphan", name: "Filament agents on Atlas", scope: "agent", kind: "agents", hash: "c".repeat(64), grants: {}, createdAt: 3, of: "dev-gone" },
    ];
    before(async () => {
      up = await fakeUpstream(() => undefined);
      shim = await startApp({
        memory: true,
        configure: (cfg, { dataDir }) => {
          cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
          cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
          cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
          writeFileSync(join(dataDir, "devices.json"), JSON.stringify({ version: 1, devices: DEVICES }));
        },
      });
    });
    after(async () => {
      await shim.stop();
      await up.close();
      rmSync(root, { recursive: true, force: true });
    });

    // (fails before: yes — the list's rows carried nothing of `meta.agentDevice`)
    test("carries whose agents started a chat, by name alone, and nothing for the person's own", async () => {
      /**
       * A chat made here, `agentDevice` kept on it as POST /sessions keeps it for an agents' device — and `agentFrom`, the
       * name of the machine whose agents they are, where it kept one. @param {string} title @param {string | null} device @param {string} [from]
       */
      const chat = async (title, device, from) => {
        const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", title } });
        assert.equal(r.status, 200, await r.clone().text());
        const { id } = await r.json();
        if (device) shim.app.memory.archive?.mergeMeta(id, { agentDevice: device, ...(from ? { agentFrom: from } : {}) });
        return String(id);
      };
      const theirs = await chat("Run the suite", "dev-agents");
      const orphan = await chat("Lint the docs", "dev-orphan");
      const forgotten = await chat("Old one", "dev-forgotten");
      const kept = await chat("Before a mint again", "dev-forgotten", "Studio");
      const mine = await chat("My own chat", null);
      const res = await shim.api("/api/memory/sessions?limit=200&kind=interactive,fork");
      const text = await res.text();
      const list = JSON.parse(text).sessions;
      const of = (/** @type {string} */ id) => list.find((/** @type {any} */ s) => s.id === id);
      assert.deepEqual(of(theirs)?.fromAgents, { name: "MacBook" }, "the machine's name: the full device that minted it");
      // (fails before: yes — an agents' device whose full device was gone named the chat by its own name, "From Filament
      // agents on Atlas' agents", and a device minted again lost the name of the chats before it)
      assert.deepEqual(of(orphan)?.fromAgents, { name: null }, "its full device gone: another machine's, never the agents' device's own name");
      assert.deepEqual(of(forgotten)?.fromAgents, { name: null }, "no device kept: still marked, with no name");
      assert.deepEqual(of(kept)?.fromAgents, { name: "Studio" }, "the name kept on the chat as it started, its device gone since");
      assert.ok(of(mine), "the person's own chat is listed");
      assert.equal("fromAgents" in of(mine), false, "and carries no such field");
      assert.doesNotMatch(text, /dev-agents|dev-orphan|dev-full|"agentDevice"/, "never the device's id");
      // A list that goes to a model or another chat (memory's own tools) names nobody's agents.
      const told = /** @type {any[]} */ (shim.app.memory.sessions("", { limit: 50, others: true }));
      assert.equal(told.some((s) => "fromAgents" in s), false);
    });
  });
});

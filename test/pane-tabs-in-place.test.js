// @ts-check
// The tile host's heads and a file's tab drawn in place (panes/pane-host.js, panes/code-viewer.js) on the stub
// document: a count landing, a mark, the heads drawn again, the run's pulse and a turn's end leave a tile's tab buttons
// and a file's viewer standing — each was made anew, new elements under a resting pointer (the owner's of 11-01:
// buttons blinking under a resting pointer, clicks lost) —, and a file read again is drawn where it changed.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** What the page asked for, in order, as `GET /api/…`. @type {string[]} */
const asked = [];
/** What the stand-in server answers by the whole address: a body, or undefined for a 404. @type {(url: string) => any} */
let serve = () => undefined;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
  asked.push(`${String(init.method || "GET")} ${url}`);
  const body = await serve(String(url));
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { createPaneHost } = await import("../src/ui/harness/panes/pane-host.js");

after(() => {
  g.fetch = realFetch;
});

/** A few turns of the event loop: what a press or a pulse set off has landed. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Two tool panes in a tile host on the stub document; each keeps the count setter it was handed. */
function hosted() {
  const { document, restore } = stubDocument();
  const saved = { local: g.localStorage, session: g.sessionStorage };
  /** @param {Map<string, string>} kept */
  const storage = (kept) => ({ getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)), removeItem: (/** @type {string} */ k) => void kept.delete(k) });
  g.localStorage = storage(new Map());
  g.sessionStorage = storage(new Map());
  const frame = /** @type {any} */ (document.createElement("aside"));
  document.body.append(frame);
  /** id → its pane's count setter. @type {Map<string, (n: number) => void>} */
  const badgers = new Map();
  /** @param {string} id @param {string} label */
  const pane = (id, label) => ({
    id,
    label,
    icon: "squareTerminal",
    render: (/** @type {any} */ body, /** @type {any} */ ctx) => {
      badgers.set(id, ctx.setBadge);
      const el = document.createElement("div");
      el.className = `the-${id}`;
      body.append(el);
    },
    refresh: () => {},
  });
  const host = createPaneHost(frame, {
    panes: [pane("terminal", "Terminal"), pane("files", "Files")],
    room: () => ({ row: 1600, win: 1920, height: 900 }),
    paint: () => {},
  });
  return {
    frame,
    host,
    badgers,
    done: () => {
      g.localStorage = saved.local;
      g.sessionStorage = saved.session;
      restore();
    },
  };
}

/**
 * The run's pulse as the host answers it: coalesced, then each tile refreshed in place, or drawn again where it cannot
 * be. @param {any} t @param {any} host
 */
const pulse = (t, host) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    host.pulse();
    t.mock.timers.tick(1200);
  } finally {
    t.mock.timers.reset();
  }
};

// (fails before: yes — each count landing, mark and head drawn again made the strip and its tabs anew)
test("a tile's tabs stand while a count lands, a mark is set and the heads are drawn again; the count shows; a tab's press and its × act", () => {
  const p = hosted();
  try {
    p.host.setChat({ id: "p1", chainId: "c1", cwd: "/p1" });
    p.host.setArrange("tabs");
    p.host.openTab("terminal");
    p.host.openTab("files");
    const strip = p.frame.querySelector(".tile-tabs");
    assert.ok(strip, "two panes as tabs of one tile");
    const tabs = p.frame.querySelectorAll(".tile-tab");
    assert.deepEqual(tabs.map((/** @type {any} */ b) => b.querySelector(".tile-tab-label").textContent), ["Terminal", "Files"]);
    assert.ok(tabs[1].classList.contains("on"), "the one opened last in front");
    const same = (/** @type {string} */ when) => {
      assert.equal(p.frame.querySelector(".tile-tabs"), strip, `the strip stands ${when}`);
      assert.deepEqual(p.frame.querySelectorAll(".tile-tab"), tabs, `the tabs stand ${when}`);
    };
    // A pane's data lands: its count on its tab, the tabs as they were.
    const count = /** @type {(n: number) => void} */ (p.badgers.get("files"));
    count(3);
    same("as a count lands");
    assert.equal(tabs[1].querySelector(".tile-count")?.textContent, "3");
    // The same count again, as each pulse's data brings it: nothing drawn.
    count(3);
    same("as the same count lands again");
    count(4);
    same("as the count moves");
    assert.equal(tabs[1].querySelector(".tile-count")?.textContent, "4");
    assert.equal(tabs[0].querySelector(".tile-count"), null, "the other tab counts nothing");
    // Something in the pane waits for you: its dot, the tabs as they were.
    p.host.mark("files", "waits for you");
    same("as a mark is set");
    assert.equal(tabs[1].querySelector(".tile-mark")?.getAttribute("title"), "waits for you");
    p.host.paintHeads();
    same("as the heads are drawn again");
    p.host.mark("files", null);
    same("as the mark goes");
    assert.equal(tabs[1].querySelector(".tile-mark"), null);
    // The tabs act: a press shows its pane, the × closes it.
    tabs[0].dispatch("click");
    assert.ok(p.frame.querySelector(".tile-tab.on")?.querySelector(".tile-tab-label").textContent === "Terminal", "the pressed tab in front");
    assert.equal(p.host.whereIs("files"), "behind");
    p.frame.querySelector(".tile-tab.on .tile-tab-x").dispatch("click");
    assert.equal(p.host.whereIs("terminal"), "none", "closed by its ×");
    assert.equal(p.frame.querySelector(".tile-tabs"), null, "one tab left: its name, no strip");
    assert.equal(p.frame.querySelector(".tile-name")?.textContent, "Files");
    assert.equal(p.frame.querySelector(".tile-lead .tile-count")?.textContent, "4", "its count beside its name");
  } finally {
    p.done();
  }
});

// (fails before: yes — the pulse and a turn's end drew the viewer anew, its bar's buttons new elements, the file read
// from "Loading file..." each time)
test("a file's tab stands across the pulse and a turn's end; its file read again is drawn where it changed", async (t) => {
  let content = "a\nb\n";
  const at = `/api/files/read?cwd=${encodeURIComponent("/p2")}&path=${encodeURIComponent("notes.txt")}`;
  serve = (u) => (u === at ? { kind: "text", content } : undefined);
  const p = hosted();
  try {
    p.host.setChat({ id: "p2", chainId: "c2", cwd: "/p2" });
    p.host.openFileTab({ cwd: "/p2", path: "notes.txt" });
    await until(() => p.frame.querySelector(".code-line"), "the file's lines");
    const root = p.frame.querySelector(".code-file-tab");
    const buttons = p.frame.querySelectorAll(".code-crumb button");
    assert.ok(buttons.length >= 3, "Wrap, Open and More");
    const pre = p.frame.querySelector(".code-pre");
    assert.equal(p.frame.querySelectorAll(".code-line").length, 2);
    const same = (/** @type {string} */ when) => {
      assert.equal(p.frame.querySelector(".code-file-tab"), root, `the viewer stands ${when}`);
      assert.deepEqual(p.frame.querySelectorAll(".code-crumb button"), buttons, `its bar's buttons stand ${when}`);
    };
    // The run's pulse: the file read again, as it was, and nothing drawn.
    pulse(t, p.host);
    await flush();
    same("across the pulse");
    assert.equal(p.frame.querySelector(".code-pre"), pre, "the lines as they were");
    assert.equal(p.frame.querySelectorAll(".code-line").length, 2);
    // A turn's end draws the panes again: the viewer stands, its file read again.
    const reads = asked.length;
    p.host.draw();
    await flush();
    same("across a turn's end");
    assert.equal(p.frame.querySelector(".code-pre"), pre);
    assert.ok(asked.length > reads, "the file read again");
    // The turn wrote the file: the next pulse draws its lines anew, the viewer and its bar standing.
    content = "a\nb\nc\n";
    pulse(t, p.host);
    await until(() => p.frame.querySelectorAll(".code-line").length === 3, "the new line");
    same("as the file changes");
    assert.equal(p.frame.querySelectorAll(".code-line")[2].textContent, "3c");
  } finally {
    p.done();
  }
});

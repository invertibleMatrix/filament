// @ts-check
// The Terminal pane (panes/terminal.js) on the stub document, in the tile host as the page's pane list has it
// (pane-host.js, app.js): a terminal started elsewhere comes in as a tab, the tab shown stays shown, and a stop that
// failed keeps its tab. The server's terminals and their streams are stand-ins: xterm, its fit addon and the WebSocket
// are the page's globals, set here before the pane loads (it builds its strip as it loads).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { pageEvents } from "./helpers/page-events.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** What the page asked for, in order, as `METHOD /api/…`. @type {string[]} */
const asked = [];
/** A refusal the stand-in server answers, in the server's words. */
class Refusal {
  /** @param {number} status @param {string} error */
  constructor(status, error) {
    this.status = status;
    this.error = error;
  }
}
/** What the stand-in server answers by the address and the method: a body, a `Refusal`, or undefined for a 404. @type {(url: string, method: string) => any} */
let serve = () => undefined;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
  const method = String(init.method || "GET");
  asked.push(`${method} ${url}`);
  const body = await serve(String(url), method);
  if (body instanceof Refusal) return new Response(JSON.stringify({ error: body.error }), { status: body.status });
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
/** The page's xterm and its fit addon, as harness.html loads them: a terminal that draws nothing. */
class FakeTerminal {
  loadAddon() {}
  /** @param {any} el */
  open(el) { this.el = el; }
  attachCustomKeyEventHandler() {}
  onData() {}
  onResize() {}
  write() {}
  focus() {}
  dispose() {}
  hasSelection() { return false; }
  getSelection() { return ""; }
}
const had = { window: g.window, WebSocket: g.WebSocket, getComputedStyle: g.getComputedStyle, ResizeObserver: g.ResizeObserver };
g.window = { innerWidth: 1440, innerHeight: 900, addEventListener() {}, removeEventListener() {}, Terminal: FakeTerminal, FitAddon: { FitAddon: class { fit() {} } } };
/** A terminal's stream, which never opens: what it printed is not this test's. */
g.WebSocket = class {
  /** @param {string} url */
  constructor(url) { this.url = url; this.readyState = 0; }
  send() {}
  close() {}
};
g.getComputedStyle = () => ({ getPropertyValue: () => "" });
g.ResizeObserver = class { observe() {} disconnect() {} };
pageEvents();
// The modules read `fetch` as they load; the host's before any document stands (the page's markdown listens on one as
// it loads), the pane's on the page's document, where it builds its strip.
const { createPaneHost } = await import("../src/ui/harness/panes/pane-host.js");
const loading = stubDocument();
const term = await import("../src/ui/harness/panes/terminal.js");
loading.restore();

/** The page's clock, run ahead by hand. */
const clock = { ahead: 0 };
const realNow = Date.now;
before(() => {
  Date.now = () => realNow() + clock.ahead;
});
after(() => {
  Date.now = realNow;
  g.fetch = realFetch;
  for (const [k, v] of Object.entries(had)) {
    if (v === undefined) delete g[k];
    else g[k] = v;
  }
});

/** A few turns of the event loop: what a press or a pulse set off has landed. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
/** The toasts the pane said, as `[words, kind]`. @type {[string, string | undefined][]} */
const toasts = [];

/** The Terminal pane in a tile host, with its draw and — where the module has one — its refresh, as the page lists it. */
function hosted() {
  const { document, restore } = stubDocument();
  const saved = { local: g.localStorage, session: g.sessionStorage };
  /** @param {Map<string, string>} kept */
  const storage = (kept) => ({ getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)), removeItem: (/** @type {string} */ k) => void kept.delete(k) });
  g.localStorage = storage(new Map());
  g.sessionStorage = storage(new Map());
  const frame = /** @type {any} */ (document.createElement("aside"));
  document.body.append(frame);
  const host = createPaneHost(frame, {
    panes: [{
      id: "terminal", label: "Terminal", icon: "squareTerminal",
      render: (body, ctx) => term.renderTerminal(body, { ...ctx, onToast: (/** @type {string} */ m, /** @type {string | undefined} */ k) => void toasts.push([m, k]), getFolder: () => "/work" }),
      refresh: term.refreshTerminal,
    }],
    room: () => ({ row: 1600, win: 1920, height: 900 }),
    paint: () => {},
  });
  host.setChat({ id: "p1", chainId: "c1", cwd: "/work" });
  host.openTab("terminal");
  return {
    frame,
    host,
    done: () => {
      g.localStorage = saved.local;
      g.sessionStorage = saved.session;
      restore();
    },
  };
}

/**
 * The run's pulse as the host answers it: coalesced, then each tile refreshed in place, or drawn again where its pane
 * has no refresh. @param {any} t @param {any} host
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

/** A terminal as the server lists it, named by its folder's last part or its title. @param {string} id @param {string} [title] */
const row = (id, title = "") => ({ id, cwd: `/work/${id}`, title, createdAt: 1, lastAt: 1, exited: false, exitCode: null });
/** @param {any} root */
const tabs = (root) => root.querySelectorAll(".term-tab").map((/** @type {any} */ t) => t.textContent);
/** @param {any} root */
const shown = (root) => root.querySelector(".term-tab.on")?.textContent ?? null;
/** A tab's ×. @param {any} root @param {string} name */
const stopOf = (root, name) => root.querySelectorAll(".term-tab").find((/** @type {any} */ t) => t.textContent === name)?.querySelector(".term-tab-x");
const lists = () => asked.filter((u) => u === "GET /api/terminal").length;

// (fails before: yes — the bug hunt of 10-30, UIP-4: the server's terminals were read only while the pane had no tab,
// so one another window or a program started once a tab stood never got one)
test("a terminal started elsewhere comes in as a tab — at the pane's next draw, and within LIST_MS of the run's pulse — the tab shown staying shown", async (t) => {
  let listed = [row("t1")];
  serve = (u, m) => (m === "GET" && u === "/api/terminal" ? { terminals: listed } : undefined);
  const p = hosted();
  try {
    await until(() => tabs(p.frame).includes("t1"), "the server's terminal, as a tab", { timeoutMs: 2000 });
    listed = [row("t1"), row("t2", "Sign in · Claude Code")];
    p.host.draw();
    await until(() => tabs(p.frame).includes("Sign in · Claude Code"), "the terminal a program started", { timeoutMs: 2000 });
    assert.equal(shown(p.frame), "t1", "the tab shown stays shown");
    // The run's pulse leaves the pane as it stands: within LIST_MS it reads nothing; past it, the list again.
    listed = [...listed, row("t3")];
    const before = lists();
    pulse(t, p.host);
    await flush();
    assert.equal(lists(), before, "within LIST_MS, nothing read");
    clock.ahead += term.LIST_MS;
    pulse(t, p.host);
    await until(() => tabs(p.frame).includes("t3"), "the next one, at a pulse past LIST_MS", { timeoutMs: 2000 });
    assert.equal(lists(), before + 1);
    assert.equal(shown(p.frame), "t1");
  } finally {
    p.done();
  }
});

// (fails before: yes — the bug hunt of 10-30, UIP-5: a stop that failed dropped the tab all the same, its process
// running on with nothing in the pane to show it or stop it)
test("a stop that failed keeps its tab and says why; a stop of a terminal the server no longer holds lets its tab go; a tab gone stays gone", async () => {
  let listed = [row("k1"), row("k2"), row("k3")];
  /** @type {Refusal | null} */
  let refusal = new Refusal(500, "the PTY did not answer");
  serve = (u, m) => {
    if (m === "GET" && u === "/api/terminal") return { terminals: listed };
    if (m === "POST" && u.endsWith("/kill")) return refusal || { ok: true };
    return undefined;
  };
  const p = hosted();
  try {
    await until(() => ["k1", "k2", "k3"].every((n) => tabs(p.frame).includes(n)), "the server's terminals, as tabs", { timeoutMs: 2000 });
    const said = toasts.length;
    stopOf(p.frame, "k2").dispatch("click");
    await until(() => toasts.length > said, "the failure said", { timeoutMs: 2000 });
    assert.deepEqual(toasts.at(-1), ["The terminal was not stopped: the PTY did not answer", "err"]);
    assert.ok(tabs(p.frame).includes("k2"), "its tab stays: its process may run on");
    // The server's cap closed k3 meanwhile: its stop finds no such terminal, and its tab goes, nothing said.
    refusal = new Refusal(500, "no such terminal");
    listed = listed.filter((r) => r.id !== "k3");
    stopOf(p.frame, "k3").dispatch("click");
    await until(() => !tabs(p.frame).includes("k3"), "the tab of a terminal gone");
    assert.equal(toasts.length, said + 1);
    // A stop that lands: the tab goes, and a list the server answered before it brings none back.
    refusal = null;
    stopOf(p.frame, "k2").dispatch("click");
    await until(() => !tabs(p.frame).includes("k2"), "the tab stopped");
    p.host.draw();
    await flush();
    assert.ok(!tabs(p.frame).includes("k2"), "a tab gone stays gone");
  } finally {
    p.done();
  }
});

// (fails before: yes — the bug hunt of 10-30, UIP-4: the page's Terminal pane had no refresh, so the run's pulse drew it
// anew — moving every terminal out of the page and back — and read the server's list only while it had no tab)
test("the page hands the Terminal pane its refresh beside its draw", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /\{ id: "terminal", [^\n]*render: \(body, ctx\) => renderTerminal\(body, terminalCtx\(ctx\)\), refresh: \(body, ctx\) => refreshTerminal\(body, terminalCtx\(ctx\)\) \}/);
  assert.match(app, /function terminalCtx\(ctx\) \{\s*return \{ \.\.\.ctx, onToast: toast, getFolder: \(\) => chatOf\(state\.currentId\)\?\.cwd \|\| folderIn\.value\.trim\(\) \};\s*\}/, "its toasts and its folder, as they were");
});

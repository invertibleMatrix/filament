// @ts-check
// A view-only device's page (the owner's remote Filament of 11-06, p4-view-ui; found in p1-e2e): it offered the composer
// and Send, a new chat whose Start showed the server's raw refusal ("a view-only device reads; POST
// /sessions/draft-start is more than that"), and the terminal's +. On a view-only page (/api/state's device, its scope
// "view") the box says it reads only and sends nothing, New chat and the Start are not offered, the terminal pane says a
// view-only device opens none, and nothing the server would refuse it is asked; a full device's page and this
// computer's are as they were.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";

const g = /** @type {any} */ (globalThis);
/** What the page asked of the server, in order: its method and address. @type {string[]} */
const asked = [];
/** What the stand-in server refused, in order: its method and address. @type {string[]} */
const refused = [];
/** A refusal the stand-in server answers: its status and body. */
class Refusal {
  /** @param {number} status @param {any} body */
  constructor(status, body) {
    this.status = status;
    this.body = body;
  }
}
/** What the stand-in server answers by the address and the method: a body, a `Refusal`, or undefined for a 404. @type {(url: string, method: string) => any} */
let serve = () => undefined;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
  const method = String(init.method || "GET");
  asked.push(`${method} ${url}`);
  const body = serve(String(url), method);
  if (body instanceof Refusal) {
    refused.push(`${method} ${url}`);
    return new Response(JSON.stringify(body.body), { status: body.status, headers: { "content-type": "application/json" } });
  }
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
/**
 * Filament as a view-only device hears it (admin/index.js, remote.js VIEW_ROUTES): what it reads answered, anything more
 * refused in the server's words — a write, the git places, the terminals.
 * @param {string} url @param {string} method
 */
const asViewDevice = (url, method) => {
  const path = url.replace(/^\/api/, "").split("?")[0];
  if (method !== "GET" || path.startsWith("/git/places") || path === "/terminal") return new Refusal(403, { error: `a view-only device reads; ${method} ${path} is more than that` });
  return undefined;
};
const hadStorage = g.localStorage;
/** @type {Map<string, string>} */
const kept = new Map();
g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)), removeItem: (/** @type {string} */ k) => void kept.delete(k) };
// The page reads `fetch` as its modules load, and the terminal pane builds its strip as it loads: both stand first.
const doc = stubDocument();
if (typeof g.window.setTimeout !== "function") g.window.setTimeout = () => 0;
const { createComposer, VIEW_ONLY_WORDS } = await import("../src/ui/harness/composer/composer.js");
const { createEmptyState, VIEW_ONLY_START_WORDS } = await import("../src/ui/harness/conversation/empty.js");
const terminal = await import("../src/ui/harness/panes/terminal.js");
const { h } = await import("../src/ui/lib/dom.js");

after(() => {
  doc.restore();
  g.fetch = realFetch;
  if (hadStorage === undefined) delete g.localStorage;
  else g.localStorage = hadStorage;
});
beforeEach(() => {
  doc.document.body.replaceChildren();
  asked.length = 0;
  refused.length = 0;
  kept.clear();
  serve = () => undefined;
});

/** A few turns of the event loop: what a paint or a press set off has landed. */
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
/** The words the server refuses a view-only device in, wherever they would show. */
const RAW = /is more than that/;

describe("the composer", () => {
  /** The composer on the stub page, with what it sent. */
  const box = () => {
    const host = /** @type {any} */ (h("div"));
    doc.document.body.append(host);
    /** @type {string[]} */
    const sent = [];
    /** The settings it wrote: each key and value. @type {any[]} */
    const changes = [];
    /** How many times Esc twice opened the list to rewind to. */
    const rewinds = { n: 0 };
    const c = createComposer(host, {
      onSend: (text) => { sent.push(text); return true; },
      onStop: () => {},
      getChat: () => ({ chainId: "c1", turns: [] }),
      onSettingChange: (k, v) => void changes.push([k, v]),
      onRewind: () => void rewinds.n++,
    });
    const ta = host.querySelector(".composer-input");
    /** Type the words, then press Enter. @param {string} text */
    const press = (text) => {
      ta.value = text;
      ta.dispatch("keydown", { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, keyCode: 13, preventDefault() {} });
    };
    /** The bar's parts that stand: their classes. */
    const standing = () => /** @type {any[]} */ (host.querySelector(".composer-bar").children).filter((x) => x.style.display !== "none").map((x) => x.className);
    return { c, host, ta, sent, changes, rewinds, press, standing, bar: () => host.querySelector(".view-only-bar"), sendBtn: host.querySelector(".send"), hint: () => host.querySelector(".composer-hint").textContent };
  };

  // (fails before: yes — Ctrl+Shift+M cycled the hidden mode and wrote it, Ctrl+K's rows picked a model and a level,
  // and another tab's claim put Take over here over the view-only bar; the review of p4-view-ui)
  test("on a view-only page its shortcuts' doors write nothing, and another tab's claim offers no Take over here", () => {
    const b = box();
    const takeOver = () => b.host.querySelectorAll(".read-only-bar").find((/** @type {any} */ x) => !x.classList.contains("view-only-bar"));
    b.c.setViewOnly(true);
    b.c.cycleMode();
    assert.deepEqual(b.changes, [], "the mode stays as the chat has it");
    assert.equal(b.c.tune("effort", "high"), false);
    assert.equal(b.c.pickFamilyById("anything"), false);
    b.c.setReadOnly(true);
    assert.equal(takeOver().classList.contains("hidden"), true, "no Take over here: the view-only bar says what the page is");
    // The page a full device's again: the other tab's claim is said, and the mode cycles.
    b.c.setViewOnly(false);
    assert.equal(takeOver().classList.contains("hidden"), false);
    b.c.setReadOnly(false);
    b.c.cycleMode();
    assert.equal(b.changes.length, 1, JSON.stringify(b.changes));
  });

  // (fails before: yes — the owner's of 11-14, his PC's chat open on his MacBook too: the bar said "Open in another tab"
  // for another machine, Take over here was the one way across, and Send stood down beside it)
  test("a page whose chat another window writes says where in a quiet line, keeps Send, and typing takes it over", () => {
    const host = /** @type {any} */ (h("div"));
    doc.document.body.append(host);
    let takes = 0;
    /** @type {string[]} */
    const sent = [];
    const c = createComposer(host, {
      onSend: (text) => { sent.push(text); return true; },
      onStop: () => {},
      getChat: () => ({ chainId: "c1", turns: [] }),
      onTakeOver: () => void takes++,
    });
    const line = () => host.querySelectorAll(".read-only-bar").find((/** @type {any} */ x) => !x.classList.contains("view-only-bar"));
    const ta = host.querySelector(".composer-input");
    c.setReadOnly(true, "Open on MacBook Pro — type here to take it over");
    assert.equal(line().classList.contains("hidden"), false);
    assert.equal(line().textContent, "Open on MacBook Pro — type here to take it over");
    assert.equal(line().querySelectorAll("button").length, 0, "nothing to press");
    assert.notEqual(host.querySelector(".send").disabled, true, "Send stands: a send takes it over");
    ta.dispatch("input", { isTrusted: false });
    assert.equal(takes, 0, "a script's input is not the person");
    ta.value = "h";
    ta.dispatch("input", { isTrusted: true });
    assert.equal(takes, 1, "the person typing here takes it over");
    c.setReadOnly(false);
    assert.equal(line().classList.contains("hidden"), true);
    ta.dispatch("input", { isTrusted: true });
    assert.equal(takes, 1, "a tab that writes the chat takes nothing");
    c.setViewOnly(true);
    c.setReadOnly(true);
    ta.dispatch("input", { isTrusted: true });
    assert.equal(takes, 1, "a view-only page takes nothing over");
    assert.equal(line().classList.contains("hidden"), true);
  });

  // (fails before: yes — the box offered Send on a view-only device's page, and had no way to say it reads only)
  test("on a view-only page it says it reads only, takes no words, sends nothing, and offers nothing that acts", () => {
    const b = box();
    assert.equal(b.bar().classList.contains("hidden"), true, "this computer's page: no such bar");
    b.c.setViewOnly(true);
    assert.deepEqual([b.bar().classList.contains("hidden"), b.bar().textContent, b.bar().getAttribute("role")], [false, VIEW_ONLY_WORDS, "status"]);
    assert.equal(VIEW_ONLY_WORDS, "This device is view-only: it reads this Filament and sends nothing");
    assert.equal(b.ta.placeholder, "View-only — this device reads the chat and sends nothing");
    assert.deepEqual([b.ta.getAttribute("contenteditable"), b.ta.getAttribute("aria-readonly")], ["false", "true"]);
    assert.deepEqual(b.standing(), ["grow", "widget-slot slot-bar"], "Add context, the mode, Parallelize, the model, the effort, Send, its menu and Stop are not offered");
    // (fails before: yes — "Enter to send · Shift+Enter for a new line" stood under a box that sends nothing; the drive's pictures)
    assert.equal(b.hint(), "", "no words on what Enter does");
    b.press("hello");
    b.sendBtn.onclick();
    assert.deepEqual(b.sent, [], "Enter and Send send nothing");
    // A turn that runs, read from elsewhere: Stop and the send's menu stay away.
    b.c.setLive(true, { kind: "loop" });
    assert.deepEqual(b.standing(), ["grow", "widget-slot slot-bar"]);
    assert.equal(b.hint(), "", "nor on steering it");
  });

  // (fails before: yes — Esc twice in the empty box opened the list to rewind to, and a picture pasted into it became
  // an attachment; the hunt of p4-view-ui)
  test("on a view-only page Esc twice rewinds nothing and a pasted picture is taken in none; a full device's page as it was", async () => {
    const hadReader = g.FileReader;
    // A picture's bytes, read as the page reads them.
    g.FileReader = class {
      /** @type {string} */ result = "";
      /** @type {(() => void) | null} */ onload = null;
      readAsDataURL() {
        this.result = "data:image/png;base64,eA==";
        queueMicrotask(() => this.onload?.());
      }
    };
    try {
      const b = box();
      const esc = () => b.ta.dispatch("keydown", { key: "Escape", shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, keyCode: 27, preventDefault() {} });
      const paste = () => b.ta.dispatch("paste", { clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => new File(["x"], "shot.png", { type: "image/png" }) }], getData: () => "" }, preventDefault() {} });
      b.c.setViewOnly(true);
      esc();
      esc();
      paste();
      await flush();
      assert.deepEqual([b.rewinds.n, b.c.files().length], [0, 0], "no Rewind, no attachment");
      b.c.setViewOnly(false);
      esc();
      esc();
      paste();
      await flush();
      assert.deepEqual([b.rewinds.n, b.c.files().map((/** @type {any} */ f) => f.name)], [1, ["shot.png"]]);
    } finally {
      if (hadReader === undefined) delete g.FileReader;
      else g.FileReader = hadReader;
    }
  });

  // (fails before: yes — setViewOnly was no part of the composer)
  test("a full device's page and this computer's are as they were", () => {
    const b = box();
    const before = b.standing();
    const words = b.ta.placeholder;
    b.c.setViewOnly(true);
    b.c.setViewOnly(false);
    assert.deepEqual([b.standing(), b.ta.placeholder, b.ta.getAttribute("contenteditable"), b.bar().classList.contains("hidden")], [before, words, "true", true]);
    assert.equal(b.hint(), "Enter to send · Shift+Enter for a new line", "what Enter does, said again");
    assert.ok(before.includes("send idle") && before.some((c) => /\battach\b/.test(c)), JSON.stringify(before));
    b.press("hello");
    assert.deepEqual(b.sent, ["hello"]);
  });
});

describe("a new chat's page", () => {
  /** The empty state as the transcript makes it, its Start hooks the page's, on an unborn chat in /work. @param {boolean} viewOnly */
  const page = (viewOnly) => {
    const chat = { id: "p1", turns: [] };
    /** @type {string[]} */
    const said = [];
    const empty = createEmptyState({
      getFolder: () => "/work",
      setFolder: () => {},
      onToast: (m) => void said.push(m),
      chatOf: () => chat,
      onHeld: () => {},
      start: {
        body: () => ({ cwd: "/work", model: "m-1" }),
        text: () => "",
        permission: () => "",
        setPermission: () => {},
        models: () => [],
        mainModel: () => "m-1",
        viewOnly: () => viewOnly,
      },
    });
    doc.document.body.append(empty.el);
    const el = /** @type {any} */ (empty.el);
    return { empty, el, said, chooser: el.querySelector(".chooser"), line: el.querySelector(".chooser-view-only"), board: el.querySelector(".nt-host") };
  };

  // (fails before: yes — the Start asked draft-start of the server, which refused it, and showed the refusal's words)
  test("on a view-only page: no chooser and no Start, words that say it starts none, and nothing asked that is refused", async () => {
    serve = asViewDevice;
    const p = page(true);
    p.empty.refresh();
    p.empty.paintChip();
    p.empty.paintStart();
    p.empty.draftChanged();
    await new Promise((r) => setTimeout(r, 200));
    await flush();
    assert.deepEqual([p.chooser.classList.contains("hidden"), p.line.classList.contains("hidden"), p.line.textContent], [true, false, VIEW_ONLY_START_WORDS]);
    assert.equal(VIEW_ONLY_START_WORDS, "This device is view-only: it reads this Filament's chats and starts none. Open a chat from the list to read it.");
    assert.equal(p.board.classList.contains("hidden"), true, "no Start");
    assert.deepEqual(refused, [], "nothing asked that the server refuses a view-only device");
    assert.ok(!asked.some((a) => a.includes("/sessions/draft-start")), JSON.stringify(asked));
    assert.doesNotMatch(p.el.textContent, RAW);
    assert.deepEqual(p.said, []);
  });

  // (fails before: only at the view-only line it finds hidden, which was not there — the chooser and the Start as they were)
  test("a full device's page and this computer's: the chooser and the Start, asked of the server as before", async () => {
    serve = (url) => (url === "/api/sessions/draft-start" ? new Refusal(500, { error: "the start could not be weighed" }) : undefined);
    const p = page(false);
    p.empty.refresh();
    await until(() => !p.board.classList.contains("hidden"), "the Start");
    assert.deepEqual([p.chooser.classList.contains("hidden"), p.line.classList.contains("hidden")], [false, true]);
    assert.ok(asked.includes("POST /api/sessions/draft-start"), JSON.stringify(asked));
  });
});

/** Wait until `ok` holds, a turn of the event loop at a time. @param {() => any} ok @param {string} what */
async function until(ok, what) {
  for (let i = 0; i < 200; i++) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`never: ${what}`);
}

describe("the terminal pane", () => {
  /** The pane drawn in a body of its own, the page a view-only device's or not. @param {boolean} viewOnly */
  const pane = (viewOnly) => {
    terminal.setTerminalsViewOnly(viewOnly);
    const body = /** @type {any} */ (h("div"));
    doc.document.body.append(body);
    /** @type {string[]} */
    const said = [];
    const ctx = { setBadge: () => {}, onToast: (/** @type {string} */ m) => void said.push(m), getFolder: () => "/work" };
    terminal.renderTerminal(body, ctx);
    return { body, ctx, said, plus: () => body.querySelector(".term-new"), words: () => body.querySelector(".pane-empty").textContent };
  };
  after(() => terminal.setTerminalsViewOnly(false));

  // (fails before: yes — the pane offered its + on a view-only device's page, and read the server's terminals, refused)
  test("on a view-only page it says a view-only device opens none, offers no +, and asks nothing of the server", async () => {
    serve = asViewDevice;
    const p = pane(true);
    await flush();
    assert.deepEqual([p.plus(), p.words()], [null, "A view-only device opens no terminal: it reads this Filament's chats."]);
    assert.equal(p.words(), terminal.VIEW_ONLY_WORDS);
    terminal.refreshTerminal(p.body, p.ctx);
    await flush();
    assert.deepEqual([asked, refused, p.said], [[], [], []]);
  });

  // (fails before: yes, at the page that hears it is view-only once the pane shows — the full page's + and its read as
  // they were)
  test("a full device's page and this computer's have the + and read the server's terminals; a page that hears it is view-only after, loses its + at once", async () => {
    serve = (url, method) => (url === "/api/terminal" && method === "GET" ? { terminals: [] } : undefined);
    const p = pane(false);
    await flush();
    assert.ok(p.plus(), "the +");
    assert.equal(p.words(), "No terminal yet — + opens a PowerShell in the chat's folder.");
    assert.ok(asked.includes("GET /api/terminal"), JSON.stringify(asked));
    terminal.setTerminalsViewOnly(true);
    assert.deepEqual([p.plus(), p.words()], [null, terminal.VIEW_ONLY_WORDS]);
    terminal.setTerminalsViewOnly(false);
    assert.ok(p.plus(), "back on a full page");
  });
});

describe("the left bar", () => {
  /**
   * The left bar over a Filament with the chats given, on a page view-only or not; what it was asked to start.
   * @param {boolean} viewOnly @param {any[]} [sessions]
   */
  const bar = async (viewOnly, sessions = []) => {
    const d = /** @type {any} */ (doc.document);
    d.addEventListener ??= () => {};
    d.removeEventListener ??= () => {};
    g.addEventListener ??= () => {};
    g.removeEventListener ??= () => {};
    g.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
    g.EventSource ??= class {
      constructor() {
        this.onmessage = null;
      }
      addEventListener() {}
      close() {}
    };
    serve = () => ({ sessions, projects: [], runs: [] });
    const { createSidebar } = await import("../src/ui/harness/sidebar.js");
    const host = /** @type {any} */ (h("div"));
    doc.document.body.append(host);
    /** @type {string[]} */
    const started = [];
    const sb = createSidebar(host, { onNew() {}, onSettings() {}, onHide() {}, onSelectChat() {}, onOpen() {}, onChanged() {}, onAddProject: () => void started.push("project"), onOpenFolder: () => void started.push("folder"), viewOnly: () => viewOnly });
    await sb.load();
    await flush();
    return { host, sb, started };
  };
  const chat = { id: "c1", title: "Parser refactor", cwd: "H:\\work\\shop-api", when: new Date().toISOString() };

  // (fails before: yes — the left bar offered Add project, Open folder… and New Space… to a view-only device's page)
  test("on a view-only page: no Add project, and its empty bar says it starts none where Open folder… and New Space… stood", async () => {
    const empty = await bar(true);
    assert.equal(empty.host.querySelectorAll(".lb-empty-btn").length, 0, "no Open folder…, no New Space…");
    const { VIEW_ONLY_BAR_WORDS } = await import("../src/ui/harness/sidebar.js");
    assert.ok(empty.host.textContent.includes(VIEW_ONLY_BAR_WORDS));
    assert.ok(!RAW.test(empty.host.textContent));
    const listed = await bar(true, [chat]);
    assert.ok(listed.host.querySelector(".projects-head"), "its chats listed, to read");
    assert.equal(listed.host.querySelectorAll('[aria-label="Add project"]').length, 0, "no Add project");
    // (fails before: yes — the Spaces' + stood there; the drive's pictures)
    assert.ok(listed.host.querySelector(".spaces-head"), "the Spaces listed, to read");
    assert.equal(listed.host.querySelectorAll('.spaces-head [aria-label="New Space…"]').length, 0, "no Space made");
  });

  test("a full device's page and this computer's: Open folder… and New Space… with no chat, Add project over the list", async () => {
    const empty = await bar(false);
    assert.deepEqual(empty.host.querySelectorAll(".lb-empty-btn").map((/** @type {any} */ b) => b.textContent.replace(/Ctrl\+O$/, "")), ["Open folder…", "New Space…"]);
    const listed = await bar(false, [chat]);
    assert.equal(listed.host.querySelectorAll('[aria-label="Add project"]').length, 1);
    assert.equal(listed.host.querySelectorAll('.spaces-head [aria-label="New Space…"]').length, 1);
  });

  /** A chat row's right-click menu: its items' words. @param {any} host */
  const rowMenu = (host) => {
    for (const m of doc.document.body.querySelectorAll(".zc-menu")) m.remove();
    host.querySelector('.sess-row[data-chain="c1"]').dispatch("contextmenu", { preventDefault() {} });
    return doc.document.body.querySelectorAll(".zc-menu-text").map((/** @type {any} */ x) => x.textContent);
  };

  // (fails before: yes — a row offered Pin, and its menu Pin, Rename, Archive, Fork and Delete; the review of p4-view-ui)
  test("a chat's row on a view-only page: no Pin, and its menu copies alone", async () => {
    const view = await bar(true, [{ ...chat, id: "c1" }]);
    assert.equal(view.host.querySelectorAll(".row-act.pin").length, 0, "no Pin");
    assert.deepEqual(rowMenu(view.host), ["Copy path", "Copy session ID"]);
    const full = await bar(false, [{ ...chat, id: "c1" }]);
    assert.equal(full.host.querySelectorAll(".row-act.pin").length, 1);
    const items = rowMenu(full.host);
    for (const w of ["Pin", "Rename…", "Archive", "Fork…", "Delete chat…", "Copy path"]) assert.ok(items.includes(w), `${w} in ${items.join(", ")}`);
  });
});

// (fails before: yes — a reply's Fork and Retry and a message's Rewind stood on a view-only page; the drive's pictures)
test("a reply's Fork and Retry and a message's Rewind are hidden on a view-only page by its class; Copy and Details stay", async () => {
  if (typeof g.window.setInterval !== "function") g.window.setInterval = () => 0;
  const { footerEl } = await import("../src/ui/harness/conversation/turn.js");
  const turn = { status: "done", requestId: "r1", reply: { text: "The parser is built." }, facts: {}, startedAt: Date.now() - 1000, endedAt: Date.now() };
  const foot = /** @type {any} */ (footerEl(turn, { onCopy() {}, onFork() {}, onRetry() {}, onWatchRun() {}, onExplain() {} }));
  const acts = foot.querySelectorAll(".a-act").map((/** @type {any} */ b) => [b.getAttribute("aria-label").split(" ")[0], b.className]);
  assert.deepEqual(acts, [["Copy", "a-act"], ["Fork", "a-act a-fork"], ["Retry", "a-act a-retry"], ["Details", "a-act"]]);
  const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
  assert.match(css, /\n\.view-only \.a-fork, \.view-only \.a-retry, \.view-only \.u-rewind, \.view-only \.f-retry, \.view-only \.f-sign-in \{ display: none; \}/);
  const user = readFileSync(new URL("../src/ui/harness/conversation/turn.js", import.meta.url), "utf8");
  assert.match(user, /class: "u-act u-rewind"/, "the class the rule hides");
});

// (fails before: yes — the page read no device from /api/state, and offered New chat and the Start to any)
test("the page: /api/state's device makes it view-only — the box, the left bar's New chat, Ctrl+N, the palette, the Start and the terminal follow", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /const viewOnlyPage = \(\) => device\?\.scope === "view";/);
  assert.match(app, /function heardDevice\(st\) \{\n  setRemotePage\(st\.viewer === "remote"\);\n  const was = viewOnlyPage\(\);\n  device = st\.device \|\| null;\n  if \(!deviceHeard \|\| viewOnlyPage\(\) !== was\) paintViewOnly\(\);/);
  const from = app.indexOf("function paintViewOnly()");
  assert.ok(from > 0, "paintViewOnly");
  const paint = app.slice(from, app.indexOf("\n}\n", from));
  assert.match(paint, /composer\.setViewOnly\(on\);/);
  assert.match(paint, /setTerminalsViewOnly\(on\);/);
  assert.match(app, /import \{ refreshTerminal, renderTerminal, setTerminalsViewOnly \} from "\.\/panes\/terminal\.js";/);
  assert.match(paint, /document\.querySelectorAll\("\.sess-new, \.rail-new"\)\)\) b\.classList\.toggle\("hidden", on\);/);
  assert.match(paint, /transcript\.refreshFolder\(\);/, "the new chat's page is painted again");
  assert.match(paint, /sidebar\.draw\(\);/, "the left bar is drawn again");
  assert.match(paint, /document\.documentElement\.classList\.toggle\("view-only", on\);/, "the page's class, which hides a reply's Fork and Retry");
  // The welcome tour: every step writes a setting — it opens by itself on none, and from nowhere on a view-only page.
  assert.match(app, /function openTour\(\) \{\n(?:  \/\/[^\n]*\n)+  if \(viewOnlyPage\(\) \|\| CHAT_ONLY \|\| document\.querySelector\("\.wel-sheet"\)\) return;/);
  assert.match(app, /if \(!POPPED && !CHAT_ONLY && !viewOnlyPage\(\) && state\.config\) \{\n    const toured = state\.config\?\.ui\?\.welcome\?\.seen !== false;/, "and only where the state read, which says whether it is one");
  assert.match(app, /\{ id: "welcome", label: "Welcome tour", [^\n]*when: \(\) => !viewOnlyPage\(\), run: \(\) => openTour\(\) \}/);
  // The review of p4-view-ui: the doors the hidden controls still had.
  assert.match(app, /const VIEW_ONLY_KEYS_OFF = new Set\(\["model", "mode", "effort", "fork", "subagent"\]\);/);
  // (After the chat alone hands the desk its list's keys: none of those is one.)
  assert.match(app, /e\?\.preventDefault\(\);\n(?:[^\n]*\n){4}  if \(viewOnlyPage\(\) && VIEW_ONLY_KEYS_OFF\.has\(id\)\) return;/, "Ctrl+M, Ctrl+Shift+M, Ctrl+T, Ctrl+Shift+F and Alt+A");
  assert.match(app, /settings: \(\) => \(viewOnlyPage\(\) \? null : settingFacts\(\)\),/, "Ctrl+K's setting rows");
  assert.match(app, /\{ id: "side-new", [^\n]*when: \(\) => !viewOnlyPage\(\) && /, "the palette's Ask on the side");
  assert.match(app, /\{ id: "catch-up", [^\n]*when: \(\) => !viewOnlyPage\(\) && /, "and its Catch me up…");
  assert.match(app, /async function writeSessionSettings\([^\n]*\n[^\n]*\n[^\n]*\n  if \(followsStill\(\) \|\| viewOnlyPage\(\)\) \{\n    toast\(viewOnlyPage\(\) \? VIEW_ONLY_WORDS : readOnlyWords\(\), "err"\);/, "a write said in the page's words");
  assert.match(app, /function claimWriting\(how = "open"\) \{\n[^\n]*\n[^\n]*\n  if \(POPPED \|\| viewOnlyPage\(\)\) return;/, "no claim, and typing takes nothing over");
  assert.match(app, /keys: \(\) => viewOnlyPage\(\) \? null : dockKeys\(/, "the dock takes no keys");
  assert.match(paint, /decisions\.el\.style\.display = on \? "none" : "";\n\s*flowDock\.el\.style\.display = on \? "none" : "";/, "nor stands");
  assert.match(app, /onReload: \(\) => reloadSession\(\),\n[^\n]*\n    viewOnly: \(\) => viewOnlyPage\(\),/, "the header's hook");
  const header = readFileSync(new URL("../src/ui/harness/header.js", import.meta.url), "utf8");
  assert.match(header, /if \(cb\.viewOnly\?\.\(\)\) \{\n      titleMenu = menu\(\[\.\.\.copies, \{ type: "separator" \}, reload\]/, "the chat menu copies and reloads alone");
  assert.match(header, /if \(editing \|\| !chat\?\.chainId \|\| cb\.viewOnly\?\.\(\)\) return;/, "a double press renames nothing");
  assert.match(app, /onOpenFolder: \(\) => openFolder\(\),\n\s*viewOnly: \(\) => viewOnlyPage\(\),/, "the left bar's hook");
  assert.match(app, /\n    viewOnly: \(\) => viewOnlyPage\(\),\n    permission: \(\) => composer\.permissionMode/, "the Start's hooks");
  assert.match(app, /\{ id: "new", label: WORDS\.newChat, [^\n]*when: \(\) => !viewOnlyPage\(\), run: \(\) => newChat\(\) \}/, "the palette's New chat");
  assert.match(app, /"new-task": \(\) => \{ if \(viewOnlyPage\(\)\) return; pushNextAddress = true; newChat\(\); \},/, "Ctrl+N");
  assert.match(app, /onNew: \(\) => \{ if \(viewOnlyPage\(\)\) return; pushNextAddress = true; newChat\(\); leaveScreen\(\); \},/, "the left bar's New chat");
  assert.match(app, /function openFolder\(\) \{\n[^\n]*\n  if \(viewOnlyPage\(\)\) return;/, "Ctrl+O starts no chat");
  assert.match(app, /async function loadTerminals\(\) \{\n[^\n]*\n  if \(POPPED \|\| viewOnlyPage\(\)\) return;/, "the status panel reads no terminals");
  // The left bar's two New chat buttons are the ones the page hides.
  const sidebar = readFileSync(new URL("../src/ui/harness/sidebar.js", import.meta.url), "utf8");
  assert.match(sidebar, /h\("button", \{ class: "sess-new", type: "button", title: WORDS\.newChat/);
  assert.match(sidebar, /btn\(WORDS\.newChat, "messageCirclePlus", \(\) => cb\.onNew\(\), comboOf\("new-task"\), "rail-new"\)/);
});

// (fails before: yes — the bar's Fold now, window Change…, Check now and Stop, a failure's Retry and Sign in, Alt+W and
// a chat's unread mark asked the server for writes it refuses a view-only device, and its refusal reached the page in
// its own words; the hunt of p4-view-ui)
test("the page's client asks the server no write on a view-only page and says why in the page's words; its reads and its sign-out go", async () => {
  const { api, setViewOnlyApi, VIEW_ONLY_REFUSED } = await import("../src/ui/harness/lib/api.js");
  serve = (url, method) => (method === "GET" || url === "/api/remote/sign-out" || url === "/api/sessions/c1/compact" ? { ok: true } : undefined);
  setViewOnlyApi(true);
  try {
    for (const [method, path] of [["POST", "/sessions/c1/compact"], ["PUT", "/sessions/c1/window"], ["PATCH", "/sessions/c1/settings"], ["DELETE", "/sessions/c1"], ["POST", "/agent-accounts/claude/check"], ["post", "/sessions/c1/stop"], ["POST", "/remote/sign-out/x"], ["HEAD", "/sessions/c1"]]) {
      await assert.rejects(api(path, { method, body: {} }), (/** @type {any} */ e) => e.message === VIEW_ONLY_REFUSED && e.status === 403 && e.body.viewOnly === true, `${method} ${path}`);
    }
    assert.deepEqual(asked, [], "nothing asked of the server");
    assert.deepEqual(await api("/sessions/c1"), { ok: true });
    assert.deepEqual(await api("/remote/sign-out", { method: "POST", body: {} }), { ok: true });
    assert.deepEqual(asked, ["GET /api/sessions/c1", "POST /api/remote/sign-out"], "a GET, and the device's own sign-out: what the server takes from it");
    assert.ok(!RAW.test(VIEW_ONLY_REFUSED));
  } finally {
    setViewOnlyApi(false);
  }
  // A full device's page and this computer's: the write is asked.
  assert.deepEqual(await api("/sessions/c1/compact", { method: "POST", body: {} }), { ok: true });
  assert.equal(asked.at(-1), "POST /api/sessions/c1/compact");

  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  const from = app.indexOf("function paintViewOnly()");
  const paint = app.slice(from, app.indexOf("\n}\n", from));
  assert.match(paint, /setViewOnlyApi\(on\);/, "the page's class and its client follow /api/state's device");
  // Each door the bar and the transcript left standing says the page's words, and asks nothing.
  assert.match(app, /async function accountWord\(upstream, what, beside = null\) \{\n  if \(viewOnlyPage\(\)\) \{\n    toast\(VIEW_ONLY_REFUSED, "err"\);\n    return null;\n  \}/, "Check now and a reset credit");
  assert.match(app, /async function compactNow\([^\n]*\n  if \(viewOnlyPage\(\)\) \{\n    if \(sending\) return VIEW_ONLY_WORDS;\n    toast\(VIEW_ONLY_REFUSED, "err"\);\n    return false;\n  \}/, "Fold now");
  assert.match(app, /async function writeSessionWindow\(chat, tokens\) \{\n  if \(!chat\.chainId\) return;\n  if \(followsStill\(\) \|\| viewOnlyPage\(\)\) return toast\(viewOnlyPage\(\) \? VIEW_ONLY_REFUSED : readOnlyWords\(\), "err"\);/, "the window's Change…");
  assert.match(app, /async function stopCurrent\(\) \{\n  if \(viewOnlyPage\(\)\) return void toast\(VIEW_ONLY_REFUSED, "err"\);/, "Stop");
  assert.match(app, /function stopAndCompact\(\) \{\n  if \(viewOnlyPage\(\)\) return void toast\(VIEW_ONLY_REFUSED, "err"\);/, "Stop and compact");
  assert.match(app, /onRetry: \(chat, turn\) => \{\n    if \(viewOnlyPage\(\)\) \{\n      toast\(VIEW_ONLY_WORDS, "err"\);\n      return false;\n    \}/, "a failure's Retry");
  assert.match(app, /refusalAgain = true;\n[^\n]*\n  if \(viewOnlyPage\(\)\) return refuse\(VIEW_ONLY_WORDS, !away\);\n(?:  \/\/[^\n]*\n)*  if \(queued\) keepQueues\(\);\n  const typed = text;/, "a send from any door");
  assert.match(app, /"close-context": \(\) => \{\n      if \(rail\.closeFocused\(\)\) return;\n      if \(viewOnlyPage\(\) \|\| CHAT_ONLY\) return;\n      pushNextAddress = true;/, "Alt+W starts no chat");
  assert.match(app, /if \(!viewOnlyPage\(\) && \(\(row \? row\.unread : s\.unread\) \|\| state\.unreadChains\.has\(chainId\)\)\) api\(/, "an unread mark is left to a page that may write it");
  // A failure's Retry and Sign in carry the classes the page's rule hides.
  const interaction = readFileSync(new URL("../src/ui/harness/conversation/interaction.js", import.meta.url), "utf8");
  assert.match(interaction, /h\("button", \{ class: "ghost sm f-retry", type: "button", onclick: once\(cb\.onRetry\) \}, "Retry"\)/);
  assert.match(interaction, /h\("button", \{ class: "primary sm f-sign-in", type: "button",/);
  // (fails before: yes — the review of fx-view-ui: a failed first read of /state left the page open for its life; a
  // reset credit asked "can't be taken back" before it was refused, Resume at armed a "continue", the limit card's ways
  // on and Catch me up stood; Check now and the window's Change… said the page "sends nothing")
  assert.match(app, /const stateReady = api\("\/state"\)\n    \.then\(tookState\)\n    \.catch\(\(\) => stateAgain\(1000\)\);/, "a failed read of /state is read again");
  assert.match(app, /if \(!\(status >= 400 && status < 500\)\) stateAgain\(Math\.min\(ms \* 2, 30_000\)\);/);
  assert.match(app, /before: \(\) => api\("\/state"\)\.then\(\(st\) => \{ state\.config = st\.config \|\| \{\}; heardDevice\(st\); teamsSwitched\(\); \}\),/, "and the device heard wherever it is read");
  assert.match(app, /async function useResetCredit\(upstream\) \{\n  if \(viewOnlyPage\(\)\) \{\n    toast\(VIEW_ONLY_REFUSED, "err"\);\n    return null;\n  \}\n  const a = state\.accounts/, "refused before its question");
  assert.match(app, /function armResume\(chat, at\) \{\n  if \(at != null && viewOnlyPage\(\)\) return void toast\(VIEW_ONLY_REFUSED, "err"\);/, "no continue armed");
  assert.match(app, /catchUpLine\.paint\(!viewOnlyPage\(\) && !!id && movedChains\.has\(id\)\);/, "no Catch me up");
  const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
  assert.match(css, /\n\.view-only \.ix-limit-ways > :not\(\.ix-keep, \.grow, \.ix-limit-taken\) \{ display: none; \}/, "a limit card's ways on are hidden");
  assert.match(interaction, /const toggle = h\("button", \{ class: "ghost sm ix-keep", type: "button",/, "its details stay");
  assert.match(interaction, /cb\.onDismiss \? h\("button", \{ class: "ghost sm ix-keep", type: "button", onclick: cb\.onDismiss \}, "Dismiss"\) : null\),/, "and Dismiss");
});

// @ts-check
// A page on another machine (the owner's remote Filament of 11-06, p4-local-only): what opens a window opens it on the
// screen of the machine Filament runs on, never the person's. The server refuses the folder dialog and Show in folder to a
// caller on another machine; the page asks for neither — every Browse… lists the server's folders in the page over
// /files/dirs (as it does where the dialog cannot open: on a server not on Windows, four of them showed nothing), Show in
// folder becomes Copy path, and an editor opens a folder over SSH by the alias the rail reached the machine by
// (`vscode://vscode-remote/ssh-remote+<alias>/<path>`), or is not offered.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** What the page asked of the server, in order: its method and address. @type {string[]} */
const asked = [];
/** What the page posted, in order. @type {{ url: string, body: any }[]} */
const posted = [];
/** A refusal the stand-in server answers: its status and body. */
class Refusal {
  /** @param {number} status @param {any} body */
  constructor(status, body) {
    this.status = status;
    this.body = body;
  }
}
/** What the stand-in server answers by the whole address and the method: a body, a `Refusal`, or undefined for a 404. @type {(url: string, method: string) => any} */
let serve = () => undefined;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
  const method = String(init.method || "GET");
  asked.push(`${method} ${url}`);
  if (method !== "GET") posted.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
  const body = serve(String(url), method);
  if (body instanceof Refusal) return new Response(JSON.stringify(body.body), { status: body.status, headers: { "content-type": "application/json" } });
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
/** This browser's preferences: the editor chosen among them. @type {Map<string, string>} */
const kept = new Map();
const hadStorage = g.localStorage;
g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)), removeItem: (/** @type {string} */ k) => void kept.delete(k) };
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { remotePage, setRemotePage, sshAlias } = await import("../src/ui/harness/lib/api.js");
const { browseFolder } = await import("../src/ui/harness/lib/folder-browse.js");
const { EDITORS, chooseEditor, chosenEditor, editorButton, editorsHere, openInEditor } = await import("../src/ui/harness/lib/editors.js");
const { createHeader } = await import("../src/ui/harness/header.js");
const { renderOutputs } = await import("../src/ui/harness/panes/outputs.js");
const { renderCodeViewer } = await import("../src/ui/harness/panes/code-viewer.js");
const { newSpaceSheet } = await import("../src/ui/harness/space/new-space.js");
const { createEmptyState } = await import("../src/ui/harness/conversation/empty.js");
const { h } = await import("../src/ui/lib/dom.js");

after(() => {
  g.fetch = realFetch;
  if (hadStorage === undefined) delete g.localStorage;
  else g.localStorage = hadStorage;
});

/** This page's address, its query `search` ("" for none): where the rail names an SSH alias. @param {string} search */
const at = (search) => {
  if (search) g.location = { search };
  else delete g.location;
};
/** A page of this computer's, its address naming no alias, nothing heard yet. */
const atHome = () => {
  setRemotePage(false);
  at("");
};

describe("the server: the folder dialog and Show in folder answer this computer alone", () => {
  const NOT_THERE = join(tmpdir(), "filament-no-such-file-p4-local-only.txt");
  /** A caller by its socket's address and what its request carries. @param {string} address @param {Record<string, string>} [headers] */
  const caller = (address, headers = {}) => ({ socket: { remoteAddress: address }, headers });
  /** Callers on another machine: the network's, the tailnet's, and each through a proxy on this machine. */
  const AWAY = [
    caller("192.168.1.20"),
    caller("100.101.102.103"),
    caller("127.0.0.1", { "x-forwarded-for": "100.64.0.9" }),
    caller("::1", { "tailscale-user-login": "me@example.com" }),
  ];
  /**
   * A files row's answer, read in a context of its own (nothing listens): `req` its caller — none for a call in
   * Filament's own process —, and whether the row read the body.
   * @param {string} path @param {any} body @param {any} req
   */
  const fileRow = async (path, body, req) => {
    const { fileRoutes } = await import("../src/http/admin/files.js");
    const row = fileRoutes({ config: { get: () => ({ server: { host: "127.0.0.1" }, agentLoop: { roots: [] } }) }, overrides: { folderDialog: { env: {} } } }).find(([m, p]) => m === "POST" && p === path);
    assert.ok(row, path);
    let read = false;
    const res = { status: 0, text: "", writableEnded: false, destroyed: false, headersSent: false, writeHead(/** @type {number} */ s) { this.status = s; }, end(/** @type {string} */ t) { this.text = t; } };
    await /** @type {any} */ (row)[2]({ req, json: async () => { read = true; return body; }, res, url: new URL(`http://x/api${path}`) });
    return { status: res.status, json: JSON.parse(res.text), read };
  };
  /** The row run as if Filament ran on a Linux with no display, where no dialog is raised whatever the gate does. @param {() => Promise<void>} fn */
  const onLinux = async (fn) => {
    const was = /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(process, "platform"));
    Object.defineProperty(process, "platform", { ...was, value: "linux" });
    try {
      await fn();
    } finally {
      Object.defineProperty(process, "platform", was);
    }
  };

  // (fails before: yes — Show in folder asked the disk for another machine's caller and answered 404)
  test("Show in folder is refused to a caller on another machine, in words that say what stands in, before its body is read", async () => {
    for (const req of AWAY) {
      const r = await fileRow("/files/reveal", { path: NOT_THERE }, req);
      assert.deepEqual([r.status, r.json.remote, r.read], [403, true, false], JSON.stringify(req));
      assert.equal(r.json.error, "Show in folder opens the file manager on the computer Filament runs on, not yours: copy the path instead");
    }
  });

  // (fails before: yes — the dialog was raised for any caller: here, as Linux, its not-ok answer)
  test("the folder dialog is refused to a caller on another machine; this computer's is answered as before", async () => {
    await onLinux(async () => {
      for (const req of AWAY) {
        const r = await fileRow("/files/pick-folder", {}, req);
        assert.deepEqual([r.status, r.json], [403, { error: "the folder dialog opens on the computer Filament runs on, not yours: browse its folders in the page", remote: true }], JSON.stringify(req));
      }
      for (const req of [caller("127.0.0.1"), caller("::1"), undefined]) {
        const r = await fileRow("/files/pick-folder", {}, req);
        assert.deepEqual([r.status, r.json], [200, { ok: false, noDialog: true, reason: "this computer has no folder dialog to open: browse its folders in the page" }], "this computer, and Filament's own process");
      }
    });
  });

  test("Show in folder for this computer, and for Filament's own process, is judged as before", async () => {
    for (const req of [caller("127.0.0.1"), caller("::ffff:127.0.0.1"), undefined]) {
      const relative = await fileRow("/files/reveal", { path: "notes.txt" }, req);
      assert.deepEqual([relative.status, relative.json.error], [400, "path is required: a whole path"]);
      const missing = await fileRow("/files/reveal", { path: NOT_THERE }, req);
      assert.deepEqual([missing.status, missing.json.error], [404, `no such file: ${NOT_THERE}`]);
    }
  });
});

describe("where the page stands", () => {
  beforeEach(atHome);
  after(atHome);

  test("another machine's page: as its server says, or its address names the SSH alias the rail reached it by", () => {
    assert.deepEqual([remotePage(), sshAlias()], [false, ""], "this computer's page");
    setRemotePage(true);
    assert.equal(remotePage(), true, "the server said the page reads it from elsewhere");
    setRemotePage(false);
    at("?ssh=devbox");
    assert.deepEqual([remotePage(), sshAlias()], [true, "devbox"], "an SSH tunnel's page: this machine's to its server, another's to the person");
    at("?ssh=me%40devbox.lan&x=1");
    assert.equal(sshAlias(), "me@devbox.lan");
  });

  test("what is no host's alias is not taken: an option for ssh, a space, a command, a path", () => {
    for (const bad of ["-oProxyCommand=calc", "me@-oProxyCommand", "dev%20box", "box;calc", "a/b", "box%0Aevil", "@box", `${"a".repeat(254)}`]) {
      at(`?ssh=${bad}`);
      assert.deepEqual([sshAlias(), remotePage()], ["", false], bad);
    }
  });
});

describe("in a stand-in page", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    // A dialog asks what had the focus; nothing in the stub page is an element of the browser's.
    HTMLElement: class {},
  };
  /** The editors' addresses the page went to. @type {string[]} */
  const went = [];
  /** What the page copied. @type {string[]} */
  const copied = [];
  /** @type {PropertyDescriptor | undefined} */
  let hadNavigator;
  before(() => {
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
    g.window.open = (/** @type {string} */ url) => void went.push(url);
    if (typeof g.window.setTimeout !== "function") g.window.setTimeout = () => 0;
    hadNavigator = Object.getOwnPropertyDescriptor(g, "navigator");
    Object.defineProperty(g, "navigator", { configurable: true, writable: true, value: { clipboard: { writeText: (/** @type {string} */ t) => { copied.push(t); return Promise.resolve(); } } } });
  });
  after(() => {
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
    if (hadNavigator) Object.defineProperty(g, "navigator", hadNavigator);
    else delete g.navigator;
    atHome();
  });
  beforeEach(() => {
    doc.document.body.replaceChildren();
    asked.length = 0;
    posted.length = 0;
    went.length = 0;
    copied.length = 0;
    kept.clear();
    atHome();
    serve = () => undefined;
  });

  /** The server's folders: the roots, then each folder's own. */
  const DIRS = /** @type {Record<string, any>} */ ({
    "/api/files/dirs": { parent: null, dirs: [{ name: "home", path: "/home" }] },
    "/api/files/dirs?path=%2Fhome": { parent: "/", dirs: [{ name: "me", path: "/home/me" }] },
    "/api/files/dirs?path=%2Fhome%2Fme": { parent: "/home", dirs: [] },
  });
  /** @param {any} root */
  const rowsIn = (root) => /** @type {any[]} */ (root.querySelectorAll(".browse-dir")).map((b) => b.textContent);
  /** @param {any} root @param {string} words */
  const press = (root, words) => {
    const b = /** @type {any[]} */ (root.querySelectorAll("button")).find((x) => x.textContent === words);
    assert.ok(b, `a button "${words}" in ${root.className}`);
    b.dispatch("click");
  };
  const dialogAsked = () => asked.filter((a) => a === "POST /api/files/pick-folder").length;

  // (fails before: yes — Browse… asked the dialog of a server that would raise it on its own screen, and said it could not)
  test("Browse… on another machine's page: no dialog asked, the folders listed in the page, nothing said", async () => {
    setRemotePage(true);
    serve = (u) => DIRS[u];
    const input = /** @type {any} */ (h("input", { type: "text" }));
    const host = /** @type {any} */ (h("div", { class: "browse-dirs hidden" }));
    /** @type {string[]} */
    const said = [];
    assert.equal(await browseFolder(input, host, (w) => void said.push(w)), "failed");
    assert.deepEqual([dialogAsked(), said, host.classList.contains("hidden"), rowsIn(host)], [0, [], false, ["home"]]);
    press(host, "home");
    await until(() => rowsIn(host).includes("me"), "the folder's own");
    assert.deepEqual([input.value, rowsIn(host)], ["/home", ["↑ up", "me"]]);
  });

  // (fails before: yes — the refusal was said as a dialog that could not open, and asked again at the next Browse…)
  test("the server's refusal is heard: a page that did not know it is another machine's lists its folders unsaid, and asks no dialog again", async () => {
    serve = (u, method) => (u === "/api/files/pick-folder" && method === "POST" ? new Refusal(403, { error: "the folder dialog opens on the computer Filament runs on", remote: true }) : DIRS[u]);
    const input = /** @type {any} */ (h("input", { type: "text" }));
    const host = /** @type {any} */ (h("div", { class: "browse-dirs hidden" }));
    /** @type {string[]} */
    const said = [];
    await browseFolder(input, host, (w) => void said.push(w));
    assert.deepEqual([said, rowsIn(host), remotePage()], [[], ["home"], true]);
    await browseFolder(input, host, (w) => void said.push(w));
    assert.equal(dialogAsked(), 1, "asked once");
  });

  // (fails before: yes — the editors opened another machine's path as a path on yours; there was no SSH form)
  test("the editors: each on this computer's page; over SSH by the alias on another machine's; none where the rail named no alias", () => {
    chooseEditor("cursor");
    assert.deepEqual(editorsHere().map((e) => e.id), ["vscode", "cursor", "jetbrains"]);
    assert.equal(openInEditor("C:\\work\\app"), true);
    assert.deepEqual(went.splice(0), ["cursor://file/C%3A/work/app"], "as before");
    setRemotePage(true);
    assert.deepEqual([editorsHere(), chosenEditor(), openInEditor("/home/me/app"), went], [[], null, false, []], "a path there is that machine's: nothing opens it here");
    assert.equal(editorButton("/home/me/app", "Open app", "pl-open").classList.contains("hidden"), true, "the open buttons stand hidden");
    at("?ssh=devbox");
    chooseEditor("jetbrains");
    assert.deepEqual(editorsHere().map((e) => e.id), ["vscode", "cursor"], "JetBrains opens no folder of another machine by an address");
    assert.equal(chosenEditor()?.id, "vscode", "the choice that cannot open here gives way to the first that can");
    openInEditor("/home/me/my app");
    openInEditor("C:\\work\\app", "cursor");
    assert.deepEqual(went.splice(0), ["vscode://vscode-remote/ssh-remote+devbox/home/me/my%20app", "cursor://vscode-remote/ssh-remote+devbox/C%3A/work/app"]);
    assert.equal(editorButton("/home/me/app", "Open app", "pl-open").classList.contains("hidden"), false);
    assert.equal(EDITORS.find((e) => e.id === "vscode")?.url("/srv/x", "box"), "vscode://vscode-remote/ssh-remote+box/srv/x");
  });

  /** The header in the folder, and its Open in menu's rows: its label, then each item's words and whether it is ticked. @param {string} folder */
  const header = (folder) => {
    const noop = () => {};
    const hd = /** @type {any} */ (createHeader({ onFork: noop, onReload: noop, onRenamed: noop, onArchived: noop, getChat: () => null, onToast: noop, platform: () => "linux", onOpenFolder: noop }));
    doc.document.body.append(hd.el);
    hd.folderIn.value = folder;
    const btn = hd.el.querySelector(".hdr-editor");
    const menuEl = () => /** @type {any} */ (doc.document.body.querySelector(".zc-menu"));
    const rows = () => {
      btn.dispatch("click");
      const m = menuEl();
      const out = m.children.map((/** @type {any} */ r) =>
        r.classList.contains("zc-menu-label") ? `[${r.textContent}]` : r.classList.contains("zc-menu-sep") ? "—" : `${r.querySelector(".zc-menu-text").textContent}${r.getAttribute("aria-checked") === "true" ? " ✓" : ""}`);
      return out;
    };
    /** @param {string} words */
    const pick = (words) => menuEl().querySelectorAll(".zc-menu-item").find((/** @type {any} */ r) => r.querySelector(".zc-menu-text").textContent === words).dispatch("click");
    return { rows, pick };
  };

  // (fails before: yes — the menu offered the file manager of the machine Filament runs on, and every editor on a path of its)
  test("the header's Open in on another machine's page: no file manager; the editors over SSH where there is an alias; Copy path always", async () => {
    setRemotePage(true);
    const away = header("/home/me/app");
    assert.deepEqual(away.rows(), ["Copy path"]);
    away.pick("Copy path");
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(copied.splice(0), ["/home/me/app"]);
    doc.document.body.replaceChildren();
    at("?ssh=devbox");
    const ssh = header("/home/me/app");
    assert.deepEqual(ssh.rows(), ["[Open in]", "VS Code ✓", "Cursor", "—", "Copy path"]);
    ssh.pick("Cursor");
    assert.deepEqual(went, ["cursor://vscode-remote/ssh-remote+devbox/home/me/app"]);
    doc.document.body.replaceChildren();
    atHome();
    assert.deepEqual(header("/home/me/app").rows(), ["[Open in]", "VS Code", "Cursor ✓", "JetBrains", "—", "Open in file manager", "Copy path"], "this computer's page, as before");
  });

  // (fails before: yes — the row's button and its menu showed the file in the folder of the machine Filament runs on)
  test("an Outputs row on another machine's page: its button copies the path, and its menu holds no Show in folder", async () => {
    setRemotePage(true);
    const file = { path: "/tmp/run/chart.svg", name: "chart.svg", folder: "/tmp/run", size: 120, mtimeMs: Date.now(), agent: "", turn: 1, ignoredIn: null };
    serve = (u) => (u === "/api/memory/sessions/c1/outputs" ? { chainId: "c1", files: [file], gone: [], errors: [] } : undefined);
    const body = /** @type {any} */ (h("div", { class: "pane-body" }));
    doc.document.body.append(body);
    /** @type {string[]} */
    const revealed = [];
    /** @type {[string, string | undefined][]} */
    const toasts = [];
    renderOutputs(body, { chat: { chainId: "c1", turns: [{ n: 1, runId: "r1", status: "done" }], live: null }, setBadge: () => {}, openFileTab: () => {}, subagents: () => [], reveal: (p) => void revealed.push(p), toast: (m, k) => void toasts.push([m, k]) });
    await until(() => body.querySelector(".out-row"), "the row");
    const [show, more] = body.querySelectorAll(".out-btn");
    assert.equal(show.getAttribute("aria-label"), "Copy path");
    show.dispatch("click");
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual([copied.splice(0), revealed], [[file.path], []]);
    // (fails before: yes — the hunt of p4-local-only: it copied unsaid, and a refused copy said nothing)
    assert.deepEqual(toasts.splice(0), [["Copied", undefined]]);
    const writeText = g.navigator.clipboard.writeText;
    g.navigator.clipboard.writeText = () => Promise.reject(new Error("denied"));
    try {
      show.dispatch("click");
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      g.navigator.clipboard.writeText = writeText;
    }
    assert.deepEqual(toasts.splice(0), [["Copy failed", "err"]]);
    assert.match(readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8"), /reveal: \(\/\*\* @type \{string\} \*\/ path\) => revealFile\(path\),\s+toast: \(\/\*\* @type \{string\} \*\/ msg, \/\*\* @type \{string\} \*\/ kind\) => toast\(msg, kind\),/, "the page's toast");
    more.dispatch("click", { stopPropagation() {}, currentTarget: more });
    const items = /** @type {any[]} */ (doc.document.body.querySelector(".zc-menu").querySelectorAll(".zc-menu-text")).map((x) => x.textContent);
    assert.deepEqual(items, ["Open beside the chat", "Copy path"], "nothing opens the file manager there, nor an editor with no alias");
  });

  // (fails before: yes — the viewer kept its own editor list, which knew no other machine, and sent a Windows path's
  // backslashes into the address)
  test("the code viewer's Open follows the header's editor; on another machine's page with no alias it has none", async () => {
    serve = (u) => (u.startsWith("/api/files/read") ? { kind: "text", content: "x\n" } : undefined);
    chooseEditor("vscode");
    const viewer = /** @type {any} */ (h("div"));
    doc.document.body.append(viewer);
    renderCodeViewer(viewer, { path: "src/a.js", cwd: "H:\\p" });
    const open = /** @type {any[]} */ (viewer.querySelectorAll(".code-crumb button")).find((b) => b.textContent === "Open");
    assert.equal(open?.getAttribute("title"), "Open in VS Code");
    open.dispatch("click");
    assert.deepEqual(went.splice(0), ["vscode://file/H%3A/p/src/a.js"]);
    setRemotePage(true);
    const away = /** @type {any} */ (h("div"));
    doc.document.body.append(away);
    renderCodeViewer(away, { path: "src/a.js", cwd: "/srv/p" });
    assert.deepEqual(/** @type {any[]} */ (away.querySelectorAll(".code-crumb button")).filter((b) => b.textContent === "Open"), []);
  });

  // (fails before: yes — Change… and Add folder… asked the dialog alone: on another machine's page, and on a server not on
  // Windows, they showed nothing)
  test("New Space on another machine's page: Change… and Add folder… list the server's folders, and the folder chosen is the one made", async () => {
    setRemotePage(true);
    serve = (u, method) => {
      if (u === "/api/spaces/own" && method === "GET") return { folder: "/home/me/Filament Spaces", limits: "" };
      if (u === "/api/spaces/own" && method === "POST") return { project: "p9", name: "Notes", folder: "/home", at: 1, reach: "these", folders: ["/home/me"], shows: [] };
      return DIRS[u];
    };
    newSpaceSheet({});
    const el = /** @type {any} */ (doc.document.body.querySelector(".nsp-sheet"));
    el.querySelector(".nsp-name").value = "Notes";
    el.querySelector(".nsp-more-go").dispatch("click");
    el.querySelector(".nsp-change").dispatch("click");
    const [pickList, addList] = el.querySelectorAll(".browse-dirs");
    await until(() => rowsIn(pickList).length, "the roots");
    assert.equal(pickList.querySelector(".browse-at").textContent, "Choose a folder");
    press(pickList, "home");
    await until(() => rowsIn(pickList).includes("me"), "its folders");
    press(pickList, "Use this folder");
    assert.equal(el.querySelector(".nsp-folder").textContent, "Its files and notes go in /home.");
    assert.equal(pickList.classList.contains("hidden"), true, "the list folds once a folder is taken");
    el.querySelector('input[value="these"]').dispatch("change");
    press(el, "Add folder…");
    await until(() => rowsIn(addList).length, "the roots");
    press(addList, "home");
    await until(() => rowsIn(addList).includes("me"), "its folders");
    press(addList, "me");
    await until(() => addList.querySelector(".browse-at").textContent.startsWith("/home/me"), "the folder it stands in");
    press(addList, "Add this folder");
    assert.equal(el.querySelector(".nsp-these").value, "/home/me");
    el.querySelector(".nsp-go").dispatch("click");
    await until(() => posted.some((p) => p.url === "/api/spaces/own"), "made");
    assert.deepEqual(posted.find((p) => p.url === "/api/spaces/own")?.body, { name: "Notes", folder: "/home", reach: "these", folders: ["/home/me"] });
    assert.equal(dialogAsked(), 0);
  });

  // (fails before: yes — the hunt of p4-local-only: a listing refused took Up and Use this folder away, and the hidden
  // input kept the folder refused, so Change… asked it again: the sheet had to be closed)
  test("New Space's Change…: a folder the server will not list says so under the last one listed, its Up and Use this folder kept", async () => {
    setRemotePage(true);
    serve = (u, method) => {
      if (u === "/api/spaces/own" && method === "GET") return { folder: "/home/me/Filament Spaces", limits: "" };
      if (u === "/api/files/dirs?path=%2Fhome%2Fme") return new Refusal(403, { error: "/home/me is outside the folders this Filament may read" });
      return DIRS[u];
    };
    newSpaceSheet({});
    const el = /** @type {any} */ (doc.document.body.querySelector(".nsp-sheet"));
    el.querySelector(".nsp-more-go").dispatch("click");
    el.querySelector(".nsp-change").dispatch("click");
    const [pickList] = el.querySelectorAll(".browse-dirs");
    await until(() => rowsIn(pickList).length, "the roots");
    press(pickList, "home");
    await until(() => rowsIn(pickList).includes("me"), "its folders");
    press(pickList, "me");
    await until(() => pickList.querySelector(".browse-refused"), "the refusal");
    assert.match(pickList.querySelector(".browse-refused").textContent, /outside the folders this Filament may read/);
    assert.equal(pickList.querySelector(".browse-at").textContent.startsWith("/home"), true, "it stands where it last listed");
    assert.deepEqual(rowsIn(pickList), ["↑ up", "me"], "Up and the folders kept");
    press(pickList, "Use this folder");
    assert.equal(el.querySelector(".nsp-folder").textContent, "Its files and notes go in /home.");
    el.querySelector(".nsp-change").dispatch("click");
    await until(() => pickList.querySelector(".browse-refused") === null, "a listing that came says nothing of the last refusal");
    assert.equal(asked.filter((a) => a.startsWith("GET /api/files/dirs")).at(-1), "GET /api/files/dirs?path=%2Fhome", "Change… again lists the folder kept, not the one refused");
    assert.deepEqual(rowsIn(pickList), ["↑ up", "me"]);
  });

  // (fails before: yes — Open folder…'s Browse… asked the dialog alone: nothing showed where it could not open)
  test("Open folder… in a new chat's chooser: Browse… lists the folders in its dialog, and Open takes the one picked", async () => {
    setRemotePage(true);
    serve = (u, method) => (u === "/api/memory/projects/of" ? { projects: [] } : u === "/api/files/exists" ? { ok: [] } : method === "GET" ? DIRS[u] : undefined);
    /** @type {string[]} */
    const set = [];
    const empty = createEmptyState({ getFolder: () => "", setFolder: (p) => void set.push(p), onToast: () => {} });
    doc.document.body.append(empty.el);
    await /** @type {any} */ (empty.el).querySelector(".chooser-chip").onclick({ stopPropagation() {} });
    const open = /** @type {any[]} */ (doc.document.body.querySelector(".zc-menu").querySelectorAll(".zc-menu-item")).find((r) => r.querySelector(".zc-menu-text").textContent === "Open folder…");
    open.dispatch("click");
    const dlg = /** @type {any} */ (doc.document.body.querySelector(".zc-dialog"));
    press(dlg, "Browse…");
    const list = dlg.querySelector(".browse-dirs");
    await until(() => rowsIn(list).length, "the roots");
    press(list, "home");
    await until(() => rowsIn(list).includes("me"), "its folders");
    press(dlg, "Open");
    assert.deepEqual([set, dialogAsked()], [["/home"], 0]);
  });

  // (fails before: yes — the project folder's Browse… asked the dialog alone, and the page never heard where it stood)
  test("the chat's project folder: Browse… is the same act, with its list in the dialog; the page hears where it stands from /api/state", () => {
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    const from = app.indexOf("function pickProjectFolder()");
    const pick = app.slice(from, app.indexOf("\n}\n", from));
    assert.match(pick, /const dirs = h\("div", \{ class: "browse-dirs hidden" \}\);/);
    assert.match(pick, /browse\.addEventListener\("click", \(\) => void browseFolder\(input, dirs, \(m\) => toast\(m, "err"\)\)\);/);
    assert.match(pick, /body: h\("div", \{ class: "flex flex-col gap-2" \}, input, browse, dirs, recent\)/);
    assert.match(app, /setRemotePage\(st\.viewer === "remote"\);/);
  });
});

// (fails before: yes — four Browse… presses asked the dialog alone, and the code viewer kept its own list of editors)
test("every Browse… goes through browseFolder, and one list of editors is kept", () => {
  const read = (/** @type {string} */ f) => readFileSync(new URL(`../src/ui/harness/${f}`, import.meta.url), "utf8");
  for (const f of ["app.js", "conversation/empty.js", "space/new-space.js", "library/skills.js", "settings/permissions.js"])
    assert.doesNotMatch(read(f), /pickFolderNative/, `${f} asks the dialog alone`);
  assert.doesNotMatch(read("panes/code-viewer.js"), /const EDITORS|vscode:\/\//, "the code viewer's own list");
});

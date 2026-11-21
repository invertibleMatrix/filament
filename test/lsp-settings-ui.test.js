// @ts-check
// Settings › Language servers (the owner's LSP of 11-04): the servers a place's chats have — the ones Filament knows,
// whether each is installed here and how to install it, a plugin's, yours —, a switch each, a form for one of your own,
// and each change said in words. The page runs on the fake DOM over a stand-in of the settings routes that keeps your
// defaults and one project's layer, and over the real route that says the servers (http/admin/lsp.js) over the same
// layers, a program found where the test's PATH has it.
// (fails before: yes — Settings had no page for language servers, Filament no route that said them, and a change to
// lsp.servers read as its JSON: `servers: [{"name":"pyright","enabled":false}]`)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { removeDirs } from "./helpers/wait.js";
import { flattenLayer, nestLayer } from "../src/ui/lib/settings/editor.js";
import { mergeLspServers, resolveSettings, settingsChangeCard } from "../src/services/session-settings.js";
import { lspRoutes } from "../src/http/admin/lsp.js";
import { createRouter } from "../src/http/router.js";
import { renderLanguageServers, SEARCH_ROWS } from "../src/ui/harness/settings/language-servers.js";
import { PAGE_ROWS, SECTIONS } from "../src/ui/harness/settings/page.js";
import { findHits, staticHits } from "../src/ui/harness/settings/search.js";
import { settingChangeWords, settingsRowWords } from "../src/ui/harness/lib/labels.js";

const flush = () => new Promise((r) => setTimeout(r, 0));
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** A folder of the test's own: `bin`, where a program is found, and `appdata`, npm's, empty. @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-lsp-ui-${tag}-`));
  made.push(d);
  mkdirSync(join(d, "bin"));
  mkdirSync(join(d, "appdata"));
  return d;
};
/**
 * The PATH and npm's folder for one test, put back after it: pyright's program is on it, as a shell finds one here.
 * @param {import("node:test").TestContext} t @param {string} dir
 */
const onPath = (t, dir, { pyright = true } = {}) => {
  if (pyright) for (const f of ["pyright-langserver", "pyright-langserver.cmd"]) writeFileSync(join(dir, "bin", f), "");
  const was = { PATH: process.env.PATH, APPDATA: process.env.APPDATA };
  process.env.PATH = join(dir, "bin");
  process.env.APPDATA = join(dir, "appdata");
  t.after(() => {
    process.env.PATH = was.PATH;
    process.env.APPDATA = was.APPDATA;
  });
};

class FakeRes {
  status = 0;
  body = "";
  headersSent = false;
  writableEnded = false;
  /** @param {number} s */
  writeHead(s) {
    this.status = s;
    this.headersSent = true;
    return this;
  }
  end(c = "") {
    this.body += c;
    this.writableEnded = true;
  }
}

/** The route's answer to `path` over the admin context `a`. @param {any} a @param {string} path */
async function ask(a, path) {
  const url = new URL(`http://127.0.0.1/api${path}`);
  const m = createRouter(lspRoutes(a))("GET", url.pathname.replace(/^\/api/, ""));
  assert.ok(m, `a row for ${path}`);
  const res = new FakeRes();
  await m.handler({ req: { headers: {}, method: "GET" }, res, url, path: url.pathname, method: "GET", params: m.params, json: async () => ({}) }, a);
  return { status: res.status, body: JSON.parse(res.body || "null"), text: res.body };
}

/** A plugin's server as app/plugins.js fills one: its values in its arguments and environment. */
const ACME = Object.freeze({ name: "acme-ls", command: process.execPath, args: ["--token", "s3cret"], env: { ACME_TOKEN: "s3cret" }, languages: { ".acme": "acme" }, plugin: "acme@market" });

/**
 * Your defaults and one project's layer (`lsp.servers` of each), the admin context the route reads them through, and a
 * stand-in of the settings routes answering as they do. `refuse(path, body)` returns a refusal's words, or nothing.
 * @param {{ yours?: any[], project?: any[], plugins?: any[], cwd?: string, refuse?: (path: string, body: any) => string | void }} [o]
 */
function server(o = {}) {
  /** @type {[string, string, any][]} */
  const calls = [];
  /** @type {{ all: Record<string, any>, p1: Record<string, any> }} */
  const own = { all: o.yours ? { "lsp.servers": o.yours } : {}, p1: o.project ? { "lsp.servers": o.project } : {} };
  /** Where the plugins were asked what they bring. @type {any[]} */
  const where = [];
  const a = {
    sessions: {
      defaultsOf: () => ({ effective: resolveSettings({ global: nestLayer(own.all) }).effective }),
      projectSettingsOf: (/** @type {string} */ id) => {
        if (id !== "p1") throw Object.assign(new Error("no such project"), { status: 404 });
        return { cwd: o.cwd || tmpdir(), resolved: { effective: resolveSettings({ global: nestLayer(own.all), project: nestLayer(own.p1) }).effective } };
      },
    },
    plugins: {
      into: (/** @type {any} */ doc, /** @type {any} */ w) => {
        where.push(w);
        return o.plugins?.length ? { ...doc, lsp: { ...doc.lsp, plugins: o.plugins } } : doc;
      },
    },
  };
  const merged = (/** @type {Record<string, any>[]} */ ...layers) => mergeLspServers(layers.map((l) => l["lsp.servers"]));
  const allDoc = () => ({ layer: nestLayer(own.all), flat: { "lsp.servers": merged(own.all) }, sources: { "lsp.servers": "lsp.servers" in own.all ? "yours" : "default" }, preset: null });
  const projectDoc = () => ({
    projectId: "p1", name: "filament", layer: nestLayer(own.p1),
    resolved: { flat: { "lsp.servers": merged(own.all, own.p1) }, sources: { "lsp.servers": "lsp.servers" in own.p1 ? "project" : "lsp.servers" in own.all ? "global" : "default" }, layers: { global: nestLayer(own.all) } },
    knobs: { "lsp.servers": {} },
  });
  /** @param {Record<string, any>} into @param {any} body */
  const apply = (into, body) => {
    const paths = [];
    for (const [k, v] of Object.entries(flattenLayer(body.patch || {}))) { into[k] = v; paths.push(k); }
    for (const k of body.unset || []) { delete into[k]; paths.push(k); }
    return paths.map((path) => ({ path }));
  };
  const api = async (/** @type {string} */ path, /** @type {any} */ req = {}) => {
    const method = req.method || "GET";
    calls.push([path, method, req.body]);
    const no = o.refuse?.(path, req.body);
    if (no) throw new Error(no);
    if (path === "/defaults/settings") {
      if (method === "GET") return allDoc();
      // Written, then your defaults as they now stand, as the route answers.
      const changes = apply(own.all, req.body);
      return { ...allDoc(), changes };
    }
    if (path === "/projects/p1/settings") return method === "GET" ? projectDoc() : { ok: true, changes: apply(own.p1, req.body) };
    if (path === "/memory/projects") return { projects: [{ id: "p1", name: "filament", cwd: "H:/filament" }] };
    if (path.startsWith("/lsp/servers")) {
      const r = await ask(a, path);
      if (r.status !== 200) throw new Error(r.body?.error || `HTTP ${r.status}`);
      return r.body;
    }
    throw new Error(`no route ${method} ${path}`);
  };
  return { a, api, calls, own, where, writes: () => calls.filter(([, m]) => m !== "GET") };
}

/** Every node under `el` matching. @param {any} el @param {(n: any) => boolean} ok @returns {any[]} */
const find = (el, ok) => {
  /** @type {any[]} */
  const out = [];
  /** @param {any} n */
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (ok(n)) out.push(n);
    for (const k of n.kids || []) walk(k);
  };
  walk(el);
  return out;
};
/** @param {any} el @param {string} cls */
const all = (el, cls) => find(el, (n) => String(n.attrs?.class || "").split(/\s+/).includes(cls));
/** @param {any} el @param {string} words */
const button = (el, words) => {
  const b = find(el, (n) => n.tag === "button" && textOf(n) === words)[0];
  assert.ok(b, `no button "${words}" in ${textOf(el)}`);
  return b;
};
/** The control of that label: a field, a switch, a remove. @param {any} el @param {string} label */
const labelled = (el, label) => {
  const f = find(el, (n) => n.attrs?.["aria-label"] === label)[0];
  assert.ok(f, `nothing labelled "${label}" in ${textOf(el)}`);
  return f;
};
/** Each server's row, by its name, as it reads. @param {any} body */
const rows = (body) => Object.fromEntries(all(body, "nset-item").map((n) => [n.attrs["data-lsp"], textOf(n)]));
/** @param {any} body */
const names = (body) => all(body, "nset-item").map((n) => n.attrs["data-lsp"]);

/** The page mounted, with its toasts, and "A project ▾" picked when asked. */
async function mount(/** @type {ReturnType<typeof server>} */ srv, { project = false } = {}) {
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  /** @type {any[]} */
  const menus = [];
  const body = /** @type {any} */ (fakeH("div", {}));
  renderLanguageServers(body, { onToast: (msg, kind) => toasts.push([msg, kind || undefined]) },
    { h: fakeH, api: srv.api, menu: (/** @type {any[]} */ items) => { menus.push(items); return { el: fakeH("div"), close() {} }; } });
  await flush();
  if (project) {
    button(body, "A project ▾").dispatch("click");
    await flush();
    menus.at(-1).find((/** @type {any} */ i) => i.label === "filament").onClick();
    await flush();
    await flush();
  }
  return { body, toasts };
}

/** A press, and the page drawn again after it. @param {any} el */
const press = async (el) => {
  el.dispatch("click");
  await flush();
  await flush();
};

const YOURS_TOAST = "every chat that has not chosen its own takes it from its next request";

describe("a change to lsp.servers, in words", () => {
  // (fails before: yes — it read as `servers: [{"name":"pyright","enabled":false}]`)
  test("where the list before is known (a chat's card, the row between turns): what moved, by each server's name", () => {
    const W = (/** @type {any} */ to, /** @type {any} */ from) => settingChangeWords("lsp.servers", to, from);
    const zls = { name: "zls", command: "zls", extensionToLanguage: { ".zig": "zig" }, enabled: true };
    assert.equal(W([{ name: "pyright", enabled: false }], []), "Language server pyright off");
    assert.equal(W([{ name: "pyright", enabled: true }], [{ name: "pyright", enabled: false }]), "Language server pyright on");
    assert.equal(W([], [{ name: "pyright", enabled: false }]), "Language server pyright: inherits again");
    assert.equal(W([zls], []), "Language server zls added");
    assert.equal(W([{ ...zls, enabled: false }], []), "Language server zls added, off");
    assert.equal(W([], [zls]), "Language server zls removed");
    assert.equal(W([{ ...zls, args: ["--stdio"] }], [zls]), "Language server zls changed");
    assert.equal(W([{ ...zls, args: ["--stdio"], enabled: false }], [zls]), "Language server zls changed, off");
    assert.equal(W([{ ...zls, enabled: false }], [zls]), "Language server zls off");
    // One of yours where a switch of Filament's own stood, and the way back.
    const deno = { name: "typescript", command: "deno", args: ["lsp"], extensionToLanguage: { ".ts": "typescript" }, enabled: true };
    assert.equal(W([deno], [{ name: "typescript", enabled: false }]), "Language server typescript added");
    assert.equal(W([{ name: "typescript", enabled: false }], [deno]), "Language server typescript removed");
    assert.equal(W([{ name: "pyright", enabled: false }, zls], [zls, { name: "pylsp", enabled: false }]), "Language server pyright off · Language server pylsp: inherits again");
    assert.equal(W(undefined, [zls]), "Language servers: inherits again");
    assert.deepEqual(settingsRowWords({ changes: [{ path: "lsp.servers", from: [], to: [{ name: "pyright", enabled: false }] }] }, false), ["Language server pyright off"]);
  });

  // The settings-change card lands in the chat's transcript, which memory keeps: a server's options can hold a token, as
  // an MCP server's environment can, and theirs ride it as the placeholder (HS-D8).
  // (fails before: yes — the card carried the options whole, and Undo would have written them back as they read)
  test("the change's card in the transcript: a credential in a server's options or settings is the placeholder, and no Undo writes it", () => {
    const doc = (/** @type {any} */ flat) => ({ flat, sources: { "lsp.servers": "session" }, layer: {}, presetName: null, presetDoc: null });
    const own = { name: "zls", command: "zls", extensionToLanguage: { ".zig": "zig" }, initializationOptions: { apiToken: "s3cr3t", nested: { password: "hunter2", depth: 2 }, plain: "x" }, settings: { zls: { authKey: "k-1" } } };
    const masked = { ...own, initializationOptions: { apiToken: "__SECRET__", nested: { password: "__SECRET__", depth: 2 }, plain: "x" }, settings: { zls: { authKey: "__SECRET__" } } };
    const added = settingsChangeCard(doc({ "lsp.servers": [] }), doc({ "lsp.servers": [own] }), { changes: [{ path: "lsp.servers" }] });
    assert.deepEqual(added.changes[0].to, [masked]);
    assert.deepEqual(added.actions, [{ label: "Undo", command: "/set lsp.servers []" }], "the value before hid nothing: its Undo stands");
    const off = settingsChangeCard(doc({ "lsp.servers": [own] }), doc({ "lsp.servers": [{ ...own, enabled: false }] }), { changes: [{ path: "lsp.servers" }] });
    assert.deepEqual([off.changes[0].from, off.changes[0].to], [[masked], [{ ...masked, enabled: false }]]);
    for (const card of [added, off]) assert.ok(!/s3cr3t|hunter2|k-1/.test(JSON.stringify(card)), JSON.stringify(card));
    assert.equal(off.actions, undefined, "its Undo would write the placeholder back");
  });

  test("where only the list now is known (a place's toast, a preset's line): the list as it stands", () => {
    const W = (/** @type {any} */ to) => settingChangeWords("lsp.servers", to);
    assert.equal(W([{ name: "pyright", enabled: false }]), "Language servers off: pyright");
    const zls = { name: "zls", command: "zls", extensionToLanguage: { ".zig": "zig" }, enabled: true };
    assert.equal(W([zls, { ...zls, name: "deno", enabled: false }, { name: "pylsp", enabled: false }, { name: "gopls", enabled: true }]), "Your language servers: zls, deno (off) · Language servers on: gopls · Language servers off: pylsp");
    assert.equal(W([]), "Language servers: none of your own, none switched off");
    assert.equal(W(undefined), "Language servers: inherits again");
  });
});

describe("what Filament says of a place's servers (GET /api/lsp/servers)", () => {
  // (fails before: yes — no route said them)
  test("in the order a file picks — yours, the plugins' on there, Filament's own —, each with what it runs, its files, whether it is on there and installed here; a plugin's arguments and environment unsaid", async (t) => {
    const dir = fresh("route");
    onPath(t, dir, { pyright: false });
    const srv = server({
      yours: [{ name: "pyright", enabled: false }, { name: "mine", command: process.execPath, args: ["--stdio"], extensionToLanguage: { ".mine": "mine" } }, { name: "gone", command: join(dir, "no-such-ls.exe"), extensionToLanguage: { ".gone": "gone" }, enabled: false }],
      plugins: [ACME],
      cwd: dir,
    });
    const r = await ask(srv.a, "/lsp/servers");
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.servers.map((/** @type {any} */ s) => [s.name, s.from, s.on, s.found]), [
      ["mine", "yours", true, true], ["gone", "yours", false, false], ["acme-ls", "plugin", true, true],
      ["typescript", "filament", true, false], ["pyright", "filament", false, false], ["pylsp", "filament", true, false],
      ["gopls", "filament", true, false], ["rust-analyzer", "filament", true, false], ["clangd", "filament", true, false],
    ]);
    assert.deepEqual(r.body.servers[0], { name: "mine", from: "yours", command: process.execPath, args: ["--stdio"], files: [".mine"], on: true, found: true });
    assert.deepEqual(r.body.servers[2], { name: "acme-ls", from: "plugin", plugin: "acme@market", command: process.execPath, files: [".acme"], on: true, found: true });
    assert.doesNotMatch(r.text, /s3cret/, "a plugin's values stay unsaid");
    assert.deepEqual(r.body.servers[3], { name: "typescript", from: "filament", command: "typescript-language-server", args: ["--stdio"], files: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"], on: true, found: false, install: "npm install -g typescript-language-server typescript" });
    assert.deepEqual(srv.where, [{ project: null, cwd: "" }], "your defaults' plugins, in no folder");
    // A project's: its own layer over yours, and its plugins asked in its folder.
    srv.own.p1["lsp.servers"] = [{ name: "pyright", enabled: true }, { name: "mine", enabled: false }];
    const p = await ask(srv.a, "/lsp/servers?project=p1");
    assert.deepEqual(p.body.servers.filter((/** @type {any} */ s) => s.name === "pyright" || s.name === "mine").map((/** @type {any} */ s) => [s.name, s.on]), [["mine", false], ["pyright", true]]);
    assert.deepEqual(srv.where.at(-1), { project: "p1", cwd: dir });
    // Installed since: found at the next ask.
    writeFileSync(join(dir, "bin", "pyright-langserver"), "");
    writeFileSync(join(dir, "bin", "pyright-langserver.cmd"), "");
    assert.equal((await ask(srv.a, "/lsp/servers?project=p1")).body.servers.find((/** @type {any} */ s) => s.name === "pyright").found, true);
    assert.deepEqual([(await ask(srv.a, "/lsp/servers?project=nope")).status, (await ask(srv.a, "/lsp/servers?project=nope")).body], [404, { error: "no such project" }]);
    assert.equal((await ask({}, "/lsp/servers")).status, 503, "no archive, said");
  });
});

describe("Settings › Language servers", () => {
  // (fails before: yes — Settings had no page for them)
  test("over all chats: every server in the order a file picks, whose each is, what it runs for which files, whether it is installed here — with how, where Filament knows —, and its switch; a switch writes your default and says so in words, and on again takes it away", async (t) => {
    const dir = fresh("all");
    onPath(t, dir);
    const srv = server({ plugins: [ACME] });
    const { body, toasts } = await mount(srv);
    assert.match(textOf(body), /^Applies to\|All chats\|A project ▾\|Every chat that has not chosen its own\./);
    assert.deepEqual(all(body, "settings-row-label").map((n) => textOf(n)), ["Which serves a file", "Add a server of your own"]);
    assert.deepEqual(names(body), ["acme-ls", "typescript", "pyright", "pylsp", "gopls", "rust-analyzer", "clangd"]);
    const said = rows(body);
    assert.equal(said.typescript, "typescript|Filament's|typescript-language-server --stdio| · .ts .tsx .mts .cts .js .jsx .mjs .cjs|✗ Not installed on this computer|: |npm install -g typescript-language-server typescript");
    assert.equal(said.pyright, "pyright|Filament's|pyright-langserver --stdio| · .py .pyi|✓ Installed on this computer");
    assert.equal(said["acme-ls"], `acme-ls|Plugin acme|${process.execPath}| · .acme|✓ Installed on this computer`, "a plugin's program, nothing of its values");
    assert.equal(said.clangd, "clangd|Filament's|clangd| · .c .h .cpp .cc .cxx .hpp .hh .hxx|✗ Not installed on this computer|: |clangd from LLVM, or your package manager's");
    assert.deepEqual(names(body).map((n) => labelled(body, n).attrs["aria-checked"]), ["true", "true", "true", "true", "true", "true", "true"]);
    await press(labelled(body, "pyright"));
    assert.deepEqual(srv.writes().at(-1), ["/defaults/settings", "PATCH", { patch: { lsp: { servers: [{ name: "pyright", enabled: false }] } } }]);
    assert.deepEqual(toasts.at(-1), [`Your default changed: Language servers off: pyright — ${YOURS_TOAST}`, undefined]);
    assert.equal(rows(body).pyright, "pyright|Filament's|All chats|pyright-langserver --stdio| · .py .pyi|✓ Installed on this computer", "set for all chats");
    assert.equal(labelled(body, "pyright").attrs["aria-checked"], "false");
    // A plugin's, switched off by the name its row gives it.
    await press(labelled(body, "acme-ls"));
    assert.deepEqual(srv.own.all["lsp.servers"], [{ name: "pyright", enabled: false }, { name: "acme-ls", enabled: false }]);
    assert.deepEqual(toasts.at(-1)?.[0], `Your default changed: Language servers off: pyright, acme-ls — ${YOURS_TOAST}`);
    await press(labelled(body, "pyright"));
    assert.deepEqual(srv.own.all["lsp.servers"], [{ name: "acme-ls", enabled: false }], "on again: its switch taken away, as all chats would have it without one");
    await press(labelled(body, "acme-ls"));
    assert.deepEqual(srv.writes().at(-1), ["/defaults/settings", "PATCH", { unset: ["lsp.servers"] }], "the last taken away unsets the list");
    assert.deepEqual(toasts.at(-1)?.[0], `Your default changed: Language servers: inherits again — ${YOURS_TOAST}`);
    assert.deepEqual(names(body).map((n) => labelled(body, n).attrs["aria-checked"]), ["true", "true", "true", "true", "true", "true", "true"]);
  });

  // (fails before: yes)
  test("a server of your own: its name, its program, its arguments, its files; what it lacks said on the page, a refusal in Filament's words with the text kept; taken in, it leads the list, switched and removed there; named as Filament's own, it takes its place", async (t) => {
    const dir = fresh("own");
    onPath(t, dir);
    const srv = server({ refuse: (path, b) => (path === "/defaults/settings" && b?.patch?.lsp?.servers?.some((/** @type {any} */ e) => e.name === "Zls") ? '"lsp.servers[0]" needs a name: a-z, 0-9, -, up to 32 characters' : undefined) });
    const { body, toasts } = await mount(srv);
    /** @param {Record<string, string>} v */
    const type = (v) => { for (const [label, text] of Object.entries(v)) labelled(body, label).value = text; };
    type({ "Its name": "zls", "The program it runs": "zls", "The files it serves": "" });
    await press(button(body, "Add"));
    assert.deepEqual(toasts.at(-1), ["A server of your own needs its name, the program it runs and the files it serves: each extension with its language id, as .zig zig", "err"]);
    assert.equal(srv.writes().length, 0);
    type({ "Its name": "Zls", "The program it runs": "zls", "The files it serves": ".zig zig, .zon=zig" });
    await press(button(body, "Add"));
    assert.deepEqual(toasts.at(-1), ['"lsp.servers[0]" needs a name: a-z, 0-9, -, up to 32 characters', "err"]);
    assert.deepEqual(["Its name", "The program it runs", "The files it serves"].map((l) => labelled(body, l).value), ["Zls", "zls", ".zig zig, .zon=zig"], "drawn again, the text stays to be put right");
    labelled(body, "Its name").value = "zls";
    const enter = labelled(body, "The files it serves");
    enter.onkeydown({ key: "Enter", preventDefault() {} });
    await flush();
    await flush();
    assert.deepEqual(srv.writes().at(-1), ["/defaults/settings", "PATCH", { patch: { lsp: { servers: [{ name: "zls", command: "zls", extensionToLanguage: { ".zig": "zig", ".zon": "zig" } }] } } }]);
    assert.deepEqual(toasts.at(-1), [`Your default changed: Your language servers: zls — ${YOURS_TOAST}`, undefined]);
    assert.equal(names(body)[0], "zls", "yours first: a file picks it before the rest");
    assert.equal(rows(body).zls, "zls|Yours|All chats|zls| · .zig .zon|✗ Not installed on this computer");
    assert.deepEqual(["Its name", "The program it runs", "Its arguments", "The files it serves"].map((l) => labelled(body, l).value), ["", "", "", ""], "taken: the form is empty again");
    await press(labelled(body, "zls"));
    assert.deepEqual(srv.own.all["lsp.servers"], [{ name: "zls", command: "zls", extensionToLanguage: { ".zig": "zig", ".zon": "zig" }, enabled: false }]);
    assert.equal(toasts.at(-1)?.[0], `Your default changed: Your language servers: zls (off) — ${YOURS_TOAST}`);
    await press(labelled(body, "zls"));
    assert.deepEqual(srv.own.all["lsp.servers"], [{ name: "zls", command: "zls", extensionToLanguage: { ".zig": "zig", ".zon": "zig" } }], "on: as it was written");
    type({ "Its name": "zls", "The program it runs": "zls2", "The files it serves": ".zig zig" });
    const n = srv.writes().length;
    await press(button(body, "Add"));
    assert.deepEqual([srv.writes().length, toasts.at(-1)], [n, ["zls is one of yours here already: remove it first", "err"]]);
    await press(labelled(body, "Remove zls"));
    assert.deepEqual(srv.writes().at(-1), ["/defaults/settings", "PATCH", { unset: ["lsp.servers"] }]);
    assert.ok(!names(body).includes("zls"));
    // Named as one of Filament's own: yours takes its place, with its arguments.
    type({ "Its name": "typescript", "The program it runs": process.execPath, "Its arguments": "lsp  --quiet", "The files it serves": ".ts typescript" });
    await press(button(body, "Add"));
    assert.deepEqual(srv.own.all["lsp.servers"], [{ name: "typescript", command: process.execPath, args: ["lsp", "--quiet"], extensionToLanguage: { ".ts": "typescript" } }]);
    assert.deepEqual(names(body), ["typescript", "pyright", "pylsp", "gopls", "rust-analyzer", "clangd"]);
    assert.equal(rows(body).typescript, `typescript|Yours|All chats|${process.execPath} lsp --quiet| · .ts|✓ Installed on this computer`);
  });

  // (fails before: yes)
  test("under a project: all chats' switches and servers said as theirs, without a remove; a switch here written to the project, none where it would say what all chats say; its servers read for the project", async (t) => {
    const dir = fresh("project");
    onPath(t, dir);
    const srv = server({ yours: [{ name: "pyright", enabled: false }, { name: "mine", command: process.execPath, extensionToLanguage: { ".mine": "mine" } }], plugins: [ACME], cwd: dir });
    const { body, toasts } = await mount(srv, { project: true });
    assert.match(textOf(body), /\|filament ▾\|Chats in filament take these over yours; its servers add to yours\./);
    assert.ok(srv.calls.some(([path]) => path === "/lsp/servers?project=p1"), "read for the project");
    assert.deepEqual(srv.where.at(-1), { project: "p1", cwd: dir });
    assert.deepEqual(names(body), ["mine", "acme-ls", "typescript", "pyright", "pylsp", "gopls", "rust-analyzer", "clangd"]);
    assert.equal(rows(body).mine, `mine|Yours|All chats|${process.execPath}| · .mine|✓ Installed on this computer`);
    assert.equal(rows(body).pyright, "pyright|Filament's|All chats|pyright-langserver --stdio| · .py .pyi|✓ Installed on this computer");
    assert.equal(find(body, (x) => x.attrs?.["aria-label"] === "Remove mine").length, 0, "all chats' server: removed under All chats");
    assert.equal(labelled(body, "pyright").attrs["aria-checked"], "false");
    await press(labelled(body, "pyright"));
    assert.deepEqual(srv.writes().at(-1), ["/projects/p1/settings", "POST", { patch: { lsp: { servers: [{ name: "pyright", enabled: true }] } } }]);
    assert.equal(toasts.at(-1)?.[0], "Your language servers: mine · Language servers on: pyright in filament — its chats that have not chosen their own take it from their next request");
    assert.equal(rows(body).pyright, "pyright|Filament's|This project|pyright-langserver --stdio| · .py .pyi|✓ Installed on this computer");
    assert.equal(labelled(body, "pyright").attrs["aria-checked"], "true");
    await press(labelled(body, "pyright"));
    assert.deepEqual(srv.writes().at(-1), ["/projects/p1/settings", "POST", { unset: ["lsp.servers"] }], "off again, as all chats have it: the project's switch taken away");
    await press(labelled(body, "mine"));
    await press(labelled(body, "acme-ls"));
    assert.deepEqual(srv.own.p1["lsp.servers"], [{ name: "mine", enabled: false }, { name: "acme-ls", enabled: false }], "all chats' server and a plugin's, switched off for the project alone");
    assert.deepEqual(srv.own.all["lsp.servers"], [{ name: "pyright", enabled: false }, { name: "mine", command: process.execPath, extensionToLanguage: { ".mine": "mine" } }], "yours untouched");
    assert.deepEqual(["mine", "acme-ls"].map((x) => labelled(body, x).attrs["aria-checked"]), ["false", "false"]);
  });

  test("a switch of this place's for a server none here is named is listed with its remove; a read that fails is said", async (t) => {
    const dir = fresh("stray");
    onPath(t, dir);
    const srv = server({ yours: [{ name: "gone-ls", enabled: false }] });
    const { body } = await mount(srv);
    assert.equal(names(body).at(-1), "gone-ls");
    assert.equal(rows(body)["gone-ls"], "gone-ls|All chats|Switched off here, but no server here is named gone-ls: its plugin is off or gone");
    await press(labelled(body, "Remove gone-ls"));
    assert.deepEqual(srv.writes().at(-1), ["/defaults/settings", "PATCH", { unset: ["lsp.servers"] }]);
    const down = server({ refuse: (path) => (path.startsWith("/lsp/servers") ? "Filament is restarting" : undefined) });
    const { body: b2 } = await mount(down);
    assert.equal(textOf(all(b2, "set-error")[0]), "The language servers could not be read: Filament is restarting");
    assert.deepEqual(all(b2, "settings-row-label").map((n) => textOf(n)), ["Which serves a file", "Add a server of your own"], "the form stands");
  });

  test("in Settings' nav under New chats, after Instructions; its rows found by the search", () => {
    const i = SECTIONS.findIndex((s) => s.id === "language-servers");
    assert.deepEqual(SECTIONS[i], { id: "language-servers", group: "New chats", label: "Language servers", icon: "code" });
    assert.equal(SECTIONS[i - 1].id, "instructions");
    assert.equal(PAGE_ROWS["language-servers"], SEARCH_ROWS);
    const hits = staticHits(SECTIONS, {}, PAGE_ROWS);
    assert.deepEqual(findHits(hits, "pyright").map((x) => [x.label, x.where, x.go]), [["Which serves a file", "Language servers", { section: "language-servers", label: "Which serves a file" }]]);
    assert.ok(findHits(hits, "language servers").some((x) => x.label === "Language servers" && x.where === "New chats"));
  });
});

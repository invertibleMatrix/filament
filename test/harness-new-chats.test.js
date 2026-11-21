// @ts-check
// HarnessV4_Settings_Plan HS-3: the pages in Settings › New chats — Permissions, Instructions and Memory's In new chats
// — on the fake DOM over a fake server that keeps your defaults and one project's layer the way the real
// routes answer (the real routes are driven in test/at-home-defaults.test.js), and the new chat's model and mode.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { flattenLayer, nestLayer } from "../src/ui/lib/settings/editor.js";
import { renderPermissions } from "../src/ui/harness/settings/permissions.js";
import { renderInstructions } from "../src/ui/harness/settings/instructions.js";
import { renderMemoryChats } from "../src/ui/harness/settings/memory-chats.js";
import { SECTIONS } from "../src/ui/harness/settings/page.js";
import { MODES } from "../src/ui/harness/composer/mode.js";
import { state, startModel, setNewChatModelPref, rememberModel } from "../src/ui/harness/state.js";
import { MemoryBrain } from "../src/services/memory/brain.js";
import { Archive } from "../src/services/memory/archive.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Every node under `el` carrying a class. @param {any} el @param {string} cls @returns {any[]} */
const all = (el, cls) => {
  /** @type {any[]} */
  const out = [];
  /** @param {any} n */
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (String(n.attrs?.class || "").split(/\s+/).includes(cls)) out.push(n);
    for (const k of n.kids || []) walk(k);
  };
  walk(el);
  return out;
};
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
/** @param {any} el @param {string} words */
const button = (el, words) => {
  const b = find(el, (n) => n.tag === "button" && textOf(n) === words)[0];
  assert.ok(b, `no button "${words}" in ${textOf(el)}`);
  return b;
};
/** @param {any} el @param {string} label */
const field = (el, label) => {
  const f = find(el, (n) => (n.tag === "input" || n.tag === "textarea") && n.attrs["aria-label"] === label)[0];
  assert.ok(f, `no field "${label}"`);
  return f;
};
/** @param {any} el */
const labels = (el) => all(el, "settings-row-label").map((n) => textOf(n));
/** A key pressed in a field. @param {any} f @param {string} key @param {Record<string, any>} [more] */
const press = (f, key, more = {}) => f.onkeydown({ key, preventDefault() {}, ...more });

/** Filament's defaults for the knobs these pages show. */
const DEFAULTS = Object.freeze({
  "loop.permissions": "edit", "loop.learnedPermissions.enabled": true, "loop.learnedPermissions.afterApprovals": 5, "loop.addedFolders": [], "loop.rules": [], "loop.secondLook": false,
  "privacy.bashDeny": [], "privacy.redact": [], "loop.verify.afterEdits": null, "instructions.session": "", "instructions.files": ["AGENTS.md"], "instructions.userFiles": [],
  "skills.on": [], hooks: [], "plugins.web.fetch": false, "plugins.web.search": false, "plugins.browser": false,
  "memory.enabled": true, "memory.briefing": true, "memory.turnBlock": true, "memory.tools": true, "memory.learn": true, "privacy.learn": true, "privacy.index": true,
});
/** The knobs a project holds. */
const REPO = ["loop.addedFolders", "loop.rules", "loop.secondLook", "privacy.bashDeny", "privacy.redact", "loop.verify.afterEdits", "instructions.files", "skills.on", "hooks", "privacy.learn", "privacy.index"];

/**
 * A fake server over your defaults and one project's layer, answering as the routes do. `refuse(path, body)` returns
 * the words of a refusal, or nothing. The project works in `cwd`; the configuration's folders memory leaves out are
 * `excluded`, kept as `PATCH /api/config/fields` keeps them, against the version read.
 * @param {{ yours?: Record<string, any>, project?: Record<string, any>, refuse?: (path: string, body: any) => string | void, cwd?: string | null, excluded?: string[] }} [o]
 */
function server(o = {}) {
  /** @type {[string, string, any][]} */
  const calls = [];
  const own = { all: { ...(o.yours || {}) }, p1: { ...(o.project || {}) } };
  const config = { version: 4, excluded: [...(o.excluded || [])] };
  const allDoc = () => {
    const flat = { ...DEFAULTS, ...own.all };
    return { layer: nestLayer(own.all), flat, sources: Object.fromEntries(Object.keys(flat).map((k) => [k, k in own.all ? "yours" : "default"])) };
  };
  const projectDoc = () => {
    /** @type {Record<string, any>} */
    const flat = { ...DEFAULTS, ...own.all, ...own.p1 };
    if (own.p1["loop.addedFolders"]) flat["loop.addedFolders"] = [...(own.all["loop.addedFolders"] || []), ...own.p1["loop.addedFolders"]];
    return {
      projectId: "p1", name: "filament", cwd: o.cwd === undefined ? "C:\\work\\filament" : o.cwd, layer: nestLayer(own.p1),
      resolved: { flat, sources: Object.fromEntries(Object.keys(flat).map((k) => [k, k in own.p1 ? "project" : k in own.all ? "global" : "default"])), layers: { global: nestLayer(own.all) } },
      knobs: Object.fromEntries(REPO.map((k) => [k, {}])),
    };
  };
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
      const changes = apply(own.all, req.body);
      return { ...allDoc(), changes };
    }
    if (path === "/projects/p1/settings") return method === "GET" ? projectDoc() : { ok: true, changes: apply(own.p1, req.body) };
    if (path === "/projects/p1/rules/forget") {
      own.p1["loop.rules"] = (own.p1["loop.rules"] || []).filter((/** @type {any} */ r) => !(r.tool === req.body.tool && r.pattern === req.body.pattern));
      return { ok: true };
    }
    // Your own instruction files: the first there, the rest not; Claude Code's own offered.
    if (path.startsWith("/instructions/your-files")) {
      const asked = new URLSearchParams(path.split("?")[1] || "").getAll("path");
      return { files: asked.map((p, i) => (i === 0 ? { path: p, found: true, chars: 1240 } : { path: p, found: false })), offer: { path: "~/.claude/CLAUDE.md", chars: 1240 } };
    }
    if (path === "/memory/projects") return { projects: [{ id: "p1", name: "filament", cwd: "H:/filament" }, { id: "p2", name: "old", archived: true }] };
    if (path === "/state") return { configVersion: config.version, config: { memory: { capture: { excludeFolders: [...config.excluded] } } } };
    if (path === "/config/fields" && method === "PATCH") {
      if (req.body.base !== config.version) throw Object.assign(new Error("changed elsewhere"), { body: { error: "changed elsewhere", stale: true } });
      config.excluded = [...req.body.set["memory.capture.excludeFolders"]];
      config.version++;
      return { ok: true, changes: ["memory.capture.excludeFolders"], version: config.version };
    }
    throw new Error(`no route ${method} ${path}`);
  };
  return { api, calls, own, config, writes: () => calls.filter(([, m]) => m !== "GET") };
}

/** A page mounted, with its toasts and menus, and "A project ▾" picked when asked. */
async function mount(/** @type {Function} */ render, /** @type {ReturnType<typeof server>} */ srv, { project = false, io = {} } = {}) {
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  /** @type {any[]} */
  const menus = [];
  let changed = 0;
  const body = /** @type {any} */ (fakeH("div", {}));
  render(body, { onToast: (/** @type {string} */ msg, /** @type {string} */ kind) => toasts.push([msg, kind || undefined]), onChanged: () => { changed++; } },
    { h: fakeH, api: srv.api, menu: (/** @type {any[]} */ items) => { menus.push(items); return { el: fakeH("div"), close() {} }; }, ...io });
  await flush();
  if (project) {
    button(body, "A project ▾").dispatch("click");
    await flush();
    menus.at(-1).find((/** @type {any} */ i) => i.label === "filament").onClick();
    await flush();
    await flush();
  }
  return { body, toasts, menus, changed: () => changed };
}

describe("Settings › Permissions", () => {
  // (fails before: yes — HS-3: Settings had no page for what the agent may do in new chats)
  test("over all chats: its rows in order, each saying where its value comes from; the mode's four, the one in force lit; a pick writes your default, Reset takes it back", async () => {
    const srv = server();
    const { body, toasts, changed } = await mount(renderPermissions, srv);
    assert.match(textOf(body), /^Applies to\|All chats\|A project ▾\|Every chat that has not chosen its own\./);
    assert.deepEqual(labels(body), ["New chats start in", "Learn from approvals", "Offered in Memory after", "Folders it may also read", "What it may and may not do", "Second look before risky commands", "Commands it never runs", "Text hidden from the model", "Check after each edit"]);
    const seg = find(body, (n) => n.attrs?.["aria-label"] === "New chats start in")[0];
    assert.deepEqual(seg.kids.map((/** @type {any} */ b) => textOf(b)), MODES.map((m) => m.label));
    assert.deepEqual(seg.kids.filter((/** @type {any} */ b) => b.attrs.class.includes(" on")).map((/** @type {any} */ b) => textOf(b)), ["Edit automatically"]);
    assert.equal(textOf(all(body, "nset-from")[0]), "Filament's default", "no Reset where nothing of yours is held");
    button(body, "Full access").dispatch("click");
    await flush();
    assert.deepEqual(srv.writes().at(-1), ["/defaults/settings", "PATCH", { patch: { loop: { permissions: "auto" } } }]);
    assert.match(toasts.at(-1)?.[0] || "", /^Your default changed: Permissions: Full access — every chat that has not chosen its own takes it from its next request$/);
    assert.equal(changed(), 1, "the open chat's document is read again");
    assert.equal(textOf(all(body, "nset-from")[0]), "Set for all chats|Reset");
    assert.match(textOf(all(body, "settings-row-desc")[0]), /^Edits and runs commands without asking\. Every chat that has not picked its own mode follows this/);
    button(all(body, "nset-from")[0], "Reset").dispatch("click");
    await flush();
    assert.deepEqual(srv.writes().at(-1), ["/defaults/settings", "PATCH", { unset: ["loop.permissions"] }]);
    // HarnessV4_Space_Plan SG-D13: the switch for a second look before risky commands, off until you switch it on.
    const second = find(body, (n) => n.attrs?.["aria-label"] === "Second look before risky commands")[0];
    assert.ok(second, "its switch");
    assert.match(textOf(body), /Deploys and rollbacks, migrations, .* ask first in every mode, Full access too/);
    second.dispatch("click");
    await flush();
    assert.deepEqual(srv.writes().at(-1), ["/defaults/settings", "PATCH", { patch: { loop: { secondLook: true } } }]);
    assert.match(toasts.at(-1)?.[0] || "", /^Your default changed: Second look before risky commands: on — every chat that has not chosen its own/);
  });

  // (fails before: yes — HC-53, HC-54, HC-84)
  test("folders: added by path or Browse, a refusal said in the server's words with the text kept, removed by ×", async () => {
    const srv = server({ refuse: (path, b) => (path === "/defaults/settings" && b?.patch?.loop?.addedFolders?.includes("notes") ? "\"loop.addedFolders[0]\" must be a whole path (notes is relative)" : undefined) });
    /** @type {string[]} */
    const picked = [];
    const { body, toasts } = await mount(renderPermissions, srv, { io: { pick: async (/** @type {any} */ input) => { input.value = "E:\\docs"; picked.push("dialog"); return "picked"; } } });
    assert.match(textOf(body), /None: outside a chat's folder, it reads only when you say yes\./);
    let input = field(body, "A folder to add");
    input.value = "D:\\notes";
    button(body, "Add").dispatch("click");
    await flush();
    assert.deepEqual(srv.writes().at(-1)?.[2], { patch: { loop: { addedFolders: ["D:\\notes"] } } });
    assert.match(textOf(body), /D:\\notes\|All chats/);
    input = field(body, "A folder to add");
    input.value = "notes";
    press(input, "Enter");
    await flush();
    assert.deepEqual(toasts.at(-1), ["\"loop.addedFolders[0]\" must be a whole path (notes is relative)", "err"]);
    assert.equal(field(body, "A folder to add").value, "notes", "the text stays to be put right");
    button(body, "Browse…").dispatch("click");
    await flush();
    assert.deepEqual(picked, ["dialog"], "the computer's own dialog first");
    button(body, "Add").dispatch("click");
    await flush();
    assert.deepEqual(srv.own.all["loop.addedFolders"], ["D:\\notes", "E:\\docs"]);
    assert.equal(field(body, "A folder to add").value, "", "added: the field is empty again");
    find(body, (n) => n.attrs?.["aria-label"] === "Remove D:\\notes")[0].dispatch("click");
    await flush();
    assert.deepEqual(srv.own.all["loop.addedFolders"], ["E:\\docs"]);
    find(body, (n) => n.attrs?.["aria-label"] === "Remove E:\\docs")[0].dispatch("click");
    await flush();
    assert.deepEqual(srv.writes().at(-1)?.[2], { unset: ["loop.addedFolders"] }, "the last one taken away unsets the list");
  });

  // (fails before: yes — the owner's of 11-09: "D:\notes" on a Mac)
  test("folders: the path box's example is in the shape of the system Filament runs on", async () => {
    const was = state.platform;
    try {
      /** @type {[string, string][]} */
      const shown = [];
      for (const platform of ["darwin", "linux", "win32"]) {
        state.platform = platform;
        const { body } = await mount(renderPermissions, server());
        shown.push([platform, field(body, "A folder to add").attrs.placeholder]);
      }
      assert.deepEqual(shown, [["darwin", "A whole path: /Users/you/notes"], ["linux", "A whole path: /home/you/notes"], ["win32", "A whole path: D:\\notes"]]);
    } finally {
      state.platform = was;
    }
  });

  // (fails before: yes — HC-80..83)
  // (the owner's of 11-07: there are no presets, so a project's line says its chats take all chats' mode)
  test("under a project: the mode rows give way to one line; all chats' folders and rules shown without a remove; the project's own rules forgotten through its route", async () => {
    const rm = { tool: "bash", pattern: "rm *", verdict: "deny" };
    const srv = server({ yours: { "loop.addedFolders": ["D:\\wide"], "loop.rules": [rm] } });
    const { body, menus, toasts } = await mount(renderPermissions, srv, { project: true });
    assert.match(textOf(body), /\|filament ▾\|Chats in filament take these over yours; its folders add to yours\./);
    assert.deepEqual(labels(body), ["New chats start in", "Folders it may also read", "What it may and may not do", "Second look before risky commands", "Commands it never runs", "Text hidden from the model", "Check after each edit"]);
    assert.ok(textOf(body).includes("New chats start in|A project holds no mode of its own: its chats start in the one All chats sets."), textOf(body));
    assert.ok(!textOf(body).includes("preset"), "no preset is said");
    assert.equal(textOf(all(body, "nset-items")[0]), "D:\\wide|All chats", "all chats' folder: no remove here");
    assert.equal(textOf(all(body, "nset-items")[1]), "Never runs |rm *|All chats", "all chats' rule: no Forget here");
    assert.match(textOf(body), /These are all chats': forget one under All chats\./);
    // The project's own rules: a remembered permission and a written one, each forgotten here.
    srv.own.p1["loop.rules"] = [{ tool: "bash", pattern: "npm test", verdict: "allow", learned: true }];
    button(body, "All chats").dispatch("click");
    await flush();
    button(body, "A project ▾").dispatch("click");
    await flush();
    menus.at(-1).find((/** @type {any} */ i) => i.label === "filament").onClick();
    await flush();
    await flush();
    assert.equal(textOf(all(body, "nset-items")[1]), "Runs |npm test| without asking|From Always allow|Forget");
    assert.match(textOf(body), /This project's rules take the place of those for all chats\./);
    button(all(body, "nset-items")[1], "Forget").dispatch("click");
    await flush();
    await flush();
    assert.deepEqual(srv.writes().at(-1), ["/projects/p1/rules/forget", "POST", { tool: "bash", pattern: "npm test", verdict: "allow" }]);
    assert.equal(toasts.at(-1)?.[0], "Forgotten in filament: the next such call asks");
  });

  // (fails before: yes — HC-85)
  test("text rows: Enter or leaving keeps, Esc puts back, a refusal puts back; a list kept as lines; a number checked before it is sent", async () => {
    const srv = server({ refuse: (path, b) => (b?.patch?.privacy?.redact ? "\"privacy.redact[0]\" is not a regular expression: ([" : undefined) });
    const { body, toasts } = await mount(renderPermissions, srv);
    let check = field(body, "Check after each edit");
    check.value = "npm test";
    press(check, "Enter");
    await flush();
    assert.deepEqual(srv.writes().at(-1)?.[2], { patch: { loop: { verify: { afterEdits: "npm test" } } } });
    check = field(body, "Check after each edit");
    assert.equal(check.value, "npm test");
    check.value = "npm run nothing";
    press(check, "Escape");
    assert.equal(check.value, "npm test", "Esc puts it back");
    const n = srv.writes().length;
    check.onblur();
    await flush();
    assert.equal(srv.writes().length, n, "left unchanged, nothing is sent");
    const deny = field(body, "Commands it never runs");
    deny.value = "rm -rf *\n\n  git push --force*  ";
    deny.onblur();
    await flush();
    assert.deepEqual(srv.own.all["privacy.bashDeny"], ["rm -rf *", "git push --force*"]);
    const redact = field(body, "Text hidden from the model");
    redact.value = "([";
    press(redact, "Enter", { ctrlKey: true });
    await flush();
    assert.deepEqual(toasts.at(-1), ["\"privacy.redact[0]\" is not a regular expression: ([", "err"]);
    assert.equal(field(body, "Text hidden from the model").value, "", "the page is drawn again from what the server holds");
    const after = field(body, "Approvals before Memory offers a rule");
    after.value = "0";
    const m = srv.writes().length;
    press(after, "Enter");
    await flush();
    assert.equal(srv.writes().length, m, "refused before it is sent");
    assert.deepEqual(toasts.at(-1), ["Offered in Memory after: a whole number, 1 or more", "err"]);
    assert.equal(after.value, "5", "and put back");
  });
});

describe("Settings › Instructions", () => {
  // (fails before: yes — HC-58, HC-59, HC-86, HC-87)
  test("its rows; hooks one a line, a line that is not a hook named and nothing written; the told words and the web for all chats; under a project, one line in their place", async () => {
    const srv = server();
    const { body, toasts } = await mount(renderInstructions, srv);
    // (fails before: skills were a master switch and a list of folders here; HarnessV4_Skills_Plan S1-6 moved them to
    // Library › Skills, which this row links to)
    // (the owner's of 11-09: Weigh your messages aside moved to Settings › Experimental, harness-filament-pages)
    assert.deepEqual(labels(body), ["What every chat is also told", "Your files, read in every chat", "Project instruction files", "Your skills", "Hooks", "Read web pages", "Search the web", "Drive a browser"]);
    assert.deepEqual(all(body, "inst-skills").map((a) => [textOf(a), a.attrs.href]), [["Library › Skills", "#/library/skills"]]);
    const hooks = field(body, "Hooks, one a line");
    hooks.value = "post-tool(edit) npm run lint\nwhenever npm test";
    hooks.onblur();
    await flush();
    assert.match(toasts.at(-1)?.[0] || "", /^"whenever npm test" is not a hook: write on\(tool\) command/);
    assert.equal(srv.writes().length, 0);
    field(body, "Hooks, one a line").value = "post-tool(edit) npm run lint";
    field(body, "Hooks, one a line").onblur();
    await flush();
    assert.deepEqual(srv.own.all.hooks, [{ on: "post-tool", tool: "edit", command: "npm run lint" }]);
    assert.equal(field(body, "Hooks, one a line").value, "post-tool(edit) npm run lint");
    const told = field(body, "What every chat is also told");
    told.value = "Answer briefly.";
    told.onblur();
    await flush();
    assert.equal(srv.own.all["instructions.session"], "Answer briefly.");
    find(body, (n) => n.attrs?.["aria-label"] === "Read web pages")[0].dispatch("click");
    await flush();
    assert.deepEqual(srv.writes().at(-1)?.[2], { patch: { plugins: { web: { fetch: true } } } });
    assert.match(toasts.at(-1)?.[0] || "", /^Your default changed: Reads web pages — every chat that has not chosen its own/);
    // The agent's browser beside them, on its own switch (HarnessV4_Browser_Plan BR2).
    find(body, (n) => n.attrs?.["aria-label"] === "Drive a browser")[0].dispatch("click");
    await flush();
    assert.deepEqual(srv.writes().at(-1)?.[2], { patch: { plugins: { browser: true } } });
    assert.match(toasts.at(-1)?.[0] || "", /^Your default changed: Drives a browser — every chat that has not chosen its own/);
    const files = field(body, "Project instruction files");
    files.value = "";
    files.onblur();
    await flush();
    assert.deepEqual(srv.own.all["instructions.files"], [], "emptied: none read, of your own");
    const p = await mount(renderInstructions, server(), { project: true });
    assert.deepEqual(labels(p.body), ["Told and given in every chat", "Project instruction files", "Your skills", "Hooks"]);
    assert.ok(textOf(p.body).includes("Told and given in every chat|A project holds no words of its own for every chat, nor the web tools: its chats take what All chats sets."), textOf(p.body));
  });

  // (fails before: yes — your own files were nowhere to be named, and the files' row said a path could be "whole",
  // which the fence refuses)
  test("your files, read in every chat, on All chats only: none yet, Claude Code's own offered and taken in a press; a line under each saying whether it is there", async () => {
    const srv = server();
    const { body } = await mount(renderInstructions, srv);
    await flush();
    assert.deepEqual(all(body, "inst-yours-line").map((n) => textOf(n)), ["On this computer: ~/.claude/CLAUDE.md · 1,240 characters|Read it in every chat"]);
    assert.match(textOf(body), /Read wherever the chat works, before the project's files, as Claude Code reads ~\/\.claude\/CLAUDE\.md\. A file written for another agent brings that agent's rules with it\./);
    assert.match(textOf(body), /Looked for in the chat's folder and each folder above it, up to the top of the repository; in a folder below it, when the agent first reads or changes a file there\./);
    assert.doesNotMatch(textOf(body), /or whole/);
    button(body, "Read it in every chat").dispatch("click");
    await flush();
    assert.deepEqual(srv.own.all["instructions.userFiles"], ["~/.claude/CLAUDE.md"]);
    const yours = field(body, "Your files, read in every chat");
    yours.value = "~/.claude/CLAUDE.md\n~/rules.md";
    yours.onblur();
    await flush();
    await flush();
    assert.deepEqual(srv.own.all["instructions.userFiles"], ["~/.claude/CLAUDE.md", "~/rules.md"]);
    assert.deepEqual(all(body, "inst-yours-line").map((n) => textOf(n)), ["✓ ~/.claude/CLAUDE.md · 1,240 characters", "✗ ~/rules.md: not there, skipped"]);
    const p = await mount(renderInstructions, server(), { project: true });
    assert.ok(!labels(p.body).includes("Your files, read in every chat"), "a project holds none of yours");
  });
});

describe("Settings › Memory › a project", () => {
  // (fails before: yes — HC-92 drew five switches over all chats, memory itself and its briefing, block, tools and
  // learning among them; the owner's of 11-09: memory is core, and no row of Settings › Memory turns a part of it off)
  test("over all chats, no switch: one line on what a project holds; under a project, whether memory reads its chats and they are searchable, the project's own", async () => {
    const srv = server();
    const { body } = await mount(renderMemoryChats, srv);
    assert.deepEqual(labels(body), ["A project's memory"]);
    assert.equal(find(body, (n) => n.attrs?.role === "switch").length, 0, "no switch over all chats");
    const p = await mount(renderMemoryChats, srv, { project: true });
    assert.deepEqual(labels(p.body), ["Leave this project out of memory", "Memory reads its chats", "Searchable"]);
    find(p.body, (n) => n.attrs?.["aria-label"] === "Memory reads its chats")[0].dispatch("click");
    await flush();
    assert.deepEqual(srv.writes().at(-1), ["/projects/p1/settings", "POST", { patch: { privacy: { learn: false } } }]);
    assert.match(p.toasts.at(-1)?.[0] || "", /^Memory reads none of its chats in filament — /, "in the row's words, not the knob's short name");
    assert.equal(find(p.body, (n) => n.attrs?.["aria-label"] === "Memory reads its chats")[0].attrs["aria-checked"], "false");
    find(p.body, (n) => n.attrs?.["aria-label"] === "Searchable")[0].dispatch("click");
    await flush();
    assert.deepEqual(srv.writes().at(-1), ["/projects/p1/settings", "POST", { patch: { privacy: { index: false } } }]);
    assert.match(p.toasts.at(-1)?.[0] || "", /^Its chats are kept out of search in filament — /);
  });

  // (fails before: yes — the owner's of 11-09: a project said "Memory's switches are a chat's own choices, which a
  // project does not hold", and nothing on the page left a project out of memory)
  test("Leave this project out of memory: its folder written into memory's excluded folders, so a chat in it gets no capture, no recall and no sub-agent brief; switched back, taken out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-leave-out-"));
    const folder = join(dir, "filament");
    const archive = new Archive({ file: join(dir, "a.db") });
    const capture = { excludeClients: /** @type {string[]} */ ([]), excludeModels: /** @type {string[]} */ ([]), excludeFolders: /** @type {string[]} */ ([]) };
    const brain = new MemoryBrain(/** @type {any} */ ({ archive, getConfig: () => ({ capture }) }));
    try {
      const srv = server({ cwd: folder, excluded: ["D:\\clients"] });
      const p = await mount(renderMemoryChats, srv, { project: true });
      await flush();
      const leave = () => find(p.body, (n) => n.attrs?.["aria-label"] === "Leave this project out of memory")[0];
      assert.ok(leave(), "its switch");
      assert.equal(leave().attrs["aria-checked"], "false");
      assert.ok(textOf(p.body).includes(`every app that works in ${folder}`), textOf(p.body));
      leave().dispatch("click");
      await flush();
      await flush();
      assert.deepEqual(srv.writes().at(-1), ["/config/fields", "PATCH", { set: { "memory.capture.excludeFolders": ["D:\\clients", folder] }, base: 4 }], "added to the list, against the version read");
      assert.equal(p.toasts.at(-1)?.[0], "filament is left out of memory from its chats' next request");
      assert.equal(leave().attrs["aria-checked"], "true");
      // What memory does with the list written: a chat of the project, in a folder of it, gets nothing.
      capture.excludeFolders = srv.config.excluded;
      const chat = archive.chainForKey("n:in-the-project", { cwd: join(folder, "app"), client: "harness", model: "m", meta: { native: true } });
      const turn = { format: "anthropic", body: { model: "m", messages: [{ role: "user", content: "fix the parser" }] }, headers: { "x-filament-client": "harness", "x-filament-chain": chat.id }, model: "m", cwdHint: join(folder, "app") };
      assert.equal(brain.situate(turn), null, "no capture, no recall");
      assert.equal(brain.excludedWhy(turn), "the working folder is excluded in Memory settings");
      assert.equal(brain.subagentLeftOut(chat.id), "the working folder is excluded in Memory settings", "no sub-agent brief");
      leave().dispatch("click");
      await flush();
      await flush();
      assert.deepEqual(srv.config.excluded, ["D:\\clients"], "switched back: its folder alone taken out");
      assert.equal(p.toasts.at(-1)?.[0], "filament is in memory again from its chats' next request");
      capture.excludeFolders = srv.config.excluded;
      assert.ok(brain.situate(turn), "in memory again");
      assert.equal(brain.subagentLeftOut(chat.id), null);
    } finally {
      brain.stop();
      archive.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Leave this project out of memory: a folder above it left out keeps it out, said; a list changed elsewhere is refused, not overwritten; a project with no folder cannot be left out", async () => {
    const above = await mount(renderMemoryChats, server({ excluded: ["c:/work/"] }), { project: true });
    await flush();
    const sw = find(above.body, (n) => n.attrs?.["aria-label"] === "Leave this project out of memory")[0];
    assert.equal(sw.attrs["aria-checked"], "true");
    assert.match(textOf(above.body), /It is out now: c:\/work\/ is left out of memory, and this project is inside it\./);
    sw.dispatch("click");
    await flush();
    assert.deepEqual(above.toasts.at(-1), ["It stays out: c:/work/ is left out of memory, and filament is inside it", "err"]);
    const srv = server();
    const stale = await mount(renderMemoryChats, srv, { project: true });
    await flush();
    srv.config.version = 9;
    find(stale.body, (n) => n.attrs?.["aria-label"] === "Leave this project out of memory")[0].dispatch("click");
    await flush();
    await flush();
    assert.deepEqual(srv.config.excluded, [], "nothing overwritten");
    assert.match(stale.toasts.at(-1)?.[0] || "", /^Not changed: memory's folders were changed elsewhere since this page read them/);
    const none = await mount(renderMemoryChats, server({ cwd: null }), { project: true });
    await flush();
    assert.equal(find(none.body, (n) => n.attrs?.["aria-label"] === "Leave this project out of memory").length, 0);
    assert.match(textOf(none.body), /This project has no folder memory knows, so it cannot be left out here\./);
  });
});

describe("a new chat's start", () => {
  // (fails before: yes — HS-D16, HC-90, HC-91: a new chat took the model last used, and nothing else)
  test("the model a new chat starts on: the one chosen while the picker offers it, else the one used last", () => {
    /** @type {Map<string, string>} */
    const kept = new Map();
    /** @type {any} */ (globalThis).localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => kept.set(k, v), removeItem: (/** @type {string} */ k) => kept.delete(k) };
    try {
      rememberModel("glm-5.3");
      assert.equal(startModel([{ id: "glm-5.3" }, { id: "kimi-k3" }]), "glm-5.3", "Last used, the default");
      setNewChatModelPref("kimi-k3");
      assert.equal(startModel([{ id: "glm-5.3" }, { id: "kimi-k3" }]), "kimi-k3");
      assert.equal(startModel([]), "kimi-k3", "before the catalogue is read, taken at its word");
      assert.equal(startModel([{ id: "glm-5.3" }]), "glm-5.3", "gone from the picker: the one used last");
      setNewChatModelPref("");
      assert.equal(startModel([{ id: "kimi-k3" }]), "glm-5.3");
    } finally {
      delete (/** @type {any} */ (globalThis).localStorage);
    }
  });

  // (fails before: yes — HS-3)
  // Language servers since the owner's LSP of 11-04 (test/lsp-settings-ui.test.js).
  // (the owner's of 11-07: Presets went; the model new chats start on is Settings › General's New chats since the owner's settings cleanup of 11-09,
  // provider-backups)
  test("New chats in Settings' nav: Permissions, Instructions, Language servers, Context, Memory", () => {
    assert.deepEqual(SECTIONS.filter((s) => s.group === "New chats").map((s) => s.label), ["Permissions", "Instructions", "Language servers", "Context", "Memory"]);
  });

  // (fails before: yes — HS-3's drive: the shared row's `flex: 1 1 220px` turned into a 220px height in a wide row,
  // a blank band between each wide row's words and its control)
  test("a wide row's words keep their own height", () => {
    const css = readFileSync(new URL("../src/ui/harness/settings/settings.css", import.meta.url), "utf8");
    assert.match(css, /\.nset-row\.is-wide > \.settings-row-text \{ flex: none; \}/);
  });
});

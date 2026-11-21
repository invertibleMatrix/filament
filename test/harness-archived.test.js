// @ts-check
// Settings › Archived chats (HarnessV4_Settings_Plan HS-6, HS-D74, HC-78 and HC-124 to HC-126): every archived chat
// with its project and age and an Unarchive, the archived projects likewise, a chat's title the way into it, and the
// words when nothing is archived. Built on the stub document over a scripted admin API that keeps the archive's state.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { renderArchived, NOTHING_ARCHIVED, chatMeta, projectMeta } from "../src/ui/harness/settings/archived.js";
import { DESCRIPTIONS, SECTIONS } from "../src/ui/harness/settings/page.js";

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
/** @type {ReturnType<typeof stubDocument>} */
let doc;
beforeEach(() => { doc = stubDocument(); });
afterEach(() => doc.restore());

/** The archive as the server keeps it: two chats (one archived), two projects (one archived). */
function archive() {
  const sessions = [
    { id: "s1", title: "Fix the tray", projectName: "filament", cwd: "H:\\filament", when: "", archived: true },
    { id: "s2", title: "Live chat", projectName: "filament", cwd: "H:\\filament", when: "", archived: false },
  ];
  const projects = [
    { id: "p1", name: "old-site", cwd: "D:\\old-site", chains: 3, archived: true },
    { id: "p2", name: "filament", cwd: "H:\\filament", chains: 2, archived: false },
  ];
  /** @type {[string, string, any][]} */
  const calls = [];
  /** @param {string} path @param {any} [o] */
  const api = async (path, o = {}) => {
    calls.push([o.method || "GET", path, o.body]);
    if (path.startsWith("/memory/sessions?")) {
      assert.match(path, /archived=only/);
      return { sessions: sessions.filter((s) => s.archived) };
    }
    if (path === "/memory/projects") return { projects };
    const chat = /^\/sessions\/([^/]+)\/settings$/.exec(path);
    if (chat) {
      const s = sessions.find((x) => x.id === decodeURIComponent(chat[1]));
      if (s) s.archived = o.body.patch.display.archived;
      return { ok: true };
    }
    const proj = /^\/memory\/projects\/([^/]+)\/archive$/.exec(path);
    if (proj) {
      const p = projects.find((x) => x.id === decodeURIComponent(proj[1]));
      if (p) p.archived = o.body.archived;
      return { ok: true };
    }
    throw new Error(`unscripted ${path}`);
  };
  return { sessions, projects, calls, api };
}

/** @param {any} body */
const rows = (body) => body.querySelectorAll(".arch-row").map((/** @type {any} */ r) => [r.querySelector(".settings-row-label").textContent, r.querySelector(".settings-row-desc").textContent]);

// (fails before: yes — HC-78: archived chats were seen only through the sidebar's filter, mixed with the rest)
test("each archived chat and project is listed with its words; a chat's title opens it", async () => {
  const a = archive();
  const body = /** @type {any} */ (doc.document.createElement("div"));
  doc.document.body.append(body);
  renderArchived(body, {}, { api: a.api });
  assert.equal(body.textContent, "Reading the archive…");
  await settle();
  assert.deepEqual(body.querySelectorAll(".nset-h").map((/** @type {any} */ x) => x.textContent), ["Chats", "Projects"]);
  assert.deepEqual(rows(body), [["Fix the tray", "filament"], ["old-site", "D:\\old-site · 3 chats"]]);
  assert.equal(body.querySelector(".arch-open").attrs.get("href"), "#/task/s1", "HC-126: the title is the chat's address");
  assert.ok(SECTIONS.findIndex((s) => s.id === "archived") === SECTIONS.findIndex((s) => s.id === "shortcuts") + 1, "under Basics, after Keyboard Shortcuts");
});

// (fails before: yes — HC-124)
test("Unarchive brings a chat or a project back: it leaves the list, the sidebar reads again, a toast says so", async () => {
  const a = archive();
  /** @type {string[]} */
  const toasts = [];
  let sidebar = 0;
  const body = /** @type {any} */ (doc.document.createElement("div"));
  doc.document.body.append(body);
  renderArchived(body, { onToast: (m) => toasts.push(m), onSessions: () => sidebar++ }, { api: a.api });
  await settle();
  body.querySelectorAll(".arch-row")[0].querySelector("button").dispatch("click");
  await settle();
  assert.deepEqual(a.calls.find(([m]) => m === "PATCH"), ["PATCH", "/sessions/s1/settings", { patch: { display: { archived: false } } }]);
  assert.deepEqual(rows(body), [["old-site", "D:\\old-site · 3 chats"]]);
  body.querySelector(".arch-row button").dispatch("click");
  await settle();
  assert.deepEqual(a.calls.find(([m]) => m === "POST"), ["POST", "/memory/projects/p1/archive", { archived: false }]);
  // (fails before: yes — r-itself, 11-12: an archived project runs nothing by itself, and the one page that lists what
  // is archived said neither that nor that bringing it back sets it going again)
  assert.deepEqual(toasts, ["chat unarchived — the sidebar lists it again", "project unarchived — the sidebar lists it and its chats again, and what runs by itself in it goes again"]);
  assert.equal(DESCRIPTIONS.archived, "The chats and projects you archived: nothing Filament starts by itself runs in one until you bring it back. Unarchive one and the sidebar lists it again; a chat's title opens it.");
  assert.equal(sidebar, 2);
  // (HC-125) Nothing archived any more.
  assert.deepEqual(body.querySelectorAll(".nset-h").map((/** @type {any} */ x) => x.textContent), ["Chats"]);
  assert.equal(body.querySelector(".nset-note").textContent, NOTHING_ARCHIVED);
});

// (fails before: yes — the bug hunt of 10-30, the archived list's Low: the page read the newest 200 archived chats alone, so every one past them was on no page)
test("every archived chat is listed, past the first page of the list", async () => {
  const many = Array.from({ length: 450 }, (_, i) => ({ id: `a${i}`, title: `Chat ${i}`, projectName: "p", cwd: "H:\\p", when: "", archived: true }));
  /** @type {string[]} */
  const reads = [];
  const api = async (/** @type {string} */ path) => {
    if (path.startsWith("/memory/sessions?")) {
      reads.push(path);
      const q = new URLSearchParams(path.slice(path.indexOf("?") + 1));
      assert.deepEqual([q.get("kind"), q.get("archived")], ["interactive,fork", "only"]);
      const offset = Number(q.get("offset") || 0);
      return { sessions: many.slice(offset, offset + Number(q.get("limit") || 20)) };
    }
    if (path === "/memory/projects") return { projects: [] };
    throw new Error(`unscripted ${path}`);
  };
  const body = /** @type {any} */ (doc.document.createElement("div"));
  doc.document.body.append(body);
  renderArchived(body, {}, { api });
  await settle();
  const listed = rows(body);
  assert.equal(listed.length, 450);
  assert.deepEqual([listed[0], listed.at(-1)], [["Chat 0", "p"], ["Chat 449", "p"]]);
  assert.equal(reads.length, 3, "a page at a time");
});

test("the words under a row", () => {
  assert.equal(chatMeta({ cwd: "H:\\x", when: "" }), "H:\\x");
  assert.equal(chatMeta({}), "No project");
  assert.equal(projectMeta({ cwd: "D:\\a", chains: 1 }), "D:\\a · 1 chat");
  assert.equal(projectMeta({ chains: 0 }), "0 chats");
});

test("a failed read says so in place", async () => {
  const body = /** @type {any} */ (doc.document.createElement("div"));
  doc.document.body.append(body);
  renderArchived(body, {}, { api: async () => { throw new Error("the archive is off"); } });
  await settle();
  assert.equal(body.querySelector(".set-error").textContent, "The archive could not be read: the archive is off");
});

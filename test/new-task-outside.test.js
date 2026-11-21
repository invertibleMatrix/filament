// @ts-check
// A new chat with no project chosen (the owner's of 11-09: "when i press new task and there is no project selected and
// as default Everywhere is selected then no widget control is shown"): the Start stands as it does in a project — its
// questions, the first request and every card —, asked of the server as a chat outside a project, which works in
// Everything. Works in and the Instructions card, which need a project, say so in a line; a choice made on the board
// is held on the chat as in a project, so it reaches the session the send makes in Everything, and stays when a
// project is picked. The server half is in everything.test.js.
// (fails before: yes — the page asked nothing and the board stayed hidden while no folder was chosen)
import { test, describe, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** The bodies the page asked draft-start with, in order. @type {any[]} */
const drafts = [];
/** Everything's folder, as the server would weigh it. */
const EVERYTHING = "C:\\data\\Everything";
const PROJECT = { id: "p-app", cwd: "H:\\w\\app", name: "app" };

/**
 * A draft-start answer as the server gives it (new-task.test.js pins its shape): the board's held change of the
 * compaction mode read back, as the server resolves it. @param {any} body
 */
const answerFor = (body) => {
  const mode = body.settings?.context?.compaction?.mode;
  return {
    cwd: body.outside ? EVERYTHING : body.cwd,
    projectId: null,
    projectName: body.outside ? "Everything" : "app",
    ...(body.outside ? { outside: true } : {}),
    flat: { "context.compaction.method": "summary", "context.compaction.thresholdPercent": 85, "context.compaction.mode": mode || "ask", "loop.tools": null, "loop.permissions": "edit" },
    sources: mode ? { "context.compaction.mode": "session" } : {},
    base: mode ? { "context.compaction.mode": "ask" } : {},
    engine: { kind: "loop", model: "m-1" },
    window: { tokens: 200000 },
    line: { percent: 85, tokens: 170000 },
    parts: [{ id: "prompt", tokens: 3000 }, { id: "tools", tokens: 5000 }, { id: "message", tokens: 3 }],
    instructions: { files: [], missing: ["AGENTS.md"], sessionChars: 0 },
    skills: { on: [], list: [], triggered: [], problems: [] },
    tools: { offered: ["read", "write", "edit", "bash", "agent"], off: [], memory: 0, recall: false, mcp: [] },
    // Outside a project, what holds everywhere is counted beside Everything's own (draft-start.js `knows.everywhere`).
    memory: { global: true, autopilot: true, on: true, ready: true, briefing: 0, recall: 0, knows: body.outside ? { memories: 0, dossier: null, everywhere: 3 } : { memories: 5, dossier: null } },
  };
};
const json = (/** @type {any} */ v) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url, /** @type {any} */ init) => {
  const u = String(url);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (u === "/api/sessions/draft-start") {
    drafts.push(body);
    return json(answerFor(body));
  }
  if (u === "/api/files/exists") return json({ ok: (body.paths || []).map(() => true) });
  if (u === "/api/memory/projects/of") return json({ projects: (body.paths || []).map(() => null) });
  if (u.startsWith("/api/git/places")) return json({ ok: false });
  return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
};
/** @type {Map<string, string>} */
const kept = new Map();
const hadStorage = g.localStorage;
g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)), removeItem: (/** @type {string} */ k) => void kept.delete(k) };
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const doc = stubDocument();
// The greeting's next hour is never waited for.
if (typeof g.window.setTimeout !== "function") g.window.setTimeout = () => 0;
const { createEmptyState } = await import("../src/ui/harness/conversation/empty.js");
const { sessionStartBody } = await import("../src/ui/harness/session-start.js");
const { state } = await import("../src/ui/harness/state.js");

after(() => {
  doc.restore();
  g.fetch = realFetch;
  if (hadStorage === undefined) delete g.localStorage;
  else g.localStorage = hadStorage;
});
beforeEach(() => {
  doc.document.body.replaceChildren();
  drafts.length = 0;
  kept.clear();
});

/**
 * The new chat's page with no folder chosen, its Start hooks the page's (app.js): the body is the first send's, said
 * to be outside a project where no folder is chosen; a change the board holds goes on the chat, as app.js's `onHeld`
 * puts it.
 */
const page = () => {
  /** @type {any} */
  const chat = { id: "u1", turns: [], cwd: "" };
  const o = { folder: "" };
  const empty = createEmptyState({
    getFolder: () => o.folder,
    setFolder: (p) => { o.folder = p; chat.cwd = p; },
    chatOf: () => chat,
    onHeld: ({ patch }) => { chat.held = patch || {}; },
    start: {
      body: () => {
        const folder = o.folder || chat.cwd || "";
        const body = sessionStartBody(chat, folder, "m-1");
        return folder ? body : { ...body, outside: true };
      },
      text: () => "",
      permission: () => "",
      setPermission: () => {},
      models: () => [{ id: "m-1" }],
      mainModel: () => "m-1",
    },
  });
  doc.document.body.append(empty.el);
  const el = /** @type {any} */ (empty.el);
  const host = el.querySelector(".nt-host");
  return { chat, o, empty, el, host, card: (/** @type {string} */ id) => el.querySelector(`[id='nt-card-${id}']`) };
};

describe("a new chat with no project chosen", () => {
  test("no project known: the Start stands, every card drawn, asked as a chat outside a project; what needs a project says so", async () => {
    state.projects = [];
    state.sessions = [];
    const p = page();
    p.empty.refresh();
    await until(() => !p.host.classList.contains("hidden"), "the Start");
    assert.equal(drafts[0]?.outside, true, JSON.stringify(drafts[0]));
    assert.equal(drafts[0]?.cwd, "", "no folder of its own: the server names Everything's");
    for (const id of ["tools", "memory", "skills", "compaction", "subagents", "instructions"]) assert.ok(p.card(id)?.children.length, `the ${id} card is drawn`);
    assert.ok(p.el.querySelector(".nt-first"), "the first request");
    assert.equal(p.el.querySelector(".nt-from-note").textContent, "Your defaults, outside any project.");
    assert.equal(p.el.querySelector(".works-in-note").textContent, "Everything, a folder of Filament's own. Pick a project to work in its repository or a new worktree.");
    assert.match(p.card("instructions").textContent, /Pick a project to see its instruction files\./);
    assert.ok(p.card("tools").querySelector("[aria-label='Permission mode']"), "the permission mode, on the Tools card");
    // What memory knows that the chat draws on there: what holds everywhere, not "this project"'s none.
    assert.match(p.card("memory").textContent, /Knows 3 memories that hold everywhere. Your projects' memories join where your messages touch them./);
    assert.doesNotMatch(p.card("memory").textContent, /about this project/);
  });

  test("a project known, Work outside a project ticked (the owner's \"Everywhere\"): the Start stands the same", async () => {
    state.projects = [PROJECT];
    state.sessions = [];
    const p = page();
    p.empty.refresh();
    await until(() => !p.host.classList.contains("hidden"), "the Start");
    assert.equal(drafts.at(-1)?.outside, true);
    await p.el.querySelector(".chooser-chip").onclick({ stopPropagation() {} });
    await until(() => doc.document.body.querySelector(".zc-menu"), "the menu open");
    const rows = /** @type {any[]} */ (doc.document.body.querySelector(".zc-menu").querySelectorAll(".zc-menu-item"));
    const outside = rows.find((r) => /Work outside a project/.test(r.textContent));
    assert.equal(outside?.getAttribute("aria-checked"), "true", "the menu ticks Work outside a project");
    assert.ok(p.card("compaction")?.children.length && p.card("tools")?.children.length);
  });

  test("a choice made there is the chat's: it rides the next ask, the session the send makes in Everything, and the project picked after", async () => {
    state.projects = [PROJECT];
    state.sessions = [];
    const p = page();
    p.empty.refresh();
    await until(() => !p.host.classList.contains("hidden"), "the Start");
    const ask = p.card("compaction").querySelector("input[aria-label='Ask before making room']");
    assert.equal(ask.checked, true, "your defaults ask");
    ask.checked = false;
    ask.dispatch("change");
    assert.deepEqual(p.chat.held, { "context.compaction.mode": "auto" }, "held on the chat, as in a project");
    await until(() => drafts.some((d) => d.settings?.context?.compaction?.mode === "auto"), "asked again with the change");
    assert.equal(drafts.at(-1).outside, true);
    await until(() => p.card("compaction").querySelector("input[aria-label='Ask before making room']")?.checked === false, "the board repainted with it");
    // The send: readySession puts the chat in Everything's folder, and makeSession creates it from the held choice.
    const sent = sessionStartBody({ ...p.chat, cwd: EVERYTHING }, EVERYTHING, "m-1");
    assert.deepEqual([sent.cwd, sent.settings], [EVERYTHING, { context: { compaction: { mode: "auto" } } }]);
    // A project picked after the change: the chat keeps it, and the board weighs it there.
    const n = drafts.length;
    p.o.folder = PROJECT.cwd;
    p.chat.cwd = PROJECT.cwd;
    p.empty.paintStart();
    await until(() => drafts.length > n, "asked in the project");
    assert.deepEqual([drafts.at(-1).cwd, drafts.at(-1).outside, drafts.at(-1).settings], [PROJECT.cwd, undefined, { context: { compaction: { mode: "auto" } } }]);
  });
});

// The page's own hooks (app.js is not loaded in a test): its Start body says a chat with no folder is outside a project,
// and asks with no folder too.
test("the page's Start body: no folder is a chat outside a project, never no Start", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  const body = /body: \(\) => \{\n([\s\S]*?)\n    \},/.exec(app)?.[1] || "";
  assert.match(body, /if \(!chat \|\| chat\.chainId\) return null;/);
  assert.doesNotMatch(body, /!folder\) return null/);
  assert.match(body, /return folder \? body : \{ \.\.\.body, outside: true \};/);
});

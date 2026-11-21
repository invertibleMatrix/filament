// @ts-check
// HarnessV4_Settings_Plan HS-1, the page half: the words a row and the sheet say (pure answers), one place's list and
// its sheet on the fake DOM — every control a call to the MCP servers rows, every change said in a toast — the
// settings section's "Applies to", a chat's own list in place of the JSON row, and the New Task board's way there. The
// server half is in mcp-servers.test.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LOAD, FOOT_WORDS, KEY_IN_ARGS, LOAD_FOR, LOAD_WORDS, NOT_JSON, OLD_SSE, SECRET_MARK, SIGN_IN_AFTER_SAVE,
  agoWords, chipOf, createMcpList, joinArgs, keyInArgs, loadChipOf, loadOf, namesAccount, nameFrom, needsWords, parseServersJson, reachWords, rowLines, signInLine, signInOf, splitArgs,
} from "../src/ui/harness/lib/mcp-list.js";
import { renderMcpServers } from "../src/ui/harness/settings/mcp-servers.js";
import { settingChangeWords } from "../src/ui/harness/lib/labels.js";
import { knobRow } from "../src/ui/lib/settings/editor.js";
import { KNOBS } from "../src/services/session-settings.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (/** @type {string} */ f) => readFileSync(join(ROOT, f), "utf8");
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

/** Every node under `el` whose class list holds `cls`. @param {any} el @param {string} cls @returns {any[]} */
const allWith = (el, cls) => {
  /** @type {any[]} */
  const out = [];
  const walk = (/** @type {any} */ n) => {
    if (!n || typeof n !== "object") return;
    if (String(n.attrs?.class || "").split(/\s+/).includes(cls)) out.push(n);
    for (const k of n.kids || []) walk(k);
  };
  walk(el);
  return out;
};
/** The controls under `el` named `label` for a screen reader, in order. @param {any} el @param {string} label */
const labelled = (el, label) => {
  /** @type {any[]} */
  const out = [];
  const walk = (/** @type {any} */ n) => {
    if (!n || typeof n !== "object") return;
    if (n.attrs?.["aria-label"] === label) out.push(n);
    for (const k of n.kids || []) walk(k);
  };
  walk(el);
  return out;
};
const button = (/** @type {any} */ el, /** @type {string} */ words) => {
  const b = buttonsOf(el).find((x) => textOf(x) === words);
  assert.ok(b, `a button "${words}" in: ${textOf(el)}`);
  return b;
};

/** One row of a list answer. @param {Record<string, any>} [o] */
const row = (o = {}) => ({
  name: "github",
  kind: "stdio",
  spec: { name: "github", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: SECRET_MARK, LOG_LEVEL: "info" } },
  sse: false,
  from: "global",
  on: true,
  switchedAt: null,
  replaces: null,
  orphan: false,
  own: true,
  switchedHere: false,
  test: null,
  ...o,
});
/** A remote server's row, signed in or not as `o` says. @param {Record<string, any>} [o] */
const linearRow = (o = {}) => row({ name: "linear", kind: "http", spec: { name: "linear", url: "https://mcp.linear.app/mcp" }, signIn: null, ...o });
/** A list answer. @param {Record<string, any>} [o] */
const listOf = (o = {}) => ({ scope: "all", at: "global", label: "all chats", projectId: null, held: false, unread: [], servers: [], ...o });

/**
 * The list on the fake DOM with a recording server, dialog, menu and confirm.
 * @param {{ scope?: string, at?: string, answer?: any, reply?: (path: string, method: string, body: any) => any, confirm?: boolean, imports?: boolean,
 *   more?: (row: any) => { text: string }[], openPlugin?: (id: string) => void }} [o]
 */
const listWith = (o = {}) => {
  /** @type {{ path: string, method: string, body: any }[]} */
  const calls = [];
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  /** @type {any[]} */
  const menus = [];
  /** @type {any[]} */
  const dialogs = [];
  /** @type {any[]} */
  const asks = [];
  /** The pages opened, and the looks waiting for their turn (`later`). @type {string[]} */
  const opened = [];
  /** @type {(() => void)[]} */
  const timers = [];
  /** Add connector's sheets opened (lib/connector-pick.js), each with what the list handed it. @type {any[]} */
  const picks = [];
  let answer = o.answer || listOf();
  const api = async (/** @type {string} */ path, /** @type {any} */ opts = {}) => {
    const method = opts.method || "GET";
    calls.push({ path, method, body: opts.body });
    const r = o.reply ? await o.reply(path, method, opts.body) : undefined;
    if (r instanceof Error) throw r;
    if (r !== undefined) return r;
    return answer;
  };
  const dialog = (/** @type {any} */ d) => {
    const rec = { ...d, closed: false, close() { rec.closed = true; } };
    dialogs.push(rec);
    return rec;
  };
  const list = createMcpList(
    { scope: o.scope || "all", at: o.at, onToast: (msg, kind) => toasts.push([msg, kind]), now: () => 1_758_000_100_000, imports: o.imports, more: o.more, openPlugin: o.openPlugin },
    /** @type {any} */ ({ h: fakeH, drawIn: fakeDrawIn, api, dialog, menu: (/** @type {any[]} */ items, /** @type {any} */ mo) => menus.push({ items, o: mo }), confirm: async (/** @type {any} */ q) => { asks.push(q); return o.confirm ?? true; },
      open: (/** @type {string} */ u) => opened.push(u), later: (/** @type {() => void} */ fn) => timers.push(fn), pick: (/** @type {any} */ p) => picks.push(p) }),
  );
  /** Let the waiting looks run, once each. */
  const tick = async () => {
    for (const fn of timers.splice(0)) fn();
    await flush();
  };
  return { list, el: /** @type {any} */ (list.el), calls, toasts, menus, dialogs, asks, opened, timers, picks, tick, setAnswer: (/** @type {any} */ a) => { answer = a; } };
};

describe("the words (pure)", () => {
  test("arguments typed as one line: quoted parts kept whole, and written back so they read the same", () => {
    assert.deepEqual(splitArgs(`-y "@scope/a b" 'c d' plain`), ["-y", "@scope/a b", "c d", "plain"]);
    const args = ["-y", "a b", 'say "hi"', ""];
    assert.equal(joinArgs(args), `-y "a b" "say \\"hi\\"" ""`);
    assert.deepEqual(splitArgs(joinArgs(args)), args);
    assert.equal(joinArgs(undefined), "");
  });

  // (fails before: yes — inside quotes every backslash was dropped: "C:Program Filessrvindex.js")
  test("a quoted Windows path keeps its backslashes; only \\\" and \\\\ stand for one character, and the line reads back the same", () => {
    assert.deepEqual(splitArgs(`"C:\\Program Files\\srv\\index.js" --x`), ["C:\\Program Files\\srv\\index.js", "--x"]);
    assert.deepEqual(splitArgs(`H:\\tools\\srv.mjs "say \\"hi\\"" "a\\\\b"`), ["H:\\tools\\srv.mjs", 'say "hi"', "a\\b"]);
    const args = ["C:\\Program Files\\srv\\index.js", "\\\\host\\share dir", 'q"\\'];
    assert.deepEqual(splitArgs(joinArgs(args)), args);
  });

  // (fails before: yes — the chat's row read `mcp: [{"name":"fx","enabled":false}]`)
  test("a chat's change row says what its own list gained, lost or switched, in words", () => {
    const fx = { name: "fx", command: "node", args: ["fx.mjs"], env: { FX_TOKEN: SECRET_MARK } };
    const w = (/** @type {any} */ to, /** @type {any} */ from) => settingChangeWords("plugins.mcp", to, from);
    assert.equal(w([{ name: "fx", enabled: false }], undefined), "Connector fx off");
    assert.equal(w([{ name: "fx", enabled: true }], [{ name: "fx", enabled: false }]), "Connector fx on");
    assert.equal(w([], [{ name: "fx", enabled: false }]), "Connector fx: inherits again");
    assert.equal(w([fx], []), "Connector fx added");
    assert.equal(w([{ ...fx, enabled: false }], [fx]), "Connector fx off");
    assert.equal(w([{ ...fx, env: { FX_TOKEN: "new" } }], [fx]), "Connector fx changed");
    const gh = { name: "gh", url: "https://x.dev/mcp" };
    assert.equal(w([gh], [fx]), "Connector gh added · Connector fx removed");
    assert.equal(w([fx, gh], [gh, fx]), "Connectors changed", "only the order moved");
    assert.equal(w(undefined, [fx]), "Connectors inherit again");
  });

  test("HC-13: a key in the arguments is noticed — a known prefix, or a key flag with a value", () => {
    assert.equal(keyInArgs(["--api-key", "abc123"]), true);
    assert.equal(keyInArgs(["--token=abc"]), true);
    assert.equal(keyInArgs(["ghp_abcdef1234"]), true);
    assert.equal(keyInArgs(["--token"]), false, "a flag with nothing after it");
    assert.equal(keyInArgs(["-y", "@modelcontextprotocol/server-github"]), false);
  });

  test("HC-4 to HC-6: Paste JSON reads the blocks servers' pages give; anything else is said in words", () => {
    const claude = parseServersJson(JSON.stringify({ mcpServers: { GitHub: { command: "npx", args: ["-y", "x"], env: { GITHUB_TOKEN: "t" } }, remote: { type: "sse", url: "https://x.dev/sse" } } }));
    assert.deepEqual(claude, [{ name: "github", command: "npx", args: ["-y", "x"], env: { GITHUB_TOKEN: "t" } }, { name: "remote", url: "https://x.dev/sse", type: "sse" }]);
    assert.deepEqual(parseServersJson(JSON.stringify({ servers: { time: { type: "stdio", command: "uvx", args: ["mcp-server-time"] } } })), [{ name: "time", command: "uvx", args: ["mcp-server-time"] }]);
    assert.deepEqual(parseServersJson(JSON.stringify({ mcp: { servers: { api: { type: "http", url: "https://a.dev/mcp", headers: { Authorization: "Bearer k" } } } } })), [{ name: "api", url: "https://a.dev/mcp", headers: { Authorization: "Bearer k" } }]);
    assert.deepEqual(parseServersJson(JSON.stringify({ linear: { serverUrl: "https://mcp.linear.app/mcp", http_headers: { "X-Key": "1" } } })), [{ name: "linear", url: "https://mcp.linear.app/mcp", headers: { "X-Key": "1" } }]);
    assert.deepEqual(parseServersJson(`{ "command": "uvx", "args": ["mcp-server-time"] }`), [{ name: "", command: "uvx", args: ["mcp-server-time"] }], "one server's own block: named by hand");
    for (const text of ["[mcp_servers.github]\ncommand = \"npx\"", "", "[1]"]) assert.throws(() => parseServersJson(text), { message: NOT_JSON }, text);
    assert.throws(() => parseServersJson(`{ "a": 1 }`), { message: "No MCP server in this JSON: it needs a command, or a url, for each server" });
    assert.equal(nameFrom("My Server_2"), "my-server-2");
    assert.equal(nameFrom("42-tools"), "tools");
  });

  test("a row's chip and lines: where it comes from, who switched it, whose it replaces, its last test", () => {
    const now = 1_758_000_100_000;
    assert.deepEqual(chipOf(row(), "global"), { words: "all chats", here: true });
    assert.deepEqual(rowLines(row(), "global", now), [{ text: "Not tested since Filament started" }]);
    const offHere = row({ own: false, on: false, switchedAt: "session", switchedHere: true });
    assert.deepEqual(chipOf(offHere, "session"), { words: "off for this chat", here: true });
    assert.equal(rowLines(offHere, "session", now)[0].text, "On for all chats; this chat switched it off");
    const onHere = row({ own: false, on: true, switchedAt: "session", switchedHere: true });
    assert.deepEqual([chipOf(onHere, "session").words, rowLines(onHere, "session", now)[0].text], ["on for this chat", "Off beneath; this chat switched it on"]);
    const offForProject = row({ own: false, on: false, switchedAt: "project" });
    assert.deepEqual([chipOf(offForProject, "session"), rowLines(offForProject, "session", now)[0].text], [{ words: "off", here: false }, "Switched off for this project"]);
    assert.equal(rowLines(row({ from: "project", replaces: "global" }), "project", now)[0].text, "Replaces the server of this name from all chats");
    const orphan = row({ spec: undefined, orphan: true, on: false, switchedAt: "session" });
    assert.deepEqual(chipOf(orphan, "session"), { words: "removed", here: true });
    assert.match(rowLines(orphan, "session", now)[0].text, /^Switched off for this chat, but no server of this name is set beneath any more: Clear/);
    assert.deepEqual(rowLines(row({ test: { ok: true, at: now - 90_000, words: "2 tools: 1 only read" } }), "global", now), [{ text: "2 tools: 1 only read · tested 2 min ago" }]);
    assert.deepEqual(rowLines(row({ test: { ok: false, at: now, words: "npx was not found on this computer's PATH" } }), "global", now), [{ text: "npx was not found on this computer's PATH", bad: true }]);
    assert.equal(rowLines(row({ sse: true }), "global", now)[0].text, OLD_SSE);
    assert.deepEqual([agoWords(now - 5000, now), agoWords(now - 7_200_000, now)], ["just now", "2 h ago"]);
    assert.deepEqual(["global", "project", "session"].map((at) => reachWords(at)), ["each chat has it from its next message", "each chat in it has it from its next message", "this chat has it from its next message"]);
    // (fails before: yes — HC-141, found in HS-6's drive: five servers added, and the toast said each chat "has it")
    assert.deepEqual(["global", "project", "session"].map((at) => reachWords(at, true)), ["each chat has them from its next message", "each chat in it has them from its next message", "this chat has them from its next message"]);
  });
});

describe("one place's list on the fake DOM", () => {
  // (fails before: yes — no list of MCP servers was drawn anywhere in the harness)
  test("empty for all chats: says so, offers Add connector, and says who gets these in its foot", async () => {
    const { el, calls } = listWith();
    assert.match(textOf(el), /Reading the connectors…/);
    await flush();
    assert.deepEqual(calls.map((c) => c.path), ["/mcp-servers?scope=all"]);
    assert.equal(textOf(allWith(el, "mcps-empty")[0]), "No connectors yet. Add connector finds services like GitHub and Linear, or sets one up by hand.");
    assert.ok(buttonsOf(el).some((b) => textOf(b) === "Add connector"));
    assert.equal(textOf(allWith(el, "mcps-foot")[0]), FOOT_WORDS);
  });

  test("a row: its dot from its last test, its name and chip, what it runs, a switch and ⋯; a failed read offers Try again", async () => {
    const now = 1_758_000_100_000;
    const { el } = listWith({ answer: listOf({ servers: [row({ test: { ok: true, at: now, words: "2 tools: 1 only read" } }), row({ name: "fs", spec: { name: "fs", url: "https://fs.dev/mcp" }, kind: "http", test: { ok: false, at: now, words: "The server refused: 401. Check the Authorization header." } })] }) });
    await flush();
    const rows = allWith(el, "mcps-row");
    assert.deepEqual(rows.map((r) => r.attrs["data-name"]), ["github", "fs"]);
    assert.deepEqual(rows.map((r) => allWith(r, "mcps-dot")[0].attrs.class), ["mcps-dot is-ok", "mcps-dot is-bad"]);
    assert.equal(textOf(rows[0]), "github|all chats|stdio · npx -y @modelcontextprotocol/server-github|2 tools: 1 only read · tested just now");
    assert.match(textOf(rows[1]), /HTTP · https:\/\/fs\.dev\/mcp\|The server refused: 401/);
    assert.equal(allWith(rows[1], "is-bad").length, 2, "the dot and the failed test's line");
    const failed = listWith({ reply: () => new Error("no archive: …") });
    await flush();
    assert.match(textOf(failed.el), /no archive: …\|Try again/);
  });

  // (fails before: yes, the name half — the switch was named "github on" whether it was on or off)
  test("the switch writes { enabled } to this place and says so; a refusal is said in its words", async () => {
    const { el, calls, toasts } = listWith({ answer: listOf({ servers: [row()] }) });
    await flush();
    const [sw] = allWith(el, "set-switch");
    assert.deepEqual([sw.attrs.role, sw.attrs["aria-label"], sw.attrs["aria-checked"]], ["switch", "Use github", "true"], "named for the server; on or off is its state");
    sw.dispatch("click");
    await flush();
    assert.deepEqual(calls.at(-1), { path: "/mcp-servers/all/github", method: "PUT", body: { enabled: false } });
    assert.deepEqual(toasts.at(-1), ["github off for all chats; from the next message", undefined]);
    const refusing = listWith({ answer: listOf({ servers: [row()] }), reply: (p, m) => (m === "PUT" ? new Error("this session is open for writing in another tab") : undefined) });
    await flush();
    allWith(refusing.el, "set-switch")[0].dispatch("click");
    await flush();
    assert.deepEqual(refusing.toasts.at(-1), ["this session is open for writing in another tab", "err"]);
  });

  test("⋯ on your own server: Test, Edit, Always loaded, Remove — Remove asks first; on an inherited one: Test, Edit for this place and Always loaded, no Remove", async () => {
    const own = listWith({ answer: listOf({ servers: [row()] }) });
    await flush();
    allWith(own.el, "mcps-more")[0].dispatch("click");
    assert.deepEqual(own.menus[0].items.map((/** @type {any} */ i) => i.label || i.type), ["Test", "Edit", "Always loaded", "separator", "Remove"]);
    own.menus[0].items.find((/** @type {any} */ i) => i.label === "Remove").onClick();
    await flush();
    assert.deepEqual([own.asks[0].title, own.asks[0].confirmLabel, own.asks[0].destructive], ["Remove github?", "Remove", true]);
    assert.match(own.asks[0].description, /^Chats lose its tools from their next message\. A project's or a chat's switch for it stays/);
    assert.deepEqual(own.calls.at(-1), { path: "/mcp-servers/all/github", method: "DELETE", body: undefined });
    assert.deepEqual(own.toasts.at(-1), ["github removed from all chats", undefined]);
    const kept = listWith({ answer: listOf({ servers: [row()] }), confirm: false });
    await flush();
    allWith(kept.el, "mcps-more")[0].dispatch("click");
    kept.menus[0].items.find((/** @type {any} */ i) => i.label === "Remove").onClick();
    await flush();
    assert.equal(kept.calls.some((c) => c.method === "DELETE"), false, "No writes nothing");
    const chat = listWith({ scope: "chat:c1", at: "session", answer: listOf({ scope: "chat:c1", at: "session", label: "this chat", servers: [row({ own: false })] }) });
    await flush();
    allWith(chat.el, "mcps-more")[0].dispatch("click");
    assert.deepEqual(chat.menus[0].items.map((/** @type {any} */ i) => i.label), ["Test", "Edit for this chat", "Always loaded"]);
  });

  test("Test from ⋯ sends the row as listed, credentials as the placeholder, says what it found, and reads the list again", async () => {
    const { el, calls, toasts, menus } = listWith({ answer: listOf({ servers: [row()] }), reply: (p) => (p === "/mcp-servers/test" ? { ok: true, words: "2 tools: 1 only read" } : undefined) });
    await flush();
    allWith(el, "mcps-more")[0].dispatch("click");
    menus[0].items[0].onClick();
    await flush();
    assert.deepEqual(calls.at(-2), { path: "/mcp-servers/test", method: "POST", body: { scope: "all", server: row().spec } });
    assert.equal(calls.at(-1)?.path, "/mcp-servers?scope=all");
    assert.deepEqual(toasts.at(-1), ["github: 2 tools: 1 only read", ""]);
  });

  test("a chat's list: Add for this chat only, ↺ on a switch it set, Clear on an orphan, Back to what it inherits — each one call", async () => {
    const enc = encodeURIComponent("chat:c1");
    const { el, calls, toasts, asks } = listWith({
      scope: "chat:c1",
      at: "session",
      answer: listOf({
        scope: "chat:c1",
        at: "session",
        label: "this chat",
        held: true,
        unread: [{ at: "project", errors: ['"plugins.mcp" names the server fs twice'] }],
        servers: [row({ own: false, on: false, switchedAt: "session", switchedHere: true }), row({ name: "gone", spec: undefined, orphan: true, on: false, switchedAt: "session", own: false })],
      }),
    });
    await flush();
    assert.match(textOf(el), /The list for this project is not read, so chats run without it: "plugins\.mcp" names the server fs twice/);
    assert.ok(buttonsOf(el).some((b) => textOf(b) === "Add for this chat only"));
    allWith(el, "mcps-back")[0].dispatch("click");
    await flush();
    assert.deepEqual([calls.at(-1)?.path, calls.at(-1)?.method, toasts.at(-1)?.[0]], [`/mcp-servers/${enc}/github`, "DELETE", "github is back to what this chat inherits"]);
    button(el, "Clear").dispatch("click");
    await flush();
    assert.deepEqual([calls.at(-1)?.path, toasts.at(-1)?.[0]], [`/mcp-servers/${enc}/gone`, "The switch for gone is cleared"]);
    button(el, "Back to what this chat inherits").dispatch("click");
    await flush();
    assert.equal(asks.at(-1).title, "Back to what this chat inherits?");
    assert.deepEqual([calls.at(-1)?.path, calls.at(-1)?.method, toasts.at(-1)?.[0]], [`/mcp-servers/${enc}`, "DELETE", "This chat is back to what it inherits"]);
  });
});

/** The list, its sheet opened by `words`, and the sheet's parts. @param {Parameters<typeof listWith>[0]} o @param {string} words */
const sheetWith = async (o, words) => {
  const t = listWith(o);
  await flush();
  if (words === "Add") {
    button(t.el, (o?.at || "global") === "global" ? "Add connector" : `Add for ${o?.answer?.label} only`).dispatch("click");
    // For all chats or a project, Add opens the marketplaces' connectors first: the form is its "Not listed?" way.
    t.picks.at(-1)?.onManual();
  } else {
    allWith(t.el, "mcps-more")[0].dispatch("click");
    t.menus.at(-1).items.find((/** @type {any} */ i) => i.label === words).onClick();
  }
  const d = t.dialogs.at(-1);
  const body = d.body;
  const field = (/** @type {string} */ label) => labelled(body, label)[0];
  return { ...t, d, body, field, error: () => textOf(allWith(body, "mcps-error").find((e) => e.attrs.role === "alert")) };
};

describe("the sheet", () => {
  // (fails before: yes — a server was added by hand-written JSON in the dashboard only)
  test("HC-1: Add — a name and a command; Save waits for both in words, then writes one entry and says where it reaches", async () => {
    const s = await sheetWith({}, "Add");
    assert.deepEqual([s.d.title, s.d.description], ["Add an MCP server", "For all chats · each chat has it from its next message"]);
    // (fails before: yes — found in HS-7's drive: the sheet opened on its × button)
    assert.equal(s.field("Name").focused, true, "the name is where typing goes");
    button(s.body, "Save").dispatch("click");
    await flush();
    assert.equal(s.error(), "Name it: a-z, 0-9 and -, up to 32 characters");
    s.field("Name").value = "Time";
    button(s.body, "Save").dispatch("click");
    assert.equal(s.error(), "A name is a-z, 0-9 and -, starting with a letter, up to 32 characters");
    s.field("Name").value = "time";
    button(s.body, "Save").dispatch("click");
    assert.equal(s.error(), "Say the command that starts it");
    s.field("Command").value = "uvx";
    s.field("Arguments").value = `mcp-server-time --local-timezone "Europe/London"`;
    button(s.body, "Save").dispatch("click");
    await flush();
    assert.deepEqual(s.calls.at(-1), { path: "/mcp-servers/all/time", method: "PUT", body: { name: "time", command: "uvx", args: ["mcp-server-time", "--local-timezone", "Europe/London"], load: "on-demand" } });
    assert.deepEqual(s.toasts.at(-1), ["time added for all chats; each chat has it from its next message", undefined]);
    assert.equal(s.d.closed, true);
  });

  test("HC-13: a key typed into the arguments asks to move it; saving anyway is allowed", async () => {
    const s = await sheetWith({}, "Add");
    s.field("Arguments").value = "--api-key sk-1234567890";
    s.field("Arguments").dispatch("input");
    // The sheet's last warning is the arguments' (the address's SSE note is the other).
    assert.equal(textOf(allWith(s.body, "mcps-warn").at(-1)), KEY_IN_ARGS);
    s.field("Arguments").value = "-y server";
    s.field("Arguments").dispatch("input");
    assert.equal(textOf(allWith(s.body, "mcps-warn").at(-1)), "");
  });

  test("HC-12: Edit — a kept credential shows as set; Save sends the placeholder for it, Replace sends the new value; a rename writes under the old name", async () => {
    const s = await sheetWith({ answer: listOf({ servers: [row()] }) }, "Edit");
    assert.equal(s.d.title, "Edit github");
    const pairs = allWith(s.body, "mcps-pairs")[0];
    assert.match(textOf(pairs), /••••••••••\|Replace/);
    assert.equal(labelled(pairs, "Value of LOG_LEVEL")[0].value, "info");
    button(s.body, "Save").dispatch("click");
    await flush();
    assert.deepEqual(s.calls.at(-1)?.body.env, { GITHUB_TOKEN: SECRET_MARK, LOG_LEVEL: "info" });
    assert.deepEqual(s.toasts.at(-1), ["github changed for all chats; from the next message", undefined]);
    const r = await sheetWith({ answer: listOf({ servers: [row()] }) }, "Edit");
    button(allWith(r.body, "mcps-pairs")[0], "Replace").dispatch("click");
    labelled(r.body, "New value")[0].value = "ghp_new";
    r.field("Name").value = "gh";
    button(r.body, "Save").dispatch("click");
    await flush();
    assert.deepEqual([r.calls.at(-1)?.path, r.calls.at(-1)?.body.name, r.calls.at(-1)?.body.env.GITHUB_TOKEN], ["/mcp-servers/all/github", "gh", "ghp_new"]);
  });

  test("an inherited server edited for a chat: its name is fixed, the title says for whom, Test sends its kept name", async () => {
    const answer = listOf({ scope: "chat:c1", at: "session", label: "this chat", servers: [row({ own: false })] });
    const s = await sheetWith({ scope: "chat:c1", at: "session", answer, reply: (p) => (p === "/mcp-servers/test" ? { ok: true, words: "2 tools: 1 only read", tools: [{ name: "read_issue", readOnly: true }, { name: "create_issue", readOnly: false }] } : undefined) }, "Edit for this chat");
    assert.equal(s.d.title, "Edit github for this chat");
    assert.equal("disabled" in s.field("Name").attrs, true);
    assert.match(textOf(s.body), /Inherited from all chats: Save keeps this as this chat's own server of the same name/);
    button(s.body, "Test").dispatch("click");
    await flush();
    assert.deepEqual([s.calls.at(-1)?.path, s.calls.at(-1)?.body.scope, s.calls.at(-1)?.body.server.name], ["/mcp-servers/test", "chat:c1", "github"]);
    const result = allWith(s.body, "mcps-result")[0];
    assert.equal(textOf(result), "Connected · 2 tools: 1 only read|read_issue|create_issue");
    assert.deepEqual(allWith(result, "mcps-tool").map((t) => t.attrs.class), ["mcps-tool is-read", "mcps-tool"]);
  });

  // (fails before: yes — the result handed replaceChildren a null, which a page draws as the word "null")
  test("HC-8: a failed Test shows its words and the program's last lines", async () => {
    const s = await sheetWith({ answer: listOf({ servers: [row()] }), reply: (p) => (p === "/mcp-servers/test" ? { ok: false, words: "It started and ended (code 1) before it answered. Its last lines:", output: "Error: GITHUB_TOKEN is not set" } : undefined) }, "Edit");
    button(s.body, "Test").dispatch("click");
    await flush();
    const result = allWith(s.body, "mcps-result")[0];
    assert.equal(result.classList.contains("is-bad"), true);
    assert.equal(textOf(result), "It started and ended (code 1) before it answered. Its last lines:|Error: GITHUB_TOKEN is not set");
  });

  // (fails before: yes — HC-142: the sheet said "The server refused: 401. Check the Authorization header.")
  test("HC-142: a Test that meets a sign-in says so, and where to sign in once it is saved", async () => {
    const s = await sheetWith({ answer: listOf({ servers: [linearRow()] }), reply: (p) => (p === "/mcp-servers/test" ? { ok: false, words: "It needs you to sign in", signIn: true } : undefined) }, "Edit");
    button(s.body, "Test").dispatch("click");
    await flush();
    assert.equal(textOf(allWith(s.body, "mcps-result")[0]), `It needs you to sign in|${SIGN_IN_AFTER_SAVE}`);
  });

  test("HC-4, HC-5: Paste JSON with two servers fills the first, saves each on its own, and closes after the last; an SSE one is marked", async () => {
    const s = await sheetWith({}, "Add");
    const area = allWith(s.body, "mcps-paste-area")[0];
    assert.equal("hidden" in area.attrs, true);
    allWith(s.body, "mcps-disclose")[0].dispatch("click");
    assert.equal("hidden" in area.attrs, false);
    allWith(s.body, "mcps-paste")[0].value = "not json";
    button(s.body, "Fill from JSON").dispatch("click");
    assert.match(textOf(allWith(s.body, "mcps-error")[0]), new RegExp(NOT_JSON));
    allWith(s.body, "mcps-paste")[0].value = JSON.stringify({ mcpServers: { time: { command: "uvx", args: ["mcp-server-time"] }, events: { type: "sse", url: "https://ev.dev/sse" } } });
    button(s.body, "Fill from JSON").dispatch("click");
    assert.deepEqual([s.field("Name").value, s.field("Command").value, s.field("Arguments").value], ["time", "uvx", "mcp-server-time"]);
    assert.match(textOf(allWith(s.body, "mcps-pick")[0]), /^2 servers in this JSON: each is tested and saved on its own\.\|time\|events$/);
    button(s.body, "Save").dispatch("click");
    await flush();
    assert.deepEqual([s.calls.at(-1)?.path, s.d.closed], ["/mcp-servers/all/time", false]);
    assert.deepEqual([s.field("Name").value, s.field("Address").value], ["events", "https://ev.dev/sse"], "the next one is in the sheet");
    assert.match(textOf(s.body), new RegExp(OLD_SSE.replace(/[.]/g, "\\.")));
    assert.match(textOf(allWith(s.body, "mcps-pick")[0]), /\|✓ time\|events$/);
    button(s.body, "Save").dispatch("click");
    await flush();
    assert.deepEqual([s.calls.at(-1)?.body, s.d.closed], [{ name: "events", url: "https://ev.dev/sse", type: "sse", load: "on-demand" }, true]);
  });

  test("an address: the command's fields hide, Save waits for http(s), headers are sent", async () => {
    const s = await sheetWith({}, "Add");
    button(s.body, "An address").dispatch("click");
    const [stdio, http] = allWith(s.body, "mcps-fields").slice(1, 3);
    assert.deepEqual(["hidden" in stdio.attrs, "hidden" in http.attrs], [true, false]);
    s.field("Name").value = "api";
    s.field("Address").value = "mcp.dev";
    button(s.body, "Save").dispatch("click");
    assert.equal(s.error(), "Say its address: http:// or https://");
    s.field("Address").value = "https://mcp.dev/mcp";
    button(allWith(s.body, "mcps-pairs")[1], "Add header").dispatch("click");
    const headers = allWith(s.body, "mcps-pairs")[1];
    labelled(headers, "Header name")[0].value = "Authorization";
    labelled(headers, "Value of the new header")[0].value = "Bearer k";
    button(s.body, "Save").dispatch("click");
    await flush();
    assert.deepEqual(s.calls.at(-1)?.body, { name: "api", url: "https://mcp.dev/mcp", headers: { Authorization: "Bearer k" }, load: "on-demand" });
  });

  // (fails before: yes — every row's name box was "Name", the sheet's own name box's word, and a new row's value
  // stayed "Value of the new one")
  test("a screen reader tells an env row from a header row and from the sheet's Name; a new row's value takes the name typed", async () => {
    const s = await sheetWith({}, "Add");
    const [env] = allWith(s.body, "mcps-pairs");
    button(env, "Add variable").dispatch("click");
    assert.equal(labelled(s.body, "Name").length, 1, "the server's own name alone");
    const key = labelled(env, "Variable name")[0];
    assert.ok(labelled(env, "Value of the new variable")[0]);
    key.value = "LOG_LEVEL";
    key.dispatch("input");
    assert.ok(labelled(env, "Value of LOG_LEVEL")[0]);
  });
});

// The owner's 10-26 decision: a server's tools load on demand for Filament's own agent — each request carries their
// names, one is loaded when the agent needs it — unless it is marked to load always, in the sheet or from ⋯.
describe("how a server's tools load (load: on-demand | core)", () => {
  const word = (/** @type {"on-demand" | "core"} */ id) => LOAD_WORDS[id].name.toLowerCase();
  const project = (/** @type {any[]} */ servers) => listOf({ scope: "project:p1", at: "project", label: "this project", servers });
  const enc = encodeURIComponent("project:p1");
  /** The sheet's Tools choice: its group and its two buttons, On demand first. @param {any} body */
  const toolsIn = (body) => {
    const group = labelled(body, "Tools")[0];
    return { group, onDemand: buttonsOf(group)[0], always: buttonsOf(group)[1], checked: () => buttonsOf(group).map((b) => b.attrs["aria-checked"]) };
  };

  // (fails before: yes — every server's tools rode every request whole, and nothing said or chose otherwise)
  test("the words: on demand where a row says nothing; always loaded a chip, blue where this place picked it; a pick here a line", () => {
    const now = 1_758_000_100_000;
    assert.deepEqual([loadOf(row()), loadOf(row({ load: "core" })), loadOf(), DEFAULT_LOAD], ["on-demand", "core", "on-demand", "on-demand"]);
    assert.equal(loadChipOf(row()), null, "on demand, most servers, says nothing");
    assert.deepEqual(loadChipOf(row({ load: "core", loadHere: true })), { words: "always loaded", here: false }, "a server this place holds: its own blue chip says whose");
    assert.deepEqual(loadChipOf(row({ own: false, load: "core" })), { words: "always loaded", here: false }, "as it inherits");
    assert.deepEqual(loadChipOf(row({ own: false, load: "core", loadHere: true })), { words: "always loaded", here: true });
    assert.equal(loadChipOf(row({ spec: undefined, orphan: true, load: "core" })), null);
    const picked = (/** @type {"on-demand" | "core"} */ load) => rowLines(row({ own: false, load, loadHere: true }), "project", now).map((l) => l.text);
    assert.deepEqual(picked("core"), ["Always loaded: picked for this project", "Not tested since Filament started"]);
    assert.deepEqual(picked("on-demand"), ["On demand: picked for this project", "Not tested since Filament started"]);
    assert.deepEqual(rowLines(row({ load: "core", loadHere: true }), "global", now).map((l) => l.text), ["Not tested since Filament started"], "a server this place holds carries its load on itself");
    // Each choice says its trade in plain words, and the sheet says whom it reaches.
    assert.match(LOAD_WORDS["on-demand"].line, /only the tools' names.*fewer tokens/);
    assert.match(LOAD_WORDS.core.line, /every tool in full.*thousands of tokens/);
    // Two sentences: after a colon, the engines would read as Filament's own agent's name.
    assert.equal(LOAD_FOR, "For Filament's own agent. Claude Code, Codex and Cursor load tools their own way.");
  });

  // (fails before: yes — a load picked read "MCP server fx on", and a load changed on a server "MCP server fx changed")
  test("a chat's change row says how its tools load, in the list's own words", () => {
    const w = (/** @type {any} */ to, /** @type {any} */ from) => settingChangeWords("plugins.mcp", to, from);
    const fx = { name: "fx", command: "node", args: ["fx.mjs"] };
    assert.equal(w([{ name: "fx", load: "core" }], []), `Connector fx ${word("core")}`);
    assert.equal(w([{ name: "fx", enabled: false, load: "core" }], []), `Connector fx off, ${word("core")}`);
    assert.equal(w([{ name: "fx", account: "work", load: "on-demand" }], []), `Connector fx signs in as work, ${word("on-demand")}`);
    assert.equal(w([{ ...fx, load: "core" }], [fx]), `Connector fx ${word("core")}`);
    assert.equal(w([fx], [{ ...fx, load: "core" }]), `Connector fx ${word("on-demand")}`, "a server that names none loads on demand");
    assert.equal(w([{ ...fx, load: "core" }], []), `Connector fx added, ${word("core")}`);
    assert.equal(w([{ name: "fx", enabled: false }], [{ name: "fx", enabled: false, load: "core" }]), "Connector fx loads as it inherits");
    assert.equal(w([], [{ name: "fx", load: "core" }]), "Connector fx: inherits again");
    assert.equal(w([{ name: "fx" }], []), "Connector fx on", "a pick that names nothing, as before");
  });

  // (fails before: yes — a row said nothing of how its tools load, and ↺ stood for a switch or an account alone)
  test("a row: the chip after where it comes from, only where its tools are always loaded; a pick here has its line and ↺, which takes it back", async () => {
    const t = listWith({ answer: listOf({ servers: [row({ load: "core", loadHere: true }), row({ name: "time", spec: { name: "time", command: "uvx", args: ["mcp-server-time"] } })] }) });
    await flush();
    const [gh, time] = allWith(t.el, "mcps-row");
    assert.equal(textOf(gh), "github|all chats|always loaded|stdio · npx -y @modelcontextprotocol/server-github|Not tested since Filament started");
    assert.equal(textOf(time), "time|all chats|stdio · uvx mcp-server-time|Not tested since Filament started", "on demand says nothing");
    const [chip] = allWith(gh, "mcps-load");
    assert.deepEqual([chip.attrs.class, chip.attrs.title], ["mcps-load", LOAD_WORDS.core.line], "grey, the trade in its title");
    assert.equal(allWith(t.el, "mcps-back").length, 0, "no ↺ on a server this place holds: the call would remove it");
    const p = listWith({ scope: "project:p1", at: "project", answer: project([row({ own: false, load: "core", loadHere: true })]), reply: (path, m) => (m === "DELETE" ? project([row({ own: false })]) : undefined) });
    await flush();
    const [inherited] = allWith(p.el, "mcps-row");
    assert.equal(allWith(inherited, "mcps-load")[0].attrs.class, "mcps-load is-here");
    assert.match(textOf(inherited), /\|Always loaded: picked for this project\|/);
    allWith(p.el, "mcps-back")[0].dispatch("click");
    await flush();
    assert.deepEqual([p.calls.at(-1)?.path, p.calls.at(-1)?.method, p.toasts.at(-1)?.[0]], [`/mcp-servers/${enc}/github`, "DELETE", "github is back to what this project inherits"]);
    assert.equal(allWith(p.el, "mcps-load").length, 0, "the list is the answer's: on demand, as it inherits");
  });

  // (fails before: yes — ⋯ had no word on how a server's tools load)
  test("⋯ Always loaded: a switch in the row's state; pressed, it writes { load } at this place and says so; an inherited one's is this place's pick", async () => {
    const t = listWith({ answer: listOf({ servers: [row()] }), reply: (path, m, b) => (m === "PUT" ? listOf({ servers: [row({ load: b.load })] }) : undefined) });
    await flush();
    const item = () => {
      allWith(t.el, "mcps-more")[0].dispatch("click");
      return t.menus.at(-1).items.find((/** @type {any} */ i) => i.label === LOAD_WORDS.core.name);
    };
    const off = item();
    assert.deepEqual([off.type, off.checked], ["switch", false]);
    off.onClick();
    await flush();
    assert.deepEqual(t.calls.at(-1), { path: "/mcp-servers/all/github", method: "PUT", body: { load: "core" } });
    assert.deepEqual(t.toasts.at(-1), ["github: always loaded for all chats; from the next message", undefined]);
    assert.match(textOf(t.el), /^github\|all chats\|always loaded\|/);
    const on = item();
    assert.equal(on.checked, true);
    on.onClick();
    await flush();
    assert.deepEqual(t.calls.at(-1)?.body, { load: "on-demand" });
    assert.deepEqual(t.toasts.at(-1), ["github: on demand for all chats; from the next message", undefined]);
    const p = listWith({ scope: "project:p1", at: "project", answer: project([row({ own: false })]), reply: (path, m) => (m === "PUT" ? new Error("this project is open for writing in another tab") : undefined) });
    await flush();
    allWith(p.el, "mcps-more")[0].dispatch("click");
    p.menus[0].items.find((/** @type {any} */ i) => i.label === LOAD_WORDS.core.name).onClick();
    await flush();
    assert.deepEqual(p.calls.at(-1), { path: `/mcp-servers/${enc}/github`, method: "PUT", body: { load: "core" } });
    assert.deepEqual(p.toasts.at(-1), ["this project is open for writing in another tab", "err"], "a refusal, in its words");
  });

  // (fails before: yes — the sheet had no word on how the tools load)
  test("the sheet: Tools after how it is reached — On demand first and chosen, its line and whom it reaches under it; Save sends the choice, Test none", async () => {
    const s = await sheetWith({ reply: (p) => (p === "/mcp-servers/test" ? { ok: true, words: "1 tool: 1 only read" } : undefined) }, "Add");
    const { group, onDemand, always, checked } = toolsIn(s.body);
    assert.equal(group.attrs.role, "radiogroup");
    assert.deepEqual([onDemand, always].map((b) => [textOf(b), b.attrs.role, b.attrs["aria-checked"], b.attrs.tabindex, b.attrs.title]), [
      ["On demand", "radio", "true", "0", LOAD_WORDS["on-demand"].line],
      ["Always loaded", "radio", "false", "-1", LOAD_WORDS.core.line],
    ], "each button's title is its own line, to compare without choosing");
    const field = allWith(s.body, "mcps-load-field")[0];
    assert.equal(textOf(field), `Tools|On demand|Always loaded|${LOAD_WORDS["on-demand"].line} ${LOAD_FOR}`);
    const at = s.body.kids.indexOf(field);
    assert.deepEqual([s.body.kids[at - 1].attrs.class, s.body.kids[at + 1].attrs.class], ["mcps-warn", "mcps-disclose"], "after how it is reached, for both ways; before the pasted JSON");
    always.dispatch("click");
    assert.deepEqual([checked(), always.classList.contains("on"), onDemand.classList.contains("on")], [["false", "true"], true, false]);
    assert.equal(textOf(field), `Tools|On demand|Always loaded|${LOAD_WORDS.core.line} ${LOAD_FOR}`, "the chosen one's line");
    // One Tab stop: the arrows move the choice, and the focus with it.
    group.dispatch("keydown", { key: "ArrowLeft" });
    assert.deepEqual([checked(), onDemand.attrs.tabindex, always.attrs.tabindex, onDemand.focused], [["true", "false"], "0", "-1", true]);
    group.dispatch("keydown", { key: "ArrowDown" });
    assert.deepEqual([checked(), always.focused], [["false", "true"], true]);
    group.dispatch("keydown", { key: "Tab" });
    assert.deepEqual(checked(), ["false", "true"], "any other key leaves it");
    s.field("Name").value = "time";
    s.field("Command").value = "uvx";
    button(s.body, "Test").dispatch("click");
    await flush();
    assert.deepEqual([s.calls.at(-1)?.path, "load" in s.calls.at(-1)?.body.server], ["/mcp-servers/test", false], "Test only connects");
    button(s.body, "Save").dispatch("click");
    await flush();
    assert.deepEqual(s.calls.at(-1), { path: "/mcp-servers/all/time", method: "PUT", body: { name: "time", command: "uvx", load: "core" } });
  });

  test("Edit opens on the row's load and Save keeps what it shows; an inherited one edited for a chat opens on what it loads there", async () => {
    const s = await sheetWith({ answer: listOf({ servers: [row({ load: "core" })] }) }, "Edit");
    assert.deepEqual(toolsIn(s.body).checked(), ["false", "true"]);
    button(s.body, "Save").dispatch("click");
    await flush();
    assert.equal(s.calls.at(-1)?.body.load, "core");
    const c = await sheetWith({ scope: "chat:c1", at: "session", answer: listOf({ scope: "chat:c1", at: "session", label: "this chat", servers: [row({ own: false, load: "core", loadHere: true })] }) }, "Edit for this chat");
    const tools = toolsIn(c.body);
    assert.deepEqual(tools.checked(), ["false", "true"]);
    tools.onDemand.dispatch("click");
    button(c.body, "Save").dispatch("click");
    await flush();
    assert.deepEqual([c.calls.at(-1)?.path, c.calls.at(-1)?.body.load], [`/mcp-servers/${encodeURIComponent("chat:c1")}/github`, "on-demand"]);
  });

  test("Paste JSON keeps the choice made; after a Save, the next pasted server starts on demand however the last was saved", async () => {
    const s = await sheetWith({}, "Add");
    toolsIn(s.body).always.dispatch("click");
    allWith(s.body, "mcps-disclose")[0].dispatch("click");
    allWith(s.body, "mcps-paste")[0].value = JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "gh"] }, time: { command: "uvx", args: ["mcp-server-time"] } } });
    button(s.body, "Fill from JSON").dispatch("click");
    assert.deepEqual([s.field("Name").value, toolsIn(s.body).checked()], ["github", ["false", "true"]], "the JSON says nothing of it");
    button(s.body, "Save").dispatch("click");
    await flush();
    assert.deepEqual([s.calls.at(-1)?.body.name, s.calls.at(-1)?.body.load], ["github", "core"]);
    assert.deepEqual([s.field("Name").value, toolsIn(s.body).checked()], ["time", ["true", "false"]]);
    button(s.body, "Save").dispatch("click");
    await flush();
    assert.deepEqual([s.calls.at(-1)?.body.name, s.calls.at(-1)?.body.load, s.d.closed], ["time", "on-demand", true]);
  });
});

describe("Import from other apps (HS-6, HS-D75)", () => {
  /** What the server's scan answers: Claude Desktop's file with four servers, Cursor's not read, Codex's not there. */
  const scan = () => ({
    scope: "all",
    label: "all chats",
    sources: [
      { id: "claude-desktop", label: "Claude Desktop", path: "C:\\Users\\me\\AppData\\Roaming\\Claude\\claude_desktop_config.json", state: "found", servers: [
        { from: "Brave Search", name: "brave-search", kind: "stdio", spec: { name: "brave-search", command: "npx", args: ["-y", "brave"], env: { BRAVE_API_KEY: SECRET_MARK } }, mark: "new", notes: ["Off in its app: it comes in off"] },
        { from: "notes", name: "notes", kind: "stdio", spec: { name: "notes", command: "node", args: ["notes.js"] }, mark: "taken", yours: "notes", notes: [] },
        { from: "gh", name: "gh", kind: "stdio", spec: { name: "gh", command: "npx" }, mark: "same", yours: "github", notes: ["Off in its app: it comes in off"] },
        { from: "filament", name: "filament", kind: "stdio", spec: { name: "filament", command: "npx" }, mark: "own", notes: [] },
      ] },
      { id: "cursor", label: "Cursor", path: "C:\\Users\\me\\.cursor\\mcp.json", state: "unreadable", why: "it is not JSON (Unexpected token)", servers: [] },
      { id: "codex", label: "Codex", path: "C:\\Users\\me\\.codex\\config.toml", state: "missing", servers: [] },
    ],
  });

  // (fails before: yes — HC-79: there was no import)
  test("only where the page asks for it; the sheet lists each app's file and its servers, ticks where one can be added", async () => {
    const plain = listWith();
    await flush();
    assert.ok(!buttonsOf(plain.el).some((b) => textOf(b) === "Import from other apps…"), "a chat's own list has none");
    const t = listWith({ imports: true, reply: (path) => (path.startsWith("/mcp-servers/import") ? scan() : undefined) });
    await flush();
    button(t.el, "Import from other apps…").dispatch("click");
    await flush();
    assert.equal(t.calls.at(-1)?.path, "/mcp-servers/import?scope=all");
    const d = t.dialogs[0];
    assert.deepEqual([d.title, d.description], ["Import from other apps", "Into all chats · each chat has them from its next message"]);
    const apps = allWith(d.body, "mcps-imp-head").map(textOf);
    assert.deepEqual(apps, ["Claude Desktop|4 servers", "Cursor|Not read: it is not JSON (Unexpected token)", "Codex|Not there"]);
    const rows = allWith(d.body, "mcps-row").map(textOf);
    // A note says how a server comes in, so one that does not come in has none (HC-141, found in HS-6's drive).
    assert.deepEqual(rows, [
      "brave-search|stdio · npx -y brave|Named Brave Search in Claude Desktop|Off in its app: it comes in off",
      "notes|stdio · node notes.js|Replaces your notes for all chats",
      "gh|stdio · npx|Already yours, as github",
      "filament|stdio · npx|Filament's own server: every chat has it",
    ]);
    assert.deepEqual([labelled(d.body, "Add brave-search")[0].attrs.checked, labelled(d.body, "Add notes")[0].attrs.checked], ["", undefined], "a new one ticked, one replacing yours not");
    assert.equal(labelled(d.body, "Add gh").length + labelled(d.body, "Add Filament").length, 0, "nothing to add for the same or Filament's own");
    assert.ok(!textOf(d.body).includes("BRAVE_API_KEY"), "no environment shown, no value");
    assert.match(textOf(d.body), /1 to add/);
  });

  // (fails before: yes — HC-129, HC-132, HC-134)
  test("Add sends the picks alone; the list takes the answer; a pick gone from its file is said", async () => {
    const t = listWith({
      imports: true,
      reply: (path, method) => (path.startsWith("/mcp-servers/import") ? (method === "POST" ? { ...listOf({ servers: [row({ name: "brave-search" })] }), added: ["brave-search"], gone: ["Claude Desktop's notes"], failed: [] } : scan()) : undefined),
    });
    await flush();
    button(t.el, "Import from other apps…").dispatch("click");
    await flush();
    const d = t.dialogs[0];
    labelled(d.body, "Add notes")[0].dispatch("change", { target: { checked: true } });
    assert.match(textOf(d.body), /2 to add/);
    button(d.body, "Add").dispatch("click");
    await flush();
    const post = t.calls.find((c) => c.method === "POST");
    assert.deepEqual(post, { path: "/mcp-servers/import", method: "POST", body: { scope: "all", picks: [{ source: "claude-desktop", name: "brave-search" }, { source: "claude-desktop", name: "notes" }] } });
    assert.equal(d.closed, true);
    assert.deepEqual(t.toasts, [["Added brave-search for all chats; each chat has it from its next message", undefined], ["Not added: Claude Desktop's notes left its file", "err"]]);
    assert.deepEqual(allWith(t.el, "mcps-name").map(textOf), ["brave-search"], "the list is the answer's");
  });

  // (fails before: yes — HC-141, found in HS-6's drive: five servers added, and the toast said each chat "has it")
  test("several added: the toast says each chat has them", async () => {
    const t = listWith({
      imports: true,
      reply: (path, method) => (path.startsWith("/mcp-servers/import") ? (method === "POST" ? { ...listOf({ servers: [row({ name: "brave-search" }), row({ name: "notes" })] }), added: ["brave-search", "notes"], gone: [], failed: [] } : scan()) : undefined),
    });
    await flush();
    button(t.el, "Import from other apps…").dispatch("click");
    await flush();
    const d = t.dialogs[0];
    labelled(d.body, "Add notes")[0].dispatch("change", { target: { checked: true } });
    button(d.body, "Add").dispatch("click");
    await flush();
    assert.deepEqual(t.toasts, [["Added brave-search, notes for all chats; each chat has them from its next message", undefined]]);
  });
});

describe("signing in to a remote server (HS-7)", () => {
  const HOST = "mcp.linear.app";
  const PAGE = "https://mcp.linear.app/authorize?client_id=c&state=s";

  // (fails before: yes — a row said nothing of a sign-in)
  test("HS-D83, HS-D91: what a row says of its sign-in, and when it offers one — never for a server with its own Authorization", () => {
    const now = 1_758_000_100_000;
    assert.deepEqual(signInLine(linearRow({ signIn: { state: "in", host: HOST } })), { text: "Signed in on mcp.linear.app" });
    assert.deepEqual(signInLine(linearRow({ signIn: { state: "ended", host: HOST, why: "invalid_grant" } })), { text: "Signed out by mcp.linear.app: sign in again", bad: true, title: "invalid_grant" });
    assert.deepEqual(signInLine(linearRow({ signIn: { state: "waiting", host: HOST, id: "i", page: PAGE } })), { text: "Sign in on mcp.linear.app's page… This waits until you do, or press Cancel" });
    assert.deepEqual(signInLine(linearRow({ signIn: { state: "asks", host: HOST } })), { text: "Needs you to sign in", bad: true });
    const tested = linearRow({ signIn: { state: "asks", host: HOST }, test: { ok: false, at: now, words: "It needs you to sign in", signIn: true } });
    assert.equal(signInLine(tested), null, "the test's line says it once");
    assert.deepEqual(rowLines(tested, "global", now), [{ text: "It needs you to sign in", bad: true }]);
    assert.deepEqual(rowLines(linearRow({ signIn: { state: "in", host: HOST } }), "global", now).map((l) => l.text), ["Signed in on mcp.linear.app", "Not tested since Filament started"]);
    // (fails before: yes — found in HS-7's drive: the waiting row said "It needs you to sign in" under its wait, in red)
    const waits = linearRow({ signIn: { state: "waiting", host: HOST, id: "i", page: PAGE }, test: { ok: false, at: now, words: "It needs you to sign in", signIn: true } });
    assert.deepEqual(rowLines(waits, "global", now).map((l) => l.text), ["Sign in on mcp.linear.app's page… This waits until you do, or press Cancel"]);
    assert.deepEqual(signInOf(tested), { can: true, st: "asks", asks: true, refused: false });
    assert.deepEqual(signInOf(linearRow()), { can: true, st: "", asks: false, refused: false });
    assert.deepEqual(signInOf(linearRow({ signIn: { state: "ended", host: HOST } })).asks, true);
    assert.deepEqual(signInOf(linearRow({ spec: { name: "linear", url: "https://x.dev/mcp", headers: { authorization: SECRET_MARK } }, test: { ok: false, signIn: true } })), { can: false, st: "", asks: false, refused: false });
    assert.equal(signInOf(row()).can, false, "a command is never signed in");
  });

  // (fails before: yes — no Sign in anywhere)
  test("HC-143: Sign in on the row opens the server's page, the row waits with Open it again and Cancel, and is looked at until it ends; done says so and tests it", async () => {
    let status = "waiting";
    const t = listWith({
      answer: listOf({ servers: [linearRow({ signIn: { state: "asks", host: HOST } })] }),
      reply: (p, m) => {
        if (p === "/mcp-servers/sign-in" && m === "POST") return { id: "id1", url: PAGE, host: HOST };
        if (p === "/mcp-servers/sign-in/id1") return { status, words: status === "done" ? `Signed in on ${HOST}` : "", name: "linear", host: HOST };
        if (p === "/mcp-servers/test") return { ok: true, words: "1 tool: 1 only read" };
        return undefined;
      },
    });
    await flush();
    t.setAnswer(listOf({ servers: [linearRow({ signIn: { state: "waiting", host: HOST, id: "id1", page: PAGE } })] }));
    button(t.el, "Sign in").dispatch("click");
    await flush();
    assert.deepEqual(t.calls.find((c) => c.path === "/mcp-servers/sign-in"), { path: "/mcp-servers/sign-in", method: "POST", body: { scope: "all", name: "linear" } });
    assert.deepEqual(t.opened, [PAGE]);
    assert.match(textOf(t.el), /Sign in on mcp\.linear\.app's page… This waits until you do, or press Cancel/);
    assert.equal(allWith(t.el, "mcps-dot")[0].attrs.class, "mcps-dot is-wait", "the dot says it is under way, as a test's does");
    assert.equal(t.timers.length, 1, "one look waits, however many paints there were");
    await t.tick();
    assert.equal(t.timers.length, 1, "still waiting: looked at again");
    button(t.el, "Open it again").dispatch("click");
    assert.deepEqual(t.opened, [PAGE, PAGE]);
    status = "done";
    t.setAnswer(listOf({ servers: [linearRow({ signIn: { state: "in", host: HOST } })] }));
    await t.tick();
    assert.deepEqual(t.toasts.slice(-2), [[`Signed in to linear on ${HOST}; each chat has it from its next message`, undefined], ["linear: 1 tool: 1 only read", ""]]);
    assert.deepEqual(t.calls.find((c) => c.path === "/mcp-servers/test")?.body, { scope: "all", server: linearRow().spec });
    assert.equal(t.timers.length, 0, "the looking ended");
    assert.match(textOf(t.el), /Signed in on mcp\.linear\.app/);
  });

  // (fails before: yes — no Sign in anywhere)
  test("HC-144, HC-145: a failed sign-in is said in a toast; Cancel ends the wait in one call", async () => {
    const t = listWith({
      answer: listOf({ servers: [linearRow({ signIn: { state: "waiting", host: HOST, id: "id2", page: PAGE } })] }),
      reply: (p, m) => (p === "/mcp-servers/sign-in/id2" ? (m === "DELETE" ? { cancelled: true } : { status: "failed", words: "you said no on its page", name: "linear", host: HOST }) : undefined),
    });
    await flush();
    assert.equal(t.timers.length, 1, "a row found waiting is looked at too");
    await t.tick();
    assert.deepEqual(t.toasts.at(-1), ["linear's sign-in did not finish: you said no on its page", "err"]);
    button(t.el, "Cancel").dispatch("click");
    await flush();
    assert.ok(t.calls.some((c) => c.path === "/mcp-servers/sign-in/id2" && c.method === "DELETE"));
    assert.deepEqual(t.toasts.at(-1), ["The sign-in to linear is cancelled", undefined]);
  });

  // (fails before: yes — no Sign in anywhere)
  test("HC-153: a server that lets no app register asks for the client in a sheet, with the address to make it with; Sign in sends it", async () => {
    const BACK = "http://127.0.0.1:20300/api/mcp-servers/sign-in/back";
    const refusal = Object.assign(new Error("linear: mcp.linear.app lets no app register itself: give the client ID you made on its site"), { status: 409, body: { needsClient: true, host: HOST, redirectUri: BACK } });
    const t = listWith({
      answer: listOf({ servers: [linearRow({ signIn: { state: "asks", host: HOST } })] }),
      reply: (p, m, b) => (p === "/mcp-servers/sign-in" && m === "POST" ? (b.clientId ? { id: "id3", url: PAGE, host: HOST } : refusal) : undefined),
    });
    await flush();
    button(t.el, "Sign in").dispatch("click");
    await flush();
    const d = t.dialogs.at(-1);
    assert.deepEqual([d.title, d.description], ["Sign in to linear", HOST]);
    assert.match(textOf(d.body), /mcp\.linear\.app lets no app register itself\. Make an app on its site \(an OAuth app\), with this address to come back to/);
    assert.equal(textOf(allWith(d.body, "mcps-back-at")[0]), BACK);
    // (fails before: yes — found in HS-7's drive: the sheet opened on its × button, as the Add sheet did)
    assert.equal(labelled(d.body, "Client ID")[0].focused, true, "the client ID is where typing goes");
    button(d.body, "Sign in").dispatch("click");
    await flush();
    assert.equal(textOf(allWith(d.body, "mcps-error")[0]), "Give the client ID its site showed");
    labelled(d.body, "Client ID")[0].value = "  made-1 ";
    labelled(d.body, "Client secret")[0].value = "sec";
    button(d.body, "Sign in").dispatch("click");
    await flush();
    assert.deepEqual(t.calls.filter((c) => c.path === "/mcp-servers/sign-in").at(-1)?.body, { scope: "all", name: "linear", clientId: "made-1", clientSecret: "sec" });
    assert.deepEqual([d.closed, t.opened], [true, [PAGE]]);
  });

  // (fails before: yes — no Sign in or Sign out anywhere)
  test("HC-151, HC-154, HC-155: ⋯ offers Sign in or Sign out; Sign out asks first and says it; none for a server with its own header; a server with no sign-in is said", async () => {
    const t = listWith({
      answer: listOf({ servers: [linearRow({ signIn: { state: "in", host: HOST } }), linearRow({ name: "plain" }), linearRow({ name: "keyed", spec: { name: "keyed", url: "https://k.dev/mcp", headers: { Authorization: SECRET_MARK } } })] }),
      reply: (p, m, b) => {
        if (p === "/mcp-servers/sign-out") return { ...listOf(), signedOut: true, told: true };
        if (p === "/mcp-servers/sign-in" && b.name === "plain") return Object.assign(new Error("plain: x.dev offers no sign-in: give it a key in Edit, as its Authorization header"), { status: 400, body: { none: true } });
        return undefined;
      },
    });
    await flush();
    const mores = allWith(t.el, "mcps-more");
    for (const m of mores) m.dispatch("click");
    assert.deepEqual(t.menus.map((x) => x.items.map((/** @type {any} */ i) => i.label || i.type)), [
      ["Test", "Edit", "Always loaded", "Sign out", "separator", "Remove"],
      ["Test", "Edit", "Always loaded", "Sign in", "separator", "Remove"],
      ["Test", "Edit", "Always loaded", "separator", "Remove"],
    ]);
    t.menus[0].items.find((/** @type {any} */ i) => i.label === "Sign out").onClick();
    await flush();
    assert.deepEqual([t.asks[0].title, t.asks[0].confirmLabel], ["Sign out of mcp.linear.app?", "Sign out"]);
    assert.match(t.asks[0].description, /^Every chat with a server at this address loses its tools from its next message\. mcp\.linear\.app is told where it offers that/);
    assert.deepEqual(t.calls.at(-1), { path: "/mcp-servers/sign-out", method: "POST", body: { scope: "all", name: "linear" } });
    assert.deepEqual(t.toasts.at(-1), ["Signed out of mcp.linear.app; mcp.linear.app is told", undefined]);
    t.menus[1].items.find((/** @type {any} */ i) => i.label === "Sign in").onClick();
    await flush();
    assert.deepEqual(t.toasts.at(-1), ["plain: x.dev offers no sign-in: give it a key in Edit, as its Authorization header", "err"]);
    assert.equal(t.opened.length, 0, "nothing opened");
  });

  // (fails before: yes — found in HS-7's drive: a row its server had signed out kept the green dot of its last test)
  test("HC-148: a row its server signed out is red, with Sign in, whatever its last test said", async () => {
    const t = listWith({ answer: listOf({ servers: [linearRow({ signIn: { state: "ended", host: HOST, why: "invalid_grant" }, test: { ok: true, at: 1_758_000_000_000, words: "1 tool: 1 only read" } })] }) });
    await flush();
    assert.equal(allWith(t.el, "mcps-dot")[0].attrs.class, "mcps-dot is-bad");
    assert.match(textOf(t.el), /Signed out by mcp\.linear\.app: sign in again/);
    button(t.el, "Sign in");
  });

  // (fails before: yes — found in HS-7's drive: after Sign out the row kept its green test and offered no Sign in)
  test("HC-151: a row signed out of asks again: red, with Sign in, over the test it had while signed in", async () => {
    const t = listWith({ answer: listOf({ servers: [linearRow({ signIn: { state: "asks", host: HOST }, test: { ok: true, at: 1_758_000_000_000, words: "1 tool: 1 only read" } })] }) });
    await flush();
    assert.equal(allWith(t.el, "mcps-dot")[0].attrs.class, "mcps-dot is-bad");
    assert.match(textOf(t.el), /Needs you to sign in/);
    button(t.el, "Sign in");
  });

  // (fails before: yes — Remove said nothing of a sign-in)
  test("HC-152: Remove of a signed-in server says its sign-in ends, and the toast says it did", async () => {
    const t = listWith({ answer: listOf({ servers: [linearRow({ signIn: { state: "in", host: HOST } })] }), reply: (p, m) => (m === "DELETE" ? { ...listOf(), signedOut: true } : undefined) });
    await flush();
    allWith(t.el, "mcps-more")[0].dispatch("click");
    t.menus[0].items.find((/** @type {any} */ i) => i.label === "Remove").onClick();
    await flush();
    assert.match(t.asks[0].description, /Its sign-in on mcp\.linear\.app ends too, unless your list for all chats or a project's names the address\./);
    assert.deepEqual(t.toasts.at(-1), ["linear removed from all chats; signed out of mcp.linear.app too", undefined]);
  });

  // HarnessV4_Space_Plan S4b: the account a row signs in with. One account per server never reads the word.
  // (fails before: yes — a sign-in was the address's, one account)
  test("S4b: a row names its account only where the address keeps more than one, or it uses one other than main; a pick here is said", () => {
    const signed = (/** @type {Record<string, any>} */ s, /** @type {Record<string, any>} */ o = {}) => linearRow({ signIn: { host: HOST, account: "main", accounts: ["main"], ...s }, ...o });
    assert.deepEqual(signInLine(signed({ state: "in" })), { text: "Signed in on mcp.linear.app" });
    assert.equal(namesAccount(signed({ state: "in" })), false);
    assert.deepEqual(signInLine(signed({ state: "in", accounts: ["main", "work"] })), { text: "Signed in on mcp.linear.app as main" });
    assert.deepEqual(signInLine(signed({ state: "in", account: "work", accounts: ["main", "work"] })), { text: "Signed in on mcp.linear.app as work" });
    assert.deepEqual(signInLine(signed({ state: "asks", account: "work" })), { text: "work is not signed in on mcp.linear.app", bad: true });
    assert.deepEqual(signInLine(signed({ state: "ended", account: "work", accounts: ["work"], why: "invalid_grant" })), { text: "Signed out by mcp.linear.app (work): sign in again", bad: true, title: "invalid_grant" });
    assert.deepEqual(signInLine(signed({ state: "waiting", account: "work", accounts: ["main"], id: "i", page: PAGE })), { text: "Sign in on mcp.linear.app's page as work… This waits until you do, or press Cancel" });
    const picked = signed({ state: "in", account: "work", accounts: ["main", "work"] }, { own: false, account: "work", pickedHere: true });
    assert.deepEqual(rowLines(picked, "project", 1_758_000_100_000).map((l) => l.text), ["Signs in as work: picked for this project", "Signed in on mcp.linear.app as work", "Not tested since Filament started"]);
  });

  // (fails before: yes — a sign-in was the address's, one account)
  test("S4b: ⋯ offers Use for each other account and Sign in with another account…; Use writes { account }; ↺ takes the pick back; the other account's sign-in, named, is picked once done", async () => {
    const enc = encodeURIComponent("project:p1");
    const inherited = linearRow({ own: false, account: "main", signIn: { state: "in", host: HOST, account: "main", accounts: ["main", "work"] } });
    const project = (/** @type {any[]} */ servers) => listOf({ scope: "project:p1", at: "project", label: "this project", servers });
    let st = "waiting";
    const t = listWith({
      scope: "project:p1",
      at: "project",
      answer: project([inherited]),
      reply: (p, m, b) => {
        if (p === `/mcp-servers/${enc}/linear` && m === "PUT") return project([linearRow({ own: false, account: "work", pickedHere: true, signIn: { state: "in", host: HOST, account: "work", accounts: ["main", "work"] } })]);
        if (p === `/mcp-servers/${enc}/linear` && m === "DELETE") return project([inherited]);
        if (p === "/mcp-servers/sign-in" && m === "POST")
          return b.account === "bad/x" ? Object.assign(new Error("An account's name is letters, digits, space, . _ -, 32 at most (\"main\" is the first's), not \"bad/x\""), { status: 400, body: {} }) : { id: "id9", url: PAGE, host: HOST };
        if (p === "/mcp-servers/sign-in/id9") return { status: st, words: "", name: "linear", host: HOST, account: "personal" };
        if (p === "/mcp-servers/test") return { ok: true, words: "1 tool: 1 only read" };
        return undefined;
      },
    });
    await flush();
    allWith(t.el, "mcps-more")[0].dispatch("click");
    assert.deepEqual(t.menus[0].items.map((/** @type {any} */ i) => i.label || i.type), ["Test", "Edit for this project", "Always loaded", "What this project uses…", "Sign out of main", "Use work", "Sign in with another account…"]);
    t.menus[0].items.find((/** @type {any} */ i) => i.label === "Use work").onClick();
    await flush();
    assert.deepEqual(t.calls.at(-1), { path: `/mcp-servers/${enc}/linear`, method: "PUT", body: { account: "work" } });
    assert.deepEqual(t.toasts.at(-1), ["linear signs in as work for this project; from the next message", undefined]);
    assert.match(textOf(t.el), /Signs in as work: picked for this project/);
    allWith(t.el, "mcps-back")[0].dispatch("click");
    await flush();
    assert.deepEqual([t.calls.at(-1)?.path, t.calls.at(-1)?.method, t.toasts.at(-1)?.[0]], [`/mcp-servers/${enc}/linear`, "DELETE", "linear is back to what this project inherits"]);
    // Another account: its name asked; a name refused is said in the sheet; then its page, and the pick once it is done.
    allWith(t.el, "mcps-more")[0].dispatch("click");
    t.menus.at(-1).items.find((/** @type {any} */ i) => i.label === "Sign in with another account…").onClick();
    const d = t.dialogs.at(-1);
    assert.deepEqual([d.title, d.description], ["Sign in to linear with another account", HOST]);
    assert.match(textOf(d.body), /A name for the account, to tell it from the others on mcp\.linear\.app \(main, work\)\. This project signs in as it once you are signed in\./);
    const name = labelled(d.body, "The account's name")[0];
    assert.equal(name.focused, true);
    button(d.body, "Sign in").dispatch("click");
    await flush();
    assert.equal(textOf(allWith(d.body, "mcps-error")[0]), "Give the account a name");
    name.value = "bad/x";
    button(d.body, "Sign in").dispatch("click");
    await flush();
    assert.match(textOf(allWith(d.body, "mcps-error")[0]), /^An account's name is letters, digits/);
    assert.deepEqual([d.closed, t.opened], [false, []]);
    name.value = " personal ";
    button(d.body, "Sign in").dispatch("click");
    await flush();
    assert.deepEqual(t.calls.filter((c) => c.path === "/mcp-servers/sign-in").at(-1)?.body, { scope: "project:p1", name: "linear", account: "personal" });
    assert.deepEqual([d.closed, t.opened], [true, [PAGE]]);
    // Done: the place now uses personal, and the row tested is the one that signs in as it.
    // (fails before: yes — found at the live look: the row was tested as it was before, on main, and read "Not tested")
    t.setAnswer(project([linearRow({ own: false, account: "personal", pickedHere: true, spec: { name: "linear", url: "https://mcp.linear.app/mcp", account: "personal" }, signIn: { state: "in", host: HOST, account: "personal", accounts: ["main", "personal", "work"] } })]));
    st = "done";
    await t.tick();
    assert.deepEqual(t.toasts.find(([m]) => m.startsWith("Signed in to linear")), ["Signed in to linear on mcp.linear.app as personal; each chat in it has it from its next message", undefined]);
    assert.equal(t.calls.filter((c) => c.path === "/mcp-servers/test").at(-1)?.body.server.account, "personal");
  });

  // (fails before: yes — found by the Hunter on S4b: while another account's sign-in waited, the menu offered Use of the
  // account the place already signs in with, and left out the one it does not)
  test("S4b: while another account's sign-in waits, Use offers the accounts this place does not sign in with", async () => {
    const t = listWith({
      answer: listOf({ servers: [linearRow({ account: "work", signIn: { state: "waiting", host: HOST, account: "personal", accounts: ["main", "work"], id: "id7", page: PAGE } })] }),
      reply: (p) => (p === "/mcp-servers/sign-in/id7" ? { status: "waiting", words: "", name: "linear", host: HOST, account: "personal" } : undefined),
    });
    await flush();
    allWith(t.el, "mcps-more")[0].dispatch("click");
    assert.deepEqual(t.menus[0].items.filter((/** @type {any} */ i) => String(i.label || "").startsWith("Use ")).map((/** @type {any} */ i) => i.label), ["Use main"]);
  });

  // (fails before: yes — a sign-in was the address's, one account)
  test("S4b: Sign out of a named account says the others stay; the toast names it; the caller's lines go under each row", async () => {
    const t = listWith({
      answer: listOf({ servers: [linearRow({ account: "work", signIn: { state: "in", host: HOST, account: "work", accounts: ["main", "work"] } }), linearRow({ name: "gone", spec: undefined, orphan: true, on: false, own: false })] }),
      reply: (p) => (p === "/mcp-servers/sign-out" ? { ...listOf(), signedOut: true, told: true } : undefined),
      more: (r) => [{ text: `Used by ${r.name}'s dashboard` }],
    });
    await flush();
    assert.match(textOf(t.el), /Used by linear's dashboard/);
    assert.doesNotMatch(textOf(t.el), /Used by gone's/, "none under a switch with no server");
    allWith(t.el, "mcps-more")[0].dispatch("click");
    t.menus[0].items.find((/** @type {any} */ i) => i.label === "Sign out of work").onClick();
    await flush();
    assert.equal(t.asks[0].title, "Sign out of mcp.linear.app as work?");
    assert.match(t.asks[0].description, /^Every chat with a server at this address that signs in as this account loses its tools from its next message\. Its other accounts stay signed in\./);
    assert.deepEqual(t.toasts.at(-1), ["Signed out of mcp.linear.app as work; mcp.linear.app is told", undefined]);
  });
});

describe("where the list is mounted", () => {
  test("Library › Plugins & Connectors: Applies to All chats first; A project ▾ lists the projects not archived and shows that project's list", async () => {
    /** @type {any[]} */
    const menus = [];
    /** @type {string[]} */
    const paths = [];
    const body = /** @type {any} */ (fakeH("div", {}));
    const api = async (/** @type {string} */ path) => {
      paths.push(path);
      return path === "/memory/projects" ? { projects: [{ id: "p1", name: "filament", cwd: "H:/filament" }, { id: "p2", name: "old", archived: true }] } : listOf();
    };
    renderMcpServers(body, {}, /** @type {any} */ ({ h: fakeH, api, menu: (/** @type {any[]} */ items) => menus.push(items), list: { h: fakeH, drawIn: fakeDrawIn, api } }));
    assert.match(textOf(body), /^Applies to\|All chats\|A project ▾\|Your connectors: every chat has them/);
    assert.equal(allWith(body, "mcps")[0].attrs["data-scope"], "all");
    button(body, "A project ▾").dispatch("click");
    await flush();
    assert.deepEqual(menus[0].map((/** @type {any} */ i) => [i.label, i.checked]), [["filament", false]]);
    menus[0][0].onClick();
    assert.equal(allWith(body, "mcps")[0].attrs["data-scope"], "project:p1");
    assert.match(textOf(body), /\|filament ▾\|Chats in this project get yours and these\./);
    const none = /** @type {any} */ (fakeH("div", {}));
    /** @type {any[]} */
    const noneMenus = [];
    renderMcpServers(none, {}, /** @type {any} */ ({ h: fakeH, api: async (/** @type {string} */ p) => (p === "/memory/projects" ? { projects: [] } : listOf()), menu: (/** @type {any[]} */ items) => noneMenus.push(items), list: { h: fakeH, drawIn: fakeDrawIn, api: async () => listOf() } }));
    button(none, "A project ▾").dispatch("click");
    await flush();
    assert.deepEqual(noneMenus[0], [{ type: "label", label: "No projects yet: a chat's folder makes one" }]);
    // Opened from a project's door (a Space's Connections, Project settings): that project's list.
    // (fails before: yes — found at S4b's live look: the Connections sheet's door opened on All chats)
    const door = /** @type {any} */ (fakeH("div", {}));
    renderMcpServers(door, { start: "project:p1" }, /** @type {any} */ ({ h: fakeH, api, menu: () => {}, list: { h: fakeH, drawIn: fakeDrawIn, api } }));
    await flush();
    assert.equal(allWith(door, "mcps")[0].attrs["data-scope"], "project:p1");
    assert.match(textOf(door), /\|filament ▾\|Chats in this project get yours and these\./);
  });

  // (fails before: yes — the owner's word of 10-26: a Space of yours was one more project under A project ▾)
  test("Applies to: each Space of yours a button of its own, with what it passes to the projects it shows; A project ▾ lists projects alone; past three, A Space ▾", async () => {
    /** @param {number} n @param {any[]} menus */
    const mount = async (n, menus) => {
      const own = [{ project: "w1", name: "Work", shows: ["p1", "gone"] }, { project: "w2", name: "Personal" }, { project: "w3", name: "Side" }, { project: "w4", name: "Club" }].slice(0, n);
      const api = async (/** @type {string} */ path) =>
        path === "/memory/projects" ? { projects: [{ id: "p1", name: "filament" }, ...own.map((s) => ({ id: s.project, name: `${s.name}-folder` }))] }
          : path === "/spaces/own" ? { spaces: own }
            : listOf();
      const body = /** @type {any} */ (fakeH("div", {}));
      renderMcpServers(body, {}, /** @type {any} */ ({ h: fakeH, api, menu: (/** @type {any[]} */ items) => menus.push(items), list: { h: fakeH, drawIn: fakeDrawIn, api } }));
      await flush();
      return body;
    };
    /** @type {any[]} */
    const menus = [];
    const body = await mount(2, menus);
    assert.match(textOf(body), /^Applies to\|All chats\|Work\|Personal\|A project ▾\|Your connectors/);
    button(body, "Work").dispatch("click");
    assert.equal(allWith(body, "mcps")[0].attrs["data-scope"], "project:w1");
    assert.match(textOf(body), /\|A project ▾\|Chats in this Space and in the project it shows get yours and these\./);
    assert.deepEqual(["All chats", "Work", "Personal", "A project ▾"].map((b) => button(body, b).classList.contains("on")), [false, true, false, false]);
    button(body, "Personal").dispatch("click");
    assert.match(textOf(body), /\|Chats in this Space get yours and these\./);
    button(body, "A project ▾").dispatch("click");
    await flush();
    assert.deepEqual(menus[0].map((/** @type {any} */ i) => i.label), ["filament"], "your Spaces are not projects to pick");
    /** @type {any[]} */
    const four = [];
    const folded = await mount(4, four);
    assert.match(textOf(folded), /^Applies to\|All chats\|A Space ▾\|A project ▾\|/);
    button(folded, "A Space ▾").dispatch("click");
    assert.deepEqual(four[0].map((/** @type {any} */ i) => i.label), ["Work", "Personal", "Side", "Club"]);
    four[0][2].onClick();
    assert.equal(allWith(folded, "mcps")[0].attrs["data-scope"], "project:w3");
    assert.match(textOf(folded), /\|Side ▾\|A project ▾\|Chats in this Space get yours and these\./);
  });

  // (fails before: yes — the row showed the merged list, and Apply wrote every layer's servers into the chat's own)
  test("HS-D7 in the shared editor: plugins.mcp's JSON row edits the layer's own list, not the merged one", () => {
    const k = { type: KNOBS["plugins.mcp"].type, default: KNOBS["plugins.mcp"].default, phase: 1, live: true, doc: "" };
    const yours = { name: "github", command: "npx" };
    const own = { name: "notes", command: "node" };
    const view = /** @type {any} */ ({ mode: "session", flat: { "plugins.mcp": [yours, own] }, sources: { "plugins.mcp": "session" }, own: "session" });
    const chatRow = textOf(knobRow("plugins.mcp", k, { layers: { session: { plugins: { mcp: [own] } } } }, { change() {} }, view, /** @type {any} */ (fakeH)));
    assert.match(chatRow, /"notes"/);
    assert.doesNotMatch(chatRow, /"github"/);
    const projectRow = textOf(knobRow("plugins.mcp", k, { layer: { "plugins.mcp": [own] } }, { change() {} }, { ...view, mode: "project" }, /** @type {any} */ (fakeH)));
    assert.doesNotMatch(projectRow, /"github"/);
  });

  // (proposal_ux R1: the inspector's Rules tab became Overview's sheets — the list sits on What it may do, and the rules
  // sheet's row points there)
  test("a chat's What it may do sheet draws the shared list, the rules sheet points to it; the editor takes a page's part by path", () => {
    const sheet = read("src/ui/harness/setup-sheet.js");
    assert.match(sheet, /mcp \|\|= spec\.mcp \? createMcpList\(\{ scope: `chat:\$\{chainId\}`, at: "session", onToast: o\.onToast, title: "Connectors for this chat", openPlugin: [^\n]*\}\) : null;/);
    assert.match(sheet, /may: \{ title: "What it may do", [^\n]*mcp: true \}/);
    assert.match(sheet, /const parts = id === "rules" \? \{ "plugins\.mcp": mcpElsewhere\(\) \} : \{\};/);
    assert.match(read("src/ui/lib/settings/editor.js"), /paths\.map\(\(p\) => parts\[p\] \|\| knobRow\(p, knobs\[p\], doc, cb, view\)\)/);
  });

  // (fails before: yes — the board's "manage" for agents that start by themselves opened Coding agents, not Agents)
  test("the page's ways out: connectors from the board to the Library, saved agents from their cards to the Library, accounts to Coding agents", () => {
    const app = read("src/ui/harness/app.js");
    assert.match(app, /manageMcp: \(\) => \{ location\.hash = routeFor\("library", \{ page: "connectors" \}\); \}/);
    assert.match(app, /manageAgents: \(\) => \{ location\.hash = routeFor\("library", \{ page: "agents" \}\); \}/);
    assert.match(app, /switchTo: [^\n]*\n\s*manage: \(\) => \{ location\.hash = routeFor\("settings", \{ section: "agents" \}\); \}/);
  });
});

describe("a plugin's connectors (the Designer's of 10-26)", () => {
  /** A plugin's server's row as the list answers it. @param {Record<string, any>} [o] */
  const theirs = (o = {}) => row({ name: "guard-notes", spec: { name: "guard-notes", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/server.mjs"] }, from: "plugin", own: false, plugin: "guard@e50", pluginTitle: "guard", load: "on-demand", ...o });

  // (fails before: yes — a plugin's servers were in no list)
  test("a row says the plugin it comes with and where it is on; one waiting for a value says what and where; one of yours of its name says what it keeps out", () => {
    const now = 1_758_000_100_000;
    assert.deepEqual(chipOf(theirs(), "global"), { words: "from guard", here: false });
    assert.deepEqual(rowLines(theirs(), "global", now).map((l) => l.text), ["On where guard is on (Library › Plugins & Connectors)", "Not tested since Filament started"]);
    const off = theirs({ on: false, switchedAt: "project", switchedHere: true });
    assert.deepEqual([chipOf(off, "project").words, rowLines(off, "project", now)[0].text], ["off for this project", "On where guard is on; this project switched it off"]);
    const waits = theirs({ on: false, waits: ["Token", "Team"] });
    assert.deepEqual(chipOf(waits, "global"), { words: "from guard", here: false });
    assert.deepEqual(rowLines(waits, "global", now), [{ text: "Needs its token and team", bad: true }]);
    assert.deepEqual(rowLines(waits, "session", now), [{ text: "Needs its token and team", bad: true }], "the same in a chat's own list: its Finish setup… sets it");
    assert.deepEqual([needsWords(["Personal access token"]), needsWords(["API key", "Workspace"]), needsWords(["A", "B", "C"])], ["Needs its personal access token", "Needs its API key and workspace", "Needs 3 values"]);
    assert.equal(signInOf(theirs({ spec: { name: "guard-notes", url: "https://x.test/mcp" }, waits: ["Token"] })).can, false, "nothing to sign in to before its value");
    const mine = row({ name: "guard-notes", hides: { plugin: "guard@e50", title: "guard" } });
    assert.deepEqual(rowLines(mine, "global", now).map((l) => l.text), ["Keeps out guard's connector of this name", "Not tested since Filament started"]);
  });

  // (fails before: yes — the owner's of 11-09: on Library › Plugins & Connectors a plugin's connector said "On where guard
  // is on (Library › Plugins & Connectors)", pointing at the page it was on)
  test("on Library › Plugins & Connectors its row names no page, the one it is on; a chat's own list still names it", async () => {
    const body = /** @type {any} */ (fakeH("div", {}));
    const api = async (/** @type {string} */ path) => (path === "/memory/projects" ? { projects: [] } : listOf({ servers: [theirs()] }));
    renderMcpServers(body, {}, /** @type {any} */ ({ h: fakeH, api, menu: () => {}, list: { h: fakeH, drawIn: fakeDrawIn, api } }));
    await flush();
    assert.match(textOf(body), /\|On where guard is on\|/, textOf(body));
    assert.doesNotMatch(textOf(body), /\(Library › Plugins & Connectors\)/);
    const chat = listWith({ scope: "chat:c1", at: "session", answer: listOf({ scope: "chat:c1", at: "session", label: "this chat", servers: [theirs()] }) });
    await flush();
    assert.match(textOf(chat.el), /\|On where guard is on \(Library › Plugins & Connectors\)\|/, textOf(chat.el));
  });

  test("its ⋯: Test by its name, Always loaded, and Open in Library › Plugins & Connectors — no Edit, Remove or switch; waiting, only Open", async () => {
    /** @type {string[]} */
    const opened = [];
    const t = listWith({ answer: listOf({ servers: [theirs(), theirs({ name: "guard-remote", on: false, waits: ["Token"] })] }), openPlugin: (id) => opened.push(id), reply: (p) => (p === "/mcp-servers/test" ? { ok: true, words: "1 tool: 1 only read" } : undefined) });
    await flush();
    assert.equal(allWith(t.el, "set-switch").length, 0, "no switch of its own");
    const [ready, waiting] = allWith(t.el, "mcps-more");
    ready.dispatch("click");
    assert.deepEqual(t.menus[0].items.map((/** @type {any} */ i) => i.label || i.type), ["Test", "Always loaded", "separator", "Open guard in Library › Plugins & Connectors"]);
    t.menus[0].items[0].onClick();
    await flush();
    assert.deepEqual(t.calls.at(-2), { path: "/mcp-servers/test", method: "POST", body: { scope: "all", server: { name: "guard-notes", plugin: true } } }, "by its name: the page holds no value of it");
    t.menus[0].items[3].onClick();
    assert.deepEqual(opened, ["guard@e50"]);
    waiting.dispatch("click");
    assert.deepEqual(t.menus[1].items.map((/** @type {any} */ i) => i.label || i.type), ["Open guard in Library › Plugins & Connectors"]);
  });

  // (fails before: yes — Add opened the hand-made form alone, a waiting row sent you to the plugin's sheet, and a
  // connector added from a marketplace could not be removed from its row)
  test("Add connector opens the marketplaces' connectors for all chats and a project, the form for a chat; Finish setup… opens its second step for the place its plugin is on, a chat's list too; Remove turns a connector-only plugin off here", async () => {
    const t = listWith({ answer: listOf({ servers: [theirs({ name: "github", plugin: "github@official", pluginTitle: "GitHub", pluginOnly: true, on: false, waits: ["Personal access token"] })] }) });
    await flush();
    button(t.el, "Add connector").dispatch("click");
    assert.deepEqual([t.picks.length, t.picks[0].scope, t.picks[0].at, t.picks[0].label, t.picks[0].finish], [1, "all", "global", "all chats", undefined]);
    assert.equal(t.dialogs.length, 0, "the form waits behind Not listed?");
    t.picks[0].onManual();
    assert.equal(t.dialogs.at(-1).title, "Add an MCP server");
    const [r] = allWith(t.el, "mcps-row");
    assert.match(textOf(r), /Needs its personal access token/);
    button(r, "Finish setup…").dispatch("click");
    assert.deepEqual([t.picks.length, t.picks[1].finish, t.picks[1].finishTitle, t.picks[1].scope], [2, "github@official", "GitHub", "all"]);
    allWith(t.el, "mcps-more")[0].dispatch("click");
    t.menus[0].items.find((/** @type {any} */ i) => i.label === "Remove").onClick();
    await flush();
    assert.deepEqual([t.asks[0].title, t.asks[0].description], ["Remove GitHub from all chats?", "Chats lose its tools from their next message. Add it again from Add connector at any time."]);
    assert.deepEqual(t.calls.find((c) => c.method === "POST"), { path: "/plugins/installed/github%40official/on", method: "POST", body: { place: "all", on: false } }, "turned off here: nothing is uninstalled");
    assert.deepEqual(t.toasts.at(-1), ["GitHub removed from all chats", undefined]);
    const chat = listWith({ scope: "chat:c1", at: "session", answer: listOf({ scope: "chat:c1", at: "session", label: "this chat", servers: [theirs({ pluginOnly: true, waits: ["Token"], pluginPlace: "project:p1" })] }) });
    await flush();
    button(chat.el, "Add for this chat only").dispatch("click");
    assert.deepEqual([chat.picks.length, chat.dialogs.at(-1)?.title], [0, "Add an MCP server"], "a chat's own Add is the form: the marketplaces' are added for a place");
    // (fails before: yes, found by the Designer — a chat's waiting row sent you to Library › Connectors, which opens on
    // all chats, where a plugin on for one project is not listed)
    button(chat.el, "Finish setup…").dispatch("click");
    assert.deepEqual([chat.picks[0].finish, chat.picks[0].scope, chat.picks[0].at, chat.picks[0].label], ["guard@e50", "project:p1", "project", ""], "for the place its plugin is on: the sheet's own line names it");
  });
});

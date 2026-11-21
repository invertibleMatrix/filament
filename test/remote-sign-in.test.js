// @ts-check
// The owner's remote Filament of 11-06, p4-signins: signing in from a page on another machine. Codex's sign-in sheet
// picks its code first there (ui/harness/sign-in.js), as ChatGPT's page way comes back to Filament's computer alone. An
// MCP server's sign-in says to finish on that machine, or takes the address the browser came back to, pasted
// (ui/harness/lib/mcp-list.js, http/admin/mcp-servers.js). And the return to 127.0.0.1 that lands on the laptop's own
// Filament is taken there by nothing: the code reaches the Filament that started the sign-in alone, by the paste.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANOTHER_COMPUTER_NOTE, ANOTHER_COMPUTER_WAYS, fromAnotherComputer, openSignIn } from "../src/ui/harness/sign-in.js";
import { comesBackHere, createMcpList } from "../src/ui/harness/lib/mcp-list.js";
import { ANOTHER_FILAMENT_WORDS, mcpServerRoutes } from "../src/http/admin/mcp-servers.js";
import { CodexBridge } from "../src/adapters/agents/codex/bridge.js";
import { BACK_PATH, createMcpSignIns } from "../src/app/sessions/mcp-sign-in.js";
import { createSignInStore } from "../src/services/mcp-sign-ins.js";
import { createRouter } from "../src/http/router.js";
import { pressAllow, startOAuthMcp } from "./helpers/oauth-mcp-fake.js";
import { buttonsOf, fakeDrawIn, fakeH, textOf } from "./helpers/fake-dom.js";

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

/** Pages' addresses: over tailscale serve, the network listener's https, and this computer's own. */
const TAILNET = { protocol: "https:", hostname: "studio.tail1234.ts.net", port: "" };
const LAN = { protocol: "https:", hostname: "192.168.1.20", port: "20343" };
const HERE = { protocol: "http:", hostname: "127.0.0.1", port: "20300" };
/** An SSH tunnel to the machine on another port of the laptop: the server sees this computer, the page does not. */
const TUNNEL = { protocol: "http:", hostname: "localhost", port: "9000" };

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
/** The control under `el` named `label` for a screen reader. @param {any} el @param {string} label */
const labelled = (el, label) => {
  /** @type {any} */
  let found = null;
  const walk = (/** @type {any} */ n) => {
    if (!n || typeof n !== "object" || found) return;
    if (n.attrs?.["aria-label"] === label) found = n;
    for (const k of n.kids || []) walk(k);
  };
  walk(el);
  assert.ok(found, `"${label}" in: ${textOf(el)}`);
  return found;
};
const button = (/** @type {any} */ el, /** @type {string} */ words) => {
  const b = buttonsOf(el).find((x) => textOf(x) === words);
  assert.ok(b, `a button "${words}" in: ${textOf(el)}`);
  return b;
};

describe("Codex's sign-in from another computer (ui/harness/sign-in.js)", () => {
  // (fails before: yes — there was no telling where the page is)
  test("a page reached by a name or address of the network is on another computer; one at this computer's loopback, or with no address, is not", () => {
    for (const h of [TAILNET, LAN, { hostname: "[fd7a:115c:a1e0::5]" }]) assert.equal(fromAnotherComputer(h), true, h.hostname);
    for (const h of [HERE, TUNNEL, { hostname: "[::1]" }, { hostname: "app.localhost" }, { hostname: "127.0.0.2" }, {}, null]) assert.equal(fromAnotherComputer(h), false, JSON.stringify(h));
  });

  /**
   * The sheet for a Codex account that is signed out, from a page at `here`, over Codex's own ways as the server shows
   * them; every call kept.
   * @param {any[]} ways @param {any} here
   */
  const codexSheet = (ways, here) => {
    const row = { upstream: "cx", agent: "codex", agentName: "Codex", type: "codex", label: "Default", added: false, account: null, signingIn: null, lastSignIn: null };
    /** @type {[string, string, any][]} */
    const calls = [];
    /** @type {any[]} */
    const sheets = [];
    openSignIn("cx", { keeper: /** @type {any} */ ({ rows: () => [row], listen: () => () => {}, check: async () => {} }) }, {
      h: /** @type {any} */ (fakeH),
      here,
      api: async (path, init = {}) => {
        calls.push([init.method || "GET", path, init.body]);
        return init.body?.way ? { ok: true, line: "codex login" } : { ok: true, choose: ways };
      },
      sheet: /** @type {any} */ ((/** @type {any} */ x) => {
        const s = { ...x, close() {} };
        sheets.push(s);
        return s;
      }),
      show: /** @type {any} */ (() => ({ focus() {}, ended: () => false, dispose() {} })),
      open: () => {},
      copy: async () => {},
    });
    return { calls, sheet: sheets[0] };
  };

  // (fails before: yes — the first way was picked wherever the page was: ChatGPT's page, whose return reaches
  // localhost on Filament's computer alone, never the laptop's browser)
  test("from another computer its code is picked first, said under the ways, and Continue starts it; from this computer ChatGPT's page stays first", async () => {
    // Codex's ways as its bridge names them, as the server shows them (app/agent-logins.js `shown`).
    const ways = (await CodexBridge.prototype.signInWays.call(null)).map(({ id, name, description }) => ({ id, name, description }));
    assert.deepEqual(ways.map((w) => w.id), ["chatgpt", ...ANOTHER_COMPUTER_WAYS, "api-key"], "its page first, its code second, a key last");
    for (const [here, picked, note] of /** @type {const} */ ([[TAILNET, "chatgpt-code", ANOTHER_COMPUTER_NOTE], [LAN, "chatgpt-code", ANOTHER_COMPUTER_NOTE], [HERE, "chatgpt", ""], [null, "chatgpt", ""]])) {
      const s = codexSheet(ways, here);
      await flush();
      assert.match(textOf(s.sheet.body), /^How do you want to sign in\?\|ChatGPT\|/);
      assert.deepEqual(allWith(s.sheet.body, "si-way").map((w) => w.attrs["aria-checked"]), ways.map((w) => (w.id === picked ? "true" : "false")), `${here?.hostname}: ${picked} is picked`);
      assert.equal(textOf(allWith(s.sheet.foot, "tk-foot-note")[0]), note);
      button(s.sheet.foot, "Continue").dispatch("click");
      await flush();
      assert.deepEqual(s.calls, [["POST", "/agent-accounts/cx/sign-in", {}], ["POST", "/agent-accounts/cx/sign-in", { way: picked }]]);
    }
  });

  // (fails before: no — a guard: a pick the person made stands, and an agent with no code way is not touched)
  test("the person's own pick stands, and an agent whose ways have no code keeps its first", async () => {
    const ways = (await CodexBridge.prototype.signInWays.call(null)).map(({ id, name, description }) => ({ id, name, description }));
    const s = codexSheet(ways, TAILNET);
    await flush();
    allWith(s.sheet.body, "si-way")[0].dispatch("click");
    button(s.sheet.foot, "Continue").dispatch("click");
    await flush();
    assert.deepEqual(s.calls.at(-1), ["POST", "/agent-accounts/cx/sign-in", { way: "chatgpt" }]);
    const claude = codexSheet([{ id: "claude-ai-login", name: "Claude Subscription", description: "" }, { id: "console-login", name: "Anthropic Console", description: "" }], TAILNET);
    await flush();
    assert.deepEqual(allWith(claude.sheet.body, "si-way").map((w) => w.attrs["aria-checked"]), ["true", "false"]);
    assert.equal(textOf(allWith(claude.sheet.foot, "tk-foot-note")[0]), "");
  });
});

describe("an MCP server's sign-in from a page on another machine: the admin rows (http/admin/mcp-servers.js)", () => {
  const root = mkdtempSync(join(tmpdir(), "filament-remote-signin-"));
  after(() => rmSync(root, { recursive: true, force: true }));
  /** A caller on another machine: the tailnet's address. */
  const FAR = "100.64.0.7";
  /**
   * A Filament on port 4321 — the machine a page reaches, or the laptop's own on the same port —, its MCP sign-in rows
   * answered as the admin handler hands them a path; every address its sign-ins asked for kept.
   * @param {string} name  its machine's name
   */
  const filament = (name) => {
    /** @type {string[]} */
    const asked = [];
    /** @type {typeof fetch} */
    const fetchImpl = (u, init) => {
      asked.push(String(u instanceof Request ? u.url : u));
      return fetch(u, init);
    };
    const store = createSignInStore({ dataDir: join(root, name) });
    const signIns = createMcpSignIns({ store, selfBase: () => "http://127.0.0.1:4321", fetchImpl });
    /** Its servers by name, at their addresses. @type {Map<string, string>} */
    const servers = new Map();
    const mcpServers = {
      signIn: (/** @type {string} */ _scope, /** @type {string} */ server, /** @type {any} */ o) => {
        const url = servers.get(server);
        if (!url) throw Object.assign(new Error(`no server ${server}`), { status: 404 });
        return signIns.start({ name: server, url, ...o });
      },
    };
    const a = { mcpServers, mcpSignIns: signIns, machine: { get: () => ({ id: `m-${name}`, name }) } };
    const route = createRouter(mcpServerRoutes(a));
    /** @param {string} method @param {string} path @param {any} [body] @param {string} [from] @param {Record<string, string>} [headers] */
    const call = async (method, path, body = undefined, from = "127.0.0.1", headers = {}) => {
      const url = new URL(`http://x${path.replace(/^\/api(?=\/)/, "")}`);
      const m = route(method, url.pathname);
      assert.ok(m, `${method} ${path} has a row`);
      let out = "";
      let status = 0;
      const res = /** @type {any} */ ({
        headersSent: false,
        setHeader() {},
        writeHead(/** @type {number} */ s) { status = s; this.headersSent = true; return this; },
        write(/** @type {string} */ c) { out += c; },
        end(/** @type {string} */ c = "") { out += c; },
        on() {},
      });
      const req = { headers, method, socket: { remoteAddress: from }, on() {} };
      await m.handler({ req, res, url, path: url.pathname, method, params: m.params, json: async () => body }, a);
      return { status, text: out, body: out.startsWith("{") ? JSON.parse(out) : null };
    };
    return { asked, store, signIns, servers, call };
  };
  const BACK = `http://127.0.0.1:4321${BACK_PATH}`;
  /** @type {any} */
  let f;
  after(() => f?.close());
  const studio = filament("studio");
  /** @type {any} */
  let st;

  // (fails before: yes — a page elsewhere was refused in words alone, which said nothing of a way from there)
  test("a page elsewhere is told where the server's page sends its browser, and nothing starts; saying it pastes, its sign-in starts, the browser sent back to 127.0.0.1", async () => {
    f = await startOAuthMcp();
    studio.servers.set("linear", f.url);
    for (const [from, headers] of /** @type {const} */ ([[FAR, {}], ["127.0.0.1", { "x-forwarded-for": FAR, "tailscale-user-login": "me@example.com" }]])) {
      const told = await studio.call("POST", "/mcp-servers/sign-in", { scope: "all", name: "linear" }, from, headers);
      assert.equal(told.status, 400, from);
      assert.deepEqual([told.body.elsewhere, told.body.machine], [true, "studio"]);
      assert.match(told.body.error, /^Sign in from a browser on Filament's computer \(studio\), or paste the address the server's page sends this browser to: it goes back to 127\.0\.0\.1/);
    }
    assert.deepEqual(studio.asked, [], "nothing was asked of the server");
    assert.equal(studio.signIns.stateOf(f.url, {}), null, "nothing waits");
    st = (await studio.call("POST", "/mcp-servers/sign-in", { scope: "all", name: "linear", paste: true }, FAR)).body;
    assert.deepEqual(Object.keys(st).sort(), ["host", "id", "url"]);
    assert.equal(new URL(st.url).searchParams.get("redirect_uri"), BACK);
    assert.equal(studio.signIns.stateOf(f.url, {})?.state, "waiting");
  });

  // (fails before: yes — nothing took a pasted address, and the laptop's Filament said only that it was not waiting)
  test("the browser lands on the laptop's own Filament at 127.0.0.1: it takes nothing and says whose it may be; pasted on the page, the Filament that started it signs in, asking nothing of that address", async () => {
    const landedAt = await pressAllow(st.url);
    assert.equal(landedAt.origin + landedAt.pathname, BACK);
    const laptop = filament("laptop");
    const landed = await laptop.call("GET", `${landedAt.pathname}${landedAt.search}`);
    assert.equal(landed.status, 400);
    assert.match(landed.text, /<title>Filament · Not signed in<\/title>[\s\S]*Filament is not waiting for this sign-in/);
    assert.ok(landed.text.includes(`<p>${ANOTHER_FILAMENT_WORDS.replace(/'/g, "&#39;")}</p>`), landed.text);
    assert.deepEqual([laptop.store.addresses(), laptop.asked, laptop.signIns.stateOf(f.url, {})], [[], [], null], "the laptop's Filament keeps nothing and asks nothing");
    const pasted = await studio.call("POST", "/mcp-servers/sign-in", { pasted: `  ${landedAt.href}\n` }, FAR);
    assert.deepEqual([pasted.status, pasted.body], [200, { ok: true, words: "Signed in to linear: you can close this tab and go back to Filament." }]);
    assert.deepEqual(studio.signIns.status(st.id), { status: "done", words: `Signed in on ${st.host}`, name: "linear", host: st.host });
    assert.equal(studio.signIns.stateOf(f.url, {})?.state, "in");
    assert.ok(!studio.asked.some((u) => u.includes(BACK_PATH)), `the pasted address was never asked: ${studio.asked.join(", ")}`);
    const again = await studio.call("POST", "/mcp-servers/sign-in", { pasted: landedAt.href }, FAR);
    assert.equal(again.status, 400, "a return is taken once");
    assert.match(again.body.error, /^Filament is not waiting for this sign-in/);
    // A return the Filament that started it does not take says nothing of another machine's.
    const own = await studio.call("GET", `${landedAt.pathname}${landedAt.search.replace(/code=[^&]*&?/, "")}`);
    assert.ok(!own.text.includes("another machine"), "no code: nobody's to paste");
    // (fails before: yes — the hunt of p4-signins: a return this Filament waited for, whose exchange failed, said to
    // paste it on another machine) Started here, its code refused: said as that, nothing of another machine's.
    const mine = (await studio.call("POST", "/mcp-servers/sign-in", { scope: "all", name: "linear" })).body;
    const came = await pressAllow(mine.url);
    const failed = await studio.call("GET", `${came.pathname}${came.search.replace(/code=[^&]*/, "code=not-a-code")}`);
    assert.match(failed.text, /linear&#39;s sign-in did not finish: [^<]*invalid_grant/);
    assert.ok(!failed.text.includes(ANOTHER_FILAMENT_WORDS.replace(/'/g, "&#39;")), failed.text);
  });

  // (fails before: yes — nothing took a pasted address)
  test("what is pasted must be where a sign-in came back to, with its state; a page that said no there is said as its return would say it", async () => {
    for (const junk of ["", "   ", "not an address", "https://mcp.example.com/authorize?state=s", `${BACK}?code=c-1`, 42, null])
      assert.deepEqual(
        await studio.call("POST", "/mcp-servers/sign-in", { pasted: junk }, FAR).then((r) => [r.status, /^That is not the address the sign-in came back to: paste the whole address from the browser's address bar/.test(r.body.error)]),
        [400, true],
        String(junk),
      );
    const next = (await studio.call("POST", "/mcp-servers/sign-in", { scope: "all", name: "linear", paste: true }, FAR)).body;
    const state = new URL(next.url).searchParams.get("state");
    const said = await studio.call("POST", "/mcp-servers/sign-in", { pasted: `${BACK}?error=access_denied&state=${state}` }, FAR);
    assert.deepEqual([said.status, said.body], [400, { error: "linear's sign-in did not finish: you said no on its page." }]);
    assert.equal(studio.signIns.status(next.id).status, "failed");
  });

  // (fails before: no — a guard: a page on this computer signs in as it did)
  test("a page on this computer starts its sign-in as before, with nothing to paste", async () => {
    const here = await studio.call("POST", "/mcp-servers/sign-in", { scope: "all", name: "linear" });
    assert.equal(here.status, 200, here.text);
    assert.deepEqual(Object.keys(here.body).sort(), ["host", "id", "url"]);
    studio.signIns.cancel(here.body.id);
  });
});

describe("an MCP server's sign-in from a page on another machine: the list (ui/harness/lib/mcp-list.js)", () => {
  const HOST = "mcp.linear.app";
  const BACK = `http://127.0.0.1:20300${BACK_PATH}`;
  const PAGE = `https://mcp.linear.app/authorize?client_id=c&redirect_uri=${encodeURIComponent(BACK)}&state=s1`;
  const LANDED = `${BACK}?code=c-1&state=s1`;

  // (fails before: yes — a sign-in page's return was not read)
  test("a sign-in page sends the browser back here where this page is Filament's own address, by any loopback name; elsewhere — the tailnet, the network, a tunnel on another port — it does not", () => {
    for (const here of [HERE, { ...HERE, hostname: "localhost" }, { ...HERE, hostname: "[::1]" }]) assert.equal(comesBackHere(PAGE, here), true, here.hostname);
    for (const here of [TAILNET, LAN, TUNNEL, { protocol: "http:", hostname: "192.168.1.20", port: "20300" }]) assert.equal(comesBackHere(PAGE, here), false, `${here.hostname}:${here.port}`);
    assert.equal(comesBackHere(PAGE, null), true, "no page address: as before");
    assert.equal(comesBackHere("https://mcp.linear.app/authorize?state=s", TAILNET), true, "no return named: as before");
  });

  /** One row of a list answer. @param {Record<string, any>} [o] */
  const linearRow = (o = {}) => ({
    name: "linear", kind: "http", spec: { name: "linear", url: "https://mcp.linear.app/mcp" }, sse: false, from: "global", on: true, switchedAt: null,
    replaces: null, orphan: false, own: true, switchedHere: false, test: null, signIn: null, ...o,
  });
  /** @param {any[]} servers */
  const listOf = (servers) => ({ scope: "all", at: "global", label: "all chats", projectId: null, held: false, unread: [], servers });

  /**
   * The list on the fake DOM, on a page at `here`, with a recording server, dialog and timer.
   * @param {any} here @param {any} answer @param {(path: string, method: string, body: any) => any} reply
   */
  const listAt = (here, answer, reply) => {
    /** @type {{ path: string, method: string, body: any }[]} */
    const calls = [];
    /** @type {[string, string | undefined][]} */
    const toasts = [];
    /** @type {any[]} */
    const dialogs = [];
    /** @type {string[]} */
    const opened = [];
    /** @type {(() => void)[]} */
    const timers = [];
    /** @type {any[][]} */
    const menus = [];
    let now = answer;
    const list = createMcpList(
      { scope: "all", onToast: (msg, kind) => toasts.push([msg, kind]), now: () => 1_758_000_100_000 },
      /** @type {any} */ ({
        h: fakeH, drawIn: fakeDrawIn, here,
        api: async (/** @type {string} */ path, /** @type {any} */ opts = {}) => {
          const method = opts.method || "GET";
          calls.push({ path, method, body: opts.body });
          const r = await reply(path, method, opts.body);
          if (r instanceof Error) throw r;
          return r !== undefined ? r : now;
        },
        dialog: (/** @type {any} */ d) => {
          const rec = { ...d, closed: false, close() { rec.closed = true; } };
          dialogs.push(rec);
          return rec;
        },
        menu: (/** @type {any[]} */ items) => void menus.push(items), confirm: async () => true, open: (/** @type {string} */ u) => opened.push(u), later: (/** @type {() => void} */ fn) => timers.push(fn),
      }),
    );
    const tick = async () => {
      for (const fn of timers.splice(0)) fn();
      await flush();
    };
    return { el: /** @type {any} */ (list.el), refresh: list.refresh, calls, toasts, dialogs, opened, menus, tick, setAnswer: (/** @type {any} */ a) => { now = a; } };
  };
  const refusal = (/** @type {string} */ words, /** @type {any} */ body) => Object.assign(new Error(words), { status: 400, body: { error: words, ...body } });
  /** The sign-in rows of a Filament on the machine "studio", which sees the page as another machine's where `far`. @param {boolean} far @param {() => string} status */
  const studioRows = (far, status) => (/** @type {string} */ p, /** @type {string} */ m, /** @type {any} */ b) => {
    if (p === "/mcp-servers/sign-in" && m === "POST") {
      if (b.pasted !== undefined) return b.pasted === LANDED ? { ok: true, words: "Signed in to linear: you can close this tab and go back to Filament." } : refusal("That is not the address the sign-in came back to: paste the whole address from the browser's address bar", {});
      return far && !b.paste ? refusal("Sign in from a browser on Filament's computer (studio), or paste…", { elsewhere: true, machine: "studio" }) : { id: "id1", url: PAGE, host: HOST };
    }
    if (p === "/mcp-servers/sign-in/id1") return { status: status(), words: status() === "done" ? `Signed in on ${HOST}` : "", name: "linear", host: HOST };
    if (p === "/mcp-servers/test") return { ok: true, words: "1 tool: 1 only read" };
    return undefined;
  };

  // (fails before: yes — the server's refusal was a toast, and nothing offered a way from there)
  test("from another machine, Sign in says where the page sends the browser back before anything opens; Sign in here opens it and takes the address it lands on, never opened here", async () => {
    let status = "waiting";
    const t = listAt(TAILNET, listOf([linearRow({ signIn: { state: "asks", host: HOST } })]), studioRows(true, () => status));
    await flush();
    button(t.el, "Sign in").dispatch("click");
    await flush();
    assert.deepEqual(t.opened, [], "nothing opens before the person chooses");
    const far = t.dialogs.at(-1);
    assert.deepEqual([far.title, far.description], ["Sign in to linear", HOST]);
    assert.deepEqual(textOf(far.body).split("|"), [
      "mcp.linear.app's sign-in page sends your browser back to 127.0.0.1, which is Filament only on studio.",
      "On studio: open Filament there and press Sign in on this row. Every chat that has it is signed in, wherever you reach Filament from.",
      "Here: sign in on its page in this browser. Your browser then lands on an address that does not open, or opens this computer's own Filament, which leaves it alone: copy that address and paste it in the next step.",
      "Close", "Sign in here",
    ]);
    t.setAnswer(listOf([linearRow({ signIn: { state: "waiting", host: HOST, id: "id1", page: PAGE } })]));
    button(far.body, "Sign in here").dispatch("click");
    await flush();
    assert.equal(far.closed, true);
    assert.deepEqual(t.calls.filter((c) => c.path === "/mcp-servers/sign-in").map((c) => c.body), [{ scope: "all", name: "linear" }, { scope: "all", name: "linear", paste: true }]);
    // (fails before: yes — the hunt of p4-signins: the page opened once the server answered, which a browser blocks as
    // a popup, and the sheet said it was open) Opened by the person's own press on the sheet.
    assert.deepEqual(t.opened, [], "a page opened after the server's answer is a popup a browser blocks");
    const paste = t.dialogs.at(-1);
    assert.deepEqual([t.dialogs.length, paste.title, paste.description], [2, "Sign in to linear", HOST]);
    assert.match(textOf(paste.body), /^Open mcp\.linear\.app's page in this browser and sign in there\. It then sends the browser to 127\.0\.0\.1:20300, which is Filament only on studio: here that page does not open, or this computer's own Filament says it is not waiting for it\. Copy the whole address from the address bar and paste it here\.\|Address\|/);
    button(paste.body, "Open its page").dispatch("click");
    assert.deepEqual(t.opened, [PAGE]);
    const field = labelled(paste.body, "The address it came back to");
    assert.deepEqual([field.focused, field.attrs.placeholder], [true, `${BACK}?code=…`]);
    button(paste.body, "Finish").dispatch("click");
    await flush();
    assert.equal(textOf(allWith(paste.body, "mcps-error")[0]), "Paste the address its page sent your browser to");
    field.value = PAGE;
    button(paste.body, "Finish").dispatch("click");
    await flush();
    assert.match(textOf(allWith(paste.body, "mcps-error")[0]), /^That is not the address the sign-in came back to/);
    assert.equal(paste.closed, false, "a refusal keeps the sheet");
    field.value = ` ${LANDED} `;
    button(paste.body, "Finish").dispatch("click");
    await flush();
    assert.deepEqual(t.calls.filter((c) => c.path === "/mcp-servers/sign-in").at(-1)?.body, { pasted: LANDED });
    assert.equal(paste.closed, true);
    assert.deepEqual(t.opened, [PAGE], "the address pasted was never opened: it went to this page's Filament alone");
    status = "done";
    t.setAnswer(listOf([linearRow({ signIn: { state: "in", host: HOST } })]));
    await t.tick();
    assert.deepEqual(t.toasts.slice(-2), [[`Signed in to linear on ${HOST}; each chat has it from its next message`, undefined], ["linear: 1 tool: 1 only read", ""]]);
    // Told once: the next sign-in from here starts at once, taking the address pasted.
    t.setAnswer(listOf([linearRow({ signIn: { state: "asks", host: HOST } })]));
    await t.refresh();
    status = "waiting";
    button(t.el, "Sign in").dispatch("click");
    await flush();
    assert.deepEqual(t.calls.filter((c) => c.path === "/mcp-servers/sign-in").at(-1)?.body, { scope: "all", name: "linear", paste: true });
    assert.deepEqual([t.dialogs.length, t.dialogs.at(-1).title, t.opened.length], [3, "Sign in to linear", 1]);
  });

  // (fails before: yes — the hunt of p4-signins: Sign in here's refusal, as another account, was thrown where nothing
  // caught it — no toast, no words — and the sheet had closed)
  test("Sign in here refused: the sheet stays and says why; pressed again, it goes", async () => {
    let fail = true;
    const rows = studioRows(true, () => "waiting");
    const t = listAt(TAILNET, listOf([linearRow({ signIn: { state: "in", host: HOST, accounts: ["default"] } })]), (p, m, b) => (p === "/mcp-servers/sign-in" && m === "POST" && b.paste && fail ? Object.assign(new Error("its server did not answer (fetch failed)"), { status: 502, body: { error: "its server did not answer (fetch failed)" } }) : rows(p, m, b)));
    await flush();
    allWith(t.el, "mcps-more")[0].dispatch("click");
    t.menus.at(-1)?.find((/** @type {any} */ x) => x.label === "Sign in with another account…").onClick();
    const named = t.dialogs.at(-1);
    labelled(named.body, "The account's name").value = "work";
    button(named.body, "Sign in").dispatch("click");
    await flush();
    assert.equal(named.closed, true, "the account's sheet gives way to where the page sends the browser");
    const far = t.dialogs.at(-1);
    assert.equal(far.title, "Sign in to linear");
    button(far.body, "Sign in here").dispatch("click");
    await flush();
    assert.equal(far.closed, false, "the sheet stays");
    assert.equal(textOf(allWith(far.body, "mcps-error")[0]), "its server did not answer (fetch failed)");
    assert.deepEqual([t.toasts, t.opened], [[], []]);
    fail = false;
    button(far.body, "Sign in here").dispatch("click");
    await flush();
    assert.equal(far.closed, true);
    assert.equal(textOf(allWith(far.body, "mcps-error")[0]), "");
    assert.deepEqual(t.calls.filter((c) => c.path === "/mcp-servers/sign-in").at(-1)?.body, { scope: "all", name: "linear", account: "work", paste: true });
    assert.equal(t.dialogs.at(-1).title, "Sign in to linear");
    assert.match(textOf(t.dialogs.at(-1).body), /^Open mcp\.linear\.app's page/);
    // The row's own Sign in, no account named: the same, never a toast with the sheet gone.
    fail = true;
    const r = listAt(TAILNET, listOf([linearRow({ signIn: { state: "asks", host: HOST } })]), (p, m, b) => (p === "/mcp-servers/sign-in" && m === "POST" && b.paste && fail ? Object.assign(new Error("its server did not answer (fetch failed)"), { status: 502, body: { error: "its server did not answer (fetch failed)" } }) : rows(p, m, b)));
    await flush();
    button(r.el, "Sign in").dispatch("click");
    await flush();
    const rowFar = r.dialogs.at(-1);
    button(rowFar.body, "Sign in here").dispatch("click");
    await flush();
    assert.deepEqual([rowFar.closed, textOf(allWith(rowFar.body, "mcps-error")[0]), r.toasts], [false, "its server did not answer (fetch failed)", []]);
  });

  // (fails before: yes — a waiting row offered no way to finish it from there)
  test("a waiting row whose page sends the browser elsewhere than this page's Filament offers Paste the address…, which finishes it; on Filament's own computer it does not", async () => {
    const waiting = listOf([linearRow({ signIn: { state: "waiting", host: HOST, id: "id1", page: PAGE } })]);
    const actsOf = (/** @type {any} */ el) => buttonsOf(el).map(textOf).filter((w) => ["Open it again", "Paste the address…", "Cancel"].includes(w));
    for (const [here, acts] of /** @type {const} */ ([[TAILNET, ["Open it again", "Paste the address…", "Cancel"]], [LAN, ["Open it again", "Paste the address…", "Cancel"]], [TUNNEL, ["Open it again", "Paste the address…", "Cancel"]], [HERE, ["Open it again", "Cancel"]], [null, ["Open it again", "Cancel"]]])) {
      const t = listAt(here, waiting, studioRows(false, () => "waiting"));
      await flush();
      assert.deepEqual(actsOf(t.el), acts, `${here?.hostname}:${here?.port}`);
    }
    const t = listAt(TAILNET, waiting, studioRows(false, () => "waiting"));
    await flush();
    button(t.el, "Paste the address…").dispatch("click");
    const paste = t.dialogs.at(-1);
    assert.equal(paste.title, "Sign in to linear");
    assert.match(textOf(paste.body), /which is Filament only on the computer Filament runs on/);
    button(paste.body, "Open its page").dispatch("click");
    assert.deepEqual(t.opened, [PAGE]);
    labelled(paste.body, "The address it came back to").value = LANDED;
    button(paste.body, "Finish").dispatch("click");
    await flush();
    assert.deepEqual(t.calls.at(-1), { path: "/mcp-servers/sign-in", method: "POST", body: { pasted: LANDED } });
    assert.equal(paste.closed, true);
  });

  // (fails before: yes — the page opened, and its return went to the laptop's own Filament where one ran on that port)
  test("over an SSH tunnel on another port, which the server takes for this computer, the page's return is told from this page's address: the address it lands on is asked for", async () => {
    const t = listAt(TUNNEL, listOf([linearRow({ signIn: { state: "asks", host: HOST } })]), studioRows(false, () => "waiting"));
    await flush();
    button(t.el, "Sign in").dispatch("click");
    await flush();
    assert.deepEqual(t.calls.find((c) => c.path === "/mcp-servers/sign-in")?.body, { scope: "all", name: "linear" });
    assert.deepEqual(t.opened, [], "opened by the sheet's press");
    assert.equal(t.dialogs.length, 1);
    assert.match(textOf(t.dialogs[0].body), /^Open mcp\.linear\.app's page in this browser and sign in there\. It then sends the browser to 127\.0\.0\.1:20300/);
  });

  // (fails before: no — a guard: on Filament's own computer, Sign in opens the page and nothing more)
  test("on Filament's own computer Sign in opens the server's page and asks for nothing", async () => {
    const t = listAt(HERE, listOf([linearRow({ signIn: { state: "asks", host: HOST } })]), studioRows(false, () => "waiting"));
    await flush();
    button(t.el, "Sign in").dispatch("click");
    await flush();
    assert.deepEqual([t.opened, t.dialogs.length], [[PAGE], 0]);
  });
});

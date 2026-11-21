// @ts-check
// Coding agents signed in on a machine with no browser (the remote plan's sv-signin): over SSH, on a Linux server with
// no display and no program to open a page with, `filament agents sign-in` and `filament setup` say what to open on
// another machine — Codex's page and its code, Claude Code's line for another terminal, where its own login gives its
// page — and wait for the sign-in to end. A Filament of the test's own answers as a headless one does; the command line
// runs as on that server: Linux, no DISPLAY, nothing on its PATH to open a page with.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdtempSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { PassThrough, Readable } from "node:stream";
import { writeListening } from "../src/cli/listening.js";
import { EXIT } from "../src/cli/client.js";
import { runCli } from "../src/cli/main.js";
import { openPage, screenHere } from "../src/cli/flows.js";
import { removeDirs } from "./helpers/wait.js";

// Codex's ways, as its bridge names them (codex/bridge.js CODEX_WAYS) and Filament answers them — the one that
// finishes from another computer said as that (`far`: the re-read of 11-11, the answer had left it out, and so did
// this copy of it); Claude Code's, as its ACP adapter declares them.
const CODEX_WAYS = [
  { id: "chatgpt", name: "ChatGPT", description: "Sign in on ChatGPT's page, in this computer's browser" },
  { id: "chatgpt-code", name: "ChatGPT on another device", description: "For a browser on another computer: open ChatGPT's page there and type the code it shows here", far: true },
  { id: "api-key", name: "OpenAI API key", description: "Paste a key from your OpenAI account: Codex keeps it in its own folder, and Filament keeps none", kind: "key", label: "OpenAI API key" },
];
const CLAUDE_WAYS = [
  { id: "claude-ai-login", name: "Claude Subscription", description: "Use Claude subscription" },
  { id: "console-login", name: "Anthropic Console", description: "Use Anthropic Console (API usage billing)" },
];
const DEVICE_PAGE = "https://auth.openai.com/codex/device";
const DEVICE_CODE = "K7QD-93TXW";
const CLAUDE_LINE = "CLAUDE_CONFIG_DIR=/home/ada/.config/filament/agents/claude-code claude-agent-acp --cli auth login --claudeai";

/**
 * A headless server's Filament, on a port of its own, its listening.json in a folder of its own: Claude Code and Codex
 * connected and signed out. Codex signs in on its device's page: the first look at its account after its sign-in began
 * finds it still under way — the person types the code on their other machine meanwhile —, the next one finds it signed
 * in. Claude Code signs in by its line, run in a terminal of the person's own: signed in once they say it is (`claude`).
 * `terminal`: Filament runs Claude Code's sign-in in a terminal of its own (node-pty); without one it names the line alone.
 * @param {{ terminal?: boolean }} [o]
 */
const headlessFilament = async ({ terminal = true } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-headless-"));
  /** @type {{ method: string, path: string, body: any }[]} */
  const came = [];
  const codex = { state: "out", at: 0, waited: 0 };
  const claude = { signedIn: false };
  const codexRow = () => ({
    upstream: "codex",
    name: "Codex",
    label: "Default",
    off: false,
    signingIn: codex.state === "signing",
    lastSignIn: codex.state === "in" ? { outcome: "signed-in", at: codex.at, error: null } : null,
    account: { identity: codex.state === "in" ? { kind: "account", label: "ada@example.com", plan: "plus" } : { kind: "none" } },
  });
  const claudeRow = () => ({
    upstream: "claude-code",
    name: "Claude Code",
    label: "Default",
    off: false,
    signingIn: false,
    lastSignIn: null,
    account: claude.signedIn ? { identity: { kind: "account", label: "ada@example.com", plan: "max" } } : { signedOut: true, identity: { kind: "none", label: "Not logged in" } },
  });
  /** @type {Record<string, (body: any) => any>} */
  const routes = {
    "GET /coding-agents": () => ({
      entries: [
        { id: "claude-code", name: "Claude Code", state: "connected", primary: "claude-code", upstreams: ["claude-code"] },
        { id: "codex", name: "Codex", state: "connected", primary: "codex", upstreams: ["codex"] },
      ],
    }),
    "GET /agent-accounts": () => {
      if (codex.state === "signing") {
        codex.waited++;
        const row = codexRow();
        Object.assign(codex, { state: "in", at: Date.now() });
        return { agents: [claudeRow(), row] };
      }
      return { agents: [claudeRow(), codexRow()] };
    },
    "POST /agent-accounts/codex/sign-in": (b) => {
      if (!b?.way) return { choose: CODEX_WAYS };
      // A key's way with no key: the ways again, as the server answers; with one, signed in at once.
      if (b.way === "api-key" && !b.key) return { choose: CODEX_WAYS };
      if (b.way === "api-key") {
        Object.assign(codex, { state: "in", at: Date.now() });
        return { signIn: { kind: "key", way: b.way, name: "OpenAI API key", at: codex.at } };
      }
      if (b.way !== "chatgpt-code") throw new Error(`a headless sign-in took Codex's ${b.way}, whose page comes back to this machine's browser`);
      codex.state = "signing";
      return { signIn: { kind: "browser", way: b.way, name: "ChatGPT on another device", url: DEVICE_PAGE, code: DEVICE_CODE, line: "codex login", at: Date.now() } };
    },
    "POST /agent-accounts/claude-code/sign-in": (b) => {
      if (!b?.way) return { choose: CLAUDE_WAYS };
      return terminal ? { signIn: { kind: "terminal", way: b.way, name: "Claude Subscription", terminal: "t1", line: CLAUDE_LINE, at: Date.now() } } : { line: CLAUDE_LINE };
    },
    "POST /agent-accounts/claude-code/sign-in/cancel": () => ({ stopped: true }),
    "POST /agent-accounts/claude-code/check": () => ({ agent: claudeRow() }),
    "GET /start": () => ({ connected: { ok: true, models: 2, example: "claude-code/sonnet" }, memory: { enabled: false } }),
    "GET /upstreams": () => ({ upstreams: [] }),
    "GET /memory/status": () => ({ enabled: false }),
  };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const path = String(req.url || "").replace(/^\/api/, "");
      const body = raw ? JSON.parse(raw) : null;
      came.push({ method: String(req.method), path, body });
      if (path === "/state") return void res.end(JSON.stringify({ version: "9.9.9", dataDir: dir, uptimeMs: 1000 }));
      const route = routes[`${req.method} ${path}`];
      try {
        if (!route) throw Object.assign(new Error(`no ${req.method} ${path}`), { status: 404 });
        res.end(JSON.stringify(route(body)));
      } catch (/** @type {any} */ e) {
        res.statusCode = e.status || 400;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
  writeListening(dir, { host: "127.0.0.1", port, pid: process.pid, version: "9.9.9", startedAt: 1 });
  return {
    dir,
    came,
    codex,
    claude,
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(() => r(undefined)));
      await removeDirs(dir);
    },
  };
};

/**
 * The person's SSH terminal: what the command says and what it asks, on one screen, as they read it. Each question, as
 * it waits at the end of the screen, gets `answer(question, screen)` — "n" where that says nothing.
 * @param {(q: string, screen: string) => string | undefined} answer
 */
const sshTerminal = (answer) => {
  const input = /** @type {any} */ (new PassThrough());
  input.setRawMode = () => {};
  const output = new PassThrough();
  let screen = "";
  let at = 0;
  /** @type {string[]} */
  const asked = [];
  /** @param {string} s */
  const show = (s) => {
    screen += s;
    if (!/(\] |: )$/.test(screen.slice(at))) return;
    const q = screen.slice(at).split("\n").at(-1) || "";
    at = screen.length;
    asked.push(q);
    const a = answer(q, screen) ?? "n";
    setImmediate(() => input.write(`${a}\n`));
  };
  output.on("data", (c) => show(String(c)));
  return { term: /** @type {any} */ ({ input, output, tty: true }), say: (/** @type {string} */ s) => show(`${s}\n`), asked, screen: () => screen };
};

/** The number the screen's last list gives a way, by its name. @param {string} screen @param {string} name */
const numberOf = (screen, name) => screen.match(new RegExp(` {2}(\\d+)\\. ${name} — [^\\n]*\\n(?:[^\\n]*\\n)*Number: $`))?.[1];

describe("a coding agent signed in over SSH, on a machine with no browser", () => {
  /** @type {PropertyDescriptor | undefined} */
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const NAMES = ["DISPLAY", "WAYLAND_DISPLAY", "BROWSER", "SSH_CONNECTION", "SSH_TTY", "PATH"];
  /** @type {Record<string, string | undefined>} */
  const was = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
  const bare = mkdtempSync(join(tmpdir(), "filament-headless-path-"));

  before(() => {
    // A Linux server reached over SSH: no display, and no xdg-open nor any browser on its PATH.
    Object.defineProperty(process, "platform", { ...platform, value: "linux" });
    for (const n of ["DISPLAY", "WAYLAND_DISPLAY", "BROWSER"]) delete process.env[n];
    Object.assign(process.env, { SSH_CONNECTION: "203.0.113.7 52100 10.0.0.5 22", SSH_TTY: "/dev/pts/1", PATH: bare });
  });
  after(async () => {
    if (platform) Object.defineProperty(process, "platform", platform);
    for (const n of NAMES) {
      if (was[n] === undefined) delete process.env[n];
      else process.env[n] = was[n];
    }
    await removeDirs(bare);
  });

  // (fails before: yes — the command said the page and its code, then died as it tried to open the page here: no
  // xdg-open, an 'error' its spawn left unheard — `spawn xdg-open ENOENT`, exit 1, nothing waited for. What it locks is
  // the sign-in outliving a page it cannot open, which openPage holds two ways — no page tried over SSH (screenHere),
  // the opener's 'error' heard —: it fails only with both gone. The 'error' heard alone is the last test's; no page
  // tried over SSH, alone, is no test's)
  test("Codex at an SSH terminal: its other device's way chosen, the page and its code said, the sign-in waited for until it ends", async () => {
    const f = await headlessFilament();
    try {
      const ssh = sshTerminal((q, screen) => (q === "Number: " && /How should Codex sign in\?/.test(screen) ? numberOf(screen, "ChatGPT on another device") : undefined));
      /** @type {string[]} */
      const err = [];
      const code = await runCli(["agents", "sign-in", "codex"], { dataDir: f.dir, term: ssh.term, out: ssh.say, err: (s) => err.push(s) });
      const screen = ssh.screen();
      assert.equal(code, EXIT.ok, `${screen}\n${err.join("\n")}`);
      assert.ok(screen.includes(DEVICE_PAGE) && screen.includes(DEVICE_CODE), screen);
      assert.deepEqual(f.came.filter((c) => c.path === "/agent-accounts/codex/sign-in").map((c) => c.body), [{}, { way: "chatgpt-code" }]);
      assert.equal(f.codex.waited, 1, "a sign-in still under way is waited for");
      assert.ok(screen.indexOf(DEVICE_CODE) < screen.indexOf("✓ Codex is signed in: ada@example.com · plus."), screen);
      assert.deepEqual(err, []);
    } finally {
      await f.close();
    }
  });

  // (fails before: yes — as at a terminal: `spawn xdg-open ENOENT` after the page and its code were said. It locks what
  // the test above does: it fails only with both of openPage's holds gone)
  test("Codex with no terminal to ask at (ssh server filament …): --way names its other device's, said and waited for; without it, the ways to name", async () => {
    const f = await headlessFilament();
    try {
      /** @param {string[]} argv */
      const run = async (argv) => {
        /** @type {{ out: string[], err: string[] }} */
        const said = { out: [], err: [] };
        const term = /** @type {any} */ ({ input: Readable.from([]), output: new PassThrough(), tty: false });
        const code = await runCli(argv, { dataDir: f.dir, term, out: (s) => said.out.push(s), err: (s) => said.err.push(s) });
        return { code, out: said.out.join("\n"), err: said.err.join("\n") };
      };
      const unnamed = await run(["agents", "sign-in", "codex"]);
      // Over SSH no page comes back here: the way that finishes from another computer is named first.
      assert.deepEqual([unnamed.code, unnamed.err], [EXIT.needsPerson, "filament agents: Codex signs in more than one way: give --way, one of chatgpt-code, chatgpt, api-key"]);
      const r = await run(["agents", "sign-in", "codex", "--way", "chatgpt-code"]);
      assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
      assert.ok(r.out.includes(DEVICE_PAGE) && r.out.includes(DEVICE_CODE), r.out);
      assert.equal(f.codex.waited, 1, "a sign-in still under way is waited for");
      assert.match(r.out, /✓ Codex is signed in: ada@example\.com · plus\.$/);
      assert.equal(r.err, "");
    } finally {
      await f.close();
    }
  });

  // (fails before: yes — the review of 11-10: a key's way had no key to give: the command sent the way alone, was handed
  // the ways again, and named no way to go on)
  test("Codex with an OpenAI API key (… | filament agents sign-in codex --way api-key --key-stdin): the key piped in goes in the sign-in's body alone, its end waited for; with none to read, how to give one", async () => {
    const f = await headlessFilament();
    try {
      /** @param {string[]} argv @param {string} [piped] */
      const run = async (argv, piped) => {
        /** @type {{ out: string[], err: string[] }} */
        const said = { out: [], err: [] };
        const term = /** @type {any} */ ({ input: Readable.from(piped ? [piped] : []), output: new PassThrough(), tty: false });
        const code = await runCli(argv, { dataDir: f.dir, term, out: (s) => said.out.push(s), err: (s) => said.err.push(s) });
        return { code, out: said.out.join("\n"), err: said.err.join("\n") };
      };
      const none = await run(["agents", "sign-in", "codex", "--way", "api-key"]);
      assert.deepEqual([none.code, none.err], [EXIT.needsPerson, "filament agents: a key is typed at a terminal, or piped in: … | filament agents sign-in codex --way api-key --key-stdin"]);
      const r = await run(["agents", "sign-in", "codex", "--way", "api-key", "--key-stdin"], "sk-test-0123\n");
      assert.equal(r.code, EXIT.ok, `${r.out}\n${r.err}`);
      assert.deepEqual(f.came.filter((c) => c.path === "/agent-accounts/codex/sign-in").map((c) => c.body), [{ way: "api-key" }, { way: "api-key" }, { way: "api-key", key: "sk-test-0123" }]);
      assert.match(r.out, /^Signing Codex in with OpenAI API key…\n[^]*✓ Codex is signed in: ada@example\.com · plus\.$/);
      assert.ok(!r.out.includes("sk-test-0123") && !r.err.includes("sk-test-0123"), "the key is said nowhere");
    } finally {
      await f.close();
    }
  });

  // (fails before: no — Claude Code's sign-in never opened a page here: its line was said for a terminal of the person's
  // own, Filament's taken back, as now. A guard: the line said before the wait, the account checked after it)
  test("Claude Code at an SSH terminal: the line to run in another one — whose login gives its page —, Filament's own terminal taken back, waited for and checked", async () => {
    const f = await headlessFilament();
    try {
      const ssh = sshTerminal((q, screen) => {
        if (q === "Number: " && /How should Claude Code sign in\?/.test(screen)) return numberOf(screen, "Claude Subscription");
        if (q.startsWith("Press Enter once it says you are signed in")) {
          // The person ran the line in another SSH terminal, and Claude's own login took them through its page there.
          if (screen.includes(CLAUDE_LINE)) f.claude.signedIn = true;
          return "";
        }
        return undefined;
      });
      /** @type {string[]} */
      const err = [];
      const code = await runCli(["agents", "sign-in", "claude-code"], { dataDir: f.dir, term: ssh.term, out: ssh.say, err: (s) => err.push(s) });
      const screen = ssh.screen();
      assert.equal(code, EXIT.ok, `${screen}\n${err.join("\n")}`);
      assert.ok(f.came.some((c) => c.path === "/agent-accounts/claude-code/sign-in/cancel"), "the sign-in Filament began in its own terminal is taken back: the person runs it in theirs");
      assert.ok(screen.indexOf(CLAUDE_LINE) < screen.indexOf("Press Enter once it says you are signed in"), screen);
      assert.match(screen, /✓ Claude Code is signed in: ada@example\.com · max\.\n$/);
      assert.deepEqual(err, []);
    } finally {
      await f.close();
    }
  });

  // (fails before: yes — the setup died at Codex's page: `spawn xdg-open ENOENT`. It locks that as the Codex tests do —
  // failing only with both of openPage's holds gone —, and setup's own: the harness's page is not offered where no page
  // shows here (screenHere); offered over SSH, it fails at "not asked")
  test("filament setup over SSH: both agents signed in — Claude Code by its line, where Filament has no terminal of its own; Codex by its page and code — then the rest of the setup", async () => {
    const f = await headlessFilament({ terminal: false });
    try {
      const ssh = sshTerminal((q, screen) => {
        if (/^(Claude Code|Codex) is not signed in\. Sign it in now\?/.test(q)) return "y";
        const choosing = q === "Number: " ? screen.slice(screen.lastIndexOf("How should ")).match(/^How should (.+?) sign in\?/)?.[1] : null;
        if (choosing) return numberOf(screen, choosing === "Codex" ? "ChatGPT on another device" : "Claude Subscription");
        if (q.startsWith("Press Enter once it says you are signed in")) {
          if (screen.includes(CLAUDE_LINE)) f.claude.signedIn = true;
          return "";
        }
        return undefined;
      });
      /** @type {string[]} */
      const err = [];
      const code = await runCli(["setup"], { dataDir: f.dir, term: ssh.term, out: ssh.say, err: (s) => err.push(s) });
      const screen = ssh.screen();
      assert.equal(code, EXIT.ok, `${screen}\n${err.join("\n")}`);
      assert.match(screen, /\n1\. Coding agents\n[^]*In another terminal, run:\n {2}[^\n]*claude-agent-acp --cli auth login --claudeai\n[^]*✓ Claude Code is signed in: ada@example\.com · max\.\n/);
      assert.ok(!f.came.some((c) => c.path === "/agent-accounts/claude-code/sign-in/cancel"), "no terminal of Filament's to take back");
      const codexPart = screen.slice(screen.indexOf("Codex is not signed in"), screen.indexOf("\n2. API keys\n"));
      assert.ok(codexPart.includes(DEVICE_PAGE) && codexPart.includes(DEVICE_CODE), screen);
      assert.equal(f.codex.waited, 1, "a sign-in still under way is waited for");
      assert.match(codexPart, /✓ Codex is signed in: ada@example\.com · plus\.\n$/);
      assert.match(screen, /\n2\. API keys\n[^]*\n3\. Memory\n[^]*\n4\. Ready\n[^]*agents {2}: Claude Code — signed in: ada@example\.com · max; Codex — signed in: ada@example\.com · plus\n/);
      assert.ok(!screen.includes("Open the harness in your browser?"), "no page shows here: not asked");
      assert.deepEqual(err, []);
    } finally {
      await f.close();
    }
  });

  // (fails before: yes — the missing xdg-open's 'error' went unheard and ended the process. A program that starts in its
  // place has no 'error' to hear: the test ends at that start, failing, never waiting on an address no one will say)
  test("a page to open where a screen shows but no program opens it: its address said, the command going on", async () => {
    const ssh = { SSH_CONNECTION: process.env.SSH_CONNECTION, SSH_TTY: process.env.SSH_TTY };
    delete process.env.SSH_CONNECTION;
    delete process.env.SSH_TTY;
    process.env.DISPLAY = ":0";
    const cp = /** @type {any} */ (childProcess);
    const real = cp.spawn;
    /** @type {Promise<string>[]} */
    const started = [];
    cp.spawn = function (/** @type {any[]} */ ...args) {
      const child = real.apply(this, args);
      started.push(new Promise((r) => child.once("spawn", () => r(`${args[0]} started`))));
      return child;
    };
    syncBuiltinESMExports();
    try {
      assert.equal(screenHere(), true);
      /** @type {string[]} */
      const said = [];
      const heard = new Promise((r) => openPage(DEVICE_PAGE, {}, (s) => r(said.push(s))));
      // A spawn ends in 'error' or 'spawn', the tick after it: the address said, or a program started — whichever comes.
      assert.ok(started.length || said.length, "a program tried for the page, or its address said at once");
      assert.equal(await Promise.race([heard.then(() => "said"), ...started]), "said", "no program opens the page here");
      assert.deepEqual(said, [`Open ${DEVICE_PAGE} in your browser.`]);
    } finally {
      cp.spawn = real;
      syncBuiltinESMExports();
      Object.assign(process.env, ssh);
      delete process.env.DISPLAY;
    }
    assert.equal(screenHere(), false, "over SSH, no page opens here");
  });
});

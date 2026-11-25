// @ts-check
// The command line that drives a running Filament (the owner's of 11-05: "a full Filament CLI that drives and controls
// Filament... setup, connecting API keys, helping noob users"): where it finds Filament, how it reads a command line, a
// stream and a refusal, and what each exit code says.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LISTENING_FILE, START_LOCK, STARTED_ALREADY, listeningUrl, readListening, removeListening, takeStartLock, writeListening } from "../src/cli/listening.js";
import { CliError, EXIT, busyOf, clientAt, connect, readEvents, refusalWords, whereFilament } from "../src/cli/client.js";
import { signedInWords } from "../src/cli/flows.js";
import http from "node:http";
import { parseArgs, runCli } from "../src/cli/main.js";
import { valueOf } from "../src/cli/commands.js";
import { askSecret } from "../src/cli/ask.js";
import { startApp, fakeUpstream } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";
import { PassThrough, Readable } from "node:stream";

describe("where Filament listens", () => {
  test("listening.json: written as it listens, read while its process runs, taken away by its own process alone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-cli-listen-"));
    try {
      assert.equal(readListening(dir), null);
      const row = writeListening(dir, { host: "0.0.0.0", port: 20300, pid: process.pid, version: "9.9.9", startedAt: 1 });
      assert.equal(row.url, "http://127.0.0.1:20300", "a wildcard host is this machine's loopback");
      assert.deepEqual(readListening(dir), row);
      assert.equal(readListening(dir, { alive: () => false }), null, "a Filament that was killed is none");
      removeListening(dir, process.pid + 1);
      assert.ok(existsSync(join(dir, LISTENING_FILE)), "another process's stop leaves it");
      removeListening(dir, process.pid);
      assert.equal(existsSync(join(dir, LISTENING_FILE)), false);
      writeFileSync(join(dir, LISTENING_FILE), "{ not json");
      assert.equal(readListening(dir), null, "a file that does not read is none");
    } finally {
      await removeDirs(dir);
    }
  });

  // (fails before: yes — the hunt on x46: nothing kept a second start off a data folder whose Filament still opened
  // memory, before it listened: both opened its config, devices and archive)
  test("the start lock: one process holds it, a second is refused while that one runs, a gone one's is taken over", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-cli-lock-"));
    const file = join(dir, START_LOCK);
    /** @type {Set<number>} */
    const running = new Set([10, 20]);
    const alive = (/** @type {number} */ pid) => running.has(pid);
    try {
      const first = takeStartLock(dir, { pid: 10, alive, now: () => 5 });
      assert.ok(first.ok);
      assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { pid: 10, startedAt: 5 });
      assert.deepEqual(takeStartLock(dir, { pid: 20, alive }), { ok: false, pid: 10, startedAt: 5, file });
      const other = takeStartLock(dir, { pid: 20, alive: () => false });
      assert.ok(other.ok, "its process gone: taken over");
      if (first.ok) first.release();
      assert.equal(JSON.parse(readFileSync(file, "utf8")).pid, 20, "a release lets go of its own lock alone");
      if (other.ok) other.release();
      assert.equal(existsSync(file), false);
      // A lock just made, its words not yet written: read again a moment later before it is taken over.
      writeFileSync(file, "");
      /** @type {number[]} */
      const paused = [];
      const late = takeStartLock(dir, { pid: 20, alive, pause: (ms) => (paused.push(ms), paused.length === 2 && writeFileSync(file, JSON.stringify({ pid: 10, startedAt: 7 }))) });
      assert.deepEqual([late.ok, paused], [false, [100, 100]]);
      rmSync(file);
      writeFileSync(file, `${JSON.stringify({ pid: 30, startedAt: 1 })}\n`);
      assert.ok(takeStartLock(dir, { pid: 30, alive: () => true }).ok, "one with this very process's pid is a gone one's, its pid used again");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("filament start on a folder whose lock a running process holds: refused in words, exit 6, before it opens anything", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-cli-locked-"));
    try {
      writeFileSync(join(dir, START_LOCK), `${JSON.stringify({ pid: process.pid, startedAt: Date.now() })}\n`);
      const r = spawnSync(process.execPath, ["bin/filament.js", "--data-dir", dir, "start"], { encoding: "utf8", timeout: 60_000, env: { ...process.env, FILAMENT_SUPERVISOR: "test" } });
      assert.equal(r.status, STARTED_ALREADY, r.stderr);
      assert.equal(r.status, EXIT.startedAlready);
      assert.match(r.stderr, new RegExp(`another Filament of this data folder \\(pid ${process.pid}\\) is starting or runs, so this one does not start`));
      assert.deepEqual(readdirSync(dir), [START_LOCK], "no config, no archive, no listening.json");
      assert.equal(JSON.parse(readFileSync(join(dir, START_LOCK), "utf8")).pid, process.pid, "the lock stays its holder's");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("its URL: a wildcard is 127.0.0.1, an IPv6 address bracketed, a host as it is", () => {
    assert.equal(listeningUrl("", 1), "http://127.0.0.1:1");
    assert.equal(listeningUrl("::", 1), "http://127.0.0.1:1");
    assert.equal(listeningUrl("::1", 1), "http://[::1]:1");
    assert.equal(listeningUrl("localhost", 2), "http://localhost:2");
  });

  test("whereFilament: its listening.json, else its config's port — read, never written —, else the folder's default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-cli-where-"));
    try {
      const none = whereFilament(dir);
      assert.equal(none.from, "default");
      assert.match(none.url, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.equal(existsSync(join(dir, "config.json")), false, "nothing written");
      writeFileSync(join(dir, "config.json"), JSON.stringify({ server: { host: "127.0.0.1", port: 4555 } }));
      assert.deepEqual([whereFilament(dir).from, whereFilament(dir).url], ["config", "http://127.0.0.1:4555"]);
      writeListening(dir, { host: "127.0.0.1", port: 4666, pid: process.pid, version: "1.2.3", startedAt: 1 });
      assert.deepEqual([whereFilament(dir).from, whereFilament(dir).url, whereFilament(dir).version], ["listening", "http://127.0.0.1:4666", "1.2.3"]);
    } finally {
      await removeDirs(dir);
    }
  });

  test("no Filament answers: exit 3, in words that say where it looked and how to start one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-cli-none-"));
    try {
      writeFileSync(join(dir, "config.json"), JSON.stringify({ server: { host: "127.0.0.1", port: 1 } }));
      const e = await connect(dir, { timeoutMs: 500 }).then(() => null, (x) => x);
      assert.ok(e instanceof CliError);
      assert.equal(e.code, EXIT.noFilament);
      assert.match(e.message, /^No Filament answers at http:\/\/127\.0\.0\.1:1 \(its config's port\): start it with `filament start` or open the Filament app\./);
      // (fails before: yes — a data folder that held nothing reached the default port's Filament, another folder's)
      const other = /** @type {any} */ (async () => new Response(JSON.stringify({ version: "1", dataDir: join(dir, "elsewhere") }), { status: 200 }));
      const not = await connect(dir, { fetchImpl: other }).then(() => null, (x) => x);
      assert.deepEqual([not?.code, not?.message.startsWith("The Filament at http://127.0.0.1:1 runs from ")], [EXIT.noFilament, true]);
      const same = /** @type {any} */ (async () => new Response(JSON.stringify({ version: "1", dataDir: process.platform === "win32" ? dir.toUpperCase() : dir }), { status: 200 }));
      assert.equal((await connect(dir, { fetchImpl: same })).version, "1", "the same folder, however its letters are cased on Windows");
      // (fails before: yes — s0c: a Filament that refused this folder's owner key read as none, and setup offered to start one)
      const keyed = /** @type {any} */ (async () => new Response(JSON.stringify({ error: "…", ownerKey: true, pair: "/ui/pair.html" }), { status: 403 }));
      const taken = await connect(dir, { fetchImpl: keyed }).then(() => null, (x) => x);
      assert.deepEqual([taken?.code, taken?.body?.taken], [EXIT.noFilament, true]);
      assert.match(String(taken?.message), /^The Filament at http:\/\/127\.0\.0\.1:1 \(its config's port\) did not take the owner key in .+: it runs from another data folder/);
    } finally {
      await removeDirs(dir);
    }
  });
});

describe("a command line, a stream, a refusal", () => {
  test("parseArgs: words, --name value, --name=value, the flags that stand alone, -h, and -- ends the flags", () => {
    const b = new Set(["json", "yes"]);
    assert.deepEqual(parseArgs(["keys", "add", "anthropic", "--json", "--prefix", "work", "--name=Mine"], b), { words: ["keys", "add", "anthropic"], flags: { json: true, prefix: "work", name: "Mine" } });
    assert.deepEqual(parseArgs(["chat", "--yes", "hello", "-h"], b), { words: ["chat", "hello"], flags: { yes: true, help: true } });
    assert.deepEqual(parseArgs(["chat", "--model"], b), { words: ["chat"], flags: { model: true } }, "a value missing is the flag alone");
    assert.deepEqual(parseArgs(["chat", "--", "--not-a-flag"], b), { words: ["chat", "--not-a-flag"], flags: {} });
  });

  test("readEvents: events whole across chunks, named or not, JSON where it is, the tail", async () => {
    const enc = new TextEncoder();
    async function* chunks() {
      yield enc.encode('event: message_start\ndata: {"a":');
      yield enc.encode('1}\r\n\r\ndata: plain\n\n: a comment\n\nevent: end\ndata: {"b":2}');
    }
    /** @type {any[]} */
    const got = [];
    await readEvents(chunks(), (e, d) => got.push([e, d]));
    assert.deepEqual(got, [["message_start", { a: 1 }], ["message", "plain"], ["end", { b: 2 }]]);
  });

  test("a refusal in the server's words; 409 is busy (exit 5)", async () => {
    assert.equal(refusalWords({ error: "no such session" }, 404), "no such session (HTTP 404)");
    assert.equal(refusalWords({ errors: ["a", "b"] }, 400), "a; b (HTTP 400)");
    assert.equal(refusalWords(null, 500), "Filament refused it (HTTP 500)");
    const fake = /** @type {any} */ (async () => new Response(JSON.stringify({ error: "a turn runs", requestId: "r1" }), { status: 409 }));
    const c = clientAt("http://x", {}, fake);
    const e = await c.post("/sessions/s/turns", {}).then(() => null, (x) => x);
    assert.deepEqual([e?.code, e?.message], [EXIT.busy, "a turn runs (HTTP 409)"]);
  });

  test("runCli: no such command is null — bin says so, exit 2 —; help names one", async () => {
    /** @type {string[]} */
    const out = [];
    assert.equal(await runCli(["nope"], { dataDir: tmpdir(), out: (s) => out.push(s), err: () => {} }), null);
    assert.equal(await runCli(["help", "status"], { dataDir: tmpdir(), out: (s) => out.push(s), err: () => {} }), EXIT.ok);
    assert.match(out.join("\n"), /^Usage: filament status/);
  });

  test("the exit codes, as --help says them", () => {
    assert.deepEqual(EXIT, { ok: 0, failed: 1, usage: 2, noFilament: 3, needsPerson: 4, busy: 5, startedAlready: 6, interrupted: 130 });
    const bin = readFileSync("bin/filament.js", "utf8");
    assert.match(bin, /Exit codes: 0 done, 1 failed, 2 typed wrong, 3 no Filament answers, 4 needs you \(a terminal, a browser\),\n5 busy \(a turn runs\), 6 another Filament of the data folder starts or runs \(filament start\), 130 stopped\./);
  });
});

describe("the commands, against a running Filament", () => {
  /** @type {string} */
  let root;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-cli-root-"));
    up = await fakeUpstream(() => undefined);
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-model", upstream: "m", upstreamModel: "brain-model", enabled: true }, { match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });

  /**
   * A command run as an agent or a script runs it: no terminal, stdin `input` — what it said, on each stream, and its code.
   * @param {string[]} argv @param {string} [input]
   */
  const run = async (argv, input = "") => {
    /** @type {{ out: string[], err: string[], written: string }} */
    const said = { out: [], err: [], written: "" };
    const term = /** @type {any} */ ({ input: Readable.from(input ? [input] : []), output: new PassThrough(), tty: false });
    const code = await runCli(argv, { dataDir: shim.dataDir, term, out: (s) => said.out.push(s), err: (s) => said.err.push(s), write: (s) => (said.written += s) });
    return { code, ...said };
  };

  test("status: where it runs and what answers — in words, and as JSON", async () => {
    const j = await run(["status", "--json"]);
    assert.equal(j.code, EXIT.ok, j.err.join("\n"));
    const s = JSON.parse(j.out.join("\n"));
    assert.equal(s.running, true);
    assert.equal(s.url, shim.url, "found by the listening.json it wrote as it started");
    assert.ok(s.models.answering >= 1, JSON.stringify(s.models));
    assert.deepEqual(s.keys.map((/** @type {any} */ k) => k.id), ["m"]);
    // Its ways in over https as they stand (the hunt on s3b: a setup over SSH reads what listens, not what was asked).
    assert.deepEqual(s.network, { on: false, listening: null, error: null });
    assert.equal(s.tailnet?.on, false);
    assert.equal(s.tailnet?.served, false);
    const w = (await run(["status"])).out.join("\n");
    assert.ok(w.startsWith(`Filament ${s.version} at ${shim.url} — up `), w);
    assert.match(w, /\n {2}keys {4}: m \(/);
  });

  test("keys add: the key piped in, never on the command line nor said back; list masks it; remove asks, or --yes", async () => {
    const secret = "sk-ant-cli-test-0123456789abcdef";
    const add = await run(["keys", "add", "anthropic", "--key-stdin", "--prefix", "work", "--no-test"], secret);
    assert.equal(add.code, EXIT.ok, add.err.join("\n"));
    assert.deepEqual(add.out, ['Added Anthropic as "work": its models are named work/<model>.']);
    /** @type {any} */
    const u = ((await (await shim.api("/api/upstreams")).json()).upstreams || []).find((/** @type {any} */ x) => x.id === "work");
    assert.equal(u?.key?.stored, true);
    const list = await run(["keys", "--json"]);
    assert.ok(!list.out.join("").includes(secret), "the list masks it");
    assert.equal(JSON.parse(list.out.join("\n")).find((/** @type {any} */ k) => k.id === "work")?.key, "set", "no part of it, to a run that is no person's terminal");
    const typed = await run(["keys", "add", "anthropic", "--prefix", "work2"]);
    assert.equal(typed.code, EXIT.needsPerson, "a key is typed at a terminal, or piped in");
    assert.match(typed.err.join("\n"), /--key-stdin/);
    assert.equal((await run(["keys", "remove", "work"])).code, EXIT.needsPerson, "a removal asks first");
    const gone = await run(["keys", "remove", "work", "--yes"]);
    assert.equal(gone.code, EXIT.ok, gone.err.join("\n"));
    assert.equal(((await (await shim.api("/api/upstreams")).json()).upstreams || []).some((/** @type {any} */ x) => x.id === "work"), false);
  });

  test("chat: a new chat's reply streamed as it comes, its id said after; --chat goes on with it, its message on stdin", async () => {
    const first = await run(["chat", "--model", "brain-model", "--folder", root, "say", "hello"]);
    assert.equal(first.code, EXIT.ok, first.err.join("\n"));
    assert.equal(first.written, "MODEL ANSWER\n");
    const id = first.err.join("\n").match(/\(chat (\S+) — filament chat --chat \1 <message> goes on with it\)/)?.[1];
    assert.ok(id, first.err.join("\n"));
    const piped = await run(["chat", "--chat", String(id)], "and again");
    assert.equal(piped.code, EXIT.ok, piped.err.join("\n"));
    assert.equal(piped.written, "MODEL ANSWER\n");
    /** @type {any} */
    const t = await (await shim.api(`/api/sessions/${encodeURIComponent(String(id))}/transcript`)).json();
    assert.equal((t.turns || []).length, 2);
  });

  /**
   * A terminal a person answers at: each question, as it waits at the end of what was written, gets `answer(question,
   * all)` — "n" where that says nothing. A secret's raw mode is a no-op here.
   * @param {(q: string, all: string) => string | undefined} answer
   */
  const person = (answer) => {
    const input = /** @type {any} */ (new PassThrough());
    input.setRawMode = () => {};
    const output = new PassThrough();
    let all = "";
    let at = 0;
    /** @type {string[]} */
    const asked = [];
    output.on("data", (c) => {
      all += String(c);
      if (!/(\] |: )$/.test(all.slice(at))) return;
      const q = all.slice(at).split("\n").at(-1) || "";
      at = all.length;
      asked.push(q);
      const a = answer(q, all) ?? "n";
      setImmediate(() => input.write(`${a}\n`));
    });
    return { term: /** @type {any} */ ({ input, output, tty: true }), asked };
  };

  // (fails before: yes — there was no setup: a person new to Filament had the console's pages alone)
  test("setup at a terminal: the agents' step, a key typed with nothing shown and added, memory left as it is, where it stands", async () => {
    const secret = "sk-ant-setup-test-abcdef0123456789";
    const { term, asked } = person((q, all) => {
      if (/^Add a provider's API key\?/.test(q)) return "y";
      if (/^Number/.test(q) && /Which provider is your key for\?/.test(all.slice(-4000))) return all.match(/ {2}(\d+)\. Anthropic\b/)?.[1];
      if (/^Paste your Anthropic key/.test(q)) return secret;
      if (/^Keep memory on\?/.test(q)) return "n";
      return undefined;
    });
    /** @type {string[]} */
    const out = [];
    const code = await runCli(["setup", "--no-test", "--no-open"], { dataDir: shim.dataDir, term, out: (s) => out.push(s), err: (s) => out.push(`ERR ${s}`) });
    const said = out.join("\n");
    assert.equal(code, EXIT.ok, said);
    assert.match(said, /^Filament setup — every step can be skipped/);
    assert.match(said, /\n1\. Coding agents\n[\s\S]*\n2\. API keys\n[\s\S]*Added Anthropic as "anthropic"[\s\S]*\n3\. Memory\n[\s\S]*Memory is off: filament memory on turns it on\.[\s\S]*\n4\. Ready\n/);
    assert.ok(!said.includes(secret) && !String(term.output.read() || "").includes(secret), "the key is never shown");
    assert.ok(asked.some((q) => q.startsWith("Add another?")), asked.join(" | "));
    /** @type {any} */
    const u = ((await (await shim.api("/api/upstreams")).json()).upstreams || []).find((/** @type {any} */ x) => x.id === "anthropic");
    assert.equal(u?.key?.stored, true);
    await shim.api("/api/upstreams/anthropic", { method: "DELETE" });
  });

  test("settings: get by its path, set typed; models; a usage error is exit 2; setup asks at a terminal (exit 4)", async () => {
    assert.deepEqual([valueOf("true"), valueOf("12"), valueOf('["a"]'), valueOf("plan")], [true, 12, ["a"], "plan"]);
    const set = await run(["settings", "set", "agentLoop.permissions", "ask"]);
    assert.equal(set.code, EXIT.ok, set.err.join("\n"));
    assert.deepEqual((await run(["settings", "get", "agentLoop.permissions"])).out, ["ask"]);
    const models = JSON.parse((await run(["models", "--json"])).out.join("\n"));
    assert.ok(models.some((/** @type {any} */ m) => m.upstream === "m"), JSON.stringify(models));
    assert.equal((await run(["keys", "nope"])).code, EXIT.usage);
    const setup = await run(["setup"]);
    assert.equal(setup.code, EXIT.needsPerson);
    assert.match(setup.err.join("\n"), /filament keys add <provider> --key-stdin/);
  });
});

describe("the review of 9fc83b83a, against a Filament that answers as told", () => {
  /**
   * A Filament of the test's own on a port of its own, its listening.json in a folder of its own: its /api/state, and
   * each other call's answer by method and path; what came, kept.
   * @param {Record<string, (body: any, res: import("node:http").ServerResponse) => any>} routes @param {any} [state]
   */
  const fakeFilament = async (routes, state = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "filament-cli-fake-"));
    /** @type {{ method: string, path: string, body: any }[]} */
    const came = [];
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        const path = String(req.url || "").replace(/^\/api/, "");
        const body = raw ? JSON.parse(raw) : null;
        came.push({ method: String(req.method), path, body });
        if (path === "/state") return void res.end(JSON.stringify({ version: "9.9.9", dataDir: dir, ...state }));
        const route = routes[`${req.method} ${path}`];
        if (!route) {
          res.statusCode = 404;
          return void res.end(JSON.stringify({ error: `no ${req.method} ${path}` }));
        }
        const out = route(body, res);
        if (out !== undefined) res.end(JSON.stringify(out));
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
    const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
    writeListening(dir, { host: "127.0.0.1", port, pid: process.pid, version: "9.9.9", startedAt: 1 });
    return {
      dir,
      came,
      async close() {
        server.closeAllConnections();
        await new Promise((r) => server.close(() => r(undefined)));
        await removeDirs(dir);
      },
    };
  };
  /** A command, run as an agent runs it. @param {string} dir @param {string[]} argv */
  const run = async (dir, argv) => {
    /** @type {{ out: string[], err: string[], written: string }} */
    const said = { out: [], err: [], written: "" };
    const term = /** @type {any} */ ({ input: Readable.from([]), output: new PassThrough(), tty: false });
    const code = await runCli(argv, { dataDir: dir, term, out: (s) => said.out.push(s), err: (s) => said.err.push(s), write: (s) => (said.written += s) });
    return { code, ...said };
  };

  // (fails before: yes — the sv-live hunt's: a stream that dropped mid-reply ended the command in the network's bare words,
  // "terminated", and never said the turn goes on there)
  test("chat: a stream that drops mid-reply says the turn goes on in Filament, and how to go on with it", async () => {
    const f = await fakeFilament({
      "POST /sessions/c1/turns": (_b, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Running the tests" } })}\n\n`);
        // …and the connection is gone: the laptop asleep, the network down.
        setTimeout(() => res.socket?.destroy(), 50);
      },
    });
    try {
      const r = await run(f.dir, ["chat", "--chat", "c1", "run", "the", "tests"]);
      assert.equal(r.code, EXIT.failed, r.err.join("\n"));
      assert.equal(r.written, "Running the tests\n", "its line ended before the words");
      assert.match(r.err.join("\n"), /^filament chat: The connection dropped mid-reply \([^)]+\): the turn goes on in Filament \(chat c1\)\. filament chat --chat c1 <message> goes on with it once it ends\.$/m);
    } finally {
      await f.close();
    }
  });

  // (fails before: yes — a stream that went silent with its socket open, no words and no ping, held the command for ever:
  // the swarm's review of 11-10)
  test("chat: a reply that says nothing past the quiet limit, no ping either, ends the command, saying the turn may go on", async () => {
    const f = await fakeFilament({
      "POST /sessions/c1/turns": (_b, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Running the tests" } })}\n\n`);
      },
    });
    try {
      /** @type {{ out: string[], err: string[], written: string }} */
      const said = { out: [], err: [], written: "" };
      const term = /** @type {any} */ ({ input: Readable.from([]), output: new PassThrough(), tty: false });
      const started = Date.now();
      const code = await runCli(["chat", "--chat", "c1", "run", "the", "tests"], { dataDir: f.dir, term, out: (s) => said.out.push(s), err: (s) => said.err.push(s), write: (s) => (said.written += s), quietMs: 600 });
      assert.equal(code, EXIT.failed, said.err.join("\n"));
      assert.ok(Date.now() - started < 10_000, "ended at the quiet limit");
      assert.equal(said.written, "Running the tests\n");
      assert.match(said.err.join("\n"), /^filament chat: Nothing came from Filament for 1 s: the connection went quiet, and the turn may go on there \(chat c1\)\. filament chat --chat c1 <message> goes on with it once it ends\.$/m);
    } finally {
      await f.close();
    }
  });

  test("chat: sent as typed, past a cold cache's question; a coding agent's question that waits is said, and the command ends (exit 4)", async () => {
    const f = await fakeFilament({
      "POST /sessions/c1/turns": (_b, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Running the tests." } })}\n\n`);
        res.write(`event: filament_run\ndata: ${JSON.stringify({ type: "filament_run", event: { type: "ask", id: "q1", waits: true, form: { title: "May Claude Code run npm test?" } } })}\n\n`);
        // …and the reply stays open, as a turn that waits for the person does.
      },
    });
    try {
      const r = await run(f.dir, ["chat", "--chat", "c1", "run", "the", "tests"]);
      assert.equal(r.code, EXIT.needsPerson, r.err.join("\n"));
      assert.equal(r.written, "Running the tests.\n");
      assert.match(r.err.join("\n"), /the agent asks you: May Claude Code run npm test\? — answer it in the harness \(filament open\), where its turn waits/);
      assert.deepEqual(f.came.find((c) => c.path === "/sessions/c1/turns")?.body, { content: "run the tests", stream: true, runEvents: true, sendAsIs: true });
      assert.ok(!f.came.some((c) => c.path === "/keys"), "a turn needs no inbound key: none is read (the owner's remote Filament of 11-06)");
    } finally {
      await f.close();
    }
  });

  test("stop: the Filament app's is quit by the app, never stopped to come back; a busy shutdown is exit 5", async () => {
    const app = await fakeFilament({}, { supervisor: "desktop" });
    try {
      const r = await run(app.dir, ["stop"]);
      assert.equal(r.code, EXIT.failed);
      assert.match(r.err.join("\n"), /The Filament app runs this Filament, and starts it again when it stops: quit it from its tray/);
      assert.ok(!app.came.some((c) => c.path === "/shutdown"), "nothing asked to stop");
    } finally {
      await app.close();
    }
    const busy = await fakeFilament({
      "POST /shutdown": (_b, res) => {
        res.statusCode = 409;
        return { ok: false, note: "A turn runs in 1 chat: stop it first, or --force", turns: 1 };
      },
    });
    try {
      const r = await run(busy.dir, ["stop"]);
      assert.deepEqual([r.code, r.err.join("\n")], [EXIT.busy, "filament stop: A turn runs in 1 chat: stop it first, or --force (HTTP 409)"]);
    } finally {
      await busy.close();
    }
  });

  test("a 409 is busy unless it says a name is taken, routes name it, or the chat asks first", () => {
    assert.equal(busyOf({ error: "a turn runs", turns: 1 }, 409), true);
    assert.equal(busyOf({ error: "signed in while a turn runs" }, 409), true);
    for (const j of [{ free: "x-2" }, { routes: [] }, { resumeQuestion: {} }, { switchQuestion: {} }]) assert.equal(busyOf(j, 409), false, JSON.stringify(j));
    assert.equal(busyOf({ turns: 1 }, 400), false);
  });

  test("signed in as nobody said whom is signed in; signed out, or none, is not", () => {
    assert.equal(signedInWords({ account: { identity: null, identitySource: "turn" } }), "whom it did not say");
    assert.equal(signedInWords({ account: { identity: { kind: "account", label: "ada@x", plan: "max" } } }), "ada@x · max");
    assert.equal(signedInWords({ account: { identity: { kind: "account", label: "ada@x" }, signedOut: true } }), "");
    assert.equal(signedInWords({ account: { identity: { kind: "none" } } }), "");
    assert.equal(signedInWords({ account: null }), "");
  });

  test("a coding agent's accounts: status, the list and check read each one on, a Default turned off is no sign-in missing; sign-in and sign-out name one (the owner's of 11-05)", async () => {
    const work = { upstream: "claude-code-work", name: "Claude Code · Work", label: "Work", off: false, account: { identity: { kind: "account", label: "Claude Team", plan: "team" } } };
    // A label with a space, signed out: said quoted wherever a line names it to run.
    const spare = { upstream: "claude-code-spare", name: "Claude Code · Api Key", label: "Api Key", off: false, account: { signedOut: true, identity: { kind: "none" } } };
    const f = await fakeFilament({
      "GET /start": () => ({ connected: { ok: true, models: 3 }, memory: { enabled: false } }),
      "GET /upstreams": () => ({ upstreams: [] }),
      "GET /coding-agents": () => ({
        entries: [
          { id: "claude-code", name: "Claude Code", state: "connected", primary: "claude-code-work", upstreams: ["claude-code", "claude-code-work", "claude-code-spare"] },
          // Every account of it off: the agent is off itself (coding-agents.js `stateOf`).
          { id: "codex", name: "Codex", state: "off", primary: "codex", upstreams: ["codex"] },
        ],
      }),
      "GET /agent-accounts": () => ({
        agents: [
          // Its Default, turned off and signed out: first in the list, as Settings has it.
          { upstream: "claude-code", name: "Claude Code", label: "Default", off: true, account: { signedOut: true, identity: { kind: "none", label: "Not logged in" } } },
          work,
          spare,
          { upstream: "codex", name: "Codex", label: "Default", off: true, account: { identity: { kind: "account", label: "bo@x" } } },
        ],
      }),
      "POST /agent-accounts/claude-code-work/check": () => ({ agent: work }),
      "POST /agent-accounts/claude-code-spare/check": () => ({ agent: spare }),
      "POST /agent-accounts/claude-code-work/sign-out": () => ({ ok: true }),
    });
    try {
      const st = (await run(f.dir, ["status"])).out.join("\n");
      assert.match(st, /\n {2}agents {2}: Claude Code — signed in: Work \(Claude Team · team\) · Default off · Api Key not signed in; Codex — off\n/);
      const list = await run(f.dir, ["agents"]);
      assert.equal(list.code, EXIT.ok);
      assert.match(list.out.join("\n"), /claude-code {2}Claude Code {2}connected {2}Work \(Claude Team · team\) · Default off · Api Key not signed in\n/);
      assert.match(list.out.join("\n"), /Claude Code's accounts — --account <name> picks one for sign-in, check and sign-out:\n {2}Default {2}off — Filament does not use it\n {2}Work {5}Claude Team · team\n {2}Api Key {2}not signed in/);
      assert.doesNotMatch(list.out.join("\n"), /sign-in claude-code/, "no sign-in asked of an agent with an account on signed in");
      const listed = JSON.parse((await run(f.dir, ["agents", "--json"])).out.join("\n"));
      assert.deepEqual(listed.find((/** @type {any} */ x) => x.id === "claude-code").accounts.map((/** @type {any} */ a) => [a.label, a.off, a.signedIn]), [["Default", true, ""], ["Work", false, "Claude Team · team"], ["Api Key", false, ""]]);
      const check = await run(f.dir, ["agents", "check", "claude-code"]);
      assert.equal(check.code, EXIT.ok, check.err.join("\n"));
      assert.deepEqual(check.out, ["Claude Code · Default is off: Filament does not use it (Settings › Coding agents turns it on).", "Claude Code · Work is signed in: Claude Team · team.", 'Claude Code · Api Key is not signed in: filament agents sign-in claude-code --account "Api Key".']);
      // One account named keeps its name in the line to run (the review of b416debc8), and one off is never read.
      const one = await run(f.dir, ["agents", "check", "claude-code", "--account", "api key"]);
      assert.deepEqual([one.code, one.out], [EXIT.needsPerson, ['Claude Code · Api Key is not signed in: filament agents sign-in claude-code --account "Api Key".']]);
      const off = await run(f.dir, ["agents", "check", "claude-code", "--account", "default"]);
      assert.deepEqual([off.code, off.out], [EXIT.ok, ["Claude Code · Default is off: Filament does not use it (Settings › Coding agents turns it on)."]]);
      assert.deepEqual((await run(f.dir, ["agents", "check", "codex"])).out, ["Codex is off: Filament does not use it (Settings › Coding agents turns it on)."]);
      assert.ok(!f.came.some((c) => c.path === "/agent-accounts/claude-code/check" || c.path === "/agent-accounts/codex/check"), "an account turned off is not read");
      // One account to sign out or in, named — never one guessed among several, nor one turned off signed in.
      const out = await run(f.dir, ["agents", "sign-out", "claude-code"]);
      assert.deepEqual([out.code, out.err.join("\n")], [EXIT.usage, 'filament agents: Claude Code has 3 accounts: name one with --account Default | Work | "Api Key"']);
      const into = await run(f.dir, ["agents", "sign-in", "claude-code"]);
      assert.deepEqual([into.code, into.err.join("\n")], [EXIT.usage, 'filament agents: Claude Code has 2 accounts on: name one with --account Work | "Api Key"'], "a sign-in is for one of those on");
      const intoOff = await run(f.dir, ["agents", "sign-in", "claude-code", "--account", "Default"]);
      assert.deepEqual([intoOff.code, intoOff.err.join("\n")], [EXIT.needsPerson, "filament agents: Claude Code · Default is off: Filament does not use it — Settings › Coding agents turns one on, then sign it in"]);
      assert.ok(!f.came.some((c) => /sign-(in|out)$/.test(c.path)), "nothing signed in or out");
      const named = await run(f.dir, ["agents", "sign-out", "claude-code", "--account", "work"]);
      assert.deepEqual([named.code, named.out], [EXIT.ok, ["Claude Code · Work is signed out."]]);
      assert.ok(f.came.some((c) => c.method === "POST" && c.path === "/agent-accounts/claude-code-work/sign-out"));
    } finally {
      await f.close();
    }
  });

  // (fails before: yes — over SSH the command offered Codex's page way first, whose page comes back to Filament's own
  // computer alone: the swarm's review of 11-10)
  test("agents sign-in where no page comes back here (SSH): a way that finishes from a browser elsewhere comes first", async () => {
    const codex = { upstream: "codex", name: "Codex", label: "Default", off: false, account: { signedOut: true, identity: { kind: "none" } } };
    const ways = [
      { id: "chatgpt", name: "ChatGPT", description: "in this computer's browser", kind: "browser" },
      { id: "chatgpt-code", name: "ChatGPT on another device", description: "type the code", kind: "browser", far: true },
      { id: "api-key", name: "OpenAI API key", description: "paste a key", kind: "key", label: "OpenAI API key" },
    ];
    const f = await fakeFilament({
      "GET /coding-agents": () => ({ entries: [{ id: "codex", name: "Codex", state: "connected", primary: "codex", upstreams: ["codex"] }] }),
      "GET /agent-accounts": () => ({ agents: [codex] }),
      "POST /agent-accounts/codex/sign-in": () => ({ choose: ways }),
    });
    const was = process.env.SSH_CONNECTION;
    try {
      process.env.SSH_CONNECTION = "10.0.0.2 50000 10.0.0.1 22";
      const far = await run(f.dir, ["agents", "sign-in", "codex"]);
      assert.deepEqual([far.code, far.err.join("\n")], [EXIT.needsPerson, "filament agents: Codex signs in more than one way: give --way, one of chatgpt-code, chatgpt, api-key"]);
      delete process.env.SSH_CONNECTION;
      if (process.platform === "win32" || process.platform === "darwin") {
        const here = await run(f.dir, ["agents", "sign-in", "codex"]);
        assert.equal(here.err.join("\n"), "filament agents: Codex signs in more than one way: give --way, one of chatgpt, chatgpt-code, api-key", "with a screen here, as the agent lists them");
      }
    } finally {
      if (was === undefined) delete process.env.SSH_CONNECTION;
      else process.env.SSH_CONNECTION = was;
      await f.close();
    }
  });

  test("an agent's run sees no part of a key: status and keys say set, settings get leaves the masked ones out", async () => {
    const f = await fakeFilament(
      {
        "GET /start": () => ({ connected: { ok: true, models: 1 }, memory: { enabled: true, installed: true, summarizer: "auto", learnsWith: null, whyNone: "no model can answer" } }),
        "GET /upstreams": () => ({ upstreams: [{ id: "anthropic", name: "Anthropic", enabled: true, key: { stored: true, masked: "sk-a…vwAA" }, provider: { keyless: false } }] }),
      },
      { config: { server: { port: 1, inboundKeysMasked: ["fil-…9f2c"] }, upstreams: [{ id: "anthropic", apiKeyMasked: "sk-a…vwAA" }] } },
    );
    try {
      const st = await run(f.dir, ["status"]);
      const all = [st.out.join("\n"), (await run(f.dir, ["keys", "--json"])).out.join("\n"), (await run(f.dir, ["settings", "get", "server"])).out.join("\n"), (await run(f.dir, ["settings", "get", "upstreams"])).out.join("\n")].join("\n");
      assert.ok(!/vwAA|9f2c|Masked/.test(all), all);
      assert.match(st.out.join("\n"), /\n {2}keys {4}: anthropic \(set\)\n/);
      assert.match(st.out.join("\n"), /\n {2}memory {2}: on, learning with no model \(no model can answer\)$/, "auto is no model it learns with");
    } finally {
      await f.close();
    }
  });

  // (fails before: yes — the review of m1: with memory's model not set, status named the newest chat's model as the one
  // memory learns with, though each chat learns on its own)
  test("status: memory's model not set says each chat's own; one set is named", async () => {
    let memory = { enabled: true, installed: true, summarizer: "", learnsWith: "glm-5.3", chosen: true, whyNone: null };
    const f = await fakeFilament({ "GET /start": () => ({ connected: { ok: true, models: 1 }, memory }), "GET /upstreams": () => ({ upstreams: [] }) }, { config: { server: { port: 1 } } });
    try {
      assert.match((await run(f.dir, ["status"])).out.join("\n"), /\n {2}memory {2}: on, learning with each chat's own model \(glm-5\.3 where none is named\)$/);
      memory = { ...memory, summarizer: "grok-4.6", learnsWith: "grok-4.6", chosen: false };
      assert.match((await run(f.dir, ["status"])).out.join("\n"), /\n {2}memory {2}: on, learning with grok-4\.6$/);
    } finally {
      await f.close();
    }
  });

  test("help: alone, the commands; a key piped in at a terminal is refused, as it would show", async () => {
    /** @type {string[]} */
    const out = [];
    assert.equal(await runCli(["help"], { dataDir: tmpdir(), out: (s) => out.push(s), err: () => {} }), EXIT.ok);
    assert.match(out.join("\n"), /^Usage: filament <command>[\s\S]*\n {2}keys /);
    // (fails before: yes — fxsi's left: the key's question prints a star for each character, and the words said
    // "typed with nothing shown")
    assert.match(out.join("\n"), /add one \(typed as stars\)/);
    assert.ok(!out.join("\n").includes("nothing shown"), out.join("\n"));
    const f = await fakeFilament({ "GET /providers": () => ({ providers: [{ id: "anthropic", name: "Anthropic", prefix: "anthropic", plans: [] }] }) });
    try {
      /** @type {string[]} */
      const err = [];
      const input = /** @type {any} */ (Readable.from([]));
      input.isTTY = true;
      const code = await runCli(["keys", "add", "anthropic", "--key-stdin"], { dataDir: f.dir, term: /** @type {any} */ ({ input, output: new PassThrough(), tty: false }), out: () => {}, err: (s) => err.push(s) });
      assert.equal(code, EXIT.usage);
      assert.match(err.join("\n"), /--key-stdin reads a key piped in[^\n]*: at a terminal, leave it out and type the key: it shows as stars$/);
    } finally {
      await f.close();
    }
  });
});

// (fails before: yes — a secret's question at a terminal that closed never settled, and the command waited on nothing:
// the swarm's review of 11-10)
test("a secret's question ends the command (Stopped., exit 130) where the terminal goes before an answer, as a line's does", async () => {
  const input = /** @type {any} */ (new PassThrough());
  input.setRawMode = () => input;
  const term = /** @type {any} */ ({ input, output: new PassThrough(), tty: true });
  const asked = askSecret(term, "OpenAI API key:");
  input.write("sk-par");
  input.end();
  const out = await Promise.race([asked.then(() => "answered", (/** @type {any} */ e) => e), new Promise((r) => setTimeout(() => r("still waiting"), 2000))]);
  assert.ok(out instanceof CliError, String(out));
  assert.deepEqual([out.message, out.code], ["Stopped.", EXIT.interrupted]);
});

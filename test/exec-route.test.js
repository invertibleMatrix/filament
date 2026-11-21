// @ts-check
// A command run on this machine for another machine's agent (the remote-agents plan's c-exec): POST /api/exec runs one
// command in a folder the agents' fence lets them start a chat in, in this machine's shell, judged by this machine's
// permission mode, and streams its output back; GET /api/exec/:id says how it stands, POST /api/exec/:id/stop stops it
// with everything it started, POST /api/exec/:id/answer answers its ask by a press. Two real Filaments
// (helpers/two-machines.js): `here` paired with `there` as a full device, which mints its machine's agents a device on
// `there`; `there`'s person is its own loopback. Commands are `node -e`, which every shell here runs alike. What a
// network can't make happen on cue — a reader that falls behind, the shutdown ending a response — is driven through the
// route's own rows (`execRoutes`) with a stand-in response (`standIn`) and admin context (`rows`).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pairMachines, startTwoMachines } from "./helpers/two-machines.js";
import { pinnedFetch } from "../src/cli/pinned.js";
import * as execModule from "../src/http/admin/exec.js";
import { EXEC_KEPT_CHARS, EXEC_LIVE_IN_ALL, EXEC_LIVE_PER_CALLER, execRoutes } from "../src/http/admin/exec.js";
import { createRouter } from "../src/http/router.js";
import { SHELL } from "../src/adapters/tools/shell.js";

const JSON_TYPE = { "content-type": "application/json" };

/**
 * Requests to `m` over the network, pinned to its certificate, with `token` as their Bearer: as another machine's
 * Filament sends them. A body that is no string goes as JSON.
 * @param {import("./helpers/two-machines.js").Machine} m @param {string} token
 */
const as = (m, token) => {
  const pinned = pinnedFetch(m.lan.fingerprint);
  /** @param {string} path @param {{ method?: string, body?: unknown, signal?: AbortSignal }} [o] @returns {Promise<Response>} */
  return (path, { method = "GET", body, signal } = {}) =>
    pinned(`${m.far}${path}`, {
      method,
      signal,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : JSON_TYPE) },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
};

/**
 * An exec's SSE stream, read as it comes: its events so far (each with when it arrived), a wait for one, and its end.
 * @param {Response} r
 */
const follow = (r) => {
  /** @type {any[]} */
  const events = [];
  let over = false;
  const ended = (async () => {
    const reader = /** @type {ReadableStreamDefaultReader<Uint8Array>} */ (r.body?.getReader());
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
          const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
          buf = buf.slice(i + 2);
          if (line) events.push({ ...JSON.parse(line.slice(6)), seenAt: Date.now() });
        }
      }
    } catch {}
    over = true;
    return events;
  })();
  /** The first event `pred` takes, waited for; null once the stream ended without one. @param {(e: any) => boolean} pred */
  const until = async (pred, ms = 20_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const e = events.find(pred);
      if (e) return e;
      if (over) return null;
      await new Promise((res) => setTimeout(res, 20));
    }
    return null;
  };
  return { events, ended, until, closed: () => over };
};

/** Wait until `fn` holds, up to `ms`. @param {() => boolean} fn */
const waitFor = async (fn, ms = 15_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((res) => setTimeout(res, 50));
  }
  return fn();
};

/** Whether a process runs. @param {number} pid */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (/** @type {any} */ e) {
    return e?.code === "EPERM";
  }
};

/** An exec as this machine's person reads it once it has ended, waited for. @param {string} id */
const endOf = async (id) => {
  /** @type {any} */
  let x = null;
  for (const end = Date.now() + 10_000; Date.now() < end; await new Promise((res) => setTimeout(res, 50))) {
    x = await (await there.api(`/api/exec/${id}`)).json();
    if (x.state === "ended") break;
  }
  return x;
};

/** A command that writes its process id to `file` in its folder and then runs until stopped. @param {string} file */
const forever = (file) => `node -e "require('fs').writeFileSync('${file}', String(process.pid)); setInterval(() => {}, 1000)"`;

/** @type {Awaited<ReturnType<typeof startTwoMachines>>} */
let two;
/** @type {import("./helpers/two-machines.js").Machine} */
let there;
/** The project folder, one a chat here may start in (under the roots there lists). */
let root = "";
let phoneDir = "";
/** The agents' device of `here`'s full device, its grant `agents` on. @type {{ id: string, call: ReturnType<typeof as> }} */
let agents;
/** Another agents' device, a third machine's ("Phone"), its grant on too. @type {{ id: string, call: ReturnType<typeof as> }} */
let others;

/** There's mode for a new chat, as your defaults set it. @param {"read-only" | "edit" | "ask" | "auto"} m */
const mode = async (m) => {
  const r = await there.api("/api/defaults/settings", { method: "PATCH", body: { patch: { loop: { permissions: m } } } });
  assert.equal(r.status, 200, await r.clone().text());
};

/**
 * A full device mints its machine's agents a device on there, and there's own computer switches its grants on: `agents`,
 * and `unasked`, so there's Auto runs their commands as it runs the person's (x-sec-grants.test.js has it off).
 * @param {(path: string, init?: RequestInit) => Promise<Response>} full
 */
const mintAgents = async (full) => {
  const minted = await full("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: "{}" });
  assert.equal(minted.status, 200, await minted.clone().text());
  const { device, token } = await minted.json();
  const on = await there.api(`/api/remote/devices/${encodeURIComponent(device.id)}`, { method: "PATCH", body: { grants: { agents: true, unasked: true } } });
  assert.equal(on.status, 200, await on.clone().text());
  return { id: String(device.id), call: as(there, token) };
};

before(async () => {
  root = mkdtempSync(join(tmpdir(), "filament-exec-"));
  phoneDir = mkdtempSync(join(tmpdir(), "filament-exec-phone-"));
  mkdirSync(join(root, ".ssh"));
  two = await startTwoMachines({
    there: {
      configure: (cfg) => {
        // The temp folder is a root: the project and there's data folder lie under it, this repository not.
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [tmpdir()], readerModel: "" };
      },
    },
  });
  there = two.there;
  const phone = await pairMachines(/** @type {any} */ ({ dataDir: phoneDir, machine: { name: "Phone" } }), there, { scope: "full" });
  agents = await mintAgents(two.ask);
  others = await mintAgents(phone.ask);
});

after(async () => {
  await two?.stop();
  for (const d of [root, phoneDir]) if (d) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

// (fails before: yes — there was no exec route: POST /api/exec answered another machine's agents 403, the row unnamed in AGENT_ROUTES, and this machine 404)
test("an agents' device runs a command in a project folder: its stdout and stderr streamed as they come, its exit code, the exec read back, and the whole of it as JSON with ?stream=0", async () => {
  await mode("auto");
  const r = await agents.call("/api/exec", { method: "POST", body: { cwd: root, command: `node -e "process.stdout.write('out-1'); process.stderr.write('err-1'); setTimeout(() => { process.stdout.write('out-2'); process.exit(3); }, 600)"` } });
  assert.equal(r.status, 200, r.status === 200 ? "" : await r.text());
  assert.match(String(r.headers.get("content-type")), /text\/event-stream/);
  const id = String(r.headers.get("x-filament-exec"));
  assert.match(id, /^ex_[0-9a-f]{16}$/);
  const s = follow(r);
  const events = await s.ended;
  const exec = events.find((e) => e.type === "exec");
  assert.deepEqual([exec?.id, exec?.state, exec?.mode, exec?.by], [id, "running", "auto", "Filament agents on Laptop"]);
  const out = events.filter((e) => e.type === "output");
  assert.equal(out.filter((e) => e.stream === "stdout").map((e) => e.text).join(""), "out-1out-2");
  assert.equal(out.filter((e) => e.stream === "stderr").map((e) => e.text).join(""), "err-1");
  const exit = events.find((e) => e.type === "exit");
  assert.equal(exit?.code, 3);
  assert.equal(exit?.ended, undefined, "it exited on its own");
  assert.ok(exit.ms >= 500, `it ran ${exit.ms} ms`);
  // Streamed: the first words came before the command ended, not with its end.
  const first = out.find((e) => e.text.includes("out-1"));
  assert.ok(first.seenAt <= exit.seenAt - 300, `out-1 came ${exit.seenAt - first.seenAt} ms before the exit`);
  // Read back: ended, its code, its output kept in the order it was said.
  const got = await (await agents.call(`/api/exec/${id}`)).json();
  assert.deepEqual([got.state, got.code, got.cut, got.cwd.length > 0], ["ended", 3, null, true]);
  assert.equal(got.output.map((/** @type {any} */ p) => p.text).join(""), "out-1err-1out-2");
  // The JSON form: its id at once, the whole result at its end.
  const j = await agents.call("/api/exec?stream=0", { method: "POST", body: { cwd: root, command: `node -e "console.log('json-form'); console.error('to-err')"` } });
  assert.equal(j.status, 200);
  assert.match(String(j.headers.get("x-filament-exec")), /^ex_/);
  const whole = await j.json();
  assert.deepEqual([whole.state, whole.code, whole.ended], ["ended", 0, null]);
  assert.match(whole.output.filter((/** @type {any} */ p) => p.stream === "stdout").map((/** @type {any} */ p) => p.text).join(""), /json-form/);
  assert.match(whole.output.filter((/** @type {any} */ p) => p.stream === "stderr").map((/** @type {any} */ p) => p.text).join(""), /to-err/);
});

// (fails before: yes — no exec route; and an agents' device's folder fence covered POST /sessions alone)
test("an agents' device is refused: outside the fence (a home folder, a credentials folder, the data folder), with a field beyond cwd, command and timeoutMs, and with its grant off", async () => {
  await mode("auto");
  for (const [cwd, words] of [
    // This home folder holds there's data folder (under the temp folder) on Windows and macOS, which is said first.
    [homedir(), /a home folder|Filament's data folder; .* is around it/],
    [join(dirname(homedir()), "filament-exec-someone"), /a home folder/],
    [join(root, ".ssh"), /a credentials folder \(\.ssh\)/],
    [there.dataDir, /never run a command in Filament's data folder/],
  ]) {
    const r = await agents.call("/api/exec", { method: "POST", body: { cwd, command: "node -e \"console.log('no')\"" } });
    assert.equal(r.status, 403, String(cwd));
    assert.match((await r.json()).error, /** @type {RegExp} */ (words), String(cwd));
  }
  for (const extra of [{ env: { A: "1" } }, { shell: "cmd" }, { stdin: "x" }]) {
    const r = await agents.call("/api/exec", { method: "POST", body: { cwd: root, command: "node -e \"console.log('no')\"", ...extra } });
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.match((await r.json()).error, /cwd, command, timeoutMs, mode alone/);
  }
  // A grant switched off: refused, in words that name the grant.
  const off = await there.api(`/api/remote/devices/${encodeURIComponent(others.id)}`, { method: "PATCH", body: { grants: { agents: false } } });
  assert.equal(off.status, 200);
  try {
    const r = await others.call("/api/exec", { method: "POST", body: { cwd: root, command: "node -e \"console.log('no')\"" } });
    assert.equal(r.status, 403);
    const b = await r.json();
    assert.equal(b.grant, "agents");
  } finally {
    await there.api(`/api/remote/devices/${encodeURIComponent(others.id)}`, { method: "PATCH", body: { grants: { agents: true } } });
  }
});

// (fails before: yes — no exec route, so no exec of another's to hide)
test("an exec is its starter's: another agents' device neither sees, stops nor answers it (404), nor one this machine's person started; the person sees every one", async () => {
  await mode("auto");
  const r = await agents.call("/api/exec", { method: "POST", body: { cwd: root, command: forever("pid-mine.txt") } });
  const id = String(r.headers.get("x-filament-exec"));
  const s = follow(r);
  try {
    assert.ok(await waitFor(() => existsSync(join(root, "pid-mine.txt"))), "it runs");
    for (const [method, path, body] of [
      ["GET", `/api/exec/${id}`],
      ["POST", `/api/exec/${id}/stop`, {}],
      ["POST", `/api/exec/${id}/answer`, { allow: true }],
    ]) {
      const no = await others.call(String(path), { method: String(method), body });
      assert.equal(no.status, 404, `${method} ${path}`);
      assert.equal((await no.json()).error, "no such exec");
    }
    assert.equal((await there.api(`/api/exec/${id}`)).status, 200, "this machine's person sees it");
    // One this machine's person started is none of the agents' device's.
    const mine = await there.api("/api/exec?stream=0", { method: "POST", body: { cwd: root, command: "node -e \"console.log('person')\"" } });
    assert.equal(mine.status, 200);
    const personId = String(mine.headers.get("x-filament-exec"));
    assert.equal((await mine.json()).by, "local");
    assert.equal((await agents.call(`/api/exec/${personId}`)).status, 404);
    assert.equal((await agents.call(`/api/exec/${id}`)).status, 200, "its own it sees");
  } finally {
    await agents.call(`/api/exec/${id}/stop`, { method: "POST", body: {} });
    await s.ended;
  }
});

// (fails before: yes — no exec route to stop)
test("a stop kills the command with what it started, and its exit says it was stopped", async () => {
  await mode("auto");
  const r = await agents.call("/api/exec", { method: "POST", body: { cwd: root, command: forever("pid-stop.txt") } });
  const id = String(r.headers.get("x-filament-exec"));
  const s = follow(r);
  assert.ok(await waitFor(() => existsSync(join(root, "pid-stop.txt"))), "it runs");
  const pid = Number(readFileSync(join(root, "pid-stop.txt"), "utf8"));
  assert.equal(alive(pid), true);
  const stopped = await agents.call(`/api/exec/${id}/stop`, { method: "POST", body: {} });
  assert.equal(stopped.status, 200);
  const after = await stopped.json();
  assert.deepEqual([after.state, after.ended, after.reason], ["ended", "stopped", "stopped by Filament agents on Laptop"]);
  assert.ok(await waitFor(() => !alive(pid), 10_000), `node ${pid} is gone`);
  const exit = await s.until((e) => e.type === "exit");
  assert.equal(exit?.ended, "stopped");
  assert.equal((await agents.call(`/api/exec/${id}/stop`, { method: "POST", body: {} })).status, 409, "an ended exec is stopped once");
});

// (fails before: yes — no exec route, so no timeout of one)
test("a timeout stops a command that runs past it, and ends an ask nobody answers without running it", async () => {
  await mode("auto");
  const r = await agents.call("/api/exec", { method: "POST", body: { cwd: root, command: forever("pid-timeout.txt"), timeoutMs: 2500 } });
  const s = follow(r);
  assert.ok(await waitFor(() => existsSync(join(root, "pid-timeout.txt"))), "it runs");
  const pid = Number(readFileSync(join(root, "pid-timeout.txt"), "utf8"));
  const exit = await s.until((e) => e.type === "exit", 20_000);
  assert.equal(exit?.ended, "timeout");
  assert.match(exit.reason, /ran past its timeout of 2500 ms/);
  assert.ok(await waitFor(() => !alive(pid), 10_000), `node ${pid} is gone`);
  // An ask unanswered: it waits out the timeout, and never runs.
  await mode("ask");
  try {
    const a = await agents.call("/api/exec", { method: "POST", body: { cwd: root, command: `node -e "require('fs').writeFileSync('asked.txt', 'x')"`, timeoutMs: 1500 } });
    const t = follow(a);
    assert.ok(await t.until((e) => e.type === "ask"));
    const end = await t.until((e) => e.type === "exit");
    assert.deepEqual([end?.ended, end?.code, end?.ms], ["timeout", null, 0]);
    assert.match(end.reason, /nobody answered its ask/);
    assert.equal(existsSync(join(root, "asked.txt")), false, "never run");
  } finally {
    await mode("auto");
  }
});

// (fails before: yes — no exec route, so no output kept)
test("the output kept is its head and its newest, with what was dropped between them said; the stream carries all of it", async () => {
  await mode("auto");
  const command = `node -e "process.stdout.write('a'.repeat(30000) + 'b'.repeat(30000) + 'c'.repeat(30000))"`;
  const j = await agents.call("/api/exec?stream=0", { method: "POST", body: { cwd: root, command } });
  const whole = await j.json();
  assert.equal(whole.code, 0);
  const text = whole.output.map((/** @type {any} */ p) => p.text);
  assert.equal(text.join("").length, 2 * EXEC_KEPT_CHARS);
  assert.equal(text[0], "a".repeat(EXEC_KEPT_CHARS));
  assert.equal(text[text.length - 1], "c".repeat(EXEC_KEPT_CHARS));
  assert.deepEqual(whole.cut, { dropped: 90_000 - 2 * EXEC_KEPT_CHARS, at: 1 });
  // Streamed, all 90,000; its exit says what the kept copy dropped.
  const r = await agents.call("/api/exec", { method: "POST", body: { cwd: root, command } });
  const events = await follow(r).ended;
  assert.equal(events.filter((e) => e.type === "output").map((e) => e.text).join("").length, 90_000);
  assert.deepEqual(events.find((e) => e.type === "exit")?.cut, { dropped: 90_000 - 2 * EXEC_KEPT_CHARS, at: 1 });
});

// (fails before: yes — no exec route, so no ask of one)
test("in ask mode a command waits on an ask: words alone 400, Allow runs it, Deny refuses it with its words, a second answer 409, this machine's person answers too, and a yes after the mode went read-only runs nothing", async () => {
  await mode("ask");
  try {
    const command = `node -e "console.log('allowed-ran')"`;
    const r = await agents.call("/api/exec", { method: "POST", body: { cwd: root, command } });
    assert.equal(r.status, 200);
    const id = String(r.headers.get("x-filament-exec"));
    const s = follow(r);
    // (fails before: yes — its first event said nothing of the ask; a caller read the exec to know)
    assert.equal((await s.until((e) => e.type === "exec"))?.state, "asking", "its first event says it asks");
    const asked = await s.until((e) => e.type === "ask");
    assert.deepEqual(
      [asked?.ask.id, asked?.ask.kind, asked?.ask.from, asked?.ask.tool, asked?.ask.command, asked?.ask.options.map((/** @type {any} */ o) => o.id), asked?.ask.words],
      [id, "permission", "exec", "bash", command, ["allow", "deny"], true],
    );
    assert.match(asked.ask.question, /May I run this command\?/);
    const waiting = await (await agents.call(`/api/exec/${id}`)).json();
    assert.deepEqual([waiting.state, waiting.ask?.id, waiting.ranAt], ["asking", id, null]);
    // Words alone never allow; a choice it does not offer is none.
    for (const body of [{ words: "yes, go ahead" }, { choice: "always" }, { allow: "yes" }]) {
      const no = await agents.call(`/api/exec/${id}/answer`, { method: "POST", body });
      assert.equal(no.status, 400, JSON.stringify(body));
    }
    assert.equal((await (await agents.call(`/api/exec/${id}`)).json()).state, "asking", "still asking");
    const yes = await agents.call(`/api/exec/${id}/answer`, { method: "POST", body: { allow: true } });
    assert.equal(yes.status, 200);
    assert.deepEqual(await yes.json(), { ok: true, id, ran: true });
    const exit = await s.until((e) => e.type === "exit");
    assert.equal(exit?.code, 0);
    assert.match(s.events.filter((e) => e.type === "output").map((e) => e.text).join(""), /allowed-ran/);
    assert.equal((await agents.call(`/api/exec/${id}/answer`, { method: "POST", body: { allow: true } })).status, 409, "answered once");
    // Deny: it never runs, and the words go with it as its why.
    const d = await agents.call("/api/exec", { method: "POST", body: { cwd: root, command: `node -e "require('fs').writeFileSync('denied.txt', 'x')"` } });
    const dId = String(d.headers.get("x-filament-exec"));
    const ds = follow(d);
    assert.ok(await ds.until((e) => e.type === "ask"));
    const no = await agents.call(`/api/exec/${dId}/answer`, { method: "POST", body: { choice: "deny", words: "not on this machine" } });
    assert.deepEqual(await no.json(), { ok: true, id: dId, ran: false });
    const dExit = await ds.until((e) => e.type === "exit");
    assert.deepEqual([dExit?.ended, dExit?.reason, dExit?.code], ["denied", "denied: not on this machine", null]);
    assert.equal(existsSync(join(root, "denied.txt")), false, "never run");
    // This machine's person answers an agents' device's ask too.
    const p = await agents.call("/api/exec?stream=0", { method: "POST", body: { cwd: root, command: `node -e "console.log('person-allowed')"` } });
    const pId = String(p.headers.get("x-filament-exec"));
    const byPerson = await there.api(`/api/exec/${pId}/answer`, { method: "POST", body: { choice: "allow" } });
    assert.equal(byPerson.status, 200, await byPerson.clone().text());
    const pWhole = await p.json();
    assert.deepEqual([pWhole.code, pWhole.answer?.by, pWhole.answer?.allow], [0, "local", true]);
    assert.match(pWhole.output.map((/** @type {any} */ o) => o.text).join(""), /person-allowed/);
    // A yes after the mode went read-only while it waited: the mode as it stands wins, and nothing runs.
    const late = await agents.call("/api/exec", { method: "POST", body: { cwd: root, command: `node -e "require('fs').writeFileSync('late.txt', 'x')"` } });
    const lId = String(late.headers.get("x-filament-exec"));
    const ls = follow(late);
    assert.ok(await ls.until((e) => e.type === "ask"));
    await mode("read-only");
    const lateYes = await (await agents.call(`/api/exec/${lId}/answer`, { method: "POST", body: { allow: true } })).json();
    assert.equal(lateYes.ran, false);
    assert.match(lateYes.reason, /read-only/);
    assert.equal((await ls.until((e) => e.type === "exit"))?.ended, "denied");
    assert.equal(existsSync(join(root, "late.txt")), false, "never run");
  } finally {
    await mode("auto");
  }
});

// (fails before: yes — no exec route; a command was judged by nothing here)
test("in read-only mode a command that writes is refused with the gate's words, before anything runs", async () => {
  await mode("read-only");
  try {
    const r = await agents.call("/api/exec", { method: "POST", body: { cwd: root, command: `node -e "require('fs').writeFileSync('ro.txt', 'x')"` } });
    assert.equal(r.status, 403);
    const b = await r.json();
    assert.equal(b.mode, "read-only");
    assert.match(b.error, /Not run: this session is read-only/);
    assert.equal(existsSync(join(root, "ro.txt")), false);
  } finally {
    await mode("auto");
  }
});

// (fails before: yes — a mode was a field beyond cwd, command and timeoutMs: refused 400, and this machine's mode judged
// every command)
test("a command sent with the mode of the chat that sent it is judged in that mode, capped by their grants as they stand: edit asks where this machine runs auto, auto runs unasked only with Without asking, read-only refuses; a mode not Filament's is refused", async () => {
  /** A command sent with `sent`, followed to its first event. @param {string} sent @param {string} file */
  const send = async (sent, file) => {
    const r = await agents.call("/api/exec", { method: "POST", body: { cwd: root, command: `node -e "require('fs').writeFileSync('${file}', 'x')"`, mode: sent } });
    if (r.status !== 200) return { status: r.status, body: await r.json(), id: "", s: null, first: null };
    const s = follow(r);
    return { status: r.status, body: null, id: String(r.headers.get("x-filament-exec")), s, first: await s.until((e) => e.type === "exec") };
  };
  const stop = (/** @type {string} */ id) => agents.call(`/api/exec/${id}/stop`, { method: "POST", body: {} });
  await mode("auto");
  try {
    const edit = await send("edit", "sent-edit.txt");
    assert.deepEqual([edit.status, edit.first?.state, edit.first?.mode], [200, "asking", "edit"], "edit asks, though this machine runs auto");
    await stop(edit.id);
    const ro = await send("read-only", "sent-ro.txt");
    assert.deepEqual([ro.status, ro.body?.mode], [403, "read-only"]);
    assert.match(ro.body?.error, /Not run: this session is read-only/);
    // This machine asks; the chat that sent it runs auto, and their device may run without asking here.
    await mode("ask");
    const auto = await send("auto", "sent-auto.txt");
    assert.deepEqual([auto.status, auto.first?.state, auto.first?.mode], [200, "running", "auto"]);
    await auto.s?.until((e) => e.type === "exit");
    assert.equal(existsSync(join(root, "sent-auto.txt")), true, "auto ran it unasked");
    // Without asking switched off: their auto is Edit here, and asks.
    assert.equal((await there.api(`/api/remote/devices/${encodeURIComponent(agents.id)}`, { method: "PATCH", body: { grants: { unasked: false } } })).status, 200);
    try {
      const capped = await send("auto", "sent-capped.txt");
      assert.deepEqual([capped.first?.state, capped.first?.mode], ["asking", "edit"]);
      // Switched on again while it waits: an Allow runs it in the mode it was sent with, as their grants stand.
      assert.equal((await agents.call(`/api/exec/${capped.id}/answer`, { method: "POST", body: { allow: true } })).status, 200);
      assert.equal((await capped.s?.until((e) => e.type === "exit"))?.code, 0);
    } finally {
      await there.api(`/api/remote/devices/${encodeURIComponent(agents.id)}`, { method: "PATCH", body: { grants: { unasked: true } } });
    }
    // A yes after this machine went read-only: the mode it was sent with judges it, not this machine's.
    const late = await send("edit", "sent-late.txt");
    await mode("read-only");
    const lateYes = await (await agents.call(`/api/exec/${late.id}/answer`, { method: "POST", body: { allow: true } })).json();
    assert.equal(lateYes.ran, true, JSON.stringify(lateYes));
    await late.s?.until((e) => e.type === "exit");
    assert.equal(existsSync(join(root, "sent-late.txt")), true);
    for (const bad of ["yolo", 3, ""]) {
      const r = await agents.call("/api/exec", { method: "POST", body: { cwd: root, command: "node -e \"console.log('no')\"", mode: bad } });
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.match((await r.json()).error, /mode by its name, read-only, edit, ask, auto/);
    }
    // (fails before: yes — any caller here sent a mode, and an auto of theirs ran with no ask, the review of 11-10)
    // This machine's person sends none: its own mode judges theirs, moved by its own press alone.
    const mine = await there.api("/api/exec", { method: "POST", body: { cwd: root, command: "node -e \"console.log('no')\"", mode: "auto" } });
    assert.equal(mine.status, 400);
    assert.match((await mine.json()).error, /^a command's mode comes from another machine's agents/);
    // A rule here that asks is said in its first event, so the card there names it.
    await mode("auto");
    const ruled = await there.api("/api/defaults/settings", { method: "PATCH", body: { patch: { loop: { rules: [{ tool: "bash", pattern: "node -e *sent-ruled*", verdict: "ask" }] } } } });
    assert.equal(ruled.status, 200, await ruled.clone().text());
    try {
      const asked = await send("auto", "sent-ruled.txt");
      assert.deepEqual([asked.first?.state, asked.first?.mode, asked.first?.rule], ["asking", "auto", "bash(node -e *sent-ruled*) ask"]);
      await stop(asked.id);
      const plain = await send("edit", "sent-plain.txt");
      assert.deepEqual([plain.first?.state, plain.first?.rule], ["asking", undefined], "the mode asks: no rule named");
      await stop(plain.id);
    } finally {
      await there.api("/api/defaults/settings", { method: "PATCH", body: { patch: { loop: { rules: [] } } } });
    }
  } finally {
    await mode("auto");
  }
});

// (fails before: yes — no exec route; nothing of a device's ran here to stop)
test("a grant switched off and a revoke stop that device's running commands", async () => {
  await mode("auto");
  // The grant off: the other device's command stops, its exit said for this machine's person.
  const g = await others.call("/api/exec", { method: "POST", body: { cwd: root, command: forever("pid-grant.txt") } });
  const gId = String(g.headers.get("x-filament-exec"));
  const gs = follow(g);
  assert.ok(await waitFor(() => existsSync(join(root, "pid-grant.txt"))), "it runs");
  const gPid = Number(readFileSync(join(root, "pid-grant.txt"), "utf8"));
  assert.equal((await there.api(`/api/remote/devices/${encodeURIComponent(others.id)}`, { method: "PATCH", body: { grants: { agents: false } } })).status, 200);
  assert.ok(await waitFor(() => !alive(gPid), 10_000), `node ${gPid} is gone`);
  assert.ok(await waitFor(gs.closed, 5000), "its stream ends");
  const gEnd = await endOf(gId);
  assert.deepEqual([gEnd.state, gEnd.ended], ["ended", "revoked"]);
  assert.match(gEnd.reason, /grant agents was switched off/);
  // A revoke: the same, for the first device.
  const r = await agents.call("/api/exec", { method: "POST", body: { cwd: root, command: forever("pid-revoke.txt") } });
  const id = String(r.headers.get("x-filament-exec"));
  const s = follow(r);
  assert.ok(await waitFor(() => existsSync(join(root, "pid-revoke.txt"))), "it runs");
  const pid = Number(readFileSync(join(root, "pid-revoke.txt"), "utf8"));
  assert.equal((await there.api(`/api/remote/devices/${encodeURIComponent(agents.id)}`, { method: "DELETE" })).status, 200);
  assert.ok(await waitFor(() => !alive(pid), 10_000), `node ${pid} is gone`);
  assert.ok(await waitFor(s.closed, 5000), "its stream ends");
  const end = await endOf(id);
  assert.deepEqual([end.state, end.ended, end.reason], ["ended", "revoked", "the agents' device that started it was revoked"]);
});

// (fails before: yes — the grant route took no `full`, and a device's commands stopped on Agents off and a revoke alone)
test("Full control switched off stops that device's running commands; another pill moved first stops nothing", async () => {
  await mode("auto");
  const yolo = await mintAgents(two.ask);
  const path = `/api/remote/devices/${encodeURIComponent(yolo.id)}`;
  assert.equal((await there.api(path, { method: "PATCH", body: { grants: { full: true } } })).status, 200);
  const r = await yolo.call("/api/exec", { method: "POST", body: { cwd: root, command: forever("pid-full.txt") } });
  const id = String(r.headers.get("x-filament-exec"));
  const s = follow(r);
  assert.ok(await waitFor(() => existsSync(join(root, "pid-full.txt"))), "it runs");
  const pid = Number(readFileSync(join(root, "pid-full.txt"), "utf8"));
  assert.equal((await there.api(path, { method: "PATCH", body: { grants: { models: true } } })).status, 200);
  await new Promise((res) => setTimeout(res, 400));
  assert.ok(alive(pid), "Models moved: it runs on");
  assert.equal((await there.api(path, { method: "PATCH", body: { grants: { full: false } } })).status, 200);
  assert.ok(await waitFor(() => !alive(pid), 10_000), `node ${pid} is gone`);
  assert.ok(await waitFor(s.closed, 5000), "its stream ends");
  const end = await endOf(id);
  assert.deepEqual([end.state, end.ended], ["ended", "revoked"]);
  assert.match(end.reason, /Full control was switched off/);
});

// (fails before: yes — no exec route: this machine's own computer got 404)
test("this machine's person runs one too, in the folder rules as a chat's: a folder that is not there, or outside agentLoop.roots, is refused", async () => {
  await mode("auto");
  const missing = await there.api("/api/exec", { method: "POST", body: { cwd: join(root, "no-such-folder"), command: "node -e \"console.log(1)\"" } });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /does not exist on this machine/);
  const outside = await there.api("/api/exec", { method: "POST", body: { cwd: process.cwd(), command: "node -e \"console.log(1)\"" } });
  assert.equal(outside.status, 403);
  assert.match((await outside.json()).error, /not under any folder listed in agentLoop\.roots/);
  writeFileSync(join(root, "readme.txt"), "the project's own words");
  const ok = await there.api("/api/exec?stream=0", { method: "POST", body: { cwd: root, command: `node -e "process.stdout.write(require('fs').readFileSync('readme.txt', 'utf8'))"` } });
  const whole = await ok.json();
  assert.deepEqual([whole.code, whole.by, whole.output.map((/** @type {any} */ p) => p.text).join("")], [0, "local", "the project's own words"]);
});

// ---- the route's own rows, with a stand-in response ------------------------------------------------------------------

/**
 * A response as the exec rows write to it: what it was sent, and a reader that falls behind on cue — `write` says the
 * stream is full while `behind` (as a socket whose reader is slow says it), and `keepUp` lets it drain. `afterEnd`
 * counts what was written once it had ended, which a real response turns into an error event.
 */
const standIn = ({ behind = false } = {}) => {
  const res = Object.assign(new EventEmitter(), {
    status: 0,
    /** @type {Record<string, any>} */ headers: {},
    body: "",
    behind,
    writableEnded: false,
    destroyed: false,
    afterEnd: 0,
    /** @param {number} status @param {Record<string, any>} [headers] */
    writeHead(status, headers = {}) {
      res.status = status;
      res.headers = headers;
      return res;
    },
    flushHeaders() {},
    /** @param {unknown} chunk */
    write(chunk) {
      if (res.writableEnded) {
        res.afterEnd++;
        return false;
      }
      res.body += String(chunk);
      return !res.behind;
    },
    /** @param {unknown} [chunk] */
    end(chunk) {
      if (res.writableEnded) {
        if (chunk !== undefined) res.afterEnd++;
        return res;
      }
      if (chunk !== undefined) res.body += String(chunk);
      res.writableEnded = true;
      setImmediate(() => res.emit("close"));
      return res;
    },
    keepUp() {
      res.behind = false;
      res.emit("drain");
    },
    /** The SSE events it was sent. @returns {any[]} */
    events: () => res.body.split("\n\n").filter((f) => f.startsWith("data: ")).map((f) => JSON.parse(f.slice(6))),
  });
  return res;
};
/** @typedef {ReturnType<typeof standIn>} StandIn */

const LOCAL = { kind: "local" };
/** Another machine's agents' device, as the admin gate hands it on. @param {string} id */
const agentsOf = (id) => ({ kind: "device", scope: "agent", device: { id, name: `Filament agents on ${id}`, grants: { agents: true } } });

/**
 * The exec rows over a stand-in admin context: this machine's config as `cfg` says it (the temp folder a root), its log
 * kept. `call` runs a row as the admin API would, its `done` the row's end. `more`: what else its admin context holds
 * (`execGraceMs`).
 * @param {any} [cfg] @param {any} [more]
 */
const rows = (cfg = {}, more = {}) => {
  /** @type {string[]} */
  const logs = [];
  const config = { agentLoop: { permissions: "auto", roots: [tmpdir()] }, server: { host: "127.0.0.1" }, sessions: { defaults: {} }, ...cfg };
  const a = {
    config: { get: () => config },
    memory: null,
    dataDir: join(tmpdir(), "filament-exec-no-data"),
    devices: null,
    sseClients: new Set(),
    log: (/** @type {string} */ _level, /** @type {string} */ msg) => logs.push(String(msg)),
    ...more,
  };
  const route = createRouter(execRoutes(a));
  /**
   * @param {string} method @param {string} path  under /api
   * @param {{ body?: any, who?: any, res?: StandIn }} [o]
   */
  const call = (method, path, { body = {}, who = LOCAL, res = standIn() } = {}) => {
    const url = new URL(`http://127.0.0.1/api${path}`);
    const m = route(method, url.pathname.slice(4));
    if (!m) throw new Error(`no row answers ${method} ${path}`);
    const done = Promise.resolve(m.handler({ req: {}, res, url, path: url.pathname.slice(4), method, params: m.params, json: async () => body, who }, a));
    return { res, done, id: () => String(res.headers["x-filament-exec"] || "") };
  };
  /** A row's JSON answer. @param {string} method @param {string} path @param {{ body?: any, who?: any }} [o] */
  const json = async (method, path, o = {}) => {
    const c = call(method, path, o);
    await c.done;
    return { status: c.res.status, body: JSON.parse(c.res.body || "null") };
  };
  return { a, config, logs, call, json };
};

/** Wait `ms`. @param {number} ms */
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// (fails before: no — Node resumes a child's pipes itself at its exit, so the old code lost the rest only where a drain
// landed between two chunks after the exit and the reader fell behind again, which no stand-in times without a race; this
// guards that the pipes are read to the end once the shell has exited, the reader behind all the while)
test("a reader that falls behind loses nothing at the end: once the shell exits its pipes are read on, and the exit says nothing went unread", async () => {
  const { call } = rows();
  const res = standIn({ behind: true });
  const c = call("POST", "/exec", { res, body: { cwd: root, command: `node -e "process.stdout.write('first;'); setTimeout(() => process.stdout.write('x'.repeat(100000)), 300)"` } });
  // Behind past the shell's exit and the drain's second after it.
  await sleep(2500);
  res.keepUp();
  await c.done;
  const events = res.events();
  const out = events.filter((e) => e.type === "output").map((e) => e.text).join("");
  assert.equal(out.length, 100_006);
  assert.equal(out, `first;${"x".repeat(100000)}`);
  const exit = events.find((e) => e.type === "exit");
  assert.deepEqual([exit?.code, exit?.unread, exit?.cut], [0, undefined, { dropped: 100_006 - 2 * EXEC_KEPT_CHARS, at: 1 }]);
});

// (fails before: yes — the output went out as it came, the secret in two chunks bare)
test("privacy.redact: the streamed and the kept output are redacted, a secret split across two chunks too", async () => {
  const { call, json } = rows({ sessions: { defaults: { privacy: { redact: ["sk-test-[a-z0-9]+"] } } } });
  const res = standIn();
  const c = call("POST", "/exec", { res, body: { cwd: root, command: `node -e "process.stdout.write('key sk-test-abc'); setTimeout(() => process.stdout.write('def123 end' + String.fromCharCode(10)), 400)"` } });
  await c.done;
  const out = res.events().filter((e) => e.type === "output").map((e) => e.text);
  assert.equal(out.join(""), "key [redacted] end\n");
  assert.ok(out.every((t) => !/abc|def123/.test(t)), JSON.stringify(out));
  const kept = (await json("GET", `/exec/${c.id()}`)).body;
  assert.equal(kept.output.map((/** @type {any} */ p) => p.text).join(""), "key [redacted] end\n");
});

// (fails before: yes — the held 4096 characters were let go of with the prefix the mark began in, and the rest of a long
// secret went out bare at the end; the c-exec hunt's)
test("privacy.redact: a secret longer than the hold on one line goes out as its one mark, streamed and kept", async () => {
  const { call, json } = rows({ sessions: { defaults: { privacy: { redact: ["sk-test-[a-z0-9]+"] } } } });
  const res = standIn();
  const c = call("POST", "/exec", { res, body: { cwd: root, command: `node -e "process.stdout.write('key sk-test-' + 'a'.repeat(5000) + ' end')"` } });
  await c.done;
  const out = res.events().filter((e) => e.type === "output").map((e) => e.text).join("");
  assert.equal(out, "key [redacted] end");
  const kept = (await json("GET", `/exec/${c.id()}`)).body;
  assert.equal(kept.output.map((/** @type {any} */ p) => p.text).join(""), "key [redacted] end");
});

// (fails before: yes — past eight holds the line went out redacted whole and was let go of, and the rest of the secret
// that came after went out bare: the swarm's review of 11-10)
test("privacy.redact: a secret that runs on past eight holds of one line: the rest of that line is held back, said so, and the next line goes out", async () => {
  const { call, json } = rows({ sessions: { defaults: { privacy: { redact: ["sk-test-[a-z0-9]+"] } } } });
  const res = standIn();
  const c = call("POST", "/exec", { res, body: { cwd: root, command: `node -e "process.stdout.write('key sk-test-' + 'a'.repeat(40000)); setTimeout(() => process.stdout.write('b'.repeat(3000) + ' end' + String.fromCharCode(10) + 'next line'), 400)"` } });
  await c.done;
  const out = res.events().filter((e) => e.type === "output").map((e) => e.text).join("");
  assert.ok(!/aaa|bbb/.test(out), out.slice(0, 300));
  assert.match(out, /^key \[redacted\] \[the rest of this line held back: past 32 KB, it may hold what privacy\.redact hides\]\nnext line$/);
  const kept = (await json("GET", `/exec/${c.id()}`)).body;
  assert.equal(kept.output.map((/** @type {any} */ p) => p.text).join(""), out);
});

// (fails before: yes — the clock ran from the start: 1.5 s of asking left the command 0.5 s, and it ended "timeout")
test("an ask's wait is not the command's time: after Allow it runs on its whole timeout", async () => {
  const { call, json } = rows({ agentLoop: { permissions: "ask", roots: [tmpdir()] } });
  const res = standIn();
  const c = call("POST", "/exec", { res, body: { cwd: root, command: `node -e "setTimeout(() => console.log('ran-whole'), 1200)"`, timeoutMs: 2000 } });
  await sleep(1500);
  assert.equal(res.events().find((e) => e.type === "ask")?.ask.id, c.id());
  assert.equal((await json("POST", `/exec/${c.id()}/answer`, { body: { allow: true } })).body.ran, true);
  await c.done;
  const exit = res.events().find((e) => e.type === "exit");
  assert.deepEqual([exit?.code, exit?.ended], [0, undefined]);
  assert.match(res.events().filter((e) => e.type === "output").map((e) => e.text).join(""), /ran-whole/);
});

// (fails before: yes — the shell's close ended the exec, and nothing stopped what it left in the background) A shell's
// own `&`, its output sent elsewhere: Git Bash names its Windows id in /proc, a POSIX shell its id. cmd.exe has no `&`.
test("the end of an exec stops what it left running in the background, holding none of its output", { skip: SHELL.kind === "cmd" ? "cmd.exe starts nothing in the background" : false }, async () => {
  const { json } = rows();
  const command = `node -e "setInterval(() => {}, 1000)" > /dev/null 2>&1 & { cat /proc/$!/winpid 2>/dev/null || echo $!; } > pid-bg.txt`;
  const got = await json("POST", "/exec?stream=0", { body: { cwd: root, command } });
  assert.equal(got.body.code, 0, JSON.stringify(got.body));
  const pid = Number(readFileSync(join(root, "pid-bg.txt"), "utf8"));
  assert.ok(pid > 0, "its id");
  try {
    assert.ok(await waitFor(() => !alive(pid), 10_000), `node ${pid}, started in the background, is gone`);
  } finally {
    if (alive(pid)) process.kill(pid);
  }
});

// (fails before: yes — nothing of an exec was written to this machine's log)
test("each exec is written to this machine's log: who, where, the command (redacted), the verdict and its end — nothing of its output", async () => {
  const { call, json, logs, config } = rows({ sessions: { defaults: { privacy: { redact: ["sk-test-[a-z0-9]+"] } } } });
  await json("POST", "/exec?stream=0", { body: { cwd: root, command: `node -e "console.log('output-words', 'sk-test-q1')"` } });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^exec ex_[0-9a-f]{16}: local in .+: "node -e \\"console\.log\('output-words', '\[redacted\]'\)\\"" — run — ended: code 0, \d+ ms$/);
  config.agentLoop.permissions = "ask";
  const asked = call("POST", "/exec", { who: agentsOf("phone"), body: { cwd: root, command: `node -e "console.log(1)"` } });
  await waitFor(() => asked.res.events().some((e) => e.type === "ask"), 5000);
  await json("POST", `/exec/${asked.id()}/answer`, { body: { allow: false, words: "no" } });
  await asked.done;
  assert.match(logs[1], /: Filament agents on phone in .+ — asked, denied by local — ended: code none, denied, 0 ms$/);
  config.agentLoop.permissions = "read-only";
  await json("POST", "/exec", { body: { cwd: root, command: `node -e "require('fs').writeFileSync('w.txt', '')"` } });
  assert.match(logs[2], /^exec: local in .+ — refused \(read-only mode\)$/);
  assert.equal(logs.length, 3);
  assert.ok(logs.every((l) => !l.includes("sk-test-q1") && !/output-words\n/.test(l)), "no output, no secret");
});

// (fails before: yes — a caller could have any number of commands here at once)
test("a caller has 8 commands here at once, running or asking, and all callers 32: past that, a 429 in words", async () => {
  const { call } = rows({ agentLoop: { permissions: "ask", roots: [tmpdir()] } });
  /** @type {StandIn[]} */
  const held = [];
  const start = async (/** @type {any} */ who) => {
    const c = call("POST", "/exec", { who, body: { cwd: root, command: `node -e "console.log(1)"` } });
    await sleep(0);
    if (c.res.status === 200) held.push(c.res);
    return c;
  };
  try {
    for (let i = 0; i < EXEC_LIVE_PER_CALLER; i++) assert.equal((await start(agentsOf("phone"))).res.status, 200);
    const over = await start(agentsOf("phone"));
    await over.done;
    assert.equal(over.res.status, 429);
    assert.match(JSON.parse(over.res.body).error, /Filament agents on phone has 8 commands here already, running or asking/);
    // Another caller is not held by the first's.
    assert.equal((await start(LOCAL)).res.status, 200);
    for (const d of ["tablet", "laptop"]) for (let i = 0; i < EXEC_LIVE_PER_CALLER; i++) await start(agentsOf(d));
    for (let i = held.length; i < EXEC_LIVE_IN_ALL; i++) await start(agentsOf("desk"));
    assert.equal(held.length, EXEC_LIVE_IN_ALL);
    const full = await start(agentsOf("watch"));
    await full.done;
    assert.equal(full.res.status, 429);
    assert.match(JSON.parse(full.res.body).error, /32 commands are here already/);
  } finally {
    for (const res of held) res.emit("close");
  }
});

// (fails before: yes — the JSON answer was written after the shutdown had ended the response)
test("the shutdown ending a ?stream=0 exec's response stops it, and nothing is written after", async () => {
  const { a, call, json } = rows();
  const c = call("POST", "/exec?stream=0", { body: { cwd: root, command: `node -e "setInterval(() => {}, 1000)"` } });
  assert.ok(await waitFor(() => (a.sseClients.size > 0), 5000), "it runs");
  await sleep(300);
  for (const r of a.sseClients) /** @type {any} */ (r).end();
  await c.done;
  assert.equal(c.res.afterEnd, 0, "nothing after its end");
  const after = (await json("GET", `/exec/${c.id()}`)).body;
  assert.deepEqual([after.state, after.ended], ["ended", "closed"]);
});

// (fails before: yes — Allow judged the mode and rules alone, and ran in a folder agentLoop.roots no longer listed)
test("Allow judges the folder as it stands: outside agentLoop.roots now, nothing runs", async () => {
  const { call, json, config } = rows({ agentLoop: { permissions: "ask", roots: [tmpdir()] } });
  const c = call("POST", "/exec", { body: { cwd: root, command: `node -e "require('fs').writeFileSync('moved.txt', 'x')"` } });
  await waitFor(() => c.res.events().some((e) => e.type === "ask"), 5000);
  config.agentLoop = { ...config.agentLoop, roots: [join(tmpdir(), "filament-exec-elsewhere")] };
  const yes = (await json("POST", `/exec/${c.id()}/answer`, { body: { allow: true } })).body;
  assert.equal(yes.ran, false);
  assert.match(yes.reason, /not under any folder listed in agentLoop\.roots/);
  await c.done;
  assert.equal(c.res.events().find((e) => e.type === "exit")?.ended, "denied");
  assert.equal(existsSync(join(root, "moved.txt")), false, "never run");
});

/** A command that prints a line ten times a second until stopped. */
const TICKS = `node -e "let n = 0; setInterval(() => console.log('tick ' + ++n), 100)"`;
/** How many ticks an exec's kept output holds. @param {any} view */
const ticksOf = (view) => (view.output || []).map((/** @type {any} */ p) => p.text).join("").split("tick ").length - 1;

// (fails before: yes — finding 1 of the review of 11-11: a stream that closed stopped its command at once, so a gap in
// the network ended a background command another machine's agent still wanted)
test("a running command outlives its stream for a grace: read again by its caller by its id it runs on, each read giving it the grace again; unread past it, it is stopped, in words that say so", async () => {
  const { call, json } = rows({}, { execGraceMs: 1500 });
  const c = call("POST", "/exec", { body: { cwd: root, command: TICKS, timeoutMs: 60_000 } });
  assert.ok(await waitFor(() => c.res.events().some((e) => e.type === "output"), 10_000), "it runs");
  // Its stream goes, by no doing of this machine: the network's, or its caller's.
  c.res.destroyed = true;
  c.res.emit("close");
  await sleep(700);
  const first = (await json("GET", `/exec/${c.id()}`)).body;
  assert.deepEqual([first.state, first.ended], ["running", null], "it runs on");
  // Read again, each read inside the grace, the reads together well past it: it runs on, and its output is kept.
  /** @type {any} */
  let last = first;
  for (let i = 0; i < 3; i++) {
    await sleep(900);
    last = (await json("GET", `/exec/${c.id()}`)).body;
    assert.equal(last.state, "running", `read ${i + 2}`);
  }
  assert.ok(ticksOf(last) > ticksOf(first), `what it printed after its stream went is kept: ${ticksOf(first)} then ${ticksOf(last)}`);
  // Read no more: stopped once the grace has passed, as one whose caller hung up.
  await c.done;
  const end = (await json("GET", `/exec/${c.id()}`)).body;
  assert.deepEqual([end.state, end.ended, end.reason], ["ended", "closed", "its caller hung up, and did not read it again within 2 s"]);
  assert.ok(end.endedAt - last.startedAt > 3400, "it outlived its stream by the reads and the grace");
  assert.equal(/** @type {any} */ (execModule).EXEC_GRACE_MS, 5 * 60_000, "the grace, named");
});

// (fails before: no — these stopped at once, and still do: it guards the grace from reaching them)
test("no grace for a command that still asks, for a ?stream=0 caller, nor where this machine ended the stream itself: each stops at once", async () => {
  // One that asks: its caller gone, nobody answers it.
  const asking = rows({ agentLoop: { permissions: "ask", roots: [tmpdir()] } }, { execGraceMs: 60_000 });
  const a1 = asking.call("POST", "/exec", { who: agentsOf("phone"), body: { cwd: root, command: `node -e "require('fs').writeFileSync('asked.txt', 'x')"` } });
  assert.ok(await waitFor(() => a1.res.events().some((e) => e.type === "ask"), 5000), "it asks");
  a1.res.destroyed = true;
  a1.res.emit("close");
  await a1.done;
  const asked = (await asking.json("GET", `/exec/${a1.id()}`, { who: agentsOf("phone") })).body;
  assert.deepEqual([asked.state, asked.ended, asked.reason], ["ended", "closed", "its caller hung up"]);
  // The shutdown ends a running one's stream: stopped at once.
  const { a, call, json } = rows({}, { execGraceMs: 60_000 });
  const c = call("POST", "/exec", { body: { cwd: root, command: TICKS, timeoutMs: 60_000 } });
  assert.ok(await waitFor(() => c.res.events().some((e) => e.type === "output"), 10_000), "it runs");
  for (const r of a.sseClients) /** @type {any} */ (r).end();
  await c.done;
  const down = (await json("GET", `/exec/${c.id()}`)).body;
  assert.deepEqual([down.state, down.ended, down.reason], ["ended", "closed", "its caller hung up"]);
  // A ?stream=0 caller reads nothing by its id: gone, its command stops.
  const j = call("POST", "/exec?stream=0", { body: { cwd: root, command: TICKS, timeoutMs: 60_000 } });
  assert.ok(await waitFor(() => a.sseClients.size > 0, 5000), "it runs");
  await sleep(300);
  j.res.destroyed = true;
  j.res.emit("close");
  await j.done;
  const gone = (await json("GET", `/exec/${j.id()}`)).body;
  assert.deepEqual([gone.state, gone.ended], ["ended", "closed"]);
});

// (fails before: yes — while this was written: a command in its grace had left the streams the shutdown ends, so a
// shutdown left it running with no Filament to stop it)
test("the shutdown stops a command that runs on in its grace, its stream gone: nothing is left running for nobody", async () => {
  const { a, call, json } = rows({}, { execGraceMs: 60_000 });
  const c = call("POST", "/exec", { body: { cwd: root, command: TICKS, timeoutMs: 60_000 } });
  assert.ok(await waitFor(() => c.res.events().some((e) => e.type === "output"), 10_000), "it runs");
  c.res.destroyed = true;
  c.res.emit("close");
  await sleep(300);
  assert.equal((await json("GET", `/exec/${c.id()}`)).body.state, "running", "in its grace");
  // The shutdown ends what it holds (server.js).
  for (const r of a.sseClients) /** @type {any} */ (r).end();
  await c.done;
  const down = (await json("GET", `/exec/${c.id()}`)).body;
  assert.deepEqual([down.state, down.ended, down.reason], ["ended", "closed", "Filament here shut down while it ran on with its stream gone"]);
  assert.equal(a.sseClients.size, 0, "nothing of it is held once it ended");
});

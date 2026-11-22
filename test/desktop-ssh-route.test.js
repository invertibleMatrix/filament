// @ts-check
// A machine reached over SSH (desktop/lib/ssh-route.js; the owner's remote Filament of 11-06, Part 2, p2-ssh): the Add
// sheet's ssh:// address, ssh's arguments and its words, the tunnels this computer holds — over a fake ssh and a fake
// port probe —, the route kept and picked through its tunnel (lib/machines.js), the Add sheet's check (lib/add-machine.js),
// and the app's wiring (main.js).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FILAMENT_PORT, LOCAL_PORTS, RETRY_MAX_MS, RETRY_MS, aliasOf, createTunnels, freePort, listSsh, localOf, sshArgs, sshAsked, sshCli, sshWords, staleOf } from "../desktop/lib/ssh-route.js";
import { MACHINES_FILE, addMachine, pickRoute, readKept, routeOf } from "../desktop/lib/machines.js";
import { checkMachine } from "../desktop/lib/add-machine.js";

const ROUTE = Object.freeze({ kind: "ssh", url: "http://127.0.0.1:5555", alias: "filtest", port: 20300 });

describe("the address", () => {
  // (fails before: yes — no SSH route)
  test("an alias is a Host of your SSH config or [user@]host, never an ssh option", () => {
    for (const ok of ["filtest", "kai@box.local", "my_host-1.example.com", "b0x", "u.ser@10.0.0.9"]) assert.equal(aliasOf(ok), ok, ok);
    assert.equal(aliasOf("  filtest "), "filtest");
    for (const no of ["", "-oProxyCommand=calc", "-p", "a b", "a'b", 'a"b', "a;b", "a@b@c", "@host", "user@-x", "box\n-oX", "a/b", "[::1]", "x".repeat(254), null, undefined])
      assert.equal(aliasOf(no), "", String(no));
    assert.equal(aliasOf("x".repeat(253)), "x".repeat(253));
  });

  test("the Add sheet's ssh:// — or ssh <alias> — names an alias and Filament's port there; anything else is no SSH address", () => {
    assert.equal(FILAMENT_PORT, 20300);
    assert.deepEqual(sshAsked("ssh://filtest"), { alias: "filtest", port: 20300 });
    assert.deepEqual(sshAsked("  SSH://kai@box.local:20310/ "), { alias: "kai@box.local", port: 20310 });
    assert.deepEqual(sshAsked("ssh filtest"), { alias: "filtest", port: 20300 });
    for (const none of ["https://192.168.0.9:20343", "filtest", "sshx://box", "ssh", "", "box:22"]) assert.equal(sshAsked(none), null, none);
    for (const bad of ["ssh://-oProxyCommand=calc", "ssh -oProxyCommand=calc", "ssh://a b", "ssh://", "ssh://box:", "ssh://'box'"]) assert.match(/** @type {any} */ (sshAsked(bad)).words, /is no SSH host: write ssh:\/\//, bad);
    assert.match(/** @type {any} */ (sshAsked("ssh://box:0")).words, /^0 is no port/);
    assert.match(/** @type {any} */ (sshAsked("ssh://box:70000")).words, /^70000 is no port/);
  });

  test("ssh runs with no shell, no terminal, in batch mode, its forward on loopback alone, the alias after --", () => {
    assert.deepEqual(sshArgs("filtest", 20300, 5555), [
      "-N", "-T",
      "-o", "BatchMode=yes",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ControlMaster=no",
      "-o", "ControlPath=none",
      "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=3",
      "-o", "ConnectTimeout=10",
      "-L", "127.0.0.1:5555:127.0.0.1:20300",
      "--", "filtest",
    ]);
    assert.equal(sshCli({ platform: "win32", env: { SystemRoot: "D:\\Win" }, exists: () => true }), "D:\\Win\\System32\\OpenSSH\\ssh.exe");
    assert.equal(sshCli({ platform: "win32", env: {}, exists: () => false }), "ssh");
    assert.equal(sshCli({ platform: "darwin", env: {}, exists: () => true }), "ssh");
  });

  test("what ssh said, in words", () => {
    const w = (/** @type {string} */ said) => sshWords(said, "filtest", 5555);
    // Windows' OpenSSH, as it said them in the drive.
    assert.match(w("No ED25519 host key is known for [127.0.0.1]:22022 and you have requested strict checking.\r\nHost key verification failed.\r\n"), /^ssh does not know filtest's host key yet: connect once from a terminal \(ssh filtest\)/);
    assert.match(w("@@@@@@@@\r\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\r\nHost key verification failed."), /^filtest's host key is not the one your known_hosts has: nothing was sent/);
    assert.match(w("kai@127.0.0.1: Permission denied (publickey)."), /^filtest refused your SSH keys/);
    assert.match(w("ssh: Could not resolve hostname nope: No such host is known."), /^filtest is not found/);
    assert.match(w("ssh: connect to host 127.0.0.1 port 22022: Connection refused"), /^filtest refuses SSH/);
    assert.match(w("ssh: connect to host 10.0.0.9 port 22: Connection timed out"), /^filtest does not answer/);
    assert.match(w("bind [127.0.0.1]:5555: Address already in use\r\nchannel_setup_fwd_listener_tcpip: cannot listen to port: 5555\r\nCould not request local forwarding."), /^Port 5555 on this computer cannot be listened at/);
    // (the review of 5739eb5b1: a port the system keeps refuses with "Permission denied", said as keys refused)
    assert.match(w("bind [127.0.0.1]:5555: Permission denied\r\nchannel_setup_fwd_listener_tcpip: cannot listen to port: 5555\r\nCould not request local forwarding."), /^Port 5555 on this computer cannot be listened at — something holds it, or the system keeps it —: the tunnel to filtest cannot start there. Remove the machine from this window \(its ⋯ in the machines menu\) and add it again/);
    assert.match(w("bind [127.0.0.1]:8080: Address already in use\r\nchannel_setup_fwd_listener_tcpip: cannot listen to port: 8080\r\nCould not request local forwarding."), /^Your SSH config forwards port 8080 for filtest/, "a forward of the config's: named by its own port");
    assert.match(w("\nspawn ssh ENOENT"), /^This computer has no ssh/);
    assert.equal(w("\n  kex_exchange_identification: read: Connection reset\n"), "ssh to filtest ended: kex_exchange_identification: read: Connection reset");
    assert.equal(w(""), "ssh to filtest ended before its tunnel came up.");
  });
});

/** A fake ssh: its stderr, its exit and close, killed as Node's kill does — its end heard a turn later. @param {number} pid */
const fakeChild = (pid) => {
  /** @type {any} */
  const c = new EventEmitter();
  c.pid = pid;
  c.stderr = new EventEmitter();
  c.stderr.setEncoding = () => {};
  c.killed = 0;
  c.kill = () => {
    c.killed++;
    setImmediate(() => (c.emit("exit", null, "SIGTERM"), c.emit("close", null, "SIGTERM")));
  };
  /** ssh ending by itself, having said `said`. @param {string} said */
  c.end = (said) => {
    if (said) c.stderr.emit("data", said);
    c.emit("exit", 255, null);
    c.emit("close", 255, null);
  };
  return c;
};

/** The tunnels over a fake ssh, a fake port probe, and a clock each wait moves; `step` runs after each wait. @param {any} [o] */
const rig = (o = {}) => {
  let clock = 1_000_000;
  /** @type {any} */
  const r = {
    listening: new Set(),
    /** @type {{ file: string, args: string[], opts: any, c: any }[]} */
    spawned: [],
    /** @type {() => void} */
    step: () => {},
    tick: (/** @type {number} */ ms) => void (clock += ms),
    lines: /** @type {string[]} */ ([]),
    /** What the process list says holds a port: none, unless a test says. @type {(local: number) => Promise<number[]>} */
    stale: async () => [],
    /** @type {number[]} */
    killed: [],
    /** @type {(port: number) => Promise<boolean>} */
    probe: async (port) => r.listening.has(port),
  };
  r.t = createTunnels({
    spawn: (file, args, opts) => {
      const c = fakeChild(700 + r.spawned.length);
      r.spawned.push({ file, args, opts, c });
      return c;
    },
    probe: (port) => r.probe(port),
    stale: (local) => r.stale(local),
    kill: (pid) => void r.killed.push(pid),
    cli: () => "ssh",
    log: (line) => r.lines.push(line),
    now: () => clock,
    wait: async (ms) => {
      clock += ms;
      await new Promise((res) => setImmediate(res));
      r.step();
    },
    ...o,
  });
  return r;
};
/** A step that has the last ssh's forward listen, at the port its -L names. @param {any} r */
const comesUp = (r) => () => {
  const args = r.spawned.at(-1)?.args;
  if (args) r.listening.add(Number(args[args.indexOf("-L") + 1].split(":")[1]));
};

describe("the tunnels", () => {
  // (fails before: yes — no tunnels)
  test("held: ssh started for the route, up once its forward listens; two holds at once share one start; held while up, none started", async () => {
    const r = rig();
    r.step = comesUp(r);
    const both = await Promise.all([r.t.hold(ROUTE), r.t.hold({ ...ROUTE })]);
    assert.deepEqual(both, [null, null]);
    assert.equal(r.spawned.length, 1, "one ssh for both");
    assert.equal(r.spawned[0].file, "ssh");
    assert.deepEqual(r.spawned[0].args, sshArgs("filtest", 20300, 5555));
    assert.equal(r.spawned[0].opts.windowsHide, true);
    assert.equal(r.spawned[0].opts.stdio[0], "ignore", "nothing typed into it");
    assert.equal(await r.t.hold(ROUTE), null);
    assert.equal(r.spawned.length, 1, "up: none started");
    assert.deepEqual(r.lines, ["ssh: a tunnel to filtest at 127.0.0.1:5555"]);
  });

  test("dropped: its forward gone, its ssh ended and started anew; one that ended by itself started anew at the next hold; the old one's exit is never the new one's", async () => {
    const r = rig();
    r.step = comesUp(r);
    await r.t.hold(ROUTE);
    r.listening.delete(5555);
    assert.equal(await r.t.hold(ROUTE), null);
    assert.deepEqual([r.spawned.length, r.spawned[0].c.killed], [2, 1], "a forward gone under a running ssh: ended, started anew");
    await new Promise((res) => setImmediate(res));
    assert.equal(await r.t.hold(ROUTE), null);
    assert.equal(r.spawned.length, 2, "the old ssh's exit, heard late, is not the new one's");
    r.listening.delete(5555);
    r.spawned[1].c.end("Timeout, server 127.0.0.1 not responding.");
    assert.equal(await r.t.hold(ROUTE), null);
    assert.deepEqual([r.spawned.length, r.spawned[1].c.killed], [3, 0], "ended by itself: started anew, nothing killed");
  });

  test("refused: what ssh said, in words; not run again for RETRY_MS — asked meanwhile, the same words —, then again; up, it is forgotten", async () => {
    const r = rig();
    r.step = () => {
      const c = r.spawned.at(-1)?.c;
      if (c && !c.said) {
        c.said = true;
        c.end("kai@127.0.0.1: Permission denied (publickey).\r\n");
      }
    };
    const why = await r.t.hold(ROUTE);
    assert.match(String(why), /^filtest refused your SSH keys/);
    assert.ok(r.lines.some((l) => l.startsWith("ssh: the tunnel to filtest: filtest refused your SSH keys")));
    r.tick(RETRY_MS - 1000);
    assert.equal(await r.t.hold(ROUTE), why, "asked again soon: the same words");
    assert.equal(r.spawned.length, 1, "ssh not run again");
    r.tick(1000);
    r.step = comesUp(r);
    assert.equal(await r.t.hold(ROUTE), null);
    assert.equal(r.spawned.length, 2);
    r.listening.delete(5555);
    r.spawned[1].c.end("");
    r.step = () => r.spawned.at(-1).c.end("Connection refused");
    assert.match(String(await r.t.hold(ROUTE)), /^ssh to filtest ended|refuses SSH/, "failing after it was up: its own words, no wait left from before");
    assert.equal(r.spawned.length, 3);
    const gone = rig();
    gone.step = () => gone.spawned.at(-1).c.emit("error", new Error("spawn ssh ENOENT"));
    assert.match(String(await gone.t.hold(ROUTE)), /^This computer has no ssh/);
  });

  // (fails before: yes — the review of 5739eb5b1: a host that stayed down was run every RETRY_MS for as long as the app ran; the Add sheet's ask after a host key was accepted met the last failure's words)
  test("failures in a row wait longer each, to RETRY_MAX_MS; a fresh ask — a person's — is run whatever failed a moment ago", async () => {
    const r = rig();
    r.step = () => r.spawned.at(-1).c.end("ssh: connect to host 10.0.0.9 port 22: Connection timed out");
    await r.t.hold(ROUTE);
    r.tick(RETRY_MS);
    await r.t.hold(ROUTE);
    assert.equal(r.spawned.length, 2, "after the first failure: RETRY_MS");
    r.tick(RETRY_MS);
    await r.t.hold(ROUTE);
    assert.equal(r.spawned.length, 2, "after the second: twice that");
    r.tick(RETRY_MS);
    await r.t.hold(ROUTE);
    assert.equal(r.spawned.length, 3);
    for (let i = 0; i < 6; i++) {
      r.tick(RETRY_MAX_MS);
      await r.t.hold(ROUTE);
    }
    assert.equal(r.spawned.length, 9, "never longer than RETRY_MAX_MS");
    r.step = () => r.spawned.at(-1).c.end("No ED25519 host key is known for [127.0.0.1]:22022 and you have requested strict checking.\r\nHost key verification failed.");
    r.tick(RETRY_MAX_MS);
    assert.match(String(await r.t.hold(ROUTE)), /^ssh does not know filtest's host key yet/);
    r.step = comesUp(r);
    assert.match(String(await r.t.hold(ROUTE)), /^ssh does not know/, "a look's ask: the last words");
    assert.equal(await r.t.hold(ROUTE, { fresh: true }), null, "the person accepted the key and asks again: run");
    r.listening.delete(5555);
    r.spawned.at(-1).c.end("");
    r.step = () => r.spawned.at(-1).c.end("ssh: connect to host 10.0.0.9 port 22: Connection timed out");
    await r.t.hold(ROUTE);
    r.tick(RETRY_MS);
    const n = r.spawned.length;
    await r.t.hold(ROUTE);
    assert.equal(r.spawned.length, n + 1, "up in between: the wait starts over at RETRY_MS");
  });

  // (fails before: yes — the review of 5739eb5b1: a close or another route's tunnel while a start probed its port left an ssh running behind it)
  test("closed, or its place taken, while a start is on its way: no ssh started for it, none left running", async () => {
    /** @type {Function[]} */
    const asked = [];
    const r = rig();
    r.probe = () => new Promise((res) => asked.push(res));
    const closing = r.t.hold(ROUTE);
    r.t.close();
    asked.shift()?.(false);
    assert.equal(await closing, "The app is closing.");
    assert.equal(r.spawned.length, 0, "closed mid-probe: nothing started");

    const q = rig();
    q.probe = () => new Promise((res) => asked.push(res));
    const first = q.t.hold(ROUTE);
    const second = q.t.hold({ ...ROUTE, alias: "box" });
    asked.shift()?.(false);
    assert.equal(await first, "Another tunnel took its place.");
    assert.equal(q.spawned.length, 0, "the replaced one started nothing");
    q.probe = async (port) => q.listening.has(port);
    q.step = comesUp(q);
    asked.shift()?.(false);
    assert.equal(await second, null);
    assert.deepEqual(q.spawned.map((x) => x.args.at(-1)), ["box"], "only the route that took its place");

    const z = rig();
    /** @type {Function[]} */
    const listed = [];
    z.listening.add(5555);
    z.stale = () => new Promise((res) => listed.push(res));
    const looking = z.t.hold(ROUTE);
    await new Promise((res) => setImmediate(res));
    z.t.close();
    listed.shift()?.([]);
    assert.equal(await looking, "The app is closing.");
    assert.equal(z.spawned.length, 0, "closed while the process list was read: nothing started");

    const u = rig();
    u.step = () => {
      if (u.spawned.length === 1 && !u.closed) {
        u.closed = true;
        u.t.close();
      }
    };
    assert.equal(await u.t.hold(ROUTE), "The app is closing.");
    assert.equal(u.spawned[0].c.killed, 1, "closed as it came up: ended");
  });

  // (fails before: yes — the review of 5739eb5b1: an ssh an earlier run left — the app crashed — held the port for good)
  test("its port held by an ssh an earlier run left: found by the process list, ended, and the tunnel started; never one of this run's, nor another program", async () => {
    const r = rig();
    r.step = comesUp(r);
    const OTHER = { kind: "ssh", url: "http://127.0.0.1:5556", alias: "box", port: 20300 };
    await r.t.hold(OTHER);
    r.listening.add(5555);
    r.stale = async (local) => (local === 5555 ? [r.spawned[0].c.pid, 4242] : []);
    // The earlier run's ssh gone once it is ended: the port free, until this run's own listens there.
    r.probe = async (port) => {
      if (port === 5555 && r.killed.includes(4242) && !r.freed) {
        r.freed = true;
        r.listening.delete(5555);
      }
      return r.listening.has(port);
    };
    assert.equal(await r.t.hold(ROUTE), null);
    assert.deepEqual(r.killed, [4242], "the earlier run's alone");
    assert.ok(r.lines.includes("ssh: an earlier run's tunnel to 127.0.0.1:5555 ended (pid 4242)"));
    assert.equal(r.spawned.length, 2, "then its own started");
    const taken = rig();
    taken.listening.add(5555);
    taken.stale = async () => [4343];
    assert.match(String(await taken.t.hold(ROUTE)), /^Port 5555 on this computer is taken by another program/, "still held once it was ended: said");
    assert.equal(taken.spawned.length, 0);
  });

  test("the process list: this app's own ssh at that very forward, never another ssh of yours nor another program; read on Windows by PowerShell, elsewhere by ps", async () => {
    const listed = [
      `1234 "C:\\Windows\\System32\\OpenSSH\\ssh.exe" -N -T -o BatchMode=yes -o ExitOnForwardFailure=yes -o ControlMaster=no -L 127.0.0.1:5555:127.0.0.1:20300 -- filtest`,
      `  987 ssh -N -T -o BatchMode=yes -o ExitOnForwardFailure=yes -L 127.0.0.1:5555:127.0.0.1:20300 -- box`,
      `1300 ssh -N -T -o BatchMode=yes -o ExitOnForwardFailure=yes -L 127.0.0.1:55550:127.0.0.1:20300 -- filtest`,
      `1301 ssh -L 127.0.0.1:5555:127.0.0.1:22 box`,
      `1302 python tunnel.py -o BatchMode=yes -o ExitOnForwardFailure=yes -L 127.0.0.1:5555:127.0.0.1:1`,
      `garbage`,
      ``,
    ].join("\r\n");
    assert.deepEqual(staleOf(listed, 5555), [1234, 987]);
    assert.deepEqual(staleOf("", 5555), []);
    /** @type {any[]} */
    const ran = [];
    const exec = /** @type {any} */ ((/** @type {string} */ file, /** @type {string[]} */ args, /** @type {any} */ o, /** @type {Function} */ done) => (ran.push({ file, args, o }), done(null, "42 ssh x")));
    assert.equal(await listSsh({ platform: "win32", exec }), "42 ssh x");
    assert.equal(ran[0].file, "powershell.exe");
    assert.deepEqual(ran[0].args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
    assert.match(Buffer.from(ran[0].args[3], "base64").toString("utf16le"), /^Get-CimInstance Win32_Process -Filter "Name='ssh\.exe'" \| ForEach-Object \{ "\$\(\$_\.ProcessId\) \$\(\$_\.CommandLine\)" \}$/);
    assert.equal(ran[0].o.windowsHide, true);
    await listSsh({ platform: "linux", exec });
    assert.deepEqual([ran[1].file, ran[1].args], ["ps", ["-axo", "pid=,command="]]);
    const cut = /** @type {any} */ ((/** @type {any} */ _f, /** @type {any} */ _a, /** @type {any} */ _o, /** @type {Function} */ done) => done(new Error("timed out"), "4242 ssh -N -T -o BatchMode=yes -o Exit"));
    assert.equal(await listSsh({ platform: "linux", exec: cut }), "", "a list cut short is none: never half of one read");
  });

  // (fails before: yes — the review of 5739eb5b1: an old ssh's late stderr was read as the new one's; its exit was taken before what it said was read)
  test("what an old ssh says late is never the new one's; an ssh is ended once what it said is read whole", async () => {
    const r = rig();
    r.step = comesUp(r);
    await r.t.hold(ROUTE);
    r.listening.delete(5555);
    r.step = () => {
      if (r.spawned.length !== 2 || r.done) return;
      r.done = true;
      r.spawned[0].c.stderr.emit("data", "bind [127.0.0.1]:5555: Address already in use\r\n");
      r.spawned[1].c.end("kai@127.0.0.1: Permission denied (publickey).");
    };
    assert.match(String(await r.t.hold(ROUTE)), /^filtest refused your SSH keys/);
    const slow = rig();
    let n = 0;
    slow.step = () => {
      const c = slow.spawned[0].c;
      n++;
      if (n === 1) c.emit("exit", 255, null);
      if (n === 2) {
        c.stderr.emit("data", "kai@127.0.0.1: Permission denied (publickey).");
        c.emit("close", 255, null);
      }
    };
    assert.match(String(await slow.t.hold(ROUTE)), /^filtest refused your SSH keys/, "its words, though its exit came first");
  });

  test("its port taken by another program: said, ssh never run; one that never comes up is ended at holdMs, and said", async () => {
    const taken = rig();
    taken.listening.add(5555);
    assert.match(String(await taken.t.hold(ROUTE)), /^Port 5555 on this computer is taken by another program/);
    assert.equal(taken.spawned.length, 0);
    const slow = rig({ holdMs: 1000, every: 200 });
    assert.match(String(await slow.t.hold(ROUTE)), /^ssh to filtest did not come up in 1 s: does it wait on something/);
    assert.equal(slow.spawned[0].c.killed, 1, "ended");
  });

  test("what is no SSH route this app reads is refused, ssh never run: an alias that is an option, another kind, an end not on this computer's loopback, no port", async () => {
    const r = rig();
    for (const bad of [
      { ...ROUTE, alias: "-oProxyCommand=calc" },
      { ...ROUTE, alias: "a b" },
      { ...ROUTE, kind: "url" },
      { ...ROUTE, url: "http://192.168.0.2:5555" },
      { ...ROUTE, url: "https://127.0.0.1:5555" },
      { ...ROUTE, url: "http://localhost:5555" },
      { ...ROUTE, url: "http://127.0.0.1" },
      { ...ROUTE, port: 0 },
      { ...ROUTE, port: 70000 },
      { ...ROUTE, port: "20300 -oX" },
      null,
    ])
      assert.equal(await r.t.hold(bad), "This is no SSH route this app reads.", JSON.stringify(bad));
    assert.equal(r.spawned.length, 0);
    assert.equal(localOf(ROUTE), 5555);
  });

  test("another alias at a route's port: the old ssh ended, the new one started", async () => {
    const r = rig();
    r.step = comesUp(r);
    await r.t.hold(ROUTE);
    r.listening.delete(5555);
    assert.equal(await r.t.hold({ ...ROUTE, alias: "box" }), null);
    assert.equal(r.spawned[0].c.killed, 1);
    assert.deepEqual(r.spawned[1].args.slice(-3), ["127.0.0.1:5555:127.0.0.1:20300", "--", "box"]);
  });

  test("a route for an alias and a port: a tunnel's or a kept machine's local port for the same two, else a free one", async () => {
    const r = rig({ kept: () => [{ kind: "ssh", url: "http://127.0.0.1:6000", alias: "box", port: 20300 }, { kind: "url", url: "http://localhost:20310" }], free: async () => 7000 });
    assert.deepEqual(await r.t.routeFor("box", 20300), { kind: "ssh", url: "http://127.0.0.1:6000", alias: "box", port: 20300 });
    assert.deepEqual(await r.t.routeFor("box", 20310), { kind: "ssh", url: "http://127.0.0.1:7000", alias: "box", port: 20310 }, "another port there: a tunnel of its own");
    assert.equal((await r.t.routeFor("filtest", 20300)).url, "http://127.0.0.1:7000");
    r.step = comesUp(r);
    await r.t.hold(ROUTE);
    assert.equal((await r.t.routeFor("filtest", 20300)).url, "http://127.0.0.1:5555", "the tunnel held: its port");
    // (fails before: yes — the review of 5739eb5b1: a port free now was given though a kept machine, its tunnel down, had it)
    const picks = [6000, 5555, 8000, 7001];
    const busy = rig({ kept: () => [{ kind: "ssh", url: "http://127.0.0.1:6000", alias: "box", port: 20300 }, { kind: "url", url: "http://127.0.0.1:8000" }], free: async () => /** @type {number} */ (picks.shift()) });
    busy.step = comesUp(busy);
    await busy.t.hold(ROUTE);
    assert.equal((await busy.t.routeFor("other", 20300)).url, "http://127.0.0.1:7001", "never a kept route's port, a tunnel's, nor a kept address's on this computer");
    const p = await freePort();
    assert.ok(p >= LOCAL_PORTS.from && p <= LOCAL_PORTS.to, `${p}: below the dynamic range`);
  });

  test("only the kept: a tunnel no machine kept goes through ends once its grace is past; close ends every one, a start under way too, and nothing after", async () => {
    const r = rig();
    const BOX = { kind: "ssh", url: "http://127.0.0.1:5556", alias: "box", port: 20300 };
    r.step = comesUp(r);
    await r.t.hold(ROUTE);
    await r.t.hold(BOX);
    r.t.only([ROUTE.url]);
    assert.equal(r.spawned[1].c.killed, 0, "held just now — an Add sheet's check —: kept a while");
    r.tick(120_001);
    r.t.only([ROUTE.url]);
    assert.deepEqual([r.spawned[0].c.killed, r.spawned[1].c.killed], [0, 1], "kept: stays; the other ended");
    assert.ok(r.lines.includes("ssh: the tunnel to box ended: no machine kept goes through it"));
    r.listening.clear();
    r.step = () => {};
    const under = r.t.hold(BOX);
    await new Promise((res) => setImmediate(res));
    r.t.close();
    assert.equal(await under, "The app is closing.");
    assert.deepEqual(r.spawned.map((s) => s.c.killed), [1, 1, 1], "every ssh ended, the one starting too");
    assert.equal(await r.t.hold(ROUTE), "The app is closing.");
    assert.equal(r.spawned.length, 3, "nothing started after");
  });
});

describe("kept and picked", () => {
  test("a route kept as its end here, the alias read as one and Filament's port; anything else is none", () => {
    assert.deepEqual(routeOf({ kind: "ssh", url: "http://127.0.0.1:5555/", alias: " filtest ", port: "20300", more: 1 }), ROUTE);
    for (const bad of [{ ...ROUTE, alias: "-oX" }, { ...ROUTE, url: "http://localhost:5555" }, { ...ROUTE, url: "https://127.0.0.1:5555" }, { ...ROUTE, port: 0 }, { ...ROUTE, port: 1.5 }, { ...ROUTE, url: undefined }])
      assert.equal(routeOf(bad), null, JSON.stringify(bad));
    const file = join(mkdtempSync(join(tmpdir(), "fil-ssh-")), MACHINES_FILE);
    addMachine(file, { id: "m-box", name: "Workstation", routes: [ROUTE], partition: "persist:machine-m-box" });
    assert.deepEqual(readKept(file)[0].routes, [ROUTE], "kept as it is, read back the same");
  });

  test("picked: its tunnel held before it is asked; refused, its words and the next way; up with no Filament, said; another machine through it, wrong", async () => {
    const M = { id: "m-box", name: "Workstation", routes: [ROUTE, { kind: "url", url: "http://localhost:20310" }], partition: "", addedAt: null };
    /** @type {string[]} */
    const order = [];
    const got = await pickRoute(M, {
      hold: async (r) => (order.push(`hold ${/** @type {any} */ (r).alias}`), null),
      ask: async (r, p) => (order.push(`ask ${r.url}${p}`), { status: 200, json: { id: "m-box", name: "Workstation" } }),
    });
    assert.deepEqual(got.route, ROUTE);
    assert.deepEqual(order, ["hold filtest", "ask http://127.0.0.1:5555/.well-known/filament"]);
    const no = await pickRoute(M, { hold: async () => "filtest refused your SSH keys", ask: async (r) => (r.kind === "ssh" ? assert.fail("asked with no tunnel") : { status: 200, json: { id: "m-box" } }) });
    assert.deepEqual(no.tried, [{ url: ROUTE.url, why: "filtest refused your SSH keys" }]);
    assert.equal(no.route?.kind, "url");
    const none = await pickRoute({ ...M, routes: [ROUTE] }, { hold: async () => null, ask: async () => Promise.reject(new TypeError("fetch failed")) });
    assert.match(none.tried[0].why, /^no Filament answers on filtest at port 20300 through the tunnel: is it running there, and does its SSH server let a port be forwarded/);
    const other = await pickRoute({ ...M, routes: [ROUTE] }, { hold: async () => null, ask: async () => ({ status: 200, json: { id: "m-other", name: "Laptop" } }) });
    assert.equal(other.tried[0].wrong, true);
    const slow = await pickRoute({ ...M, routes: [ROUTE] }, { hold: async () => null, ask: async () => Promise.reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })) });
    assert.equal(slow.tried[0].why, "no answer from Filament on filtest through the tunnel in 5 s", "too slow is said as that");
    let asked = 0;
    await pickRoute({ ...M, routes: [ROUTE] }, { ask: async () => (asked++, { status: 200, json: { id: "m-box" } }) });
    assert.equal(asked, 1, "no tunnels to hold it: asked as it is");
  });

  test("the Add sheet's check: an ssh:// address's tunnel held, then who answers through it — no code, no fingerprint; an alias that is none, no tunnels, or none there said", async () => {
    /** @type {any[]} */
    const held = [];
    let why = /** @type {string | null} */ (null);
    /** @type {any[]} */
    const fors = [];
    /** @type {any[]} */
    const helds = [];
    const ssh = {
      routeFor: async (/** @type {string} */ alias, /** @type {number} */ port) => (fors.push([alias, port]), { kind: /** @type {const} */ ("ssh"), url: "http://127.0.0.1:5555", alias, port }),
      hold: async (/** @type {any} */ r, /** @type {any} */ o) => (held.push(r), helds.push(o), why),
    };
    /** @type {string[]} */
    const fetched = [];
    const fetchImpl = /** @type {any} */ (async (/** @type {string} */ url) => (fetched.push(url), new Response(JSON.stringify({ id: "m-box", name: "Workstation", version: "1.4.0" }), { status: 200 })));
    assert.match(String(/** @type {any} */ (await checkMachine({ link: "ssh://-oProxyCommand=calc" }, { ssh, fetchImpl })).words), /is no SSH host/);
    assert.deepEqual([fors, fetched], [[], []], "nothing run for an option");
    assert.match(String(/** @type {any} */ (await checkMachine({ link: "ssh://filtest" }, { fetchImpl })).words), /^This window holds no SSH tunnel/);
    why = "filtest refused your SSH keys";
    assert.deepEqual(await checkMachine({ link: "ssh://filtest" }, { ssh, fetchImpl }), { ok: false, words: "filtest refused your SSH keys" });
    assert.deepEqual(fetched, [], "no tunnel: nothing asked");
    why = null;
    const got = await checkMachine({ link: "ssh://kai@box:20310", code: "IGNORED" }, { ssh, fetchImpl });
    assert.deepEqual(got, {
      ok: true,
      url: "http://127.0.0.1:5555",
      code: "",
      fingerprint: "",
      route: { kind: "ssh", url: "http://127.0.0.1:5555", alias: "kai@box", port: 20310 },
      machine: { id: "m-box", name: "Workstation", version: "1.4.0" },
      ssh: "kai@box",
    });
    assert.deepEqual(fors.at(-1), ["kai@box", 20310]);
    assert.deepEqual(held.at(-1), got.ok && got.route);
    assert.deepEqual(helds.at(-1), { fresh: true }, "a person asks: whatever failed a moment ago is tried again");
    assert.deepEqual(fetched, ["http://127.0.0.1:5555/.well-known/filament"]);
    const silent = await checkMachine({ link: "ssh filtest" }, { ssh, fetchImpl: /** @type {any} */ (async () => Promise.reject(new TypeError("fetch failed"))) });
    assert.equal(String(/** @type {any} */ (silent).words), "The tunnel to filtest is up, but no Filament answers at port 20300 there: is it running, on that port?");
    const named = await checkMachine({ link: "ssh://filtest:2222" }, { ssh, fetchImpl: /** @type {any} */ (async () => Promise.reject(new TypeError("fetch failed"))) });
    assert.match(String(/** @type {any} */ (named).words), /at port 2222 there: is it running, on that port\? The port after the colon is Filament's on that machine — SSH's own is your SSH config's\.$/, "a port named: which port it is");
  });
});

test("the app holds the tunnels: the rail's pick, the tray's watch and the Add sheet's check through them; one no machine kept goes through ended; all ended as the app quits", () => {
  const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
  assert.match(main, /const tunnels = createTunnels\(\{ log: \(line\) => log\.line\(line\), kept: \(\) => readKept\(machinesFile\)\.flatMap\(\(m\) => m\.routes\) \}\);/);
  assert.match(main, /const pickHeld = \(m\) => pickRoute\(m, \{ hold: \(route\) => tunnels\.hold\(route\) \}\);/);
  assert.match(main, /createRail\(\{[\s\S]*?pick: pickHeld,\s+check: \(input\) => checkMachine\(input, \{ ssh: tunnels \}\),[\s\S]*?\}\);/);
  assert.match(main, /createFleet\(\{\s+machines: \(\) => readKept\(machinesFile\),\s+pick: pickHeld,/);
  // A disconnected machine's tunnel let go too (the owner's of 11-08).
  assert.match(main, /async function watchLook\(\{ only = null \} = \{\}\) \{[\s\S]{0,300}const kept = readKept\(machinesFile\);\n\s+tunnels\.only\(kept\.filter\(\(m\) => !m\.off\)\.flatMap\(\(m\) => m\.routes\.filter\(\(r\) => r\.kind === "ssh"\)\.map\(\(r\) => String\(r\.url\)\)\)\);/);
  assert.match(main, /quitting = true;\s+tunnels\.close\(\);/);
  assert.match(main, /app\.on\("will-quit", \(\) => tunnels\.close\(\)\);/);
});

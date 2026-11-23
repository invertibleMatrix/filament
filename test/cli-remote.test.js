// @ts-check
// The command line on another machine (the owner's remote Filament of 11-06, Part 1): `filament pair` on the machine
// Filament runs on says a code and its links; `filament connect <link>` on the other claims it and keeps the device
// token in remotes.json, never said; `--machine <name>` sends any command there — the machine at the address asked who it is first, so the token goes to the one it was paired with
// alone — and a chat's turn goes with no inbound key. Another machine stands here behind a proxy of the test's own that
// adds X-Forwarded-For, as `tailscale serve` hands a tailnet's requests on.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { runCli } from "../src/cli/main.js";
import { EXIT } from "../src/cli/client.js";
import { REMOTES_FILE, connectRemote, connectTo, disconnect, pairingOf, readRemotes } from "../src/cli/remotes.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

/**
 * A proxy on this machine for `port`, as tailscale serve is: each request handed on with X-Forwarded-For, the stream
 * piped as it comes. What each request carried, kept.
 * @param {number} port
 */
const proxyTo = async (port) => {
  /** @type {{ path: string, auth: boolean }[]} */
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ path: String(req.url), auth: !!req.headers.authorization });
    const out = http.request({ host: "127.0.0.1", port, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}`, "x-forwarded-for": "100.88.1.2" } }, (up) => {
      res.writeHead(Number(up.statusCode), up.headers);
      up.pipe(res);
    });
    out.on("error", () => res.destroy());
    req.pipe(out);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  const url = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
  return {
    url,
    seen,
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(() => r(undefined)));
    },
  };
};

/** A command, run as an agent runs it, from the laptop's own data folder. @param {string} dir @param {string[]} argv */
const run = async (dir, argv) => {
  /** @type {{ out: string[], err: string[], written: string }} */
  const said = { out: [], err: [], written: "" };
  const term = /** @type {any} */ ({ input: Readable.from([]), output: new PassThrough(), tty: false });
  const code = await runCli(argv, { dataDir: dir, term, out: (s) => said.out.push(s), err: (s) => said.err.push(s), write: (s) => (said.written += s) });
  return { code, ...said, all: [...said.out, ...said.err, said.written].join("\n") };
};

test("pairingOf: the link's address, the code and the certificate's fingerprint in its fragment, or the code typed beside an address", () => {
  assert.deepEqual(pairingOf("http://192.168.1.20:20300/ui/pair.html#code=ABCD-EFGH"), { url: "http://192.168.1.20:20300", code: "ABCD-EFGH", fingerprint: "" });
  assert.deepEqual(pairingOf("https://box.tail1234.ts.net/ui/pair.html#code=abcd-efgh"), { url: "https://box.tail1234.ts.net", code: "abcd-efgh", fingerprint: "" });
  assert.deepEqual(pairingOf(`https://192.168.1.20:20343/ui/pair.html#code=ABCD-EFGH&fp=${"ab".repeat(32)}`), { url: "https://192.168.1.20:20343", code: "ABCD-EFGH", fingerprint: `${"AB:".repeat(31)}AB` });
  assert.equal(pairingOf("https://box:1/ui/pair.html#code=ABCD-EFGH&fp=ABCD").fingerprint, "", "a part of one is none");
  // (fails before: yes — the hunt of p1-cli: an address with no scheme was http, then refused before its --fingerprint was read)
  assert.deepEqual(pairingOf("box.lan:20343", "WXYZ-2345"), { url: "https://box.lan:20343", code: "WXYZ-2345", fingerprint: "" }, "an address with no scheme is https for another machine");
  assert.deepEqual(pairingOf("127.0.0.1:20300", "WXYZ-2345"), { url: "http://127.0.0.1:20300", code: "WXYZ-2345", fingerprint: "" }, "and plain http for this one");
  assert.equal(pairingOf("localhost:9", "WXYZ-2345").url, "http://localhost:9");
  assert.deepEqual(pairingOf("http://box:1/ui/pair.html#code=AAAA-AAAA", "BBBB-BBBB"), { url: "http://box:1", code: "BBBB-BBBB", fingerprint: "" }, "a code typed wins");
  assert.throws(() => pairingOf("ftp://box/x"), { code: EXIT.usage });
  assert.throws(() => pairingOf("http://"), { code: EXIT.usage });
});

// (fails before: yes — the command line asked the Filament of its own data folder alone, over loopback, and had no pair)
test("filament pair here, connect there, then --machine: status, a chat with no inbound key, the lists; a machine that is not the one paired gets no token; revoked, it says so; disconnect signs out", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-cli-remote-root-"));
  const laptop = mkdtempSync(join(tmpdir(), "filament-cli-laptop-"));
  const up = await fakeUpstream((/** @type {any} */ call) => (call.kind === "anthropic" ? anthropicReply("Hello from home.", { model: "m-1" }) : undefined));
  const home = await startApp({
    configure: (cfg) => {
      cfg.server.requireAuth = true;
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
    },
  });
  const proxy = await proxyTo(home.port);
  try {
    const name = String((await (await fetch(`${home.url}/.well-known/filament`)).json()).name);
    // A wrong code: refused in the server's words, nothing kept.
    const wrong = await run(laptop, ["connect", `${proxy.url}/ui/pair.html#code=AAAA-AAAA`]);
    assert.equal(wrong.code, EXIT.failed, wrong.all);
    assert.match(wrong.all, /HTTP 403/);
    assert.equal(existsSync(join(laptop, REMOTES_FILE)), false);
    // `filament pair` on the home machine: the code, and — Filament listening on 127.0.0.1 alone — no link yet.
    const said = await run(home.dataDir, ["pair"]);
    assert.equal(said.code, EXIT.ok, said.all);
    const code = said.out.join("\n").match(/^Code ([A-Z2-9]{4}-[A-Z2-9]{4}) — a full device/)?.[1];
    assert.ok(code, said.all);
    assert.match(said.all, /No other machine reaches Filament on the network yet: turn on Settings › Remote access › Reach this machine on my network/);
    assert.equal((await run(laptop, ["pair"])).code, EXIT.noFilament, "the laptop runs no Filament to pair with");
    // The link the pairing page takes, its code in the fragment.
    const paired = await run(laptop, ["connect", `${proxy.url}/ui/pair.html#code=${code}`, "--name", "Work laptop"]);
    assert.equal(paired.code, EXIT.ok, paired.all);
    assert.ok(paired.out.join("\n").startsWith(`Connected to ${name} at ${proxy.url} as "Work laptop" (full: it drives)`), paired.all);
    const kept = JSON.parse(readFileSync(join(laptop, REMOTES_FILE), "utf8"));
    // The token, read through the store: the file holds it sealed (services/machines/remotes.js).
    const token = readRemotes(laptop)[0].token;
    assert.match(token, /^fdt_/);
    assert.ok(!paired.all.includes(token), "the token is never said");
    if (process.platform !== "win32") assert.equal(statSync(join(laptop, REMOTES_FILE)).mode & 0o777, 0o600);
    // Status there, as the device it is.
    const st = await run(laptop, ["status", "--machine", name, "--json"]);
    assert.equal(st.code, EXIT.ok, st.all);
    const s = JSON.parse(st.out.join("\n"));
    assert.deepEqual([s.running, s.url, s.machine, s.as?.name, s.as?.scope], [true, proxy.url, name, "Work laptop", "full"]);
    // A chat there: no inbound key read, none sent.
    const chat = await run(laptop, ["chat", "--machine", name.toLowerCase(), "--model", "m-1", "--folder", root, "say", "hello"]);
    assert.equal(chat.code, EXIT.ok, chat.all);
    assert.equal(chat.written, "Hello from home.\n");
    // (fails before: yes — the hunt of p1-cli: with no --folder the chat was made in this computer's own folder, which
    // the other machine refused or took as one of its own) Its newest chat's folder there.
    const bare = await run(laptop, ["chat", "--machine", name, "--model", "m-1", "say", "again"]);
    assert.equal(bare.code, EXIT.ok, bare.all);
    const there = (await home.api("/api/memory/sessions?limit=1&client=harness").then((r) => r.json())).sessions[0];
    assert.equal(String(there.cwd).toLowerCase(), String(realpathSync(root)).toLowerCase(), "made in its newest chat's folder there");
    // (fails before: yes — the hunt of p1-cli: open --machine opened a page this browser was not paired for, unsaid)
    const opened = await run(laptop, ["open", "--machine", name, "--no-open"]);
    assert.equal(opened.code, EXIT.ok, opened.all);
    assert.deepEqual(opened.out, [`${proxy.url}/ui/harness.html`, `This browser is not paired with ${name}: the page asks for a code — Settings › Remote access there makes one (or run \`filament pair\` on ${name}).`]);
    // (fails before: yes — the hunt of p1-cli: pair took FILAMENT_MACHINE, and asked the other machine, which pairs none
    // from afar) This machine's own, whatever the variable says; --machine refused.
    process.env.FILAMENT_MACHINE = name;
    try {
      const own = await run(home.dataDir, ["pair", "--json"]);
      assert.equal(own.code, EXIT.ok, own.all);
      assert.match(JSON.parse(own.out.join("\n")).code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    } finally {
      delete process.env.FILAMENT_MACHINE;
    }
    assert.equal((await run(laptop, ["pair", "--machine", name])).code, EXIT.usage);
    // (fails before: yes — s0b: `filament open` here opened the harness unpaired, the browser riding on being this
    // computer, unnamed) A one-time link to the pairing page, its code for a browser here (devices.js `here`); `console`
    // goes on to the console.
    const here = await run(home.dataDir, ["open", "--no-open"]);
    assert.equal(here.code, EXIT.ok, here.all);
    assert.match(here.out[0], /^http:\/\/127\.0\.0\.1:\d+\/ui\/pair\.html#code=[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(here.out[1], "A one-time link, good for 5 min: the browser that opens it, on this computer or through an SSH tunnel to it, is paired as this computer's own. Over a tunnel, open it at the tunnel's own address and port.");
    const toConsole = await run(home.dataDir, ["open", "console", "--no-open"]);
    assert.match(toConsole.out[0], /#code=[A-Z2-9]{4}-[A-Z2-9]{4}&to=console$/);
    const open = (await (await home.api("/api/remote/pair")).json()).pending;
    assert.ok(open.length >= 2 && open.every((/** @type {any} */ c) => c.scope === "full"), "full devices' codes");
    await home.api("/api/remote/pair", { method: "DELETE" });
    assert.ok(!proxy.seen.some((x) => x.path === "/api/keys"), "the keys are never asked for");
    const list = await run(laptop, ["machines", "--json"]);
    assert.deepEqual(JSON.parse(list.out.join("\n")).map((/** @type {any} */ r) => [r.name, r.url, r.scope]), [[name, proxy.url, "full"]]);
    assert.ok(!list.all.includes("fdt_"), "the list holds no token");
    assert.equal((await run(laptop, ["status", "--machine", "nowhere"])).code, EXIT.usage, "a name no pairing has");
    // The address answered by another machine: its token is not sent there.
    writeFileSync(join(laptop, REMOTES_FILE), JSON.stringify({ remotes: kept.remotes.map((/** @type {any} */ r) => ({ ...r, machine: { ...r.machine, id: "another-machine" } })) }));
    const before = proxy.seen.length;
    const other = await run(laptop, ["status", "--machine", name]);
    assert.equal(other.code, EXIT.noFilament, other.all);
    assert.match(other.all, /not .* that this command line paired with: its token is not sent there/);
    assert.ok(proxy.seen.slice(before).every((x) => !x.auth), "no request carried the token");
    writeFileSync(join(laptop, REMOTES_FILE), JSON.stringify(kept));
    // The devices, from the home machine and from the laptop as a full device; revoked there, it is said so.
    const devs = await run(home.dataDir, ["devices", "--json"]);
    assert.deepEqual(JSON.parse(devs.out.join("\n")).map((/** @type {any} */ d) => [d.name, d.scope, d.kind]), [["Work laptop", "full", "cli"]]);
    assert.equal((await run(laptop, ["devices", "--machine", name])).code, EXIT.ok, "a full device lists them");
    const revoke = await run(home.dataDir, ["devices", "revoke", "work laptop"]);
    assert.equal(revoke.code, EXIT.ok, revoke.all);
    assert.match(revoke.out.join("\n"), /^Revoked Work laptop: its token stops now/);
    const revoked = await run(laptop, ["status", "--machine", name]);
    assert.equal(revoked.code, EXIT.failed, revoked.all);
    assert.match(revoked.all, /no longer knows this device/);
    // Paired again and unpaired: signed out there, forgotten here.
    const again = JSON.parse((await run(home.dataDir, ["pair", "--view", "--json"])).out.join("\n"));
    assert.equal((await run(laptop, ["connect", proxy.url, again.code])).code, EXIT.ok);
    assert.equal(JSON.parse(readFileSync(join(laptop, REMOTES_FILE), "utf8")).remotes.length, 1, "the same machine, one pairing");
    const viewed = await run(laptop, ["status", "--machine", name, "--json"]);
    assert.equal(viewed.code, EXIT.ok, viewed.all);
    assert.equal(JSON.parse(viewed.out.join("\n")).as.scope, "view", "a view device's status reads what it may");
    // (fails before: yes — the hunt of p1-cli: connecting again kept the old device's token good there) Connected again,
    // the device it had signs out there.
    const third = JSON.parse((await run(home.dataDir, ["pair", "--json"])).out.join("\n"));
    assert.equal((await run(laptop, ["connect", proxy.url, third.code])).code, EXIT.ok);
    const listed = (await home.api("/api/remote/devices").then((r) => r.json())).devices;
    assert.deepEqual(listed.map((/** @type {any} */ d) => [d.scope, d.revokedAt != null]), [["full", false], ["view", true], ["full", true]], "newest first: the view device signed out as the new one came");
    const gone = await run(laptop, ["disconnect", name]);
    assert.equal(gone.code, EXIT.ok, gone.all);
    assert.deepEqual(JSON.parse(readFileSync(join(laptop, REMOTES_FILE), "utf8")).remotes, []);
    const devices = (await home.api("/api/remote/devices").then((r) => r.json())).devices;
    assert.ok(devices.length === 3 && devices.every((/** @type {any} */ d) => d.revokedAt != null), "signed out there");
    assert.equal(gone.out.join("\n"), `Signed out of ${name}, and forgot it.`);
  } finally {
    await proxy.close();
    await home.stop();
    await up.close();
    for (const d of [root, laptop]) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// (fails before: yes — the command line spoke plain http to any address, and an https one with a certificate no authority
// vouches for was refused by fetch, with no way to trust the machine's own)
test("over the network: connect pins the certificate its link carries; with none it says the certificate's and sends nothing; another certificate gets no token; plain http to another machine is refused", async () => {
  const laptop = mkdtempSync(join(tmpdir(), "filament-cli-lan-"));
  const home = await startApp({ configure: (cfg) => void (cfg.server.lan = { enabled: true, port: 0 }), overrides: { lanHost: "127.0.0.1" } });
  try {
    const lan = home.started.lan;
    const at = `https://127.0.0.1:${lan.listening.port}`;
    const hex = String(lan.fingerprint).replace(/:/g, "");
    const code = (await (await home.api("/api/remote/pair", { method: "POST", body: { scope: "full" } })).json()).code;
    const open = async () => (await (await home.api("/api/remote/pair")).json()).pending.length;
    const plain = await run(laptop, ["connect", "http://192.168.1.20:20300", code]);
    assert.equal(plain.code, EXIT.usage);
    assert.match(plain.all, /http:\/\/192\.168\.1\.20:20300 is plain http to another machine, where anyone on the network reads what is sent/);
    const bare = await run(laptop, ["connect", at, code]);
    assert.equal(bare.code, EXIT.usage);
    assert.ok(bare.all.includes(`The certificate at ${at} has the fingerprint ${lan.fingerprint}. If Settings › Remote access on that machine shows the same, connect again with --fingerprint ${lan.fingerprint}`), bare.all);
    const wrong = await run(laptop, ["connect", `${at}/ui/pair.html#code=${code}&fp=${"00".repeat(32)}`]);
    assert.equal(wrong.code, EXIT.noFilament);
    assert.match(wrong.all, /not the one this command line pinned .*: nothing was sent/);
    assert.equal(await open(), 1, "the code was never sent: still open");
    assert.equal(existsSync(join(laptop, REMOTES_FILE)), false);
    const ok = await run(laptop, ["connect", `${at}/ui/pair.html#code=${code}&fp=${hex}`, "--name", "Laptop CLI"]);
    assert.equal(ok.code, 0, ok.all);
    const kept = JSON.parse(readFileSync(join(laptop, REMOTES_FILE), "utf8")).remotes[0];
    assert.deepEqual([kept.url, kept.fingerprint, kept.device.name], [at, lan.fingerprint, "Laptop CLI"]);
    const status = await run(laptop, ["status", "--machine", kept.name, "--json"]);
    assert.equal(status.code, 0, status.all);
    // --fingerprint beside a bare address, in any spelling.
    const again = (await (await home.api("/api/remote/pair", { method: "POST", body: { scope: "view" } })).json()).code;
    const typed = await run(laptop, ["connect", at, again, "--fingerprint", hex.toLowerCase()]);
    assert.equal(typed.code, 0, typed.all);
    // The certificate there is another than the one pinned (made anew, or another machine at the address): no token goes.
    const remotes = JSON.parse(readFileSync(join(laptop, REMOTES_FILE), "utf8"));
    remotes.remotes[0].fingerprint = `${"00:".repeat(31)}00`;
    writeFileSync(join(laptop, REMOTES_FILE), JSON.stringify(remotes));
    const pinned = await run(laptop, ["status", "--machine", kept.name]);
    assert.equal(pinned.code, EXIT.noFilament);
    assert.match(pinned.all, /not the one this command line pinned/);
    assert.doesNotMatch(pinned.all, /No Filament answers/, "something answered: said as another certificate, not as no one there");
    // One connected over plain http to another machine before: its token goes there no more.
    remotes.remotes[0].url = "http://192.168.1.20:20300";
    writeFileSync(join(laptop, REMOTES_FILE), JSON.stringify(remotes));
    const old = await run(laptop, ["status", "--machine", kept.name]);
    assert.equal(old.code, EXIT.failed);
    assert.match(old.all, /is plain http to another machine/);
    // (fails before: yes — disconnect asked with plain fetch, which refuses the machine's own certificate: its sign-out
    // never went, and the device stayed signed in there, the review of p2-lan.) The test's listener is on loopback, where
    // a device's token is that device's: the sign-out went, pinned, and its device there is signed out.
    remotes.remotes[0] = { ...remotes.remotes[0], url: at, fingerprint: lan.fingerprint };
    writeFileSync(join(laptop, REMOTES_FILE), JSON.stringify(remotes));
    const gone = await run(laptop, ["disconnect", kept.name]);
    assert.equal(gone.code, 0, gone.all);
    assert.match(gone.all, /Signed out of .*, and forgot it\./, "the machine answered the sign-out");
    assert.doesNotMatch(gone.all, /certificate|No Filament answers/);
    const devices = (await (await home.api("/api/remote/devices")).json()).devices;
    assert.ok(devices.find((/** @type {any} */ d) => d.id === remotes.remotes[0].device.id)?.revokedAt, "its device there signed out");
  } finally {
    await home.stop();
    rmSync(laptop, { recursive: true, force: true });
  }
});

// (fails before: yes — an https address with no fingerprint was refused whatever its certificate, so tailscale serve's,
// which an authority signed, could not be connected to, the review of p2-lan)
test("connect to an https address whose certificate an authority signed (tailscale serve) needs no fingerprint; one no authority signed sends nothing and says its own", async () => {
  const laptop = mkdtempSync(join(tmpdir(), "filament-cli-ca-"));
  try {
    /** @type {string[]} */
    const asked = [];
    /** @param {boolean} vouched @returns {typeof fetch} */
    const fake = (vouched) =>
      /** @type {any} */ (
        async (/** @type {string} */ url, /** @type {any} */ init) => {
          asked.push(`${init?.method || "GET"} ${new URL(url).pathname}`);
          if (!vouched) throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("self-signed certificate"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" }) });
          if (url.endsWith("/.well-known/filament")) return Response.json({ id: "m-box", name: "Box", version: "0.9.0" });
          return Response.json({ token: "fdt_ca", device: { id: "d1", name: "Laptop", scope: "full" } });
        }
      );
    const certificate = async () => "AB:".repeat(31) + "AB";
    const row = await connectTo(laptop, "https://box.tail1234.ts.net/ui/pair.html#code=ABCD-EFGH", { fetchImpl: fake(true), certificate });
    assert.deepEqual([row.url, row.fingerprint, row.machine.name, row.token], ["https://box.tail1234.ts.net", undefined, "Box", "fdt_ca"], "no pin: checked as any site's");
    assert.deepEqual(asked, ["GET /.well-known/filament", "GET /.well-known/filament", "POST /api/remote/claim"]);
    asked.length = 0;
    await assert.rejects(connectTo(laptop, "https://192.168.1.20:20343/ui/pair.html#code=ABCD-EFGH", { fetchImpl: fake(false), certificate }), (/** @type {any} */ e) => {
      assert.equal(e.exitCode ?? e.code, EXIT.usage);
      assert.match(e.message, /^The certificate at https:\/\/192\.168\.1\.20:20343 has the fingerprint AB:AB:.*Nothing was sent\.$/);
      return true;
    });
    assert.deepEqual(asked, ["GET /.well-known/filament"], "the code never went");
    await assert.rejects(
      connectTo(laptop, "https://box.tail1234.ts.net/ui/pair.html#code=ABCD-EFGH", { fetchImpl: /** @type {any} */ (async () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }))), certificate }),
      /No Filament answers at https:\/\/box\.tail1234\.ts\.net/,
      "no one there is said as that, not as a certificate",
    );
    // (fails before: yes — the remote desk of 11-22, s4c) A Filament on a wire this one does not speak: which side to
    // update, said, and the code never sent.
    asked.length = 0;
    /** @type {typeof fetch} */
    const newer = /** @type {any} */ (
      async (/** @type {string} */ url, /** @type {any} */ init) => {
        asked.push(`${init?.method || "GET"} ${new URL(url).pathname}`);
        return Response.json({ id: "m-box", name: "Box", version: "9.0.0", protocol: 9, protocolLowest: 9 });
      }
    );
    await assert.rejects(connectTo(laptop, "https://box.tail1234.ts.net/ui/pair.html#code=ABCD-EFGH", { fetchImpl: newer, certificate }), (/** @type {any} */ e) => {
      assert.equal(e.exitCode ?? e.code, EXIT.failed);
      assert.equal(e.message, "Box runs Filament 9.0.0, too new for this Filament: update this Filament. Here: filament update, or the Filament app's Check for updates. Nothing was sent.");
      return true;
    });
    assert.ok(!asked.some((a) => a.startsWith("POST")), "the code never went");
    // (fails before: yes — the review of s4c) Box kept, then on a wire this one does not speak: --machine says which side
    // to update, and disconnect still signs out there — its token stops — before it is forgotten here.
    asked.length = 0;
    /** @type {typeof fetch} */
    const moved = /** @type {any} */ (
      async (/** @type {string} */ url, /** @type {any} */ init) => {
        asked.push(`${init?.method || "GET"} ${new URL(url).pathname}`);
        return Response.json(url.endsWith("/.well-known/filament") ? { id: "m-box", name: "Box", version: "9.0.0", protocol: 9, protocolLowest: 9 } : { ok: true });
      }
    );
    await assert.rejects(connectRemote(laptop, "Box", { fetchImpl: moved }), /Box runs Filament 9\.0\.0, too new for this Filament: update this Filament\./);
    assert.deepEqual(asked, ["GET /.well-known/filament"], "its token never went");
    asked.length = 0;
    const gone = await disconnect(laptop, "Box", { fetchImpl: moved });
    assert.deepEqual([gone.signedOut, gone.why], [true, null]);
    assert.deepEqual(asked, ["GET /.well-known/filament", "GET /api/state", "POST /api/remote/sign-out"]);
    assert.deepEqual(readRemotes(laptop), [], "forgotten here");
  } finally {
    rmSync(laptop, { recursive: true, force: true });
  }
});

// (fails before: yes — the review of p3-watch: a fetch ended before its handshake kept its connection open until the
// system's own timeout, the tray's look at a machine that does not answer one more every ten seconds)
test("pinnedFetch: ended before its handshake, its connection goes with it", async () => {
  const net = await import("node:net");
  const { pinnedFetch } = await import("../src/cli/pinned.js");
  let closed = false;
  /** @type {import("node:net").Socket[]} */
  const held = [];
  // A port that takes the connection and never says a word of TLS.
  const server = net.createServer((c) => {
    held.push(c);
    // Read, so its end is heard.
    c.resume();
    c.on("error", () => {});
    c.on("close", () => (closed = true));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
  try {
    const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
    const ended = pinnedFetch(`${"AB:".repeat(31)}CD`)(`https://127.0.0.1:${port}/api/runs`, { signal: AbortSignal.timeout(150) }).then(() => "answered", (e) => e?.name);
    assert.equal(await Promise.race([ended, new Promise((r) => setTimeout(() => r("still waiting"), 2000))]), "TimeoutError", "the fetch ends as it is ended");
    for (let i = 0; i < 50 && !closed; i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(closed, "its connection closed with it");
  } finally {
    for (const c of held) c.destroy();
    server.close();
  }
});

// (fails before: yes — cp-place: a fetch handed a signal ended already was refused, but its request was made first, its
// connection open with nothing to hear its end: the machine's stop then threw "socket hang up" out of the process)
test("pinnedFetch: ended already, no connection is made", async () => {
  const net = await import("node:net");
  const { pinnedFetch } = await import("../src/services/machines/pinned.js");
  let connected = 0;
  const server = net.createServer((c) => {
    connected += 1;
    c.on("error", () => {});
    c.destroy();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
  try {
    const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
    const stop = new AbortController();
    stop.abort(new Error("stopped"));
    await assert.rejects(pinnedFetch(`${"AB:".repeat(31)}CD`)(`https://127.0.0.1:${port}/api/transfers/place`, { method: "POST", body: "{}", signal: stop.signal }), /stopped/);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(connected, 0, "nothing reached the machine");
  } finally {
    server.close();
  }
});

// (fails before: yes — s4f: a device that lapsed unused there was said revoked or signed out)
test("a machine that takes this command line's device no more because it went unused says so: connect again, nothing was revoked", async () => {
  const { keepRemote } = await import("../src/services/machines/remotes.js");
  const dataDir = mkdtempSync(join(tmpdir(), "cli-lapsed-"));
  const id = "1a8abe5b-0000-4000-8000-000000000002";
  try {
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ server: { encryptSecrets: false } }));
    keepRemote(dataDir, { url: "https://192.0.2.7:20343", machine: { id, name: "Studio" }, device: { id: "dev-cli", name: "Laptop", scope: "full" }, token: "fdt_old" });
    /** @param {number} status @param {any} body */
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    /** @param {any} refusal @returns {typeof fetch} */
    const studio = (refusal) =>
      /** @type {any} */ (async (/** @type {string} */ url) => (new URL(url).pathname === "/.well-known/filament" ? json(200, { id, name: "Studio", version: "0.9.90" }) : json(403, refusal)));
    await assert.rejects(
      connectRemote(dataDir, "Studio", { fetchImpl: studio({ error: "this device went unused here for 30 days…", lapsed: true, days: 30, pair: "/ui/pair.html" }) }),
      (/** @type {any} */ e) => e.message === "Studio takes this device no more: it went unused there for 30 days, so its pairing ran out. Connect again with the link its Settings › Remote access shows (filament connect <link>)." && e.code === EXIT.failed,
    );
    await assert.rejects(connectRemote(dataDir, "Studio", { fetchImpl: studio({ error: "admin API answers…", pair: "/ui/pair.html" }) }), /Studio no longer knows this device — revoked there, or signed out/);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

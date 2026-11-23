// @ts-check
// Adding a machine to the rail (desktop/lib/add-machine.js; the owner's remote Filament of 11-06, Part 3): the address
// read, plain http to another machine refused, the network listener's certificate said for the person to compare before
// anything is sent, then pinned; who answers there; the claim a page of that machine makes, and its answer read.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { addressOf, checkMachine, claimOutcome, claimScript, deviceNameHere, pairOverSsh, CLAIM_FROM, PAIR_MS, PAIR_SCRIPT } from "../desktop/lib/add-machine.js";
import { lanIdentity } from "../src/services/lan-tls.js";

const made = /** @type {string[]} */ ([]);
after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));
const PRINT = Array.from({ length: 32 }, () => "AB").join(":");

/** The network listener of a Filament: its certificate, who it says it is, and every request it heard. */
async function listener(who = { id: "M-Box", name: "Workstation", version: "0.9.0" }) {
  const dir = mkdtempSync(join(tmpdir(), "filament-add-tls-"));
  made.push(dir);
  const id = lanIdentity(dir, { name: "Workstation" });
  /** @type {string[]} */
  const heard = [];
  const server = https.createServer({ key: id.key, cert: id.cert }, (req, res) => {
    heard.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(who));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
  const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
  return { url: `https://127.0.0.1:${port}`, port, print: id.fingerprint, heard, close: () => server.close() };
}

describe("the address", () => {
  test("typed with no scheme: https for another machine — the network listener's —, plain http for this one", () => {
    assert.equal(addressOf("192.168.1.20:20343"), "https://192.168.1.20:20343");
    assert.equal(addressOf("  box.local:20343 "), "https://box.local:20343");
    assert.equal(addressOf("localhost:20310"), "http://localhost:20310", "an SSH tunnel's");
    assert.equal(addressOf("127.0.0.1:20310"), "http://127.0.0.1:20310");
    assert.equal(addressOf("https://box.tail1234.ts.net"), "https://box.tail1234.ts.net", "a scheme stands");
    assert.equal(addressOf(""), "");
  });

  // (fails before: yes — a name that starts 127. was taken for this machine)
  test("this machine is a loopback address or localhost: a name that merely starts 127. is another machine's, its plain http refused", async () => {
    assert.equal(addressOf("127.0.0.1.evil.example:20310"), "https://127.0.0.1.evil.example:20310");
    assert.equal(addressOf("127.attacker.example:20310"), "https://127.attacker.example:20310");
    assert.equal(addressOf("127.0.0.2:20310"), "http://127.0.0.2:20310", "127.0.0.0/8 is this machine");
    /** @type {string[]} */
    const asked = [];
    const fetchImpl = /** @type {any} */ (async (/** @type {string} */ u) => (asked.push(u), new Response("{}")));
    const plain = await checkMachine({ link: "http://127.attacker.example:20310#code=ABCD-EFGH" }, { fetchImpl });
    assert.match(/** @type {any} */ (plain).words, /plain http to another machine/);
    assert.deepEqual(asked, [], "the code goes nowhere");
  });

  // (fails before: yes — the review of s4c: a Filament on a wire this app does not speak was said, through an SSH tunnel,
  // as none answering there, and otherwise in the command line's words)
  test("a Filament on a wire this app does not speak: which side to update, in the app's words, by its address or through an SSH tunnel; nothing claimed", async () => {
    /** @type {string[]} */
    const asked = [];
    const fetchImpl = /** @type {any} */ (async (/** @type {string} */ u, /** @type {any} */ init) => (asked.push(`${init?.method || "GET"} ${new URL(u).pathname}`), Response.json({ id: "m-box", name: "Box", version: "9.0.0", protocol: 9, protocolLowest: 9 })));
    const words = "Box runs Filament 9.0.0, too new for this app: update this app. Update this app in Settings › About (Check now), then add it again.";
    assert.deepEqual(await checkMachine({ link: "http://localhost:20310#code=ABCD-EFGH" }, { fetchImpl }), { ok: false, words });
    const ssh = { routeFor: async (/** @type {string} */ alias, /** @type {number} */ port) => ({ kind: "ssh", url: "http://127.0.0.1:5555", alias, port }), hold: async () => null };
    assert.deepEqual(await checkMachine({ link: "ssh://box" }, { fetchImpl, ssh: /** @type {any} */ (ssh) }), { ok: false, words });
    assert.deepEqual(asked, ["GET /.well-known/filament", "GET /.well-known/filament"], "who it is, asked; nothing more");
  });

  // (fails before: yes — the rail had no way to add a machine)
  test("plain http to another machine is refused before anything is asked of it; nonsense is said as such", async () => {
    /** @type {string[]} */
    const asked = [];
    const fetchImpl = /** @type {any} */ (async (/** @type {string} */ u) => (asked.push(u), new Response("{}")));
    const plain = await checkMachine({ link: "http://192.168.1.20:20300#code=ABCD-EFGH" }, { fetchImpl });
    assert.equal(plain.ok, false);
    assert.match(/** @type {any} */ (plain).words, /plain http to another machine, where anyone on the network reads what is sent/);
    const junk = await checkMachine({ link: "ftp://box" }, { fetchImpl });
    assert.equal(junk.ok, false);
    assert.match(/** @type {any} */ (junk).words, /not a Filament's address/);
    assert.deepEqual(asked, []);
  });
});

describe("who answers, over which certificate", () => {
  test("the network listener's certificate, which nothing vouches for: its fingerprint said to compare, nothing sent; said the same, pinned", async () => {
    const box = await listener();
    try {
      const first = await checkMachine({ link: box.url, code: "ABCD-EFGH" });
      assert.equal(first.ok, false);
      assert.equal(/** @type {any} */ (first).ask, "fingerprint");
      assert.equal(/** @type {any} */ (first).seen, box.print);
      assert.equal(/** @type {any} */ (first).url, box.url);
      assert.deepEqual(box.heard, [], "no request reached it: the certificate was read alone");
      const second = await checkMachine({ link: box.url, code: "ABCD-EFGH", fingerprint: box.print });
      assert.deepEqual(second, { ok: true, url: box.url, code: "ABCD-EFGH", fingerprint: box.print, route: { kind: "lan", url: box.url, fingerprint: box.print }, machine: { id: "M-Box", name: "Workstation", version: "0.9.0" } });
      assert.deepEqual(box.heard, ["GET /.well-known/filament"], "asked who it is — nothing more");
    } finally {
      box.close();
    }
  });

  test("a link carries the code and the fingerprint: pinned at once; another certificate there ends it before a byte is sent", async () => {
    const box = await listener();
    try {
      const hex = box.print.replace(/:/g, "").toLowerCase();
      const got = await checkMachine({ link: `${box.url}/ui/pair.html#code=WXYZ-2345&fp=${hex}` });
      assert.equal(got.ok, true);
      assert.equal(/** @type {any} */ (got).code, "WXYZ-2345");
      assert.deepEqual(/** @type {any} */ (got).route, { kind: "lan", url: box.url, fingerprint: box.print });
      const typed = await checkMachine({ link: `${box.url}#code=WXYZ-2345&fp=${hex}`, code: "TYPE-D000" });
      assert.equal(/** @type {any} */ (typed).code, "TYPE-D000", "the code typed wins");
      box.heard.length = 0;
      const wrong = await checkMachine({ link: `${box.url}#code=WXYZ-2345`, fingerprint: PRINT });
      assert.equal(wrong.ok, false);
      assert.match(/** @type {any} */ (wrong).words, /another certificate/i);
      assert.deepEqual(box.heard, [], "nothing reached it");
    } finally {
      box.close();
    }
  });

  test("a certificate an authority signed (tailscale serve's) needs no pin; nothing answering, or no Filament, is said", async () => {
    const answers = /** @type {Record<string, any>} */ ({ "https://box.tail1234.ts.net/.well-known/filament": { id: "m-box", name: "Workstation" } });
    const fetchImpl = /** @type {any} */ (async (/** @type {string} */ u) => {
      if (!(u in answers)) throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
      return new Response(JSON.stringify(answers[u]), { status: 200 });
    });
    const tailnet = await checkMachine({ link: "https://box.tail1234.ts.net", code: "ABCD-EFGH" }, { fetchImpl });
    assert.deepEqual(tailnet, { ok: true, url: "https://box.tail1234.ts.net", code: "ABCD-EFGH", fingerprint: "", route: { kind: "url", url: "https://box.tail1234.ts.net" }, machine: { id: "m-box", name: "Workstation", version: "" } });
    const none = await checkMachine({ link: "https://gone.tail1234.ts.net" }, { fetchImpl });
    assert.match(/** @type {any} */ (none).words, /^No Filament answers at https:\/\/gone\.tail1234\.ts\.net/);
    answers["http://localhost:20310/.well-known/filament"] = { hello: "world" };
    const other = await checkMachine({ link: "localhost:20310" }, { fetchImpl });
    assert.match(/** @type {any} */ (other).words, /is no Filament/);
  });
});

describe("the claim", () => {
  test("made by a page of the machine: its own fetch home, JSON, same-origin — the code and name never break out of the script", async () => {
    /** @type {any[]} */
    const calls = [];
    const box = {
      fetch: async (/** @type {string} */ u, /** @type {any} */ init) => {
        calls.push([u, init]);
        return { status: 200, json: async () => ({ device: { id: "d1" }, machine: { id: "m-box", name: "Workstation" } }) };
      },
    };
    const code = `AB"+alert(1)+"CD`;
    const got = await vm.runInNewContext(claimScript(code, "Filament app on BOX"), box);
    assert.deepEqual(JSON.parse(JSON.stringify(got)), { status: 200, body: { device: { id: "d1" }, machine: { id: "m-box", name: "Workstation" } } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "/api/remote/claim");
    assert.equal(calls[0][1].method, "POST");
    assert.equal(calls[0][1].credentials, "same-origin");
    assert.deepEqual(JSON.parse(JSON.parse(JSON.stringify(calls[0][1])).body), { code, name: "Filament app on BOX" });
    assert.equal(CLAIM_FROM, "/.well-known/filament", "a page of its own address with no script of its own");
  });

  // (fails before: yes — the claim said no machine, so that machine's Settings showed this window's device apart from
  // this window's machine)
  test("it names this computer's own Filament by its id, where the window knows it", async () => {
    const ME = "1a8abe5b-793a-444b-81d9-f37af35b242e";
    for (const [machine, want] of /** @type {const} */ ([[ME, { code: "ABCD-EFGH", name: "Filament app on BOX", machine: ME }], [null, { code: "ABCD-EFGH", name: "Filament app on BOX" }]])) {
      /** @type {any[]} */
      const bodies = [];
      const box = { fetch: async (/** @type {string} */ _u, /** @type {any} */ init) => (bodies.push(JSON.parse(init.body)), { status: 200, json: async () => ({}) }) };
      await vm.runInNewContext(claimScript("ABCD-EFGH", "Filament app on BOX", { machine }), box);
      assert.deepEqual(JSON.parse(JSON.stringify(bodies)), [want]);
    }
  });

  // (fails before: yes — pairing again left the old device signed in there)
  test("a machine paired again: this window's old device signed out there first; a sign-out refused still claims", async () => {
    for (const refuse of [false, true]) {
      /** @type {any[]} */
      const calls = [];
      const box = {
        fetch: async (/** @type {string} */ u, /** @type {any} */ init) => {
          // A write with an Origin and no JSON type is refused there (admin/index.js answers 415): each says it is JSON.
          calls.push([u, init?.method, init?.credentials, init?.headers?.["content-type"], typeof init?.body]);
          if (u === "/api/remote/sign-out" && refuse) throw new TypeError("Failed to fetch");
          return { status: 200, json: async () => ({ machine: { id: "m-box" } }) };
        },
      };
      const got = await vm.runInNewContext(claimScript("ABCD-EFGH", "Filament app on BOX", { again: true }), box);
      assert.equal(got.status, 200);
      assert.deepEqual(calls, [
        ["/api/remote/sign-out", "POST", "same-origin", "application/json", "string"],
        ["/api/remote/claim", "POST", "same-origin", "application/json", "string"],
      ]);
    }
  });

  test("its answer: paired with the machine that said who it was; another machine's, a wrong code, too many, no answer — each said", () => {
    const box = { id: "m-box", name: "Workstation" };
    assert.deepEqual(claimOutcome({ status: 200, body: { machine: { id: "M-BOX" } } }, box), { ok: true });
    assert.match(/** @type {any} */ (claimOutcome({ status: 200, body: { machine: { id: "m-other" } } }, box)).words, /Another machine answered the claim \(m-other\), not Workstation/);
    assert.match(/** @type {any} */ (claimOutcome({ status: 403, body: { error: "wrong" } }, box)).words, /That code is wrong or has run out\. Make a new one on Workstation/);
    assert.match(/** @type {any} */ (claimOutcome({ status: 429, body: { retryAt: Date.now() + 90_000 } }, box)).words, /Too many wrong codes: try again in 2 min/);
    assert.match(/** @type {any} */ (claimOutcome(null, box)).words, /Workstation did not answer the claim/);
    assert.equal(deviceNameHere("BOX"), "Filament app on BOX");
  });

  // (fails before: yes — s0b: a machine added by ssh:// got no code: kept with no device there)
  test("through SSH: filament pair made there by ssh's own sign-in, its code taken for that machine alone; why not, in words", async () => {
    /** @type {any[]} */
    const ran = [];
    /** @param {any} answer */
    const over = (answer) => /** @type {any} */ (async (/** @type {string} */ alias, /** @type {any} */ what, /** @type {any} */ o) => (ran.push([alias, what, o]), { code: 0, stdout: "", stderr: "", cut: false, why: null, ask: null, ...answer }));
    const box = { id: "m-box", name: "Workstation" };
    const paired = JSON.stringify({ code: "WXYZ-2345", scope: "full", machine: { id: "M-BOX", name: "Workstation" } });
    assert.deepEqual(await pairOverSsh("box", box, { ssh: over({ stdout: paired }) }), { code: "WXYZ-2345" });
    assert.deepEqual(ran[0], ["box", { script: PAIR_SCRIPT }, { timeoutMs: PAIR_MS }]);
    // (fails before: yes — the review of s0b: a shell's start-up words before the JSON were read as no code)
    const pretty = JSON.stringify(JSON.parse(paired), null, 2);
    assert.deepEqual(await pairOverSsh("box", box, { ssh: over({ stdout: `Welcome to Ubuntu 24.04\n{ not json\n${pretty}\n` }) }), { code: "WXYZ-2345" });
    assert.match(PAIR_SCRIPT, /\$HOME\/\.local\/bin\/filament.* pair --json$/, "install.sh's Filament first, else the PATH's: a full device, as JSON");
    const other = JSON.stringify({ code: "WXYZ-2345", machine: { id: "m-other", name: "Studio" } });
    assert.equal(/** @type {any} */ (await pairOverSsh("box", box, { ssh: over({ stdout: other }) })).words, "filament pair on box made its code for another Filament there (Studio), not Workstation: nothing was claimed.");
    const press = { code: 1, stderr: "filament pair: the Filament app runs here, and makes the code while it runs: in it, Settings › Remote access › Pair with a code › Make a code (HTTP 403)\n" };
    assert.equal(/** @type {any} */ (await pairOverSsh("box", box, { ssh: over(press) })).words, "the Filament app runs here, and makes the code while it runs: in it, Settings › Remote access › Pair with a code › Make a code (HTTP 403)");
    assert.equal(/** @type {any} */ (await pairOverSsh("box", box, { ssh: over({ code: null, ask: "host-key", why: "ssh does not know box's host key yet" }) })).words, "ssh box asks for its host key to be trusted: run ssh box in a terminal once, then add it again.");
    assert.equal(/** @type {any} */ (await pairOverSsh("box", box, { ssh: over({ code: null, ask: "sign-in" }) })).words, "ssh box asks for a password or a code: run ssh box in a terminal once, then add it again.");
    assert.equal(/** @type {any} */ (await pairOverSsh("box", box, { ssh: over({ code: 255, why: "ssh to box ended: Connection refused" }) })).words, "ssh to box ended: Connection refused");
    assert.equal(/** @type {any} */ (await pairOverSsh("box", box, { ssh: over({ code: 127 }) })).words, "filament pair on box ended with code 127.");
  });
});

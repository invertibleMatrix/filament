// @ts-check
// Settings › Remote access and the pairing page (the owner's remote Filament of 11-06, Part 1): this machine's name; a
// pairing started here — a code, counted down, a link for each address another machine reaches it at, the tailnet's
// first, each with its QR code for a phone, Full or View-only — closed by the device that claims it or by its time; the devices paired, with when each was last seen,
// Revoke and Forget; read from another machine, pairing is this machine's and the device it is signs itself out. The
// pairing page's words and link; and the harness, opened by a browser no one paired, sends it to the pairing page.
// DOM-free: the fake `h`, a scripted `api`, a clock and a timer the test turns.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { renderRemote, leftWords, deviceWords, expiryWords, NEW_KEY_WORDS, linksOf, RAN_OUT_UNREAD_WORDS, SEARCH_ROWS, onTailnet, qrSvg, QR_MODULE, QR_TAILNET_WORDS, QR_LAN_WORDS } from "../src/ui/harness/settings/remote.js";
import { qrcode } from "../src/ui/harness/vendor/qr/qrcode.mjs";
import { pairLinks } from "../src/http/admin/remote.js";
import { SECTIONS, PAGE_ROWS } from "../src/ui/harness/settings/page.js";
import { codeOf, deviceName, claimWords, clearWords, goesTo, inTheClear, mountPair, NO_NAME_WORDS, pageMove, pageNameOf, printOf, printWords } from "../src/ui/pair.js";
import { startApp } from "./helpers/app.js";

const T0 = Date.parse("2026-11-06T12:00:00Z");
/** A pairing's link as the network's listener makes it: https, the code and the certificate's fingerprint. */
const LINK = `https://192.168.1.20:20343/ui/pair.html#code=ABCD-EFGH&fp=${"AB".repeat(32)}`;
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

/** Every node under `el` carrying a class. @param {any} el @param {string} cls @returns {any[]} */
const all = (el, cls) => {
  /** @type {any[]} */
  const out = [];
  /** @param {any} n */
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (String(n.attrs?.class || "").split(/\s+/).includes(cls)) out.push(n);
    for (const k of n.kids || []) walk(k);
  };
  walk(el);
  return out;
};
/** Every node under `el` carrying one of the classes, in the page's order. @param {any} el @param {string[]} classes @returns {any[]} */
const anyOf = (el, classes) => {
  /** @type {any[]} */
  const out = [];
  /** @param {any} n */
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (String(n.attrs?.class || "").split(/\s+/).some((c) => classes.includes(c))) out.push(n);
    for (const k of n.kids || []) walk(k);
  };
  walk(el);
  return out;
};
/** The rows' labels and the listed devices' names, in the page's order. */
const labels = (/** @type {any} */ el) => anyOf(el, ["settings-row-label", "rset-name"]).map((n) => textOf(n));
/** A row by its label, or a listed device by its name. @param {any} el @param {string} label */
const rowOf = (el, label) => {
  const r = anyOf(el, ["settings-row", "rset-item"]).find((n) => textOf(anyOf(n, ["settings-row-label", "rset-name"])[0]) === label);
  assert.ok(r, `a row "${label}" in: ${labels(el).join(", ")}`);
  return r;
};
/** A button by its name or words. @param {any} el @param {string} name */
const button = (el, name) => {
  const b = buttonsOf(el).find((x) => x.attrs["aria-label"] === name || textOf(x) === name);
  assert.ok(b, `a button "${name}" in: ${buttonsOf(el).map((x) => x.attrs["aria-label"] || textOf(x)).join(", ")}`);
  return b;
};

/**
 * The page over scripted routes: a Filament that pairs, lists and revokes devices as the server does — its open codes
 * each with an id, said to this computer alone, on a clock of its own `skew` ms from the page's.
 * `lan`: the network's listener, as GET /remote/lan says it for server.lan as kept (`state`), and what Allow on Windows
 * Firewall answers (`allow`); none: a schema without it.
 * `devicesFail`: whether the list's read fails now, as a restart or a dropped connection fails it. `devicesHold`: a
 * promise the list's answer, made as it is asked, waits for before it lands (none: at once); `pairHold`, a code's.
 * @param {{ state?: Record<string, any>, devices?: any[], devicesRefused?: boolean, devicesFail?: () => boolean, devicesHold?: () => Promise<unknown> | null, pairHold?: () => Promise<unknown> | null, links?: string[], confirm?: boolean, skew?: number, codes?: { id: string, scope: string, leftMs: number }[],
 *   lan?: { enabled?: boolean, state: (cfg: { enabled: boolean, port: number }, fresh: boolean) => any, allow?: () => any, newKey?: () => any },
 *   tailnet?: { serve?: boolean, trustOwnLogin?: boolean, state: (cfg: { serve: boolean, trustOwnLogin: boolean, port: number }, fresh: boolean) => any, retry?: (cfg: any) => any }, app?: any, qr?: () => Promise<any>,
 *   sshSetup?: (o: any) => unknown }} [o]
 *   `app`: the desktop app's bridge, where the page runs in it. `qr`: the QR encoder's load (none: the vendored one, at once).
 *   `sshSetup`: the setup sheet's opening, recorded
 */
async function open(o = {}) {
  /** server.lan as kept. */
  const lan = { enabled: o.lan?.enabled ?? false, port: 20343 };
  /** server.tailscale as kept. */
  const tailscale = { serve: o.tailnet?.serve ?? false, trustOwnLogin: o.tailnet?.trustOwnLogin ?? false, port: 20345 };
  let t = T0;
  /** The server's clock. */
  const st = () => t + (o.skew || 0);
  /** @type {any[]} */
  let devices = structuredClone(o.devices || []);
  /** @type {{ id: string, code: string, scope: string, expiresAt: number }[]} */
  let codes = (o.codes || []).map((c) => ({ id: c.id, code: `OPEN-${c.id}`, scope: c.scope, expiresAt: st() + c.leftMs }));
  let made = 0;
  const local = (o.state?.viewer ?? "local") === "local";
  const sweep = () => void (codes = codes.filter((c) => c.expiresAt > st()));
  /** A device claims an open code — the newest, or the one named — as the server adds it. @param {string} name @param {string} [id] */
  const claimCode = (name, id) => {
    const c = id ? codes.find((x) => x.id === id) : codes[codes.length - 1];
    assert.ok(c, "a code open to claim");
    codes = codes.filter((x) => x !== c);
    devices.push({ id: `d-${name}`, name, scope: c.scope, kind: "browser", createdAt: st(), lastSeenAt: null, lastSeenFrom: null, revokedAt: null, pairing: c.id });
  };
  /** @type {[string, string, any][]} */
  const calls = [];
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  /** @type {string[]} */
  const copied = [];
  /** @type {string[]} */
  const went = [];
  /** @type {(() => void)[]} */
  const timers = [];
  const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
    const method = init.method || "GET";
    calls.push([method, path, init.body]);
    if (path === "/schema")
      return {
        config: {
          ...(o.lan || o.tailnet
            ? {
                server: {
                  ...(o.lan ? { lan: { enabled: { type: "boolean", default: false, description: "Listen on this machine's network addresses, over https." }, port: { type: "number", default: 20343, description: "Port for the network listener." } } } : {}),
                  ...(o.tailnet ? { tailscale: { serve: { type: "boolean", default: false, description: "Serve this Filament on your tailnet with tailscale serve." }, trustOwnLogin: { type: "boolean", default: false, description: "Let in a machine signed in to Tailscale as you, without pairing." }, port: { type: "number", default: 20345, description: "Port of the tailnet's door, on loopback." } } } : {}),
                },
              }
            : {}),
        },
      };
    if (path === "/state") return { version: "9.9.9", machine: { id: "m-1", name: "Workstation" }, viewer: "local", device: null, config: o.lan || o.tailnet ? { server: { ...(o.lan ? { lan: { ...lan } } : {}), ...(o.tailnet ? { tailscale: { ...tailscale } } : {}) } } : {}, ...(o.state || {}) };
    if (path === "/config/fields" && method === "PATCH") {
      for (const [k, v] of Object.entries(init.body.set || {}))
        if (k.startsWith("server.tailscale.")) /** @type {any} */ (tailscale)[k.slice("server.tailscale.".length)] = v;
        else /** @type {any} */ (lan)[k.replace(/^server\.lan\./, "")] = v;
      return { changes: Object.keys(init.body.set || {}), values: init.body.set };
    }
    if (o.lan && (path === "/remote/lan" || path === "/remote/lan?fresh=1")) return o.lan.state({ ...lan }, path.endsWith("fresh=1"));
    if (o.tailnet && (path === "/remote/tailscale" || path === "/remote/tailscale?fresh=1")) return o.tailnet.state({ ...tailscale }, path.endsWith("fresh=1"));
    if (o.tailnet?.retry && path === "/remote/tailscale/retry" && method === "POST") return o.tailnet.retry({ ...tailscale });
    if (o.lan?.allow && path === "/remote/lan/firewall" && method === "POST") return o.lan.allow();
    if (o.lan?.newKey && path === "/remote/lan/new-key" && method === "POST") return o.lan.newKey();
    if (path === "/remote/devices") {
      if (o.devicesRefused) throw Object.assign(new Error("refused"), { status: 403, body: { error: "a view-only device manages no devices" } });
      if (o.devicesFail?.()) {
        const held = o.devicesHold?.();
        if (held) await held;
        throw Object.assign(new Error("Filament is restarting"), { status: 503, body: { error: "Filament is restarting" } });
      }
      sweep();
      const answer = structuredClone({ devices, ...(local ? { pending: codes.map((c) => ({ id: c.id, scope: c.scope, expiresAt: c.expiresAt, leftMs: c.expiresAt - st() })) } : {}) });
      const held = o.devicesHold?.();
      if (held) await held;
      return answer;
    }
    if (path === "/remote/pair" && method === "POST") {
      const held = o.pairHold?.();
      if (held) await held;
      const links = o.links ?? [LINK];
      const c = { id: `c${++made}`, code: made === 1 ? "ABCD-EFGH" : `WXYZ-000${made}`, scope: init.body.scope, expiresAt: st() + 300_000 };
      // The server keeps five codes open: a sixth lets the oldest go (services/devices.js OPEN_CODES).
      codes = [...codes, c].slice(-5);
      return { ...c, leftMs: 300_000, machine: { id: "m-1", name: "Workstation" }, addresses: links.map((l) => l.split("/ui/")[0]), links };
    }
    const cancel = /^\/remote\/pair(?:\?id=(.+))?$/.exec(path);
    if (cancel && method === "DELETE") {
      const before = codes.length;
      codes = cancel[1] ? codes.filter((c) => c.id !== decodeURIComponent(cancel[1])) : [];
      return { ok: true, closed: codes.length < before };
    }
    const one = /^\/remote\/devices\/([^?]+)(\?forget=1)?$/.exec(path);
    if (one && method === "DELETE") {
      const id = decodeURIComponent(one[1]);
      if (one[2]) devices = devices.filter((d) => d.id !== id);
      else devices = devices.map((d) => (d.id === id ? { ...d, revokedAt: t } : d));
      return { ok: true };
    }
    if (path === "/remote/sign-out") return { ok: true };
    throw Object.assign(new Error(`no route ${method} ${path}`), { status: 404, body: { error: `no route ${path}` } });
  };
  const body = /** @type {any} */ (fakeH("div", {}));
  const io = {
    h: fakeH,
    api,
    copy: async (/** @type {string} */ s) => void copied.push(s),
    confirm: async () => o.confirm ?? true,
    now: () => t,
    every: (/** @type {() => void} */ fn) => {
      timers.push(fn);
      return () => {
        const i = timers.indexOf(fn);
        if (i >= 0) timers.splice(i, 1);
      };
    },
    go: (/** @type {string} */ p) => void went.push(p),
    app: o.app ?? null,
    qr: o.qr ?? (async () => qrcode),
    ...(o.sshSetup ? { sshSetup: o.sshSetup } : {}),
  };
  renderRemote(body, { onToast: (/** @type {string} */ msg, /** @type {string | undefined} */ kind) => void toasts.push([msg, kind]) }, io);
  await settle();
  return {
    body,
    calls,
    toasts,
    copied,
    went,
    /** Time goes on by `ms`, a second's tick at a time. @param {number} ms */
    async pass(ms) {
      for (let i = 0; i < ms / 1000; i++) {
        t += 1000;
        for (const fn of [...timers]) fn();
        await settle();
      }
    },
    /** A device claims a code, as the server would add it: the newest, or the one named. */
    claim: claimCode,
    /** A code made elsewhere — another window, `filament pair` — open on the server; its id. */
    openElsewhere: () => {
      const c = { id: `c${++made}`, code: `ELSE-000${made}`, scope: "full", expiresAt: st() + 300_000 };
      codes.push(c);
      return c.id;
    },
    /** The codes the server holds open now. */
    openIds: () => (sweep(), codes.map((c) => c.id)),
    timers,
  };
}

test("Remote access sits under Filament after Connect other apps; its search rows are the rows it draws", () => {
  const ids = SECTIONS.map((s) => s.id);
  assert.equal(ids.indexOf("remote"), ids.indexOf("connect") + 1);
  assert.deepEqual(SECTIONS.find((s) => s.id === "remote"), { id: "remote", group: "Filament", label: "Remote access", icon: "globe" });
  assert.equal(PAGE_ROWS.remote, SEARCH_ROWS);
});

// (fails before: yes — the page said nothing of this computer's calls without the owner key: /state had no `ownerless`)
test("this computer's read says the calls that came without the owner key, and from which programs; a read without it says nothing", async () => {
  const p = await open({ state: { ownerless: { count: 3, refused: true, programs: [{ agent: "curl/8.4.0", count: 2, lastAt: T0 }, { agent: "python-requests/2.32", count: 1, lastAt: T0 }] } } });
  assert.deepEqual(labels(p.body).slice(0, 3), ["This machine", "Programs on this computer", "Calls without the owner key"]);
  const row = textOf(rowOf(p.body, "Calls without the owner key"));
  assert.match(row, /3 calls since Filament started came from a program here without its owner key, refused: curl\/8\.4\.0 \(2\), python-requests\/2\.32 \(1\)/);
  assert.match(row, /owner\.key/);
  assert.match(row, /a browser pairs with filament open/);
  const legacy = await open({ state: { ownerless: { count: 1, refused: false, programs: [{ agent: "curl/8.4.0", count: 1, lastAt: T0 }] } } });
  assert.match(textOf(rowOf(legacy.body, "Calls without the owner key")), /without its owner key, answered all the same: curl/);
  const none = await open({ state: { ownerless: { count: 0, programs: [] } } });
  assert.match(textOf(rowOf(none.body, "Calls without the owner key")), /Every program on this computer that called Filament since it started sent its owner key or a pairing/);
  const elsewhere = await open({ state: { viewer: "remote" } });
  assert.ok(!labels(elsewhere.body).includes("Calls without the owner key"), "another machine's read carries none");
  assert.ok(!labels(elsewhere.body).includes("Programs on this computer"), "nor what a program here needs");
});

// (fails before: yes — s0c: nothing said, or set, what a program on this computer needs)
test("Programs on this computer: Owner key by default, said in words; Any program sets server.loopbackTrust legacy, said as every account's", async () => {
  const p = await open({ state: { ownerless: { count: 0, programs: [] } } });
  const trust = rowOf(p.body, "Programs on this computer");
  assert.match(textOf(trust), /any other program here is refused/);
  assert.equal(button(trust, "Owner key").attrs["aria-selected"], "true", "the schema's own, where the config names none");
  button(trust, "Any program").attrs.onclick();
  await settle();
  assert.deepEqual(p.calls.find(([m, path]) => m === "PATCH" && path === "/config/fields")?.[2]?.set, { "server.loopbackTrust": "legacy" });
  const open2 = await open({ state: { ownerless: { count: 0, programs: [] }, config: { server: { loopbackTrust: "legacy" } } } });
  const said = rowOf(open2.body, "Programs on this computer");
  assert.equal(button(said, "Any program").attrs["aria-selected"], "true");
  assert.match(textOf(said), /every other account on this computer/);
});

// (fails before: yes — Settings had no Remote access: nothing paired another machine)
test("a pairing here: Full or View-only, its code and links with Copy, counted down; the device that claims it closes it", async () => {
  const p = await open();
  assert.deepEqual(labels(p.body), ["This machine", "New code"]);
  assert.match(textOf(rowOf(p.body, "This machine")), /Workstation/);
  assert.match(textOf(p.body), /No other machine is paired with this one yet\.\|Browsers and command lines\|No browser or command line is paired yet\./);
  button(p.body, "View-only").attrs.onclick();
  await settle();
  assert.equal(button(p.body, "View-only").attrs["aria-selected"], "true", "the scope picked shows");
  button(rowOf(p.body, "New code"), "Make a code").attrs.onclick();
  await settle();
  assert.deepEqual(p.calls.find(([m, path]) => m === "POST" && path === "/remote/pair")?.[2], { scope: "view" });
  assert.deepEqual(labels(p.body), ["This machine", "Code", "Good for", "Links"]);
  assert.match(textOf(rowOf(p.body, "Code")), /ABCD-EFGH/);
  assert.match(textOf(rowOf(p.body, "Code")), /For a view-only device: it reads\. Type it on the other machine's pairing page, or open a link below there\./);
  assert.equal(all(p.body, "rset-left")[0].kids.join(""), "5:00");
  assert.ok(textOf(p.body).includes(`Or in its terminal: filament connect ${LINK}`));
  button(rowOf(p.body, "Links"), "Copy the link").attrs.onclick();
  button(rowOf(p.body, "Code"), "Copy the code").attrs.onclick();
  await settle();
  assert.deepEqual(p.copied, [LINK, "ABCD-EFGH"]);
  await p.pass(3000);
  assert.equal(all(p.body, "rset-left")[0].textContent, "4:57", "counted down each second");
  p.claim("MacBook");
  await p.pass(2000);
  assert.ok(p.toasts.some(([m]) => m === "MacBook is paired"), JSON.stringify(p.toasts));
  assert.deepEqual(labels(p.body), ["This machine", "MacBook", "New code"], "the code closed, the device listed");
  assert.match(textOf(rowOf(p.body, "MacBook")), /Browser · view-only · not seen yet/);
  assert.equal(p.timers.length, 0, "no timer left running");
});

test("a code nobody claims runs out at 0:00; Cancel ends it; with no address another machine reaches, the page says how to share", async () => {
  const p = await open({ links: [] });
  button(rowOf(p.body, "New code"), "Make a code").attrs.onclick();
  await settle();
  assert.deepEqual(labels(p.body), ["This machine", "Code", "Good for"]);
  assert.doesNotMatch(textOf(rowOf(p.body, "Code")), /open a link/, "no link to open");
  assert.match(textOf(p.body), /No other machine reaches Filament on the network yet: turn on Reach this machine on my network or Share on my tailnet above/);
  await p.pass(300_000);
  assert.ok(p.toasts.some(([m]) => /^The code ran out/.test(m)));
  assert.deepEqual(labels(p.body), ["This machine", "New code"]);
  button(rowOf(p.body, "New code"), "Make a code").attrs.onclick();
  await settle();
  button(rowOf(p.body, "Good for"), "Cancel").attrs.onclick();
  await settle();
  assert.ok(p.calls.some(([m, path]) => m === "DELETE" && path === "/remote/pair?id=c2"), "its own code, by its id");
  assert.deepEqual(p.openIds(), []);
  assert.deepEqual(labels(p.body), ["This machine", "New code"], "no code it showed is said as open elsewhere");
  assert.equal(p.timers.length, 0);
});

// (fails before: yes — any device paired since the code was shown closed it, Cancel closed every code, a code left open
// was never said again, and a double press opened two)
test("the page knows its own code: another code's claim leaves it open, Cancel ends it alone, codes left open are said and closed, one press one code", async () => {
  const p = await open();
  button(rowOf(p.body, "New code"), "Make a code").attrs.onclick();
  await settle();
  const a = p.openElsewhere();
  const b = p.openElsewhere();
  await p.pass(2000);
  assert.deepEqual(labels(p.body), ["This machine", "Code", "Good for", "Links", "Codes open"]);
  assert.match(textOf(rowOf(p.body, "Codes open")), /^Codes open\|2 codes made earlier — in another window, by filament pair, or here before the page was opened again — are still open, the newest good for 4:58\./);
  p.claim("Phone", a);
  await p.pass(2000);
  assert.ok(!p.toasts.some(([m]) => /Phone is paired/.test(m)), "another code's claim is not this one's");
  assert.deepEqual(labels(p.body), ["This machine", "Phone", "Code", "Good for", "Links", "Codes open"], "its code stays, the device is listed");
  button(rowOf(p.body, "Good for"), "Cancel").attrs.onclick();
  await settle();
  assert.deepEqual(p.openIds(), [b], "Cancel ends this page's code alone");
  assert.match(textOf(rowOf(p.body, "Codes open")), /^Codes open\|A code made earlier/);
  button(rowOf(p.body, "Codes open"), "Close it").attrs.onclick();
  await settle();
  assert.deepEqual(p.openIds(), []);
  assert.deepEqual(labels(p.body), ["This machine", "Phone", "New code"]);

  const again = await open({ codes: [{ id: "left", scope: "full", leftMs: 120_000 }] });
  assert.match(textOf(rowOf(again.body, "Codes open")), /A code made earlier .* is still open, the newest good for 2:00\./, "a code left open is said on coming back");
  const make = button(rowOf(again.body, "New code"), "Make a code");
  make.attrs.onclick();
  make.attrs.onclick();
  await settle();
  assert.equal(again.calls.filter(([m, path]) => m === "POST" && path === "/remote/pair").length, 1, "one press, one code");
  const remote = await open({ state: { viewer: "remote", device: { id: "d9", name: "Laptop", scope: "full" } }, codes: [{ id: "x", scope: "full", leftMs: 60_000 }] });
  assert.ok(!labels(remote.body).includes("Codes open"), "another machine is told of no code");
});

// (fails before: yes — the page counted the server's expiresAt on its own clock: ten minutes behind, the code ran out at
// once; ten ahead, it counted from 15:00 and never saw its claim)
test("the countdown and the claim follow the server's own time, whatever the page's clock says", async () => {
  for (const skew of [-10 * 60_000, 10 * 60_000]) {
    const p = await open({ skew });
    button(rowOf(p.body, "New code"), "Make a code").attrs.onclick();
    await settle();
    assert.equal(all(p.body, "rset-left")[0].kids.join(""), "5:00", `skew ${skew}`);
    await p.pass(3000);
    assert.equal(all(p.body, "rset-left")[0].textContent, "4:57", `skew ${skew}`);
    assert.ok(!p.toasts.some(([m]) => /ran out/.test(m)), `skew ${skew}: not run out`);
    p.claim("MacBook");
    await p.pass(2000);
    assert.ok(p.toasts.some(([m]) => m === "MacBook is paired"), `skew ${skew}: ${JSON.stringify(p.toasts)}`);
    assert.equal(p.timers.length, 0);
  }
});

// (fails before: yes — the review of p1-review: a claim in the code's last seconds, after its last look, was said as run
// out and its device was not listed; a sixth code let the oldest go on the server, and the page still said it open; a
// list that could not be read ended a code still open)
test("a claim in the code's last seconds is said as paired, its device listed; a sixth code reads the open codes again; a list that fails ends no code", async () => {
  const p = await open();
  button(rowOf(p.body, "New code"), "Make a code").attrs.onclick();
  await settle();
  await p.pass(298_000);
  p.claim("MacBook");
  await p.pass(2000);
  assert.ok(p.toasts.some(([m]) => m === "MacBook is paired"), JSON.stringify(p.toasts));
  assert.ok(!p.toasts.some(([m]) => /ran out/.test(m)), "not run out");
  assert.deepEqual(labels(p.body), ["This machine", "MacBook", "New code"], "the device listed");
  assert.equal(p.timers.length, 0);

  const five = await open({ codes: ["a", "b", "c", "d", "e"].map((id) => ({ id, scope: "full", leftMs: 200_000 })) });
  assert.match(textOf(rowOf(five.body, "Codes open")), /^Codes open\|5 codes made earlier/);
  button(rowOf(five.body, "New code"), "Make a code").attrs.onclick();
  await settle();
  assert.deepEqual(five.openIds(), ["b", "c", "d", "e", "c1"], "the server keeps five");
  assert.match(textOf(rowOf(five.body, "Codes open")), /^Codes open\|4 codes made earlier/, "the one it let go is not said as open");

  // The list failing from the code's making on, its read just after it too: still no news of the code.
  let failing = false;
  const flaky = await open({ devicesFail: () => failing });
  failing = true;
  button(rowOf(flaky.body, "New code"), "Make a code").attrs.onclick();
  await settle();
  await flaky.pass(4000);
  assert.ok(!flaky.toasts.some(([m]) => /no longer open/.test(m)), JSON.stringify(flaky.toasts));
  assert.ok(labels(flaky.body).includes("Code"), "its code still shows");
  failing = false;
  flaky.claim("Phone");
  await flaky.pass(2000);
  assert.ok(flaky.toasts.some(([m]) => m === "Phone is paired"), JSON.stringify(flaky.toasts));
});

// (fails before: yes — the review of fx-pair-settings: an older read of the list, answered after a newer one, stood
// for it - the device just paired gone from the list, the code it took said open)
test("an older read of the list, answered after a newer one, stands for nothing", async () => {
  let hold = false;
  let release = () => {};
  const p = await open({ devicesHold: () => (hold ? ((hold = false), new Promise((r) => (release = () => r(undefined)))) : null) });
  button(rowOf(p.body, "New code"), "Make a code").attrs.onclick();
  await settle();
  hold = true;
  await p.pass(2000);
  p.claim("Phone");
  await p.pass(2000);
  assert.ok(p.toasts.some(([m]) => m === "Phone is paired"), JSON.stringify(p.toasts));
  release();
  await settle();
  // Drawn again by a choice that reads nothing: the list as the newer read said it.
  button(p.body, "View-only").attrs.onclick();
  await settle();
  assert.ok(labels(p.body).includes("Phone"), labels(p.body).join(", "));
  assert.ok(!labels(p.body).includes("Codes open"), "the code it took is not said as open");

  // One that failed, landing after a newer one that read the list, says nothing of the list either.
  let failNext = false;
  const q = await open({ devicesFail: () => failNext && !(failNext = false), devicesHold: () => (hold ? ((hold = false), new Promise((r) => (release = () => r(undefined)))) : null) });
  button(rowOf(q.body, "New code"), "Make a code").attrs.onclick();
  await settle();
  [failNext, hold] = [true, true];
  await q.pass(2000);
  q.claim("Tablet");
  await q.pass(2000);
  assert.ok(q.toasts.some(([m]) => m === "Tablet is paired"), JSON.stringify(q.toasts));
  release();
  await settle();
  button(q.body, "View-only").attrs.onclick();
  await settle();
  assert.ok(labels(q.body).includes("Tablet"), labels(q.body).join(", "));
  assert.doesNotMatch(textOf(q.body), /Filament is restarting/, "no failure said of a list read since");
});

// (fails before: yes — the review of fx-pair-settings: a read was dropped as soon as a newer one began, so where every
// read took longer than the look none landed and a device that paired was not seen until the code's end; the code was
// drawn only once the list read after its making answered; a code's links came from a listener read made before it, of
// an address the machine no longer had; at the code's end a list that could not be read was said as "ran out")
test("reads slower than the look still land; a code is drawn before its list read answers, with its own links; an unread end says it cannot tell", async () => {
  // Every read of the list answers 3 s after it is asked; the look asks every 2.
  /** @type {{ r: (v?: unknown) => void, at: number }[]} */
  let queue = [];
  let clock = 0;
  let slowOn = false;
  const slow = await open({ devicesHold: () => (slowOn ? new Promise((r) => queue.push({ r, at: clock + 3000 })) : null) });
  button(rowOf(slow.body, "New code"), "Make a code").attrs.onclick();
  await settle();
  slowOn = true;
  slow.claim("Phone");
  for (let i = 0; i < 10 && !slow.toasts.some(([m]) => m === "Phone is paired"); i++) {
    clock += 1000;
    await slow.pass(1000);
    for (const q of queue.filter((q) => q.at <= clock)) q.r();
    queue = queue.filter((q) => q.at > clock);
    await settle();
  }
  assert.ok(slow.toasts.some(([m]) => m === "Phone is paired"), JSON.stringify(slow.toasts));
  assert.ok(clock <= 6000, `seen within a look and a read: ${clock} ms`);
  for (const q of queue) q.r();

  // The code drawn while the list read after its making has not answered — the page drawn as it was asked
  // ("Starting…") before the code came.
  let hold = false;
  let release = () => {};
  let pairGo = () => {};
  const drawn = await open({ devicesHold: () => (hold ? ((hold = false), new Promise((r) => (release = () => r(undefined)))) : null), pairHold: () => new Promise((r) => (pairGo = () => r(undefined))) });
  hold = true;
  button(rowOf(drawn.body, "New code"), "Make a code").attrs.onclick();
  await settle();
  assert.ok(!labels(drawn.body).includes("Code"), "asked, not made yet");
  pairGo();
  await settle();
  assert.ok(labels(drawn.body).includes("Code"), labels(drawn.body).join(", "));
  release();
  await settle();

  // The machine moved to another address since the page read the listener: the code's links are where it is now.
  // The code's own links, as the server made them with it, stand until the page reads the listener after it.
  let addr = "192.168.1.20";
  const FP = `${"AB:".repeat(31)}AB`;
  const NEW_LINK = `https://10.0.0.7:20343/ui/pair.html#code=ABCD-EFGH&fp=${"AB".repeat(32)}`;
  const lan = {
    enabled: true,
    state: async (/** @type {{ enabled: boolean, port: number }} */ cfg) => ({ on: true, port: cfg.port, listening: { port: cfg.port }, error: null, fingerprint: FP, addresses: [`https://${addr}:${cfg.port}`], platform: "linux", firewall: null }),
  };
  const moved = await open({ lan, links: [NEW_LINK] });
  addr = "10.0.0.7";
  button(rowOf(moved.body, "New code"), "Make a code").attrs.onclick();
  await settle();
  const links = textOf(rowOf(moved.body, "Links"));
  assert.ok(links.includes(NEW_LINK) && !links.includes("192.168.1.20"), `the code's own, not the read before it: ${links}`);

  // The list read at the code's end could not be read: whether a device took it is not said either way.
  let failing = false;
  const unread = await open({ devicesFail: () => failing });
  button(rowOf(unread.body, "New code"), "Make a code").attrs.onclick();
  await settle();
  await unread.pass(298_000);
  failing = true;
  await unread.pass(2000);
  assert.ok(unread.toasts.some(([m]) => m === RAN_OUT_UNREAD_WORDS), JSON.stringify(unread.toasts));
  assert.ok(!unread.toasts.some(([m]) => /^The code ran out/.test(m)), "not said as run out");

  // A page left while the end's read was on its way says nothing.
  let endHold = false;
  let endGo = () => {};
  const left = await open({ devicesHold: () => (endHold ? ((endHold = false), new Promise((r) => (endGo = () => r(undefined)))) : null) });
  button(rowOf(left.body, "New code"), "Make a code").attrs.onclick();
  await settle();
  await left.pass(299_000);
  endHold = true;
  await left.pass(1000);
  const before = left.toasts.length;
  /** @type {any} */ (left.body).isConnected = false;
  endGo();
  await settle();
  assert.equal(left.toasts.length, before, JSON.stringify(left.toasts.slice(before)));
});

// (fails before: yes — linksOf was not; pinned to the server's own pairLinks)
test("a code's links on the page are the server's: each address, the code and the fingerprint as the server writes them", () => {
  const net = { listening: { port: 20343 }, fingerprint: `ab:cd:${"ef:".repeat(29)}01`, addresses: ["https://192.168.1.20:20343", "https://10.0.0.5:20343"] };
  for (const code of ["ABCD-EFGH", "a b&c=d#e"]) assert.deepEqual(linksOf(net, code), pairLinks(net, code), code);
  assert.equal(linksOf(net, "a b&c")[1], `https://10.0.0.5:20343/ui/pair.html#code=a%20b%26c&fp=ABCD${"EF".repeat(29)}01`);
  assert.deepEqual(linksOf({ ...net, listening: null }, "X"), [], "not listening: none");
  assert.deepEqual(linksOf({ ...net, fingerprint: null }, "X"), [], "no certificate: none");
});

// (fails before: yes — the review of p1-review: a code's links were the ones its making said, so the network turned on
// while it showed brought none)
test("the network turned on while a code shows brings the code's links, as the server makes them; turned off takes them", async () => {
  const FP = `${"AB:".repeat(31)}AB`;
  const lan = {
    state: async (/** @type {{ enabled: boolean, port: number }} */ cfg) =>
      cfg.enabled
        ? { on: true, port: cfg.port, listening: { port: cfg.port }, error: null, fingerprint: FP, addresses: [`https://192.168.1.20:${cfg.port}`], platform: "linux", firewall: null }
        : { on: false, port: cfg.port, listening: null, error: null, fingerprint: null, addresses: [], platform: "linux", firewall: null },
  };
  const p = await open({ lan, links: [] });
  button(rowOf(p.body, "New code"), "Make a code").attrs.onclick();
  await settle();
  assert.ok(!labels(p.body).includes("Links"));
  assert.match(textOf(p.body), /No other machine reaches Filament on the network yet/);
  button(p.body, "Reach this machine on my network").attrs.onclick();
  await settle();
  assert.ok(labels(p.body).includes("Links"), labels(p.body).join(", "));
  assert.ok(textOf(rowOf(p.body, "Links")).includes(LINK), textOf(rowOf(p.body, "Links")));
  assert.ok(textOf(p.body).includes(`Or in its terminal: filament connect ${LINK}`));
  button(p.body, "Reach this machine on my network").attrs.onclick();
  await settle();
  assert.ok(!labels(p.body).includes("Links"), "off: none");
  assert.match(textOf(p.body), /No other machine reaches Filament on the network yet/);
});

// (fails before: yes — nothing turned a listener on for the network, said its certificate, or read Windows Firewall)
test("On my network: off until turned on; on, its port, its addresses and the certificate's fingerprint with Copy, and Windows Firewall with Allow, asked here alone; a port in use is said", async () => {
  const FP = `${"AB:".repeat(31)}AB`;
  let fw = { open: false, fix: true, words: "Windows Firewall lets no other machine reach port 20343 yet." };
  let busy = false;
  /** @type {boolean[]} */
  const fresh = [];
  /** A read held until the test lets it go. @type {{ promise: Promise<void>, go: () => void } | null} */
  let held = null;
  const lan = {
    state: async (/** @type {{ enabled: boolean, port: number }} */ cfg, /** @type {boolean} */ again) => {
      if (held) await held.promise;
      fresh.push(again);
      if (!cfg.enabled) return { on: false, port: cfg.port, listening: null, error: null, fingerprint: null, addresses: [], platform: "win32", firewall: null };
      if (busy) return { on: true, port: cfg.port, listening: null, error: `port ${cfg.port} is in use by another program: choose another port`, fingerprint: null, addresses: [], platform: "win32", firewall: null };
      return { on: true, port: cfg.port, listening: { port: cfg.port }, error: null, fingerprint: FP, addresses: [`https://192.168.1.20:${cfg.port}`, `https://10.0.0.7:${cfg.port}`], platform: "win32", firewall: fw };
    },
    allow: () => ((fw = { open: true, fix: false, words: "Windows Firewall lets the machines on this network reach port 20343." }), { ok: true, firewall: fw }),
    newKey: () => ({ fingerprint: NEW_FP }),
  };
  const NEW_FP = `${"CD:".repeat(31)}EF`;
  const p = await open({ lan });
  assert.deepEqual(labels(p.body), ["This machine", "Reach this machine on my network", "New code"], "off: the switch alone");
  /** @type {() => void} */
  let go = () => {};
  held = { promise: new Promise((r) => (go = r)), go };
  button(p.body, "Reach this machine on my network").attrs.onclick();
  await settle();
  assert.deepEqual(p.calls.find(([m, path]) => m === "PATCH" && path === "/config/fields")?.[2].set, { "server.lan.enabled": true });
  assert.match(textOf(p.body), /Reading where it listens…/, "what was read of it off is not what it is now");
  held = null;
  go();
  await settle();
  assert.deepEqual(labels(p.body), ["This machine", "Reach this machine on my network", "Port", "Addresses", "Certificate", "Certificate key", "Windows Firewall", "New code"]);
  assert.equal(button(p.body, "Reach this machine on my network").attrs["aria-checked"], "true");
  assert.match(textOf(rowOf(p.body, "Addresses")), /https:\/\/192\.168\.1\.20:20343\|.*https:\/\/10\.0\.0\.7:20343/);
  assert.ok(textOf(rowOf(p.body, "Certificate")).includes(FP));
  button(rowOf(p.body, "Certificate"), "Copy the fingerprint").attrs.onclick();
  await settle();
  assert.deepEqual(p.copied, [FP]);
  assert.match(textOf(rowOf(p.body, "Windows Firewall")), /lets no other machine reach port 20343 yet/);
  button(rowOf(p.body, "Windows Firewall"), "Allow").attrs.onclick();
  await settle();
  assert.ok(p.calls.some(([m, path]) => m === "POST" && path === "/remote/lan/firewall"));
  assert.ok(p.toasts.some(([m]) => m === "Windows Firewall lets this network reach Filament"), JSON.stringify(p.toasts));
  assert.match(textOf(rowOf(p.body, "Windows Firewall")), /lets the machines on this network reach port 20343/);
  button(rowOf(p.body, "Windows Firewall"), "Check again").attrs.onclick();
  await settle();
  assert.equal(fresh.at(-1), true, "Check again reads the firewall afresh");
  // (fails before: yes — s4g: there was no way to make the key anew) New key, on this computer, once the person said so.
  assert.match(textOf(rowOf(p.body, "Certificate key")), /Renewing the certificate keeps its key, so paired devices go on/);
  button(rowOf(p.body, "Certificate key"), "New key…").attrs.onclick();
  await settle();
  assert.ok(p.calls.some(([m, path]) => m === "POST" && path === "/remote/lan/new-key"));
  assert.ok(textOf(rowOf(p.body, "Certificate")).includes(NEW_FP), "the new certificate's fingerprint");
  assert.ok(p.toasts.some(([m]) => m === "A new key and certificate: pair each device again"), JSON.stringify(p.toasts));
  assert.match(NEW_KEY_WORDS, /Every machine and command line paired over the network pinned the old one: each stops reaching this machine there until it pairs again with a new code\./);
  const kept = await open({ lan: { ...lan, enabled: true }, confirm: false });
  button(rowOf(kept.body, "Certificate key"), "New key…").attrs.onclick();
  await settle();
  assert.ok(!kept.calls.some(([, path]) => path === "/remote/lan/new-key"), "said no: nothing asked");
  // A port another program holds: said, and nothing more drawn for it.
  busy = true;
  button(p.body, "Reach this machine on my network").attrs.onclick();
  await settle();
  button(p.body, "Reach this machine on my network").attrs.onclick();
  await settle();
  assert.match(textOf(p.body), /It does not listen: port 20343 is in use by another program: choose another port\./);
  assert.deepEqual(labels(p.body), ["This machine", "Reach this machine on my network", "Port", "New code"]);

  // Read from a full device on another machine: no Allow — Windows asks the person at this machine.
  busy = false;
  fw = { open: false, fix: true, words: "Windows Firewall lets no other machine reach port 20343 yet." };
  const far = await open({ lan: { ...lan, enabled: true }, state: { viewer: "remote", device: { id: "d1", name: "Laptop", scope: "full" } } });
  assert.match(textOf(rowOf(far.body, "Windows Firewall")), /Allow it on Workstation itself: Windows asks the person there to confirm\./);
  assert.ok(!buttonsOf(rowOf(far.body, "Windows Firewall")).some((b) => textOf(b) === "Allow"));
  assert.ok(!labels(far.body).includes("Certificate key"), "a new key is made on this computer alone");
  // A view-only device sees none of it.
  const view = await open({ lan: { ...lan, enabled: true }, devicesRefused: true, state: { viewer: "remote", device: { id: "d2", name: "Phone", scope: "view" } } });
  assert.ok(!labels(view.body).includes("Reach this machine on my network"));
  assert.ok(!view.calls.some(([, path]) => path.startsWith("/remote/lan")), "nor asks for it");
});

const TS_NAME = "desktop-1.tail5e6f7a.ts.net";
/** Tailscale here, as GET /remote/tailscale answers: served as server.tailscale says. @param {any} cfg @param {Record<string, any>} [more] */
const tsState = (cfg, more = {}) => ({
  on: cfg.serve, trustOwnLogin: cfg.trustOwnLogin, installed: true, state: "Running", stateSaid: "running", running: true, name: TS_NAME, login: "owner@example.com", tailnet: "owner@example.com", https: true,
  listening: cfg.serve ? { port: 20345, artPort: 20346 } : null, address: cfg.serve ? `https://${TS_NAME}` : null, artifacts: cfg.serve ? `https://${TS_NAME}:8443` : null,
  funnel: false, error: null, enable: null, unread: null, platform: "win32", ...more,
});

// (fails before: yes — nothing shared this Filament on a tailnet: tailscale serve was the person's to run by hand)
test("On my tailnet: off, the switch names the address to be; on, its address with Copy, where its artifacts are, and Trust my own tailnet login; a code's links carry it", async () => {
  const p = await open({ tailnet: { state: (cfg) => tsState(cfg) }, links: [] });
  assert.deepEqual(labels(p.body), ["This machine", "Share on my tailnet", "New code"], "off: the switch alone");
  assert.match(textOf(rowOf(p.body, "Share on my tailnet")), /an https address on your tailnet, https:\/\/desktop-1\.tail5e6f7a\.ts\.net\./);
  button(p.body, "Share on my tailnet").attrs.onclick();
  await settle();
  assert.deepEqual(p.calls.find(([m, path]) => m === "PATCH" && path === "/config/fields")?.[2].set, { "server.tailscale.serve": true });
  assert.deepEqual(labels(p.body), ["This machine", "Share on my tailnet", "Tailnet address", "Trust my own tailnet login", "New code"]);
  assert.match(textOf(rowOf(p.body, "Tailnet address")), /Its artifacts are at https:\/\/desktop-1\.tail5e6f7a\.ts\.net:8443\./);
  button(rowOf(p.body, "Tailnet address"), "Copy the address").attrs.onclick();
  await settle();
  assert.deepEqual(p.copied, [`https://${TS_NAME}`]);
  assert.match(textOf(rowOf(p.body, "Trust my own tailnet login")), /signed in to Tailscale as owner@example\.com drives this Filament without pairing; while the Filament app runs, a browser there answers asks once it is paired with a code/);
  button(p.body, "Trust my own tailnet login").attrs.onclick();
  await settle();
  assert.deepEqual(p.calls.filter(([m, path]) => m === "PATCH" && path === "/config/fields").at(-1)?.[2].set, { "server.tailscale.trustOwnLogin": true });
  // A code made now links the tailnet, with no fingerprint; the terminal's line names it.
  button(rowOf(p.body, "New code"), "Make a code").attrs.onclick();
  await settle();
  const link = `https://${TS_NAME}/ui/pair.html#code=ABCD-EFGH`;
  assert.ok(textOf(rowOf(p.body, "Links")).includes(link), textOf(rowOf(p.body, "Links")));
  assert.ok(textOf(p.body).includes(`Or in its terminal: filament connect ${link}`));
  // Off: its link goes.
  button(p.body, "Share on my tailnet").attrs.onclick();
  await settle();
  assert.ok(!labels(p.body).includes("Links"), labels(p.body).join(", "));
  assert.match(textOf(p.body), /turn on Reach this machine on my network or Share on my tailnet above/);
  await p.pass(1000);
});

// (fails before: yes — a pairing link was words alone: a phone typed it, or had it sent)
test("a link's QR code: every dark module the encoder made, inside a quiet zone of four, dark on white; none with no encoder or words no code holds", () => {
  const svg = qrSvg(qrcode, LINK);
  const size = Number(/viewBox="0 0 (\d+) \1"/.exec(svg)?.[1]);
  const q = qrcode(0, "M");
  q.addData(LINK, "Byte");
  q.make();
  const n = q.getModuleCount();
  assert.equal(size, n + 8, "four modules of quiet zone round it");
  assert.match(svg, new RegExp(`<rect width="${size}" height="${size}" fill="#fff"/><path d="[^"]+" fill="#000"/></svg>$`), "dark on white, whatever the page's look");
  assert.ok(!/<script|on\w+=/i.test(svg), "numbers alone");
  // The path's runs, read back, are the encoder's dark modules, each once.
  const d = /<path d="([^"]+)"/.exec(svg)?.[1] || "";
  const runs = [...d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)];
  assert.equal(runs.map((r) => r[0]).join(""), d, "the path is runs alone");
  const dark = new Set();
  for (const [, x, y, w] of runs)
    for (let i = 0; i < Number(w); i++) {
      const at = `${Number(y) - 4},${Number(x) - 4 + i}`;
      assert.ok(!dark.has(at), `${at} drawn once`);
      dark.add(at);
    }
  let want = 0;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (q.isDark(r, c)) {
        want++;
        assert.ok(dark.has(`${r},${c}`), `module ${r},${c} drawn`);
      }
  assert.equal(dark.size, want, "no module drawn the encoder left light");
  assert.equal(qrSvg(null, LINK), "", "no encoder: no code");
  assert.equal(qrSvg(() => { throw new Error("broken"); }, LINK), "");
  assert.equal(qrSvg(qrcode, "x".repeat(4000)), "", "words no code holds: no code, nothing thrown");
  assert.equal(onTailnet(LINK), false, "a link on the network carries its fingerprint");
  assert.equal(onTailnet(`https://${TS_NAME}/ui/pair.html#code=ABCD-EFGH`), true);
});

// (fails before: yes — the same)
test("a code's links: the tailnet's first, each with its QR code and what a phone says of it; an encoder that will not load leaves them words", async () => {
  // The page loads the vendored encoder by its own address, as the served page does.
  const loaded = await import(new URL(QR_MODULE, new URL("../src/ui/harness/settings/remote.js", import.meta.url)).href);
  assert.equal(loaded.qrcode, qrcode);
  const tail = `https://${TS_NAME}/ui/pair.html#code=ABCD-EFGH`;
  /** @type {(() => void)[]} */
  const comes = [];
  const p = await open({ tailnet: { serve: true, state: (cfg) => tsState(cfg) }, links: [LINK], qr: () => new Promise((r) => comes.push(() => r(qrcode))) });
  button(rowOf(p.body, "New code"), "Make a code").attrs.onclick();
  await settle();
  const blocks = () => all(rowOf(p.body, "Links"), "rset-link");
  assert.deepEqual(blocks().map((b) => textOf(b)), [tail, LINK], "the tailnet's first: a phone opens it with no warning");
  assert.ok(textOf(p.body).includes(`Or in its terminal: filament connect ${tail}`));
  assert.equal(all(p.body, "rset-qr").length, 0, "words alone while the encoder loads");
  assert.equal(comes.length, 1, "the encoder asked for once");
  comes[0]();
  await settle();
  const codes = all(p.body, "rset-qr");
  assert.deepEqual(codes.map((c) => c.attrs["aria-label"]), ["QR code of the link on your tailnet", "QR code of the link on your network"]);
  assert.deepEqual(codes.map((c) => c.attrs.html), [qrSvg(qrcode, tail), qrSvg(qrcode, LINK)], "each link's own code");
  assert.deepEqual(all(p.body, "rset-qr-said").map((s) => textOf(s)), [QR_TAILNET_WORDS, QR_LAN_WORDS]);
  // Cancelled and made again: the encoder already here, the codes drawn at once, not asked for again.
  button(rowOf(p.body, "Good for"), "Cancel").attrs.onclick();
  await settle();
  button(rowOf(p.body, "New code"), "Make a code").attrs.onclick();
  await settle();
  assert.equal(all(p.body, "rset-qr").length, 2);
  assert.equal(comes.length, 1);
  await p.pass(1000);

  const broken = await open({ links: [LINK], qr: async () => { throw new Error("no module"); } });
  button(rowOf(broken.body, "New code"), "Make a code").attrs.onclick();
  await settle();
  assert.deepEqual(all(rowOf(broken.body, "Links"), "rset-link").map((b) => textOf(b)), [LINK], "the link still there to copy");
  assert.equal(all(broken.body, "rset-qr").length, 0);
  assert.equal(broken.toasts.length, 0, "nothing said: the link's words are enough");
  await broken.pass(1000);
});

// (fails before: yes — the same)
test("On my tailnet: not installed, signed out, or what Tailscale asks for, said — its address to open, and Try again", async () => {
  const none = await open({ tailnet: { state: () => ({ installed: false, on: false, name: "", running: false }) } });
  assert.match(textOf(none.body), /Tailscale is not installed on Workstation: install it from https:\/\/tailscale\.com\/download, sign in, then turn this on\./);
  const out = await open({ tailnet: { state: (cfg) => tsState(cfg, { running: false, state: "NeedsLogin", stateSaid: "signed out", name: "" }) } });
  assert.match(textOf(out.body), /Tailscale is signed out on Workstation: sign in from its icon, then turn this on\./);
  const ASK = "https://login.tailscale.com/f/serve?node=nT3st";
  let enabled = false;
  const asks = (/** @type {any} */ cfg) => (enabled ? tsState(cfg) : tsState(cfg, { address: null, artifacts: null, listening: null, enable: ASK, error: `Tailscale asks for it to be turned on for your tailnet first: open ${ASK}, turn it on, then turn this on again` }));
  const p = await open({ tailnet: { serve: true, state: asks, retry: asks } });
  assert.deepEqual(labels(p.body), ["This machine", "Share on my tailnet", "Turn it on", "Tailscale", "Trust my own tailnet login", "New code"]);
  assert.match(textOf(p.body), /Tailscale asks for it to be turned on for your tailnet first/);
  button(rowOf(p.body, "Turn it on"), "Copy the address").attrs.onclick();
  await settle();
  assert.deepEqual(p.copied, [ASK]);
  enabled = true;
  button(rowOf(p.body, "Tailscale"), "Try again").attrs.onclick();
  await settle();
  assert.ok(p.calls.some(([m, path]) => m === "POST" && path === "/remote/tailscale/retry"));
  assert.ok(p.toasts.some(([m]) => m === `Shared on your tailnet at https://${TS_NAME}`), JSON.stringify(p.toasts));
  assert.deepEqual(labels(p.body), ["This machine", "Share on my tailnet", "Tailnet address", "Trust my own tailnet login", "New code"]);
  // HTTPS off for the tailnet, or Funnel on for it: said.
  const warn = await open({ tailnet: { serve: true, state: (cfg) => tsState(cfg, { https: false, funnel: true }) } });
  assert.match(textOf(warn.body), /HTTPS certificates are off for your tailnet: turn them on in its admin console, https:\/\/login\.tailscale\.com\/admin\/dns\./);
  assert.match(textOf(warn.body), /Funnel is on for it: anyone on the internet reaches this address/);
  // A view-only device sees none of it, nor asks.
  const view = await open({ tailnet: { serve: true, state: (cfg) => tsState(cfg) }, devicesRefused: true, state: { viewer: "remote", device: { id: "d2", name: "Phone", scope: "view" } } });
  assert.ok(!labels(view.body).includes("Share on my tailnet"));
  assert.ok(!view.calls.some(([, path]) => path.startsWith("/remote/tailscale")));
});

// (fails before: yes — the owner's Mac of 11-09: the share's own read and the page's look failed alike, and both were said)
test("On my tailnet: a read that failed is said once where the share's own read failed alike; a look that failed apart, said beside it", async () => {
  const WHY = "Tailscale does not answer here: The Tailscale GUI failed to start";
  const alike = await open({ tailnet: { serve: true, state: (cfg) => tsState(cfg, { address: null, artifacts: null, listening: null, error: WHY, unread: WHY }) } });
  assert.equal(textOf(alike.body).split(WHY).length - 1, 1, textOf(alike.body));
  const apart = await open({ tailnet: { serve: true, state: (cfg) => tsState(cfg, { unread: "it did not answer" }) } });
  assert.match(textOf(apart.body), /Tailscale could not be read: it did not answer/);
});

test("the devices: last seen and from where; Revoke asks, then revokes; a revoked one is forgotten", async () => {
  const p = await open({ devices: [{ id: "d1", name: "Phone", scope: "view", kind: "browser", createdAt: T0 - 86_400_000, lastSeenAt: T0 - 5 * 60_000, lastSeenFrom: "100.88.1.2", revokedAt: null }] });
  assert.match(textOf(rowOf(p.body, "Phone")), /Browser · view-only · seen 5 min ago from 100\.88\.1\.2/);
  button(rowOf(p.body, "Phone"), "Revoke").attrs.onclick();
  await settle();
  assert.ok(p.calls.some(([m, path]) => m === "DELETE" && path === "/remote/devices/d1"));
  assert.ok(p.toasts.some(([m]) => m === "Phone is revoked"));
  assert.match(textOf(rowOf(p.body, "Phone")), /revoked just now/);
  button(rowOf(p.body, "Phone"), "Forget").attrs.onclick();
  await settle();
  assert.ok(p.calls.some(([m, path]) => m === "DELETE" && path === "/remote/devices/d1?forget=1"));
  assert.match(textOf(p.body), /No other machine is paired with this one yet\.\|Browsers and command lines\|No browser or command line is paired yet\./);
  const kept = await open({ confirm: false, devices: [{ id: "d2", name: "Tablet", scope: "full", kind: "cli", createdAt: T0, lastSeenAt: null, revokedAt: null }] });
  button(rowOf(kept.body, "Tablet"), "Revoke").attrs.onclick();
  await settle();
  assert.ok(!kept.calls.some(([m]) => m === "DELETE"), "asked, and declined: nothing revoked");
});

test("read from another machine: pairing is that machine's, this device signs itself out; a view-only device sees no list", async () => {
  const me = { id: "d9", name: "Laptop", scope: "full" };
  const p = await open({ state: { viewer: "remote", device: me }, devices: [{ ...me, kind: "browser", createdAt: T0, lastSeenAt: T0, lastSeenFrom: "100.88.1.2", revokedAt: null }] });
  assert.deepEqual(labels(p.body), ["This machine", "This device", "Laptop (this device)"]);
  assert.match(textOf(p.body), /A pairing starts on Workstation itself: open Filament there/);
  assert.ok(!buttonsOf(p.body).some((b) => textOf(b) === "Make a code"), "no pairing from here");
  button(rowOf(p.body, "This device"), "Sign out").attrs.onclick();
  await settle();
  assert.ok(p.calls.some(([m, path]) => m === "POST" && path === "/remote/sign-out"));
  assert.deepEqual(p.went, ["/ui/pair.html"]);
  const view = await open({ state: { viewer: "remote", device: { id: "d8", name: "Phone", scope: "view" } }, devicesRefused: true });
  assert.match(textOf(view.body), /A view-only device sees no list of machines or devices\./);
  assert.match(textOf(rowOf(view.body, "This device")), /view-only: it reads/);
});

test("the words: time left, a device's line", () => {
  assert.deepEqual([leftWords(300_000), leftWords(61_500), leftWords(999), leftWords(-5)], ["5:00", "1:02", "0:01", "0:00"]);
  assert.equal(deviceWords({ kind: "cli", scope: "full", lastSeenAt: T0 - 3 * 3_600_000, lastSeenFrom: null }, T0), "Command line · full · seen 3 h ago");
  assert.equal(deviceWords({ kind: "browser", scope: "view", lastSeenAt: null }, T0), "Browser · view-only · not seen yet");
  // (fails before: yes — s4f: nothing said a device lapses unused)
  const at = Date.UTC(2027, 1, 21, 12);
  const day = new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  assert.equal(expiryWords(at, at - 1), `expires ${day} if unused`);
  assert.equal(deviceWords({ kind: "browser", scope: "full", lastSeenAt: at - 3_600_000, lastSeenFrom: "192.0.2.4", expiresAt: at }, at - 60_000), `Browser · full · seen 59 min ago from 192.0.2.4 · expires ${day} if unused`);
  assert.equal(deviceWords({ kind: "cli", scope: "view", lastSeenAt: null, expiresAt: at }, at), "Command line · view-only · not seen yet · expired: it went unused, pair it again");
  assert.equal(deviceWords({ kind: "browser", scope: "full", lastSeenAt: null, revokedAt: at - 60_000, expiresAt: null }, at), "Browser · full · revoked 1 min ago", "revoked: nothing lapses");
  assert.deepEqual([expiryWords(null, at), expiryWords(undefined, at)], ["", ""], "an agents' device, or a Filament from before");
});

test("the pairing page: the code a link's fragment carries, this device's name from its browser, a refusal in words", () => {
  assert.equal(codeOf("#code=ABCD-EFGH"), "ABCD-EFGH");
  assert.equal(codeOf(""), "");
  assert.equal(codeOf("#other=1"), "");
  assert.equal(deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"), "Chrome on macOS");
  assert.equal(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), "Safari on iOS");
  assert.equal(deviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0"), "Edge on Windows");
  assert.equal(deviceName(""), "A browser");
  assert.match(claimWords(403, { error: "x" }, "Workstation"), /^That code is wrong or has run out\. Make a new one on Workstation/);
  assert.equal(claimWords(429, { retryAt: T0 + 42_000 }, "W", T0), "Too many wrong codes: try again in 42 s.");
  assert.equal(claimWords(429, { retryAt: T0 + 290_000 }, "W", T0), "Too many wrong codes: try again in 5 min.");
  assert.equal(claimWords(500, { error: "boom" }, "W"), "Not paired: boom");
});

/**
 * The pairing page over a fake document: its elements by id, the address, its history and the window's events, and a
 * server that answers who it is, who the caller is, and the claim.
 * @param {{ hash?: string, me?: any, refused?: any, claim?: { status: number, body: any }, protocol?: string, hostname?: string, port?: string, opensName?: boolean }} [o]  `hostname`: localhost (this machine, an SSH tunnel) unless said;
 *   `refused`: the admin gate's refusal of a caller it does not know, as it says it; `opensName`: false where the browser
 *   cannot open a name under localhost (Safari)
 */
const pairPage = async (o = {}) => {
  /** @type {Record<string, any>} */
  const els = {};
  const el = (/** @type {string} */ id) =>
    (els[id] ??= { id, value: "", textContent: "", hidden: id === "pair-open", disabled: false, focused: false, err: false, classList: { toggle: (/** @type {string} */ _c, /** @type {boolean} */ on) => (els[id].err = on) }, focus: () => (els[id].focused = true) });
  const doc = /** @type {any} */ ({ title: "", getElementById: el });
  const loc = /** @type {any} */ ({ protocol: o.protocol ?? "http:", hostname: o.hostname ?? "localhost", port: o.port ?? "", hash: o.hash ?? "", pathname: "/ui/pair.html", search: "", went: /** @type {string[]} */ ([]), assign: (/** @type {string} */ p) => loc.went.push(p), replaced: /** @type {string[]} */ ([]), replace: (/** @type {string} */ p) => loc.replaced.push(p) });
  const hist = /** @type {any} */ ({ replaceState: (/** @type {any} */ _s, /** @type {string} */ _t, /** @type {string} */ url) => (loc.hash = new URL(url, "http://x").hash) });
  /** @type {Record<string, () => void>} */
  const heard = {};
  const win = { addEventListener: (/** @type {string} */ type, /** @type {() => void} */ fn) => (heard[type] = fn) };
  /** @type {any[]} */
  const posted = [];
  const fetchImpl = /** @type {any} */ (async (/** @type {string} */ path, /** @type {any} */ init) => {
    const reply = (/** @type {number} */ status, /** @type {any} */ body) => ({ ok: status < 400, status, json: async () => body });
    // A look at a name under localhost (src/ui/pair.js `pageMove`): an opaque answer where the browser opens it, else a
    // failed fetch, as a name it cannot resolve gives.
    if (/^http:\/\/filament-[0-9a-f]{12}\.localhost(:\d+)?\/health$/.test(path)) {
      if (o.opensName === false) throw new TypeError("Failed to fetch");
      return { ok: false, status: 0, json: async () => null };
    }
    if (path === "/.well-known/filament") return reply(200, { name: "Workstation" });
    if (path === "/api/remote/me") return o.me ? reply(200, o.me) : reply(403, o.refused ?? { error: "admin API answers…", pair: "/ui/pair.html" });
    if (path === "/api/remote/claim") {
      posted.push(JSON.parse(init.body));
      const c = o.claim ?? { status: 200, body: { device: { name: "Chrome on macOS" } } };
      return reply(c.status, c.body);
    }
    throw new Error(`unexpected ${path}`);
  });
  const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
  await mountPair({ doc, fetchImpl, loc, hist, ua, win });
  const submit = async () => {
    await el("pair-form").onsubmit({ preventDefault() {} });
  };
  return { el, loc, heard, posted, submit, doc };
};

// (fails before: yes — the pairing page said nothing of the certificate, and a link carried no fingerprint)
test("the pairing page over https: the person compares the browser's certificate details with the fingerprint the machine shows — the link's, where it carries one; over http nothing is said", async () => {
  const hex = `${"AB".repeat(31)}CD`;
  const fp = `${"AB:".repeat(31)}CD`;
  assert.equal(printOf(`#code=ABCD-EFGH&fp=${hex}`), fp);
  assert.equal(printOf(`#code=ABCD-EFGH&fp=${hex.toLowerCase()}`), fp);
  assert.equal(printOf("#code=ABCD-EFGH&fp=ABCD"), "", "a part of one is none");
  assert.equal(printOf("#code=ABCD-EFGH"), "");
  assert.equal(printWords("http:", fp, "Workstation"), "", "no certificate over plain http (this machine, an SSH tunnel)");
  assert.match(printWords("https:", fp, "Workstation"), /^Check the certificate first: your browser's certificate details for this page \(the warning sign or padlock in the address bar › Certificate\) must show this SHA-256 fingerprint, which Settings › Remote access shows on Workstation and the link carries\. Another means something else answered: close the page\.$/);
  assert.match(printWords("https:", "", "Workstation"), /must show the SHA-256 fingerprint Settings › Remote access shows on Workstation\./);

  const p = await pairPage({ protocol: "https:", hash: `#code=ABCD-EFGH&fp=${hex}` });
  assert.equal(p.loc.hash, "", "the code and the fingerprint are off the address");
  assert.equal(p.el("pair-print").hidden, false);
  assert.match(p.el("pair-print-words").textContent, /on Workstation and the link carries/);
  assert.deepEqual([p.el("pair-print-fp").textContent, p.el("pair-print-fp").hidden], [fp, false]);
  const typed = await pairPage({ protocol: "https:" });
  assert.match(typed.el("pair-print-words").textContent, /must show the SHA-256 fingerprint Settings › Remote access shows on Workstation/);
  assert.equal(typed.el("pair-print-fp").hidden, true, "no link, no fingerprint of its own to show");
  typed.loc.hash = `#code=WXYZ-2345&fp=${hex}`;
  typed.heard.hashchange();
  assert.deepEqual([typed.el("pair-print-fp").textContent, typed.el("pair-print-fp").hidden], [fp, false], "a link opened on the page brings its fingerprint");
  const plain = await pairPage({ hash: `#code=ABCD-EFGH&fp=${hex}` });
  assert.equal(plain.el("pair-print").hidden, true, "over http: nothing to compare");
});

// (fails before: yes — over the network's plain http the page sent the code in the clear, and the refusal read as a
// wrong code, the review of p2-lan)
test("the pairing page over plain http from another machine sends no code: it says to open the https address; this machine and an SSH tunnel pair as before", async () => {
  assert.deepEqual(
    [
      inTheClear({ protocol: "http:", hostname: "192.168.1.20" }),
      inTheClear({ protocol: "http:", hostname: "workstation.local" }),
      inTheClear({ protocol: "https:", hostname: "192.168.1.20" }),
      inTheClear({ protocol: "http:", hostname: "localhost" }),
      inTheClear({ protocol: "http:", hostname: "127.0.0.1" }),
      inTheClear({ protocol: "http:", hostname: "[::1]" }),
    ],
    [true, true, false, false, false, false],
  );
  assert.equal(claimWords(403, { error: "pairing goes over https", https: true }, "Workstation"), clearWords("Workstation"), "the server's refusal over plain http is said as that, not as a wrong code");
  assert.match(clearWords("Workstation"), /^This page came over plain http, which anyone on the network can read: a code typed here would be theirs too\. On Workstation, turn on Settings › Remote access › Reach this machine on my network, and open the https address it shows/);
  const far = await pairPage({ hostname: "192.168.1.20", hash: "#code=ABCD-EFGH" });
  assert.equal(far.loc.hash, "", "the link's code is off the address all the same");
  assert.deepEqual([far.el("pair-form").hidden, far.el("pair-said").textContent, far.el("pair-said").err], [true, clearWords("Workstation"), true]);
  assert.equal(far.el("pair-form").onsubmit, undefined, "no form to send");
  assert.deepEqual(far.posted, [], "the code never went");
  const tunnel = await pairPage({ hash: "#code=ABCD-EFGH" });
  await tunnel.submit();
  assert.deepEqual(tunnel.posted.map((b) => b.code), ["ABCD-EFGH"], "localhost — this machine, an SSH tunnel — pairs");
});

// (fails before: yes — the link opened at the name itself, which Safari cannot open: the person met the browser's own
// error page, the hunt on s0f)
test("a browser here's link lands at 127.0.0.1 and moves on to this Filament's name where the browser opens it; one that cannot is told so, and claims nothing", async () => {
  const NAME = "filament-0123456789ab";
  assert.equal(pageNameOf(`#code=ABCD-EFGH&name=${NAME}`), `${NAME}.localhost`);
  assert.equal(pageNameOf(`#code=ABCD-EFGH&name=${NAME.toUpperCase()}`), `${NAME}.localhost`);
  for (const bad of ["", "#code=ABCD-EFGH", "#name=filament-0123", "#name=evil.example", `#name=${NAME}.localhost`, "#name=filament-0123456789ag"]) assert.equal(pageNameOf(bad), "", bad);
  const at127 = { protocol: "http:", hostname: "127.0.0.1", port: "7777", pathname: "/ui/pair.html", hash: `#code=ABCD-EFGH&name=${NAME}&to=console` };
  assert.equal(pageMove(at127), `http://${NAME}.localhost:7777/ui/pair.html#code=ABCD-EFGH&name=${NAME}&to=console`, "the port and the fragment kept");
  assert.equal(pageMove({ ...at127, hostname: `${NAME}.localhost` }), null, "there already");
  assert.equal(pageMove({ ...at127, hash: "#code=ABCD-EFGH" }), null, "no name: the page stays");
  assert.equal(pageMove({ ...at127, protocol: "https:" }), null, "the network's listener is no browser here");

  const opens = await pairPage({ hostname: "127.0.0.1", port: "7777", hash: `#code=ABCD-EFGH&name=${NAME}` });
  assert.deepEqual(opens.loc.replaced, [`http://${NAME}.localhost:7777/ui/pair.html#code=ABCD-EFGH&name=${NAME}`]);
  assert.deepEqual(opens.posted, [], "the claim waits for the name");

  const safari = await pairPage({ hostname: "127.0.0.1", port: "7777", hash: `#code=ABCD-EFGH&name=${NAME}`, opensName: false, me: { who: "local" } });
  assert.deepEqual(safari.loc.replaced, []);
  assert.equal(safari.loc.hash, "", "the code is off the address");
  assert.deepEqual([safari.el("pair-form").hidden, safari.el("pair-said").textContent, safari.el("pair-said").err], [true, NO_NAME_WORDS("Workstation"), true]);
  assert.match(NO_NAME_WORDS("Workstation"), /Safari cannot\. Open this link in Chrome, Firefox or Edge, or use the Filament app\.$/);
  assert.deepEqual(safari.posted, [], "a cookie at 127.0.0.1 is never made");

  const there = await pairPage({ hostname: `${NAME}.localhost`, port: "7777", hash: `#code=ABCD-EFGH&name=${NAME}`, me: { who: "local" } });
  assert.deepEqual(there.loc.replaced, []);
  assert.deepEqual(there.posted.map((b) => b.code), ["ABCD-EFGH"], "at the name: claimed at once");
  // (fails before: yes — s0c: a browser here is no one's until it pairs, and its link's code waited for a press)
  const owned = await pairPage({ hostname: `${NAME}.localhost`, port: "7777", hash: `#code=ABCD-EFGH&name=${NAME}`, refused: { error: "Filament answers a program on this computer by its owner key…", ownerKey: true, pair: "/ui/pair.html" } });
  assert.deepEqual(owned.posted.map((b) => b.code), ["ABCD-EFGH"], "refused as no one, at the name: claimed at once");
  assert.match(owned.el("pair-lead").textContent, /^Paired as|^Pairing this browser with Workstation/);
  const typed = await pairPage({ hostname: `${NAME}.localhost`, port: "7777", hash: "#code=ABCD-EFGH" });
  assert.deepEqual(typed.posted, [], "a link with no name, a code from another machine's Settings: typed, not claimed unasked");
});

// (fails before: yes — a link opened on the pairing page changed its fragment alone, and the code was neither read nor taken off the address)
test("the pairing page: a link's code read and taken off the address, a link opened on the page read too; a claim refused in words, paired opens the harness", async () => {
  const p = await pairPage({ hash: "#code=ABCD-EFGH" });
  assert.equal(p.el("pair-code").value, "ABCD-EFGH");
  assert.equal(p.loc.hash, "", "the code is off the address");
  assert.equal(p.el("pair-name").value, "Chrome on macOS");
  assert.equal(p.el("pair-machine").textContent, "Workstation");
  assert.equal(p.doc.title, "Pair with Workstation — Filament");
  assert.equal(p.el("pair-name").focused, true, "a link's code given: the name is next");
  p.loc.hash = "#code=WXYZ-2345";
  p.heard.hashchange();
  assert.equal(p.el("pair-code").value, "WXYZ-2345", "a link opened on the page");
  assert.equal(p.loc.hash, "");
  await p.submit();
  assert.deepEqual(p.posted, [{ code: "WXYZ-2345", name: "Chrome on macOS" }]);
  assert.deepEqual(p.loc.went, ["/ui/harness.html"]);

  const wrong = await pairPage({ claim: { status: 403, body: { error: "no" } } });
  assert.equal(wrong.el("pair-code").focused, true, "no code given: the code first");
  await wrong.submit();
  assert.match(wrong.el("pair-said").textContent, /^Type the code first\./);
  wrong.el("pair-code").value = "AAAA-BBBB";
  await wrong.submit();
  assert.match(wrong.el("pair-said").textContent, /^That code is wrong or has run out\. Make a new one on Workstation/);
  assert.equal(wrong.el("pair-said").err, true);
  assert.equal(wrong.el("pair-go").disabled, false, "it may be tried again");
  assert.deepEqual(wrong.loc.went, []);

  const here = await pairPage({ me: { who: "device", device: { name: "Laptop" } } });
  assert.equal(here.el("pair-form").hidden, true);
  assert.equal(here.el("pair-open").hidden, false);
  assert.equal(here.el("pair-lead").textContent, "This browser is paired with Workstation as Laptop: opening Filament…");
  // (fails before: yes — a paired browser a link from another site sent here was offered a button, not taken on)
  assert.deepEqual(here.loc.went, ["/ui/harness.html"], "a paired browser goes on to Filament");
  const self = await pairPage({ me: { who: "local" } });
  assert.equal(self.el("pair-lead").textContent, "This is Workstation itself: its Filament needs no pairing here.");
  assert.deepEqual(self.loc.went, [], "this computer is offered Open Filament");
  // (fails before: yes — s0b: `filament open`'s link opened here offered Open Filament, the browser riding on being
  // this computer, never paired)
  const opened = await pairPage({ me: { who: "local" }, hash: "#code=WXYZ-2345" });
  assert.equal(opened.el("pair-lead").textContent, "Pairing this browser with Workstation…");
  assert.deepEqual(opened.posted, [{ code: "WXYZ-2345", name: "Chrome on macOS" }], "its link's code claimed at once");
  assert.deepEqual(opened.loc.went, ["/ui/harness.html"]);
  const toConsole = await pairPage({ me: { who: "local" }, hash: "#code=WXYZ-2345&to=console" });
  assert.deepEqual([toConsole.posted.length, toConsole.loc.went], [1, ["/"]], "`filament open console`: the console once paired");
  assert.deepEqual([goesTo("#code=A&to=console"), goesTo("#code=A"), goesTo("")], ["/", "/ui/harness.html", "/ui/harness.html"]);
  // (fails before: yes — your own tailnet login, let in where it is trusted, was told it was the machine itself)
  const tailnet = await pairPage({ me: { who: "tailnet", login: "owner@example.com" } });
  assert.equal(tailnet.el("pair-lead").textContent, "This browser is signed in to Tailscale as owner@example.com, whom Workstation trusts: opening Filament…");
  assert.deepEqual(tailnet.loc.went, ["/ui/harness.html"]);
  // (fails before: yes — s4f: a browser whose pairing lapsed unused met the page as one never paired)
  const lapsed = await pairPage({ refused: { error: "this device went unused here for 60 days…", lapsed: true, days: 60, pair: "/ui/pair.html" } });
  assert.equal(lapsed.el("pair-lead").textContent, "This browser went unused on Workstation for 60 days, so its pairing ran out. Type a new code from Settings › Remote access on that machine to pair it again.");
  assert.equal(lapsed.el("pair-form").hidden, false, "the form stays, to pair again");
  assert.equal((await pairPage()).el("pair-lead").textContent, "", "one never paired: the page's own lead");
});

// (fails before: yes — the harness and the console were served to any browser that reached the port)
test("a browser no one paired that opens the harness or the console is sent to the pairing page; paired, here, or for its files, it is served", async () => {
  const shim = await startApp();
  try {
    const { port } = shim;
    const FAR = { "x-forwarded-for": "100.88.1.2" };
    /** @param {string} path @param {Record<string, string>} [headers] @returns {Promise<{ status: number, location?: string, text: string }>} */
    const get = (path, headers = {}) =>
      new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
          let b = "";
          res.on("data", (d) => (b += d));
          res.on("end", () => resolve({ status: Number(res.statusCode), location: res.headers.location, text: b }));
        });
        req.on("error", reject);
        req.end();
      });
    for (const page of ["/", "/ui", "/ui/", "/ui/harness.html", "/ui/index.html", "/ui//harness.html", "/ui/b/0123456789ab/harness.html", "/ui/b/0123456789ab//harness.html", "/ui/tray-card.html"]) {
      const r = await get(page, FAR);
      assert.deepEqual([r.status, r.location], [302, "/ui/pair.html"], page);
    }
    // (fails before: yes — the review of 35049d31f: the check read the address as written, and the disk served other
    // spellings of the same file.) Where the disk ignores case or a trailing dot (Windows, macOS) these are the harness;
    // elsewhere they are no file: never the page.
    for (const page of ["/ui/Harness.html", "/ui/INDEX.html", "/ui/harness.html.", "/ui/harness.html::$DATA", "/ui/HARNESS.HTML"]) {
      const r = await get(page, FAR);
      assert.ok(r.status === 302 ? r.location === "/ui/pair.html" : r.status === 404, `${page}: ${r.status} ${r.location || ""}`);
    }
    for (const file of ["/ui/harness.css", "/ui/harness/zc.css", "/ui/filament-icon.png", "/ui/Pair.html"])
      assert.ok([200, 404].includes((await get(file, FAR)).status), `${file}: a file pages are built of, or the pairing page`);
    assert.equal((await get("/ui/harness.css", FAR)).status, 200);
    const pairPage = await get("/ui/pair.html", FAR);
    assert.equal(pairPage.status, 200);
    assert.match(pairPage.text, /<script type="module" src="\/ui\/(b\/[0-9a-f]{12}\/)?pair\.js"><\/script>/);
    assert.equal((await get("/ui/pair.js", FAR)).status, 200, "its script, to anyone");
    assert.equal((await get("/ui/harness.html")).status, 200, "this computer");
    const code = (await (await shim.api("/api/remote/pair", { method: "POST", body: { scope: "full" } })).json()).code;
    const claimed = await fetch(`${shim.url}/api/remote/claim`, { method: "POST", headers: { "content-type": "application/json", origin: shim.url, ...FAR }, body: JSON.stringify({ code, name: "Laptop" }) });
    const cookie = String(claimed.headers.get("set-cookie") || "").split(";")[0];
    assert.equal((await get("/ui/harness.html", { ...FAR, cookie })).status, 200, "a paired device");
  } finally {
    await shim.stop();
  }
});

// (fails before: yes — nothing in the app put another machine on its window's rail)
test("in the desktop app, This computer's page adds another machine to its window: Add a machine opens the app's sheet; not in a browser, nor on another machine's page", async () => {
  let asked = 0;
  const app = { addMachine: () => void asked++ };
  const p = await open({ app });
  assert.match(textOf(rowOf(p.body, "Add a machine")), /Pair this window with another machine by a code from its Settings › Remote access\. It then shows in the machines menu at the top/);
  button(rowOf(p.body, "Add a machine"), "Add a machine…").attrs.onclick();
  assert.equal(asked, 1);
  assert.ok(!labels((await open()).body).includes("Add a machine"), "a browser has no app's sheet");
  const far = await open({ app, state: { viewer: "remote", device: { id: "d9", name: "Laptop", scope: "full" } } });
  assert.ok(!labels(far.body).includes("Add a machine"), "another machine's page drives no window of this one's");
});

test("in the desktop app, This computer's page sets a machine up over SSH: its row opens the setup sheet; not where the app makes no setup, nor on another machine's page", async () => {
  /** @type {any[]} */
  const opened = [];
  const app = { addMachine: () => {}, sshSetup: async () => null };
  const p = await open({ app, sshSetup: (/** @type {any} */ o) => opened.push(o) });
  assert.match(textOf(rowOf(p.body, "Set up a machine over SSH")), /A Linux machine you reach with SSH, with no Filament yet: install it there, run it as a service, and pair this window with it, step by step\./);
  button(rowOf(p.body, "Set up a machine over SSH"), "Set up over SSH…").attrs.onclick();
  assert.equal(opened.length, 1);
  assert.equal(typeof opened[0].onToast, "function");
  assert.ok(!labels((await open({ app: { addMachine: () => {} } })).body).includes("Set up a machine over SSH"), "an app that makes no setup offers none");
  const far = await open({ app, state: { viewer: "remote", device: { id: "d9", name: "Laptop", scope: "full" } } });
  assert.ok(!labels(far.body).includes("Set up a machine over SSH"), "another machine's page sets up nothing from this window");
});

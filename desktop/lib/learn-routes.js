// @ts-check
// The ways a machine says it has, learned as this window's device there (the remote desk's s4b): paired once — over the
// tailnet, say —, it is reached at home on its network too, and at its tailnet address, which follow what it says as its
// addresses move. Read where the desk joins its events stream (lib/desk.js), again each `LEARN_MS` while it stands, and
// at once when the desk joins it by another way: its network listener's addresses and certificate (/remote/lan, its
// firewall not read) and its tailnet address (/remote/tailscale), both a full device's to read. Only what reaches this computer over a way that
// proves the machine's own word is taken (`trusted`): the tailnet's, whose certificate an authority signs; an SSH tunnel
// this computer holds; the network's, over the certificate pinned already. A network address is kept pinned to the
// certificate the machine said, and none where its addresses open from that machine alone (WSL's NAT). Only addresses
// of a network of one's own and the tailnet's are learned: a name, or one on the internet, is the person's to add. What
// it no longer says goes (machines.js `setLearnedRoutes`) — but the way it was read by, which just answered as it —; the
// person's ways are never touched. The sign-in at the way it was read by, which just let this window in, is given the
// ways learned first (rail.js `giveSignIn`), before any page or look opens them; where it could not be, none is kept.
// Plain Node (NA-D13).
import { RANKS, isLearned, rankOf, routeOf } from "./machines.js";

/** How often a machine's ways are read again while the desk's events stream of it stands. */
export const LEARN_MS = 10 * 60_000;
/** The most network addresses learned for one machine. */
export const LAN_MOST = 4;
/** How long each read waits: a machine that does not know `?firewall=0` reads its firewall first, by PowerShell on Windows. */
export const READ_MS = 15_000;

/**
 * @typedef {import("./machines.js").Machine} Machine
 * @typedef {import("./machines.js").Route} Route
 * @typedef {{ status: number, json: any } | null} Answer  a read's answer; null where it failed
 */

/**
 * Whether what a way answers is the machine's own word, enough to pin a certificate it names: the tailnet's address
 * (an authority signs its certificate), an SSH tunnel this computer holds, or the network's over its pinned certificate.
 * An address on the internet answers through whoever serves it, and plain http on this computer through whatever holds
 * that port. @param {Route} via
 */
export const trusted = (via) => via.kind === "ssh" || via.kind === "lan" || (via.kind === "url" && rankOf(via) === RANKS.tailnet);

/**
 * Whether a network address the machine said is one of a network of one's own, as its listener lists them
 * (services/lan-tls.js `lanAddresses`): an IPv4 address, private — none of loopback or link-local. @param {Route} r
 */
const homeAddress = (r) => {
  const h = new URL(String(r.url)).hostname;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) && !/^(0|127)\./.test(h) && !h.startsWith("169.254.") && rankOf(r) === RANKS.lan;
};

/**
 * The ways a machine's answers say it has, as learned routes: its network listener's addresses, pinned to its
 * certificate, while it listens and they open from other machines; its tailnet address, where it serves one. `null` for
 * a part whose answer did not come, or that came over a way not `trusted`: what was learned of it stays.
 * @param {Route} via @param {Answer} lan  /remote/lan's @param {Answer} tail  /remote/tailscale's
 * @returns {{ lan: Route[] | null, tailnet: Route[] | null }}
 */
export function waysOf(via, lan, tail) {
  if (!trusted(via)) return { lan: null, tailnet: null };
  /** @type {Route[] | null} */
  let lanWays = null;
  if (lan?.status === 200 && lan.json && typeof lan.json === "object") {
    const j = lan.json;
    const addresses = j.listening && !j.hostOnly && Array.isArray(j.addresses) ? j.addresses : [];
    lanWays = [];
    for (const url of addresses) {
      const r = routeOf({ kind: "lan", url, fingerprint: j.fingerprint, learned: true });
      if (r && homeAddress(r) && !lanWays.some((x) => x.url === r.url)) lanWays.push(r);
      if (lanWays.length >= LAN_MOST) break;
    }
  }
  /** @type {Route[] | null} */
  let tailWays = null;
  if (tail?.status === 200 && tail.json && typeof tail.json === "object") {
    const r = typeof tail.json.address === "string" ? routeOf({ kind: "url", url: tail.json.address, learned: true }) : null;
    tailWays = r && String(r.url).startsWith("https:") && rankOf(r) === RANKS.tailnet ? [r] : [];
  }
  return { lan: lanWays, tailnet: tailWays };
}

/**
 * @param {{ machines: () => Machine[], keep: (id: string, routes: Route[]) => { machine: Machine, changed: boolean } | null,
 *   giveSignIn?: (partition: string, url: string, routes: Route[]) => Promise<unknown>, changed?: (m: Machine) => void, now?: () => number, log?: (line: string) => void }} o
 *   `machines`: the machines the window keeps, read now; `keep`: its learned ways kept (machines.js `setLearnedRoutes`);
 *   `giveSignIn`: the sign-in its partition holds at `url` given those ways (rail.js `giveSignIn`); `changed`: told once
 *   its ways changed
 */
export function createRouteLearner({ machines, keep, giveSignIn = async () => {}, changed = () => {}, now = Date.now, log = () => {} }) {
  /** Each machine's last read: when, and by which way. @type {Map<string, { at: number, via: string }>} */
  const last = new Map();
  /** @type {Set<string>} */
  const reading = new Set();
  return {
    /**
     * A machine's ways read where `r` reached it — as this window's full device, over a `trusted` way —, and kept: at
     * most once each `LEARN_MS` by one way, at once by another. → whether its ways changed.
     * @param {Machine} m @param {import("./reach.js").Reached} r
     */
    async learn(m, r) {
      const via = String(r.origin);
      const was = last.get(m.id);
      if (r.who !== "device" || !trusted(r.route) || reading.has(m.id) || (was && was.via === via && now() - was.at < LEARN_MS)) return false;
      reading.add(m.id);
      last.set(m.id, { at: now(), via });
      try {
        const read = (/** @type {string} */ path) => r.send(path, { ms: READ_MS }).catch(() => null);
        const [lan, tail] = await Promise.all([read("/remote/lan?firewall=0"), read("/remote/tailscale")]);
        const ways = waysOf(r.route, lan, tail);
        if (!ways.lan && !ways.tailnet) return false;
        const kept = machines().find((x) => x.id === m.id && !x.local && !x.off);
        if (!kept) return false;
        const own = kept.routes.filter((x) => !isLearned(x));
        const before = kept.routes.filter(isLearned);
        const said = [...(ways.lan ?? before.filter((x) => x.kind === "lan")), ...(ways.tailnet ?? before.filter((x) => x.kind === "url"))];
        // The way it was read by stays, said or not: it answered as the machine just now (a tailnet served anew says no address a moment).
        const by = before.find((x) => x.url === r.route.url);
        const next = [...said, ...(by && !said.some((x) => x.url === by.url) ? [by] : [])].filter((x) => !own.some((o) => o.url === x.url));
        // The sign-in first: a way kept is one a page or a look may open at once. One not given, none kept.
        try {
          await giveSignIn(kept.partition, via, next);
        } catch (/** @type {any} */ e) {
          log(`learn: machine ${m.id}'s ways not kept: its sign-in was not given them (${String(e?.message || e)})`);
          return false;
        }
        const got = keep(m.id, next);
        if (!got?.changed) return false;
        log(`learn: machine ${m.id}'s learned ways: ${got.machine.routes.filter(isLearned).map((x) => x.url).join(", ") || "none"}`);
        changed(got.machine);
        return true;
      } catch (/** @type {any} */ e) {
        log(`learn: machine ${m.id}'s ways not kept (${String(e?.message || e)})`);
        return false;
      } finally {
        reading.delete(m.id);
      }
    },
  };
}

// @ts-check
// Another machine the window keeps, reached as this window's sign-in there: Settings › Remote access's switch, the
// new-chat menu's part per machine and the desk (the remote desk of 11-22) each reach it here. Its way is the first where
// the machine's own id answers, its certificate pinned on the network (`pickRoute`, watch.js `routeFetch`); each call
// sends the cookie its partition holds (lib/rail.js's pairing put it there), and /remote/me says who the machine takes
// this window for. The page hears what came of it alone, never a token. Plain Node (NA-D13).
import { pickRoute } from "./machines.js";
import { deskFlagsOf, keepSentSignIn, routeFetch } from "./watch.js";
import { bodyText } from "../../src/services/machines/client.js";

/** How long one call to the machine waits, unless its caller says otherwise. */
export const CALL_MS = 5000;
/**
 * The most one answer of the machine's is read, in bytes: its device list, the largest Settings asks, is a few kilobytes,
 * and a desk's list of 200 chats about a hundred, where whatever answers at its address that means harm would send on
 * without end.
 */
export const ANSWER_MAX = 1024 * 1024;

/**
 * What a sign-in there leads to, by who reaches the machine: Settings' switch, which a full device moves — over the
 * network, or through an SSH tunnel, where its token says it (Add pairs one there over SSH); the new-chat menu, which
 * reads its projects as a full device, by the person's tailnet login, or through a tunnel where none is paired, the
 * machine taking this computer for itself — as its page in the rail would; and the desk, which reaches it as the menu
 * does — its presses refused there but as a full device (lib/desk.js).
 */
export const FOR = Object.freeze({
  switch: { then: "this switch moves", full: "a full device lets this Filament's agents in", tailnet: false, tunnel: false },
  picker: { then: "its projects show here", full: "a full device starts chats there", tailnet: true, tunnel: true },
  desk: { then: "its chats can be worked from here", full: "a full device works its chats from here", tailnet: true, tunnel: true },
});

/**
 * @typedef {import("./machines.js").Machine} Machine
 * @typedef {import("./machines.js").Route} Route
 * @typedef {typeof FOR.switch} For
 * @typedef {{ method?: string, body?: any, headers?: Record<string, string> }} CallInit
 * @typedef {(path: string, init?: CallInit & { ms?: number }) => Promise<{ status: number, json: any }>} Send
 *   a call of its admin API: the answer's status and JSON, read whole up to `ANSWER_MAX`; a way that does not answer, or
 *   past `ms` (`CALL_MS`), thrown
 * @typedef {(path: string, init?: CallInit & { signal?: AbortSignal }) => Promise<Response>} Open
 *   the same call, its answer as it comes — a stream's — for its caller to read and let go; `signal` its end (else `CALL_MS`)
 * @typedef {{ send: Send, open: Open, route: Route, origin: string, me: any, flags: string[], who: string }} Reached
 *   `who`: who the machine takes this window for — "device", "tailnet" (the person's tailnet login), or "local" (through a
 *   tunnel where no device is paired, this computer for itself); `flags`: what its Filament does for the desk (watch.js `deskFlagsOf`)
 * @typedef {{ words: string, away?: "off" | "quiet", update?: true }} Unreached
 *   what stands in the way, in words; `away` where that is the machine itself, not this window's sign-in there —
 *   disconnected in this window (`off`), or no way to it answers (`quiet`); `update` where it answers on a wire this
 *   app does not speak, its words saying which side to update
 */

/** How long a device went unused before its pairing ran out, as the machine's refusal says it (`days`). @param {any} j */
export const unusedFor = (j) => (Number.isInteger(j?.days) && j.days > 0 ? `for ${j.days} days` : "too long");

/**
 * @param {{ cookieOf: (partition: string, origin: string) => Promise<string>, keepSignIn?: import("./watch.js").KeepSignIn, pick?: typeof pickRoute, fetchOf?: (route: Route) => typeof fetch }} o
 *   `cookieOf`: the Cookie header the machine's partition sends that origin; `keepSignIn`: the sign-in an answer sent
 *   again, kept there (watch.js `storeSignIn`)
 * @returns {(m: Machine, f?: For) => Promise<Reached | Unreached>}
 */
export function createReach({ cookieOf, keepSignIn = async () => {}, pick = pickRoute, fetchOf = routeFetch }) {
  /**
   * The machine reached as this window's full device there — or, where `f` takes them, by the person's tailnet login or
   * through a tunnel —; else what stands in the way.
   * @param {Machine} m @param {For} [f]  who reaches it: Settings' switch, the new-chat menu, or the desk
   */
  return async function reach(m, f = FOR.switch) {
    /** @param {string} words @param {"off" | "quiet"} [away] @returns {Unreached} */
    const stop = (words, away) => ({ words, ...(away ? { away } : {}) });
    if (m.off) return stop(`${m.name} is disconnected in this window: connect it again from the machines list, and ${f.then}.`, "off");
    /** Whether this window's partition holds a sign-in at a way's address. @param {Route} r */
    const signedAt = async (r) => {
      try {
        return !!(await cookieOf(m.partition, new URL(String(r.url)).origin));
      } catch {
        return false;
      }
    };
    // Where a tunnel's machine is taken as this computer itself no more (Settings' switch), a tunnel holding no sign-in
    // of this window's is passed over while another way is kept: there it would answer as no device.
    const held = f.tunnel ? [] : await Promise.all(m.routes.map((r) => (r.kind === "ssh" ? signedAt(r) : true)));
    const ways = f.tunnel ? m.routes : m.routes.filter((_, i) => held[i]);
    const picked = await pick(ways.length ? { ...m, routes: ways } : m).catch((/** @type {any} */ e) => ({ route: null, tried: [{ why: String(e?.message || e) }] }));
    // One that answers on a wire this app does not speak says which side to update, in its own words (machines.js `gapWords`).
    if (!picked.route) {
      if (/** @type {any} */ (picked).update) return { ...stop(String(picked.tried.at(-1)?.why), "quiet"), update: true };
      return stop(`${m.name} does not answer: ${picked.tried.at(-1)?.why ?? "no way to it answers"}.`, "quiet");
    }
    const route = picked.route;
    const origin = new URL(String(route.url)).origin;
    /** @type {Open} */
    const open = async (path, init = {}) => {
      const cookie = await cookieOf(m.partition, origin).catch(() => "");
      // The caller's heads first: the sign-in and the page's mark are this module's, never a caller's.
      const r = await fetchOf(route)(`${origin}/api${path}`, {
        method: init.method || "GET",
        headers: { ...(init.headers || {}), "x-filament-ui": "1", ...(cookie ? { cookie } : {}), ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        redirect: "manual",
        signal: init.signal ?? AbortSignal.timeout(CALL_MS),
      });
      keepSentSignIn(r, m.partition, origin, keepSignIn);
      return r;
    };
    /** @type {Send} */
    const send = async (path, init = {}) => {
      const { ms = CALL_MS, ...rest } = init;
      const r = await open(path, { ...rest, signal: AbortSignal.timeout(ms) });
      // Past ANSWER_MAX it is read no further, and the call fails in words.
      const text = await bodyText(r, ANSWER_MAX, "it", `${init.method || "GET"} ${path}`);
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: r.status, json };
    };
    /** @type {{ status: number, json: any }} */
    let me;
    try {
      me = await send("/remote/me");
    } catch (/** @type {any} */ e) {
      return stop(`${m.name} did not answer: ${e?.message || e}.`, "quiet");
    }
    const gone = `This app's sign-in on ${m.name} is gone — revoked there, or signed out: pair it again with Add a machine and a code from its Settings › Remote access.`;
    // One that went unused there past its days is refused so, and how many it says (services/devices.js UNUSED_DAYS): it pairs again.
    if (me.status === 403 && me.json?.lapsed === true)
      return stop(`This app's sign-in on ${m.name} ran out: it went unused there ${unusedFor(me.json)}. Pair it again with Add a machine and a code from its Settings › Remote access.`);
    if (me.status === 401 || me.status === 403) return stop(gone);
    if (me.status !== 200) return stop(`${m.name} answered ${String(me.json?.error || `HTTP ${me.status}`)}.`);
    const who = String(me.json?.who ?? "");
    const flags = deskFlagsOf(me.json);
    // Through a tunnel — the app's SSH route, or an address the person forwarded — where no device is paired, the machine
    // takes this computer for itself: the menu and the desk read there as its page in the rail does.
    if ((who === "tailnet" && f.tailnet) || (who === "local" && f.tunnel)) return { send, open, route, origin, me: me.json, flags, who };
    // A Filament there that takes any caller on loopback for this computer itself reads no device's token through a tunnel.
    if (who === "local" && !flags.includes("tunnel-device")) return stop(`Filament on ${m.name} takes this app through a tunnel for its own computer, never as a paired device: update it there (its ⋯ in the machines list), and ${f.then}.`);
    // A sign-in held at the tunnel's address that it no longer knows: revoked there, or signed out.
    if (who === "local" && (await signedAt(route))) return stop(gone);
    if (who === "local")
      return stop(`This app reaches ${m.name} through a tunnel where it is no paired device: remove it from the machines list and add it again by its ssh:// address — Pair makes a code there over SSH; where the Filament app runs there, by the link its Settings › Remote access shows —, and ${f.then}.`);
    if (who === "tailnet") return stop(`This app reaches ${m.name} by your tailnet login, not as a paired device: pair it with a code from its Settings › Remote access, and ${f.then}.`);
    if (who !== "device") return stop(gone);
    if (me.json?.device?.scope !== "full") return stop(`This app is paired with ${m.name} view-only: ${f.full}. Pair it again as Full with Add a machine.`);
    return { send, open, route, origin, me: me.json, flags, who };
  };
}

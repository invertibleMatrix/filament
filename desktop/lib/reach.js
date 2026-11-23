// @ts-check
// Another machine the window keeps, reached as this window's sign-in there: Settings › Remote access's switch, the
// new-chat menu's part per machine and the desk (the remote desk of 11-22) each reach it here. Its way is the first where
// the machine's own id answers, its certificate pinned on the network (`pickRoute`, watch.js `routeFetch`); each call
// sends the cookie its partition holds (lib/rail.js's pairing put it there), and /remote/me says who the machine takes
// this window for. The page hears what came of it alone, never a token. Plain Node (NA-D13).
import { pickRoute } from "./machines.js";
import { deskFlagsOf, routeFetch } from "./watch.js";
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
 * What a sign-in there leads to, by who reaches the machine: Settings' switch, which a full device moves over the network
 * alone; the new-chat menu, which reads its projects as a full device, by the person's tailnet login, or through an SSH
 * tunnel, where the machine takes this computer for itself — as its page in the rail would; and the desk, which reaches
 * it as the menu does — its presses refused there but as a full device (lib/desk.js).
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
 *   tunnel, this computer for itself); `flags`: what its Filament does for the desk (watch.js `deskFlagsOf`)
 * @typedef {{ words: string, away?: "off" | "quiet" }} Unreached
 *   what stands in the way, in words; `away` where that is the machine itself, not this window's sign-in there —
 *   disconnected in this window (`off`), or no way to it answers (`quiet`)
 */

/**
 * @param {{ cookieOf: (partition: string, origin: string) => Promise<string>, pick?: typeof pickRoute, fetchOf?: (route: Route) => typeof fetch }} o
 *   `cookieOf`: the Cookie header the machine's partition sends that origin
 * @returns {(m: Machine, f?: For) => Promise<Reached | Unreached>}
 */
export function createReach({ cookieOf, pick = pickRoute, fetchOf = routeFetch }) {
  /**
   * The machine reached as this window's full device there — or, where `f` takes them, by the person's tailnet login or
   * through a tunnel —; else what stands in the way.
   * @param {Machine} m @param {For} [f]  who reaches it: Settings' switch, the new-chat menu, or the desk
   */
  return async function reach(m, f = FOR.switch) {
    /** @param {string} words @param {"off" | "quiet"} [away] @returns {Unreached} */
    const stop = (words, away) => ({ words, ...(away ? { away } : {}) });
    if (m.off) return stop(`${m.name} is disconnected in this window: connect it again from the machines list, and ${f.then}.`, "off");
    const ways = f.tunnel ? m.routes : m.routes.filter((r) => String(r.url ?? "").startsWith("https:"));
    if (!ways.length) return stop(`This app reaches ${m.name} through an SSH tunnel alone, where it is no paired device: turn on Reach this machine on my network or Share on my tailnet there, and add it again by the link it shows.`);
    const picked = await pick({ ...m, routes: ways }).catch((/** @type {any} */ e) => ({ route: null, tried: [{ why: String(e?.message || e) }] }));
    // One that answers on a wire this app does not speak says which side to update, in its own words (machines.js `gapWords`).
    if (!picked.route) return stop(/** @type {any} */ (picked).update ? String(picked.tried.at(-1)?.why) : `${m.name} does not answer: ${picked.tried.at(-1)?.why ?? "no way to it answers"}.`, "quiet");
    const route = picked.route;
    const origin = new URL(String(route.url)).origin;
    /** @type {Open} */
    const open = async (path, init = {}) => {
      const cookie = await cookieOf(m.partition, origin).catch(() => "");
      // The caller's heads first: the sign-in and the page's mark are this module's, never a caller's.
      return fetchOf(route)(`${origin}/api${path}`, {
        method: init.method || "GET",
        headers: { ...(init.headers || {}), "x-filament-ui": "1", ...(cookie ? { cookie } : {}), ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        redirect: "manual",
        signal: init.signal ?? AbortSignal.timeout(CALL_MS),
      });
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
    if (me.status === 401 || me.status === 403) return stop(gone);
    if (me.status !== 200) return stop(`${m.name} answered ${String(me.json?.error || `HTTP ${me.status}`)}.`);
    const who = String(me.json?.who ?? "");
    const flags = deskFlagsOf(me.json);
    // Through a tunnel — the app's SSH route, or an address the person forwarded — the machine takes this computer for
    // itself: the menu and the desk read there as its page in the rail does.
    if ((who === "tailnet" && f.tailnet) || (who === "local" && f.tunnel)) return { send, open, route, origin, me: me.json, flags, who };
    if (who === "tailnet") return stop(`This app reaches ${m.name} by your tailnet login, not as a paired device: pair it with a code from its Settings › Remote access, and ${f.then}.`);
    if (who !== "device") return stop(gone);
    if (me.json?.device?.scope !== "full") return stop(`This app is paired with ${m.name} view-only: ${f.full}. Pair it again as Full with Add a machine.`);
    return { send, open, route, origin, me: me.json, flags, who };
  };
}

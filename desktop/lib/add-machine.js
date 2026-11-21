// @ts-check
// Adding a machine to the window (the owner's remote Filament of 11-06, Part 3): what the window's Add sheet asks before
// anything goes to the machine, and the claim that pairs this window with it. `checkMachine` reads the address or the
// link Settings › Remote access shows there (cli/remotes.js `pairingOf`): plain http goes to this machine alone (an SSH
// tunnel's localhost), and an address typed with no scheme for another machine is the network listener's https; its
// certificate is the link's fingerprint, or one an authority signed (tailscale serve's), or else the one it serves read
// and said for the person to compare with the one that machine shows — nothing is sent before they say it is the same;
// then the machine says who it is (/.well-known/filament) over that certificate alone. `ssh://<alias>` — Filament's port
// there after a colon — is reached through a tunnel this computer holds (ssh-route.js): who answers through it is asked
// the same, and no code is claimed — ssh's own sign-in let this computer in, and its Filament sees a caller on its own
// loopback. The claim itself is made from
// a page of that machine in the machine's own view (lib/rail.js), so the cookie it answers lands in the machine's
// partition and nowhere else, as a browser's does: `claimScript` is what that page runs, `claimOutcome` reads its answer.
// Plain Node (NA-D13).
import { computerName } from "../../src/services/machine.js";
import { certRefused, machineAt, onThisMachine, pairingOf, plainWords } from "../../src/cli/remotes.js";
import { certificateAt, pinnedFetch } from "../../src/cli/pinned.js";
import { claimWords } from "../../src/ui/pair.js";
import { printOf } from "../../src/core/x509.js";
import { FILAMENT_PORT, sshAsked } from "./ssh-route.js";

/** The page of a machine the claim is made from: its own address, no script of its own, no policy against a fetch home. */
export const CLAIM_FROM = "/.well-known/filament";

/**
 * @typedef {import("./machines.js").Route} Route
 * @typedef {{ link: string, code?: string, fingerprint?: string }} AddInput  `fingerprint`: the one the person said is the same
 * @typedef {{ ok: true, url: string, code: string, fingerprint: string, route: Route, machine: { id: string, name: string, version: string }, ssh?: string }} Checked
 *   `ssh`: the alias a tunnel reaches it through — no code to claim
 * @typedef {{ ok: false, words: string, ask?: "fingerprint", url?: string, seen?: string }} Refused  `ask`: the fingerprint `seen` is for the person to compare
 */

/**
 * The address typed, as an address: one with no scheme is https for another machine — the network listener's — and
 * plain http for this one (an SSH tunnel's localhost).
 * @param {string} text
 */
export function addressOf(text) {
  const s = String(text || "").trim();
  if (!s || /^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  try {
    return onThisMachine(`http://${s}`) ? `http://${s}` : `https://${s}`;
  } catch {
    return s;
  }
}

/**
 * Who answers at the address the person gave, and the way there to keep — before any code or cookie goes to it.
 * `ssh`: this computer's tunnels (ssh-route.js `createTunnels`), for an `ssh://` address.
 * @param {AddInput} input
 * @param {{ fetchImpl?: typeof fetch, certificate?: (url: string) => Promise<string>, pinned?: (pin: string) => typeof fetch,
 *   ssh?: { routeFor: (alias: string, port: number) => Promise<import("./ssh-route.js").SshRoute>, hold: (route: any, o?: { fresh?: boolean }) => Promise<string | null> } }} [o]
 * @returns {Promise<Checked | Refused>}
 */
export async function checkMachine(input, { fetchImpl = fetch, certificate = certificateAt, pinned = pinnedFetch, ssh } = {}) {
  const asked = sshAsked(String(input?.link ?? ""));
  if (asked && "words" in asked) return { ok: false, words: asked.words };
  if (asked) {
    if (!ssh) return { ok: false, words: "This window holds no SSH tunnel: add the machine from Filament's app." };
    const route = await ssh.routeFor(asked.alias, asked.port);
    // A person asks: what failed a moment ago — a host key accepted since — is tried again.
    const why = await ssh.hold(route, { fresh: true });
    if (why) return { ok: false, words: why };
    try {
      const machine = await machineAt(route.url, { fetchImpl });
      return { ok: true, url: route.url, code: "", fingerprint: "", route, machine, ssh: route.alias };
    } catch {
      const ours = asked.port === FILAMENT_PORT ? "" : " The port after the colon is Filament's on that machine — SSH's own is your SSH config's.";
      return { ok: false, words: `The tunnel to ${asked.alias} is up, but no Filament answers at port ${asked.port} there: is it running, on that port?${ours}` };
    }
  }
  /** @type {{ url: string, code: string, fingerprint: string }} */
  let p;
  try {
    p = pairingOf(addressOf(input?.link), String(input?.code || ""));
  } catch (/** @type {any} */ e) {
    return { ok: false, words: String(e?.message || e) };
  }
  const { url, code } = p;
  if (url.startsWith("http:") && !onThisMachine(url)) return { ok: false, words: plainWords(url) };
  let pin = url.startsWith("https:") ? printOf(input?.fingerprint || p.fingerprint) : "";
  if (pin.length !== 95) pin = "";
  if (url.startsWith("https:") && !pin) {
    // A certificate an authority signed (tailscale serve's) is checked as any https site's, and needs no pin; the network
    // listener's own, which none signed, is said for the person to compare, and nothing is sent until they have.
    try {
      await fetchImpl(`${url}/.well-known/filament`, { signal: AbortSignal.timeout(5000) });
    } catch (/** @type {any} */ e) {
      if (!certRefused(e)) return { ok: false, words: `No Filament answers at ${url}: is the machine on, Filament running there, and its address one this computer reaches? (${e?.message || e})` };
      try {
        const seen = await certificate(url);
        return { ok: false, ask: "fingerprint", url, seen, words: `The certificate at ${url} has this SHA-256 fingerprint. Does Settings › Remote access on that machine show the same?` };
      } catch (/** @type {any} */ e2) {
        return { ok: false, words: `No Filament answers at ${url}: is the machine on, and Reach this machine on my network turned on there? (${e2?.message || e2})` };
      }
    }
  }
  // Another certificate than the pinned one ends the ask before a byte is sent: said in the sheet's words, not the
  // command line's.
  let wrong = false;
  const via = pin ? pinned(pin) : fetchImpl;
  const asking = /** @type {typeof fetch} */ (
    async (/** @type {any} */ u, /** @type {any} */ init) => {
      try {
        return await via(u, init);
      } catch (/** @type {any} */ e) {
        for (let x = e, n = 0; x && n < 5; x = x.cause, n++) if (x.code === "FILAMENT_PIN") wrong = true;
        throw e;
      }
    }
  );
  try {
    const machine = await machineAt(url, { fetchImpl: asking });
    /** @type {Route} */
    const route = pin ? { kind: "lan", url, fingerprint: pin } : { kind: "url", url };
    return { ok: true, url, code, fingerprint: pin, route, machine };
  } catch (/** @type {any} */ e) {
    if (wrong)
      return { ok: false, words: `Another certificate answered at ${url} than the one ${input?.fingerprint ? "you compared" : "its link names"}: nothing was sent. Something else answers at that address — or that machine's certificate was made anew: paste the link its Settings › Remote access shows now.` };
    return { ok: false, words: String(e?.message || e) };
  }
}

/** The name this window is paired by on the other machine, which its Settings › Remote access lists. */
export const deviceNameHere = (host = computerName()) => `Filament app on ${host}`.slice(0, 64);

/**
 * What a page of the machine runs to claim the code — its own fetch home, its Origin its own, so the answer is a cookie
 * for its partition, never a token: the status and the answer's JSON. `again`: a machine paired already signs this
 * window's old device out there first, so pairing again leaves no second sign-in standing (the review of p3-add); a
 * sign-out refused — that device revoked already — is no reason not to claim. `machine`: this computer's own Filament's
 * id, by which that machine's Settings › Remote access shows this window's device and this computer's agents' with it.
 * @param {string} code @param {string} name @param {{ again?: boolean, machine?: string | null }} [o]
 */
export const claimScript = (code, name, { again = false, machine = null } = {}) => {
  const claim = `fetch("/api/remote/claim",{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:${JSON.stringify(JSON.stringify({ code: String(code), name: String(name), ...(machine ? { machine: String(machine) } : {}) }))}})`;
  // A write of a page's says it is JSON, or the server answers 415 (admin/index.js): the drive of p3-add.
  const first = again ? `fetch("/api/remote/sign-out",{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:"{}"}).catch(()=>null).then(()=>${claim})` : claim;
  return `${first}.then(async(r)=>({status:r.status,body:await r.json().catch(()=>null)}))`;
};

/**
 * The claim's answer, read: paired with the machine that said who it was, or the words of its refusal.
 * @param {any} got  `claimScript`'s value @param {{ id: string, name: string }} machine
 * @returns {{ ok: true } | { ok: false, words: string }}
 */
export function claimOutcome(got, machine) {
  const status = Number(got?.status) || 0;
  const body = got?.body ?? null;
  if (status === 200) {
    const said = String(body?.machine?.id || "").toLowerCase();
    if (said && said !== machine.id.toLowerCase()) return { ok: false, words: `Another machine answered the claim (${said}), not ${machine.name}: nothing was kept.` };
    return { ok: true };
  }
  if (!status) return { ok: false, words: `Not paired: ${machine.name} did not answer the claim.` };
  return { ok: false, words: claimWords(status, body, machine.name) };
}

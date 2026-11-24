// @ts-check
// This Filament's own store of the machines it is paired with as a device (the remote-agents plan's f-store), for the
// work it sends to another machine — a sub-agent launched there, a command run there — which reports back. The store is
// the command line's remotes.json (remotes.js): a machine `filament connect` connected is this Filament's too, and one
// connected here is the command line's. Each call reads the file anew, so what either writes the other sees. A
// machine's token never leaves it: `list` and `find` say each machine without it, and `clientOf` gives a client of that
// machine's admin API that sends it on each call — over https pinned to the machine's certificate, once the machine at
// the address says it is the one paired.
import { connectRemote, connectTo, disconnect, keepRemote, modelsWayOf, readRemotes, remoteNamed, withoutToken } from "./remotes.js";

/** @typedef {import("./remotes.js").Machine} Machine */
/**
 * A machine as a caller names it: its name (any case), its machine's id or its address — or the machine itself, as the
 * store said it, which is named by its id.
 * @typedef {string | Machine} Which
 */

/**
 * A machine is kept once for the person — `filament connect`'s device — and once for this Filament's agents — the
 * device the desktop app minted there —, side by side: a name says the person's, `{ agents: true }` the agents', and a
 * machine the store said is its own kind.
 * @param {{ dataDir: string }} o  the data folder whose remotes.json and secret.key these are
 */
export function createMachines({ dataDir }) {
  /** @param {Which} which */
  const named = (which) => (typeof which === "string" ? which : which.machine.id);
  /** @param {Which} which @param {{ agents?: boolean }} o */
  const agentsOf = (which, o) => o.agents ?? (typeof which !== "string" && which.device.scope === "agent");
  return {
    /** The machines connected, the person's and the agents' devices alike, their tokens aside. @returns {Machine[]} */
    list: () => readRemotes(dataDir).map(withoutToken),
    /**
     * The machine `which` names, or null where it names none. A name two machines share throws, in the words that say
     * each by its id and its address (remotes.js `remoteNamed`): null would say there is no such machine.
     * @param {Which} which @param {{ agents?: boolean }} [o] @returns {Machine | null}
     */
    find(which, o = {}) {
      try {
        return withoutToken(remoteNamed(dataDir, named(which), { agents: agentsOf(which, o) }));
      } catch (/** @type {any} */ e) {
        if (e?.several) throw e;
        return null;
      }
    },
    /**
     * Connect to the Filament a pairing's link names (remotes.js `connectTo`): its code claimed, this data folder a
     * device there — named `name`, else for this machine — and its token kept, sealed. Connected to it already, the
     * device it had signs out there.
     * @param {string} link @param {{ code?: string, name?: string, fingerprint?: string }} [o]
     * @returns {Promise<Machine>}
     */
    connect: async (link, o = {}) => withoutToken(await connectTo(dataDir, link, o)),
    /**
     * Keep a machine with a token it handed out, no code claimed (remotes.js `keepRemote`): the agents' device the
     * desktop app minted there with its own sign-in (the remote-agents plan's f-ui), its token sealed. Kept beside the
     * person's device for that machine; one of its own kind kept before is let go here.
     * @param {Parameters<typeof keepRemote>[1]} given @returns {Machine}
     */
    keep: (given) => withoutToken(keepRemote(dataDir, given)),
    /**
     * Forget a machine: this device signs out there, then the store lets it go. One that does not answer goes all the
     * same, and `why` says what stopped the sign-out: the device stays listed there until it is revoked. An agents'
     * device is asked nothing — it signs nothing out there —: the device that minted it revokes it.
     * @param {Which} which @param {{ agents?: boolean }} [o] @returns {Promise<{ machine: Machine, signedOut: boolean, why: string | null }>}
     */
    async forget(which, o = {}) {
      const gone = await disconnect(dataDir, named(which), { agents: agentsOf(which, o) });
      return { machine: withoutToken(gone.remote), signedOut: gone.signedOut, why: gone.why };
    },
    /**
     * A client of the machine's admin API as this device (remotes.js `connectRemote`): get, post, patch, del and an SSE
     * `stream`, its token on each call, at the first of its ways that answers as it; else a CliError whose words say why
     * — none named so, another machine at its address, its certificate another than the one pinned, none of its ways
     * answering, the device revoked there.
     * @param {Which} which @param {{ signal?: AbortSignal, timeoutMs?: number, agents?: boolean }} [o]
     */
    clientOf: (which, o = {}) => connectRemote(dataDir, named(which), { ...o, agents: agentsOf(which, o) }),
    /**
     * The way to the machine's models (remotes.js `modelsWayOf`, the remote-agents plan's m-upstream): its address, a
     * fetch pinned to its certificate, and the headers that carry this device's token — for a model call, never kept.
     * @param {Which} which @param {{ agents?: boolean, connectMs?: number }} [o]
     */
    modelsWay: (which, o = {}) => modelsWayOf(dataDir, named(which), { connectMs: o.connectMs, agents: agentsOf(which, o) }),
  };
}

/** @typedef {ReturnType<typeof createMachines>} Machines */

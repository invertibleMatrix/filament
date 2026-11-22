// @ts-check
// This Filament's agents on the window's other machines (the remote-agents plan's f-ui): Settings › Remote access's one
// switch a machine, "Let this Filament's agents work on <machine>", and under it, once their device is kept, "Use
// <machine>'s models in this Filament's chats" (the remote-agents plan's m-ui). Every call is made here, in Electron
// main, as the
// machine's own sign-in — the cookie its partition holds (lib/rail.js's pairing put it there) — over a way where the
// machine's own id answers, its certificate pinned on the network (`pickRoute`, watch.js `routeFetch`); the page hears
// the outcome alone, never a token. On: the machine mints this Filament's agents a device (POST /remote/agent-device, a
// full device's to ask), its token kept in this Filament's machine store, sealed (services/machines `keep`), and its
// grant `agents` switched on there. Off: switched off there, the token kept, so on again mints nothing. Its models: the
// same device's grant `models` switched there, which the machine's door reads before it lends one (the page adds or
// removes this Filament's upstream of that machine's models, its own config's). Full control: the same device's grant
// `full` switched there, on top of `agents`: its agents act there as the person (services/devices.js `fullControl`).
// Forget: the device revoked there, the token let go here. What the page shows is read there: the device list says the grants as they stand. Only an https
// way is taken: through an SSH tunnel the machine takes this computer for itself, no device there. The new-chat menu's
// part per machine (pk-list) reads its projects the same way, as a full device or by the person's tailnet login. The
// machine is reached as lib/reach.js reaches it. Plain Node (NA-D13).
import { pickRoute } from "./machines.js";
import { routeFetch } from "./watch.js";
import { FOR, createReach } from "./reach.js";

/**
 * One machine as the page shows it. `on`: this Filament's agents may work there — their device's token kept here, its
 * grant on there; `models`: that device's grant `models` is on there — the machine lends this Filament its models;
 * `full`: its grant `full` is on there — this Filament's agents act there as the person (Full control); `kept`: a token is kept here (Forget); `ready`: the switches move — the machine answered, and this window is a full
 * device there; `words`: what stands in the way, or what is so; `away`: where that is the machine itself, not this
 * window's sign-in there — disconnected in this window (`off`), or no way to it answers (`quiet`); `said`, an outcome
 * to tell once — `failed` where it went wrong.
 * @typedef {{ id: string, name: string, on: boolean, models: boolean, full: boolean, kept: boolean, ready: boolean, words: string | null, away?: "off" | "quiet", said?: string, failed?: true }} AgentsRow
 * One machine in the new-chat menu (pk-list): its projects, newest first; null where they could not be read, `words`
 * saying why.
 * @typedef {{ id: string, name: string, projects: { cwd: string, name: string }[] | null, words: string | null }} ProjectsRow
 * @typedef {import("./machines.js").Machine} Machine
 * @typedef {import("./machines.js").Route} Route
 * @typedef {Pick<import("../../src/services/machines/index.js").Machines, "list" | "keep" | "forget">} Store
 * @typedef {import("./reach.js").Send} Send
 */

/**
 * The most projects one machine lists in the new-chat menu, newest first; the longest name or why it says, cut; the
 * longest folder, past which a project is left out — a folder cut would open a chat in another.
 */
const PROJECTS_MAX = 50;
const WORDS_MAX = 400;

/** Words said whole up to `WORDS_MAX`, cut past it. @param {unknown} w */
const capped = (w) => {
  const s = String(w ?? "");
  return s.length > WORDS_MAX ? `${s.slice(0, WORDS_MAX - 1)}…` : s;
};

/** A refusal's words, as the machine said it. @param {{ status: number, json: any }} r */
const refusal = (r) => String(r.json?.error || `HTTP ${r.status}`);
/**
 * A grant asked of a device that machine no longer has standing: gone (404), or revoked, whose grants it sets no more
 * (409, http/admin/remote.js). @param {{ status: number }} r
 */
const gone = (r) => r.status === 404 || r.status === 409;

/**
 * @param {{ machines: () => Machine[], cookieOf: (partition: string, origin: string) => Promise<string>, store: Store,
 *   pick?: typeof pickRoute, fetchOf?: (route: Route) => typeof fetch, log?: (line: string) => void, ownName?: () => string }} o
 *   `machines`: the machines the window keeps, read now; `cookieOf`: the Cookie header the machine's partition sends that
 *   origin; `store`: this Filament's machine store (services/machines `createMachines`); `ownName`: this machine's name, as
 *   its Settings › Remote access › This machine says it — the machine's chats from this Filament's agents are said to be
 *   from it, not from the app's device there ("Filament app on DESKTOP-1")
 */
export function createMachineAgents({ machines, cookieOf, store, pick = pickRoute, fetchOf = routeFetch, log = () => {}, ownName = () => "" }) {
  /** @param {Machine} m @param {Partial<AgentsRow>} o @returns {AgentsRow} */
  const rowOf = (m, o) => ({ id: m.id, name: m.name, on: false, models: false, full: false, kept: false, ready: false, words: null, ...o });
  /** The agents' device kept here for a machine, or null: one `filament connect` connected is no agents'. @param {Machine} m */
  const keptOf = (m) => store.list().find((x) => x.machine.id.toLowerCase() === m.id && x.device.scope === "agent") ?? null;

  const reachThere = createReach({ cookieOf, pick, fetchOf });
  /**
   * The machine reached as this window's full device there (lib/reach.js), or the row that says what stands in the way.
   * @param {Machine} m @param {import("./reach.js").For} [f]  who reaches it: Settings' switch, or the new-chat menu
   * @returns {Promise<import("./reach.js").Reached | { row: AgentsRow }>}
   */
  async function reach(m, f = FOR.switch) {
    const kept = !!keptOf(m);
    const r = await reachThere(m, f);
    return "words" in r ? { row: rowOf(m, { kept, words: r.words, ...(r.away ? { away: r.away } : {}) }) } : r;
  }

  /**
   * One machine's projects, as the new-chat menu lists them: read there as this window's sign-in, newest first, the
   * archived left out; else null, and why. @param {Machine} m @returns {Promise<ProjectsRow>}
   */
  async function projectsOf(m) {
    /** @param {unknown} words @returns {ProjectsRow} */
    const none = (words) => ({ id: m.id, name: m.name, projects: null, words: capped(words) });
    const r = await reach(m, FOR.picker);
    if ("row" in r) return none(r.row.words);
    // A Filament from before opens no new chat at an address: sent there, its page would start one in another folder.
    if (!(Array.isArray(r.me?.pages) && r.me.pages.includes("new"))) return none(`Filament on ${m.name} opens no new chat from here yet: update it there, and its projects show here.`);
    const p = await r.send("/memory/projects").catch((/** @type {any} */ e) => ({ status: 0, json: { error: String(e?.message || e) } }));
    if (p.status !== 200 || !Array.isArray(p.json?.projects)) return none(`${m.name}'s projects could not be read: ${refusal(p)}.`);
    // One on a share (`\\server\…`, WSL's `\\wsl$\…`) is left out: its page opens a new chat in no share (router.js `newChatFolder`).
    const projects = p.json.projects
      .filter((/** @type {any} */ x) => x && !x.archived && typeof x.cwd === "string" && x.cwd.trim() && x.cwd.length <= WORDS_MAX && !/^[\\/]{2}/.test(x.cwd.trim()))
      .slice(0, PROJECTS_MAX)
      .map((/** @type {any} */ x) => ({ cwd: x.cwd, name: typeof x.name === "string" ? capped(x.name) : "" }));
    return { id: m.id, name: m.name, projects, words: null };
  }

  /** The way this window reached a machine by: its address, and its certificate's pin on the network. @param {{ route: Route, origin: string }} r */
  const wayOf = (r) => ({ url: r.origin, ...(r.route.kind === "lan" ? { fingerprint: String(/** @type {any} */ (r.route).fingerprint) } : {}) });
  /**
   * The agents' device kept for a machine still standing there takes the way this window reached it by, its token kept:
   * their sub-agents, commands and models go where the machine answers now — another address, a certificate made anew
   * and paired again —, not where it was minted. Written where it moved alone. → why it could not be kept, or null.
   * @param {Machine} m @param {{ route: Route, origin: string }} r @param {ReturnType<typeof keptOf>} kept
   */
  const follow = (m, r, kept) => {
    const way = wayOf(r);
    if (!kept || (kept.url === way.url && (kept.fingerprint ?? "") === (way.fingerprint ?? ""))) return null;
    return keepHere(() => store.keep({ ...way, machine: { ...kept.machine, name: m.name }, device: kept.device }));
  };

  /**
   * The machine as it stands there: its device list read, the agents' device kept here found in it, and where it still
   * stands, following the way this window reached it by (`follow`).
   * @param {Machine} m @param {{ send: Send, route: Route, origin: string }} reached
   * @returns {Promise<AgentsRow>}
   */
  async function standing(m, reached) {
    const kept = keptOf(m);
    const r = await reached.send("/remote/devices").catch((/** @type {any} */ e) => ({ status: 0, json: { error: String(e?.message || e) } }));
    if (r.status !== 200) return rowOf(m, { kept: !!kept, words: `${m.name}'s devices could not be read: ${refusal(r)}.` });
    const there = kept ? (Array.isArray(r.json?.devices) ? r.json.devices : []).find((/** @type {any} */ d) => d?.id === kept.device.id && d.revokedAt == null) : null;
    if (there) follow(m, reached, kept);
    return rowOf(m, { on: there?.grants?.agents === true, models: there?.grants?.models === true, full: there?.grants?.full === true, kept: !!kept, ready: true, words: kept && !there ? `Its agents' device on ${m.name} was revoked there: switched on, ${m.name} makes a new one.` : null });
  }

  /** A machine by its id, kept in the window now. @param {string} id */
  const machineOf = (id) => machines().find((m) => !m.local && m.id === String(id).toLowerCase()) ?? null;
  /** No such machine: the page's list is older than the window's. @param {string} id @returns {AgentsRow} */
  const none = (id) => ({ id: String(id), name: String(id), on: false, models: false, full: false, kept: false, ready: false, words: "This window keeps no such machine now: open Settings › Remote access again.", said: "No such machine in this window", failed: true });

  /** One machine's changes one after the other: two presses never mint two devices. @type {Map<string, Promise<unknown>>} */
  const queue = new Map();
  /** @template T @param {string} id @param {() => Promise<T>} fn @returns {Promise<T>} */
  const inTurn = (id, fn) => {
    const run = (queue.get(id) ?? Promise.resolve()).then(fn, fn);
    const held = run.catch(() => {});
    queue.set(id, held);
    void held.then(() => void (queue.get(id) === held && queue.delete(id)));
    return run;
  };

  /** Why a keep in the machines store failed, in words; null where it kept. @param {() => unknown} keep */
  const keepHere = (keep) => {
    try {
      keep();
      return null;
    } catch (/** @type {any} */ e) {
      return String(e?.message || e);
    }
  };

  /** The machine as a grant's answer says its device: its grants. @param {Machine} m @param {any} device */
  const granted = (m, device) => rowOf(m, { on: device?.grants?.agents === true, models: device?.grants?.models === true, full: device?.grants?.full === true, kept: true, ready: true });

  /**
   * Switched on: the agents' device kept here has its grant on there — minted first where none is kept, or the one
   * kept was revoked there. @param {Machine} m @returns {Promise<AgentsRow>}
   */
  async function switchOn(m) {
    const r = await reach(m);
    if ("row" in r) return { ...r.row, said: `Not switched on: ${r.row.words}`, failed: true };
    const kept = keptOf(m);
    /** A grant asked of a device there. @param {string} id @param {boolean} on */
    const grant = (id, on) => r.send(`/remote/devices/${encodeURIComponent(id)}`, { method: "PATCH", body: { grants: { agents: on } } }).catch((/** @type {any} */ e) => ({ status: 0, json: { error: String(e?.message || e) } }));
    const way = wayOf(r);
    if (kept) {
      const g = await grant(kept.device.id, true);
      // Still standing there: its grant is on, nothing minted, and its row takes the way this window's pairing reached
      // the machine by — its certificate made anew and paired again, or another address —, its token kept. Revoked or
      // gone there (`gone`): a new one is minted below.
      if (g.status === 200 && g.json?.device?.revokedAt == null) {
        // Its name as this window has it now: renamed here since, the kept row says the new one.
        const unkept = keepHere(() => store.keep({ ...way, machine: { ...kept.machine, name: m.name }, device: kept.device }));
        return { ...granted(m, g.json?.device), ...(unkept ? { said: `Switched on; the way this window reaches ${m.name} by could not be kept here: ${unkept}` } : {}) };
      }
      if (g.status !== 200 && !gone(g)) return { ...(await standing(m, r)), said: `Not switched on: ${refusal(g)}`, failed: true };
    }
    const from = String(ownName() || "").trim();
    const minted = await r.send("/remote/agent-device", { method: "POST", body: from ? { from } : {} }).catch((/** @type {any} */ e) => ({ status: 0, json: { error: String(e?.message || e) } }));
    const device = minted.json?.device;
    if (minted.status !== 200 || typeof minted.json?.token !== "string" || typeof device?.id !== "string")
      return { ...(await standing(m, r)), said: `${m.name} made no device for this Filament's agents: ${refusal(minted)}`, failed: true };
    /** @type {any} */
    let made = null;
    const unkept = keepHere(
      () =>
        (made = store.keep({
          ...way,
          machine: { id: String(minted.json.machine?.id || m.id), name: String(minted.json.machine?.name || m.name) },
          device: { id: device.id, name: String(device.name || ""), scope: "agent" },
          token: minted.json.token,
        })),
    );
    // Its token is nowhere but in this call: the device stays there with its grant off, and the next press mints anew,
    // which takes its place there.
    if (unkept) return rowOf(m, { kept: !!keptOf(m), ready: true, said: `${m.name} made this Filament's agents a device, and its token could not be kept here: ${unkept}. Switch it on again, and ${m.name} makes another.`, failed: true });
    // Kept beside `filament connect`'s device for that machine, if the command line has one: never in its place.
    log(`machines: ${m.name} made this Filament's agents a device (${made.device.name}), its token kept`);
    const g = await grant(device.id, true);
    if (g.status !== 200) return rowOf(m, { kept: true, ready: true, said: `${m.name} made the device, and did not switch it on: ${refusal(g)}. Switch it on again.`, failed: true });
    return granted(m, g.json?.device);
  }

  /** Switched off there, the token kept here. @param {Machine} m @returns {Promise<AgentsRow>} */
  async function switchOff(m) {
    const r = await reach(m);
    if ("row" in r) return { ...r.row, said: `Not switched off: ${r.row.words}`, failed: true };
    const kept = keptOf(m);
    if (!kept) return standing(m, r);
    const g = await r.send(`/remote/devices/${encodeURIComponent(kept.device.id)}`, { method: "PATCH", body: { grants: { agents: false } } }).catch((/** @type {any} */ e) => ({ status: 0, json: { error: String(e?.message || e) } }));
    if (g.status === 200 || gone(g)) return standing(m, r);
    return { ...(await standing(m, r)), said: `Not switched off: ${refusal(g)}`, failed: true };
  }

  /** What a grant this switch moves lets once this Filament's agents work there, said where no device is kept. */
  const AFTER = Object.freeze({ models: "its models can be used here", full: "Full control can be switched on there" });
  /**
   * The agents' device kept here has its grant `models` or `full` switched there: `models` on, the machine lends this
   * Filament its models; `full` on, its agents act there as the person, on top of `agents`, which the machine refuses
   * without. Nothing is minted: with no device kept, or one revoked there, it is said — the agents' switch makes one.
   * @param {Machine} m @param {"models" | "full"} grant @param {boolean} on @returns {Promise<AgentsRow>}
   */
  async function switchGrant(m, grant, on) {
    const not = on ? "Not switched on" : "Not switched off";
    const r = await reach(m);
    if ("row" in r) return { ...r.row, said: `${not}: ${r.row.words}`, failed: true };
    const kept = keptOf(m);
    if (!kept) return { ...(await standing(m, r)), said: `${not}: this Filament's agents have no device on ${m.name} yet. Let them work there first, and ${AFTER[grant]}.`, failed: true };
    const g = await r.send(`/remote/devices/${encodeURIComponent(kept.device.id)}`, { method: "PATCH", body: { grants: { [grant]: on } } }).catch((/** @type {any} */ e) => ({ status: 0, json: { error: String(e?.message || e) } }));
    if (g.status === 200 && g.json?.device?.revokedAt == null) {
      const unkept = follow(m, r, kept);
      return { ...granted(m, g.json?.device), ...(unkept ? { said: `Switched; the way this window reaches ${m.name} by could not be kept here: ${unkept}` } : {}) };
    }
    const revoked = g.status === 200 || gone(g);
    return { ...(await standing(m, r)), said: `${not}: ${revoked ? `this Filament's agents' device on ${m.name} was revoked there. Let them work there again, and ${m.name} makes a new one.` : refusal(g)}`, failed: true };
  }

  return {
    /**
     * Every machine the window keeps, with its projects as the new-chat menu lists them: one that throws is said, the
     * others listed still. @returns {Promise<ProjectsRow[]>}
     */
    projects: () =>
      Promise.all(
        machines()
          .filter((m) => !m.local)
          .map((m) => projectsOf(m).catch((/** @type {any} */ e) => ({ id: m.id, name: m.name, projects: null, words: capped(`${m.name}'s projects could not be read: ${e?.message || e}.`) }))),
      ),
    /** Every machine the window keeps, by its id and name, nothing asked of it: the new-chat menu's rows at the press. */
    names: () =>
      machines()
        .filter((m) => !m.local)
        .map((m) => ({ id: m.id, name: m.name })),
    /** Every machine the window keeps, as each stands there. @returns {Promise<AgentsRow[]>} */
    list: () =>
      Promise.all(
        machines()
          .filter((m) => !m.local)
          .map(async (m) => {
            const r = await reach(m);
            return "row" in r ? r.row : standing(m, r);
          }),
      ),
    /** This Filament's agents let work on a machine, or not; → the machine as it stands after. @param {string} id @param {boolean} on @returns {Promise<AgentsRow>} */
    set(id, on) {
      const m = machineOf(id);
      if (!m) return Promise.resolve(none(id));
      return inTurn(m.id, () => (on ? switchOn(m) : switchOff(m)));
    },
    /**
     * A machine lends this Filament its models, or not — its agents' device's grant `models` there; → the machine as it
     * stands after. @param {string} id @param {boolean} on @returns {Promise<AgentsRow>}
     */
    models(id, on) {
      const m = machineOf(id);
      if (!m) return Promise.resolve(none(id));
      return inTurn(m.id, () => switchGrant(m, "models", on));
    },
    /**
     * Full control on a machine, or not — its agents' device's grant `full` there, on top of `agents`: this Filament's
     * agents act there as the person; → the machine as it stands after. @param {string} id @param {boolean} on
     * @returns {Promise<AgentsRow>}
     */
    full(id, on) {
      const m = machineOf(id);
      if (!m) return Promise.resolve(none(id));
      return inTurn(m.id, () => switchGrant(m, "full", on));
    },
    /**
     * Forget: the agents' device revoked there, its token let go here. A machine that does not answer has it forgotten
     * here all the same, and said: the device stays listed there until it is revoked. @param {string} id @returns {Promise<AgentsRow>}
     */
    forget(id) {
      const m = machineOf(id);
      if (!m) return Promise.resolve(none(id));
      return inTurn(m.id, async () => {
        const kept = keptOf(m);
        const r = await reach(m);
        if (!kept) return "row" in r ? r.row : standing(m, r);
        /** @type {string | null} */
        let left = "row" in r ? `${m.name} did not answer` : null;
        if (!("row" in r)) {
          const d = await r.send(`/remote/devices/${encodeURIComponent(kept.device.id)}`, { method: "DELETE" }).catch((/** @type {any} */ e) => ({ status: 0, json: { error: String(e?.message || e) } }));
          if (d.status !== 200 && d.status !== 404) left = `${m.name} did not revoke it (${refusal(d)})`;
        }
        await store.forget(kept);
        log(`machines: this Filament's agents' device on ${m.name} let go${left ? `, not revoked there: ${left}` : ", revoked there"}`);
        const after = "row" in r ? { ...r.row, kept: false } : await standing(m, r);
        return { ...after, said: left ? `Forgotten here. ${left}: it stays listed there until it is revoked in its Settings › Remote access.` : `Forgotten here, and revoked on ${m.name}`, ...(left ? { failed: /** @type {const} */ (true) } : {}) };
      });
    },
  };
}

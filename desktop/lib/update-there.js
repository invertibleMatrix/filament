// @ts-check
// Another machine's Filament updated from this app (the remote desk's s3d): its Update Filament, one machine or all.
// Asked of that machine's own Filament (http/admin/update.js `/api/update`) at the best of its ways that answers as it —
// one on a wire this app does not speak too: the update is how it comes to speak it —, with the sign-in its partition
// holds, as the fleet's calls go (watch.js `send`). A Filament from before that route is updated over SSH where the
// machine is kept with an SSH way — `filament update` there, as install.sh installed it —, else told to be, in words.
import { aliasOf } from "./ssh-route.js";
import { runSsh } from "./ssh-exec.js";
import { pickRoute } from "./machines.js";
import { routeFetch } from "./watch.js";
import { isNewer } from "../../src/services/updates.js";

/** How long a call to a machine's update route waits. */
const CALL_MS = 15_000;
/** How long `filament update` over SSH may take: a download of a release, then its restart. */
export const SSH_UPDATE_MS = 10 * 60_000;
/** A release's version, as `filament update --version` takes it. */
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
/**
 * What the SSH way runs there: `filament update --version <v> --json`, the one install.sh installed — under its folder
 * of versions, then its command in ~/.local/bin, where a file of the person's own may stand instead —, else the one on
 * its PATH, as a pairing over SSH finds it (add-machine.js `PAIR_SCRIPT`). @param {string} version  one `VERSION` takes
 */
export const updateScript = (version) =>
  `case \${XDG_DATA_HOME:-} in /*) d=$XDG_DATA_HOME ;; *) d=$HOME/.local/share ;; esac; f="$d/filament/current/bin/filament"; [ -x "$f" ] || f="$HOME/.local/bin/filament"; [ -x "$f" ] || f=filament; exec "$f" update --version ${version} --json`;

/**
 * @typedef {import("./machines.js").Machine} Machine
 * @typedef {import("./machines.js").Route} Route
 * @typedef {{ can: boolean, why: string | null, version: string | null, running: boolean, last: any }} UpdateLook
 *   as `/api/update` says it
 * @typedef {{ ok: true, version: string | null, ssh?: boolean } | { ok: false, words: string, installed?: boolean }} UpdateStart
 *   `installed`: not done, the version there all the same — its words say what stands
 */

/**
 * @param {{ pick?: (m: Machine) => Promise<any>, cookieOf: (partition: string, origin: string) => Promise<string>, fetchOf?: (route: Route) => typeof fetch,
 *   ssh?: typeof runSsh, log?: (line: string) => void }} o
 */
export function createUpdateThere({ pick = pickRoute, cookieOf, fetchOf = routeFetch, ssh = runSsh, log = () => {} }) {
  /**
   * The way its Filament answers as itself at — on this app's wire or another —, or why none does. @param {Machine} m
   * @returns {Promise<{ route: Route, version: string | null } | { words: string }>}
   */
  const wayTo = async (m) => {
    const r = await pick(m).catch((/** @type {any} */ e) => ({ route: null, tried: [{ why: String(e?.message || e) }] }));
    const route = r?.route ?? r?.update?.route ?? null;
    return route ? { route, version: r.version ?? r.update?.version ?? null } : { words: `${m.name} does not answer: ${r?.tried?.at(-1)?.why || "none of its ways answered"}.` };
  };
  /**
   * Its update route called at `route`, the sign-in its partition holds sent along, nothing followed elsewhere. → its
   * status and answer; 0 where nothing answered. @param {Machine} m @param {Route} route @param {"GET" | "POST"} method @param {any} [body]
   */
  const call = async (m, route, method, body) => {
    const origin = new URL(String(route.url)).origin;
    const cookie = await cookieOf(m.partition, origin).catch(() => "");
    try {
      const res = await fetchOf(route)(`${origin}/api/update`, {
        method,
        headers: { "x-filament-ui": "1", ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(CALL_MS),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    } catch (/** @type {any} */ e) {
      return { status: 0, body: { error: String(e?.message || e) } };
    }
  };
  /** Its SSH way's alias, where it is kept with one. @param {Machine} m */
  const sshOf = (m) => {
    const r = m.routes.find((x) => x.kind === "ssh");
    return r ? aliasOf(String(/** @type {any} */ (r).alias || "")) : null;
  };
  /** What a refusal says: its words, else its status. @param {{ status: number, body: any }} a @param {Machine} m */
  const refused = (a, m) =>
    a.status === 401 || a.status === 403
      ? `${m.name} did not let this window in (HTTP ${a.status}): pair it again (its ⋯ in the machines menu, Remove, then Add a machine).`
      : String(a.body?.error || `${m.name} answered HTTP ${a.status}`);
  /**
   * `filament update --version <v> --json` over SSH, as install.sh installed it there, for a Filament from before the
   * route: done once its service's Filament restarted on it; refused while a turn runs there, the update kept — asked again
   * once it ends, the version installed restarts on —; else said as it stands (`installed`: the version is there, and
   * the Filament that runs did not restart on it). @param {Machine} m @param {string} alias @param {string} version
   * @returns {Promise<UpdateStart>}
   */
  const overSsh = async (m, alias, version) => {
    log(`update: ${m.id}'s Filament has no update route; filament update over ssh ${alias}`);
    const run = await ssh(alias, { script: updateScript(version) }, { timeoutMs: SSH_UPDATE_MS });
    /** @type {any} */
    let report = null;
    try {
      report = JSON.parse(String(run.stdout || ""));
    } catch {}
    // Restarted by its service: systemd's, or the runner's of a Windows host's scheduled task or a Mac's launchd ("service").
    if (run.code === 0 && (report?.restart === "systemd" || report?.restart === "service")) return { ok: true, version, ssh: true };
    if (run.code === 0)
      return {
        ok: false,
        installed: true,
        words:
          report?.restart === "not-running"
            ? `Filament ${version} is installed on ${m.name}, where no Filament runs now: it runs ${version} at its next start.`
            : report?.restart === "by-hand"
              ? `Filament ${version} is installed on ${m.name}, whose Filament was started by hand: it runs ${version} once it is started again there.`
              : `Filament ${version} is installed on ${m.name}, and its Filament runs on: filament restart there starts it.`,
      };
    const said = String(run.stderr || "").trim().split("\n").filter(Boolean).at(-1) || "";
    if (run.code === 5) return { ok: false, installed: true, words: `Filament ${version} is installed on ${m.name}, and its Filament runs on while a turn runs there: Update again once it ends restarts it on ${version}.` };
    if (run.ask) return { ok: false, words: `ssh ${alias} asks for ${run.ask === "host-key" ? "its host key to be trusted" : "a password or a code"}: run filament update there in a terminal (ssh ${alias}).` };
    return { ok: false, words: run.why || said || `filament update on ${m.name} ended with code ${run.code}.` };
  };
  return {
    /**
     * Whether its Filament updates itself on request, whether an update runs there and how the last went (`/api/update`);
     * `old`: its Filament is from before that route. @param {Machine} m
     * @returns {Promise<(UpdateLook & { old?: boolean }) | { words: string }>}
     */
    async look(m) {
      const way = await wayTo(m);
      if ("words" in way) return way;
      const a = await call(m, way.route, "GET");
      if (a.status === 200 && a.body && typeof a.body.can === "boolean") return a.body;
      if (a.status === 404) return { can: !!sshOf(m), why: sshOf(m) ? null : `${m.name}'s Filament${way.version ? ` (${way.version})` : ""} is from before updates from this app: filament update there updates it.`, version: way.version, running: false, last: null, old: true };
      return { words: a.status ? refused(a, m) : `${m.name} did not answer (${a.body?.error})` };
    },
    /**
     * Its Filament updated to `version`: asked of its own (202), else over SSH where it is from before that route and
     * kept with an SSH way. Never to an older version than it answers on now. @param {Machine} m @param {string} version
     * @returns {Promise<UpdateStart>}
     */
    async start(m, version) {
      if (!VERSION.test(version)) return { ok: false, words: `${version} is no release's version.` };
      const way = await wayTo(m);
      if ("words" in way) return { ok: false, words: way.words };
      if (way.version && !isNewer(version, way.version))
        return { ok: false, words: way.version === version ? `${m.name} runs Filament ${version} already.` : `${m.name} runs Filament ${way.version}, newer than ${version}: nothing to update.` };
      const a = await call(m, way.route, "POST", { version });
      if (a.status === 202) {
        log(`update: ${m.id} updates to ${version}`);
        return { ok: true, version };
      }
      if (a.status === 404) {
        const alias = sshOf(m);
        if (alias) return overSsh(m, alias, version);
        return { ok: false, words: `${m.name}'s Filament${way.version ? ` (${way.version})` : ""} is from before updates from this app: filament update there updates it.` };
      }
      return { ok: false, words: a.status ? refused(a, m) : `${m.name} did not answer (${a.body?.error})` };
    },
  };
}

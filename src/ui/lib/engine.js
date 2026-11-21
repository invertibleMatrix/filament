// @ts-check
// Where memory's engine stands, in the words every page says alike (HarnessV3-AtHome AH-D2): an install's percent, and
// what memory does while the engine isn't there. The state is the server's (`GET /api/memory/engine`, and the events
// feed's `engine`): `installing` with `percent`, `source` ("bundle", or null before the install has said) and `auto`;
// `ready`; `missing` with the last install's `error`; `off`. The engine is the one in the bundle that came with
// Filament, and none is ever updated: a new release brings its own, put in as it starts.

/** What memory's recall does without its engine, which adds recall by meaning. */
export const RECALL_WITHOUT_ENGINE = "memory recalls by matching words only, not by meaning";

/**
 * What memory does without its engine. The archive records, learns, recalls by matching words and serves the model's
 * memory tools; the engine adds recall by meaning.
 */
export const WITHOUT_ENGINE = `${RECALL_WITHOUT_ENGINE}; sessions are recorded and learned from as usual`;

/**
 * What memory does without its engine where a chat is read: `learns` false for a chat memory learns nothing from, whose
 * own line says why — the words then say what recall does, and nothing of recording or learning.
 * @param {boolean} learns
 */
const withoutEngine = (learns) => (learns ? WITHOUT_ENGINE : RECALL_WITHOUT_ENGINE);

/**
 * An install running now, in words; null when none runs.
 * - `percent`: how far it is, 0–100.
 * - `sub`: the short form, after "On · ".
 * - `line`: what it is and how it goes, one line.
 * - `meanwhile`: what memory does until it is done (`learns` false: for a chat memory learns nothing from).
 * @param {any} now where the engine stands @param {{ learns?: boolean }} [o]
 * @returns {{ percent: number, sub: string, line: string, meanwhile: string } | null}
 */
export function engineProgress(now, { learns = true } = {}) {
  if (now?.state !== "installing") return null;
  const percent = Math.max(0, Math.min(100, Math.round(Number(now.percent) || 0)));
  const how = now.source === "bundle" ? "installing its engine from the copy that came with Filament" : "installing its engine";
  return {
    percent,
    sub: `getting ready — ${percent}%`,
    line: `Memory is getting ready — ${percent}%: ${how}`,
    meanwhile: `Until it's ready, ${withoutEngine(learns)}.`,
  };
}

/**
 * Where memory's engine stands, kept off the events fan-out a page holds already: `subscribe` hands it every message
 * there and returns the undo (the harness's `onBus`, the console's `onEvents`). Read on each (re)connect — the fan-out's
 * `hello`, the first included — and kept by its `engine` messages in between; a read answered after a message landed
 * is older than it, and dropped. Returns the undo.
 * @param {(fn: (msg: any) => void) => () => void} subscribe
 * @param {{ read: () => Promise<any>, onSaid: (now: any) => void }} o  `read`: `GET /api/memory/engine`
 */
export function followEngine(subscribe, { read, onSaid }) {
  let heard = 0;
  return subscribe((msg) => {
    if (msg?.type === "hello") {
      const at = heard;
      read().then(
        (now) => {
          if (at === heard) onSaid(now);
        },
        () => {},
      );
    } else if (msg?.type === "engine" && msg.engine) {
      heard++;
      onSaid(msg.engine);
    }
  });
}

/**
 * What an Install puts on this machine: the engine in the bundle that came with Filament, the only thing it takes (the
 * status's `engine.bundle`); with none here, why there is nothing to install.
 * @param {{ ready?: boolean, why?: string | null } | null | undefined} bundle
 */
export function installWords(bundle) {
  return bundle?.ready
    ? "Installing copies uv, a private Python 3.12, Mnemosyne and a 65 MB embedding model into the engine folder from the copy that came with Filament, offline: about 500 MB."
    : `There is nothing to install it from: ${bundle?.why || "this Filament came without its memory engine"}.`;
}

/**
 * Whether the engine installed is another than the one this Filament came with — a download, an earlier release's —
 * with that one here to put in: Install offers it (memory does it by itself as it starts, unless
 * `memory.engine.autoInstall` is off). @param {any} engine  the status's `engine`
 */
export const otherEngine = (engine) => !!(engine?.installed && engine.bundle?.ready && !engine.bundle.current);

/** What Install does over another engine, where `otherEngine` holds. */
export const OTHER_ENGINE_WORDS = "This isn't the engine this Filament came with: Install puts that one in, offline, and memory is backed up first when its Mnemosyne version changes.";

/** What Restart does, where the engine's controls offer it (HarnessV4_Tasks U1): its tooltip. */
export const RESTART_WORDS = "End the engine's process and start it again — for an engine that hangs: nothing here ends a slow call by itself, and Filament restarts the engine by itself only when it answers nothing for a minute, not even a ping, and leaves it stopped once it does that again each time it starts. Calls in flight end with an error, and a turn waiting on its recall goes on without it.";

/**
 * The engine's last stall, in words (the status's `engine.stalled`): when it answered nothing, for how long, with
 * which calls in flight, and what Filament did — restarted it; stopped it, as it stalled again soon after a restart
 * (`run`); or left it stopped for that (`out`); null for none.
 * @param {{ at: number, quietMs: number, calls: number, ops?: string[], count?: number, run?: number, out?: boolean } | null | undefined} s
 * @returns {string | null}
 */
export function stallWords(s) {
  if (!s) return null;
  const at = new Date(s.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const quiet = s.quietMs < 120_000 ? `${Math.max(1, Math.round(s.quietMs / 1000))} s` : `${Math.round(s.quietMs / 60_000)} min`;
  const ops = (s.ops || []).join(", ");
  const calls = `${s.calls === 1 ? "a call" : `${s.calls} calls`}${ops ? ` (${ops})` : ""}`;
  const count = Number(s.count) || 1;
  const run = Number(s.run) || 1;
  const those = s.calls === 1 ? "that call" : "those calls";
  const since = count > 1 ? ` It has stalled ${count} times since Filament started.` : "";
  const stalled = `At ${at} the engine answered nothing for ${quiet}, not even a ping, with ${calls} in flight`;
  if (run === 1) return `${stalled}: Filament restarted it, and ${those} ended with an error.${since}`;
  const again = `${stalled}, again soon after Filament restarted it for that (${run} stalls in a row)`;
  return s.out
    ? `${again}: Filament left it stopped, and ${those} ended with an error. Memory goes on without it, on the archive alone, until you restart it.${since}`
    : `${again}: Filament stopped it and counted a failure, to start it again after a pause, and ${those} ended with an error.${since}`;
}

/**
 * The engine restarted from a page (`POST /api/memory/engine/restart`), said in a toast: that it is back and how many
 * calls it cut, or why not. → whether it restarted.
 * @param {{ api: (path: string, init?: any) => Promise<any>, toast: (words: string, kind?: string) => void }} d
 */
export async function restartEngine(d) {
  try {
    const r = await d.api("/memory/engine/restart", { method: "POST", body: {} });
    const cut = Number(r?.cut) || 0;
    d.toast(`Memory engine restarted${cut ? ` — ${cut} call${cut === 1 ? "" : "s"} in flight ended` : ""}`);
    return true;
  } catch (/** @type {any} */ e) {
    d.toast(`The memory engine was not restarted: ${e?.message || e}`, "err");
    return false;
  }
}

/**
 * What an Uninstall asks, and whether the engine comes back: `again` when memory is on and installs a missing engine by
 * itself (`memory.engine.autoInstall`) at its next start; `bundled` false when no bundle is here to bring it back from.
 * @param {{ again: boolean, bundled?: boolean }} o
 */
export function uninstallWords({ again, bundled = true }) {
  const what = "Remove the engine folder (uv, Python, the Mnemosyne package and the embedding model)? Your memory folder with the archive and the Mnemosyne database is kept";
  if (!bundled)
    return `${what}, but this Filament came without its engine, so nothing here can install it again: reinstall Filament, or in a checkout build it with npm run engine:bundle (about 500 MB to download).`;
  return again
    ? `${what}. With memory on, Filament installs the engine again by itself when it next starts; Install brings it back now.`
    : `${what}; Install brings the engine back.`;
}

/**
 * A missing engine in words; null when it isn't missing.
 * - `short`: after "On · ", and at the end of a title.
 * - `note`: why, and what memory does without it (`learns` false: for a chat memory learns nothing from).
 * - `installable`: whether an Install can bring it: false when this Filament came without its engine (`why`).
 * @param {any} now where the engine stands @param {{ learns?: boolean }} [o]
 * @returns {{ short: string, note: string, failed: boolean, installable: boolean } | null}
 */
export function engineMissing(now, { learns = true } = {}) {
  if (now?.state !== "missing") return null;
  const without = withoutEngine(learns);
  if (now.why) return { short: "it has no engine", note: `Its engine isn't installed, and can't be: ${now.why}. Meanwhile ${without}.`, failed: false, installable: false };
  return now.error
    ? { short: "its engine didn't install", note: `Its engine didn't install (${now.error}), so ${without}.`, failed: true, installable: true }
    : { short: "its engine isn't installed", note: `Its engine isn't installed, so ${without}.`, failed: false, installable: true };
}

// @ts-check
// The machines of this computer's tailnet that run Filament, for the window's Add sheet (the owner's remote Filament of
// 11-06, Part 2, p2-tailscale): Tailscale's command line says which of the tailnet's machines are online, and each is
// asked who answers at its https address — /.well-known/filament, cookie-less, all at once, `PEER_MS` each, its answer
// read to `PEER_BYTES` at most — where a Filament that shares itself on the tailnet (Settings › Remote access › Share
// on my tailnet) answers with its id. Each is named as Tailscale names it — its host name, and its owner where that is
// not you —, never by what it says of itself: a machine of the tailnet may say it is another. Your own machines are
// asked first. A press in the sheet fills the address; who answers there is asked again by the sheet's Continue, as for
// any address typed (add-machine.js `checkMachine`). Tailscale not installed here: none, and nothing said. Plain Node.
import { CLI_MS, findCli, runCli, statusOf } from "../../src/services/tailscale.js";
import { idOf } from "./machines.js";

/** How long each machine of the tailnet is given to say who it is. */
export const PEER_MS = 5000;
/** The most machines asked: a tailnet of hundreds — exit nodes, machines shared in — is asked about yours first. */
export const PEERS_MAX = 32;
/** The most of an answer read: /.well-known/filament's is a few dozen bytes. */
export const PEER_BYTES = 16 * 1024;

/**
 * @typedef {{ url: string, host: string, id: string, name: string, owner: string, version: string }} TailnetFilament
 * `host`: its name on the tailnet; `name`: its host name, as Tailscale says it; `owner`: its login, where it is not yours
 * @typedef {{ found: TailnetFilament[], words: string }} TailnetLook  `words`: why none is listed, where that is worth saying
 */

/** A machine's name on the tailnet, as an address may hold it: letters, digits and hyphens between dots. */
const HOST = /^[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9](?:[a-z0-9-]{0,62}))+$/;

/**
 * Who answers at a machine's https address, cookie-less. Injected in tests.
 * @typedef {(url: string, o: { timeoutMs: number }) => Promise<{ status: number, json: any }>} AskPeer
 * @type {AskPeer}
 */
export const askPeer = async (url, { timeoutMs }) => {
  const signal = AbortSignal.timeout(timeoutMs);
  const r = await fetch(`${url}/.well-known/filament`, { signal, credentials: "omit", redirect: "manual" });
  return { status: r.status, json: await cappedJson(r.body, PEER_BYTES) };
};

/**
 * A body read as JSON to `max` bytes at most: one longer is no answer, and the rest is not read.
 * @param {ReadableStream<Uint8Array> | null} body @param {number} max
 */
export async function cappedJson(body, max) {
  if (!body) return null;
  const reader = body.getReader();
  /** @type {Uint8Array[]} */
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        void reader.cancel().catch(() => {});
        return null;
      }
      parts.push(value);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * The tailnet's machines online that answer as a Filament.
 * @param {{ cli?: () => string | null, exec?: typeof runCli, ask?: AskPeer, timeoutMs?: number }} [o]
 * @returns {Promise<TailnetLook>}
 */
export async function tailnetFilaments({ cli = () => findCli(), exec = runCli, ask = askPeer, timeoutMs = PEER_MS } = {}) {
  const file = cli();
  if (!file) return { found: [], words: "" };
  const r = await exec(file, ["status", "--json"], { timeoutMs: CLI_MS });
  /** @type {ReturnType<typeof statusOf>} */
  let st;
  try {
    st = statusOf(JSON.parse(r.out));
  } catch {
    return { found: [], words: `Tailscale could not be read here${r.timedOut ? ": it did not answer" : ""}.` };
  }
  if (!st.running) return { found: [], words: "Tailscale is not connected here: open it from its icon and sign in to see your tailnet's machines." };
  // Yours first, in the order Tailscale lists them; then those shared in.
  const online = st.peers
    .filter((p) => p.online && HOST.test(p.dns))
    .sort((a, b) => Number(b.login === st.login) - Number(a.login === st.login))
    .slice(0, PEERS_MAX);
  if (!online.length) return { found: [], words: "No other machine of your tailnet is online." };
  const looks = await Promise.all(
    online.map(async (p) => {
      const url = `https://${p.dns}`;
      try {
        const { status, json } = await ask(url, { timeoutMs });
        const id = idOf(json?.id);
        if (status !== 200 || !id) return null;
        return { url, host: p.dns, id, name: p.name || p.dns, owner: p.login && p.login !== st.login ? p.login : "", version: typeof json.version === "string" ? json.version.slice(0, 32) : "" };
      } catch {
        return null;
      }
    }),
  );
  const found = /** @type {TailnetFilament[]} */ (looks.filter(Boolean));
  return { found, words: found.length ? "" : "No machine of your tailnet answers as a Filament: on the one to add, turn on Share on my tailnet in Settings › Remote access." };
}

// @ts-check
// Another paired machine's models as an upstream (the remote-agents plan's m-upstream): an upstream of type `filament`
// names a machine this Filament keeps an agents' device for (services/machines), and its calls go to that machine's /v1
// (m-door, http/front-door.js `lanDoor`) — over https pinned to its certificate, the device's token as a Bearer —, each
// in its client's own wire: that machine translates it once, where its model's provider speaks the other. The address,
// the pin and the token are the machines store's, read at each call; none of them is in config.json, and neither this
// machine's inbound key nor the house key goes there. Its path is the wire's own and its headers a few named ones, so no
// setting here steers a call elsewhere on that machine or hands it another credential. Its models are what that
// machine's GET /v1/models lists: those that answer there by an API, never a coding agent of its own. Its door lets one
// device have `inFlight` calls at once (front-door.js LENT_IN_FLIGHT): the calls here wait their turn for it. A machine
// that does not answer, or whose door refuses this device — revoked there, its grant `models` off, a Filament that lends
// none —, is offline: said in words for the upstream's state (readiness.js) for OFFLINE_KEPT_MS, and the call fails as
// one that could not reach it, so the dispatch's failover goes on to the next candidate and the health board parks this
// one a while.
import { SILENT_REPLY_MS, forwardRequest, fetchUpstreamModels, listingRead, namesOfListing, silentWords, whileWords } from "./http.js";
import { providerFetch } from "./fetch.js";
import { FILAMENT_MARK } from "../../core/headers.js";

/**
 * What the destination asks of this Filament's machines (services/machines `modelsWay`): the way to one's models — its
 * address, a fetch pinned to its certificate (null: fetch's own goes), the headers that carry the device's token —, read
 * at each call; a refusal in words where it has none.
 * @typedef {{ modelsWay: (which: string, o: { agents: boolean, connectMs: number }) =>
 *   Promise<{ url: string, fetch: typeof fetch | null, headers: Record<string, string> }> }} MachineWays
 */

/** How long a connection to the machine may take to be made: one switched off answers no packet at all. */
export const CONNECT_MS = 5000;
/** How long a machine found offline is said to be, unless a call or a listing finds it answering sooner. */
export const OFFLINE_KEPT_MS = 5 * 60_000;
/**
 * How long a reply's body may send nothing while it is read before the call ends, its turn among the calls there handed
 * on: a machine that went to sleep mid-reply, its link half open, sends nothing and says nothing, and four such calls
 * would hold every turn there (front-door.js LENT_IN_FLIGHT). A reply still working there sends its thinking and its
 * words as they come; any provider's reply has SILENT_REPLY_MS (http.js).
 */
export const SILENT_MS = 2 * 60_000;
/**
 * How long a call asked whole may wait for its answer to begin — its head — before the call ends, its turn among the
 * calls there handed on: a machine that took the call and sends nothing back, its Filament stuck or one that means harm,
 * answers the system's keepalive all the same, and four such calls would hold every turn there. An answer asked whole
 * begins once it is whole there, as long as a provider's reply may send nothing (http.js SILENT_REPLY_MS); a streamed
 * one begins once the provider there begins, and has SILENT_MS.
 */
export const HEAD_MS = SILENT_REPLY_MS;
/**
 * The most a reply's body may carry, in bytes, before the call ends: a model's whole answer, its pictures as base64
 * included, is far below it; another machine that sends on without end fills nothing here.
 */
export const REPLY_MAX = 64 * 1024 * 1024;
/** The most of a refusal's body read for its words, in bytes. */
const REFUSAL_MAX = 64 * 1024;
/** How long the machine's model list may take once it is sent; its wait for a turn among the calls there is apart. */
const LISTING_MS = 15_000;
/** How long a listing waits for its turn among the calls in flight there before it says the machine is busy. */
const LISTING_WAIT_MS = 30_000;
/**
 * The statuses the machine's door refuses this device with, its mark on them (front-door.js `lanDoor`): a token it does
 * not know (401), a grant switched off (403), no model of its lent over the network (404). Its model endpoints' own
 * answers bear no mark (front-door.js MODEL_PATH), nor a provider's passed on (core/wire/upstream-headers.js): a refusal
 * of one call — a coding agent's name, a PDF its model reads none of — is the call's, said to its client as it came.
 */
const DOOR_REFUSALS = new Set([401, 403, 404]);
/** Each wire's one path on the machine: no other is asked, whatever an upstream's settings say. */
const PATHS = Object.freeze({ anthropic: "/v1/messages", openai: "/v1/chat/completions" });
/**
 * The headers of a shaped request that go there: the body's type and the wire's own. The device's token is added to
 * them; nothing else of this machine's — a gateway's key a rule sets, an upstream's own headers, Filament's — goes.
 */
const SENT_HEADERS = new Set(["content-type", "accept", "anthropic-version", "anthropic-beta", "user-agent"]);

/** An upstream's id → why it is offline, in words, and since when. @type {Map<string, { words: string, at: number }>} */
const offline = new Map();

/**
 * Why another machine's upstream is offline, in words, while that holds (`OFFLINE_KEPT_MS` since a call or a listing
 * found it so); null where it answered since, or nothing has found it offline.
 * @param {string} upstreamId @param {number} [now]
 */
export function offlineWords(upstreamId, now = Date.now()) {
  const o = offline.get(upstreamId);
  if (!o) return null;
  if (now - o.at > OFFLINE_KEPT_MS) {
    offline.delete(upstreamId);
    return null;
  }
  return o.words;
}

/**
 * The upstream is said offline no more: it was removed, renamed, or names another machine or prefix now — what was
 * found was of the upstream as it stood (server.js, at each change of the configuration). @param {string} upstreamId
 */
export const forgetOffline = (upstreamId) => void offline.delete(upstreamId);

/**
 * A machine's id → its calls in flight from here, and those waiting their turn, each with its go.
 * @type {Map<string, { busy: number, waiting: (() => void)[] }>}
 */
const lanes = new Map();

/**
 * A turn among this Filament's calls to one machine's models: `most` in flight at once, as its door lets one device
 * have; the rest wait in the order they came, each until its turn or until `signal` ends its wait. → its end, which hands
 * the turn to the next waiting, once however often it is called.
 * @param {string} machine @param {number} most @param {AbortSignal | null | undefined} signal
 * @returns {Promise<() => void>}
 */
function turnAt(machine, most, signal) {
  let lane = lanes.get(machine);
  if (!lane) lanes.set(machine, (lane = { busy: 0, waiting: [] }));
  const at = lane;
  let held = true;
  const end = () => {
    if (!held) return;
    held = false;
    const next = at.waiting.shift();
    if (next) next();
    else if (--at.busy <= 0) lanes.delete(machine);
  };
  if (at.busy < most) {
    at.busy++;
    return Promise.resolve(end);
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const go = () => {
      signal?.removeEventListener("abort", stop);
      resolve(end);
    };
    const stop = () => {
      const i = at.waiting.indexOf(go);
      if (i >= 0) at.waiting.splice(i, 1);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", stop, { once: true });
    at.waiting.push(go);
  });
}

/** Whether a reply bears the machine's door's own mark. @param {Response} r */
const marked = (r) => r.headers.get(FILAMENT_MARK) === "1";

/**
 * A reply whose body fails once the machine has sent nothing for `ms` while it was waited on — the time a slow reader
 * takes is never counted —, or more than `most` bytes: `ended` says the failure, and ends the call.
 * @param {Response} res @param {number} ms @param {number} most @param {(why: "silent" | "large") => Error} ended
 * @returns {Response}
 */
function silenceEnds(res, ms, most, ended) {
  if (!res.body) return res;
  const reader = res.body.getReader();
  /** The silence's failure, once it came: the read it outran fails or ends after it, and nothing is said of that. @type {Error | null} */
  let failed = null;
  let sent = 0;
  const body = new ReadableStream({
    async pull(c) {
      const timer = setTimeout(() => {
        failed = ended("silent");
        c.error(failed);
        reader.cancel(failed).catch(() => {});
      }, ms);
      try {
        const { value, done } = await reader.read();
        if (failed) return;
        if (done) return c.close();
        sent += value.byteLength;
        if (sent <= most) return c.enqueue(value);
        failed = ended("large");
        c.error(failed);
        reader.cancel(failed).catch(() => {});
      } catch (e) {
        if (!failed) c.error(e);
      } finally {
        clearTimeout(timer);
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/**
 * A body's text, its first `most` bytes, as many of them as came within `ms`: the rest is never read.
 * @param {Response} r @param {number} most @param {number} ms
 */
async function headOf(r, most, ms) {
  if (!r.body) return "";
  const reader = r.body.getReader();
  // A read still out once `ms` is up ends as the body's end would: what came by then is the text.
  const quiet = setTimeout(() => void reader.cancel().catch(() => {}), ms);
  /** @type {Uint8Array[]} */
  const parts = [];
  let n = 0;
  try {
    while (n < most) {
      const { value, done } = await reader.read();
      if (done) break;
      parts.push(value);
      n += value.byteLength;
    }
  } finally {
    clearTimeout(quiet);
  }
  reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(parts).subarray(0, most));
}

/**
 * A refusal's words, in whichever wire its door wrote it: its first REFUSAL_MAX bytes, as many as came within `ms`.
 * @param {Response} r @param {number} ms
 */
async function refusalOf(r, ms) {
  const text = await headOf(r, REFUSAL_MAX, ms).catch(() => "");
  try {
    const j = JSON.parse(text);
    const e = j?.error;
    return String((typeof e === "string" ? e : e?.message) || text || `HTTP ${r.status}`);
  } catch {
    return text || `HTTP ${r.status}`;
  }
}

/**
 * The upstream as a destination (core/ports.js `Destination`). `machines`: this Filament's store of its machines
 * (services/machines), where the way there is read at each call; `inFlight`: how many calls the machine's door lets
 * one device have at once (front-door.js LENT_IN_FLIGHT); `silentMs`: how long a reply's body, a streamed one's head
 * and a refusal's words may send nothing (SILENT_MS); `headMs`: how long the head of one asked whole may (HEAD_MS);
 * `replyMax`: how much a reply may carry (REPLY_MAX); `listingMs` and `listingWaitMs`: how long its model list may take
 * once sent, and wait for its turn first (LISTING_MS, LISTING_WAIT_MS).
 * @param {any} upstream
 * @param {{ machines: MachineWays | null, inFlight: number, silentMs?: number, headMs?: number, replyMax?: number, listingMs?: number, listingWaitMs?: number }} deps
 * @returns {import("../../core/ports.js").Destination}
 */
export function filamentDestination(upstream, { machines, inFlight, silentMs = SILENT_MS, headMs = HEAD_MS, replyMax = REPLY_MAX, listingMs = LISTING_MS, listingWaitMs = LISTING_WAIT_MS }) {
  const named = String(upstream.name || upstream.id);
  const machine = String(upstream.machine || "");
  /** It answered: whatever made it offline is past. */
  const answered = () => offline.delete(upstream.id);
  /**
   * It is offline, `words` saying why: kept for its state, and the failure a call or a listing ends with.
   * @param {string} words @param {any} [cause] @returns {Error}
   */
  const gone = (words, cause) => {
    offline.set(upstream.id, { words, at: Date.now() });
    return Object.assign(new Error(words), { offline: true, ...(cause ? { cause } : {}) });
  };
  /**
   * Why a connection failed, in words: a certificate other than the one pinned is said as that — the machine's was made
   * anew, or another answers at its address —, never as no answer.
   * @param {any} e
   */
  const unanswered = (e) =>
    e?.code === "FILAMENT_PIN"
      ? gone(`${named}: its certificate changed — ${e.message}. If that machine's was made anew, pair it again from its Settings › Remote access`, e)
      : gone(`${named} did not answer: ${e?.cause?.code || e?.code || e?.message || e}`, e);
  /** A redirect, which a call never follows: the machine offline, said with where it sent the call. @param {Response} r */
  const redirectGone = (r) => {
    void r.body?.cancel().catch(() => {});
    return gone(`${named} answered with a redirect (HTTP ${r.status}${r.headers.get("location") ? ` to ${r.headers.get("location")}` : ""}): a call goes to the machine kept, never on elsewhere`);
  };
  /**
   * A reply that is no answer of the machine's models: its door refusing this device (offline), its door saying the
   * device has its calls in flight already (busy: a failure another try may pass, which teaches no model a ceiling and
   * takes nothing offline), or a redirect (`redirectGone`). Null for an answer: the call's own.
   * A refusal's words are what came of them within `silentMs`: one whose words never come holds no turn there.
   * @param {Response} r @returns {Promise<Error | null>}
   */
  const notAnswer = async (r) => {
    if (r.status >= 300 && r.status < 400) return redirectGone(r);
    if (!marked(r)) return null;
    if (DOOR_REFUSALS.has(r.status)) return gone(`${named} said: ${await refusalOf(r, silentMs)}`);
    if (r.status === 429) return Object.assign(new Error(`${named} is busy: ${await refusalOf(r, silentMs)}`), { busy: true });
    return null;
  };
  /**
   * The way there now: its address, a fetch through it — pinned to its certificate, else the one every provider's call
   * goes through, its redirects never followed, once the machine at the address said it is the one kept — and the
   * headers that carry the token.
   */
  const reach = async () => {
    if (!machines) throw gone(`${named}: this Filament keeps no machines`);
    try {
      const way = await machines.modelsWay(machine, { agents: true, connectMs: CONNECT_MS });
      /** @type {typeof fetch} */
      const unpinned = (url, init = {}) => providerFetch(url, { ...init, redirect: "manual" });
      return { ...way, fetch: way.fetch || unpinned };
    } catch (/** @type {any} */ e) {
      // The machines store's refusal names a machine it keeps; one it keeps none of, by its id alone, is named here.
      const said = String(e?.message || e);
      throw gone(said.includes(named) ? said : `${named}: ${said}`);
    }
  };
  /**
   * The machine's model list, read as a provider's listing is (http.js `readListing`), in its turn among the calls there:
   * `listingMs` from when it is sent. A listing that waited past `listingWaitMs` behind the calls in flight there says the
   * machine was busy — those calls are answering —, never that it is offline (the m-upstream hunt's).
   */
  const readThere = async () => {
    /** @type {() => void} */
    let done;
    try {
      done = await turnAt(machine, inFlight, AbortSignal.timeout(listingWaitMs));
    } catch {
      throw Object.assign(new Error(`${named} is busy: its models were not listed now, behind ${inFlight} calls of this Filament's in flight there`), { busy: true });
    }
    const signal = AbortSignal.timeout(listingMs);
    try {
      const way = await reach();
      const t0 = performance.now();
      /** @type {Response} */
      let r;
      try {
        r = await way.fetch(`${way.url}/v1/models`, { headers: { "anthropic-version": "2023-06-01", "user-agent": "filament/0.1", ...way.headers }, signal });
      } catch (e) {
        throw unanswered(e);
      }
      const no = await notAnswer(r);
      if (no) throw no;
      answered();
      return await listingRead(r, t0);
    } finally {
      done();
    }
  };
  return {
    id: upstream.id,
    type: upstream.type,
    label: "another machine's Filament",
    transport: null,
    agent: null,
    answers: {
      async open({ headers, bodyString, body, signal, format }) {
        const path = PATHS[format === "openai" ? "openai" : "anthropic"];
        const done = await turnAt(machine, inFlight, signal);
        try {
          const way = await reach();
          const there = `${way.url}${path}`;
          /** @type {Record<string, string>} */
          const sent = {};
          for (const [k, v] of Object.entries(headers)) if (SENT_HEADERS.has(k.toLowerCase())) sent[k.toLowerCase()] = v;
          Object.assign(sent, way.headers);
          // Its head within `silentMs` streamed, `headMs` asked whole: past it its request ends, and its turn here with it.
          const headWait = body?.stream === true ? silentMs : headMs;
          const late = new AbortController();
          const head = setTimeout(() => late.abort(), headWait);
          /** @type {Awaited<ReturnType<typeof forwardRequest>>} */
          let fw;
          try {
            fw = await forwardRequest({ url: there, headers: sent, bodyString, signal: signal ? AbortSignal.any([signal, late.signal]) : late.signal, fetchImpl: way.fetch, refuseRedirect: redirectGone });
          } catch (/** @type {any} */ e) {
            if (signal?.aborted || e?.offline) throw e;
            if (late.signal.aborted) throw gone(`${named}: it sent no answer in ${whileWords(headWait)}, and the call ended`, e);
            throw unanswered(e);
          } finally {
            clearTimeout(head);
          }
          const no = await notAnswer(fw.res);
          if (no) {
            fw.cleanup();
            throw no;
          }
          answered();
          return {
            // Silent past `silentMs` mid-reply, or past `replyMax` bytes: its request ends, its connection with it, and
            // its turn there goes to the next call then, before its reader has let the reply go.
            res: silenceEnds(fw.res, silentMs, replyMax, (why) => {
              fw.abort();
              done();
              return gone(`${named}: ${why === "silent" ? silentWords(silentMs) : `it sent more than ${replyMax >= 1024 * 1024 ? `${Math.round(replyMax / 1024 / 1024)} MB` : `${Math.round(replyMax / 1024)} KB`} in one reply`}, and the call ended`);
            }),
            cleanup: () => {
              fw.cleanup();
              done();
            },
            url: there,
          };
        } catch (e) {
          done();
          throw e;
        }
      },
      unreachable: (e) => ({ message: e?.offline || e?.busy ? String(e.message) : `${named} did not answer: ${e?.cause?.code || e?.code || e?.message}`, retryable: true }),
    },
    listModels: (opts = {}) => fetchUpstreamModels(upstream, { ...opts, read: readThere }),
    async test() {
      const t0 = performance.now();
      try {
        const got = await readThere();
        const names = got.list ? namesOfListing(got.list).names : null;
        return { ok: got.status < 400, status: got.status, ms: got.ms, models: names ? names.length : null, names: names ? names.slice(0, 500) : [], sample: got.text.slice(0, 200) };
      } catch (/** @type {any} */ e) {
        return { ok: false, status: 0, ms: Math.round(performance.now() - t0), models: null, names: [], sample: "", error: String(e?.message || e) };
      }
    },
  };
}

// @ts-check
// A client of a Filament's admin API (the owner's of 11-05): its calls, its streamed ones, and the words and exit codes
// its refusals end in. The command line asks its own Filament with it over loopback (cli/client.js `connect`), and a
// paired machine's with that machine's device token on each call (remotes.js `connectRemote`) — as this Filament's own
// calls to its machines do (index.js). Moved from cli/client.js, which says it still.

/**
 * What a command's end says to its caller — a script, or an agent that ran it: 0 done; 1 failed; 2 typed wrong; 3 no
 * Filament answers; 4 it needs the person (a sign-in in a browser, a key typed at a terminal); 5 busy — a turn runs, the
 * chat is held; 130 stopped with Ctrl+C.
 */
export const EXIT = Object.freeze({ ok: 0, failed: 1, usage: 2, noFilament: 3, needsPerson: 4, busy: 5, interrupted: 130 });

/** A command's failure, with the exit code it ends with and its words. */
export class CliError extends Error {
  /** @param {string} message @param {number} [code] @param {any} [body]  the refusal's JSON, where the server gave one */
  constructor(message, code = EXIT.failed, body = null) {
    super(message);
    this.code = code;
    this.body = body;
  }
}

/**
 * The most one answer of the admin API may be, in bytes: past it the read ends. The largest a Filament sends is a page of
 * a run's events (/runs/:id/events, up to 5000 of them), each tool call's input whole — a file written, a patch — and
 * each round's words: tens of megabytes at the very most, where a machine that means harm would send without end.
 */
export const ANSWER_MAX = 64 * 1024 * 1024;
/**
 * The most one server-sent event may be, in characters: past it the stream ends. One event is one run event or one
 * frame of a turn's words — a tool call's input, a round's text, a model's reply's blocks so far —, a few megabytes at
 * most; the same event is in the run's page of events, read under ANSWER_MAX.
 */
export const EVENT_MAX = 16 * 1024 * 1024;

/** A size as its words say it: "64 MB". @param {number} n */
const megabytes = (n) => `${Math.round(n / 1024 / 1024)} MB`;

/**
 * A reply's body as text, read no further than `most` bytes: one that says it is longer, or goes on past them, ends in
 * a CliError that names `who` sent it — the rest unread, its connection let go. `what` names the call.
 * @param {Response} r @param {number} most @param {string} who @param {string} [what]
 */
export async function bodyText(r, most, who, what = "") {
  const tooMuch = () => new CliError(`${who} sent an answer of more than ${megabytes(most)}${what ? ` to ${what}` : ""}: it is read no further`, EXIT.failed);
  if (Number(r.headers.get("content-length")) > most) {
    void r.body?.cancel().catch(() => {});
    throw tooMuch();
  }
  if (!r.body) return "";
  const reader = r.body.getReader();
  /** @type {Uint8Array[]} */
  const parts = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > most) {
      void reader.cancel().catch(() => {});
      throw tooMuch();
    }
    parts.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(parts, size));
}

/**
 * A redirect's refusal: a call goes to the machine at the address kept, and nothing of it — its token, its body — is
 * sent on to wherever the answer points. @param {Response} r @param {string} who
 */
export function redirectRefusal(r, who) {
  void r.body?.cancel().catch(() => {});
  const to = r.headers.get("location");
  return new CliError(`${who} answered with a redirect (HTTP ${r.status}${to ? ` to ${to}` : ""}): nothing is sent on to where it points`, EXIT.failed);
}

/** Whether a reply is a redirect. @param {Response} r */
export const redirected = (r) => r.status >= 300 && r.status < 400;

/**
 * A client of the Filament at `url`, whose `/api/state` said `state`. `signal`: the command's own — its Ctrl+C —, which
 * ends any call it makes. `headers` ride every call: a paired machine's device token (remotes.js), or — read at each
 * call, as a function — this machine's own owner key (cli/client.js), which each start of Filament mints anew; `remote`
 * is that machine, as this data folder paired with it, its token aside — none for this machine's own Filament.
 * @param {string} url @param {any} state @param {typeof fetch} [fetchImpl] @param {AbortSignal} [signal]
 * @param {{ headers?: Record<string, string> | (() => Record<string, string>), remote?: import("./remotes.js").Machine | null }} [o]
 */
export function clientAt(url, state, fetchImpl = fetch, signal, { headers: given = {}, remote = null } = {}) {
  /** The headers every call carries, as they are now. */
  const always = () => (typeof given === "function" ? given() : given);
  /** @param {number} ms @param {AbortSignal} [own]  the call's own stop */
  const ending = (ms, own) => AbortSignal.any([AbortSignal.timeout(ms), ...(signal ? [signal] : []), ...(own ? [own] : [])]);
  /** Who answers, in a refusal's words: the machine as paired, else its address. */
  const who = remote?.name || url;
  /**
   * One call of the admin API, its JSON whole — no more than ANSWER_MAX of it. A refusal is a CliError in the server's
   * words, its HTTP status as `status`: 409 is busy (exit 5); a redirect is never followed. `signal`: the call's own stop.
   * @param {string} method @param {string} path @param {any} [body] @param {{ headers?: Record<string, string>, timeoutMs?: number, signal?: AbortSignal }} [o]
   */
  const call = async (method, path, body, { headers = {}, timeoutMs = 120_000, signal: own } = {}) => {
    const r = await fetchImpl(`${url}/api${path}`, {
      method,
      headers: { "x-filament-ui": "1", ...always(), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      redirect: "manual",
      signal: ending(timeoutMs, own),
    });
    if (redirected(r)) throw redirectRefusal(r, who);
    const text = await bodyText(r, ANSWER_MAX, who, `${method} ${path}`);
    /** @type {any} */
    let j = null;
    try {
      j = text ? JSON.parse(text) : null;
    } catch {
      j = { text };
    }
    if (!r.ok) throw Object.assign(new CliError(refusalWords(j, r.status), busyOf(j, r.status) ? EXIT.busy : EXIT.failed, j), { status: r.status });
    return j;
  };
  return {
    url,
    state,
    remote,
    version: String(state?.version || ""),
    /** @param {string} path @param {{ timeoutMs?: number, signal?: AbortSignal }} [o] */
    get: (path, o) => call("GET", path, undefined, o),
    /** @param {string} path @param {any} [body] @param {{ headers?: Record<string, string>, timeoutMs?: number, signal?: AbortSignal }} [o] */
    post: (path, body = {}, o) => call("POST", path, body, o),
    /** @param {string} path @param {any} body */
    patch: (path, body) => call("PATCH", path, body),
    /** @param {string} path */
    del: (path) => call("DELETE", path),
    /**
     * A streamed call: each server-sent event's JSON, as it comes, to `onEvent`; the stream's end resolves. `idleMs`:
     * nothing at all for that long — no event, no ping — ends it with an `idle` error, where a network that drops its
     * packets without a word would hold it open for good (a Filament's streams ping every 15 s of silence). An event past
     * EVENT_MAX ends it too, and a redirect is a refusal.
     * @param {string} path @param {any} body @param {(event: string, data: any) => void} onEvent
     * @param {{ headers?: Record<string, string>, signal?: AbortSignal, idleMs?: number }} [o]
     */
    async stream(path, body, onEvent, { headers = {}, signal: own, idleMs = 0 } = {}) {
      const idle = new AbortController();
      /** @type {NodeJS.Timeout | undefined} */
      let timer;
      const touch = () => {
        if (!(idleMs > 0)) return;
        clearTimeout(timer);
        timer = setTimeout(() => idle.abort(), idleMs);
        timer.unref?.();
      };
      const both = [own, signal, idleMs > 0 ? idle.signal : null].filter((s) => !!s);
      try {
        touch();
        const r = await fetchImpl(`${url}/api${path}`, { method: "POST", headers: { "x-filament-ui": "1", ...always(), "content-type": "application/json", ...headers }, body: JSON.stringify(body), redirect: "manual", ...(both.length ? { signal: AbortSignal.any(/** @type {AbortSignal[]} */ (both)) } : {}) });
        if (redirected(r)) throw redirectRefusal(r, who);
        if (!r.ok) {
          const text = await bodyText(r, ANSWER_MAX, who, `POST ${path}`);
          /** @type {any} */
          let j = null;
          try {
            j = JSON.parse(text);
          } catch {
            j = { text };
          }
          throw new CliError(refusalWords(j, r.status), busyOf(j, r.status) ? EXIT.busy : EXIT.failed, j);
        }
        await readEvents(touched(/** @type {any} */ (r.body), touch), onEvent, { from: who });
        return r;
      } catch (e) {
        if (idle.signal.aborted && !own?.aborted && !signal?.aborted) throw Object.assign(new Error(`nothing came from ${url} for ${Math.round(idleMs / 1000)} s`), { idle: true });
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** @typedef {ReturnType<typeof clientAt>} Client */

/**
 * A refusal in the server's words: its `error` — an Anthropic-shaped one's message —, its `errors`, a shutdown's `note`.
 * @param {any} j @param {number} status
 */
export function refusalWords(j, status) {
  const e = j?.error;
  const words = (typeof e === "string" ? e : e?.message) || (Array.isArray(j?.errors) ? j.errors.join("; ") : "") || j?.note || j?.message || j?.text || "";
  return `${words || "Filament refused it"} (HTTP ${status})`;
}

/**
 * Whether a refusal says Filament is busy (exit 5): a turn holds the chat, work runs that a stop would cut, an account
 * is in use — any 409 but those that say a name is taken (`free`), routes still name what goes (`routes`), or a chat
 * asks a question before the message goes (`resumeQuestion`, `switchQuestion`).
 * @param {any} j @param {number} status
 */
export const busyOf = (j, status) => status === 409 && !(j?.free || j?.routes || j?.resumeQuestion || j?.switchQuestion);

/** A body's chunks as they come, `touch` called at each. @param {AsyncIterable<Uint8Array>} body @param {() => void} touch */
async function* touched(body, touch) {
  for await (const chunk of body) {
    touch();
    yield chunk;
  }
}

/**
 * Server-sent events from a body's chunks: each event's name (`message` where it gives none) and its data, parsed as
 * JSON where it is. An event longer than `most` characters ends the read with an error that names `from`, the rest unread.
 * @param {AsyncIterable<Uint8Array>} body @param {(event: string, data: any) => void} onEvent
 * @param {{ most?: number, from?: string }} [o]
 */
export async function readEvents(body, onEvent, { most = EVENT_MAX, from = "the server" } = {}) {
  const tooMuch = () => new Error(`${from} sent an event of more than ${megabytes(most)}: it is read no further`);
  const decoder = new TextDecoder();
  let buf = "";
  /** @param {string} block */
  const emit = (block) => {
    let event = "message";
    const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (!data.length) return;
    const raw = data.join("\n");
    /** @type {any} */
    let value = raw;
    try {
      value = JSON.parse(raw);
    } catch {}
    onEvent(event, value);
  };
  /** How far `buf` is known to hold no blank line: each chunk is searched from there, never from its start again. */
  let searched = 0;
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
    let i;
    while ((i = buf.indexOf("\n\n", searched)) >= 0) {
      if (i > most) throw tooMuch();
      emit(buf.slice(0, i));
      buf = buf.slice(i + 2);
      searched = 0;
    }
    if (buf.length > most) throw tooMuch();
    searched = Math.max(0, buf.length - 1);
  }
  if (buf.trim()) emit(buf);
}

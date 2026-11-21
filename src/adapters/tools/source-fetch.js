// @ts-check
// An app's fetch source, read (the Space Apps plan of 10-29, more reads): Filament asks the address the Keep showed,
// with its headers, each `{secret.NAME}` filled with the app's secret as the person typed it — never the page, never an
// agent —, and hands back what it answered, 1 MB at most within 60 s, as a command's stdout is. A redirect is followed
// on the same host alone: a sign-in sent to one host never goes on to another. How the answer reads — JSON, text, a
// feed — is the source's (core/dashboard-sources.js `rowsFrom`). Never Filament's own address: its admin API lets this
// computer in with no token, and a fetch asks from this computer (found reviewing the Space work, 10-29). Nor another
// Filament's, known by the mark on its answers: a person's other services on this computer are read as any host is.
import { COMMAND_BYTES, COMMAND_MS, FETCH_LOOPBACK, HOST_SECRET, SECRET_REF, headerBarred, hostNamesSecret } from "../../core/dashboard-sources.js";
import { hiddenIn, hider } from "../../core/app-secrets.js";
import { plainText } from "../../core/feed-xml.js";
import { FILAMENT_MARK } from "../../core/headers.js";

/** How many times an answer may send the read on, on its own host. */
export const FETCH_REDIRECTS = 5;
/** What each way of reading asks for, where the source names no accept of its own. */
const ACCEPT = {
  json: "application/json, */*;q=0.5",
  text: "text/plain, */*;q=0.5",
  rss: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.5",
};

/** Whether an address may be read: HTTPS, or HTTP on this computer (core's own rule, for where a redirect goes). @param {URL} u */
const fetchable = (u) => u.protocol === "https:" || (u.protocol === "http:" && FETCH_LOOPBACK.includes(u.hostname));
/** Whether an address is Filament's own: this computer, on the port it listens on. @param {URL} u @param {number | null} own */
const filamentsOwn = (u, own) => !!own && FETCH_LOOPBACK.includes(u.hostname) && Number(u.port || (u.protocol === "https:" ? 443 : 80)) === own;

/**
 * A fetch read: what its address answered, or why not in words — a secret not typed, Filament's own address or another's, a header
 * a fetch may not send, a host it was sent on to, an answer of 400 or more with its first words, too much, too long,
 * stopped (`signal`: its app paused, taken out or kept again while it read).
 * @param {import("../../core/dashboard-sources.js").Fetch} f
 * @param {{ secrets?: Record<string, string>, signal?: AbortSignal, fetch?: (url: string, init: RequestInit) => Promise<Response>, ms?: number, bytes?: number, port?: () => number | null }} [o]
 *   `secrets`: the app's, by name, as typed; `port`: the one Filament listens on, never read
 * @returns {Promise<import("../../core/dashboard-sources.js").CommandOut>}
 */
export async function fetchSource(f, { secrets = {}, signal, fetch = (url, init) => globalThis.fetch(url, init), ms = COMMAND_MS, bytes = COMMAND_BYTES, port = () => null } = {}) {
  // Checked at publish too; here for a source kept before that was.
  const barred = Object.keys(f.headers || {}).find(headerBarred);
  if (barred) return { ok: false, error: `it sets the header ${barred}, which a fetch may not send` };
  // And its host, as its address is parsed: a secret there would go out in the name looked up, and in a failure's words.
  if (hostNamesSecret(f.url)) return { ok: false, error: `its ${HOST_SECRET}` };
  /** @type {Set<string>} */
  const missing = new Set();
  /** @param {string} text @param {(v: string) => string} as */
  const fill = (text, as) =>
    text.replace(SECRET_REF, (_, n) => {
      if (typeof secrets[n] === "string" && secrets[n]) return as(secrets[n]);
      missing.add(n);
      return "";
    });
  // In the address a secret is one part of it, encoded; in a header, as typed.
  const first = fill(f.url, encodeURIComponent);
  const headers = Object.fromEntries(Object.entries(f.headers || {}).map(([k, v]) => [k, fill(v, (x) => x)]));
  if (missing.size) {
    const names = [...missing];
    return { ok: false, error: `${names.join(" and ")} ${names.length > 1 ? "are" : "is"} not typed yet: the app's ⋯ › Secrets… takes ${names.length > 1 ? "them" : "it"}` };
  }
  if (!Object.keys(headers).some((k) => k.toLowerCase() === "accept")) headers.accept = ACCEPT[f.as] || ACCEPT.json;
  if (!Object.keys(headers).some((k) => k.toLowerCase() === "user-agent")) headers["user-agent"] = "Filament";
  const stop = new AbortController();
  /** @type {string | null} */
  let cut = null;
  const timer = setTimeout(() => {
    cut = `it did not answer in ${ms / 1000} s`;
    stop.abort();
  }, ms);
  timer.unref?.();
  const stopped = () => {
    cut = "it was stopped";
    stop.abort();
  };
  if (signal?.aborted) stopped();
  else signal?.addEventListener("abort", stopped, { once: true });
  try {
    let at = new URL(first);
    const host = at.host;
    /** @type {Response} */
    let res;
    for (let hop = 0; ; hop++) {
      // Its first address and each one it is sent on to.
      if (filamentsOwn(at, port())) return { ok: false, error: `${at.host} is Filament's own address: a fetch never reads it — a filament source reads Filament's own rows` };
      res = await fetch(at.href, { headers, redirect: "manual", signal: stop.signal });
      // Another Filament on this computer, at a port of its own: its answer, a redirect too, is never read.
      if (res.headers.has(FILAMENT_MARK)) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, error: `${at.host} is a Filament's address: a fetch never reads one — a filament source reads this Filament's own rows` };
      }
      const to = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!to) break;
      await res.body?.cancel().catch(() => {});
      const next = new URL(to, at);
      if (next.host !== host || !fetchable(next)) return { ok: false, error: `${host} sent it on to ${namesSecret(next.host, secrets) ? "another host" : `${next.protocol}//${next.host}`}, which is not the host kept: Filament goes no further` };
      if (hop + 1 > FETCH_REDIRECTS) return { ok: false, error: `${host} sent it on more than ${FETCH_REDIRECTS} times` };
      at = next;
    }
    /** @type {Uint8Array[]} */
    const parts = [];
    let got = 0;
    const reader = res.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (got > bytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, error: `${host} answered more than ${bytes / 1_048_576} MB` };
      }
      parts.push(value);
    }
    const text = Buffer.concat(parts).toString("utf8");
    if (!res.ok) {
      // Its secrets hidden before its words are made plain and cut: a tag or an entity inside one would change it past
      // every form looked for after; and a JSON answer's own escapes read first, as its rows' are — PHP's \/ or .NET's
      // + would spell one past every form (found reviewing the Space work, 10-29).
      const hide = hider(secrets).text;
      let body = text;
      try {
        body = JSON.stringify(hiddenIn(JSON.parse(text), hide));
      } catch {}
      const said = plainText(body, hide).slice(0, 200);
      return { ok: false, error: `${host} answered ${res.status}${res.statusText ? ` ${res.statusText}` : ""}${said ? `: ${said}` : ""}` };
    }
    return { ok: true, out: text };
  } catch (/** @type {any} */ e) {
    if (cut) return { ok: false, error: cut };
    const why = e?.cause?.code || e?.cause?.message || e?.message || String(e);
    return { ok: false, error: `${safeHost(first)} could not be reached (${why})` };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stopped);
  }
}

/**
 * Whether a host another sent the read on to may hold a secret, which its words never name: the server chose it, and
 * its parser lowercased it, or wrote it as punycode, past every form looked for (found reviewing the Space work, 10-29).
 * @param {string} host @param {Record<string, string>} secrets
 */
function namesSecret(host, secrets) {
  const h = host.toLowerCase();
  return /(^|\.)xn--/.test(h) || Object.values(secrets).some((v) => typeof v === "string" && v.length > 0 && h.includes(v.toLowerCase()));
}

/** An address's host, for a failure's words: never its path or query, where a secret may sit. @param {string} url */
function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "the address";
  }
}

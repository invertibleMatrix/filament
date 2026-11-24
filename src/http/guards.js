// @ts-check
// The doors every request passes: the body reader with its size cap, the inbound key check for the model endpoints,
// the Host-header check for everything browser-reachable, and the admin check for /api. Each takes the `server`
// config section as a parameter (call sites read `config.get().server` per call), so a guard never holds a stale copy.
import { timingSafeEqual } from "node:crypto";
import { lowerHeaders } from "../core/headers.js";
import { credentialOf, isHouseCall } from "../services/house.js";
import { modelsLentTo } from "../services/devices.js";
import { lanNames } from "../services/lan-tls.js";
import { OWNER_HEADER, OWNER_SESSION_HEADER, ownerAt } from "../services/owner.js";
import { tailnetDoor } from "../services/tailscale.js";

/** Constant-time string compare; both sides coerced to strings, a length mismatch answers false. */
export const safeEq = (a, b) => {
  const A = Buffer.from(String(a ?? "")),
    B = Buffer.from(String(b ?? ""));
  return A.length > 0 && A.length === B.length && timingSafeEqual(A, B);
};

// A Host header must name this machine. Web pages can make a browser send requests to 127.0.0.1 under a hostname they
// control (DNS rebinding); such requests carry Host "evil.example:port". IP literals cannot be rebound, so they pass.
/** @returns {string | null} the lowercased host without port or brackets; null when there is no Host header, "" when it does not parse */
export const hostNameOf = (req) => {
  const host = String(req.headers.host || "");
  if (!host) return null;
  try {
    return new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return "";
  }
};
/** @param {string} h */
export const isIpLiteral = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^[0-9a-f:]+$/i.test(h);
/**
 * Whether a page's Origin is this server: the same host, or localhost and 127.0.0.1 on the same port. A browser sends
 * Origin on every cross-site write and on every WebSocket, so loopback trust never extends to another site's page — the
 * admin API's writes, the run socket and a terminal's stream all ask it.
 * @param {string} origin @param {string} host  the request's Host header
 */
export const ownOrigin = (origin, host) => {
  try {
    const o = new URL(origin);
    return o.host === host || (o.hostname === "localhost" && `127.0.0.1:${o.port}` === host) || (o.hostname === "127.0.0.1" && `localhost:${o.port}` === host);
  } catch {
    return false;
  }
};
/** The request arrived over the loopback interface — which a proxy on this machine's requests do too: ask isLocalCaller. */
export const isLoopback = (req) => {
  const a = req.socket.remoteAddress || "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
};
// What a reverse proxy adds as it hands on a request it took from another machine: `tailscale serve` (its Tailscale-User-*
// and X-Forwarded-For), Caddy, nginx, a Cloudflare tunnel. Such a proxy runs on this machine, so its requests reach
// Filament over loopback, and without this they came from the whole tailnet or the internet with this machine's trust.
const PROXY_HEADERS = new Set(["forwarded", "via", "x-real-ip", "x-client-ip", "true-client-ip", "cf-connecting-ip"]);
const PROXY_PREFIXES = ["x-forwarded-", "tailscale-"];
/** The request carries what a reverse proxy adds when it forwards another machine's request. */
export const proxied = (req) =>
  Object.keys(req.headers || {}).some((k) => {
    const n = k.toLowerCase();
    return PROXY_HEADERS.has(n) || PROXY_PREFIXES.some((p) => n.startsWith(p));
  });
/**
 * A caller on this machine: over loopback and handed on by no proxy. Every trust given to "this computer" asks this, never
 * isLoopback alone — an SSH tunnel adds no header and still counts as local, as its user signed in to this machine. So
 * does any forwarder that adds none of these headers (a TCP forward: socat, `netsh interface portproxy`, `tailscale
 * serve --tcp`, ngrok's tcp): judged by headers, local trust is what this machine's own port forwards give it — Filament
 * is shared through an HTTP proxy that says so, or by pairing (the security review of 882809c20, a limit kept).
 */
export const isLocalCaller = (req) => isLoopback(req) && !proxied(req);
/**
 * The request came in at the tailnet's door (services/tailscale.js): over loopback, at a port tailscale serve hands on
 * to — Filament's pages', or the artifacts' — where nothing else is served, while Filament is served on the tailnet.
 * @param {import("node:http").IncomingMessage} req
 */
export const onTailnetDoor = (req) => {
  const d = tailnetDoor();
  const at = /** @type {any} */ (req.socket)?.localPort;
  return !!d && isLoopback(req) && (at === d.port || at === d.artDoor);
};

/**
 * The whole request body as a string, capped at `maxBytes`.
 * Over the cap the stream is drained, not destroyed: the 413 must reach the client.
 * @param {import("node:http").IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<string>}
 */
export function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", function onData(c) {
      size += c.length;
      if (size > maxBytes) {
        chunks.length = 0;
        req.off("data", onData);
        req.resume();
        reject(Object.assign(new Error("request body too large"), { status: 413 }));
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Thrown by a body reader that has already answered the client (the admin API's 400 for malformed JSON, its 413 over
 * the cap): the handler stops where it asked for the body, and the dispatcher that owns the response swallows it.
 * Before this, the reader answered AND returned null, and eight admin routes carried on with `{}` — POST /failover
 * saved `failover: true` on a malformed body it had just refused.
 */
export class BodyRefused extends Error {
  constructor() {
    super("request body refused; the client has its answer");
  }
}

/**
 * The requests a chat's turn route took in (POST /api/sessions/:id/turns): the admin gate let its caller in — this
 * computer, the admin token, a full device, another machine's agents' device its grant lets run agents — so the
 * pipeline it is handed to asks it for no inbound key, and a page
 * on another machine sends its turn with its session alone (the owner's remote Filament of 11-06). Not the house key:
 * that one lets lineage headers through and keeps the turn out of memory's capture.
 * @type {WeakSet<import("node:http").IncomingMessage>}
 */
const sessionTurns = new WeakSet();
/**
 * Of them, those whose caller reads its own chats alone — another machine's agents' device (the remote-agents plan's
 * f-fence) —: no session it names is loaded for it (`readsEverySession`), and memory's tools keep to its project.
 * @type {WeakSet<import("node:http").IncomingMessage>}
 */
const ownChatsOnly = new WeakSet();
/**
 * Mark a request the turn route took in, its caller let in by the admin gate; `reads: false` where that caller reads its
 * own chats alone. @param {import("node:http").IncomingMessage} req @param {{ reads?: boolean }} [o]
 */
export const markSessionTurn = (req, { reads = true } = {}) => {
  sessionTurns.add(req);
  if (!reads) ownChatsOnly.add(req);
};

/**
 * The model endpoints' key check: Filament's own calls pass on the house key, a chat's turn its route took in
 * (`markSessionTurn`), and another machine's chats' call the network's door let in by its agents' device's token
 * (services/devices.js `modelsLentTo`, `modelsDevice`) — never asked this machine's inbound key; anyone else's only when
 * `server.requireAuth` is off, or when their Bearer or x-api-key equals one of `server.inboundKeys`.
 * @param {import("node:http").IncomingMessage} req
 * @param {any} server  the `server` config section
 */
export function checkInboundAuth(req, server) {
  if (sessionTurns.has(req) || modelsLentTo(req)) return true;
  const h = lowerHeaders(req.headers);
  if (isHouseCall(h)) return true;
  if (!server.requireAuth) return true;
  const key = credentialOf(h);
  return !!key && (server.inboundKeys || []).some((k) => safeEq(k, key));
}

/**
 * The DNS-rebinding guard for the dashboard and the admin API: no Host header (a non-browser client) passes; an
 * unparseable one does not. localhost, IP literals, the configured host and `server.allowedHosts` pass.
 * @param {import("node:http").IncomingMessage} req
 * @param {any} server  the `server` config section
 */
export function hostAllowed(req, server) {
  const hn = hostNameOf(req);
  if (hn === null) return true;
  if (hn === "") return false;
  if (hn === "localhost" || hn.endsWith(".localhost") || isIpLiteral(hn)) return true;
  const own = String(server.host || "").toLowerCase();
  if (own && hn === own) return true;
  // The network listener's certificate names this machine (lan-tls.js `lanNames`): a browser that opens it by that name
  // is let in — over its TLS alone, where a page that rebound the name meets this certificate, never its own.
  if (/** @type {any} */ (req.socket)?.encrypted && lanNames().includes(hn)) return true;
  // This machine's name on the tailnet, at the tailnet's door alone: tailscale serve took it over its own TLS, with the
  // certificate an authority signed for that name, so a page that rebound the name meets that certificate, never its own.
  if (onTailnetDoor(req) && hn === tailnetDoor()?.name) return true;
  return (server.allowedHosts || []).some((x) => String(x).toLowerCase() === hn);
}

/** The cookie a paired device's browser holds its token in (the owner's remote Filament of 11-06). */
export const DEVICE_COOKIE = "filament_device";
/** The page a browser no one paired claims a code on (ui/pair.html): the harness and the console send it there. */
export const PAIR_PAGE = "/ui/pair.html";
/**
 * Its name over https: a `__Host-` cookie is Secure, Path=/ and no domain's, so no other site under the same name sets
 * or shadows it (the security review of 882809c20). Plain http on the LAN has none such: a browser sends a host's
 * cookies to each of its ports.
 */
export const SECURE_DEVICE_COOKIE = `__Host-${DEVICE_COOKIE}`;
/** What a device token starts with (services/devices.js `TOKEN_PREFIX`): a Bearer that is one is a device's. */
const DEVICE_TOKEN = "fdt_";
/** A request's cookies by name; a value that does not decode is kept as sent. @param {import("node:http").IncomingMessage} req */
export const cookiesOf = (req) => {
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of String(lowerHeaders(req.headers).cookie || "").split(";")) {
    const at = part.indexOf("=");
    const name = at < 0 ? "" : part.slice(0, at).trim();
    if (!name) continue;
    const raw = part.slice(at + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
};
/**
 * Whether a request came over a way no one on the network reads (the owner's remote Filament of 11-06, Part 2): TLS to
 * this Filament itself (the network's listener, services/lan-tls.js), or loopback — this machine, a proxy here that
 * took it over its own TLS (tailscale serve), an SSH tunnel. A device's token is taken, and handed out, over such a
 * way alone: plain http from another machine would carry it for anyone on the network to read. A proxy here that says
 * it took the request over plain http (X-Forwarded-Proto, Forwarded's proto) hands on what the network read (the review
 * of p2-lan); one that says nothing is believed, as an SSH tunnel is.
 * @param {import("node:http").IncomingMessage} req
 */
export const sealedWay = (req) => !!(/** @type {any} */ (req.socket)?.encrypted) || (isLoopback(req) && !forwardedPlain(req));
/** The ways a proxy here says it took the request: X-Forwarded-Proto's, a list too, and Forwarded's proto. @param {import("node:http").IncomingMessage} req */
const protosSaid = (req) => {
  const h = lowerHeaders(req.headers);
  return [...String(h["x-forwarded-proto"] || "").split(","), ...[...String(h.forwarded || "").matchAll(/proto="?([a-z]+)/gi)].map((m) => m[1])].map((p) => p.trim().toLowerCase()).filter(Boolean);
};
/** A proxy's word that it took the request over plain http. @param {import("node:http").IncomingMessage} req */
const forwardedPlain = (req) => protosSaid(req).includes("http");
/**
 * A proxy's word that it took the request over https: it says so, and says nothing else — read as `sealedWay` reads
 * it, so a claim sealedWay lets go over a proxy gets the cookie only https carries (the hunt of p1-auth: "https, https",
 * or Forwarded's proto alone, was sealed, and the cookie went out without Secure).
 * @param {import("node:http").IncomingMessage} req
 */
export const forwardedHttps = (req) => {
  const said = protosSaid(req);
  return said.length > 0 && said.every((p) => p === "https");
};
/** Whether a request's key — the one `credentialOf` reads, its Bearer or its x-api-key — is a device's token. @param {import("node:http").IncomingMessage} req */
export const sendsDeviceKey = (req) => credentialOf(lowerHeaders(req.headers)).startsWith(DEVICE_TOKEN);
/** Whether a request's Bearer is a device's token, a cookie aside. @param {import("node:http").IncomingMessage} req */
const deviceBearer = (req) => String(lowerHeaders(req.headers).authorization || "").replace(/^bearer\s+/i, "").trim().startsWith(DEVICE_TOKEN);
/** A paired device's token: its browser's cookie, or a Bearer the CLI sends. "" for none. @param {import("node:http").IncomingMessage} req */
export const deviceTokenOf = (req) => {
  const jar = cookiesOf(req);
  const cookie = jar[SECURE_DEVICE_COOKIE] || jar[DEVICE_COOKIE];
  if (cookie) return cookie;
  const bearer = String(lowerHeaders(req.headers).authorization || "").replace(/^bearer\s+/i, "").trim();
  return bearer.startsWith(DEVICE_TOKEN) ? bearer : "";
};
/**
 * How long a device's cookie lasts: 400 days, the most a browser keeps one. It is sent again as the device's pages are
 * opened (`cookieAgain`), so one in use never runs out; unused, its pairing lapses sooner (services/devices.js
 * UNUSED_DAYS), and revoking it ends it at once.
 */
export const DEVICE_COOKIE_DAYS = 400;
/** How often a device's cookie is sent again at the most: a day apart, for each device. */
const COOKIE_AGAIN_MS = 86_400_000;
/**
 * A device's cookie: over https a `__Host-` one (`SECURE_DEVICE_COOKIE`), plain http on loopback the plain one.
 * @param {string} value @param {number} maxAge  seconds; 0 takes it away @param {boolean} secure
 */
export const deviceCookie = (value, maxAge, secure) => `${secure ? SECURE_DEVICE_COOKIE : DEVICE_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
/** When each device's cookie was sent again (`cookieAgain`), by its id: the pages' and the admin API's one count. @type {Map<string, number>} */
const cookiesSent = new Map();
/**
 * A device's cookie sent again, its DEVICE_COOKIE_DAYS counted afresh: the one its request came with, under the name it
 * came by, a day apart at the most for each device (`sent`, by its id — what was sent when). "" where none is owed: the
 * device came by a Bearer, or its cookie was sent again within the day.
 * @param {import("node:http").IncomingMessage} req  one that signs in as that device by its cookie (`cookieDevice`)
 * @param {string} id  the device's @param {Map<string, number>} [sent] @param {number} [at]
 */
export function cookieAgain(req, id, sent = cookiesSent, at = Date.now()) {
  const jar = cookiesOf(req);
  const secure = !!jar[SECURE_DEVICE_COOKIE];
  const value = jar[SECURE_DEVICE_COOKIE] || jar[DEVICE_COOKIE];
  if (!value || at - (sent.get(id) || 0) < COOKIE_AGAIN_MS) return "";
  sent.set(id, at);
  return deviceCookie(value, DEVICE_COOKIE_DAYS * 86_400, secure);
}
/**
 * Where a request came from, as a limiter counts it and a device's last seen says it: the address a proxy on this
 * machine says it handed on, else the socket's. Only a proxy on this machine is believed: another machine's request
 * names whatever it likes, and its socket is what it is. Of X-Forwarded-For, the last: a proxy appends the address it
 * took the request from (Go's, under `tailscale serve`; nginx's `$proxy_add_x_forwarded_for`), and what stands before
 * it is the caller's own word — the first let a caller pass the per-address limit, or hold another's address (the
 * security review of 882809c20).
 * @param {import("node:http").IncomingMessage} req
 */
export const callerAddress = (req) => {
  if (isLoopback(req) && proxied(req)) {
    const last = String(lowerHeaders(req.headers)["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean).at(-1);
    if (last) return last;
  }
  return String(req.socket?.remoteAddress || "");
};

/** The admin token in a header (`x-filament-admin` or a Bearer), where `server.adminToken` is set. @param {import("node:http").IncomingMessage} req @param {any} server */
const adminTokenIn = (req, server) => {
  if (!server.adminToken) return false;
  const h = lowerHeaders(req.headers);
  return safeEq(h["x-filament-admin"], server.adminToken) || safeEq((h["authorization"] || "").replace(/^bearer\s+/i, ""), server.adminToken);
};

/**
 * The login a request's caller is signed in to the tailnet as, where it is this machine's own and
 * server.tailscale.trustOwnLogin trusts that; "" else. Read at the tailnet's door alone, from Tailscale-User-Login —
 * which tailscale serve sets itself, clearing any a caller sent, and sets none for a tagged machine or a request from the
 * internet (Funnel, which it marks so).
 * @param {import("node:http").IncomingMessage} req @param {any} server  the `server` config section
 */
const ownTailnetLogin = (req, server) => {
  const d = tailnetDoor();
  if (server?.tailscale?.trustOwnLogin !== true || !d?.login || !onTailnetDoor(req)) return "";
  const h = lowerHeaders(req.headers);
  return !h["tailscale-funnel-request"] && String(h["tailscale-user-login"] || "") === d.login ? d.login : "";
};

/** What each request said of this computer's owner key (`ownerOf`), read once. @type {WeakMap<import("node:http").IncomingMessage, "owner" | "stale" | "none">} */
const ownerSaid = new WeakMap();
/**
 * What a request says of this computer's owner key (services/owner.js), read once and taken out of it — the key's
 * header and the app's windows' session header both —, so no route, record or log holds either: `owner` where it came
 * over loopback, through no proxy, with the key of the Filament at the port it reached, or a browser session minted
 * with it; `stale` where it carried one that is not (a key or session of an earlier start: the app's window before it
 * took the new one); `none` where it carried neither, or came through a proxy, where the key counts for nothing.
 * @param {import("node:http").IncomingMessage} req
 * @returns {"owner" | "stale" | "none"}
 */
export function ownerOf(req) {
  const was = ownerSaid.get(req);
  if (was) return was;
  if (!req.headers) return "none";
  const sent = String(req.headers[OWNER_HEADER] ?? "");
  const session = String(req.headers[OWNER_SESSION_HEADER] ?? "");
  delete req.headers[OWNER_HEADER];
  delete req.headers[OWNER_SESSION_HEADER];
  const owner = ownerAt(/** @type {any} */ (req.socket)?.localPort);
  /** @type {"owner" | "stale" | "none"} */
  let said = "none";
  if ((sent || session) && !isLocalCaller(req)) owner?.proxied();
  else if (sent || session) said = owner && (owner.holds(sent) || owner.sessionHolds(session)) ? "owner" : "stale";
  if (said === "owner" && sent && owner?.holds(sent)) keySent.add(req);
  ownerSaid.set(req, said);
  return said;
}
/** The requests that sent the owner key itself in OWNER_HEADER (`ownerOf`): not a window's session. @type {WeakSet<object>} */
const keySent = new WeakSet();
/**
 * Whether the request sent this computer's owner key itself (`ownerOf`) — a program that read owner.key: the command
 * line, the desktop app's main process —, never a page, whose window holds a session alone, which its script cannot
 * read. With the app's press key (`pressedWithKey`), which the command line never holds, it is the app's main process
 * alone (http/admin/keys-copy.js). @param {import("node:http").IncomingMessage} req
 */
export const ownerKeySent = (req) => (ownerOf(req), keySent.has(req));
/**
 * A call of this computer's that came without its owner key, counted by the program that sent it at the Filament
 * listening at its port (services/owner.js `tokenless`): what would be refused once the key is needed. Answered all the
 * same. One with a key or session of an earlier start is not counted (`stale`), nor one carrying a device's token — an
 * SSH tunnel's page, which is that device's —, read by its presence alone, so no device is marked seen by it.
 * @param {import("node:http").IncomingMessage} req @param {Caller | null} who  as `whoIs` said it
 */
export function countOwnerless(req, who) {
  if (who?.kind !== "local" || who.owner || ownerOf(req) !== "none" || deviceTokenOf(req)) return;
  ownerAt(/** @type {any} */ (req.socket)?.localPort)?.tokenless(req.headers?.["user-agent"]);
}

/**
 * Who calls (the owner's remote Filament of 11-06): this computer through no proxy (`local`) — `owner` where it sent
 * this computer's owner key or the app's window's session (`ownerOf`), or is a browser here, which for now changes
 * nothing —, a holder of
 * `server.adminToken` (`admin`), a machine signed in to the tailnet as this one is, where that is trusted (`tailnet`,
 * `ownTailnetLogin`), a paired device by its token — its scope, full or view, or another machine's agents' (`agent`,
 * `agentsDevice`), its grants on `device.grants` — over a sealed way (`sealedWay`), or nobody Filament knows (null).
 * A device's token over loopback with no owner key — the desk's calls through an SSH tunnel, another machine's agents
 * through one — is that device, as from afar: its scope, its grants and an agents' fence hold through a tunnel too. A
 * browser here (devices.js `here`: `filament open`'s, the tray's) is this computer's owner, at this Filament's own name
 * alone (`atItsName`), as the app's window is by its session: its token names it. A device's Bearer that does not verify — revoked, replaced, lapsed — is no one's, so an
 * agents' device stops at its revoke; a cookie that does not — another port's: a browser sends a host's cookies to each
 * of its ports — leaves the caller this computer. A tailnet login that carries a device's token is the login, and its
 * device is counted in use all the same (its verify).
 * @typedef {{ kind: "local", owner?: true } | { kind: "admin" } | { kind: "tailnet", login: string } | { kind: "device", device: import("../services/devices.js").Device, scope: import("../services/devices.js").Scope }} Caller
 * @param {import("node:http").IncomingMessage} req
 * @param {any} server  the `server` config section
 * @param {import("../services/devices.js").DeviceStore | null} [devices]  none: no device is known
 * @returns {Caller | null}
 */
export function whoIs(req, server, devices = null) {
  const owner = ownerOf(req) === "owner";
  if (isLocalCaller(req)) {
    if (owner) return { kind: "local", owner: true };
    const device = deviceOfToken(req, devices);
    // A browser here, at this Filament's own name: the person at this computer, as its pairing — made with the owner
    // key or the app's press — says. It does what this computer's owner does, but what needs the key itself (a window's
    // session, keys copied) or, while the app holds its key, a press.
    if (device?.here) return { kind: "local", owner: true };
    if (device) return { kind: "device", device, scope: device.scope };
    return !device && devices && deviceBearer(req) ? null : { kind: "local" };
  }
  if (adminTokenIn(req, server)) return { kind: "admin" };
  const login = ownTailnetLogin(req, server);
  if (login) {
    // Let in by its login, it may carry the token a pairing gave it too: that device is in use, its days counted afresh.
    deviceOfToken(req, devices);
    return { kind: "tailnet", login };
  }
  return deviceCaller(req, devices);
}
/**
 * The paired device a request signs in as, by its token alone, whatever else it is: what is a device's own — the
 * browser's host its app holds, the chat its app drives (http/admin/browser.js) — stays that device's where `whoIs`
 * says a tailnet login Filament trusts first. Over plain http from the network, a device's token is no one's: it came
 * where anyone could read it (`sealedWay`). Null for none.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("../services/devices.js").DeviceStore | null} [devices]
 * @returns {Extract<Caller, { kind: "device" }> | null}
 */
export function deviceCaller(req, devices = null) {
  const device = deviceOfToken(req, devices);
  // A browser here is this computer itself on its loopback (`whoIs`), never a device of its own: from the network its
  // token is no one's.
  return device && !device.here ? { kind: "device", device, scope: device.scope } : null;
}
/**
 * The device a request's token verifies as, a browser here's too, over a sealed way; null for none.
 * @param {import("node:http").IncomingMessage} req @param {import("../services/devices.js").DeviceStore | null} devices
 */
const deviceOfToken = (req, devices) => {
  const token = devices && sealedWay(req) ? deviceTokenOf(req) : "";
  return atItsName((token && devices?.verify(token, callerAddress(req))) || null, req, devices);
};
/**
 * A device as a request may sign in as it: a browser here at this Filament's own name alone (devices.js `takenAt`), the
 * one it was paired at — directly, or at an SSH tunnel's other end —; one a browser holds anywhere else (127.0.0.1's,
 * which a browser sends to every port of it) is no one's, whatever Host its sender says (the reviews of s0b and s0f).
 * Any other device as it is.
 * @param {import("../services/devices.js").Device | null} device @param {import("node:http").IncomingMessage} req
 * @param {import("../services/devices.js").DeviceStore | null} devices
 */
const atItsName = (device, req, devices) => (!device?.here || devices?.takenAt?.(device.id, hostNameOf(req)) ? device : null);
/**
 * The device a request's cookie signs in as — a browser here's too —, over a sealed way, whoever `whoIs` says the
 * caller is (a tailnet login it trusts first, this computer itself): the device its cookie is sent again for
 * (`cookieAgain`), which a verify counts as in use. Null for none, and for a Bearer's.
 * @param {import("node:http").IncomingMessage} req @param {import("../services/devices.js").DeviceStore | null} [devices]
 */
export const cookieDevice = (req, devices = null) => {
  const jar = cookiesOf(req);
  const cookie = jar[SECURE_DEVICE_COOKIE] || jar[DEVICE_COOKIE];
  return atItsName((cookie && devices && sealedWay(req) && devices.verify(cookie, callerAddress(req))) || null, req, devices);
};
/**
 * The browser here a request on this computer's loopback signs in as (devices.js `here`), or null.
 * @param {import("node:http").IncomingMessage} req @param {import("../services/devices.js").DeviceStore | null} [devices]
 */
export const hereDevice = (req, devices = null) => {
  const device = isLocalCaller(req) ? deviceOfToken(req, devices) : null;
  return device?.here ? device : null;
};
/**
 * The person's device a request's token belongs to that went unused past its days (services/devices.js `lapsed`), taken
 * over a sealed way as `deviceCaller` takes one — its refusal says to pair it again —; null for any other.
 * @param {import("node:http").IncomingMessage} req @param {import("../services/devices.js").DeviceStore | null} [devices]
 */
export function lapsedDevice(req, devices = null) {
  const token = devices && sealedWay(req) ? deviceTokenOf(req) : "";
  return token ? devices?.lapsed(token) ?? null : null;
}
/**
 * The header this computer's press carries the desktop app's key in (`pressRefusal`): its harness page sends it on its
 * writes (ui/harness/lib/api.js), handed the key by its window's bridge (desktop/harness-preload.cjs `filamentApp`).
 */
export const PRESS_HEADER = "x-filament-press";
/** What this computer's press without the app's key is told: never the key, nor where it is. */
export const PRESS_REFUSED =
  "while the Filament app runs, this computer's answer to an ask, and what a chat may run unasked, come from its window, with the key the app holds: this one came from another program here, without it — answer it in the app";
/** What the admin token without the app's key is told as it presses: a program here reads it from the config, or sets it there. */
export const ADMIN_PRESS_REFUSED =
  "while the Filament app runs, an answer to an ask, and what a chat may run unasked, come from its window or a paired device: the admin token presses nothing while it runs — answer it in the app";
/**
 * What a tailnet login Filament trusts is told as it presses without the app's key: a program here reaches the tailnet's
 * door over loopback and says the login itself. A browser paired once over the tailnet presses with its device.
 */
export const TAILNET_PRESS_REFUSED =
  "while the Filament app runs, an answer to an ask, and what a chat may run unasked, come from its window or a paired device: a tailnet login presses nothing while it runs, as a program on that machine could say the login itself. Pair this browser once: make a code in the app's Settings › Remote access there, and open its tailnet link here";
/** What this computer's caller, a tailnet login or the admin token without the app's key is told as it pairs or sets a grant (`doorRefused`). */
export const DOOR_REFUSED =
  "while the Filament app runs, a pairing's code, and what another machine's agents may do here, come from its window, with the key the app holds: this came without it — from another program here, over the tailnet or with the admin token — make it in the app's Settings › Remote access";
/** What a device a program on this computer paired without the app's key is told as it presses (devices.js `pressless`). */
export const PRESSLESS_REFUSED =
  "while the Filament app runs on this machine, a device paired without its key presses nothing — an ask's answer, an Allow, what a chat may run unasked: a program here paired this one, not the app's Settings › Remote access. Pair it again from there, in the Filament app";
/** The shortest key taken: the app's is 32 random bytes, said in base64url. */
const PRESS_KEY_MIN = 32;
/**
 * The desktop app's key for this computer's presses (the security review's DESK-1): any program here reaches the admin
 * API as `local` with no secret — the model's own background shell among them —, so while the app holds a key, the
 * press of an ask is the app window's alone. Made by the app as it starts, handed to the Filament it starts over the
 * utility process's port (`hearPressKey`) — never an environment variable, which every program Filament runs would
 * inherit and any program of the person's could read — and to its harness page by its preload. "" where no app handed
 * one — a plain browser, a server, the CLI, a Filament the app attached to —: every press is as it was.
 */
let pressKey = "";
/** The key, set in this process; "" for none. @param {unknown} k */
export const setPressKey = (k) => {
  pressKey = typeof k === "string" ? k : "";
};
/**
 * The app's key heard on the port its utility process has (Electron's `process.parentPort`, desktop/main.js): the first
 * one heard holds, and the port is heard no more. Nothing where Filament runs under no app.
 * @param {{ on: (event: "message", fn: (e: any) => void) => unknown, off?: (event: "message", fn: (e: any) => void) => unknown } | undefined} port
 */
export function hearPressKey(port) {
  if (typeof port?.on !== "function") return;
  /** @param {any} e */
  const heard = (e) => {
    const k = e?.data?.pressKey;
    if (typeof k !== "string" || k.length < PRESS_KEY_MIN) return;
    port.off?.("message", heard);
    if (!pressKey) pressKey = k;
  };
  port.on("message", heard);
}
hearPressKey(/** @type {any} */ (process).parentPort);
/** The requests whose caller may not press (`pressRefusal`), each with why. @type {WeakMap<import("node:http").IncomingMessage, string>} */
const unpressed = new WeakMap();
/** The requests that carried the app's key itself (`pressRefusal`): not a device's press, nor one no key is held for. @type {WeakSet<import("node:http").IncomingMessage>} */
const withKey = new WeakSet();
/**
 * Whether the request carried the key the desktop app holds (`pressRefusal`): the app's own window or its main process,
 * on this computer — never a device, whose press the gate lets in all the same, nor any caller where no app holds a key.
 * What only the app may ask asks this (http/admin/keys-copy.js). @param {import("node:http").IncomingMessage} req
 */
export const pressedWithKey = (req) => withKey.has(req);
/** The requests whose caller may not pair, nor set a grant (`pressRefusal`), each with why. @type {WeakMap<import("node:http").IncomingMessage, string>} */
const unopened = new WeakMap();
/**
 * Whether a caller's press is the person's: while the app holds a key, this computer's caller (`local`) presses with it
 * alone, sent in PRESS_HEADER — or with a full device's token: a page of the person's other machine comes in over
 * loopback through an SSH tunnel. A device from elsewhere presses as the gate let it in; a tailnet login presses with
 * a full device's token alone — a program here reaches the tailnet's door over loopback and says the login itself —,
 * and the admin token presses nothing while the app holds a key — a program here reads it from the config, or sets it
 * there, and sends it as a proxy would. A device a program here paired without the key presses nowhere, nor the agents' device it minted
 * (devices.js `pressless`; the xd-key hunt's: one paired so pressed for that program, over loopback or the network's
 * door). The header is taken out of the request as it is read, so no route, record or log holds the key. → null where
 * it may press; else why not, and `pressRefused` says so of the request from then on. A pairing and a grant of another
 * machine's agents' are the door (`doorRefused`): whoever may not press may not open it, nor may a tailnet login — any
 * program on the person's machines carries it, and one here reaches the tailnet's door over loopback and says the login
 * itself —, nor the admin token: a program here reads it from the config, or sets it there, and sends it as a proxy would.
 * @param {import("node:http").IncomingMessage} req @param {Caller | null} who
 * @param {import("../services/devices.js").DeviceStore | null} [devices]
 * @returns {string | null}
 */
export function pressRefusal(req, who, devices = null) {
  const sent = req.headers[PRESS_HEADER];
  delete req.headers[PRESS_HEADER];
  if (pressKey && safeEq(sent, pressKey)) withKey.add(req);
  if (!pressKey || safeEq(sent, pressKey)) return null;
  if (who?.kind === "admin") {
    unopened.set(req, DOOR_REFUSED);
    unpressed.set(req, ADMIN_PRESS_REFUSED);
    return ADMIN_PRESS_REFUSED;
  }
  if (who?.kind === "device" && !who.device.pressless) return null;
  if (who?.kind !== "device" && who?.kind !== "local" && who?.kind !== "tailnet") return null;
  const token = who?.kind === "local" || who?.kind === "tailnet" ? deviceTokenOf(req) : "";
  const named = who?.kind === "device" ? who.device : token ? devices?.verify(token, callerAddress(req)) : null;
  // A browser here presses as this computer does: never, while the app holds its key.
  const device = named?.here ? null : named;
  if (device?.scope === "full" && !device.pressless) return null;
  const why = device?.pressless ? PRESSLESS_REFUSED : who?.kind === "tailnet" ? TAILNET_PRESS_REFUSED : PRESS_REFUSED;
  unpressed.set(req, why);
  unopened.set(req, device?.pressless ? PRESSLESS_REFUSED : DOOR_REFUSED);
  return why;
}
/** Why the request's caller was refused a press (`pressRefusal`), or null where it was not. @param {import("node:http").IncomingMessage} req */
export const pressRefused = (req) => unpressed.get(req) ?? null;
/**
 * Why the request's caller may not pair a device here, nor set another machine's agents' grants (`pressRefusal`): while
 * the app holds a key, its window does both — a grant lets those agents run commands here as the person. Null where it may.
 * @param {import("node:http").IncomingMessage} req
 */
export const doorRefused = (req) => unopened.get(req) ?? null;
/**
 * Whether a caller may drive this Filament as you do: this computer, the admin token, your own tailnet login, a full
 * device — never a view device, nor another machine's agents' device. @param {Caller | null} who
 */
export const drives = (who) => !!who && (who.kind !== "device" || who.scope === "full");
/**
 * Whether a caller is another machine's agents' device (the remote-agents plan's f-grant): it reaches what its grants
 * let it (remote.js `agentRefusal`), and nothing that serves the person — a terminal, the run socket, an artifact.
 * @param {Caller | null} who @returns {who is { kind: "device", device: import("../services/devices.js").Device, scope: "agent" }}
 */
export const agentsDevice = (who) => who?.kind === "device" && who.scope === "agent";
/**
 * What a paired device holds open — a terminal, the run socket, the events stream — ends once it is revoked or signs
 * out: `end` runs then (the security review of 882809c20: its token stopped at once, and a terminal it had open still
 * typed into this machine). Another machine's agents' device's ends too as the grant it was let in by is switched off —
 * `agents` (or `copies`, where that alone let it in), or `models` for a model's answer streaming to it (the remote-agents plan's f-answer: only its new requests
 * were refused, and a run's events it followed went on). Any other caller's holds on. → what stops listening, for the
 * connection's close.
 * @param {import("../services/devices.js").DeviceStore | null} devices @param {Caller | null} who @param {() => void} end
 * @param {keyof import("../services/devices.js").Grants} [grant]
 * @returns {() => void}
 */
export function endsWithDevice(devices, who, end, grant = "agents") {
  if (who?.kind !== "device" || !devices?.onRevoke) return () => {};
  const id = who.device.id;
  const unRevoke = devices.onRevoke((gone) => {
    if (gone === id) end();
  });
  // Let in by Run on alone (`copies`, Agents off: http/admin/remote.js `COPY_ROUTES`), it ends as that goes off, never
  // as another grant changes (the review of s2a: switching Models cut its sends).
  const byCopies = grant === "agents" && who.device.grants?.agents !== true && who.device.grants?.copies === true;
  const unGrant = agentsDevice(who) && devices.onGrant
    ? devices.onGrant((set, grants) => {
        if (set === id && grants[grant] !== true && !(byCopies && grants.copies === true)) end();
      })
    : () => {};
  return () => {
    unRevoke();
    unGrant();
  };
}

/**
 * The agents' device a model call at the network's door comes from, where it may use this machine's models (the
 * remote-agents plan's m-door): its token where a model client sends its key — a Bearer, or x-api-key —, over a sealed
 * way (`sealedWay`), an agents' device's, its grant `models` on. → `{ device }` let in; `{ status, why }` refused, in
 * words; null where the call names no device's token, and is refused as any caller is. A view or full device is the
 * person's, never another machine's chats: neither holds a grant (services/devices.js `grant`).
 * @param {import("node:http").IncomingMessage} req @param {import("../services/devices.js").DeviceStore | null} devices
 * @returns {{ device: import("../services/devices.js").Device } | { status: number, why: string } | null}
 */
export function modelsDevice(req, devices) {
  const key = credentialOf(lowerHeaders(req.headers));
  if (!devices || !key.startsWith(DEVICE_TOKEN)) return null;
  if (!sealedWay(req)) return { status: 403, why: "a device's token is taken over https alone: this call came where anyone on the network could read it" };
  const device = devices.verify(key, callerAddress(req));
  if (!device) return { status: 401, why: "this device's token is not one this Filament knows: it was revoked, or replaced" };
  if (device.scope !== "agent")
    return { status: 403, why: `${device.name} is the person's own device: this machine's models answer another machine's chats, by the device of its agents, its grant switched on` };
  if (device.grants.models !== true)
    return { status: 403, why: `${device.name} may not use this machine's models: its grant is switched on in Settings › Remote access — by this computer, or a full device paired with it` };
  return { device };
}

/**
 * /api answers a local caller (isLocalCaller: loopback, through no proxy), the admin token from a header
 * (`x-filament-admin` or a Bearer) where `server.adminToken` is set, your own tailnet login where it is trusted, and a
 * paired device (`devices`) — whoIs.
 * @param {import("node:http").IncomingMessage} req
 * @param {any} server  the `server` config section
 * @param {import("../services/devices.js").DeviceStore | null} [devices]
 */
export function adminAllowed(req, server, devices = null) {
  return whoIs(req, server, devices) !== null;
}

/**
 * Whether a request's caller could read every session anyway, as the admin API would answer it: a chat's turn its route
 * took in (the admin gate let its caller in) — never one whose caller reads its own chats alone (`ownChatsOnly`), nor
 * another machine's chats' model call (`modelsLentTo`), whose device reads none —, or its Host names this machine and
 * whoIs knows its caller. What a model request may name for memory to load (services/house.js `READER_HEADERS`) asks it.
 * @param {import("node:http").IncomingMessage} req
 * @param {any} server  the `server` config section
 */
export const readsEverySession = (req, server) => !ownChatsOnly.has(req) && !modelsLentTo(req) && (sessionTurns.has(req) || (hostAllowed(req, server) && adminAllowed(req, server)));

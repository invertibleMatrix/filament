// @ts-check
// The one request listener: an artifact's address first — a name under `art.localhost` reaches its artifact's files
// and nothing else of Filament's (HarnessV4_Artifacts_Plan AF-D2), and a request an artifact's page sends anywhere else
// is refused — then the drain guard, the memory-engine rewrite,
// and the table — the model endpoints, MCP (`/mcp/memory` for any agent, `/mcp/<token>` for an ACP agent's), an app's
// hooks (`/hook/<app>/<token>`), a watcher's address (`/watch/<token>`), the browser-facing surfaces behind the Host
// guard, and the 404. Guards come from guards.js;
// the areas from admin/*, static.js, artifacts.js and the Responses front door.
import { sendJson } from "../app/pipeline/respond.js";
import { errorBody } from "../core/wire/errors.js";
import { FILAMENT_MARK, lowerHeaders } from "../core/headers.js";
import { handleCountTokens } from "../app/count-tokens.js";
import { handleEmbeddings } from "../app/embeddings.js";
import { listModels } from "../app/models.js";
import { createRouter } from "./router.js";
import { PAIR_PAGE, readBody, checkInboundAuth, cookieAgain, cookieDevice, endsWithDevice, hostAllowed, hostNameOf, modelsDevice, onTailnetDoor, ownerOf, sendsDeviceKey, whoIs } from "./guards.js";
import { originAllowed } from "./memory-mcp.js";
import { isHouseCall } from "../services/house.js";
import { lendModels, modelsLentTo } from "../services/devices.js";
import { selfAddress } from "../services/config/store.js";
import { serveStatic, serveDoc } from "./static.js";
import { artifactNameOfHost, isArtifactOrigin, passHidden, stillNameOfHost } from "../core/artifacts.js";
import { MACHINE_PROTOCOL, MACHINE_PROTOCOL_LOWEST } from "../services/machine.js";
import { CONVERSATION_HEADERS } from "../core/conversation.js";

/** The model endpoints' paths, the memory engine's door to them included: their answers bear no `FILAMENT_MARK`. */
const MODEL_PATH = /^\/(v1\/|memory-engine\/|(messages|chat\/completions|responses|embeddings|models)\/*$)/;
/**
 * What Filament answers while memory opens, read at Filament's own address: a GET of the pages' files, `/health`, and
 * `/api/state`, which the desktop app asks to learn that Filament answers — none of them reads memory — and a stop
 * (`POST /api/shutdown`, the desktop app's Quit and Restart), which reads memory only to name the chats whose turns hold
 * it, none while memory opens, and which a stop during the open waits out (server.js).
 */
const ANSWERS_WHILE_OPENING = /^\/(health|\.well-known\/filament|api\/state|ui(\/.*)?|docs\/.+)?\/*$/;
const STOPS_WHILE_OPENING = /^\/api\/shutdown\/*$/;
/**
 * The desktop app's windows' browser session, minted as Filament answers its state (admin/owner.js): it needs nothing of
 * memory, and the app asks it before its windows load, so a slow open held them on no session (the hunt on s0a).
 */
const MINTS_WHILE_OPENING = /^\/api\/owner\/session\/*$/;
/**
 * The events stream (`GET /api/events`), which waits for memory's open however long it takes: it lives as long as its
 * page, and a page's EventSource answered anything but its stream is closed for good.
 */
const WAITS_OUT_OPENING = /^\/api\/events\/*$/;
/** What answers on this machine alone, never on the network's listener: the model endpoints, MCP, the memory engine's door, an app's hooks. */
const HERE_ALONE = /^\/(v1|mcp|hook|memory-engine)(\/|$)|^\/(messages|chat\/completions|responses|embeddings|models)\/*$/;
/** Its refusal's words. */
export const HERE_ALONE_WORDS = "this address serves Filament's pages to the devices paired with it; the model endpoints, MCP, an app's hooks and an artifact's address answer on the machine Filament runs on alone";
/**
 * A watcher's address (`/watch/<token>`, watch-hooks.js): at the network's door it answers where that door is the
 * tailnet's (guards.js `onTailnetDoor`), never on the network's listener.
 */
const WATCH_PATH = /^\/watch(\/|$)/;
const WATCH_WORDS = "a watcher's address answers on the machine Filament runs on and at its tailnet's door, never on the network's listener";
/**
 * A path as a log line says it: an address whose last part is what opens it — an agent's MCP door (`/mcp/<token>`), a
 * connector's (`/mcp/c/<signed>`), an app's hook (`/hook/<app>/<token>`), a watcher's (`/watch/<token>`) — is said by
 * its door alone. The log is a file an agent can read: one that read its watcher's address there could wake itself,
 * and another chat's MCP token opens that chat's tools. Memory's door (`/mcp/memory`) is a name, and stays. An
 * artifact's pass in its path (`/~<pass>/`, http/artifacts.js) is said as `/~…/` (core/artifacts.js `passHidden`): a
 * pass read there opens that artifact, or every one (the hunt on x41).
 * @param {string} p
 */
export const pathShown = (p) =>
  passHidden(
    p
      .replace(/^\/mcp\/c\/.+$/, "/mcp/c/…")
      .replace(/^\/mcp\/(?!memory(?:\/|$)|c\/)[^/]+.*$/, "/mcp/…")
      .replace(/^\/hook\/([^/]+)\/.+$/, "/hook/$1/…")
      .replace(/^\/watch\/.+$/, "/watch/…"),
  );
/**
 * The model endpoints another machine's chats reach at the network's door, by its agents' device with its grant `models`
 * on (the remote-agents plan's m-door): a message, a chat completion, a response, a count of tokens, the model list.
 */
const LENT_PATH = /^\/v1\/(messages(\/count_tokens)?|chat\/completions|responses|models)\/*$/;
/**
 * How many calls one device may have in flight on this machine's models at once (the review of m-door): its chats are
 * another machine's, and this machine's own wait behind no more of them than that. One past it is answered 429.
 */
export const LENT_IN_FLIGHT = 4;
/**
 * How long an answer to another machine's chat waits for it to read on — its socket to drain — before it ends, and the
 * provider's request with it: a stream nobody reads would hold one of the provider's slots (services/health.js
 * `ConcurrencyGate`) for good, and this machine's own chats queue behind it.
 */
export const LENT_STALL_MS = 60_000;
/** Each device's calls in flight, by its id, at every network door. @type {Map<string, number>} */
const inFlight = new Map();
/**
 * `res` ended once it has waited `ms` to drain: its reader read none of it that long. What counts is the reader's
 * progress — each drain —, never whether the buffer is full when looked at: a provider faster than the reader fills it
 * again at once, so a reader reading on steadily would be found full at every look. Looked at a few times in that
 * while, never per write; a look that finds it waited too long looks once more after the drains already come in
 * (`setImmediate`, past the poll for I/O), so a pause of this process is never taken for its reader's.
 * @param {import("node:http").ServerResponse} res @param {number} ms
 */
const endsUnread = (res, ms) => {
  let read = Date.now();
  const readOn = () => void (read = Date.now());
  const waited = () => res.writableNeedDrain && Date.now() - read >= ms;
  res.on("drain", readOn);
  const look = setInterval(() => {
    if (!res.writableNeedDrain) return readOn();
    if (waited()) setImmediate(() => waited() && res.destroy());
  }, Math.max(50, Math.min(5000, Math.floor(ms / 4))));
  look.unref();
  res.on("close", () => (clearInterval(look), res.off("drain", readOn)));
};

/**
 * The network's door to the front door (services/lan-tls.js, the owner's remote Filament of 11-06, Part 2): an
 * artifact's address, and what answers on this machine alone, are refused before the front door is reached — turning
 * the network on opens no door to a coding agent's folder by an inbound key (turn.js `exposedListener` reads only
 * server.host); anything else is the front door's, guarded as any caller's is. Of the model endpoints, LENT_PATH's
 * answer another machine's chats, by its agents' device's token over a sealed way, its grant `models` on
 * (guards.js `modelsDevice`; the remote-agents plan's m-door): the call is marked theirs (`lendModels`) and sent with no
 * header of Filament's own — a client of this machine's sends those, never another machine's chats, whose memory,
 * folder and session are their own —, and what streams to it ends as the device is revoked or its grant switched off,
 * or as it reads none of it for `stallMs` (`LENT_STALL_MS`). A device has LENT_IN_FLIGHT calls in flight at the most.
 * @param {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => unknown} front
 * @param {{ devices?: import("../services/devices.js").DeviceStore | null, stallMs?: number }} [o]  `devices` none: no
 *   device is known, and the model endpoints answer no one here
 */
export const lanDoor = (front, { devices = null, stallMs = LENT_STALL_MS } = {}) => (/** @type {import("node:http").IncomingMessage} */ req, /** @type {import("node:http").ServerResponse} */ res) => {
  let path = "";
  try {
    path = new URL(req.url || "", "http://x").pathname;
  } catch {}
  const art = artifactNameOfHost(hostNameOf(req)) !== null;
  if (!art && WATCH_PATH.test(path) && !onTailnetDoor(req)) {
    res.setHeader(FILAMENT_MARK, "1");
    return sendJson(res, 404, { error: WATCH_WORDS });
  }
  if (!art && !HERE_ALONE.test(path)) return front(req, res);
  const lent = !art && LENT_PATH.test(path) ? modelsDevice(req, devices) : null;
  // A device's call refused is said in its client's wire, as the front door says its own refusals.
  const anthropic = /^\/v1\/messages(\/|$)/.test(path) || (path.startsWith("/v1/models") && !!lowerHeaders(req.headers)["anthropic-version"]);
  if (lent && "device" in lent) {
    const { id, name } = lent.device;
    const busy = inFlight.get(id) || 0;
    if (busy >= LENT_IN_FLIGHT) {
      res.setHeader(FILAMENT_MARK, "1");
      res.setHeader("retry-after", "5");
      return sendJson(res, 429, errorBody(anthropic ? "anthropic" : "openai", 429, `${name} has ${busy} calls in flight on this machine's models, the most one device may: send this one once one of them ends`));
    }
    inFlight.set(id, busy + 1);
    res.on("close", () => {
      const left = (inFlight.get(id) || 1) - 1;
      if (left > 0) inFlight.set(id, left);
      else inFlight.delete(id);
    });
    // Filament's own headers are none of theirs, and their chat's ids ride no further (the m-door hunt's): Traffic kept one
    // as the call's client session, and the rules sent it on to this machine's provider.
    for (const header of Object.keys(req.headers)) if (header.startsWith("x-filament-") || CONVERSATION_HEADERS.includes(header)) delete req.headers[header];
    lendModels(req, lent.device);
    res.on("close", endsWithDevice(devices, { kind: "device", device: lent.device, scope: lent.device.scope }, () => res.destroy(), "models"));
    endsUnread(res, stallMs);
    return front(req, res);
  }
  res.setHeader(FILAMENT_MARK, "1");
  if (lent) return sendJson(res, lent.status, errorBody(anthropic ? "anthropic" : "openai", lent.status, lent.why));
  return sendJson(res, 404, { error: HERE_ALONE_WORDS });
};

/** A model call's path, under /v1 or not, as the front door answers either. */
const MODEL_CALL = /^\/(v1\/)?(messages(\/count_tokens)?|chat\/completions|responses|models|embeddings)\/*$/;
/**
 * The main listener's door: a model call that sends a device's token is another machine's chats' — its agents' device
 * through an SSH tunnel, which lands here on loopback — and passes the network's door (`lanDoor`): its grant `models`, a
 * revoke, the calls one device may have; one at a path that door lends none at is refused. Never is it answered as a
 * client's of this computer's. Anything else goes to the front door.
 * @param {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => unknown} front
 * @param {{ devices?: import("../services/devices.js").DeviceStore | null, stallMs?: number }} [o]
 */
export const mainDoor = (front, o = {}) => {
  const lent = lanDoor(front, o);
  return (/** @type {import("node:http").IncomingMessage} */ req, /** @type {import("node:http").ServerResponse} */ res) => {
    let path = "";
    try {
      path = new URL(req.url || "", "http://x").pathname;
    } catch {}
    if (!MODEL_CALL.test(path) || !sendsDeviceKey(req)) return front(req, res);
    if (LENT_PATH.test(path)) return lent(req, res);
    res.setHeader(FILAMENT_MARK, "1");
    return sendJson(res, 404, errorBody(path.includes("messages") ? "anthropic" : "openai", 404, "a device's model calls go to /v1/messages, /v1/chat/completions, /v1/responses and /v1/models alone"));
  };
};

/** How long any other request waits for memory's open: past it, it is answered 503 in words, never held on. */
export const OPENING_WAIT_MS = 30_000;
/** What a request that waited that long is answered. */
export const STILL_OPENING = "Filament is still opening memory; try again in a moment";

/**
 * @param {object} front
 * @param {any} front.config  the ConfigStore
 * @param {any} front.log
 * @param {any} front.deps  AppDeps (count-tokens, embeddings, the models list read it)
 * @param {any} front.pipeline  the model-request pipeline
 * @param {any} front.responsesDoor  createResponsesFrontDoor's result
 * @param {any} front.mcp  the MCP tool server
 * @param {any} front.memoryMcp  `/mcp/memory`, memory as a service (MemoryMcp)
 * @param {ReturnType<typeof import("./mcp-connector.js").createConnectorDoor> | null} [front.connectors]  `/mcp/c/…`, a
 *   chat's signed-in connector as its coding agent reaches it (the owner's of 11-07)
 * @param {any} front.admin  createAdminHandler's result
 * @param {ReturnType<typeof import("./artifacts.js").createArtifactsHandler>} front.artifacts  an artifact's address
 * @param {ReturnType<typeof import("./hooks.js").createHookDoor> | null} [front.hooks]  `/hook/<app>/<token>`, an app's
 *   hook (phase 4 of the Space Apps plan of 10-29)
 * @param {ReturnType<typeof import("./watch-hooks.js").createWatchHookDoor> | null} [front.watchHooks]  `/watch/<token>`,
 *   a watcher's address (the plan of 11-11, its v2-b)
 * @param {() => Promise<unknown> | null} [front.opening]  live: while memory opens as Filament starts, its end; null once
 *   it has. A request that reads memory waits for it, `openingWaitMs` at the most (`OPENING_WAIT_MS`), then is answered
 *   503 (`STILL_OPENING`) — the events stream as long as it takes (`WAITS_OUT_OPENING`); `ANSWERS_WHILE_OPENING`,
 *   `STOPS_WHILE_OPENING` and `MINTS_WHILE_OPENING` are answered meanwhile.
 * @param {number} [front.openingWaitMs]
 * @param {() => boolean} front.isDraining  live: stop() sets the flag
 * @param {string} front.VERSION
 * @param {number} front.startedAt
 * @param {import("../services/machine.js").MachineStore | null} [front.machine]  this machine's id and name, which
 *   `/.well-known/filament` says
 * @param {import("../services/devices.js").DeviceStore | null} [front.devices]  the paired devices, whose browsers the
 *   harness and the console open for
 */
export function createFrontDoor({
  config,
  log,
  deps,
  pipeline,
  responsesDoor,
  mcp,
  memoryMcp,
  connectors = null,
  admin,
  artifacts,
  hooks = null,
  watchHooks = null,
  opening = () => null,
  openingWaitMs = OPENING_WAIT_MS,
  isDraining,
  VERSION,
  startedAt,
  machine = null,
  devices = null,
}) {
  /**
   * A file of the UI. The harness and the console open for a caller Filament knows — this computer, the admin token, a
   * paired device —; anyone else's browser is sent to the pairing page from any page, by any spelling of its address
   * (static.js judges the file the disk opened), and a link's #code= goes with it (a browser keeps a fragment across a
   * redirect that names none; the owner's remote Filament of 11-06). The files pages are built of and the pairing page
   * are served to anyone: they hold nothing of the person's. A device's browser is sent its cookie again, a day apart at
   * the most (guards.js `cookieAgain`), so a browser in use never lets it run out.
   * @param {any} r @param {string} path
   */
  const page = (r, path) => {
    const who = whoIs(r.req, config.get().server, devices);
    if (!who) return serveStatic(r.res, path, ownPort(), { stranger: PAIR_PAGE });
    // The device its cookie signs in as, whoever lets it in — a tailnet login, a browser here on this computer — too.
    const named = who.kind === "device" ? who.device : cookieDevice(r.req, devices);
    const again = named ? cookieAgain(r.req, named.id) : "";
    if (again) r.res.setHeader("set-cookie", again);
    return serveStatic(r.res, path, ownPort());
  };
  /** The port Filament listens on now. */
  const ownPort = () => (deps.selfPort ? deps.selfPort() : config.get().server.port);
  /** Where Filament reaches itself now (`selfAddress`): the address a refused page is pointed at instead. */
  const ownBase = () => (deps.selfBase ? deps.selfBase() : selfAddress(config.get().server));
  // The model list, in the shape the client speaks: an Anthropic client announces itself with anthropic-version. Another
  // machine's chats are listed the models they may call (`lanDoor`).
  const models = (r) => {
    if (!checkInboundAuth(r.req, config.get().server))
      return sendJson(r.res, 401, errorBody("openai", 401, "invalid or missing API key"));
    return listModels(
      deps,
      r.res,
      lowerHeaders(r.req.headers)["anthropic-version"] || r.url.searchParams.get("format") === "anthropic"
        ? "anthropic"
        : "openai",
      { lent: !!modelsLentTo(r.req) },
    );
  };
  const route = createRouter([
    ["POST", "/v1/messages", (r) => pipeline.handle(r.req, r.res, "anthropic")],
    ["POST", "/messages", (r) => pipeline.handle(r.req, r.res, "anthropic")],
    ["POST", "/v1/chat/completions", (r) => pipeline.handle(r.req, r.res, "openai")],
    ["POST", "/chat/completions", (r) => pipeline.handle(r.req, r.res, "openai")],
    ["POST", "/v1/responses", (r) => responsesDoor.handle(r.req, r.res)],
    ["POST", "/responses", (r) => responsesDoor.handle(r.req, r.res)],
    ["POST", "/v1/messages/count_tokens", (r) => handleCountTokens(deps, r.req, r.res)],
    ["POST", "/v1/embeddings", (r) => handleEmbeddings(deps, r.req, r.res)],
    ["POST", "/embeddings", (r) => handleEmbeddings(deps, r.req, r.res)],
    ["GET", "/v1/models", models],
    ["GET", "/models", models],
    [
      "GET",
      "/health",
      (r) => sendJson(r.res, 200, { ok: true, version: VERSION, uptimeMs: Date.now() - startedAt }),
    ],
    // Who answers here, for another Filament adding this machine (the owner's remote Filament of 11-06): its id, its
    // name, the wire it speaks and the oldest it still speaks (services/machine.js `protocolGap`), and its version. Asked
    // before any pairing, by whatever name reached it — a tailnet name no Host check knows yet included — so it says
    // nothing a stranger could use: no path, no key, no session.
    ...(machine
      ? /** @type {import("./router.js").RouteRow[]} */ ([
          ["GET", "/.well-known/filament", (r) => sendJson(r.res, 200, { ...machine.get(), protocol: MACHINE_PROTOCOL, protocolLowest: MACHINE_PROTOCOL_LOWEST, version: VERSION }, { "cache-control": "no-store" })],
        ])
      : []),
    ["*", "/api/:rest*", (r) => admin(r.req, r.res, r.url)],
    ["GET", "/", (r) => page(r, "/")],
    ["GET", "/ui", (r) => page(r, "/ui")],
    ["GET", "/ui/:rest*", (r) => page(r, r.path)],
    ["GET", "/docs/:rest*", (r) => serveDoc(r.res, r.path)],
  ]);
  return async function frontDoor(req, res) {
    // A request-target no address reads (`GET http://x:999999/`) is answered 400 here: its parse would otherwise throw
    // before any answer below, and the request would wait unanswered.
    let url;
    try {
      url = new URL(req.url || "", "http://x");
    } catch {
      res.setHeader(FILAMENT_MARK, "1");
      return sendJson(res, 400, { error: "the request's target is no address" });
    }
    // Every answer of Filament's own, a refusal and a 404 too: another Filament's fetch knows this one by it, at any
    // port. The model endpoints' answers are a client's wire, as they were; a fetch only GETs, and they hold no rows.
    if (!MODEL_PATH.test(url.pathname)) res.setHeader(FILAMENT_MARK, "1");
    // This computer's owner key and the app's session, read and taken out of every request before anything below
    // reads its headers (guards.js `ownerOf`): no record, log or route holds either.
    ownerOf(req);
    // The fence (AF-D2): an artifact's page runs on its own origin, which Filament's admin check would take for its own,
    // so its address is answered by its files alone — every path, every method, before anything below is reached.
    const host = hostNameOf(req);
    const art = artifactNameOfHost(host);
    // While memory opens as Filament starts, a request waits for it, unless it is one answered meanwhile; one that has
    // waited `openingWaitMs` is answered 503 in words, in a model client's own wire on a model endpoint, but the events
    // stream, which waits it out.
    const wait = opening();
    const meanwhile =
      art === null &&
      (((req.method === "GET" || req.method === "HEAD") && ANSWERS_WHILE_OPENING.test(url.pathname)) || (req.method === "POST" && (STOPS_WHILE_OPENING.test(url.pathname) || MINTS_WHILE_OPENING.test(url.pathname))));
    if (wait && !meanwhile) {
      if (art === null && req.method === "GET" && WAITS_OUT_OPENING.test(url.pathname)) await wait;
      else {
        /** @type {NodeJS.Timeout | undefined} */
        let timer;
        const open = await Promise.race([wait.then(() => true), new Promise((r) => (timer = setTimeout(() => r(false), openingWaitMs).unref()))]);
        clearTimeout(timer);
        if (!open) {
          res.setHeader("retry-after", "5");
          const p = url.pathname;
          const anthropic = /^\/(v1\/)?messages(\/|$)/.test(p) || (/^\/(v1\/)?models\/*$/.test(p) && (!!lowerHeaders(req.headers)["anthropic-version"] || url.searchParams.get("format") === "anthropic"));
          return sendJson(res, 503, MODEL_PATH.test(p) ? errorBody(anthropic ? "anthropic" : "openai", 503, STILL_OPENING) : { error: STILL_OPENING });
        }
      }
    }
    if (art !== null) {
      // A still preview's address (`<name>.still.art.localhost`) is its artifact's, held to reading.
      const still = stillNameOfHost(host);
      try {
        return await artifacts(req, res, still ?? art, url, { still: still !== null });
      } catch (/** @type {any} */ e) {
        log("error", `artifact ${art || "(no name)"}: ${req.method} ${passHidden(url.pathname)}: ${e?.stack || e}`);
        if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end("The artifact could not be served.\n");
        else res.end();
        return;
      }
    }
    // A request an artifact's page sends elsewhere — to Filament's own address — is refused too, whatever its path: the
    // page's policy allows no such request, and this holds where a browser would send one all the same.
    const origin = lowerHeaders(req.headers).origin;
    if (isArtifactOrigin(origin)) {
      log("warn", `blocked ${req.method} ${pathShown(url.pathname)} from an artifact's page (${origin})`);
      return sendJson(res, 403, { error: "an artifact's page reaches nothing of Filament's" });
    }
    let p = url.pathname.replace(/\/+$/, "") || "/";
    // The memory engine's own model calls arrive under /memory-engine/: served like /v1, tagged as memory's, never
    // captured. Its child process authenticates with the house key (it was handed it at spawn), so the door and the
    // tag are Filament's alone: a client knocking here would otherwise file its own calls as the engine's.
    if (p.startsWith("/memory-engine/")) {
      if (!isHouseCall(lowerHeaders(req.headers)))
        return sendJson(res, 403, errorBody("openai", 403, "/memory-engine/ is the memory engine's own door; clients call /v1"));
      p = p.slice("/memory-engine".length);
      req.headers["x-filament-memory"] = "off";
      req.headers["x-filament-memory-purpose"] = "engine";
    }
    try {
      if (
        isDraining() &&
        (p.startsWith("/v1/") ||
          p.startsWith("/mcp/") ||
          p.startsWith("/hook/") ||
          p.startsWith("/watch/") ||
          p === "/messages" ||
          p === "/chat/completions" ||
          p === "/embeddings")
      ) {
        res.setHeader("retry-after", "5");
        return sendJson(
          res,
          503,
          errorBody("anthropic", 503, "Filament is restarting; try again in a few seconds"),
        );
      }
      // A model endpoint answers a Host that names this machine, as the admin API does: a page elsewhere whose name was
      // rebound to this address (DNS rebinding) reaches the port through the person's browser, and is no client. A
      // program that calls by another of this machine's names has it in server.allowedHosts.
      if (MODEL_PATH.test(p) && !hostAllowed(req, config.get().server))
        return sendJson(
          res,
          421,
          errorBody(
            /^\/(v1\/)?messages(\/|$)/.test(p) ? "anthropic" : "openai",
            421,
            `Host "${req.headers.host}" does not name this machine (protects against DNS rebinding): call http://127.0.0.1:${ownPort()}${p}, or add the name to server.allowedHosts`,
          ),
        );
      if (p.startsWith("/mcp/")) {
        if (!hostAllowed(req, config.get().server))
          return sendJson(res, 421, {
            error: `Host "${req.headers.host}" does not name this machine (protects against DNS rebinding)`,
          });
        // Memory as a service (HarnessV3-Memory M7-6): any agent's MCP client, behind its own door; an ACP door's token
        // is hex, so it is never this path.
        if (p === "/mcp/memory") return await memoryMcp.handle(req, res, url);
        // An agent's door: its callers are agents, never a page, so a page from elsewhere is refused as memory's door
        // refuses one; a token that names no session is answered before its body is read; a body past the cap is a 413.
        const origin = lowerHeaders(req.headers).origin;
        if (!originAllowed(origin, config.get().server)) return sendJson(res, 403, { error: `a page at ${String(origin).slice(0, 80)} may not reach an agent's tools` });
        const connector = p.startsWith("/mcp/c/") && connectors;
        const token = p.slice(5).split("/")[0];
        if (!connector && mcp.refuseUnknown(req, res, token)) return;
        let body = "";
        if (req.method === "POST")
          try {
            body = await readBody(req, config.get().server.maxBodyBytes);
          } catch (/** @type {any} */ e) {
            return sendJson(res, e?.status === 413 ? 413 : 400, { error: e?.status === 413 ? "request body too large" : "the body could not be read" });
          }
        // A chat's signed-in connector (http/mcp-connector.js): its address is signed, and its token is added there.
        if (connector) return await connector.handle(req, res, p.slice(7), body);
        return await mcp.handle(req, res, token, body);
      }
      // An app's hook (phase 4): a POST from this computer, kept as a record of its collection — its own guards.
      if (p.startsWith("/hook/") && hooks) return await hooks(req, res, p);
      // A watcher's address (v2-b): a program's post, which wakes the watcher its token opens — its own guards.
      if (p.startsWith("/watch/") && watchHooks) return await watchHooks(req, res, p);
      if (
        p.startsWith("/api/") ||
        p === "/" ||
        p === "/ui" ||
        p.startsWith("/ui/") ||
        p.startsWith("/docs/")
      ) {
        if (!hostAllowed(req, config.get().server))
          return sendJson(res, 421, {
            error: `Host "${req.headers.host}" does not name this machine; open ${ownBase()}/ instead (protects against DNS rebinding)`,
          });
      }
      const m = route(req.method, p);
      if (m) return await m.handler({ req, res, url, path: p });
      return sendJson(res, 404, { error: `not found: ${req.method} ${p}` });
    } catch (/** @type {any} */ e) {
      // Its path as a log says it: a token door's without its token (`pathShown`).
      log("error", `unhandled error in ${req.method} ${pathShown(p)}: ${e?.stack || e}`);
      if (!res.headersSent) sendJson(res, 500, { error: e.message });
      else res.end();
    }
  };
}

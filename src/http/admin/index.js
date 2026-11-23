// @ts-check
// The dashboard's API (/api/*): one route table assembled from its areas — system, traffic, config,
// upstreams, coding agents, memory, runs, sessions, teams, saved agents, files, git, terminal, MCP servers, providers,
// models across providers, artifacts, the projects' Spaces, the teams beside a chat, a chat's flows, a chat's browser,
// plugins, skills, language servers — behind the two guards every admin route shares (loopback-or-token, then the
// CSRF pair). The admin context `a` is built once by the composition root and carries the services and the few
// server-locals the areas need.
import { sendJson } from "../../app/pipeline/respond.js";
import { BACK_PATH } from "../../app/sessions/mcp-sign-in.js";
import { agentsDevice, cookieAgain, cookieDevice, countOwnerless, doorRefused, endsWithDevice, lapsedDevice, whoIs, ownOrigin, pressRefusal, readBody, BodyRefused, PAIR_PAGE } from "../guards.js";
import { CLAIM_PATH, SIGN_OUT_PATH, VIEW_FOLDER_ROWS, agentBodyRefusal, agentFileRefusal, agentFolderRefusal, agentHeaderRefusal, agentRefusal, aliasedPath, copiesRefusal, remoteRoutes, viewFolderRefusal, viewReads } from "./remote.js";
import { LAPSED_WORDS, UNUSED_DAYS, fullControl } from "../../services/devices.js";
import { lowerHeaders } from "../../core/headers.js";
import { createRouter } from "../router.js";
import { systemRoutes } from "./system.js";
import { trafficRoutes } from "./traffic.js";
import { configRoutes } from "./config.js";
import { upstreamRoutes } from "./upstreams.js";
import { codingAgentRoutes } from "./coding-agents.js";
import { memoryRoutes } from "./memory.js";
import { runRoutes } from "./runs.js";
import { sessionRoutes } from "./sessions.js";
import { teamRoutes } from "./teams.js";
import { agentCardRoutes } from "./agents.js";
import { fileRoutes } from "./files.js";
import { gitRoutes } from "./git.js";
import { terminalRoutes } from "./terminal.js";
import { mcpServerRoutes } from "./mcp-servers.js";
import { providerRoutes } from "./providers.js";
import { modelRouteRoutes } from "./model-routes.js";
import { artifactRoutes } from "./artifacts.js";
import { spaceRoutes } from "./spaces.js";
import { besideRoutes } from "./beside.js";
import { flowRoutes } from "./flows.js";
import { browserRoutes } from "./browser.js";
import { pluginRoutes } from "./plugins.js";
import { skillRoutes } from "./skills.js";
import { lspRoutes } from "./lsp.js";
import { execRoutes } from "./exec.js";
import { transferRoutes } from "./transfers.js";
import { coachRoutes } from "./coach.js";
import { telemetryRoutes } from "./telemetry.js";
import { starRoutes } from "./star.js";
import { ownerRoutes } from "./owner.js";
import { remoteWorkRoutes } from "./remote-work.js";
import { updateRoutes } from "./update.js";
import { pressClass } from "./press.js";

/** How long an answer a device's revoke finds not begun yet may still take before it is cut (`createAdminHandler`). */
export const REVOKED_GRACE_MS = 1000;

/**
 * @param {any} a  the admin context: { config, log, usage, ops, memory, health, bridge, agentBridges, accounts, logins,
 *   codingAgents, mcp, mcpServers, mcpSignIns, providers, assistant,
 *   alerts, events, sseClients, liveAborts, qoderLogins, overrides, VERSION, startedAt, dataDir, cfgForModels,
 *   discover, catalogue, persistModelCache, discoveryOf, ownNames, keyedFor, labelsFor, dryRun, sessions,
 *   teams, agentCards, artifacts, spaces, spaceSync, dashboards, spaceDrafts, routines, besides, letters, flows, savedFlows, spaceNames, projectSymbols, destinationFor, stopApi, drain, isDraining, onShutdown, runs, browsers, browserHost,
 *   ownSpaces, everything, pluginSources, plugins, pluginPlaces, skillStore, skillPlaces, skillLibrary, crafterChats }
 */
export function createAdminHandler(a) {
  // Match order: replay/replays/cancel before the greedy request detail; literal rows cannot shadow each other.
  const route = createRouter([
    ...systemRoutes(a),
    ...trafficRoutes(a),
    ...configRoutes(a),
    ...upstreamRoutes(a),
    ...codingAgentRoutes(a),
    ...memoryRoutes(a),
    ...runRoutes(a),
    ...sessionRoutes(a),
    ...teamRoutes(a),
    ...agentCardRoutes(a),
    ...fileRoutes(a),
    ...gitRoutes(a),
    ...terminalRoutes(a),
    ...mcpServerRoutes(a),
    ...providerRoutes(a),
    ...modelRouteRoutes(a),
    ...artifactRoutes(a),
    ...spaceRoutes(a),
    ...besideRoutes(a),
    ...flowRoutes(a),
    ...browserRoutes(a),
    ...pluginRoutes(a),
    ...skillRoutes(a),
    ...lspRoutes(a),
    ...execRoutes(a),
    ...transferRoutes(a),
    ...coachRoutes(a),
    ...telemetryRoutes(a),
    ...starRoutes(a),
    ...ownerRoutes(a),
    ...remoteWorkRoutes(a),
    ...updateRoutes(a),
    ...remoteRoutes(a),
  ]);
  return async function handleAdmin(req, res, url) {
    const path = url.pathname.replace(/^\/api/, "");
    const method = req.method;
    // Who calls (guards.js whoIs): this computer, the admin token, or a paired device (the owner's remote Filament of
    // 11-06). A pairing's claim is the one row answered before any is known — its code is what it proves — and it
    // passes the Origin and JSON checks below as every write does. A caller it does not know is told where a browser
    // pairs: the harness or console of a device revoked meanwhile goes there (ui/lib/standing.js).
    const who = whoIs(req, a.config.get().server, a.devices || null);
    // This computer's call without its owner key (services/owner.js): answered all the same, and counted by the program
    // that sent it — what would be refused once the key is needed (guards.js `countOwnerless`).
    countOwnerless(req, who);
    // Read once, and taken out of the request whatever the row: the desktop app's key (guards.js `pressRefusal`).
    const pressNo = pressRefusal(req, who, a.devices || null);
    const claim = method === "POST" && path === CLAIM_PATH;
    // One whose device went unused past its days is told so (`lapsed`, and how many: `days`, which its pages, the app and
    // the command line say): nothing was revoked, it pairs again. It may
    // still sign itself out — the desktop app and `filament connect` do so as they pair again —, so the device it
    // replaces goes, and its machine's agents' device with it (the review of s4f).
    const lapsed = who ? null : lapsedDevice(req, a.devices || null);
    if (!who && !claim && !(lapsed && method === "POST" && path === SIGN_OUT_PATH))
      return sendJson(res, 403, lapsed
        ? { error: LAPSED_WORDS, lapsed: true, days: UNUSED_DAYS, pair: PAIR_PAGE }
        : { error: "admin API answers this machine, a paired device, or server.adminToken: pair this device from Settings on the machine it reaches", pair: PAIR_PAGE });
    // A device's request ends as the device does, revoked or signed out — every stream it follows (a run's events, the
    // claims, the events feed, a turn's words) at once, whichever row answers it (the hunt of sec-revoke: a run's
    // events went on following) —, and another machine's agents' as their grant `agents` is switched off. An answer not
    // begun yet is let finish first — the sign-out's own revokes its device before it answers — and cut after
    // REVOKED_GRACE_MS if it has not.
    res.on("close", endsWithDevice(a.devices || null, who, () => {
      if (res.headersSent) return void res.destroy();
      setTimeout(() => void (res.writableEnded || res.destroy()), REVOKED_GRACE_MS).unref?.();
    }));
    // A device's cookie is sent again on its calls too, a day apart at the most (guards.js `cookieAgain`), whoever lets it
    // in: the desktop app reaches another machine by calls alone, its pages opened seldom or never. Not on the claim nor
    // the sign-out, which set their own.
    if (who && !claim && path !== SIGN_OUT_PATH) {
      const named = who.kind === "device" ? who.device : cookieDevice(req, a.devices || null);
      const again = named ? cookieAgain(req, named.id) : "";
      if (again) res.setHeader("set-cookie", again);
    }
    const h = lowerHeaders(req.headers);
    const origin = h.origin;
    if (method === "GET") {
      // A GET is guarded as a write is (below): many act — an upstream tested with its stored key, the model lists
      // fetched afresh, an agent or the memory engine started, a Space's asks settled and its sources read, a folder
      // the address names looked at — and a page of another site has the browser send one by an image or a link, with
      // no Origin. So a GET whose Origin is not this server's is refused, and one with none that the browser says
      // another site sent (Sec-Fetch-Site cross-site, or same-site: a page on another port of this machine). Filament's
      // own pages send same-origin, an address typed in sends none, and a program — the desktop app, the CLI, a
      // script — neither header. A server's sign-in coming back is the one GET another site sends by design; its
      // `state` guards it.
      const site = String(h["sec-fetch-site"] || "");
      if (url.pathname !== BACK_PATH && (origin ? !ownOrigin(origin, String(h.host || "")) : site === "cross-site" || site === "same-site")) {
        const from = origin ? `Origin ${origin}` : `Sec-Fetch-Site: ${site}`;
        a.log("warn", `blocked cross-site GET ${path} (${from})`);
        return sendJson(res, 403, { error: `cross-site request refused (${from})` });
      }
    } else {
      // CSRF guard: a browser always sends Origin on cross-site POST/PUT/DELETE. Loopback trust must not extend to
      // web pages the user happens to have open, so a mutating request whose Origin is not this server is refused.
      if (origin) {
        if (!ownOrigin(origin, String(h.host || ""))) {
          a.log("warn", `blocked cross-origin ${method} ${path} from ${origin}`);
          return sendJson(res, 403, { error: `cross-origin request refused (Origin ${origin})` });
        }
      }
      // A page's write says it is JSON, every one of them: a form on another site can send no such type without a
      // preflight, which nothing here answers. It is the second lock behind the Origin check above, so it names no
      // paths (it named 15 prefixes once, and 32 write routes had grown up outside them).
      const ct = (h["content-type"] || "").toLowerCase();
      if (origin && !ct.startsWith("application/json"))
        return sendJson(res, 415, { error: "admin writes must use Content-Type: application/json" });
    }
    const m = route(method, path);
    // The body, parsed, once: the gate below may read it before the row does, and both are handed the same. A refusal
    // is answered here — 413 over the size cap, 400 for anything else — and ends the handler with BodyRefused, so no
    // route acts on a body the client was just told was rejected.
    /** @type {Promise<any> | null} */
    let body = null;
    const json = () =>
      (body ??= (async () => {
        let text = "";
        try {
          text = await readBody(req, a.config.get().server.maxBodyBytes);
        } catch (/** @type {any} */ e) {
          if (e?.status === 413) sendJson(res, 413, { error: "request body too large" });
          else sendJson(res, 400, { error: "invalid JSON body" });
          throw new BodyRefused();
        }
        try {
          return JSON.parse(text || "{}");
        } catch {
          sendJson(res, 400, { error: "invalid JSON body" });
          throw new BodyRefused();
        }
      })());
    /**
     * The chats' folders, as a fenced device reads them — of the person's chats alone, or of one agents' device's
     * (archive.js `chatFolders`); none without an archive, so none is read.
     * @param {{ person?: boolean, agentDevice?: string }} [o] @returns {string[]}
     */
    const chatFolders = (o) => {
      try {
        return a.memory?.chatFolders?.(o) || [];
      } catch {
        return [];
      }
    };
    /**
     * What another machine's agents' device is refused of a chat or a run the row names (the remote-agents plan's
     * f-answer): every row under /sessions/:id and /runs/:id answers it for the chats it started alone (`agentDevice`,
     * kept on the chat by POST /sessions) — their sub-agents, runs and asks with them, a run by the chat it is of. Any
     * other is answered as one that is not there, so it learns nothing of which ids are. Null where it may.
     * @param {string} pattern @param {Record<string, string>} params @param {string} device
     * @returns {string | null}
     */
    const notTheirs = (pattern, params, device) => {
      const of = (/** @type {string} */ chat) => {
        try {
          return !!chat && a.memory?.archive?.metaOf(chat, ["agentDevice"])?.agentDevice === device;
        } catch {
          return false;
        }
      };
      try {
        if (pattern.startsWith("/sessions/:id")) return of(decodeURIComponent(params.id)) ? null : "no such session";
        if (pattern.startsWith("/runs/:id")) return of(String(a.runs?.getRun(decodeURIComponent(params.id))?.meta?.chain ?? "")) ? null : "no such run";
      } catch {
        return pattern.startsWith("/runs/") ? "no such run" : "no such session";
      }
      return null;
    };
    try {
      // Another machine's agents (remote.js AGENT_ROUTES): /remote/me always, so they can say why they are refused,
      // and the rest only while their grant `agents` is on, by the row that answers — of the chats they started alone. They
      // send a client's own headers (`agentHeaderRefusal`) and the fields each write names (`agentBodyRefusal`). A chat
      // starts, and a command runs (exec.js), in a folder their fence lets them (`agentFolderRefusal`: agentLoop.roots,
      // else the person's chats' and projects' folders; under Full control any but Filament's data folder) and the folder
      // rules then judge; a file is read in one of their
      // own chats' folders, as a view device reads one (`viewFolderRefusal`), the folder named by its own names
      // (`aliasedPath`) as a chat's is, and the file too, never in a credentials folder inside it (`agentFileRefusal`).
      if (agentsDevice(who)) {
        const why = agentRefusal(method, path, m?.pattern, who.device);
        if (why) return sendJson(res, 403, { error: why, ...(who.device.grants?.agents !== true ? { grant: "agents" } : {}) });
        const header = agentHeaderRefusal(h);
        if (header) return sendJson(res, 400, { error: header });
        // A chat, and its runs and asks, are the device's own chats' alone (`notTheirs`).
        const gone = m ? notTheirs(m.pattern, m.params, who.device.id) : null;
        if (gone) return sendJson(res, 404, { error: gone });
        const field = m && method !== "GET" ? agentBodyRefusal(`${method} ${m.pattern}`, await json()) : null;
        if (field) return sendJson(res, 400, { error: field });
        const read = String(url.searchParams.get("cwd") || "");
        const alias = aliasedPath(read);
        const no =
          (m?.pattern === "/sessions" || m?.pattern === "/exec") && method === "POST"
            ? agentFolderRefusal(String((await json())?.cwd ?? ""), { dataDir: a.dataDir, roots: a.config.get().agentLoop?.roots || [], folders: chatFolders({ person: true }), doing: m.pattern === "/exec" ? "run a command" : "start a chat", full: fullControl(a.devices, who.device.id), ...a.remoteCopies?.fenceOf(who.device.id) })
            : m && VIEW_FOLDER_ROWS.includes(m.pattern)
              ? alias
                ? `another machine's agents name a folder by its own names; ${read}: ${alias}`
                : viewFolderRefusal(read, { folders: chatFolders({ agentDevice: who.device.id }), dataDir: a.dataDir, device: "another machine's agents' device", chats: "its own chats" }) ||
                  (fullControl(a.devices, who.device.id) ? "" : copiesRefusal(read, { ...a.remoteCopies?.fenceOf(who.device.id), doing: "read" })) ||
                  agentFileRefusal(read, String(url.searchParams.get("path") || "")) ||
                  null
              : null;
        if (no) return sendJson(res, 403, { error: no });
      }
      // A view-only device reads, and what it reads is named (remote.js VIEW_ROUTES), by the row that answers: every
      // other row is refused it. A row that reads a folder this machine names reads one of its chats' (`viewFolderRefusal`).
      else if (who?.kind === "device" && who.scope !== "full") {
        if (!viewReads(method, m?.pattern)) return sendJson(res, 403, { error: `a view-only device reads; ${method} ${path} is more than that` });
        if (m && VIEW_FOLDER_ROWS.includes(m.pattern)) {
          const no = viewFolderRefusal(String(url.searchParams.get("cwd") || ""), { folders: chatFolders(), dataDir: a.dataDir });
          if (no) return sendJson(res, 403, { error: no });
        }
      }
      // This computer's press without the app's key, while the app holds one: refused before the row acts, so the ask
      // waits on for the app's window. Each row's class says whether it is one (press.js `pressClass`): always, by its
      // body — and its headers, where the row hands them on to a turn —, or — a row nobody classed — because none said
      // otherwise; a row its own handler weighs answers there.
      // `press` tells a client it was the key that was missing.
      const cls = m ? pressClass(`${method} ${m.pattern}`) : null;
      if (pressNo && cls && (cls.press === "always" || (cls.press === "body" && cls.when(await json(), h)))) return sendJson(res, 403, { error: pressNo, press: true });
      // A pairing, or a grant, without the key — this computer's, a tailnet login's, the admin token's — while the app
      // holds one: no code is made and no grant set (the door's rows, guards.js `doorRefused`).
      const doorNo = doorRefused(req);
      if (doorNo && cls?.press === "door" && (!cls.when || cls.when(await json()))) return sendJson(res, 403, { error: doorNo, press: true });
      if (m) return await m.handler({ req, res, url, path, method, params: m.params, json, who }, a);
    } catch (e) {
      if (e instanceof BodyRefused) return;
      throw e;
    }
    if (path.startsWith("/memory/"))
      return sendJson(res, 404, { error: `unknown memory endpoint ${path.slice(8)}` });
    return sendJson(res, 404, { error: `unknown admin endpoint ${method} ${path}` });
  };
}

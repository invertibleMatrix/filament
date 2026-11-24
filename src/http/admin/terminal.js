// @ts-check
// The admin API's terminal area (B4): the pane's terminals — create one in a fenced project folder, list them for
// the status panel, feed it, resize it, stop it — and the WebSocket the pane attaches to for the live stream. The
// rows carry the same posture as the files area (the loopback admin surface, the agentLoop.roots fence); the stream
// is an HTTP upgrade, so it repeats the two guards itself: the Host check and loopback-or-token, the token arriving
// as `?token=` because a browser WebSocket cannot set headers. A terminal is a program started as the person and
// typed into, so opening one, typing into one and its stream are presses (press.js; r-doors, 11-12): the stream, which
// passes no front door, asks it itself, by the ticket the page's press was given.
import { homedir } from "node:os";
import { basename } from "node:path";
import { sendJson } from "../../app/pipeline/respond.js";
import { guard as guardWith } from "./guard.js";
import { allowedFolder } from "./folder.js";
import { countOwnerless, drives, endsWithDevice, hostAllowed, hostNameOf, ownOrigin, pressRefusal, safeEq, whoIs } from "../guards.js";
import { lowerHeaders } from "../../core/headers.js";
import { artifactNameOfHost, isArtifactOrigin } from "../../core/artifacts.js";
import { wsHandshake, wsTextFrame, wsCloseFrame, WsDecoder } from "../ws.js";

/** The most words a terminal's program is given, and the longest of them: ssh's, a script for sh encoded in its last. */
const PROGRAM_ARGS_MAX = 64;
const PROGRAM_ARG_MAX = 32 * 1024;

/**
 * A terminal's program as a body names it — its file, and its words —, none where it names none, or why it is no
 * program, in words. @param {unknown} p @returns {{ file: string, args: string[] } | null | string}
 */
export function programOf(p) {
  if (p == null) return null;
  const o = /** @type {any} */ (p);
  if (typeof o !== "object" || typeof o.file !== "string" || !o.file.trim() || /[\0\r\n]/.test(o.file)) return "program.file is required: the program to run";
  const args = o.args ?? [];
  if (!Array.isArray(args) || args.length > PROGRAM_ARGS_MAX || args.some((x) => typeof x !== "string" || x.length > PROGRAM_ARG_MAX || x.includes("\0")))
    return `program.args are its words: ${PROGRAM_ARGS_MAX} at most, each ${PROGRAM_ARG_MAX / 1024} KiB at most`;
  return { file: o.file, args: [...args] };
}

/**
 * @param {any} a  the admin context: { config, terminal }
 * @returns {import("../router.js").RouteRow[]}
 */
export function terminalRoutes(a) {
  const { config, terminal } = a;
  return [
    [
      "POST",
      "/terminal",
      guardWith(async (r) => {
        const body = await r.json();
        // A program in its place (the desk's setup over SSH: ssh, for what only the person answers — a host key, a
        // password, sudo): no more than a shell here runs, typed into, so the same press; started in the person's own
        // folder where no cwd is named, with the environment a shell gets.
        const program = programOf(body.program);
        if (typeof program === "string") return sendJson(r.res, 400, { error: program });
        const f = program && !body.cwd ? { ok: /** @type {const} */ (true), root: homedir() } : allowedFolder(config.get(), body.cwd);
        if (!f.ok) return sendJson(r.res, f.status, { error: f.error });
        const title = program ? String(body.title || basename(program.file)).slice(0, 80) : "";
        const t = terminal.create({ cwd: f.root, cols: body.cols, rows: body.rows, ...(program ? { title, program: { ...program, env: { ...process.env } } } : {}) });
        return sendJson(r.res, 200, { ok: true, terminal: t });
      }),
    ],
    [
      "GET",
      "/terminal",
      guardWith((r) => sendJson(r.res, 200, { terminals: terminal.list() })),
    ],
    [
      // A ticket for the terminal's stream, good once and for a moment (services/terminal.js `ticket`): the row is a
      // press, so the app's window alone is given one while the app holds a key, and its stream shows it (`?ticket=`).
      "POST",
      "/terminal/:id/ticket",
      guardWith((r) => sendJson(r.res, 200, { ok: true, ticket: terminal.ticket(r.params.id) })),
    ],
    [
      "POST",
      "/terminal/:id/input",
      guardWith(async (r) => {
        const body = await r.json();
        if (typeof body.data !== "string") return sendJson(r.res, 400, { error: "data is required: the text to send the process" });
        terminal.input(r.params.id, body.data);
        return sendJson(r.res, 200, { ok: true });
      }),
    ],
    [
      "POST",
      "/terminal/:id/resize",
      guardWith(async (r) => {
        const body = await r.json();
        terminal.resize(r.params.id, Number(body.cols), Number(body.rows));
        return sendJson(r.res, 200, { ok: true });
      }),
    ],
    [
      "POST",
      "/terminal/:id/kill",
      guardWith((r) => {
        terminal.kill(r.params.id);
        return sendJson(r.res, 200, { ok: true });
      }),
    ],
  ];
}

/**
 * The one upgrade this server answers: `/api/terminal/<id>/stream`. Anything else is refused; a refused upgrade
 * must answer on the raw socket (there is no HTTP response machinery on the other side of a 101). An upgrade passes no
 * front door, so it holds the artifacts' fence itself (HarnessV4_Artifacts_Plan AF-D2): asked on an artifact's
 * address, or by an artifact's page, it is refused.
 * @param {any} a  the admin context
 */
export function terminalUpgrade(a) {
  const { config, terminal, devices = null } = a;
  return (req, socket, head) => {
    const url = new URL(String(req.url || ""), "http://localhost");
    const m = /^\/api\/terminal\/([^/]+)\/stream$/.exec(url.pathname);
    /** @param {string} why @param {number} status */
    const refuse = (why, status) => {
      socket.write(`HTTP/1.1 ${status} ${status === 404 ? "Not Found" : "Forbidden"}\r\nconnection: close\r\n\r\n${why}`);
      socket.destroy();
    };
    const h = lowerHeaders(req.headers);
    if (artifactNameOfHost(hostNameOf(req)) !== null) return refuse("no such websocket", 404);
    if (isArtifactOrigin(h.origin)) return refuse("an artifact's page reaches nothing of Filament's", 403);
    if (!m) return refuse("no such websocket", 404);
    const server = config.get().server;
    if (!hostAllowed(req, server)) return refuse("host not allowed", 403);
    const token = url.searchParams.get("token") || (h["authorization"] || "").replace(/^bearer\s+/i, "") || h["x-filament-admin"] || "";
    // This computer, the admin token, or a full device (its browser's cookie rides the upgrade): a terminal types into
    // this machine, so a view-only device opens none (the owner's remote Filament of 11-06).
    const who = whoIs(req, server, devices) || (server.adminToken && safeEq(token, server.adminToken) ? /** @type {const} */ ({ kind: "admin" }) : null);
    // This computer's socket without its owner key, counted as its calls are (guards.js `countOwnerless`).
    countOwnerless(req, who);
    if (!who) return refuse("a terminal answers this machine, a paired device, or server.adminToken", 403);
    if (!drives(who)) return refuse("a view-only device opens no terminal", 403);
    // A page anywhere may open a WebSocket to this host (the bug hunt of 10-30: one read a terminal's backlog and typed
    // into it), so an Origin other than this server's is refused, as the run socket refuses it.
    if (h.origin && !ownOrigin(h.origin, String(h.host || ""))) return refuse(`a page of another site reaches no terminal of Filament's (Origin ${h.origin})`, 403);
    // The terminal the address names. One that does not decode names none, and is answered so here: a throw past these
    // refusals would leave the socket open and unanswered.
    let id = "";
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      return refuse("no such terminal", 404);
    }
    // The stream types into this machine, so it is a press as the terminal's rows are (r-doors, 11-12: a program here
    // opened it with no key, read the person's shell and typed into it). While the app holds a key, its window's page
    // shows the ticket its press was given — a WebSocket carries no header —; a full device presses as the gate let it in.
    const pressNo = pressRefusal(req, who, devices);
    if (pressNo && !terminal.redeem(id, url.searchParams.get("ticket"))) return refuse(pressNo, 403);
    const key = h["sec-websocket-key"];
    if (!key) return refuse("not a websocket handshake", 400);
    // The handshake goes on the wire before any frame: `attach` replays the backlog synchronously, so writes are
    // held until the 101 has flushed (socket writes are FIFO, but the handshake must LEAD).
    let ready = false;
    /** @type {(() => void)[]} */
    const held = [];
    const write = (/** @type {Buffer} */ buf) => { if (ready) socket.write(buf); else held.push(() => socket.write(buf)); };
    let detach = () => {};
    try {
      detach = terminal.attach(id, (msg) => write(wsTextFrame(JSON.stringify(msg))));
    } catch (e) {
      return refuse(String(/** @type {any} */ (e)?.message || e), 404);
    }
    socket.write(wsHandshake(key), () => {
      ready = true;
      for (const fn of held.splice(0)) fn();
    });
    const dec = new WsDecoder(server.maxBodyBytes);
    const onChunk = (/** @type {Buffer} */ chunk) => {
      let frames;
      try {
        frames = dec.feed(chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const f of frames) {
        if (f.opcode === 8) {
          socket.end(wsCloseFrame());
          return;
        }
        if (f.opcode === 9) {
          socket.write(Buffer.from([0x8a, 0x00])); // FIN + pong, no payload
          continue;
        }
        if (f.opcode !== 1) continue;
        // The pane speaks one JSON vocabulary: { t: "i", d } input, { t: "r", c, r } resize.
        try {
          const msg = JSON.parse(f.text);
          if (msg?.t === "i") terminal.input(id, String(msg.d ?? ""));
          else if (msg?.t === "r") terminal.resize(id, Number(msg.c), Number(msg.r));
        } catch {}
      }
    };
    socket.on("data", onChunk);
    // Bytes that arrived before the upgrade completed belong to the stream, same as any later chunk.
    if (head?.length) onChunk(head);
    // A device revoked, or signed out, types no more: its terminal closes at once.
    const unhear = endsWithDevice(devices, who, () => socket.destroy());
    const detachAndClose = () => {
      unhear();
      detach();
      socket.destroy();
    };
    socket.on("close", detachAndClose);
    socket.on("error", detachAndClose);
  };
}

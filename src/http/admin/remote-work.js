// @ts-check
// The admin API's Run on area, `remoteWorkRoutes` (the remote desk's s2b): a folder of the person's sent to another
// machine for a chat of theirs to run there, and what it changed brought back (app/remote-work.js). The person's alone:
// another machine's agents and a view device reach none of these rows (remote.js AGENT_ROUTES, VIEW_ROUTES), and the
// writes are presses (press.js).
import { sendJson } from "../../app/pipeline/respond.js";
import { folderVerdict, outsideRootsWords } from "../../app/agent/turn.js";
import { guard } from "./guard.js";

/** The choices a file that stopped an apply takes. */
const CHOICES = Object.freeze(["yours", "its", "both"]);

/**
 * @param {any} a  the admin context: `remoteWork` (app/remote-work.js), `config`
 * @returns {import("../router.js").RouteRow[]}
 */
export function remoteWorkRoutes(a) {
  /** The store, or the refusal sent. @param {any} r @returns {import("../../app/remote-work.js").RemoteWorkStore | null} */
  const store = (r) => {
    if (a.remoteWork) return a.remoteWork;
    sendJson(r.res, 503, { error: "Run on is not wired in this Filament" });
    return null;
  };
  /** A refusal thrown by the store, answered by its status and words, its ask or its kind with it. @param {any} r @param {any} e */
  const refusal = (r, e) => {
    if (!e?.status) throw e;
    return sendJson(r.res, e.status, { error: String(e.message), ...(e.ask ? { ask: e.ask } : {}), ...(e.kind ? { kind: e.kind } : {}) });
  };
  /** Stopped where the caller goes before its answer: a send or a bring back it gave up on runs on for nobody. @param {any} r */
  const stopOnClose = (r) => {
    const stop = new AbortController();
    r.res.on("close", () => r.res.writableEnded || stop.abort());
    return stop.signal;
  };
  return [
    // Every Run on kept here, newest first.
    ["GET", "/remote-work", guard((r) => store(r) && sendJson(r.res, 200, { works: a.remoteWork.list() }))],
    // `?folder=`: where a chat in it may run → `{ here, machines, last }` (app/remote-work.js `places`), for Run on's
    // chip and its Auto; each machine asked for a few seconds at most.
    [
      "GET",
      "/remote-work/places",
      guard(async (r) => {
        const s = store(r);
        if (!s) return;
        const folder = String(r.url.searchParams.get("folder") ?? "").trim();
        if (!folder) return sendJson(r.res, 400, { error: "folder is the folder the chat would start in here" });
        const v = folderVerdict(a.config.get(), folder, { person: true });
        if (v.why === "missing" || v.why === "empty") return sendJson(r.res, 400, { error: `the folder does not exist on this machine: ${folder}` });
        if (!v.ok) return sendJson(r.res, 403, { error: v.why === "outside" ? outsideRootsWords(folder) : `${folder} is no folder a chat may work in here` });
        return sendJson(r.res, 200, await s.places(v.root));
      }),
    ],
    // `{ machine, folder, allow? }`: the folder's repository sent to the machine and placed there for a chat of yours →
    // `{ work }`, its `cwd` the folder the chat starts in there; 409 with `ask` where the person is asked first, and
    // `allow` (`{ ask }`, that ask's id) is their yes.
    [
      "POST",
      "/remote-work",
      guard(async (r) => {
        const s = store(r);
        if (!s) return;
        const b = await r.json();
        const machine = typeof b?.machine === "string" ? b.machine.trim() : "";
        const folder = typeof b?.folder === "string" ? b.folder.trim() : "";
        if (!machine || !folder) return sendJson(r.res, 400, { error: "a JSON object is required: { machine, folder, allow? }" });
        const allow = b.allow == null ? null : typeof b.allow?.ask === "string" && /^[0-9a-f]{64}$/.test(b.allow.ask) ? { ask: b.allow.ask } : undefined;
        if (allow === undefined) return sendJson(r.res, 400, { error: "allow is the ask answered: { ask: its id }" });
        // A folder your chats may work in, as a chat's start judges it.
        const v = folderVerdict(a.config.get(), folder, { person: true });
        if (v.why === "missing" || v.why === "empty") return sendJson(r.res, 400, { error: `the folder does not exist on this machine: ${folder}` });
        if (!v.ok) return sendJson(r.res, 403, { error: v.why === "outside" ? outsideRootsWords(folder) : `${folder} is no folder a chat may work in here` });
        try {
          return sendJson(r.res, 200, { work: await s.send({ machine, folder: v.root, allow, signal: stopOnClose(r) }) });
        } catch (e) {
          return refusal(r, e);
        }
      }),
    ],
    // `{ chat }`: the chat this Filament's app started in its copy there → `{ work }`.
    [
      "POST",
      "/remote-work/:id/chat",
      guard(async (r) => {
        const s = store(r);
        if (!s) return;
        const b = await r.json();
        try {
          return sendJson(r.res, 200, { work: s.chat(decodeURIComponent(r.params.id), b?.chat) });
        } catch (e) {
          return refusal(r, e);
        }
      }),
    ],
    // `{ choices?, overlap?, at? }`: what its chat changed there brought back and applied to the folder as uncommitted
    // edits → `{ work, unchanged, files, came, left }`; 409 with `conflicts` and `at` where a file stops it, nothing
    // written, until `choices` (by path: yours, its, both) or `overlap` (markers, mine) names a way for each, with that
    // `at` (one changed there since says `moved`); 410 where its copy went.
    [
      "POST",
      "/remote-work/:id/back",
      guard(async (r) => {
        const s = store(r);
        if (!s) return;
        const b = (await r.json()) ?? {};
        const choices = b.choices ?? {};
        if (!choices || typeof choices !== "object" || Array.isArray(choices) || !Object.values(choices).every((c) => CHOICES.includes(/** @type {any} */ (c))))
          return sendJson(r.res, 400, { error: `choices are by path, each ${CHOICES.join(", ")}` });
        if (b.overlap != null && b.overlap !== "markers" && b.overlap !== "mine") return sendJson(r.res, 400, { error: "overlap is markers or mine" });
        if (b.at != null && (typeof b.at !== "string" || !/^[0-9a-f]{40,64}$/.test(b.at))) return sendJson(r.res, 400, { error: "at is the commit the conflicts came with" });
        if ((Object.keys(choices).length || b.overlap != null) && b.at == null) return sendJson(r.res, 400, { error: "choices and overlap answer the conflicts of one capture: name it with at, as they came" });
        try {
          const out = await s.back(decodeURIComponent(r.params.id), { choices, overlap: b.overlap ?? null, at: b.at ?? "", signal: stopOnClose(r) });
          return sendJson(r.res, out.ok ? 200 : 409, out);
        } catch (e) {
          return refusal(r, e);
        }
      }),
    ],
    // Forgotten here, its commits' refs with it; its copy there stays that machine's to clear.
    [
      "DELETE",
      "/remote-work/:id",
      guard(async (r) => {
        const s = store(r);
        if (!s) return;
        try {
          return sendJson(r.res, 200, { forgotten: await s.forget(decodeURIComponent(r.params.id)) });
        } catch (e) {
          return refusal(r, e);
        }
      }),
    ],
  ];
}

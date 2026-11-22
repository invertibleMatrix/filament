// @ts-check
// The admin API's memory area: the whole `/api/memory/*` surface — engine lifecycle, recall/remember/forget, items,
// sessions, projects, turns, activity and benchmark, memory's own traffic and per-day usage, identity facts, backup
// and restore, learning, hygiene, sources and imports. Every route is wrapped in one guard: a local failure (archive,
// engine, config) is a 500 — 502 means an upstream failed. Every answer shows an MCP server's credentials as the
// placeholder (HarnessV4_Settings_Plan HS-D8): a session's row carries its settings layer.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { sendJson as send } from "../../app/pipeline/respond.js";
import { maskAnswer } from "../../services/mcp-servers.js";
import { mirrorLearnedRule } from "../../app/agent/rules.js";
import { folderVerdict, networkShare, outsideRootsWords } from "../../app/agent/turn.js";
import { guard } from "./guard.js";
import { localDay } from "../../services/records.js";
import { LISTED_KINDS, CLAIM_STATES, CLAIM_FILTER_KEYS, isKindRefusal } from "../../services/memory/brain.js";
import { isRetired } from "../../services/memory/archive.js";
import { allowsAlways } from "../../services/memory/permissions.js";
import { PROCEDURE_FORM } from "../../services/memory/procedures.js";
import { OUTCOME_DAYS, OUTCOME_KINDS } from "../../services/memory/outcomes.js";
import { METRIC_DAYS, METRIC_DAYS_MAX } from "../../services/memory/metrics.js";
import { WALK_VERSION, onlyGone, ownChangesOf, turnsChanged, walkOf } from "../../adapters/git/changes.js";
import { remoteKeys } from "../../adapters/git/inspect.js";
import { placeOf } from "../../adapters/git/snapshot.js";
import { outputsOf } from "../../app/sessions/outputs.js";
import { FEED_PAGE } from "../../services/memory/index.js";
import { writeSse } from "../events.js";
import { memoryKeys } from "../memory-mcp.js";
import { drives, pressRefused } from "../guards.js";
import { EFFORT_LEVELS } from "../../core/schema.js";
import { keptAnswers } from "../../core/kept-answers.js";

const HEARTBEAT_MS = 25_000;
/**
 * The turns whose tree cards' first rows are kept — a page draws some 60 turns, each cut of its 200 a tenth of a megabyte
 * at most — and the turns whose whole answers are: a whole can be tens of megabytes, and the command center alone reads
 * one, its newest turn's, again and again. A cut of more than TURN_FIRST_MOST rows is cut from the whole at each ask.
 */
export const TURN_FIRST_KEPT = { most: 64, perKey: 8 };
export const TURN_WHOLE_KEPT = { most: 2, perKey: 4 };
export const TURN_FIRST_MOST = 1000;
/** The most rows a `?match=` answer takes. */
export const TURN_MATCH_MOST = 50;
/** How long a list asked its remotes' keys (`?remotes=1`) waits for the folders not read yet: the rest come at the next ask. */
export const REMOTES_WAIT_MS = 1500;

/**
 * A turn's files whose path, as the command center names it, holds `q`: the first `take` in the answer's own order. A
 * file in another place than the chat's folder is named by its whole path; `q` is compared lower-cased, "" holds in
 * every path.
 * @param {any[]} files @param {string | null} folder @param {string} q @param {number} take
 */
export function changesMatching(files, folder, q, take) {
  const want = q.toLowerCase();
  const out = [];
  for (const f of files) {
    if (out.length >= take) break;
    const path = f.place && folder && f.place !== folder ? `${f.place}/${f.path}` : String(f.path);
    if (!want || path.toLowerCase().includes(want)) out.push(f);
  }
  return out;
}

/**
 * What a turn's changes answer rests on: its writing rounds as recorded, every field of each, the places gone, and the
 * places only its chat works in — a snapshot is a commit, so the same rounds read the same. `gone`: the places it found
 * gone, which an answer that says only those are gone may be kept on (`onlyGone`).
 * @param {import("../../core/types.js").RoundChange[]} rounds @param {Set<string> | null} alone
 * @returns {{ basis: string, gone: string[] }}
 */
function turnBasis(rounds, alone) {
  const digest = createHash("sha1");
  for (const x of rounds) digest.update(`${JSON.stringify([x.place, x.round, x.agent, x.before, x.after, x.base, x.command, x.own, x.turn])}\n`);
  const gone = [...new Set(rounds.map((x) => x.place).filter(Boolean))].filter((p) => !existsSync(p));
  return { basis: [digest.digest("hex"), gone.join("|"), [...(alone || [])].sort().join("|")].join("\n"), gone };
}

/** How `locale` compares names, the server's own where it names none or none known. @param {string} locale */
export function collatorOf(locale) {
  try {
    return new Intl.Collator(locale || undefined);
  } catch {
    return new Intl.Collator();
  }
}

/**
 * A turn's changes with its files held to the first `n` in the order the tree card draws them — by place, then path,
 * as `locale` compares them (the page's own) — and how many each list holds in all (`counts`: the files, those changed
 * while its commands ran by place and path, those outside any repository by path, and whether its commands changed a
 * file of its own: what the card counts and says). The tree card draws a turn's first files and counts the rest: one
 * turn's answer was 22.9 MB, 77,842 files (the owner's of 11-17). A new object: the answer kept serves every other ask.
 * @param {any} out @param {number} n @param {string} locale
 */
export function treeFirst(out, n, locale) {
  const order = collatorOf(locale);
  const files = [...out.files].sort((a, b) => order.compare(String(a.place || ""), String(b.place || "")) || order.compare(String(a.path), String(b.path)));
  const counts = {
    files: out.files.length,
    during: new Set(out.during.map((/** @type {any} */ d) => `${d.place}\n${d.path}`)).size,
    outside: new Set(out.outside.map((/** @type {any} */ o) => String(o.path))).size,
    ran: out.files.some((/** @type {any} */ f) => f.via === "command"),
  };
  return { ...out, files: files.slice(0, n), during: out.during.slice(0, n), outside: out.outside.slice(0, n), counts };
}

/** The area's one way to answer: the body with every MCP server's credentials masked. @type {typeof send} */
const sendJson = (res, status, obj, extra) => send(res, status, maskAnswer(obj), extra);
/**
 * A route's answer, or the 400 its refusal names (`refused`: the request was wrong, or an import or memory's reading
 * is running).
 * @param {import("node:http").ServerResponse} res @param {() => any} run
 */
async function asked(res, run) {
  let out;
  try {
    out = await run();
  } catch (e) {
    if (/** @type {any} */ (e)?.refused) return sendJson(res, 400, { error: /** @type {any} */ (e).message });
    throw e;
  }
  return sendJson(res, 200, out);
}
/** One server-sent event, its `id:` when it has one. @param {string | null} id @param {any} data */
const sse = (id, data) => `${id ? `id: ${id}\n` : ""}data: ${JSON.stringify(data)}\n\n`;

/**
 * The pages of claim changes read in this moment, by archive (M7-D36): one change wakes every open window's stream at
 * once, and each asks the feed for its next page — the same page, where they stood at the same place. A page is shared
 * while it is the same answer: the same archive, nothing written to it since (`writes`), the same question; until the
 * event loop turns, when the next asker reads again.
 * @type {WeakMap<object, { writes: number, pages: Map<string, any> }>}
 */
const momentPages = new WeakMap();
/**
 * `memory.claimChanges`, answered once for the streams that ask it alike in one moment.
 * @param {any} memory @param {{ after: number, limit: number, project: string | undefined }} q
 */
function claimPage(memory, q) {
  const archive = memory.archive;
  if (!archive) return memory.claimChanges(q);
  const writes = archive.writes();
  let moment = momentPages.get(archive);
  if (!moment || moment.writes !== writes) {
    const fresh = { writes, pages: new Map() };
    momentPages.set(archive, (moment = fresh));
    setImmediate(() => {
      if (momentPages.get(archive) === fresh) momentPages.delete(archive);
    });
  }
  const key = JSON.stringify([q.after, q.limit, q.project ?? null]);
  let page = moment.pages.get(key);
  if (!page) moment.pages.set(key, (page = memory.claimChanges(q)));
  return page;
}

/**
 * `GET /api/memory/claims/stream` (HarnessV3-Memory M7-D35): every change to a claim, as it happens, resumable.
 * - First `hello`, `{ last, gap }`, its `id:` where the stream starts: after `Last-Event-ID` (a reconnect) or `?since=`,
 *   else after the newest. An id from another store, older than the oldest kept or past the newest is a gap: the stream
 *   starts after the newest and the reader reads everything again.
 * - Then each change, `id: <epoch>:<n>`, never a claim's words (the card is read for those). `?project=`: its claims,
 *   the global ones and those moved out of it.
 * - It never skips: it reads the feed from its own place, a page at a time, and waits for the reader before each write.
 *   A wake while it reads says "read again". Memory reopened on another store says `reset`, and goes on from there.
 * @param {any} r @param {any} memory @param {Set<any>} sseClients
 */
function claimStream(r, memory, sseClients) {
  const { req, res, url } = r;
  if (!memory.isOpen()) return sendJson(res, 503, { error: memory.archiveWhy() });
  const q = url.searchParams;
  const project = q.get("project") || undefined;
  if (project && !memory.archive?.getProject(project)) return sendJson(res, 404, { error: "no such project" });
  const pos = memory.claimFeed();
  const from = String(req.headers["last-event-id"] || q.get("since") || "").trim();
  const m = /^([^:]+):(\d+)$/.exec(from);
  const resumes = !!m && m[1] === pos.epoch && Number(m[2]) >= pos.pruned && Number(m[2]) <= pos.last;
  let epoch = pos.epoch;
  let after = resumes ? Number(/** @type {RegExpExecArray} */ (m)[2]) : pos.last;
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  sseClients.add(res);
  let closed = false;
  let reading = false;
  let again = false;
  /** @type {() => void} */
  let unwatch = () => {};
  /** @type {NodeJS.Timeout | null} */
  let ping = null;
  const close = () => {
    if (closed) return;
    closed = true;
    if (ping) clearInterval(ping);
    unwatch();
    sseClients.delete(res);
  };
  const drained = () =>
    new Promise((resolve) => {
      const done = () => {
        res.off("drain", done);
        res.off("close", done);
        resolve(undefined);
      };
      res.on("drain", done);
      res.on("close", done);
    });
  /** Waits for the reader, then writes; false once the stream is gone. @param {string} line */
  const send = async (line) => {
    while (res.writableNeedDrain && !closed) await drained();
    if (closed || !writeSse(sseClients, res, line)) return (close(), false);
    return true;
  };
  const read = async () => {
    if (reading) return void (again = true);
    reading = true;
    try {
      for (;;) {
        again = false;
        // Closed: the first change once it opens again wakes this.
        if (!memory.isOpen()) return;
        const p = memory.claimFeed();
        if (p.epoch !== epoch) {
          epoch = p.epoch;
          after = p.last;
          if (!(await send(sse(`${epoch}:${after}`, { type: "reset", last: `${epoch}:${after}` })))) return;
          continue;
        }
        const page = claimPage(memory, { after, limit: FEED_PAGE, project });
        for (const c of page.changes) if (!(await send(sse(c.id, c)))) return;
        after = page.through;
        if (page.changes.length < FEED_PAGE && !again) return;
      }
    } finally {
      reading = false;
    }
  };
  const wake = () =>
    void read().catch((e) => {
      close();
      try {
        res.end(sse(null, { type: "error", error: String(e?.message || e).slice(0, 200) }));
      } catch {}
    });
  req.on("close", close);
  unwatch = memory.watchClaims(wake);
  ping = setInterval(() => {
    if (!writeSse(sseClients, res, ": ping\n\n")) close();
  }, HEARTBEAT_MS);
  ping.unref?.();
  writeSse(sseClients, res, sse(`${epoch}:${after}`, { type: "hello", last: `${pos.epoch}:${pos.last}`, gap: !!from && !resumes }));
  wake();
  return undefined;
}

/**
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function memoryRoutes(a) {
  const { memory, usage, sseClients } = a;
  /** Each project's folder's remote's key, for the lists that are asked them (`withRemotes`). */
  const folderKeys = a.remoteKeys ?? remoteKeys();
  /**
   * Rows with their repository's remote's key (`remoteKey`), where `?remotes=1` asks (the remote desk of 11-22: another
   * machine's app lists a repository's chats and projects on every machine as one): read from each project's folder — a
   * chat's from its project's, else its own —, never a network share's, kept five minutes, the list waiting
   * REMOTES_WAIT_MS at most for those not kept; one read past it is said at the next ask. Null where the folder has
   * no remote; none where it is not known yet.
   * @template {{ cwd?: string | null, project?: string | null }} R @param {R[]} rows @param {(row: R) => string} folderOf
   * @returns {Promise<(R & { remoteKey?: string | null })[]>}
   */
  const withRemotes = async (rows, folderOf) => {
    const folders = rows.map((row) => folderOf(row)).map((f) => (f && isAbsolute(f) && !networkShare(f) ? f : ""));
    const keys = await folderKeys.of(folders, { waitMs: REMOTES_WAIT_MS });
    return rows.map((row, i) => {
      const key = folders[i] ? keys.get(folders[i]) : undefined;
      return key === undefined ? row : { ...row, remoteKey: key };
    });
  };
  /** Each project's folder, by its id, as the list reads them now. @returns {Map<string, string>} */
  const projectFolders = () => new Map((memory.projects() || []).map((/** @type {any} */ p) => [String(p.id), String(p.cwd || "")]));
  /**
   * Each turn's changes answers, kept while what they rest on holds (`turnBasis`): every tree card reads its turn's first
   * rows, the command center its newest turn's whole, and one turn's read was 65 s of git (the owner's of 11-17). The
   * first rows and the wholes are kept apart, each store to its own bound.
   */
  const turnFirsts = keptAnswers(TURN_FIRST_KEPT);
  const turnWholes = keptAnswers(TURN_WHOLE_KEPT);
  /**
   * The tree cards' first rows past a restart (`changesKept`), where their walk was slow: what one rests on there holds
   * the release, the walk's version and the collation's too.
   */
  const disk = a.changesKept?.turns ?? null;
  const pastProcess = [a.VERSION ?? "", WALK_VERSION, process.versions.icu ?? ""].join(" ");
  /**
   * Whose agents started a chat, by the agents' device that did (the remote-agents plan's s-ui): the machine's name — the
   * full device it was minted by — else the agents' device's own; null once this machine keeps neither.
   * @param {string} id
   */
  const agentsName = (id) => {
    const d = a.devices?.get?.(id) ?? null;
    return d?.from || (d?.of ? a.devices.get(d.of)?.name : null) || null;
  };
  /** Memory's own per-day usage (JSON or CSV), shared by the two paths below. */
  const memUsage = async (r) => {
    const { url, path, res } = r;
    const q = url.searchParams;
    const span = { from: q.get("from") || null, to: q.get("to") || null };
    for (const v of [span.from, span.to])
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v))
        return sendJson(res, 400, { error: "from/to must look like 2026-09-13" });
    if (path.endsWith(".csv")) {
      res.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="filament-memory-usage${span.from ? "-" + span.from : ""}${span.to ? "-to-" + span.to : ""}.csv"`,
      });
      return res.end(usage.memDailyStore.csv(span));
    }
    return sendJson(res, 200, {
      today: localDay(),
      days: usage.memDailyStore.list({ ...span, limit: Number(q.get("limit")) || 0 }),
      total: usage.memDailyStore.aggregate(span),
      last24h: usage.summary(24 * 3600 * 1000, { scope: "memory" }),
      file: usage.memDailyStore.persist ? usage.memDailyStore.path : null,
    });
  };
  return [
    [
      "GET",
      "/memory/status",
      // A probe starts the engine and asks it: a view-only device's read starts nothing (the review of 882809c20).
      guard(async (r) =>
        sendJson(r.res, 200, await memory.status({ probe: r.url.searchParams.get("probe") === "1" && drives(r.who ?? { kind: "local" }) })),
      ),
    ],
    // Memory's switch, one click from Get started (HarnessV3-Launch LD-D2): saved at once, as the failover switch is,
    // and said in the op log. It installs nothing: the engine is `/memory/install`'s, which the page starts beside it.
    [
      "POST",
      "/memory/enabled",
      guard(async (r) => {
        const b = (await r.json()) || {};
        if (typeof b.enabled !== "boolean") return sendJson(r.res, 400, { error: "enabled must be true or false" });
        const next = structuredClone(a.config.get());
        next.memory = { ...(next.memory || {}), enabled: b.enabled };
        a.config.set(next);
        a.config.save();
        a.ops.record("config", `memory switched ${b.enabled ? "on" : "off"}`, { sub: "memory-enabled", detail: { enabled: b.enabled } });
        return sendJson(r.res, 200, { ok: true, enabled: b.enabled });
      }),
    ],
    // Where memory's engine stands (AH-D2): the harness reads it once and then follows the events feed's `engine`.
    ["GET", "/memory/engine", guard((r) => sendJson(r.res, 200, memory.engineNow()))],
    // The engine restarted by the person, who sees it hung (HarnessV4_Tasks U1): no call of its has a clock. 409 with
    // why where there is none to restart.
    [
      "POST",
      "/memory/engine/restart",
      guard(async (r) => {
        const out = await memory.restartEngine();
        return out.restarted ? sendJson(r.res, 200, out) : sendJson(r.res, 409, { error: out.why });
      }),
    ],
    // An install while one runs answers with the running one (one engine job at a time). It takes nothing: the engine
    // is the one in the bundle this Filament came with, and none is ever updated (AH-D2).
    ["POST", "/memory/install", guard(async (r) => sendJson(r.res, 200, { job: memory.install() }))],
    ["POST", "/memory/uninstall", guard(async (r) => sendJson(r.res, 200, await memory.uninstall()))],
    [
      "GET",
      "/memory/jobs/:id",
      guard((r) => {
        const j = memory.job(r.params.id);
        return j ? sendJson(r.res, 200, j) : sendJson(r.res, 404, { error: "no such job" });
      }),
    ],
    // The engine's install stopped by the person: its steps have no clock (HarnessV3-FailurePoints FP-D3).
    [
      "POST",
      "/memory/jobs/:id/stop",
      guard((r) => (memory.job(r.params.id) ? sendJson(r.res, 200, { stopped: memory.stopJob(r.params.id) }) : sendJson(r.res, 404, { error: "no such job" }))),
    ],
    [
      "POST",
      "/memory/recall",
      guard(async (r) => {
        const b = await r.json();
        if (!b?.query) return sendJson(r.res, 400, { error: "query is required" });
        return sendJson(r.res, 200, {
          results: await memory.scope({ role: "owner", project: b.project || null }).search(String(b.query), { limit: Number(b.limit) || 10, project: !!b.project }),
        });
      }),
    ],
    [
      "POST",
      "/memory/remember",
      guard(
        async (r) => {
          const b = await r.json();
          const t = b?.text || b?.content;
          if (!t) return sendJson(r.res, 400, { error: "text is required" });
          return sendJson(
            r.res,
            200,
            await memory.scope({ role: "owner", project: b.project || null }).remember(String(t), { kind: b.kind || "fact", importance: b.importance ?? 0.85 }),
          );
        },
        // A procedure that does not read as one is the caller's to fix (M5-6), and so is a kind no claim is (H4).
        (m) => (m === `memory: ${PROCEDURE_FORM}` || isKindRefusal(m) ? { status: 400, error: m } : null),
      ),
    ],
    [
      "POST",
      "/memory/forget",
      guard(async (r) => {
        const b = await r.json();
        if (!b?.id) return sendJson(r.res, 400, { error: "id is required" });
        // Scoped to the session a page has open, when it names one (HarnessV3-Memory M6-D2): its errata spare it.
        const session = b.session ? String(b.session) : null;
        if (session && !memory.archive?.getChain(session)) return sendJson(r.res, 404, { error: "no such session" });
        return sendJson(r.res, 200, await memory.scope({ role: "owner", chain: session }).forget(String(b.id), { reason: b.reason ? String(b.reason) : "forgotten in the console" }));
      }),
    ],
    [
      "GET",
      "/memory/items",
      guard((r) =>
        sendJson(r.res, 200, {
          items: memory.items({
            status: r.url.searchParams.get("status") || undefined,
            kind: r.url.searchParams.get("kind") || undefined,
            projectId: r.url.searchParams.get("project") || undefined,
            // At least one: SQLite reads a negative LIMIT as none, which would hand back every item.
            limit: Math.max(1, Number(r.url.searchParams.get("limit")) || 200),
          }),
        }),
      ),
    ],
    [
      "POST",
      "/memory/items/:id",
      guard(async (r) => {
        const b = await r.json();
        // The owner's word on the dashboard: through the brain, so the item's history, its engine copy and the errata
        // move together (HarnessV3-Memory MD-1). Confirming a standing claim is the owner's "proved right" (M6-D7):
        // through the confirm verb, so its files are anchored afresh and a change it survived is no longer flagged.
        const owner = memory.scope({ role: "owner" });
        const status = b?.status || "confirmed";
        const now = owner.claim(`i${Number(r.params.id)}`);
        // A permission confirmed is an Always allow (its rule mirrored below): a press, as the asks' Always allow is
        // (guards.js `pressRefused`; the swarm's review of 11-10) — and as the chat's `@mem confirm` of one is, by the
        // same judgement (permissions.js `allowsAlways`).
        const unpressed = pressRefused(r.req);
        if (unpressed && status === "confirmed" && allowsAlways(now, { confirm: true })) return send(r.res, 403, { error: unpressed, press: true });
        const out =
          status === "confirmed" && !("error" in now) && !isRetired(now.status)
            ? await owner.confirm(`i${Number(r.params.id)}`)
            : await owner.setStatus(Number(r.params.id), status);
        // A confirmed permission is also a rule the inspector can show (HarnessV2 §5.2, learned: true).
        const claim = owner.claim(`i${Number(r.params.id)}`);
        const rule = "error" in claim ? null : mirrorLearnedRule(memory.archive, claim);
        return sendJson(r.res, 200, rule ? { ...out, rule } : out);
      }),
    ],
    // The owner corrects a claim from a page (HarnessV3-Memory M6-3, M6-D2): new words replace it, none retire it. Scoped
    // to the session the page has open, when it names one: that session's errata spare it (it was there), and the
    // history names it. Restoring a retired claim is the status route's.
    [
      "POST",
      "/memory/items/:id/correct",
      guard(async (r) => {
        const b = (await r.json()) || {};
        if (b.text != null && typeof b.text !== "string") return sendJson(r.res, 400, { error: "text is the new words, or empty to retire it" });
        if (!memory.isOpen()) return sendJson(r.res, 503, { error: memory.archiveWhy() });
        const session = b.session ? String(b.session) : null;
        if (session && !memory.archive.getChain(session)) return sendJson(r.res, 404, { error: "no such session" });
        const owner = memory.scope({ role: "owner", chain: session });
        const id = String(r.params.id);
        const ref = /^\d+$/.test(id) ? `i${id}` : id;
        const named = owner.claim(ref);
        if (named.error) return sendJson(r.res, 404, named);
        // A permission's new words are a confirmed permission in the caller's own words — an Always allow for whatever
        // they name, an offer nobody confirmed among them —: a press, as confirming one is (above; the re-read of
        // 11-11). No words retire it, which asks less of nobody.
        const unpressed = pressRefused(r.req);
        if (unpressed && allowsAlways(named, { text: b.text })) return send(r.res, 403, { error: unpressed, press: true });
        const out = await owner.correct(ref, { text: b.text || "", reason: b.reason ? String(b.reason) : "corrected in the console" });
        return sendJson(r.res, out.ok ? 200 : 409, out);
      }),
    ],
    [
      "GET",
      "/memory/items/:id/history",
      // Who changed a claim, when and why, and what it replaced (M2-4). The dashboard's ids are numbers; any id a
      // line or a search shows (i12, e:…) works too.
      guard((r) => {
        const id = decodeURIComponent(r.params.id);
        const h = memory.scope({ role: "owner" }).history(/^\d+$/.test(id) ? `i${id}` : id);
        return h.error ? sendJson(r.res, 404, h) : sendJson(r.res, 200, h);
      }),
    ],
    [
      "GET",
      "/memory/sessions",
      guard(async (r) => {
        const q = r.url.searchParams;
        // `kind=interactive,fork,tick,subagent` names the kinds wanted; the list's default is the developer's own
        // tasks (interactive, fork) unless `internal=all` asks for every kind, Filament's own calls (a loop's ticks)
        // included. `client=` narrows to one client name (`harness`, `claude-code`, …).
        const named = (q.get("kind") || "").split(",").map((s) => s.trim()).filter(Boolean);
        const internal = q.get("internal") === "all" ? "all" : "exclude";
        const sessions = memory.sessions(q.get("q") || "", {
          limit: Number(q.get("limit")) || 20,
          // `offset`: the rows a list read a page at a time has had already (Settings' auto-archive sweep and its
          // Archived chats read every page).
          offset: Math.max(0, Math.floor(Number(q.get("offset")) || 0)),
          project: q.get("project") || null,
          // `archived=only` is the Archived view, `all` both; the default list leaves archived sessions out.
          archived: ["only", "all"].includes(q.get("archived") || "") ? q.get("archived") : "exclude",
          internal,
          kinds: named.length ? named : internal === "all" ? [] : [...LISTED_KINDS],
          client: q.get("client") || null,
          // A chat another machine's agents started says whose (`fromAgents`), by name alone.
          agentsOf: agentsName,
        });
        // `remotes=1`: each with its repository's remote's key (`withRemotes`), as another machine's app lists them.
        if (q.get("remotes") !== "1") return sendJson(r.res, 200, { sessions });
        const folders = projectFolders();
        return sendJson(r.res, 200, { sessions: await withRemotes(sessions, (s) => folders.get(String(s.project ?? "")) || String(s.cwd || "")) });
      }),
    ],
    // What memory did for one turn (HarnessV3-Memory M6-1): what it showed, said at the calls, filed and asks.
    [
      "GET",
      "/memory/sessions/:id/turns/:n/memory",
      guard(async (r) => {
        const n = Number(r.params.n);
        if (!Number.isInteger(n) || n < 1) return sendJson(r.res, 400, { error: "the turn is its number in the session, from 1" });
        if (!memory.isOpen()) return sendJson(r.res, 503, { error: memory.archiveWhy() });
        const d = memory.turnMemory(r.params.id, n);
        return d ? sendJson(r.res, 200, d) : sendJson(r.res, 404, { error: "no such turn" });
      }),
    ],
    [
      "GET",
      "/memory/sessions/:id/lineage",
      guard((r) => {
        const l = memory.lineage ? memory.lineage(r.params.id) : null;
        return l ? sendJson(r.res, 200, l) : sendJson(r.res, 404, { error: "no such session" });
      }),
    ],
    // The turns that changed files, newest first (`?scope=turns`, the Changes pane's History): each one's count of
    // files, from the record alone — no git (`turnsChanged`).
    // What a turn's agents changed (`?turn=`), or the whole chat's (`?scope=chat`): each agent's own files per place,
    // net, marked where someone else changed one too; what changed while their commands ran, apart — their own, marked,
    // in a place only this chat works in (GW-D57); the files written outside any repository (HarnessV4_Git_Plan step
    // 1). Read-only git in each place. `folder`: the place of the chat's folder (`?cwd=`, else its own — a worktree's
    // chat keeps one — else its project's), so a page tells its files from another place's. `tree`: the folder's
    // snapshot in force at the turn, which a fork checks out. `?patch=1` adds each file's diff, clipped; `?path=` and
    // `?place=` narrow to one file. `?first=N` holds the files to the first N as the tree card orders them (by place,
    // then path, as `?locale=` compares them) and says how many each list holds (`treeFirst`); `?head=1` answers the
    // head alone, with no read of the turn's files — a fork reads `tree`. `?match=` with `?take=N` answers the files
    // whose path holds the words, the first N in the answer's own order (`changesMatching`), and says so in `match`: the
    // command center asks at each keystroke, where the whole was tens of megabytes. A turn's answer is kept while its
    // rounds, the places gone and the places only its chat works in stay as they were (`turnFirsts`, `turnWholes`); a
    // patch's, or the chat's, is read at each ask. A turn that recorded none answers an empty list with the reason.
    [
      "GET",
      "/memory/sessions/:id/changes",
      guard(async (r) => {
        const q = r.url.searchParams;
        const listed = q.get("scope") === "turns";
        const chat = q.get("scope") === "chat";
        const turn = Number(q.get("turn"));
        if (!listed && !chat && (!Number.isInteger(turn) || turn < 1))
          return sendJson(r.res, 400, { error: "turn is required: the turn number, from 1 — or scope=turns for the turns that changed files, scope=chat for the whole chat" });
        let t;
        try {
          t = memory.roundsOf(r.params.id, { turn: listed || chat ? null : turn });
        } catch (/** @type {any} */ e) {
          if (/^no such session/.test(e?.message)) return sendJson(r.res, 404, { error: "no such session" });
          throw e;
        }
        if (listed) return sendJson(r.res, 200, { chainId: t.chainId, turns: turnsChanged(t.rounds) });
        const cwd = q.get("cwd") || t.cwd;
        const folder = cwd ? (await placeOf(cwd)).place : null;
        const tree = t.tree ? { ref: t.tree.snapshotRef, turn: t.tree.turn, round: t.tree.round ?? null, at: t.tree.at ?? null, ...(t.tree.unheld ? { unheld: t.tree.unheld } : {}) } : null;
        const head = { chainId: t.chainId, turn: chat ? null : turn, folder, tree };
        if (q.get("head") === "1") return sendJson(r.res, 200, head);
        if (!t.rounds.length) {
          const note = !chat && turn > t.turns ? `this session has ${t.turns} turn(s)` : `${chat ? "this chat" : "this turn"} recorded no change of its own (nothing written, or agentLoop.treeSnapshots off)`;
          return sendJson(r.res, 200, { ...head, files: [], totals: { files: 0, added: 0, removed: 0 }, during: [], outside: [], places: [], errors: [], note });
        }
        // The places only this chat works in, where what its commands changed is its own (GW-D57).
        const alone = memory.placesAlone ? memory.placesAlone(t.chainId, t.rounds.map((x) => x.place)) : null;
        const patch = q.get("patch") === "1";
        const path = q.get("path") || null;
        const place = q.get("place") || null;
        const read = () => ownChangesOf(t.rounds, { patch, path, place, alone });
        const kept = !chat && !patch;
        const key = `${t.chainId}\n${turn}`;
        const { basis, gone } = kept ? turnBasis(t.rounds, alone) : { basis: "", gone: [] };
        const query = `${path ?? ""}\n${place ?? ""}`;
        // An answer that says git could not read a place is not kept: a timeout under load is gone at the next ask. One
        // that says a place's folder is gone is, where the basis found it gone too.
        const keep = (/** @type {any} */ o) => onlyGone(o.errors, gone);
        const whole = () => (kept ? turnWholes.get(key, basis, query, read, keep) : read());
        if (q.has("match")) {
          const take = Number(q.get("take"));
          if (!kept) return sendJson(r.res, 400, { error: "match reads a turn's files as they are kept: not with scope=chat or patch=1" });
          if (q.has("first")) return sendJson(r.res, 400, { error: "match and first each cut the files: ask one" });
          if (!Number.isInteger(take) || take < 1 || take > TURN_MATCH_MOST) return sendJson(r.res, 400, { error: `take is required with match: 1 to ${TURN_MATCH_MOST}` });
          const words = String(q.get("match")).trim();
          const o = await whole();
          return sendJson(r.res, 200, { ...head, files: changesMatching(o.files, folder, words, take), errors: o.errors, match: { q: words, take } });
        }
        const first = Number(q.get("first"));
        const locale = q.get("locale") || "";
        // The first rows kept apart from the whole they are cut from: the next ask neither walks nor sorts, while the
        // whole may have gone from its smaller store. Only a cut of a few: one of every row would be a whole kept. Past
        // a restart, the cut on disk is read before any walk, and one whose walk was slow and whole is written there.
        const cut = async () => {
          const onDisk = `${basis}\n${pastProcess}`;
          const asked = `${query}\n${first}\n${collatorOf(locale).resolvedOptions().locale}`;
          const had = disk ? await disk.get(t.chainId, key, onDisk, asked) : null;
          if (Array.isArray(had?.files) && Array.isArray(had?.errors)) return had;
          const o = await whole();
          const rows = treeFirst(o, first, locale);
          if (disk && keep(o) && disk.worth(walkOf(o))) void disk.put(t.chainId, key, onDisk, asked, rows);
          return rows;
        };
        const out = !(Number.isInteger(first) && first > 0)
          ? await whole()
          : kept && first <= TURN_FIRST_MOST
            ? await turnFirsts.get(key, basis, `${query}\n${first}\n${locale}`, cut, keep)
            : treeFirst(await whole(), first, locale);
        return sendJson(r.res, 200, { ...head, ...out });
      }),
    ],
    // The chat's outputs (HarnessV4_Four_Plan E20, FO-D30): the files its agents wrote that git does not show —
    // outside any repository, or ignored by its git — each as it stands now; the ones written outside any repository
    // that are no longer there, apart. Read-only git in each place.
    [
      "GET",
      "/memory/sessions/:id/outputs",
      guard(async (r) => {
        let t;
        try {
          t = memory.roundsOf(r.params.id);
        } catch (/** @type {any} */ e) {
          if (/^no such session/.test(e?.message)) return sendJson(r.res, 404, { error: "no such session" });
          throw e;
        }
        return sendJson(r.res, 200, { chainId: t.chainId, ...(await outputsOf(t.rounds)) });
      }),
    ],
    [
      "GET",
      "/memory/sessions/:id",
      guard((r) => {
        const d = memory.session(r.params.id, {
          view: r.url.searchParams.get("view") || "chat",
          budgetTokens: Number(r.url.searchParams.get("budget")) || 8000,
          fromTurn: r.url.searchParams.get("from") ? Number(r.url.searchParams.get("from")) : null,
          toTurn: r.url.searchParams.get("to") ? Number(r.url.searchParams.get("to")) : null,
        });
        return d ? sendJson(r.res, 200, d) : sendJson(r.res, 404, { error: "no such session" });
      }),
    ],
    [
      "POST",
      "/memory/sessions/:id/move",
      guard(async (r) => {
        const b = await r.json();
        if (!b?.project) return sendJson(r.res, 400, { error: "project is required" });
        return sendJson(r.res, 200, memory.moveSession(r.params.id, String(b.project)));
      }),
    ],
    [
      "POST",
      "/memory/sessions/:id/delete",
      guard(async (r) => {
        // The teams beside it go with it (team_v2_plan §9 Q9): each stopped first, then deleted with it. So do its
        // flows (HarnessV4_Flow_Plan F4), each box at work stopped.
        a.besides?.stopAll(r.params.id);
        a.flows?.drop(r.params.id);
        // And what was kept behind its task graphs, and theirs (HarnessV4_TaskNotes_Plan E33, case 12).
        const beside = memory.archive?.besideOf?.(r.params.id) || [];
        const out = await memory.deleteSession(r.params.id);
        for (const id of [r.params.id, ...beside]) a.taskNotes?.drop(id);
        return sendJson(r.res, 200, out);
      }),
    ],
    [
      "GET",
      "/memory/projects",
      // `remotes=1`: each with its repository's remote's key (`withRemotes`).
      guard(async (r) => {
        const projects = memory.projects();
        if (r.url.searchParams.get("remotes") !== "1") return sendJson(r.res, 200, { projects });
        return sendJson(r.res, 200, { projects: await withRemotes(projects || [], (p) => String(p.cwd || "")) });
      }),
    ],
    // A project named from the harness (Add project): the folder must exist, 400 in words when it does not. One outside
    // the roots agentLoop.roots lists is refused 403 in a chat's create's words (`outsideRootsWords`) — its chats could
    // work nowhere else — and so is one on a network share no listed root names, never asked of the disk.
    [
      "POST",
      "/memory/projects",
      guard(async (r) => {
        const b = await r.json();
        const cwd = String(b?.cwd || "").trim();
        if (folderVerdict(a.config.get(), cwd).why === "outside") return sendJson(r.res, 403, { error: outsideRootsWords(cwd) });
        const out = memory.createProject(cwd);
        return sendJson(r.res, out?.error ? 400 : 200, out);
      }),
    ],
    // The project each folder stands in (HarnessV4_Git_Plan GW-D46), one answer per path, computed and never made: the
    // new chat's menu shows a worktree's folder as its project, as the left bar does. A network share is never asked —
    // the page asks unprompted, as it asks `/files/exists` — and is answered null, as an empty path is and one that is
    // not whole (it would be read against the server's own folder). → `{ projects: ({ id, cwd, name, known } | null)[] }`
    [
      "POST",
      "/memory/projects/of",
      guard(async (r) => {
        const b = await r.json();
        const paths = (Array.isArray(b?.paths) ? b.paths : []).slice(0, 64).map((p) => String(p || "").trim());
        return sendJson(r.res, 200, { projects: memory.projectsOf(paths.map((p) => (isAbsolute(p) && !networkShare(p) ? p : ""))) });
      }),
    ],
    // Everything (the owner's of 10-30): the folder of Filament's own a chat outside any project works in, and its
    // project, made the first time one asks. → `{ cwd, project, name }`, or why no chat may work there, in words.
    [
      "POST",
      "/memory/projects/everything",
      guard((r) => {
        if (!a.everything) return sendJson(r.res, 503, { error: "Everything is not wired in this Filament" });
        try {
          return sendJson(r.res, 200, a.everything.ensure());
        } catch (/** @type {any} */ e) {
          if (Number.isInteger(e?.status)) return sendJson(r.res, e.status, { error: e.message });
          throw e;
        }
      }),
    ],
    [
      "POST",
      "/memory/projects/:id/archive",
      guard(async (r) => {
        const b = await r.json();
        const out = memory.archiveProject(r.params.id, b?.archived !== false);
        // What its Space runs by itself follows (r-itself, 11-12): archived, nothing of it runs; brought back, each
        // goes again — the routines' timer and the watchers' sources are set again from what stands now, and its kept
        // dashboards' watches (s-itself, 11-12).
        try {
          if (!out?.error) a.routines?.arm?.();
          if (!out?.error) a.dashboards?.reschedule?.();
        } catch (/** @type {any} */ e) {
          a.log?.("warn", `memory: what the Space of project ${r.params.id} runs by itself was not set again (${e?.message || e})`);
        }
        return sendJson(r.res, out?.error ? 404 : 200, out);
      }),
    ],
    [
      "POST",
      "/memory/projects/:id/delete",
      guard(async (r) => {
        // Every session under it takes what was kept behind its task graphs with it (HarnessV4_TaskNotes_Plan E33).
        const chains = a.taskNotes ? (memory.archive?.chainsForProject?.(r.params.id, { limit: 1_000_000 }) || []).map((/** @type {any} */ c) => String(c.id)) : [];
        const out = await memory.deleteProject(r.params.id);
        for (const id of chains) a.taskNotes?.drop(id);
        // Its Space goes with it, as the dialog said (HarnessV4_SpacesPlugins_Plan A5, SP-D6): nothing of it runs any
        // more — its routines and its dashboards' watches are read from it —, and the routines' timer is set again.
        try {
          if (a.spaces?.drop(r.params.id)) a.routines?.arm?.();
        } catch (/** @type {any} */ e) {
          a.log?.("warn", `memory: the Space of the deleted project ${r.params.id} could not be removed (${e?.message || e})`);
        }
        return sendJson(r.res, 200, out);
      }),
    ],
    [
      "GET",
      "/memory/turns/:id",
      guard((r) => {
        const d = memory.turnDetail(r.params.id);
        return d ? sendJson(r.res, 200, d) : sendJson(r.res, 404, { error: "no such turn" });
      }),
    ],
    [
      "POST",
      "/memory/injection-items",
      guard(async (r) => {
        const b = await r.json();
        if (!Array.isArray(b?.ids)) return sendJson(r.res, 400, { error: "ids (an array) is required" });
        return sendJson(r.res, 200, { items: await memory.injectionItems(b.ids) });
      }),
    ],
    [
      "GET",
      "/memory/activity",
      guard((r) =>
        sendJson(r.res, 200, {
          activity: memory.activity({ limit: Number(r.url.searchParams.get("limit")) || 50 }),
        }),
      ),
    ],
    [
      "GET",
      "/memory/benchmark",
      guard((r) =>
        sendJson(
          r.res,
          200,
          memory.benchmark(usage.records, { limit: Number(r.url.searchParams.get("limit")) || 100 }),
        ),
      ),
    ],
    // Memory's own model calls (learning, the engine): the same records and per-day totals the Traffic and Usage pages
    // show for client traffic, kept apart so neither page pollutes the other.
    [
      "GET",
      "/memory/traffic",
      guard((r) =>
        sendJson(r.res, 200, { requests: usage.memoryList(Number(r.url.searchParams.get("limit")) || 100) }),
      ),
    ],
    ["GET", "/memory/usage", guard(memUsage)],
    ["GET", "/memory/usage.csv", guard(memUsage)],
    // Identity facts (the memory plan's f5): the user's facts that hold in every project, each a claim of no project in a
    // slot about them: set by its name, deleted by its id (a slot may hold several).
    ["GET", "/memory/identity", guard(async (r) => sendJson(r.res, 200, { identity: memory.identity() }))],
    [
      "POST",
      "/memory/identity",
      guard(async (r) => {
        const b = await r.json();
        if (typeof b?.name !== "string" || !b.name.trim() || typeof b?.body !== "string" || !b.body.trim()) return sendJson(r.res, 400, { error: "name and body are required" });
        return sendJson(r.res, 200, await memory.identitySet({ name: b.name.trim(), body: b.body.trim() }));
      }),
    ],
    [
      "DELETE",
      "/memory/identity",
      guard(async (r) => {
        const b = (await r.json()) || {};
        const id = typeof b.id === "string" && /^i\d+$/.test(b.id.trim()) ? b.id.trim() : "";
        const name = typeof b.name === "string" ? b.name.trim() : "";
        if (!id && !name) return sendJson(r.res, 400, { error: "id or name is required" });
        return sendJson(r.res, 200, await memory.identityForget(id ? { id } : { name }));
      }),
    ],
    ["POST", "/memory/backup", guard(async (r) => sendJson(r.res, 200, await memory.backup()))],
    [
      "GET",
      "/memory/backups",
      guard((r) => sendJson(r.res, 200, { backups: memory.listBackups(), ...memory.backups.status() })),
    ],
    [
      "POST",
      "/memory/restore",
      guard(async (r) => {
        const b = await r.json();
        if (!b?.dir) return sendJson(r.res, 400, { error: "dir is required" });
        return sendJson(r.res, 200, await memory.restore(String(b.dir)));
      }),
    ],
    ["POST", "/memory/learn/:id", guard(async (r) => sendJson(r.res, 200, await memory.learn(r.params.id)))],
    // The curator (HarnessV3-Memory M4): memory's questions for the owner, its passes, and undoing one. Every write is
    // the owner's, through the port.
    [
      "GET",
      "/memory/inbox",
      guard((r) => {
        const q = r.url.searchParams;
        if (!memory.isOpen()) return sendJson(r.res, 503, { error: memory.archiveWhy() });
        return sendJson(r.res, 200, { questions: memory.scope({ role: "owner", project: q.get("project") || null }).questions({ status: q.get("status") || "open" }) });
      }),
    ],
    [
      "POST",
      "/memory/inbox/:id",
      guard(async (r) => {
        const b = (await r.json()) || {};
        if (b.answer !== "accept" && b.answer !== "reject") return sendJson(r.res, 400, { error: "answer is accept or reject" });
        const out = await memory.scope({ role: "owner" }).decide(String(r.params.id), b.answer);
        return sendJson(r.res, out.ok ? 200 : 409, out);
      }),
    ],
    [
      "POST",
      "/memory/curator/run",
      guard(async (r) => {
        const b = (await r.json()) || {};
        return sendJson(r.res, 200, await memory.scope({ role: "owner", project: b.project || null }).curate());
      }),
    ],
    [
      "GET",
      "/memory/curator/runs",
      guard((r) => {
        const q = r.url.searchParams;
        if (!memory.archive) return sendJson(r.res, 503, { error: memory.archiveWhy() });
        const project = q.get("project");
        return sendJson(r.res, 200, {
          runs: memory.archive.curator.list({ ...(project != null ? { projectId: project || null } : {}), limit: Math.min(200, Number(q.get("limit")) || 30) }),
          model: memory.curatorModel(project || null) || null,
          queued: memory.curator?.queued() || [],
        });
      }),
    ],
    // Memory's model (HarnessV3-Memory M6-3, the memory plan's m1): as set, its effort, whether the curator uses it, and
    // the model memory calls where no chat is named.
    ["GET", "/memory/models", guard((r) => sendJson(r.res, 200, { models: memory.models() }))],
    // Memory for any agent (HarnessV3-Memory M7-D46): where its door is and whether it asks a key, for the command
    // Settings writes; never a key.
    ["GET", "/memory/mcp", guard((r) => sendJson(r.res, 200, { path: "/mcp/memory", keyed: memoryKeys(a.config.get().server).length > 0 }))],
    // Set from a page (the memory plan's m1): memory's model — a model a route answers, empty (or `auto`) for none set,
    // `off` for none —, its effort — empty for low, `model` for the model's own, else a level — and whether the curator
    // uses it; saved with the config. Memory reads them live, so nothing reopens.
    [
      "POST",
      "/memory/models",
      guard(async (r) => {
        const b = (await r.json()) || {};
        /** @type {Record<string, string>} */
        const models = {};
        if (b.summarizer !== undefined) {
          const v = String(b.summarizer ?? "").trim();
          if (v && v !== "auto" && v !== "off") {
            const d = a.dryRun({ body: { model: v, messages: [{ role: "user", content: "." }] } });
            if (!d.ok) return sendJson(r.res, 400, { error: `summarizer: ${d.error}` });
          }
          models.summarizer = v === "auto" ? "" : v;
        }
        if (b.effort !== undefined) {
          const v = String(b.effort ?? "").trim().toLowerCase();
          if (v && v !== "model" && !EFFORT_LEVELS.includes(v)) return sendJson(r.res, 400, { error: `effort: one of ${["model", ...EFFORT_LEVELS].join(", ")}, or empty for low` });
          models.effort = v;
        }
        const uses = b.curatorUsesModel === undefined ? undefined : b.curatorUsesModel === true;
        if (!Object.keys(models).length && uses === undefined) return sendJson(r.res, 400, { error: "summarizer, effort or curatorUsesModel is required" });
        const next = structuredClone(a.config.get());
        next.memory = { ...(next.memory || {}), models: { ...(next.memory?.models || {}), ...models } };
        if (uses !== undefined) next.memory.curator = { ...(next.memory.curator || {}), usesModel: uses };
        a.config.set(next);
        a.config.save();
        /** @type {Record<string, string | boolean>} */
        const said = { ...models, ...(uses === undefined ? {} : { curatorUsesModel: uses }) };
        a.ops.record("config", `memory's model set (${Object.entries(said).map(([k, v]) => `${k}: ${v === "" ? "not set" : v}`).join(", ")})`, { sub: "memory-models", detail: said });
        return sendJson(r.res, 200, { ok: true, set: said, models: memory.models() });
      }),
    ],
    // The claim browser (HarnessV3-Memory M6-5): where claims live, and a project's claims (or the global ones, with no
    // project named) as cards, by state and kind.
    [
      "GET",
      "/memory/claims/scopes",
      guard((r) => (memory.isOpen() ? sendJson(r.res, 200, { scopes: memory.claimScopes() }) : sendJson(r.res, 503, { error: memory.archiveWhy() }))),
    ],
    // Every change to a claim as it happens, resumable (M7-D35).
    ["GET", "/memory/claims/stream", guard((r) => claimStream(r, memory, sseClients))],
    [
      "GET",
      "/memory/claims",
      guard((r) => {
        const q = r.url.searchParams;
        const state = q.get("state") || "standing";
        const kind = q.get("kind") || null;
        if (!CLAIM_STATES.includes(state)) return sendJson(r.res, 400, { error: `state is one of ${CLAIM_STATES.join(", ")}` });
        if (kind && !CLAIM_FILTER_KEYS.includes(kind)) return sendJson(r.res, 400, { error: `kind is one of ${CLAIM_FILTER_KEYS.join(", ")}` });
        const limit = Number(q.get("limit") || 200);
        if (!Number.isInteger(limit) || limit < 0) return sendJson(r.res, 400, { error: "limit is a whole number" });
        if (!memory.isOpen()) return sendJson(r.res, 503, { error: memory.archiveWhy() });
        const project = q.get("project") || null;
        if (project && !memory.archive?.getProject(project)) return sendJson(r.res, 404, { error: "no such project" });
        return sendJson(r.res, 200, memory.claims(project, { state, kind, q: q.get("q") || "", limit: Math.min(1000, limit) }));
      }),
    ],
    // One claim's card (M7-D34), by any id a line shows (i12, 12, an engine twin's id): after the scopes and the stream,
    // whose names it would take.
    [
      "GET",
      "/memory/claims/:id",
      guard((r) => {
        if (!memory.isOpen()) return sendJson(r.res, 503, { error: memory.archiveWhy() });
        const id = decodeURIComponent(r.params.id);
        const c = memory.card(/^\d+$/.test(id) ? `i${id}` : id);
        return "error" in c ? sendJson(r.res, 404, c) : sendJson(r.res, 200, c);
      }),
    ],
    // A project's dossier as a session starting now reads it (M4-7).
    [
      "GET",
      "/memory/dossier",
      guard((r) => {
        const project = r.url.searchParams.get("project");
        if (!project) return sendJson(r.res, 400, { error: "project is required" });
        if (!memory.isOpen()) return sendJson(r.res, 503, { error: memory.archiveWhy() });
        const d = memory.dossier(project);
        return d ? sendJson(r.res, 200, d) : sendJson(r.res, 404, { error: "no such project" });
      }),
    ],
    // A project's topic pages as a search serves them now (the memory plan's f7).
    [
      "GET",
      "/memory/pages",
      guard((r) => {
        const project = r.url.searchParams.get("project");
        if (!project) return sendJson(r.res, 400, { error: "project is required" });
        if (!memory.isOpen()) return sendJson(r.res, 503, { error: memory.archiveWhy() });
        const p = memory.pages(project);
        return p ? sendJson(r.res, 200, p) : sendJson(r.res, 404, { error: "no such project" });
      }),
    ],
    // How models did (M7-D52): the outcomes of the last `days` (30 unless named; up to the year they are kept), in a
    // project or everywhere, of one kind or all, by model and kind. A record the owner reads: nothing routes by it
    // (M7-D54).
    [
      "GET",
      "/memory/outcomes",
      guard((r) => {
        const q = r.url.searchParams;
        const days = Number(q.get("days") || 30);
        if (!Number.isInteger(days) || days < 1 || days > OUTCOME_DAYS) return sendJson(r.res, 400, { error: `days is a whole number from 1 to ${OUTCOME_DAYS}` });
        const kind = q.get("kind") || null;
        if (kind && !OUTCOME_KINDS.includes(kind)) return sendJson(r.res, 400, { error: `kind is one of ${OUTCOME_KINDS.join(", ")}` });
        if (!memory.isOpen()) return sendJson(r.res, 503, { error: memory.archiveWhy() });
        const project = q.get("project") || null;
        if (project && !memory.archive?.getProject(project)) return sendJson(r.res, 404, { error: "no such project" });
        return sendJson(r.res, 200, memory.outcomes({ project, days, kind }));
      }),
    ],
    // Memory's metrics (the memory plan's b4): what each layer showed over the last `days` (30 unless named) and what of
    // it the work used, by day, from the injection log on disk. A record the owner reads: nothing ranks by it.
    [
      "GET",
      "/memory/metrics",
      guard((r) => {
        const days = Number(r.url.searchParams.get("days") || METRIC_DAYS);
        if (!Number.isInteger(days) || days < 1 || days > METRIC_DAYS_MAX) return sendJson(r.res, 400, { error: `days is a whole number from 1 to ${METRIC_DAYS_MAX}` });
        if (!memory.isOpen()) return sendJson(r.res, 503, { error: memory.archiveWhy() });
        return sendJson(r.res, 200, memory.metrics({ days }));
      }),
    ],
    [
      "POST",
      "/memory/curator/runs/:id/undo",
      guard(async (r) => {
        const out = await memory.scope({ role: "owner" }).undo(String(r.params.id));
        return sendJson(r.res, out.ok ? 200 : 404, out);
      }),
    ],
    [
      "POST",
      "/memory/hygiene",
      guard(async (r) => {
        const b = (await r.json()) || {};
        return sendJson(r.res, 200, await memory.hygiene(b));
      }),
    ],
    ["POST", "/memory/diagnose", guard(async (r) => sendJson(r.res, 200, await memory.diagnose()))],
    ["POST", "/memory/reindex", guard(async (r) => sendJson(r.res, 200, await memory.reindex()))],
    ["GET", "/memory/sources", guard((r) => sendJson(r.res, 200, memory.sources()))],
    // The harness's Import section (HarnessV4_Import_Plan): the agents with their chats' states, one agent's chats,
    // the person's choices, the chats named brought in, and Sync. A request it cannot take is a 400 in words. The
    // overview names the chats a Sync would bring where it is asked to (`?list=1`, the welcome tour's Your chats), and
    // the chats named may be several agents' in one run (`picks`).
    ["GET", "/memory/import/overview", guard(async (r) => sendJson(r.res, 200, await memory.importOverview({ list: r.url.searchParams.get("list") === "1" })))],
    ["GET", "/memory/import/chats", guard((r) => asked(r.res, () => memory.importChats(r.url.searchParams.get("source") || "")))],
    ["PUT", "/memory/import/prefs", guard(async (r) => { const b = (await r.json()) || {}; return asked(r.res, () => memory.importPrefs(b)); })],
    ["POST", "/memory/import/chosen", guard(async (r) => { const b = (await r.json()) || {}; return asked(r.res, async () => ({ job: await memory.importChosen(b) })); })],
    ["POST", "/memory/import/sync", guard((r) => asked(r.res, async () => ({ job: await memory.importSync() })))],
    [
      "POST",
      "/memory/import",
      guard(async (r) => {
        const b = (await r.json()) || {};
        if (!b.source)
          return sendJson(r.res, 400, { error: "source is required: claude-code or mnemosyne" });
        return asked(r.res, () => ({ job: memory.import(b) }));
      }),
    ],
    ["POST", "/memory/mirror", guard(async (r) => sendJson(r.res, 200, { job: memory.mirror() }))],
    [
      "POST",
      "/memory/backfill",
      guard(async (r) => {
        const b = (await r.json()) || {};
        return asked(r.res, () => ({ job: memory.backfill({ limit: Number(b.limit) || 200, imported: b.imported === true }) }));
      }),
    ],
  ];
}

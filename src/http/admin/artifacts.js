// @ts-check
// The admin API's artifacts area (HarnessV4_Artifacts_Plan E18): what the harness reads of the pages agents made — each
// one's title, description, icon, type, address at the port Filament listens on now, pin, when it was last opened, and
// its versions with who made each and the call that published it (AF-D38), which a chat read again finds its cards
// by — and what the developer does to one from the Artifacts page (step 4): rename, pin, delete, make an old version
// the newest, download; a visual of a chat they keep as one (step 5); and a Doc's or a deck's Markdown they edit
// (step 6). A page's files are opened on the artifact's own address, never here; a download is the one read of them,
// as a file to keep — a Dashboard's with Filament's numbers it reads as they were then (step 7).
import { sendJson } from "../../app/pipeline/respond.js";
import { guard } from "./guard.js";
import { FEEDS, feedsOf } from "../../core/artifact-content.js";
import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { appJsonOf } from "../../core/app-folder.js";
import {
  APP_JSON,
  CONTENT_FILE,
  CONTENT_JSON,
  NAME_SLOT,
  PAGE_FILE,
  artifactAddress,
  artifactsAt,
  artifactTypeOf,
  isTextData,
  cleanTitle,
  contentFileOf,
  isEditable,
  isTyped,
  keptPage,
  keptTitle,
  pageAlone,
  typeShell,
} from "../../core/artifacts.js";
import { PAGE_SCRIPT_TEXT, lookCss, ownPass, typeData, typeOwnAlone } from "../artifacts.js";
import { loopbackTrusted } from "../guards.js";
import { zipOf } from "../../services/zip.js";
import { PINNED_TEXT, PINS_FILE, WEB_DIR, isWebFile, pinnedText, pinsOf, relativeRef } from "../../core/web-pins.js";

/** @typedef {{ title: string, gone: boolean }} ChatSeen  a chat by its title, or that it was deleted (AFC-15) */
/** @typedef {{ name: string, count: number } | { name: string, error: string }} DataSeen  a collection its page keeps */
/** @typedef {{ feed: string, words: string }} ReadSeen  one of Filament's numbers a Dashboard reads (AF-D12) */

/**
 * An artifact as the harness reads it: `folder` and `model` are the newest version's that a session made (a version
 * the developer made the newest again or edited names none, AFC-79, AFC-115); `chats`, each chat that made a
 * version, as `chatOf` finds it — none where there is no archive to ask; `data`, the collections its page keeps, as
 * `dataOf` reads them (AFC-97); `reads`, Filament's numbers its newest version reads, as `readsOf` finds them (AFC-132).
 * @param {import("../../services/artifacts.js").Artifact} a @param {number} port
 * @param {(chain: string) => ChatSeen | null} [chatOf] @param {(name: string) => DataSeen[]} [dataOf]
 * @param {(a: import("../../services/artifacts.js").Artifact) => ReadSeen[]} [readsOf]
 */
export const artifactView = (a, port, chatOf = () => null, dataOf = () => [], readsOf = () => []) => {
  const made = [...a.versions].reverse().find((v) => v.by.from === undefined && v.by.edited === undefined) || a.versions[0];
  /** @type {Record<string, ChatSeen>} */
  const chats = {};
  for (const v of a.versions) {
    const seen = v.by.chain && !(v.by.chain in chats) ? chatOf(v.by.chain) : null;
    if (seen && v.by.chain) chats[v.by.chain] = seen;
  }
  return {
    name: a.name,
    title: a.title,
    description: a.description,
    icon: a.icon,
    type: a.type,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    pinned: a.pinned,
    viewedAt: a.viewedAt,
    folder: made.by.folder || "",
    model: made.by.model || "",
    address: artifactAddress(a.name, port),
    versions: a.versions.map((v) => ({
      v: v.v,
      at: v.at,
      model: v.by.model,
      chain: v.by.chain,
      helper: v.by.helper,
      call: v.by.call ?? null,
      from: v.by.from ?? null,
      ...(v.by.visual ? { visual: v.by.visual } : {}),
      ...(v.by.edited !== undefined ? { edited: v.by.edited } : {}),
      // Its own files, as its publish counted them: the web's it keeps for offline are Filament's (found reviewing the
      // Space work: Info said 14 files where its publish said 3).
      files: v.files.filter((f) => !isWebFile(f.path)).length,
      bytes: v.files.filter((f) => !isWebFile(f.path)).reduce((n, f) => n + f.bytes, 0),
    })),
    chats,
    data: dataOf(a.name),
    reads: a.type === "dashboard" ? readsOf(a) : [],
  };
};

/**
 * Filament's numbers a Dashboard's newest version reads, each with its words (AFC-132); none where its content does not
 * read.
 * @param {import("../../services/artifacts.js").ArtifactStore} store @param {import("../../services/artifacts.js").Artifact} a
 * @returns {ReadSeen[]}
 */
export function readsOf(store, a) {
  try {
    return feedsOf(JSON.parse(String(store.file(a.name, a.versions.length, CONTENT_JSON) || ""))).map((feed) => ({ feed, words: FEEDS[feed].words }));
  } catch {
    return [];
  }
}

/**
 * The versions a session's own agent published, each by the call that published it (AF-D38): its chat, read again,
 * draws each card after the words that led to it. A helper's stay its own (AFC-3).
 * @param {import("../../services/artifacts.js").ArtifactStore | null | undefined} store @param {string} chain
 */
export function madeIn(store, chain) {
  if (!store || !chain) return [];
  return store.list().flatMap((x) =>
    x.versions
      .filter((v) => v.by.chain === chain && !v.by.helper && v.by.call)
      .map((v) => ({ call: String(v.by.call), name: x.name, v: v.v, title: x.title, icon: x.icon, type: x.type })));
}

/**
 * What a session's helpers published (AFC-100): each artifact once for each helper and exchange, at the newest version
 * that exchange made, the first made first — the card that launched or asked a helper names them after Filament has let
 * the helper go.
 * @param {import("../../services/artifacts.js").ArtifactStore | null | undefined} store @param {string} chain
 * @returns {{ helper: string, exchange: number, name: string, v: number, title: string }[]}
 */
export function helpersMade(store, chain) {
  if (!store || !chain) return [];
  /** @type {Map<string, { helper: string, exchange: number, name: string, v: number, title: string, at: number }>} */
  const made = new Map();
  for (const x of store.list())
    for (const v of x.versions) {
      if (v.by.chain !== chain || !v.by.helper) continue;
      const exchange = Number(v.by.exchange) || 0;
      const key = `${v.by.helper}\u0000${exchange}\u0000${x.name}`;
      made.set(key, { helper: v.by.helper, exchange, name: x.name, v: v.v, title: x.title, at: made.get(key)?.at ?? v.at });
    }
  return [...made.values()].sort((a, b) => a.at - b.at).map(({ at, ...m }) => m);
}

/**
 * A version as one file to keep (AF-D13, AFC-48, AFC-82): a page alone, as its own HTML; with files beside it, a .zip
 * of them all. Either way each page in it opens alone in Filament's look. A typed artifact is one page, with its content
 * and Filament's code for it inside (AFC-118) — a Dashboard's with Filament's numbers it reads as `feeds` gives them now,
 * kept as they were (AFC-133).
 * @param {import("../../services/artifacts.js").Artifact} a @param {number} v
 * @param {import("../../services/artifacts.js").FileIn[]} files
 * @param {import("../../services/artifact-feeds.js").Feeds | null} [feeds]
 * @returns {{ file: string, type: string, data: Buffer }}
 */
export function downloadOf(a, v, files, feeds = null) {
  const stem = v === a.versions.length ? a.name : `${a.name}-v${v}`;
  const content = isTyped(a.type) ? files.find((f) => f.path === contentFileOf(a.type)) : null;
  const drawn = content ? typeData(a.type, content.data, v) : null;
  if (drawn) {
    const type = /** @type {keyof typeof import("../../core/artifacts.js").TYPE_MODULES} */ (a.type);
    const data = type === "dashboard" ? { ...drawn, snapshot: feeds ? feeds.snapshot(drawn.content) : { at: Date.now(), feeds: {} } } : drawn;
    return { file: `${stem}.html`, type: "text/html; charset=utf-8", data: Buffer.from(pageAlone(typeShell(type, a.title, data, typeOwnAlone(type, data)), a.title, lookCss(), PAGE_SCRIPT_TEXT), "utf8") };
  }
  // What it kept from the web is in the .zip beside its files, each address pointed at its file by a relative path,
  // so it opens alone with no network (vendor on publish, 10-29).
  const pins = pinsOf(files.find((f) => f.path === PINS_FILE)?.data);
  // An app's carries its app.json (Import app…, 10-29), which Import app… reads back: what it reads, runs and shows.
  const all = a.type === "app" ? [...files, appJsonFile(a, v, files)] : files;
  const pointed = Object.keys(pins).length
    ? all.map((f) => (PINNED_TEXT.test(f.path) && !isWebFile(f.path) && isTextData(f.data) ? { path: f.path, data: Buffer.from(pinnedText(f.data.toString("utf8"), pins, (p) => relativeRef(f.path, `${WEB_DIR}/${p}`)), "utf8") } : f))
    : all;
  const alone = pointed.map((f) => (artifactTypeOf(f.path).startsWith("text/html") ? { path: f.path, data: Buffer.from(pageAlone(f.data.toString("utf8"), a.title, lookCss(), PAGE_SCRIPT_TEXT), "utf8") } : f));
  if (alone.length === 1 && alone[0].path === PAGE_FILE) return { file: `${stem}.html`, type: "text/html; charset=utf-8", data: alone[0].data };
  return { file: `${stem}.zip`, type: "application/zip", data: zipOf(alone, new Date(/** @type {any} */ (a.versions[v - 1]).at)) };
}

/**
 * An app's app.json, for its download (Import app…, 10-29): its record's words and its version's content, the folder it
 * was published from — where that is inside the project it was made in — written `{{folder}}`.
 * @param {import("../../services/artifacts.js").Artifact} a @param {number} v
 * @param {import("../../services/artifacts.js").FileIn[]} files
 */
function appJsonFile(a, v, files) {
  /** @type {Record<string, unknown>} */
  let content = {};
  try {
    content = JSON.parse(String(files.find((f) => f.path === CONTENT_JSON)?.data || "{}"));
  } catch {}
  const by = a.versions[v - 1]?.by;
  /** The project's folder as it really is, as `dir` was kept; as named where it is gone. */
  const real = (/** @type {string} */ f) => {
    try {
      return realpathSync(f);
    } catch {
      return f;
    }
  };
  const rel = by?.dir && by.folder ? relative(real(by.folder), by.dir).replace(/\\/g, "/") : "";
  const folder = rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : null;
  const json = appJsonOf({ title: a.title, description: a.description, icon: a.icon, content, folder });
  return { path: APP_JSON, data: Buffer.from(`${JSON.stringify(json, null, 2)}\n`, "utf8") };
}

/** What writes an artifact the developer cannot edit as text (AFC-144). @param {import("../../services/artifacts.js").Artifact} it */
const writtenBy = (it) => (isTyped(it.type) ? `a ${it.type} its agent writes as data` : "a page its agent writes");

/**
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function artifactRoutes(a) {
  /** @type {import("../../services/artifacts.js").ArtifactStore} */
  const store = a.artifacts;
  /** @type {() => number} */
  const port = a.selfPort;
  /**
   * A chat that made a version, by its title, or that it was deleted: the archive's word, none without one.
   * @param {string} chain @returns {ChatSeen | null}
   */
  const chatOf = (chain) => {
    const archive = a.memory?.archive;
    if (!archive) return null;
    const c = archive.getChain(chain);
    return c ? { title: String(c.title || ""), gone: false } : { title: "", gone: true };
  };
  /** The collections an artifact's page keeps, none where its data does not read. @param {string} name */
  const dataOf = (name) => {
    const r = store.data.collections(name);
    return r.ok ? r.collections : [];
  };
  /** An artifact as the harness reads it, here and now. @param {import("../../services/artifacts.js").Artifact} x */
  const view = (x) => artifactView(x, port(), chatOf, dataOf, (y) => readsOf(store, y));
  /** The name a route was asked for. @param {any} r */
  const nameOf = (r) => decodeURIComponent(r.params.name).toLowerCase();
  /**
   * The artifact a route names, or the answer that there is none: a record that does not read (500), one deleted
   * (410, with its title and when, AFC-78), none (404). @param {any} r
   */
  const one = (r) => {
    const name = nameOf(r);
    if (store.broken(name)) return { sent: sendJson(r.res, 500, { error: `The artifact ${name} could not be read from Filament's store.` }) };
    const it = store.get(name);
    if (it) return { it };
    const gone = store.deleted(name);
    if (gone) return { sent: sendJson(r.res, 410, { error: `${gone.title} was deleted.`, deleted: true, title: gone.title, deletedAt: gone.deletedAt }) };
    return { sent: sendJson(r.res, 404, { error: `No artifact is named ${name}.` }) };
  };
  return [
    [
      "GET",
      "/artifacts",
      // `?chain=`: those a session made a version of (its cards, AFC-64), else every one, the newest change first;
      // with `&visual=`, the one kept from that visual of it (AFC-102).
      guard((r) => {
        const chain = r.url.searchParams.get("chain");
        const visual = r.url.searchParams.get("visual");
        const all = store.list().filter((x) => !chain || x.versions.some((v) => v.by.chain === chain && (!visual || v.by.visual === visual)));
        return sendJson(r.res, 200, { artifacts: all.map(view) });
      }),
    ],
    [
      "POST",
      "/artifacts/:name/pass",
      // Its address for one that leaves Filament's page — Open in browser, Copy link, a link pressed in a chat (x41):
      // where this computer's programs need the owner key, a `.art.localhost` address under a pass of its own alone
      // (http/artifacts.js `ownPass`), never the page's pass for every artifact; else as it is. `still`: its still
      // preview's, under a pass that writes nothing. "" where the page reached Filament from afar, whose artifacts'
      // address gives each page its own pass as it loads.
      guard(async (r) => {
        const o = one(r);
        if (!o.it) return o.sent;
        const it = o.it;
        const still = ((await r.json()) || {}).still === true;
        const server = a.config.get().server;
        const pass = () => (!loopbackTrusted(server) && r.who && a.artifactPasses ? ownPass(a.artifactPasses(), it.name, r.who, server, still) : "");
        const at = artifactsAt(String(r.req?.headers?.host || ""), null, pass);
        return sendJson(r.res, 200, { address: at && !at.page.startsWith("https://") ? (still ? at.still : at.page).replace(NAME_SLOT, it.name) : "" });
      }),
    ],
    [
      "POST",
      "/artifacts",
      // `{ visual: { chain, turn, id } }`: that visual of a chat kept by the developer as a new artifact (AFC-101) —
      // its code the page, its title the artifact's; `turn` null for one the session keeps itself. A visual kept
      // already is answered with its artifact, `already` (AFC-102): one visual keeps one artifact.
      guard(async (r) => {
        const asked = ((await r.json()) || {}).visual;
        const chain = typeof asked?.chain === "string" ? asked.chain : "";
        const id = typeof asked?.id === "string" ? asked.id : "";
        if (!chain || !id) return sendJson(r.res, 400, { error: "Give the visual to keep: { visual: { chain, turn, id } }." });
        const kept = store.list().find((x) => x.versions.some((v) => v.by.chain === chain && v.by.visual === id));
        if (kept) return sendJson(r.res, 200, { ...view(kept), already: true });
        const sessions = a.sessions;
        if (!sessions) return sendJson(r.res, 503, { error: "This Filament keeps no chats, so it has no visual to keep." });
        let drawn;
        try {
          drawn = asked.turn == null ? sessions.sessionVisual(chain, id) : sessions.turnVisual(chain, Number(asked.turn), id);
        } catch (/** @type {any} */ e) {
          if (Number.isInteger(e?.status) && e.status >= 400 && e.status < 500) return sendJson(r.res, e.status, { error: `Not kept: ${e.message}.` });
          throw e;
        }
        const page = { path: PAGE_FILE, data: Buffer.from(keptPage(String(drawn.code ?? ""), drawn.madeIn), "utf8") };
        const by = { chain, model: "", folder: sessions.launchInfo(chain)?.cwd || "", helper: null, call: null, visual: id };
        const done = store.publish({ title: keptTitle(drawn.title), icon: "page", files: [page], by, who: null });
        if (!done.ok) return sendJson(r.res, 500, { error: `Not kept: ${"error" in done ? done.error : "the store refused it"}.` });
        return sendJson(r.res, 200, view(done.artifact));
      }),
    ],
    [
      "GET",
      "/artifacts/:name",
      guard((r) => {
        const o = one(r);
        return o.it ? sendJson(r.res, 200, view(o.it)) : o.sent;
      }),
    ],
    [
      "PATCH",
      "/artifacts/:name",
      // `{ title }` renames it, its address kept (AFC-32, AFC-80); `{ pinned }` pins it or not (AFC-13).
      guard(async (r) => {
        const o = one(r);
        if (!o.it) return o.sent;
        const b = (await r.json()) || {};
        /** @type {{ title?: string, pinned?: boolean }} */
        const change = {};
        if (b.title !== undefined) {
          const t = cleanTitle(b.title);
          if (!t.ok) return sendJson(r.res, 400, { error: t.error });
          change.title = t.title;
        }
        if (b.pinned !== undefined) {
          if (typeof b.pinned !== "boolean") return sendJson(r.res, 400, { error: "pinned is true or false." });
          change.pinned = b.pinned;
        }
        if (!Object.keys(change).length) return sendJson(r.res, 400, { error: "Give a title or pinned to change." });
        const next = store.update(o.it.name, change);
        return next ? sendJson(r.res, 200, view(next)) : sendJson(r.res, 404, { error: `No artifact is named ${o.it.name}.` });
      }),
    ],
    [
      "DELETE",
      "/artifacts/:name",
      // Every version, file and record; its address then says it was deleted (AF-D14, AFC-46). A record that does not
      // read can be deleted too.
      guard((r) => {
        const name = nameOf(r);
        if (!store.remove(name)) return store.deleted(name) ? sendJson(r.res, 410, { error: `${name} was deleted already.`, deleted: true }) : sendJson(r.res, 404, { error: `No artifact is named ${name}.` });
        return sendJson(r.res, 200, { deleted: true, name });
      }),
    ],
    [
      "POST",
      "/artifacts/:name/newest",
      // `{ v }`: that version, made the newest again by the developer (AFC-28, AFC-79).
      guard(async (r) => {
        const o = one(r);
        if (!o.it) return o.sent;
        const b = (await r.json()) || {};
        const done = store.restore(o.it.name, Number(b.v));
        if (!done.ok) return sendJson(r.res, 400, { error: `${done.error}.` });
        return sendJson(r.res, 200, view(done.artifact));
      }),
    ],
    [
      "GET",
      "/artifacts/:name/text",
      // A Doc's or a deck's Markdown, which the developer edits (AFC-115): the newest version's, or `?v=`'s.
      guard((r) => {
        const o = one(r);
        if (!o.it) return o.sent;
        const it = o.it;
        if (!isEditable(it.type)) return sendJson(r.res, 400, { error: `${it.title} is ${writtenBy(it)}: it has no text to edit.` });
        const asked = r.url.searchParams.get("v");
        const v = asked == null ? it.versions.length : Number(asked);
        if (!Number.isInteger(v) || v < 1 || v > it.versions.length) return sendJson(r.res, 404, { error: `${it.title} has no version ${asked}: it has 1 to ${it.versions.length}.` });
        const text = store.file(it.name, v, CONTENT_FILE);
        if (!text) return sendJson(r.res, 500, { error: `v${v} of ${it.title} could not be read from the disk.` });
        return sendJson(r.res, 200, { v, markdown: text.toString("utf8") });
      }),
    ],
    [
      "POST",
      "/artifacts/:name/versions",
      // `{ markdown, base, force? }`: a Doc's or a deck's Markdown as the developer edited it, the next version,
      // made by them (AFC-115). `base`: the version they began from; where a newer one came since, nothing is kept
      // unless `force`, and the answer says which (`stale`, AFC-116). The same text as the newest keeps nothing
      // (`unchanged`).
      guard(async (r) => {
        const o = one(r);
        if (!o.it) return o.sent;
        const it = o.it;
        if (!isEditable(it.type)) return sendJson(r.res, 400, { error: `${it.title} is ${writtenBy(it)}: ask for a change in its chat. A Doc or a deck is edited here.` });
        const b = (await r.json()) || {};
        if (typeof b.markdown !== "string" || !b.markdown.trim()) return sendJson(r.res, 400, { error: "The text is empty: give the Markdown to keep." });
        const newest = it.versions.length;
        const base = Number(b.base);
        if (!Number.isInteger(base) || base < 1 || base > newest) return sendJson(r.res, 400, { error: `Give base: the version you began from, 1 to ${newest}.` });
        if (base !== newest && b.force !== true) {
          const came = /** @type {import("../../services/artifacts.js").Version} */ (it.versions.at(-1));
          return sendJson(r.res, 409, { error: `${it.title} changed while you edited it: v${came.v} came since your v${base}.`, stale: true, ...view(it) });
        }
        if (store.file(it.name, newest, CONTENT_FILE)?.toString("utf8") === b.markdown) return sendJson(r.res, 200, { ...view(it), unchanged: true });
        const by = { chain: null, model: "", folder: "", helper: null, call: null, edited: base };
        const done = store.publish({ name: it.name, files: [{ path: CONTENT_FILE, data: Buffer.from(b.markdown, "utf8") }], by, who: null });
        if (!done.ok) return sendJson(r.res, 500, { error: `Not saved: ${"error" in done ? done.error : "the store refused it"}.` });
        return sendJson(r.res, 200, view(done.artifact));
      }),
    ],
    [
      "GET",
      "/artifacts/:name/download",
      // `?v=`: a version, the newest where none is named (AFC-48, AFC-82).
      guard((r) => {
        const o = one(r);
        if (!o.it) return o.sent;
        const asked = r.url.searchParams.get("v");
        const v = asked == null ? o.it.versions.length : Number(asked);
        if (!Number.isInteger(v) || v < 1 || v > o.it.versions.length) return sendJson(r.res, 404, { error: `${o.it.title} has no version ${asked}: it has 1 to ${o.it.versions.length}.` });
        const files = store.files(o.it.name, v);
        if (!files) return sendJson(r.res, 500, { error: `v${v} of ${o.it.title} could not be read from the disk.` });
        const d = downloadOf(o.it, v, files, a.artifactFeeds);
        r.res.writeHead(200, {
          "content-type": d.type,
          "content-length": String(d.data.length),
          "content-disposition": `attachment; filename="${d.file}"`,
          "x-content-type-options": "nosniff",
          "cache-control": "no-store",
        });
        return r.res.end(d.data);
      }),
    ],
  ];
}

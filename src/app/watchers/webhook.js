// @ts-check
// A program's post as a watcher's trigger (the plan of 11-11, its v2-b): a webhook watcher that is on has an address
// of its own, `/watch/<token>` (http/watch-hooks.js is its door, services/watch-hooks.js keeps its token), and each
// POST there — a CI job, a script, a tool's notify URL — is one event that wakes it.
// Its address is made as the person switches it on, stays while it is paused, and ends when its chat changes it, when
// it is removed, and when the person makes a new one. The addresses follow the store's watchers each time the routines
// arm (`sync`), and the door asks at every post whether the watcher still stands at the Switch on its address was made
// for (`at`): an address opens nothing from the moment its watcher is off, whenever the sources next look.
// The address is the person's alone, read and renewed by their press (`addressOf`, `renew`; the admin API's rows): it
// is in no Space's document, no answer of the space tool, no packet, no line of What happened and no log line. An
// agent that knew its watcher's address could wake itself with a post of its own.
// There is no public address: the door takes this computer and the tailnet's door, never the network's listener and
// never Tailscale Funnel. A service on the internet reaches a watcher through a connection's tool (connection.js), or
// through a script here that polls it and posts.
// `sign: "github"`: the address has a secret, shown to the person once, and a post is taken only with
// `X-Hub-Signature-256: sha256=<HMAC-SHA256 of its bytes under the secret>`, compared in the same time whatever it
// holds. One signed wrongly, or not at all, is refused and counted in the watcher's trouble (`watchTrouble`: core's
// `POSTS_REFUSED`, its count beside it) until a post is taken, it is resumed or switched on again; it is never an event. A signature
// is kept with no body: the agent that reads a post could send it again with it, were the address ever known to it.
// A post is the outside's: no rule makes one a chat's own, as a commit can be. The cost: a chat this watcher wakes
// whose work makes a program post here — its push starts the CI job that posts — wakes itself, as often as the
// routines' cap of wake-ups an hour lets it.
// Paused, or under Pause all, a post is taken and dropped: nothing is heard and nothing made up later, and its sender
// is told nothing of the watcher's state — a wrong signature is refused all the same, uncounted.
// The door is answered before the hearing: a post is taken once its body is kept, and the routines hear it after. The
// cost: a hearing that fails — the Space's file could not be written — is a log line and a post lost, its sender told
// it was taken.
// A post's body is kept beside the store, the newest 20 for a watcher, for the wake that reads it (`postOf`, the
// packet's): while its event waits; then until the wake that took it ended — judged by time: the watcher's last wake
// began at or after the post came, and runs no more. A watcher that tells only the person keeps one no longer than
// its event waits. The cost: a wake that never ends keeps its bodies until newer ones push them out; and a post that
// came in the very millisecond a wake began, missed it, and is taken by the next while the sources look, is read by
// that wake as "Its body is not kept." A body the disk refuses is the watcher's trouble (`postUnkept`), its event
// heard all the same.
// An address takes 60 posts a minute, counted here in memory: a restart forgets the minute.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { hookHeaders } from "../../core/app-hooks.js";
import { POSTS_REFUSED, WEBHOOK_LIMITS, fenced, postType, postUnkept, refusedPosts, watchEventOf, webhookSheet } from "../../core/watchers.js";
import { tailnetDoor } from "../../services/tailscale.js";

const MINUTE_MS = 60_000;
/** The start of a body its event's line is made from: more than the line holds, so squashed white space leaves it whole. */
const HEAD_RAW = WEBHOOK_LIMITS.head * 4;
/** What a wake reads of a post whose body is kept no more, or never was. */
const NOT_KEPT = "Its body is not kept.";
/** The room a count of what a clip left out takes, in a body's JSON. */
const NOTE_ROOM = 48;
/** The least room in which a key's own value is clipped rather than left out whole. */
const PART_ROOM = 400;
const NO_ADDRESS = "no watcher listens at this address: copy it again from the watcher's sheet";
const UNSIGNED =
  "this address takes posts signed as GitHub signs its webhooks — X-Hub-Signature-256: sha256=<the body's HMAC-SHA256 under its secret> —: this one's signature was wrong or missing";
/** The headers a post's signature comes in, kept with no body: GitHub's, and its older one. */
const SIGNATURES = ["x-hub-signature-256", "x-hub-signature"];

/**
 * @typedef {import("../../core/routines.js").Routine} Routine
 * @typedef {import("../../services/watch-hooks.js").KeptPost} KeptPost
 * @typedef {{ url: string, urlTailnet?: string, sign: "github" | null, secret?: string }} AddressRead
 *   a watcher's address as the person's sheet reads it: where a program on this computer posts, where one on the
 *   tailnet does while Filament is served there, how its posts are signed, and its secret the one time it is shown
 */

/** @param {number} n */
const counted = (n) => n.toLocaleString("en-US");
/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });

/**
 * Whether a post's bytes are signed with a secret as GitHub signs (`sha256=` and the HMAC in hex), compared in the
 * same time whatever was given: both are hashed, and the hashes compared whole.
 * @param {string | undefined} secret @param {Buffer} body @param {unknown} given
 */
function signedBy(secret, body, given) {
  if (!secret) return false;
  const want = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const got = String((Array.isArray(given) ? given[0] : given) ?? "").trim().toLowerCase();
  return timingSafeEqual(createHash("sha256").update(want).digest(), createHash("sha256").update(got).digest());
}

/**
 * Text cut so that it fits `room` as JSON, what was cut counted at its end. @param {string} s @param {number} room
 */
function cutText(s, room) {
  let n = Math.max(0, Math.min(s.length, room - 40));
  for (;;) {
    const t = `${s.slice(0, n)}… (${counted(s.length - n)} more characters)`;
    const len = JSON.stringify(t).length;
    if (len <= room || n === 0) return t;
    n = Math.max(0, Math.min(n - 1, Math.floor((n * room) / len) - 8));
  }
}

/**
 * A JSON value clipped to `room` characters as JSON, so that what remains still parses: of a list or an object, the
 * first entries that fit, whole; the first that does not is clipped inside where the room left says something of it;
 * the rest are left out, counted in a last entry of their own. A long text is cut inside its quotes.
 * @param {unknown} v @param {number} room @returns {unknown}
 */
function fitted(v, room) {
  if (JSON.stringify(v).length <= room) return v;
  if (typeof v === "string") return cutText(v, room);
  if (!v || typeof v !== "object") return v;
  const list = Array.isArray(v);
  /** @type {[string, unknown][]} */
  const entries = list ? v.map((x, i) => [String(i), x]) : Object.entries(v);
  /** @type {[string, unknown][]} */
  const out = [];
  let used = 2;
  let left = 0;
  for (let i = 0; i < entries.length; i++) {
    const [k, x] = entries[i];
    const lead = (out.length ? 1 : 0) + (list ? 0 : JSON.stringify(k).length + 1);
    const size = lead + JSON.stringify(x).length;
    if (used + size + NOTE_ROOM <= room) {
      out.push([k, x]);
      used += size;
      continue;
    }
    left = entries.length - i;
    const rest = room - used - NOTE_ROOM - lead;
    if (rest >= PART_ROOM && (typeof x === "string" || (x && typeof x === "object"))) {
      out.push([k, fitted(x, rest)]);
      left -= 1;
    }
    break;
  }
  if (list) return [...out.map(([, x]) => x), ...(left ? [`… ${counted(left)} more ${left === 1 ? "item" : "items"} left out`] : [])];
  return Object.fromEntries([...out, ...(left ? [["…", `${counted(left)} more ${left === 1 ? "key" : "keys"} left out`]] : [])]);
}

/**
 * A post's body as its woken agent reads it, `max` characters at most: as it was sent where it fits; where it is
 * JSON, clipped so that it still parses (`fitted`); else cut, and said so. `note`: what the part's label says of it.
 * @param {string} text @param {number} max @returns {{ text: string, note: string }}
 */
export function bodyShown(text, max) {
  if (text.length <= max) return { text, note: "" };
  if (/^\s*[[{]/.test(text))
    try {
      const fit = JSON.stringify(fitted(JSON.parse(text), max));
      if (fit.length <= max) return { text: fit, note: "; clipped to fit, what was left out counted where it was" };
    } catch {
      // No JSON, or nested past what a call stack holds: cut as text.
    }
  return { text: text.slice(0, max), note: `; its first ${counted(max)} characters` };
}

/**
 * A kept post as a wake's packet says it past its event's line (app/watchers/packet.js): its body under its content
 * type and length, then its headers that name no secret — each fenced, as all a packet holds from outside the chat.
 * @param {KeptPost} p @returns {string[]}
 */
export function postParts(p) {
  /** @type {string[]} */
  const parts = [];
  // Control characters go, but a tab and a line's end: what remains is text a fence holds.
  const body = p.body.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
  if (!body.trim()) parts.push("It had no body.");
  else {
    const shown = bodyShown(body, WEBHOOK_LIMITS.body);
    parts.push(`Its body (${p.type || "no content type"}, ${counted(p.body.length)} ${p.body.length === 1 ? "character" : "characters"}${shown.note}):\n${fenced(shown.text)}`);
  }
  const headers = Object.entries(p.headers).map(([k, v]) => `${k}: ${String(v).replace(/\s+/g, " ").trim()}`);
  if (headers.length) parts.push(`Its headers, less any that may carry a secret:\n${fenced(headers.join("\n"))}`);
  return parts;
}

/**
 * @param {{ store: { get: (project: string) => { routines: Routine[] }, routinesAll: () => { project: string, r: Routine }[], pausedSince: () => number | null, archived?: (project: string) => boolean,
 *     watchTrouble: (project: string, id: string, why: string | null, fails?: number) => boolean },
 *   hooks: import("../../services/watch-hooks.js").WatchHooks,
 *   heard: (project: string, id: string, events: readonly unknown[]) => Promise<number> | number,
 *   base: () => string, tailnet?: () => string | null, now?: () => number, log?: (level: string, msg: string) => void }} deps
 *   `hooks`: the addresses and the bodies, kept (services/watch-hooks.js); `base`: where Filament reaches itself, which
 *   an address begins with; `tailnet`: this machine's name on the tailnet while Filament is served there, else null
 */
export function createWebhookWatch({ store, hooks, heard, base, tailnet = () => tailnetDoor()?.name ?? null, now = Date.now, log = () => {} }) {
  /** Each address's posts of the last minute, by its watcher's project and id: when each came. @type {Map<string, number[]>} */
  const minute = new Map();
  /** The hearings under way, for the tests to wait on. @type {Set<Promise<void>>} */
  const running = new Set();
  let stopped = false;

  /** @param {string} project @param {string} id */
  const keyOf = (project, id) => `${project}\n${id}`;
  /** A watcher as its Space keeps it; none where its Space does not read. @param {string} project @param {string} id */
  const routineOf = (project, id) => {
    try {
      return store.get(project).routines.find((x) => x.id === id);
    } catch {
      return undefined;
    }
  };
  /**
   * A watcher's trouble kept — with how many times it failed so, where that is counted —, or taken off (`why` null);
   * never thrown. @param {string} project @param {string} id @param {string | null} why @param {number} [fails]
   */
  const troubled = (project, id, why, fails = 1) => {
    try {
      store.watchTrouble(project, id, why, fails);
    } catch (/** @type {any} */ e) {
      log("warn", `watchers: the trouble of a watcher of ${project} could not be kept (${e?.message || e})`);
    }
  };

  /**
   * Each webhook watcher that is on has its address, made for the Switch on it stands at; an address whose watcher is
   * on no more is let go, its bodies with it; and each body no wake reads any more is deleted.
   */
  function sync() {
    if (stopped) return;
    /** @type {Map<string, { project: string, r: Routine, onAt: number, sign: boolean }>} */
    const on = new Map();
    for (const { project, r } of store.routinesAll()) if (r.trigger?.kind === "webhook" && r.state === "on" && r.onAt != null) on.set(keyOf(project, r.id), { project, r, onAt: r.onAt, sign: !!r.trigger.sign });
    for (const a of hooks.all()) {
      if (on.has(keyOf(a.project, a.id))) continue;
      try {
        hooks.drop(a.project, a.id);
      } catch (/** @type {any} */ e) {
        log("warn", `watchers: the address of a watcher of ${a.project} that is on no more could not be let go (${e?.message || e}); it opens nothing`);
      }
    }
    for (const k of minute.keys()) if (!on.has(k)) minute.delete(k);
    for (const { project, r, onAt, sign } of on.values()) {
      try {
        hooks.ensure(project, r.id, { onAt, sign });
      } catch (/** @type {any} */ e) {
        log("warn", `watchers: “${r.title}” of ${project} has no address: it could not be kept (${e?.message || e})`);
      }
      const waits = new Set((r.pending?.events || []).map((e) => e.ref));
      // The moment up to which its posts were taken by a wake that ended: its last wake's start, once it runs no
      // more; every moment for one that tells only the person, where nothing reads a body.
      const ended = r.wakes === "you" ? Infinity : r.last && r.last.state !== "running" ? r.last.at : -Infinity;
      const gone = hooks.posts(project, r.id).filter((p) => !waits.has(p.id) && p.at <= ended).map((p) => p.id);
      if (gone.length) hooks.dropPosts(project, r.id, gone);
    }
  }

  /**
   * A watcher whose address the person reads or renews, or the refusal that says why it has none.
   * @param {string} project @param {string} id @returns {{ onAt: number, sign: "github" | null }}
   */
  function addressed(project, id) {
    const r = routineOf(project, id);
    if (!r?.trigger) throw refused(404, `There is no watcher "${String(id).slice(0, 40)}" in this Space.`);
    if (r.trigger.kind !== "webhook") throw refused(409, `“${r.title}” takes no posts: only a watcher a program posts to has an address.`);
    if (r.state === "removed") throw refused(409, `“${r.title}” was removed: it has no address.`);
    if (r.state !== "on" || r.onAt == null) throw refused(409, `“${r.title}” has no address yet: one is made as you switch it on.`);
    return { onAt: r.onAt, sign: r.trigger.sign ?? null };
  }
  /**
   * @param {import("../../services/watch-hooks.js").WatchAddress} a @param {"github" | null} sign @param {string} secret
   * @returns {AddressRead}
   */
  const read = (a, sign, secret) => {
    const name = tailnet();
    return { url: `${base()}/watch/${a.token}`, ...(name ? { urlTailnet: `https://${name}/watch/${a.token}` } : {}), sign, ...(secret ? { secret } : {}) };
  };

  return {
    sync,
    /**
     * The watcher a token opens (the door's): one whose address it is, on, at the Switch on that address was made
     * for. Null for any other token, and for one whose watcher was changed, switched off or removed since.
     * @param {string} token @returns {{ project: string, id: string } | null}
     */
    at(token) {
      const found = hooks.find(token);
      if (!found) return null;
      const r = routineOf(found.project, found.id);
      return r?.trigger?.kind === "webhook" && r.state === "on" && r.onAt === found.address.onAt ? { project: found.project, id: found.id } : null;
    },
    /**
     * A post counted against its address's minute (the door's, before its body is read): 0 where it is taken, else
     * the seconds until the address takes another. @param {{ project: string, id: string }} found
     */
    wait({ project, id }) {
      const k = keyOf(project, id);
      const t = now();
      const came = (minute.get(k) || []).filter((x) => x > t - MINUTE_MS);
      minute.set(k, came);
      if (came.length >= WEBHOOK_LIMITS.perMinute) return Math.max(1, Math.ceil((came[0] + MINUTE_MS - t) / 1000));
      came.push(t);
      return 0;
    },
    /**
     * A post to a watcher's address, its body whole (the door's): its signature asked where the watcher takes signed
     * posts alone; dropped while the watcher is paused, Pause all is on or its project is archived; else its body kept and its event heard —
     * after this answers. → taken, or the refusal the door says.
     * @param {{ project: string, id: string }} found
     * @param {{ type: string, headers: Record<string, unknown>, body: Buffer }} post  `type`: its content type as sent;
     *   `headers`: as Node has them, in lowercase; `body`: its bytes as they came
     * @returns {{ ok: true } | { ok: false, status: number, error: string }}
     */
    post({ project, id }, { type, headers, body }) {
      if (stopped) return { ok: false, status: 503, error: "Filament is stopping: post again in a few seconds" };
      const r = routineOf(project, id);
      const a = hooks.of(project, id);
      if (r?.trigger?.kind !== "webhook" || r.state !== "on" || !a || r.onAt !== a.onAt) return { ok: false, status: 404, error: NO_ADDRESS };
      const listens = !r.paused && !store.pausedSince() && !store.archived?.(project);
      if (r.trigger.sign && !signedBy(a.secret, body, headers["x-hub-signature-256"])) {
        if (listens) troubled(project, id, POSTS_REFUSED, refusedPosts(r.seen?.trouble) + 1);
        return { ok: false, status: 401, error: UNSIGNED };
      }
      if (!listens) return { ok: true };
      const at = now();
      const post = hooks.newPost(at);
      const text = body.toString("utf8");
      let unkept = "";
      // Its headers as an app's hook keeps them, less its signature: a body with its signature is all a signed
      // address asks of a sender, and the agent that reads the body is not handed both.
      const kept = hookHeaders(Object.fromEntries(Object.entries(headers).filter(([k]) => !SIGNATURES.includes(k.toLowerCase()))));
      try {
        hooks.keepPost(project, id, post, { at, type: postType(type), headers: kept, body: text });
      } catch (/** @type {any} */ e) {
        // Why, and none of where: its trouble is read on the page, and on other machines' feeds.
        unkept = String(e?.message || e).split(",")[0];
        log("warn", `watchers: a post to “${r.title}” of ${project} is heard, and its body could not be kept (${unkept})`);
      }
      troubled(project, id, unkept ? postUnkept(unkept) : null);
      const event = watchEventOf({ kind: "webhook", at, post, type, head: text.slice(0, HEAD_RAW) }, r.trigger, () => "");
      const hearing = Promise.resolve()
        .then(() => heard(project, id, [event]))
        .then(
          () => {},
          (/** @type {any} */ e) => log("warn", `watchers: a post to “${r.title}” of ${project} could not be heard (${e?.message || e})`),
        )
        .finally(() => running.delete(hearing));
      running.add(hearing);
      return { ok: true };
    },
    /**
     * A watcher's address, for the person's sheet: made where it has none yet; its secret with it the first time, and
     * never after. Refused, in words, for a watcher that has none. @param {string} project @param {string} id
     * @returns {AddressRead}
     */
    addressOf(project, id) {
      const { onAt, sign } = addressed(project, id);
      const a = hooks.ensure(project, id, { onAt, sign: !!sign });
      const secret = a.secret !== undefined && !a.shown ? a.secret : "";
      if (secret) hooks.shown(project, id);
      return read(a, sign, secret);
    },
    /**
     * Make a new address, the person's press: the old one opens nothing from now; a new secret with it where it has
     * one, shown in this answer alone. @param {string} project @param {string} id @returns {AddressRead}
     */
    renew(project, id) {
      const { onAt, sign } = addressed(project, id);
      hooks.ensure(project, id, { onAt, sign: !!sign });
      const a = /** @type {import("../../services/watch-hooks.js").WatchAddress} */ (hooks.renew(project, id));
      if (a.secret !== undefined) hooks.shown(project, id);
      minute.delete(keyOf(project, id));
      return read(a, sign, a.secret ?? "");
    },
    /**
     * A webhook watcher's sheet, in core's words (`webhookSheet`): what its row says of its address — where it is made
     * and answers, how its posts are signed, its bounds —, the address itself being none of them. Null for a watcher
     * of any other kind. @param {Routine} r
     */
    sheetOf: (r) => (r.trigger?.kind === "webhook" ? webhookSheet(r.trigger) : null),
    /**
     * What a wake reads of a post past its event's line (the packet's), by the post's id as its event carries it:
     * its body and headers in parts, or that its body is not kept. @param {string} post @returns {string[]}
     */
    postOf(post) {
      const p = hooks.postOf(post);
      return p ? postParts(p) : [NOT_KEPT];
    },
    /** Every hearing under way, settled (the tests'). */
    settled: () => Promise.all([...running]),
    /** Nothing is heard and no address follows its watcher any more (the server's stop). */
    stop() {
      stopped = true;
      minute.clear();
    },
  };
}

/** @typedef {ReturnType<typeof createWebhookWatch>} WebhookWatch */

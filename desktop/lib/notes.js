// @ts-check
// What the desktop app says in the system's notifications (HarnessV3-Native NA-D9, NA3b): each of Filament's alerts
// once, by its id — only those raised since the app started, as older ones are on the card; several at once are one
// notification; memory's not (the card leaves memory to the harness); a failover once in 15 minutes, the rest
// counted —; the harness's chats that need you, stopped on an error, or finished a long turn, and what came to Your
// Space (lib/watch.js) — every machine's of the window, one note a tick (`tickNote`); and a Restart asked from the tray or the card: that it restarts, and that it is back. No
// question's words, no row's and no command in them: a notification shows on a screen others may see. The system shows
// Filament's name and logo over each, so a title never says "Filament:" again: one chat's note is titled with the chat,
// its words say what happened (the owner's of 10-28). Plain Node (NA-D13); main.js shows them.

/**
 * @typedef {{ id: string, at?: string, kind?: string, text?: string }} Alert  as `/api/alerts` lists them
 * @typedef {{ title: string, text: string, tone: "info" | "warning" }} Note
 */

/** The ids a running app remembers, the newest kept: Filament lists 100 alerts at the most. */
const SEEN_MAX = 1000;
/** The alerts not told: memory's are the harness's and the dashboard's. */
const UNTOLD = ["memory"];
/** A failover is told once in this long: each request a backup serves is an alert of its own. */
export const FAILOVER_QUIET_MS = 15 * 60_000;

/** @param {unknown} s @param {number} [n] */
const cut = (s, n = 240) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
/** @param {string} s */
const upper = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The notification the alerts call for: those not said yet (each id is said once; `seen` is filled), raised at
 * `since` or after, memory's left out; a failover only where none was told in the 15 minutes before `now`
 * (`quiet.failover` holds when one last was); none, one, or one for several.
 * @param {readonly Alert[] | null | undefined} list @param {Set<string>} seen @param {number} since
 * @param {{ failover?: number }} [quiet] @param {number} [now]
 * @returns {Note | null}
 */
export function alertNote(list, seen, since, quiet = {}, now = Date.now()) {
  /** @type {Alert[]} */
  const fresh = [];
  for (const a of list || []) {
    if (!a || typeof a.id !== "string" || seen.has(a.id)) continue;
    seen.add(a.id);
    const at = Date.parse(String(a.at || ""));
    if (Number.isFinite(at) && at < since) continue;
    if (UNTOLD.includes(String(a.kind))) continue;
    if (a.kind === "failover") {
      if (quiet.failover != null && now - quiet.failover < FAILOVER_QUIET_MS) continue;
      quiet.failover = now;
    }
    fresh.push(a);
  }
  for (const id of seen) {
    if (seen.size <= SEEN_MAX) break;
    seen.delete(id);
  }
  if (!fresh.length) return null;
  if (fresh.length === 1) return { title: upper(cut(fresh[0].kind || "alert", 40)), text: cut(fresh[0].text), tone: "warning" };
  return { title: `${fresh.length} alerts`, text: `${cut(fresh[0].text, 180)} — and ${fresh.length - 1} more on the card.`, tone: "warning" };
}

/** A Restart the person asked, accepted: what is in flight finishes first. @param {number} inFlight @returns {Note} */
export function restartingNote(inFlight) {
  const n = Math.max(0, Math.floor(Number(inFlight) || 0));
  return {
    title: "Restarting Filament",
    text: n ? `${n} request${n === 1 ? "" : "s"} in flight: Filament finishes ${n === 1 ? "it" : "them"} first, then starts again.` : "Nothing in flight: back in a few seconds.",
    tone: "info",
  };
}

/** That restart's end: Filament answers again. @param {string} version @param {number} port @returns {Note} */
export const backNote = (version, port) => ({ title: "Filament is back", text: `Filament${version ? ` ${version}` : ""} runs again on port ${port}.`, tone: "info" });

/**
 * A row of the harness's Now, as a notification may name it: the chat's title, its project; what it waits on in a few
 * words, never the question or the command; `machine`, the name of the machine it is on, where that is not this computer.
 * @typedef {{ title: string, project?: string, fact?: string, tone?: string, machine?: string, chain?: string, thread?: string | null }} ChatRow
 */

/** What a chat waits on, in a notification's words. @param {ChatRow} r */
const waitWords = (r) => {
  const f = String(r.fact || "");
  if (f.startsWith("its plan")) return "its plan waits for your yes";
  if (f.startsWith("waits for your yes")) return "waits for your yes";
  return "asks you something";
};
/** @param {ChatRow} r */
const named = (r) => `${cut(r.title, 80)}${r.project ? ` (${cut(r.project, 40)})` : ""}${r.machine ? ` on ${cut(r.machine, 40)}` : ""}`;

/** The chats that came to need you: one, or one for several. @param {readonly ChatRow[]} rows @returns {Note | null} */
export function needsNote(rows) {
  if (!rows.length) return null;
  if (rows.length === 1) return { title: named(rows[0]), text: `${upper(waitWords(rows[0]))}.`, tone: "warning" };
  return { title: `${rows.length} chats need you`, text: `${rows.slice(0, 3).map(named).join(", ")}${rows.length > 3 ? ` and ${rows.length - 3} more` : ""}.`, tone: "warning" };
}

/**
 * Turns that ended: on an error, or a long one done (each with how long it ran, `ms`); one, or one for several.
 * @param {readonly (ChatRow & { failed: boolean, ms: number })[]} ended @returns {Note | null}
 */
export function endedNote(ended) {
  if (!ended.length) return null;
  const failed = ended.filter((e) => e.failed);
  const mins = (/** @type {number} */ ms) => (ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)} h ${Math.round((ms % 3_600_000) / 60_000)} min` : `${Math.max(1, Math.round(ms / 60_000))} min`);
  if (ended.length === 1) {
    const e = ended[0];
    return e.failed
      ? { title: named(e), text: "Its turn stopped on an error.", tone: "warning" }
      : { title: named(e), text: `Done, after ${mins(e.ms)}.`, tone: "info" };
  }
  return {
    title: failed.length ? `${ended.length} chats ended, ${failed.length} on an error` : `${ended.length} chats done`,
    text: `${ended.slice(0, 3).map(named).join(", ")}${ended.length > 3 ? ` and ${ended.length - 3} more` : ""}.`,
    tone: failed.length ? "warning" : "info",
  };
}

/**
 * What came to Your Space (S5b, S5-D10): how many rows, by project — never a row's words, which may name a branch, a
 * person or a failure's text. "2 new need you — app 2, api 1"; a press opens Your Space.
 * @param {readonly { project: string, count: number }[]} news @returns {Note | null}
 */
export function spaceNote(news) {
  const n = news.reduce((t, x) => t + Math.max(0, Math.floor(Number(x.count) || 0)), 0);
  if (!n) return null;
  const by = news.slice(0, 3).map((x) => `${cut(x.project, 40)} ${x.count}`).join(", ");
  return { title: "Home", text:`${n} new need${n === 1 ? "s" : ""} you — ${by}${news.length > 3 ? ` and ${news.length - 3} more projects` : ""}.`, tone: "warning" };
}

/**
 * What one machine's look brought, for the tick's notification: `machine`, its id; `name`, what it is called where it is
 * not this computer (this computer's chats are named as they always were); the chats that came to need you, the turns
 * that ended to be told, and what came to its Your Space.
 * @typedef {{ machine: string, name?: string, needs: readonly ChatRow[], ended: readonly (ChatRow & { failed: boolean, ms: number })[], space: readonly { project: string, count: number }[] }} TickPart
 */

/** A count of chats: "1 chat needs you", "2 chats done". @param {number} n @param {string} one @param {string} many */
const chats = (n, one, many) => `${n} chat${n === 1 ? ` ${one}` : `s ${many}`}`;

/**
 * The one notification a tick of the watch gives, over every machine (the owner's remote Filament of 11-06, Part 3): the
 * machine showing in the harness window you are in (`showing`, null where you are in none) says its own there and is
 * left out; the rest — the chats that need you, the turns that ended, Your Space's new rows, on any machine — is one
 * note, each chat named with its machine where it is another's. `machine`: the one machine it is all of, null where it
 * is several's; `chat`: the one chat it names, else null; `home`: it is Your Space's alone.
 * @param {readonly TickPart[]} parts @param {string | null} showing
 * @returns {{ note: Note, machine: string | null, chat: ChatRow | null, home: boolean } | null}
 */
export function tickNote(parts, showing) {
  const told = parts.filter((p) => p.machine !== showing && (p.needs.length || p.ended.length || p.space.some((x) => Number(x.count) > 0)));
  const needs = told.flatMap((p) => p.needs.map((r) => (p.name ? { ...r, machine: p.name } : r)));
  const ended = told.flatMap((p) => p.ended.map((r) => (p.name ? { ...r, machine: p.name } : r)));
  const space = told.flatMap((p) => p.space.map((x) => (p.name ? { ...x, project: `${x.project} (${p.name})` } : x)));
  // Each kind's note, and whether its words are a sentence about one chat (else a list of chats' names).
  const kinds = /** @type {[Note | null, boolean][]} */ ([[needsNote(needs), needs.length === 1], [endedNote(ended), ended.length === 1], [spaceNote(space), true]]).filter(([x]) => x);
  const notes = kinds.map(([x]) => /** @type {Note} */ (x));
  if (!notes.length) return null;
  const machine = told.length === 1 ? told[0].machine : null;
  const named = [...needs, ...ended];
  const head = { note: notes[0], machine, chat: notes.length === 1 && named.length === 1 ? named[0] : null, home: notes.length === 1 && !named.length };
  if (notes.length === 1) return head;
  // Several kinds at once: one note, its title how many of each, its words each kind's own.
  const n = space.reduce((t, x) => t + Math.max(0, Math.floor(Number(x.count) || 0)), 0);
  const failed = ended.filter((e) => e.failed).length;
  const title = [
    needs.length ? chats(needs.length, "needs you", "need you") : "",
    !ended.length ? "" : !failed ? chats(ended.length, "done", "done") : failed === ended.length ? chats(ended.length, "stopped on an error", "stopped on an error") : `${chats(ended.length, "ended", "ended")}, ${failed} on an error`,
    n ? `${n} new in Home` : "",
  ].filter(Boolean).join(", ");
  const text = kinds.map(([x, one]) => `${x?.title}: ${one ? `${x?.text.charAt(0).toLowerCase()}${x?.text.slice(1)}` : x?.text}`).join(" ");
  return { ...head, note: { title, text: cut(text), tone: notes.some((x) => x.tone === "warning") ? "warning" : "info" } };
}

/**
 * A note as Windows shows it from the tray icon: Filament's logo in its large slot (`logo`, the app's image of it), as
 * other apps' notifications wear theirs — Windows' info or warning glyph only where the logo did not load.
 * @template {{ isEmpty: () => boolean }} L
 * @param {Note} note @param {L | null} logo
 * @returns {{ title: string, content: string, icon?: L, iconType: "custom" | "info" | "warning", largeIcon: boolean, respectQuietTime: boolean }}
 */
export function balloonOf(note, logo) {
  const own = logo && !logo.isEmpty() ? { icon: logo, iconType: /** @type {const} */ ("custom") } : { iconType: note.tone === "warning" ? /** @type {const} */ ("warning") : /** @type {const} */ ("info") };
  return { title: note.title, content: note.text, ...own, largeIcon: true, respectQuietTime: true };
}

/** The line server.log keeps of a notification, shown or not. @param {Note} note @param {boolean} shown */
export const noteLine = (note, shown) => `${shown ? "told" : "not shown (notifications are off)"}: ${note.title} — ${note.text}`;

/**
 * An update fetched and checked (lib/updates.js): Restart to update installs it — the harness's notice or the tray's
 * row — and so does a Quit, but a deb's, which asks for the password. @param {string} version @param {string} [kind] @returns {Note}
 */
export const updateNote = (version, kind = "") => ({ title: `Filament ${version} is ready`, text: kind === "deb" ? "Restart to update, from Filament's notice or the tray." : "Restart to update, from Filament's notice or the tray — or it installs as you quit.", tone: "info" });

/**
 * A newer Filament out (the owner's of 11-07: nothing is fetched until the person asks): its notice in the harness, and
 * the tray, fetch it — or a store's build opens its store. @param {string} version @param {string} kind @returns {Note}
 */
export const updateOutNote = (version, kind) => ({
  title: `Filament ${version} is out`,
  text:
    kind === "mac-store" ? "Update it from the App Store: Filament's notice opens it." : kind === "windows-store" ? "Update it from the Microsoft Store: Filament's notice opens it." : kind === "page" ? "Filament's notice opens its release page." : "Update from Filament's notice or the tray: it downloads, then asks before it installs.",
  tone: "info",
});

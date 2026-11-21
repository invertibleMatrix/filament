// @ts-check
// An agent's artifact as the harness shows it (HarnessV4_Artifacts_Plan E18, step 2): its mark by its icon word, its
// address — at the port this page is served on, or where /api/state says this page reads its artifacts (the owner's
// remote Filament of 11-06, Part 4) —, the frame it opens in and what that frame is named, its tab in the
// side pane, and the words around it; what the Artifacts page shows and in which order (step 4). Pure but for that
// place, which the page sets once it has read it: the card
// (conversation/artifact.js), the frame (artifact-frame.js), the pane (panes/artifact.js), the full view
// (artifact-view.js) and the Artifacts page (artifacts-page.js) own the DOM.

/** The name every artifact's address sits under. */
export const ART_DOMAIN = "art.localhost";
/** An artifact's name: one DNS label of lower-case letters, digits and hyphens. */
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** Whether a string is an artifact's name. @param {unknown} s */
export const isArtifactName = (s) => typeof s === "string" && NAME.test(s);

/**
 * The harness's mark for each icon word an artifact may take (the server's ARTIFACT_ICONS, word for word): one plain
 * mark for what it is. A word it does not know is the page's mark.
 * @type {Readonly<Record<string, string>>}
 */
export const ICON_MARKS = Object.freeze({
  page: "appWindow", doc: "fileText", slides: "presentation", chart: "chartColumn", dashboard: "layoutDashboard",
  design: "palette", table: "table", list: "listTodo", check: "circleCheck", calendar: "calendar", clock: "clock3",
  calculator: "calculator", money: "circleDollar", map: "map", code: "code", book: "bookOpen", note: "notepadText",
  mail: "mail", chat: "messageSquare", game: "gamepad", music: "music", photo: "image", tool: "wrench",
  settings: "settings", star: "star", heart: "heart", home: "house", person: "user", team: "users", folder: "folder",
  search: "search", bug: "bug", rocket: "rocket", globe: "globe", cart: "shoppingCart", recipe: "cookingPot",
  flag: "flag", bolt: "zap",
});
/** An icon word's mark. @param {unknown} word */
export const markOf = (word) => ICON_MARKS[String(word || "")] || ICON_MARKS.page;

/** The types an artifact can be, as a person reads them. @type {Readonly<Record<string, string>>} */
const TYPE_WORDS = Object.freeze({ page: "Page", doc: "Doc", slides: "Slides", dashboard: "Dashboard", design: "Design", app: "App" });
/** A type in words. @param {unknown} type */
export const typeWord = (type) => TYPE_WORDS[String(type || "")] || "Page";

/** What stands for an artifact's name in the addresses the server gives (the server's NAME_SLOT). */
export const NAME_SLOT = "{name}";
/**
 * @typedef {{ page: string, still: string }} ArtifactsAt  where this page reads its artifacts, as /api/state says it
 *   (the server's `artifactsAt`): an artifact's address and its still preview's, each with `NAME_SLOT` for its name
 */
/**
 * Where this page reads its artifacts (the owner's remote Filament of 11-06, Part 4): as the server said (`useArtifactsAt`)
 * — its own address on this machine, or the network's artifacts address for a page another machine opened —; null where
 * it said it serves this page none; undefined while it has said nothing, when each is at this machine's own address on
 * the page's port.
 * @type {ArtifactsAt | null | undefined}
 */
let place;
/**
 * Read every artifact's address from where the server says this page reads them (/api/state's `artifacts`): an
 * address it does not give in its shape is none; a Filament that says nothing leaves each at this machine's own.
 * @param {unknown} at
 */
export function useArtifactsAt(at) {
  const o = /** @type {any} */ (at);
  const fits = (/** @type {unknown} */ s) => typeof s === "string" && s.includes(NAME_SLOT) && /^https?:\/\//.test(s);
  place = at === undefined ? undefined : o && fits(o.page) && fits(o.still) ? { page: o.page, still: o.still } : null;
}
/** Where an artifact is at a port of this machine's own: `<name>.art.localhost`, http's own port left out. @param {string | number} port @returns {ArtifactsAt} */
const ownAt = (port) => {
  const p = String(port) === "80" ? "" : `:${port}`;
  return { page: `http://${NAME_SLOT}.${ART_DOMAIN}${p}/`, still: `http://${NAME_SLOT}.still.${ART_DOMAIN}${p}/` };
};
/** Where artifacts are: as the server said, else at the port this page is served on. @param {string | number} port */
const atPort = (port) => place || ownAt(port);

/**
 * An artifact's address at a port — the port this page is served on, which its own address shares (AFC-50) —, or where
 * the server said this page reads its artifacts; "" where it said this page reads them nowhere: no link of this
 * machine's own then, which another machine's browser cannot reach (the hunt of p4-artifacts).
 * @param {string} name @param {string | number} port
 */
export const artifactAddress = (name, port) => (place === null ? "" : atPort(port).page.replace(NAME_SLOT, name));
/**
 * An artifact's origin: what its frame's messages come from — as the browser writes it, without its scheme's own port.
 * @param {string} name @param {string | number} port
 */
export const artifactOrigin = (name, port) => new URL(artifactAddress(name, port)).origin;
/**
 * An old version's address (the server's `/_filament/v/<n>/`): its page's own paths reach its own files.
 * @param {string} name @param {string | number} port @param {number} v
 */
export const versionAddress = (name, port, v) => (place === null ? "" : `${artifactAddress(name, port)}_filament/v/${v}/`);
/**
 * An artifact's still origin (`<name>.still.art.localhost`), which the previews frame: an origin of its own, so the
 * server holds every request of the page in it to reading — on the network's artifacts address, the artifacts' one
 * origin, under its still path. @param {string} name @param {string | number} port
 */
export const stillOrigin = (name, port) => new URL(atPort(port).still.replace(NAME_SLOT, name)).origin;
/**
 * The origin an artifact's frame speaks from, as its messages say it: on the network's artifacts address each page is
 * an origin of none (its answer's sandbox), "null" — the frame they come from says whose they are —; else its
 * address's. @param {string} origin  its address's (`artifactOrigin`, `stillOrigin`)
 */
export const spokenOrigin = (origin) => (place?.page.startsWith("https://") ? "null" : origin);
/** Where a word to an artifact's frame goes: to its page wherever its origin is none, else to its origin alone. @param {string} origin  `spokenOrigin`'s */
export const sentTo = (origin) => (origin === "null" ? "*" : origin);
/** A version's address at its still preview's. @param {string} name @param {string | number} port @param {number} v */
export const stillAddress = (name, port, v) => `${atPort(port).still.replace(NAME_SLOT, name)}_filament/v/${v}/`;
/**
 * The port this page is served on, which an artifact's address shares (AFC-50): the location's own, else its scheme's.
 * @param {{ port: string, protocol: string }} loc
 */
export const portOf = (loc) => loc.port || (loc.protocol === "https:" ? "443" : "80");

/** Why a page another machine opened shows no artifact: its Filament serves them on the network to none. */
export const NO_NETWORK_WORDS =
  "An artifact opens here once the machine Filament runs on serves its artifacts on the network: there, turn on Settings › Remote access › Reach this machine on my network. Until then, open it on that machine.";

/**
 * Whether this page can hold an artifact in a frame (AFC-67): where the server said its artifacts are on the network's
 * artifacts address, there; where it said they are none of this page's, never; else it must be served from this machine
 * by a name a page's policy may give — `127.0.0.1`, `localhost` or a name under it. Else what to say in its place.
 * @param {string} hostname  the page's own
 * @param {string | number} port
 * @returns {{ ok: true } | { ok: false, why: string }}
 */
export function frameableAt(hostname, port) {
  if (place === null) return { ok: false, why: NO_NETWORK_WORDS };
  if (place?.page.startsWith("https://")) return { ok: true };
  const h = String(hostname || "").toLowerCase();
  if (h.startsWith("[") || h.includes(":"))
    return { ok: false, why: `An artifact cannot be shown inside Filament opened at an IPv6 address. Open Filament at http://127.0.0.1:${port}/ to see it here, or open it in your browser.` };
  if (h === "localhost" || h.endsWith(".localhost") || /^127(?:\.\d{1,3}){3}$/.test(h)) return { ok: true };
  return { ok: false, why: "An artifact opens only on the machine Filament runs on. Open it there, in Filament or in a browser." };
}

/** What the harness names an artifact's frame (the server's LOOK_MARK), so its page draws in the harness's look. */
export const LOOK_MARK = "filament-look";
/**
 * A frame's name for a theme and a Motion setting (AF-D33), and whether it is a card's still preview (AFC-113).
 * @param {"light" | "dark"} theme @param {string} motion @param {boolean} [still]
 */
export const lookName = (theme, motion, still = false) => `${LOOK_MARK}:${theme}:${motion === "reduced" || motion === "off" ? motion : "full"}${still ? ":still" : ""}`;

/** The types whose page is Filament's own, drawn from the agent's content (the server's TYPED): each may fill the screen. */
export const TYPED = Object.freeze(["doc", "slides", "dashboard", "design"]);
/** Whether an artifact's page is Filament's own. @param {unknown} type */
export const isTyped = (type) => TYPED.includes(String(type));
/** The types whose content is Markdown (the server's EDITABLE): the developer edits their text (AFC-115, AFC-144). */
export const EDITABLE = Object.freeze(["doc", "slides"]);
/** Whether an artifact's text is the developer's to edit. @param {unknown} type */
export const isEditable = (type) => EDITABLE.includes(String(type));

/**
 * What an artifact's frame may do (AF-D2, AF-D39): run its scripts on its own origin, which is never the harness's —
 * the fence makes it so — submit its forms, download what it makes, open a link in a new tab as a page of its own, and
 * ask with the browser's own dialogs. It may write to the clipboard on a click.
 */
export const FRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox allow-modals";
export const FRAME_ALLOW = "clipboard-write";
/**
 * …and an app's in its Space (the Space Apps plan of 10-29), a game's among them: also lock the pointer and fill the
 * screen, each on the person's own click or key in it — Esc gives either back —, and read a gamepad.
 */
export const APP_FRAME_SANDBOX = `${FRAME_SANDBOX} allow-pointer-lock`;
export const APP_FRAME_ALLOW = `${FRAME_ALLOW}; fullscreen; gamepad`;

/** The side pane's tab for an artifact. @param {string} name */
export const artifactTabId = (name) => `artifact:${name}`;
/** An artifact tab's name, or null for any other tab. @param {string} id */
export function parseArtifactTabId(id) {
  const name = String(id || "").startsWith("artifact:") ? String(id).slice(9) : "";
  return isArtifactName(name) ? name : null;
}

/**
 * A title from an artifact's name, for a tab restored before its record is read: its words, its four letters gone,
 * the first word capitalised (`expense-tracker-k3f9` → `Expense tracker`).
 * @param {string} name
 */
export function titleOfName(name) {
  const words = String(name || "").replace(/-[a-z0-9]{4}$/, "").split("-").filter(Boolean).join(" ");
  return words ? words[0].toUpperCase() + words.slice(1) : String(name || "");
}

/**
 * A version's words on its card (AFC-26, AFC-65): "v2", and how many there are once there are more.
 * @param {number} v @param {number} count  the artifact's versions now, 0 while unknown
 */
export const versionWords = (v, count) => (count > v ? `v${v} · ${count} versions` : `v${v}`);

/**
 * @typedef {{ v: number, at: number, model: string, chain: string | null, helper?: string | null,
 *   from?: number | null, visual?: string, edited?: number, files?: number, bytes?: number }} VersionSeen  a version,
 *   as the admin API gives it; `visual`: the developer kept that visual of the chat as it (AFC-101); `edited`: the
 *   developer edited that version's text into it (AFC-115)
 * @typedef {{ title: string, gone: boolean }} ChatSeen  a chat that made a version: its title, or that it was deleted
 * @typedef {{ name: string, count: number } | { name: string, error: string }} DataSeen  a collection its page keeps,
 *   with its count, or that it could not be read
 * @typedef {{ feed: string, words: string }} ReadSeen  one of Filament's own numbers a Dashboard reads (AF-D12)
 * @typedef {{ name: string, title: string, description: string, icon: string, type: string, createdAt: number,
 *   updatedAt: number, pinned: boolean, viewedAt: number, folder: string, model: string, address: string,
 *   versions: VersionSeen[], chats?: Record<string, ChatSeen>, data?: DataSeen[], reads?: ReadSeen[] }} ArtifactSeen
 *   an artifact, as the admin API gives it
 */

/** What its page keeps, on the full view's line (AFC-97): "keeps data: 2 collections"; "" where it keeps none. @param {DataSeen[] | undefined} data */
export const keepsWords = (data) => (data?.length ? `keeps data: ${data.length} collection${data.length === 1 ? "" : "s"}` : "");

/**
 * Filament's own numbers a Dashboard reads, on the full view's line and in Info (AFC-128): "Filament's usage by day and
 * calls now"; "" where it reads none.
 * @param {ReadSeen[] | undefined} reads
 */
export function readsWords(reads) {
  const w = (reads || []).map((r) => r.words);
  return w.length ? `Filament's ${w.length < 2 ? w[0] : `${w.slice(0, -1).join(", ")} and ${w.at(-1)}`}` : "";
}

/** Each collection its page keeps with its count, for Info (AFC-97). @param {DataSeen[] | undefined} data */
export const dataWords = (data) =>
  data?.length
    ? data.map((c) => ("count" in c ? `${c.name} (${c.count.toLocaleString("en-US")} record${c.count === 1 ? "" : "s"})` : `${c.name} (it could not be read)`)).join(", ")
    : "none kept";

/**
 * Where a version was made, in words: the chat by its title, a chat the archive no longer has (AFC-15), or the
 * developer, who made an old version the newest again (AFC-79), kept a visual of a chat as it (AFC-101) or edited its
 * text (AFC-115). "" where nothing is known.
 * @param {VersionSeen} v @param {Record<string, ChatSeen> | undefined} chats
 */
export function madeWhere(v, chats) {
  if (v.from) return `v${v.from} made the newest again by you`;
  if (v.edited) return "edited by you";
  if (!v.chain) return "";
  const made = v.visual ? "kept from a visual" : "made";
  const c = chats?.[v.chain];
  if (c?.gone) return `${made} in a deleted session`;
  return c?.title ? `${made} in “${c.title}”` : `${made} in a chat`;
}

/**
 * The line a full view's header gives (AF-D36): its newest version, when, where it was made, and by which model.
 * @param {{ versions: VersionSeen[], chats?: Record<string, ChatSeen> }} a
 * @param {(ms: number) => string} day  a moment as a short date
 */
export function madeLine(a, day) {
  const newest = a.versions.at(-1);
  if (!newest) return "";
  return [`v${newest.v}`, day(newest.at), madeWhere(newest, a.chats), newest.model ? `(${newest.model})` : ""].filter(Boolean).join(" · ").replace(/ · \(/, " (");
}

/**
 * Who made a version, and in which chat (AFC-28, AFC-79): the Versions menu's second line.
 * @param {VersionSeen} v @param {Record<string, ChatSeen> | undefined} chats
 */
export function versionBy(v, chats) {
  if (v.from) return `by you, from v${v.from}`;
  if (v.edited) return `by you, edited from v${v.edited}`;
  if (v.visual) return ["by you", madeWhere(v, chats)].join(" · ");
  return [[v.model, v.helper ? "a helper" : ""].filter(Boolean).join(", "), madeWhere(v, chats)].filter(Boolean).join(" · ");
}

/**
 * One version on one line, for the old version's band and Info: its number, when, and who made it where.
 * @param {VersionSeen} v @param {Record<string, ChatSeen> | undefined} chats @param {(ms: number) => string} day
 */
export function versionLine(v, chats, day) {
  return [`v${v.v}`, day(v.at), versionBy(v, chats)].filter(Boolean).join(" · ");
}

/**
 * The chat a change is asked in (AF-D16, AFC-84): the one that made the newest version, else the one that made the
 * version before, and so on — a chat the archive no longer has is passed over. Null where none is left.
 * @param {{ versions: VersionSeen[], chats?: Record<string, ChatSeen> }} a
 */
export function askingChat(a) {
  for (const v of [...a.versions].reverse()) if (v.chain && !a.chats?.[v.chain]?.gone) return v.chain;
  return null;
}

/** The words Ask for a change writes into the chat's message box. @param {string} title @param {string} ask */
export const askWords = (title, ask) => `Change ${title}: ${ask.trim()}`;

/** A project's folder by its last name (`H:\work\filament` → `filament`). @param {string} folder */
export const projectOf = (folder) => String(folder || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";

/**
 * When an artifact was last opened or changed, whichever is later: what the list orders it by (AFC-14).
 * @param {ArtifactSeen} a
 */
export const lastTouched = (a) => Math.max(a.viewedAt || 0, a.updatedAt || 0);

/**
 * A row's time (AFC-14): "Viewed" or "Updated", whichever is later.
 * @param {ArtifactSeen} a @param {(ms: number) => string} day
 */
export const touchedWords = (a, day) => (a.viewedAt && a.viewedAt >= a.updatedAt ? `Viewed ${day(a.viewedAt)}` : `Updated ${day(a.updatedAt)}`);

/** A size as a person reads it (AFC-49). @param {number} bytes */
export function sizeWords(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * @typedef {{ tab: "all" | "pinned", query: string, type: string, project: string, model: string }} ListAsk
 *   what the list shows: All or Pinned, the words searched for, and the filter ("" where any)
 */

/**
 * The artifacts the list shows (AF-D9, AFC-11): those of the tab, whose title or description holds the words, of the
 * type, project and model chosen — the last opened or changed first.
 * @param {ArtifactSeen[]} all @param {ListAsk} ask
 */
export function shownArtifacts(all, ask) {
  const q = ask.query.trim().toLowerCase();
  return all
    .filter((a) => (ask.tab !== "pinned" || a.pinned) && (!q || `${a.title}\n${a.description}`.toLowerCase().includes(q)))
    .filter((a) => (!ask.type || a.type === ask.type) && (!ask.project || projectOf(a.folder) === ask.project) && (!ask.model || a.model === ask.model))
    .sort((x, y) => lastTouched(y) - lastTouched(x) || x.name.localeCompare(y.name));
}

/**
 * The list by month, the newest first (AF-D9): each month's artifacts under its name — with its year where it is
 * not this one.
 * @param {ArtifactSeen[]} shown  already in order @param {number} now
 * @param {(ms: number, withYear: boolean) => string} monthName
 * @returns {{ key: string, label: string, items: ArtifactSeen[] }[]}
 */
export function byMonth(shown, now, monthName) {
  const year = new Date(now).getFullYear();
  /** @type {{ key: string, label: string, items: ArtifactSeen[] }[]} */
  const out = [];
  for (const a of shown) {
    const d = new Date(lastTouched(a));
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (out.at(-1)?.key !== key) out.push({ key, label: monthName(d.getTime(), d.getFullYear() !== year), items: [] });
    /** @type {any} */ (out.at(-1)).items.push(a);
  }
  return out;
}

/**
 * What the filter offers (AF-D9): the types, projects and models the artifacts have — the types in their own order,
 * the rest by name.
 * @param {ArtifactSeen[]} all
 */
export function filterChoices(all) {
  const distinct = (/** @type {string[]} */ xs) => [...new Set(xs.filter(Boolean))].sort((x, y) => x.localeCompare(y));
  return {
    types: Object.keys(TYPE_WORDS).filter((t) => all.some((a) => a.type === t)),
    projects: distinct(all.map((a) => projectOf(a.folder))),
    models: distinct(all.map((a) => a.model)),
  };
}

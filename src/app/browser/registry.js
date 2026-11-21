// @ts-check
// Each chat's browser (HarnessV4_Browser_Plan BR1): its tabs in the app (8 at the most, BR-D12), the sites the developer
// let its agents act on (BR-D6), whether the developer has taken it over (BR-D10), and what each agent does in it now
// — and the `browser` tool's calls run through it. Every agent of the chat drives it, each in tabs of its own (its
// seat, HarnessV4_AgentTools_Plan AT-D2): the chat's own agent, and each sub-agent by its id, a tab of its own opened at
// its first call and named for it in the pane. An agent's calls work on its own shown tab, and its `tabs` lists, shows
// and closes its own; the tab the pane shows is the developer's (AT-D3), so showing another agent's tab there moves no
// agent's work. Take over holds every agent of the chat, and the developer's yes to a site holds for all of them
// (AT-D4); a team's lead's yes to one of its workers holds for that team's workers alone — an AI's yes is no yes for
// the chat's other agents, the lead itself among them (the bug hunt of 10-30, LOOP-2). At eight tabs a
// new one closes the tab used longest ago of another sub-agent that is not working and is not shown, said to it (AT-D5).
// A tab nobody used for half an hour closes while its chat's agents rest, said to its agent (`TAB_IDLE_MS`). A call is
// the driver's commands (driver.js) and comes back as the words the model reads: what the page did meanwhile first (a
// dialog, a tab it opened, the developer's take-over ended), then what the call did, then — after a navigation or an
// act — the page's new snapshot, so the next step needs no call of its own (BR-D4); a screenshot comes as a
// picture beside its words. A batch runs its steps in order, each said in a line, and stops at the first that fails,
// that would act on a site the gate did not clear, or once the developer takes the browser over. A step that lands on a
// page the session's rules refuse the browser (a click, Back, a key) is not read: its page is left, back where it came
// from. The tabs live in a host (host.js): a chat's new page opens on the app of whoever drives the chat — the caller
// of its newest turn (`drive`) — while it is linked, else on this machine's app, else in Chrome on this machine, and its
// sub-agents' with it. A tab stays on the host it opened on, and every op on it goes there: a host that goes takes its
// own tabs alone, and each agent whose pages went has them opened again at its next call — every one, at its address,
// size and id — on the host chosen then, and is told where the browser moved (b-handoff). An app that links in has
// Chrome's tabs of the chats it drives closed, so their pages open in it next. A page's
// popup is a tab of the agent whose tab opened it, loaded only once the chat keeps it: one past the chat's tabs never
// reaches its site. Each tab has its own size (HarnessV4_BrowserSize_Plan BS1), a laptop's screen until one is set:
// the app holds its page at it whoever watches, a popup takes its opener's, and a tab opened again after the app went
// gets the size it had. A page with no app of its own to put the page over its pane — another machine's harness, a
// browser's tab (the owner's remote Filament of 11-06, Part 4) — watches the chat's browser live (`watch`): the tab the
// pane shows is cast by the app while one watches, its frames handed to each, a frame older than one handed on dropped;
// and while the person has taken the browser over, their clicks and keys there reach the page as Chrome's input (`input`).
import { randomUUID } from "node:crypto";
import { MediaResult, imageBlock } from "../../core/media.js";
import { PAGE_SIZE, TABS_MAX, actionOf, acts, browserArgWords, inputProblem, pageSize, siteOf, sizeWanted, sizeWords, wholeUrl } from "../../core/browser.js";
import { HEADLESS, HERE, NO_HOST } from "./host.js";
import { createDriver } from "./driver.js";

/** The words a call gets while the developer holds the browser. @param {number} at @param {() => number} now */
const takenWords = (at, now) =>
  `The developer has taken over the browser (for ${Math.max(1, Math.round((now() - at) / 60_000))} min) and works in it now. Do something else meanwhile, or ask them with ask; they give it back from the Browser pane.`;
/**
 * The words a call gets while the developer has the page by hand (HarnessV4_BrowserSize_Plan BS3, BS-D13): it comes
 * back by itself in a few seconds, so the agent waits — a browser wait of its own still runs — and looks again.
 */
export const HAND_WORDS =
  "The developer is using the page by hand now; it comes back to you 5 s after their mouse leaves it. Wait a few seconds (browser wait with ms), then take a snapshot before acting: the page may have moved.";

/** The chat's own agent's seat: the developer's acts from the pane open their tabs there too. */
const MAIN = "";
/** The words a seat keeps for its agent's next call, the newest: one whose agent calls no more holds no more. */
const NOTES_KEPT = 20;
/** How long a click or a key of the person's is waited on in the app: one the page does not take is let go. */
const INPUT_MS = 10_000;
/** What a person's input is refused with while the browser is not theirs. */
export const NOT_TAKEN_WORDS = "Take the browser over first: the agent has it.";
/** Why each host's tabs went, as its agents are told. */
const LOST_WHY = Object.freeze({
  [HERE]: "the desktop app quit, or connected again",
  [HEADLESS]: "Chrome on this machine quit",
  device: "the app of the device that drove this chat quit, or lost Filament",
});
/** Why Chrome closed a chat's tabs: the app of whoever drives it linked in. */
const TAKEN_WHY = "the app of whoever drives this chat connected, and holds its pages now";
/** What an agent of the chat with no page of its own that went is told, as its host's tabs go. @param {string} why */
const lostWords = (why) => `The browser started again (${why}): its tabs went.`;
/**
 * A tab nobody has used for this long closes, while its chat's agents rest. The app parks each page in a hidden window
 * that keeps it drawing and running its timers, so an agent's page works on while no one watches it — and a page with
 * an animation, a video or a timer left open there ran at full rate for as long as Filament did. Used: an agent's
 * command on it, the person's act on it, a pane that shows it — and nothing closes while the person holds the browser,
 * which their clicks and keys need. The profile stays, so its sign-ins do; what
 * the page itself held goes, and its agent opens it again if it needs it.
 */
export const TAB_IDLE_MS = 30 * 60_000;
/** How often the tabs are looked over for one unused that long: a minute late is nothing against half an hour. */
export const IDLE_SWEEP_MS = 60_000;
/** What an agent is told at its next call of its tab that closed unused. @param {string} id @param {string} url */
const idleWords = (id, url) =>
  `Tab ${id} (${url.slice(0, 200)}) closed after ${Math.round(TAB_IDLE_MS / 60_000)} minutes unused, and what its page held went with it; sign-ins and cookies stay. Open it again if you still need it.`;
/** A host as an agent is told where its pages are. @param {string} at */
const hostWords = (at) => (at === HERE ? "this machine's desktop app" : at === HEADLESS ? "Chrome on this machine" : "the desktop app of the device that drives this chat");
/**
 * What an agent is told as its pages that went open again on the host `at`: for the pages of each host they went
 * from, where the browser is now, which tabs came back at which addresses, and what stayed behind — in the browser
 * they left, or, for Chrome here started again, nowhere: it starts on an emptied profile.
 * @param {Away[]} back @param {string} at
 */
const movedWords = (back, at) => {
  /** @type {Map<string, Away[]>} */
  const from = new Map();
  for (const p of back) from.set(`${p.from}\n${p.why}`, [...(from.get(`${p.from}\n${p.why}`) || []), p]);
  return [...from.values()]
    .map((ps) => {
      const same = ps[0].from === at;
      const head = same ? `The browser started again in ${hostWords(at)} (${ps[0].why})` : `The browser moved to ${hostWords(at)} (${ps[0].why})`;
      const tabs = ps.map((p) => `${p.id} (${p.url.slice(0, 200)})`).join(", ");
      const left = !same
        ? "Sign-ins, cookies and anything typed into a page stayed in the browser it left"
        : at === HEADLESS
          ? "Sign-ins, cookies and anything typed into a page went with it, as Chrome here starts on an emptied profile"
          : "Anything typed into a page went with it";
      return `${head}: ${ps.length === 1 ? `tab ${tabs} opened again there at its address` : `tabs ${tabs} opened again there at their addresses`}, with the same ids. ${left}: take a snapshot before acting.`;
    })
    .join("\n");
};

const MOUSE_TYPES = new Set(["mousePressed", "mouseReleased", "mouseMoved", "mouseWheel"]);
const MOUSE_BUTTONS = new Set(["none", "left", "middle", "right", "back", "forward"]);
const KEY_TYPES = new Set(["keyDown", "keyUp", "rawKeyDown", "char"]);
/** A number from a page, kept inside its bounds. @param {unknown} v @param {number} lo @param {number} hi */
const within = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));

/**
 * The person's input from a pane outside the app, as Chrome's protocol takes it — a mouse's press, release, move or
 * wheel at the page's own point, a key, or text put in (a paste) — each field kept to what it may be; null for
 * anything else.
 * @param {any} ev  `{ kind: "mouse" | "key" | "text", … }`
 * @returns {{ method: "Input.dispatchMouseEvent" | "Input.dispatchKeyEvent" | "Input.insertText", params: Record<string, unknown> } | null}
 */
export function inputCommand(ev) {
  const modifiers = Math.trunc(within(ev?.modifiers, 0, 15));
  if (ev?.kind === "mouse") {
    const type = String(ev.type || "");
    if (!MOUSE_TYPES.has(type)) return null;
    const button = MOUSE_BUTTONS.has(String(ev.button)) ? String(ev.button) : "none";
    const params = { type, x: within(ev.x, 0, 4096), y: within(ev.y, 0, 4096), modifiers, button, buttons: Math.trunc(within(ev.buttons, 0, 31)), clickCount: Math.trunc(within(ev.clickCount, 0, 3)) };
    return { method: "Input.dispatchMouseEvent", params: type === "mouseWheel" ? { ...params, deltaX: within(ev.deltaX, -10_000, 10_000), deltaY: within(ev.deltaY, -10_000, 10_000) } : params };
  }
  if (ev?.kind === "key") {
    const type = String(ev.type || "");
    if (!KEY_TYPES.has(type)) return null;
    const text = type === "keyDown" || type === "char" ? String(ev.text ?? "").slice(0, 4) : "";
    return {
      method: "Input.dispatchKeyEvent",
      params: { type, key: String(ev.key ?? "").slice(0, 32), code: String(ev.code ?? "").slice(0, 32), windowsVirtualKeyCode: Math.trunc(within(ev.windowsVirtualKeyCode, 0, 255)), modifiers, ...(text ? { text, unmodifiedText: text } : {}) },
    };
  }
  if (ev?.kind === "text") {
    const text = String(ev.text ?? "").slice(0, 10_000);
    return text ? { method: "Input.insertText", params: { text } } : null;
  }
  return null;
}

/**
 * @typedef {{ width: number, height: number }} Size  a page's own, in CSS pixels
 * @typedef {{ id: string, host: string, driver: ReturnType<typeof createDriver>, url: string, title: string, open: boolean, seat: string, used: number, drove: number, size: Size, fit: boolean }} Tab
 *   `host`: the key of the host that holds it (host.js); `used`: when it was last used — an agent's command on it, the
 *   person's act on it, a pane that shows it —, which the room for a new tab (AT-D5) and the close of one
 *   unused (`TAB_IDLE_MS`) both read; `drove`: when an agent's call last worked on it, for the pane's
 *   veil (BS3) — 0 for one none has, as a tab the developer opened from the pane; `size`: the page's own; `fit`: it
 *   takes the pane's size instead (Fit the pane, BS-D5)
 * @typedef {{ id: string, url: string, size: Size, fit: boolean, shown: boolean, why: string, from: string }} Away
 *   a page of an agent's that went with its host, as its next call opens it again: its tab's id, address and size,
 *   whether it was the agent's shown tab, why it went, and the key of the host it went from
 * @typedef {{ key: string, name: string, active: string | null, away: Away[], reopening: Promise<void> | null, notes: string[], busy: { words: string, at: number } | null, on: string | null, look: ((page: string) => boolean) | null }} Seat
 *   an agent's place in the chat's browser: its shown tab, its pages that went with their host and the opening of them
 *   again under way, what is to be said to it at its next call, what it does now, and — while a call of its runs —
 *   the tab it works on (`on`, once it reached one) and whether the session's rules let the browser read a page
 * @typedef {{ chain: string, tabs: Tab[], seats: Map<string, Seat>, view: string | null, taken: { at: number, hand: boolean } | null, takes: number, sites: Set<string>, teams: Map<string, { name: string, sites: Set<string> }>, droveAt: number, last: Said | null, watchers: Set<Watcher>, cast: Cast, pressed: Pressed | null }} ChatBrowser
 *   `view`: the tab the pane shows, where the developer or an agent's `tabs select` chose one; `taken`: the developer
 *   holds it — by hand, from the page's own Take over (BS3), or from the pane's bar; `takes`: how many times the
 *   developer took it over, so a batch knows of a take-over given back within one of its steps; `sites`: those the
 *   developer said yes to; `teams`: those a team's lead said yes to, by the team's key, for its workers; `droveAt`:
 *   when an agent's call last ran, on any tab (each tab's own `drove` is the pane's veil's); `last`: what the newest
 *   call did, and whose it was;
 *   `watchers`: the pages that watch it live, and `cast` what the app casts them; `pressed`: a button the person
 *   pressed from a page that watches it and has not let go
 * @typedef {{ tab: string, host: string, x: number, y: number, button: string, clicks: number, by: unknown }} Pressed
 *   where the button went down and last moved, on which tab and its host, and from which watcher: let go at the page
 *   however the hand ends
 * @typedef {{ tab: string, seq: number, data: string, width: number, height: number, way: string }} Frame  a cast's
 *   frame: the page as the app paints it, a JPEG in base64; `width` and `height` the page's own size, the space a
 *   point on the picture is in; `way` how the app took it (Chrome's screencast, or the frames a parked page paints)
 * @typedef {{ on: boolean, tab: string | null, why?: string }} CastState  whether the app casts the tab the pane shows
 *   now — off with no tab, no app, or an app that casts nothing, said why
 * @typedef {{ frame: (f: Frame) => void, state: (s: CastState) => void }} Watcher  a page that watches a chat's browser
 * @typedef {{ tab: string | null, host: string | null, on: boolean, why: string, frame: Frame | null }} Cast  the tab
 *   its host is asked to cast, and that host, whether it took it, and the newest frame — a page that comes to watch sees
 *   the page at once
 * @typedef {(site: string, page: string) => boolean} MayAct  whether a step may act on a site — on the page it acts
 *   on, which the rules read — as the gate and the rules would judge it now
 * @typedef {{ id: string, name: string }} SeatOf  a sub-agent's seat: its id, and the name the pane gives its tabs
 * @typedef {{ key: string, name: string }} TeamOf  a team's workers, whose lead's yes holds for them: its key, and the
 *   name the pane says it by
 * @typedef {{ words: string, by?: string }} Said  a call's words, and the sub-agent's name where it was one's
 * @typedef {{ busy: { words: string, at: number, by?: string } | null, droveAt: number | null, taken: boolean, available: boolean, last: Said | null }} Use
 *   what a chat's agents do with its browser now, as `stateOf` says it: the call at work, when one last ran, whether
 *   the developer holds it, whether the app is there to show it, and what the newest call did
 */

/**
 * @param {{ host: ReturnType<typeof import("./host.js").createBrowserHost>, now?: () => number, log?: (level: string, line: string) => void,
 *   looks?: (chain: string, page: string) => boolean, own?: (url: string) => boolean, moved?: (chain: string, use: Use) => void,
 *   working?: (chain: string) => boolean }} o
 *   `looks`: whether a chat's rules let the browser read a page, from its settings — what judges a page that comes with
 *   no call of an agent at work, as a popup may; `own`: whether an address is Filament's own (core/browser.js
 *   `filamentsOwn`), which neither an agent nor the developer opens here; `moved`: told as a chat's agents' use of its
 *   browser moves — a call begins, goes on to its batch's next step or ends, the developer takes it over or gives it
 *   back —, for the line over the chat's box (the owner's of 11-02); `working`: whether a chat's agents work now — a
 *   turn holds it, or a sub-agent of its runs —, which keeps its tabs open however long unused (`TAB_IDLE_MS`)
 */
export function createBrowsers({ host, now = Date.now, log = () => {}, looks = () => true, own = () => false, moved = () => {}, working = () => false }) {
  /** @type {Map<string, ChatBrowser>} */
  const chats = new Map();
  /** A tab's chat. @type {Map<string, string>} */
  const tabChat = new Map();
  /** The app each chat a device drives is driven from, by its host's key: a chat not in it is driven from this machine. @type {Map<string, string>} */
  const drivers = new Map();
  /** The key of the app of whoever drives a chat. @param {string} chain */
  const driverOf = (chain) => drivers.get(chain) || HERE;
  /**
   * Whether a chat's browser is there now: a host its new page opens on, or one that holds a tab of its.
   * @param {string} chain
   */
  const there = (chain) => !!host.choose(driverOf(chain)) || !!chats.get(chain)?.tabs.some((t) => t.open && host.linked(t.host));

  /** @param {string} chain @returns {ChatBrowser} */
  const chatOf = (chain) => {
    let b = chats.get(chain);
    if (!b) {
      b = { chain, tabs: [], seats: new Map(), view: null, taken: null, takes: 0, sites: new Set(), teams: new Map(), droveAt: 0, last: null, watchers: new Set(), cast: { tab: null, host: null, on: false, why: "", frame: null }, pressed: null };
      chats.set(chain, b);
    }
    return b;
  };
  /** An agent's seat in the chat's browser, made at its first call. @param {ChatBrowser} b @param {SeatOf | null} [who] @returns {Seat} */
  const seatOf = (b, who = null) => {
    const key = who ? String(who.id) : MAIN;
    let s = b.seats.get(key);
    if (!s) {
      s = { key, name: who ? String(who.name || who.id) : "", active: null, away: [], reopening: null, notes: [], busy: null, on: null, look: null };
      b.seats.set(key, s);
    }
    return s;
  };
  /** @param {ChatBrowser} b @param {string | null | undefined} id */
  const openTab = (b, id) => (id ? b.tabs.find((t) => t.id === id && t.open) || null : null);
  /** An agent's shown tab. @param {ChatBrowser} b @param {Seat} s */
  const activeTab = (b, s) => openTab(b, s.active);
  /** An agent's own tabs. @param {ChatBrowser} b @param {Seat} s */
  const tabsOf = (b, s) => b.tabs.filter((t) => t.open && t.seat === s.key);
  /**
   * The tab an agent's call works on now: driven from this moment, the pane's veil on it (BS3). A tab the developer
   * opened is never one of these until an agent's call works on it. @param {Seat} s @param {Tab} t
   */
  const works = (s, t) => {
    t.drove = now();
    s.on = t.id;
  };
  /** Whether an agent's call works on a tab now. @param {ChatBrowser} b @param {Tab} t */
  const workedOn = (b, t) => [...b.seats.values()].some((s) => !!s.busy && s.on === t.id);
  /**
   * The tab the pane shows: the one chosen there, else the chat's own agent's, else the newest — never a closed one.
   * @param {ChatBrowser} b
   */
  const shownOf = (b) => openTab(b, b.view) || openTab(b, b.seats.get(MAIN)?.active) || b.tabs.filter((t) => t.open).at(-1) || null;
  /**
   * Whether the session's rules let the browser read a page, for a seat: as its call at work judges it, else by the
   * chat's own rules.
   * @param {ChatBrowser} b @param {Seat} s @returns {(page: string) => boolean}
   */
  const lookOf = (b, s) => s.look || ((page) => looks(b.chain, page));
  /**
   * A site's yes taken back from the chat: the developer's, and every team's lead's — a team left with none goes.
   * @param {ChatBrowser} b @param {string} site
   */
  const forget = (b, site) => {
    b.sites.delete(site);
    for (const [key, t] of b.teams) if (t.sites.delete(site) && !t.sites.size) b.teams.delete(key);
  };
  /** Words kept for a seat's agent's next call, the newest of them. @param {Seat} s @param {string} words */
  const note = (s, words) => {
    s.notes.push(words);
    if (s.notes.length > NOTES_KEPT) s.notes.splice(0, s.notes.length - NOTES_KEPT);
  };
  /**
   * Words for every agent of the chat at its next call: the developer's acts, the app's going. A sub-agent's seat with
   * nothing in the browser now — no tab, no page to open again, no call at work — goes instead: its next call makes it
   * again, and nothing it was told would be about anything of its (the E27 hunt of 10-23).
   * @param {ChatBrowser} b @param {string} words
   */
  const tellAll = (b, words) => {
    seatOf(b);
    for (const [key, s] of b.seats) {
      if (key !== MAIN && !s.busy && !s.away.length && !tabsOf(b, s).length) b.seats.delete(key);
      else note(s, words);
    }
  };
  /** Words for the agent whose tab it is. @param {ChatBrowser} b @param {Tab | null | undefined} t @param {string} words */
  const tellOwner = (b, t, words) => {
    if (t) note(b.seats.get(t.seat) || seatOf(b), words);
  };
  /** A tab gone from the chat: its agent's shown tab falls back to its newest other. @param {ChatBrowser} b @param {Tab} t */
  const drop = (b, t) => {
    t.open = false;
    b.tabs = b.tabs.filter((x) => x !== t);
    tabChat.delete(t.id);
    const s = b.seats.get(t.seat);
    if (s && s.active === t.id) s.active = tabsOf(b, s).at(-1)?.id ?? null;
    if (b.view === t.id) b.view = null;
    recast(b);
  };

  /** A chat's cast as its watchers hear it. @param {ChatBrowser} b @returns {CastState} */
  const castState = (b) => ({ on: b.cast.on, tab: b.cast.tab, ...(b.cast.why ? { why: b.cast.why } : {}) });
  /** A chat's watchers — or those named — told where its cast stands. @param {ChatBrowser} b @param {Iterable<Watcher>} [to] */
  const sayCast = (b, to = b.watchers) => {
    const s = castState(b);
    for (const w of [...to]) {
      try {
        w.state(s);
      } catch {}
    }
  };
  /**
   * The tab the pane shows is cast by its host while a page watches the chat's browser — that tab alone: one the pane
   * shows no more is stopped, and none is cast with nobody watching or no host. The watchers hear each move, and the
   * host's answer. → whether they were told anything.
   * @param {ChatBrowser} b
   */
  const recast = (b) => {
    const shown = b.watchers.size ? shownOf(b) : null;
    const at = shown && host.linked(shown.host) ? shown.host : null;
    const want = at ? /** @type {Tab} */ (shown).id : null;
    const c = b.cast;
    const why = !want && b.watchers.size && !there(b.chain) ? NO_HOST : "";
    if (c.tab === want && (want || c.why === why)) return false;
    const was = c.tab;
    const wasAt = c.host;
    c.tab = want;
    c.host = at;
    c.on = false;
    c.why = why;
    c.frame = null;
    if (was && was !== want && wasAt) void host.call("cast", { tab: was, on: false }, { host: wasAt }).catch(() => {});
    // The tab a button is held on is cast no more: the page lets it go, the person's release going elsewhere now.
    if (b.pressed && b.pressed.tab !== want) letGo(b);
    sayCast(b);
    if (!want) return true;
    host.call("cast", { tab: want, on: true }, { host: at }).then(
      () => {
        if (c.tab !== want || c.on) return;
        c.on = true;
        sayCast(b);
      },
      (e) => {
        if (c.tab !== want) return;
        // An app older than the cast says it is nothing it does: the pane reads the page's picture instead. Any other
        // refusal — a tab the app opens a moment later, an answer that timed out — is asked again at the next read
        // (`recast` from `stateOf`), never left off until the tab shown moves (the review of p4-browser).
        c.why = String(/** @type {any} */ (e)?.message || e);
        if (!/is nothing the app's browser does/.test(c.why)) {
          c.tab = null;
          c.host = null;
        }
        sayCast(b);
      },
    );
    return true;
  };

  /**
   * A button the person holds on a page let go there, where it last was: they gave the browser back, the cast went off
   * or to another tab, or the page they pressed it from went, with its release (the hunt of p4-browser: the page held
   * the button — a drag, a selection, a slider that never ended — and no release could reach it once the hand had gone).
   * @param {ChatBrowser} b
   */
  const letGo = (b) => {
    const p = b.pressed;
    b.pressed = null;
    if (!p || !host.linked(p.host)) return;
    const params = { type: "mouseReleased", x: p.x, y: p.y, modifiers: 0, button: p.button, buttons: 0, clickCount: p.clicks };
    void host.call("cdp", { tab: p.tab, method: "Input.dispatchMouseEvent", params }, { ms: INPUT_MS, host: p.host }).catch(() => {});
  };

  /**
   * A tab of an agent's, its page on the host `at`, which every command of its goes to.
   * @param {ChatBrowser} b @param {Seat} s @param {string} at @param {string} [id] @param {Size} [size]
   */
  const newTab = (b, s, at, id = `t-${randomUUID().slice(0, 8)}`, size = PAGE_SIZE) => {
    /** @type {Tab} */
    const t = {
      id,
      host: at,
      url: "about:blank",
      title: "",
      open: true,
      seat: s.key,
      used: now(),
      drove: 0,
      size: pageSize(size.width, size.height),
      fit: false,
      driver: createDriver({ cdp: (method, params = {}) => host.call("cdp", { tab: id, method, params }, { host: at }), capture: (size) => host.call("capture", { tab: id, ...size }, { host: at }), now }),
    };
    b.tabs.push(t);
    tabChat.set(id, b.chain);
    return t;
  };

  /**
   * Room for one more tab of an agent's (AT-D5): under eight there is; at eight, the tab used longest ago of another
   * sub-agent that is not working now and is not shown goes, said to that agent — never the chat's own agent's. Taken
   * from the chat at once, before the app is asked to close it, so two agents opening tabs together never both take
   * the same room (the E27 hunt of 10-23). → the tab for the app to close, or null.
   * @param {ChatBrowser} b @param {Seat} s @returns {Tab | null}
   */
  function roomFor(b, s) {
    if (b.tabs.filter((t) => t.open).length < TABS_MAX) return null;
    const shown = shownOf(b);
    const spare = b.tabs
      .filter((t) => t.open && t.seat !== MAIN && t.seat !== s.key && t !== shown && !b.seats.get(t.seat)?.busy)
      .sort((x, y) => x.used - y.used)[0];
    if (!spare) throw new Error(`this chat's browser has ${TABS_MAX} tabs, the most it may: close one of yours (tabs close), or ask the developer to close one in the Browser pane`);
    drop(b, spare);
    tellOwner(b, spare, `Tab ${spare.id} (${spare.driver.url.slice(0, 200)}) was closed to make room for another agent's: this chat's browser holds ${TABS_MAX}.`);
    return spare;
  }

  /**
   * A new tab of an agent's, opened at its size on the host the chat's new page goes to now (host.js `choose`) and
   * taking its commands; its shown tab. `id`: a page's that went with its host, opened again under it.
   * @param {ChatBrowser} b @param {Seat} s @param {AbortSignal | null} signal @param {(Size & { fit?: boolean }) | null} [size]
   * @param {string} [id]
   */
  async function opened(b, s, signal, size = null, id = undefined) {
    const at = host.choose(driverOf(b.chain));
    if (!at) throw new Error(NO_HOST);
    const spare = roomFor(b, s);
    // The room is this tab's from now: it counts among the chat's before its host has opened it.
    const t = newTab(b, s, at, id, size || PAGE_SIZE);
    try {
      if (spare) await host.call("close", { tab: spare.id }, { host: spare.host }).catch(() => {});
      await host.call("open", { tab: t.id, ...t.size }, { signal, host: at });
      if (size?.fit) await sized(t, { fit: true });
      await t.driver.enable();
    } catch (e) {
      b.tabs = b.tabs.filter((x) => x !== t);
      tabChat.delete(t.id);
      // A new tab whose host went as it opened was never a page of the agent's: nothing of it is opened again.
      if (id === undefined) s.away = s.away.filter((x) => x.id !== t.id);
      throw e;
    }
    s.active = t.id;
    recast(b);
    return t;
  }

  /**
   * A tab's size set in the app — its own, or the pane's (`fit`) — and kept here as the app answers it holds it.
   * @param {Tab} t @param {{ width?: number, height?: number, fit?: boolean }} want @param {AbortSignal | null} [signal]
   */
  async function sized(t, want, signal = null) {
    const ask = want.fit ? { fit: true } : pageSize(want.width, want.height);
    const r = await host.call("size", { tab: t.id, ...ask }, { signal, host: t.host });
    t.fit = r && typeof r === "object" ? r.fit === true : want.fit === true;
    if (!t.fit) t.size = r && typeof r === "object" && Number(r.width) ? pageSize(r.width, r.height) : pageSize(want.width, want.height);
    return t;
  }

  /**
   * A chat's tabs gone from their host `from` — it went, or Chrome closed them for the app of whoever drives the chat.
   * Each agent's pages that went are kept for its next call, which opens them again at their addresses, sizes (BS case
   * 24) and ids on the host chosen then, and tells it where the browser moved (`back`); where every tab of the chat
   * went, the agents with no page of their own among them are told now.
   * @param {ChatBrowser} b @param {Tab[]} gone @param {string} why @param {string} from
   */
  const lose = (b, gone, why, from) => {
    const all = gone.length === b.tabs.length;
    for (const t of gone) {
      t.open = false;
      tabChat.delete(t.id);
    }
    b.tabs = b.tabs.filter((t) => t.open);
    for (const t of gone) {
      const s = b.seats.get(t.seat) || seatOf(b);
      const shown = s.active === t.id;
      if (shown) for (const p of s.away) p.shown = false;
      // Its address as the page has it, or — a page opened again whose load has not come — the one it was opening at.
      const url = t.driver.url && t.driver.url !== "about:blank" ? t.driver.url : t.url || "about:blank";
      s.away.push({ id: t.id, url, size: { ...t.size }, fit: t.fit, shown, why, from });
      if (shown) s.active = tabsOf(b, s).at(-1)?.id ?? null;
    }
    if (b.view && !openTab(b, b.view)) b.view = null;
    if (!all) return;
    const words = lostWords(why);
    seatOf(b);
    for (const [key, s] of b.seats) {
      if (s.away.length) continue;
      if (key !== MAIN && !s.busy && !tabsOf(b, s).length) b.seats.delete(key);
      else note(s, words);
    }
  };

  /**
   * An agent's pages that went with their host, opened again — one opening at a time for each agent: a call that comes
   * while one runs waits for it, and opens no page of its own beside them.
   * @param {ChatBrowser} b @param {Seat} s @param {AbortSignal | null} signal
   */
  function back(b, s, signal) {
    if (!s.reopening && s.away.length)
      s.reopening = reopen(b, s, signal).finally(() => {
        s.reopening = null;
      });
    return s.reopening || Promise.resolve();
  }

  /**
   * An agent's pages that went with their host, opened again on the host chosen now — each at its address, size and
   * id, the one it showed shown again, and its load waited for; the others load as the call goes on — and said to it.
   * One whose host goes as it opens, or a stop, leaves it for the next call, at its address still; one that does not
   * open for another reason is said, and the rest open still.
   * @param {ChatBrowser} b @param {Seat} s @param {AbortSignal | null} signal
   */
  async function reopen(b, s, signal) {
    const at = host.choose(driverOf(b.chain));
    // With no host for a new page they wait: a call on a tab of another host's goes on.
    if (!at) return;
    const away = s.away.splice(0);
    const was = s.active;
    // A page the session's rules keep the browser from reading now opens blank: nothing of it is loaded.
    const look = lookOf(b, s);
    /** @type {Away[]} */
    const opens = [];
    /** @type {string[]} */
    const said = [];
    for (let i = 0; i < away.length; i++) {
      const p = away[i];
      if (signal?.aborted) {
        // A stop leaves the rest for the call after it.
        s.away.push(...away.slice(i));
        break;
      }
      /** @type {Tab} */
      let t;
      try {
        t = await opened(b, s, signal, { ...p.size, fit: p.fit }, p.id);
      } catch (e) {
        // Its host went as it opened (`lose` kept it, blank), or the call was stopped: it waits, at its address.
        const waits = !!signal?.aborted || s.away.some((x) => x.id === p.id);
        s.away = s.away.filter((x) => x.id !== p.id);
        if (waits) s.away.push(p);
        else said.push(`Tab ${p.id} (${p.url.slice(0, 200)}) did not open again (${/** @type {any} */ (e)?.message || e}): navigate there if you still need it.`);
        continue;
      }
      // The agent's shown tab stays the one it had until the one it showed is back.
      if (!p.shown && openTab(b, was)) s.active = was;
      const loads = p.url !== "about:blank" && look(p.url);
      if (loads) t.url = p.url;
      else if (p.url !== "about:blank") said.push(`Tab ${p.id} opened again blank: this session's rules keep the browser from reading the page it was on.`);
      const going = loads ? t.driver.navigate(p.url, p.shown ? signal : null).catch(() => "") : null;
      if (p.shown) await going;
      // Gone again as it loaded: `lose` kept it, at its address, for the call after.
      if (!t.open) continue;
      opens.push(loads ? p : { ...p, url: "about:blank" });
    }
    const shown = opens.find((p) => p.shown);
    s.active = [shown?.id, was, s.active, ...opens.map((p) => p.id).reverse()].find((id) => !!openTab(b, id)) ?? null;
    recast(b);
    if (opens.length) note(s, movedWords(opens, at));
    for (const w of said) note(s, w);
  }

  host.on((e) => {
    const at = String(e.host || "");
    if (e.op === "lost") {
      // A host went (or its app connected again): its pages went with it, and no other host's.
      const why = at === HERE || at === HEADLESS ? LOST_WHY[at] : LOST_WHY.device;
      for (const b of chats.values()) {
        const gone = b.tabs.filter((t) => t.host === at);
        if (gone.length) lose(b, gone, why, at);
      }
      for (const b of chats.values()) if (b.droveAt) tell(b);
      // Its casts went with it: the pages that watch hear so.
      for (const b of chats.values()) recast(b);
      return;
    }
    // A host's word is of its own tabs alone: one that names another host's tab, by its id, reaches nothing. A popup
    // is a tab the host just made: its chat is the one of the tab that opened it, and so is its agent. One whose opener
    // is gone already has no chat to be kept in, nor one whose id a tab of Filament's has: it goes too, never left open
    // unseen there.
    const ref = String((e.op === "popup" ? e.from : e.tab) || "");
    const chain = tabChat.get(ref);
    const own = chain ? chats.get(chain)?.tabs.find((x) => x.id === ref && x.host === at) : null;
    if (!chain || !own || (e.op === "popup" && tabChat.has(String(e.tab || "")))) {
      if (e.op === "popup" && e.tab && !tabChat.has(String(e.tab))) void host.call("close", { tab: String(e.tab) }, { host: at }).catch(() => {});
      return;
    }
    const b = chatOf(chain);
    if (e.op === "frame") {
      const c = b.cast;
      const seq = Number(e.seq) || 0;
      // A frame of a tab cast no more, or older than one handed on already, is dropped: the page shows as it is now.
      if (c.tab !== e.tab || (c.frame && seq <= c.frame.seq)) return;
      c.frame = { tab: String(e.tab), seq, data: String(e.data || ""), width: Number(e.width) || 0, height: Number(e.height) || 0, way: String(e.way || "") };
      // A frame may come before the app's answer to the cast: it is on all the same.
      if (!c.on) {
        c.on = true;
        c.why = "";
        sayCast(b);
      }
      for (const w of [...b.watchers]) {
        try {
          w.frame(c.frame);
        } catch {}
      }
      return;
    }
    if (e.op === "event") {
      const t = own;
      t.driver.feed(String(e.method), e.params);
      if (e.method === "Page.frameNavigated" && !e.params?.frame?.parentId) t.url = String(e.params?.frame?.url || t.url);
      return;
    }
    if (e.op === "popup") {
      const from = String(e.from || "");
      const opener = own;
      const s = b.seats.get(opener.seat) || seatOf(b);
      if (b.tabs.length >= TABS_MAX) {
        void host.call("close", { tab: String(e.tab) }, { host: at }).catch(() => {});
        note(s, `The page opened a window (${String(e.url || "").slice(0, 200)}), not kept: this chat has ${TABS_MAX} tabs, the most it may.`);
        return;
      }
      const to = String(e.url || "about:blank");
      // One to a page the session's rules keep the browser from reading is never loaded: it goes (the copies hunt of
      // 10-23) — judged as its agent's call judges a page, or by the chat's rules with no call at work.
      if (to !== "about:blank" && !lookOf(b, s)(to)) {
        void host.call("close", { tab: String(e.tab) }, { host: at }).catch(() => {});
        note(s, `The page ${from ? `in ${from} ` : ""}opened a window to a page this session's rules keep the browser from reading: it was closed, and nothing of it was read.`);
        return;
      }
      // At its opener's size, as its host opened it, and on that host.
      const t = newTab(b, s, at, String(e.tab), Number(e.width) ? pageSize(e.width, e.height) : opener.size || PAGE_SIZE);
      t.url = to;
      // The host opened it blank: its address is loaded here, now that the chat keeps it.
      void t.driver
        .enable()
        .then(() => (to !== "about:blank" ? t.driver.navigate(to, null) : ""))
        .catch((err) => log("warn", `browser: a tab the page opened did not take its commands (${err?.message || err})`));
      note(s, `The page ${from ? `in ${from} ` : ""}opened a new tab, ${t.id} (${t.url.slice(0, 200)}); it is not shown — tabs select shows it.`);
      recast(b);
      return;
    }
    // What the app refused a page — a download, an address that is no web page's — said at its agent's next call.
    if (e.op === "note") {
      tellOwner(b, own, String(e.words || "").slice(0, 400));
      return;
    }
    if (e.op === "gone") {
      const t = own;
      drop(b, t);
      tellOwner(b, t, `Tab ${t.id} closed${e.why ? ` (${e.why})` : ""}.`);
    }
  });
  // An app that links in has Chrome close the tabs of the chats it drives — this machine's app, those no device drives —,
  // and each of their agents opens its page again in that app at its next call. Chrome keeps every other chat's tabs.
  host.onLink((at) => {
    for (const b of chats.values()) {
      if (driverOf(b.chain) !== at) continue;
      const gone = b.tabs.filter((t) => t.host === HEADLESS);
      if (!gone.length) continue;
      for (const t of gone) void host.call("close", { tab: t.id }, { host: HEADLESS }).catch(() => {});
      lose(b, gone, TAKEN_WHY, HEADLESS);
      if (b.droveAt) tell(b);
      recast(b);
    }
  });

  /**
   * An agent's shown tab: its pages that went with their host opened again first, and a new one where it has none.
   * @param {ChatBrowser} b @param {Seat} s @param {AbortSignal | null} signal
   */
  async function ensure(b, s, signal) {
    await back(b, s, signal);
    return activeTab(b, s) || opened(b, s, signal);
  }

  /**
   * One step on an agent's shown tab: its words, and a picture for a screenshot.
   * @param {ChatBrowser} b @param {Seat} s @param {any} step @param {AbortSignal | null} signal
   * @returns {Promise<{ words: string, media?: any[], snapshot: boolean }>}
   */
  async function step(b, s, step, signal) {
    const a = actionOf(step);
    if (a === "tabs") return tabsStep(b, s, step, signal, true);
    const t = await ensure(b, s, signal);
    t.used = now();
    works(s, t);
    const d = t.driver;
    const said = (/** @type {string} */ w, /** @type {string} */ more = "") => [w, more].filter(Boolean).join(" ");
    switch (a) {
      case "navigate": {
        const to = wholeUrl(step.url);
        return { words: said(`Opened ${to}.`, await d.navigate(to, signal)), snapshot: true };
      }
      case "back":
        return { words: said("Went back.", await d.back(signal)), snapshot: true };
      case "forward":
        return { words: said("Went forward.", await d.forward(signal)), snapshot: true };
      case "reload":
        return { words: said("Reloaded the page.", await d.reload(signal)), snapshot: true };
      case "snapshot":
        return { words: "", snapshot: true };
      case "click":
        return { words: said(`Clicked ${step.ref}.`, await d.click(String(step.ref), { double: step.double === true, button: step.button === "right" ? "right" : "left" }, signal)), snapshot: true };
      case "hover":
        await d.hover(String(step.ref));
        return { words: `Hovered over ${step.ref}.`, snapshot: true };
      case "type": {
        const more = await d.type(step.ref ? String(step.ref) : null, String(step.text ?? ""), { clear: step.clear === true, submit: step.submit === true }, signal);
        return { words: said(`Typed ${String(step.text ?? "").length} character${String(step.text ?? "").length === 1 ? "" : "s"}${step.ref ? ` into ${step.ref}` : ""}${step.submit ? ", then Enter" : ""}.`, more), snapshot: true };
      }
      case "press":
        return { words: said(`Pressed ${step.key}.`, await d.press(String(step.key), signal)), snapshot: true };
      case "select":
        return { words: `In ${step.ref}, ${await d.select(String(step.ref), String(step.value))}.`, snapshot: true };
      case "scroll":
        await d.scroll({ ref: step.ref ? String(step.ref) : undefined, direction: String(step.direction || "down"), amount: Number(step.amount) || 0 });
        return { words: step.ref ? `Scrolled ${step.ref} into sight.` : `Scrolled ${step.direction || "down"}.`, snapshot: false };
      case "screenshot": {
        const shot = await d.screenshot();
        await d.where();
        // A page bigger than a picture a model reads best is shrunk in it: its line says the page's own size (case 23).
        const shrunk = shot.page && (shot.page.width !== shot.width || shot.page.height !== shot.height);
        return { words: `A screenshot of ${d.url} (${shrunk ? `the page ${shot.page.width}×${shot.page.height}, the picture ${shot.width}×${shot.height}` : `${shot.width}×${shot.height}`}).`, media: [imageBlock(shot.mediaType, shot.data)], snapshot: false };
      }
      case "resize": {
        const want = sizeWanted(step);
        if (!want.ok) throw new Error(want.error);
        await sized(t, want, signal);
        return { words: `The page is ${sizeWords(t.size)} now${want.name ? ` (${want.name})` : ""}: it lays itself out at that size whoever watches.`, snapshot: true };
      }
      case "text":
        return { words: await d.text(), snapshot: false };
      case "console":
        return { words: d.consoleLines({ errors: step.errors === true, clear: step.clear === true }), snapshot: false };
      case "network":
        return { words: d.networkLines({ failed: step.failed === true }), snapshot: false };
      case "evaluate":
        return { words: `The page answered: ${await d.evaluate(String(step.expression))}`, snapshot: false };
      case "wait":
        return { words: `${await d.wait({ text: step.text ? String(step.text) : "", gone: step.gone === true, ms: Number(step.ms) || 0 }, signal)}.`, snapshot: false };
      default:
        throw new Error(`${a} is no action of the browser's`);
    }
  }

  /**
   * An agent's tabs: listed, opened, shown and closed — its own alone (AT-D2). The chat's own agent's new or chosen tab
   * is the one the pane shows; a sub-agent's chosen tab is shown too, and its new one only where the pane shows none.
   * `agent`: an agent's call, whose new or chosen tab it works on — not the developer's new tab from the pane.
   * @param {ChatBrowser} b @param {Seat} s @param {any} o @param {AbortSignal | null} signal @param {boolean} [agent]
   * @returns {Promise<{ words: string, snapshot: boolean }>}
   */
  async function tabsStep(b, s, o, signal, agent = false) {
    const op = String(o.op || "list");
    const mine = tabsOf(b, s);
    const where = s.key === MAIN ? "in this chat" : "of yours";
    if (op === "new") {
      if (s.key === MAIN && b.tabs.filter((t) => t.open).length >= TABS_MAX && !b.tabs.some((t) => t.open && t.seat !== MAIN)) throw new Error(`this chat has ${TABS_MAX} tabs, the most it may: close one first`);
      const shownBefore = shownOf(b);
      const t = await opened(b, s, signal);
      if (agent) works(s, t);
      if (s.key === MAIN || !shownBefore) b.view = t.id;
      recast(b);
      const loaded = o.url ? await t.driver.navigate(wholeUrl(o.url), signal) : "";
      return { words: [`Opened tab ${t.id}${o.url ? ` at ${wholeUrl(o.url)}` : ""}; ${s.key === MAIN ? "it is the one shown" : "your calls work on it"}.`, loaded].filter(Boolean).join(" "), snapshot: true };
    }
    if (op === "select") {
      const t = mine.find((x) => x.id === o.tab);
      if (!t) throw new Error(`no tab ${o.tab} ${where}: tabs list names them`);
      s.active = t.id;
      if (agent) works(s, t);
      b.view = t.id;
      recast(b);
      return { words: `Tab ${t.id} is the one shown.`, snapshot: true };
    }
    if (op === "close") {
      const t = b.tabs.find((x) => x.id === o.tab && x.seat === s.key);
      if (!t) throw new Error(`no tab ${o.tab} ${where}: tabs list names them`);
      await host.call("close", { tab: t.id }, { signal, host: t.host }).catch(() => {});
      drop(b, t);
      return { words: `Closed tab ${t.id}.${s.active ? ` Tab ${s.active} is ${s.key === MAIN ? "the one shown" : "the one your calls work on"}.` : " No tab is left: the next call opens one."}`, snapshot: false };
    }
    for (const t of mine) await t.driver.where().catch(() => null);
    const others = b.tabs.filter((t) => t.open && t.seat !== s.key).length;
    const head = s.key === MAIN ? `This chat's tabs (${mine.length} of ${TABS_MAX})` : `Your tabs in this chat's browser (${mine.length}; the chat holds ${TABS_MAX})`;
    const mark = (/** @type {Tab} */ t) => (s.key === MAIN ? (t.id === s.active ? " (shown)" : "") : t.id === s.active ? " (yours now)" : "");
    // A tab on a page the session's rules keep the browser from reading lists neither its title nor its address.
    const look = lookOf(b, s);
    const line = (/** @type {Tab} */ t) => (look(t.driver.url) ? `${t.driver.title || "(no title)"} — ${t.driver.url}` : "(a page this session's rules keep the browser from reading)");
    return {
      words: mine.length
        ? `${head}:\n${mine.map((t) => `${t.id}${mark(t)} ${line(t)}`).join("\n")}${others ? `\n(${others} more ${others === 1 ? "is" : "are"} other agents' of this chat: theirs to work on.)` : ""}`
        : "No tabs yet: the next call opens one.",
      snapshot: false,
    };
  }

  /**
   * Where a step left an agent's tab, where the session's rules refuse it (the bug round of 10-23): a click, Back or a
   * key may land on a site a deny rule names, and the call that landed there reads nothing of it — it goes back, and
   * says so. Empty where the page is one the rules let it read.
   * @param {ChatBrowser} b @param {Seat} s @param {string} from  the page before the step @param {(page: string) => boolean} mayLook
   * @param {AbortSignal | null} signal
   */
  async function refusedLanding(b, s, from, mayLook, signal) {
    const t = activeTab(b, s);
    if (!t) return "";
    await t.driver.where().catch(() => null);
    const at = t.driver.url;
    if (!at || at === from || mayLook(at)) return "";
    await t.driver.back(signal).catch(() => "");
    await t.driver.where().catch(() => null);
    const now_ = t.driver.url;
    const left = !!now_ && now_ !== at && mayLook(now_);
    return `The page went to ${at.slice(0, 200)}, where this session's rules refuse the browser: nothing of it was read, ${left ? `and Filament went back to ${now_.slice(0, 200)}` : "and it stays there — the developer may move it from the Browser pane"}.`;
  }

  /**
   * One call of the `browser` tool for an agent of a chat: its words, or its words and a picture.
   * @param {string} chain @param {any} input
   * @param {{ signal?: AbortSignal | null, mayAct?: MayAct, mayLook?: (page: string) => boolean, seat?: SeatOf | null }} [o]
   *   `mayAct`: a batch's later steps judged as the gate would; `mayLook`: whether the session's rules let the browser
   *   read a page; `seat`: a sub-agent's — its own tabs — or null for the chat's own agent (AT-D2)
   * @returns {Promise<string | MediaResult>}
   */
  async function call(chain, input, { signal = null, mayAct = () => true, mayLook = () => true, seat = null } = {}) {
    const problem = inputProblem(input, { own });
    if (problem) throw new Error(problem);
    if (!there(String(chain))) throw new Error(NO_HOST);
    const b = chatOf(String(chain));
    // In the developer's hand, a wait of the agent's own still runs: it touches no page, and the words ask for it.
    const waits = actionOf(input) === "wait" && !input?.text;
    if (b.taken && !(b.taken.hand && waits)) throw new Error(b.taken.hand ? HAND_WORDS : takenWords(b.taken.at, now));
    const s = seatOf(b, seat);
    s.busy = { words: browserArgWords(input), at: now() };
    s.look = mayLook;
    b.droveAt = now();
    b.last = saidOf(s);
    tell(b);
    // Pages of its that went with their host since its last call are what this one works on: they open again first.
    await back(b, s, signal).catch(() => {});
    const awayBefore = s.away.length;
    /** What a call is told where its tab's host went while it ran. */
    const wentWords = () => `The browser went while this call ran (${s.away.at(-1)?.why || "its host went"}): your next call opens your pages again at their addresses, on the browser there is now.`;
    try {
      /** @type {string[]} */
      const out = [];
      /** @type {any[]} */
      const media = [];
      let snap = false;
      let refusedAt = false;
      if (actionOf(input) === "batch") {
        const steps = /** @type {any[]} */ (input.steps);
        const takes = b.takes;
        for (let i = 0; i < steps.length; i++) {
          const st = steps[i];
          if (signal?.aborted) {
            out.push(`Stopped before step ${i + 1}.`);
            break;
          }
          // The developer took the browser over while the batch ran — and maybe gave it back within one step: it stops
          // here, the page theirs, and the handles it had may be another page's.
          if (b.taken || b.takes !== takes) {
            out.push(`Stopped before step ${i + 1}: the developer took the browser over${b.taken ? "" : ", and gave it back: the page may have moved — take a snapshot before acting"}. The steps after it were not run.`);
            break;
          }
          if (acts(st)) {
            // The page it acts on is the one it opens at, where it has none yet (after the app went): judged first.
            await ensure(b, s, signal);
            const page = activeTab(b, s)?.driver.url || "";
            const site = siteOf(page);
            if (site && !mayAct(site, page)) {
              out.push(`Step ${i + 1} (${browserArgWords(st)}) not run: acting on ${site} needs the developer's yes — call it on its own, and Filament asks them. The steps after it were not run.`);
              snap = true;
              break;
            }
          }
          s.busy = { words: `${browserArgWords(st)} (step ${i + 1} of ${steps.length})`, at: now() };
          b.last = saidOf(s);
          tell(b);
          try {
            const from = activeTab(b, s)?.driver.url || "";
            const r = await step(b, s, st, signal);
            out.push(`${i + 1}. ${r.words || browserArgWords(st)}`);
            if (r.media) media.push(...r.media);
            snap = snap || r.snapshot;
            const refused = await refusedLanding(b, s, from, mayLook, signal);
            if (refused) {
              out.push(`${refused} The steps after it were not run.`);
              refusedAt = true;
              break;
            }
          } catch (e) {
            out.push(`${i + 1}. ${browserArgWords(st)} failed: ${/** @type {any} */ (e)?.message || e}. The steps after it were not run.`);
            snap = true;
            break;
          }
        }
        if (input.snapshot === false) snap = false;
      } else {
        // An act is judged again on the page it acts on now: the tab may have moved while the developer was asked — by
        // another call, by their own address in the pane — or opens again at another page after the app went, and a yes
        // for one site is no yes for another (the E27 hunt of 10-23).
        if (acts(input)) {
          await ensure(b, s, signal);
          const page = activeTab(b, s)?.driver.url || "";
          const site = siteOf(page);
          if (site && !mayAct(site, page)) throw new Error(`Not run: the page is on ${site} now, not the one the call was judged on, and acting on ${site} needs the developer's yes — call it again, and Filament asks them.`);
        }
        const from = activeTab(b, s)?.driver.url || "";
        const r = await step(b, s, input, signal);
        if (r.words) out.push(r.words);
        if (r.media) media.push(...r.media);
        snap = actionOf(input) === "snapshot" || (r.snapshot && input.snapshot !== false);
        const refused = await refusedLanding(b, s, from, mayLook, signal);
        if (refused) {
          out.push(refused);
          refusedAt = true;
        }
      }
      // A page the rules refuse was left: no snapshot of where it went. Its host gone as it ran: none of another tab's.
      if (refusedAt) snap = false;
      if (s.away.length > awayBefore) {
        snap = false;
        out.push(wentWords());
      }
      const t = activeTab(b, s);
      if (snap && t) out.push(await t.driver.snapshot());
      if (t) {
        t.url = t.driver.url;
        t.title = t.driver.title;
        t.used = now();
      }
      const notes = [...s.notes.splice(0), ...tabsOf(b, s).flatMap((x) => x.driver.takeSaid())];
      const text = [...notes, ...out].filter(Boolean).join("\n");
      return media.length ? new MediaResult(text, media) : text;
    } catch (e) {
      /** @type {any} */
      let err = e;
      if (s.away.length > awayBefore) err = new Error(`${String(/** @type {any} */ (e)?.message || e).replace(/\.$/, "")}. ${wentWords()}`);
      // What waited to be said comes ahead of the failure, as it comes ahead of a result: an agent whose first call after
      // its tab closed unused clicks a handle of the page that went hears why it went, not only that the handle is not
      // there. A cancelled call keeps them: no one reads its words, and the next call says them.
      if (!signal?.aborted && s.notes.length) err = new Error([...s.notes.splice(0), String(err?.message || err)].join("\n"));
      throw err;
    } finally {
      // The tab it worked on counts as driven from the call's end: the pane's veil stays on it a while (BS3).
      const on = openTab(b, s.on);
      if (on) on.drove = now();
      s.busy = null;
      s.on = null;
      s.look = null;
      b.droveAt = now();
      tell(b);
    }
  }


  /** What an agent does now, for the pane: the newest call at work, with whose it is. @param {ChatBrowser | undefined} b */
  const busyOf = (b) => {
    const at = b ? [...b.seats.values()].filter((s) => s.busy).sort((x, y) => Number(y.busy?.at) - Number(x.busy?.at))[0] : null;
    return at?.busy ? { ...at.busy, ...(at.key !== MAIN ? { by: at.name } : {}) } : null;
  };
  /** What a seat's call at work does, and whose it is. @param {Seat} s @returns {Said} */
  const saidOf = (s) => ({ words: String(s.busy?.words || ""), ...(s.key !== MAIN ? { by: s.name } : {}) });
  /** The chat's agents' use of its browser moved: `moved` hears it as `stateOf` would say it. @param {ChatBrowser} b */
  const tell = (b) => {
    try {
      moved(b.chain, { busy: busyOf(b), droveAt: b.droveAt || null, taken: !!b.taken, available: there(b.chain), last: b.last });
    } catch (e) {
      log("warn", `browser: telling of ${b.chain}'s browser failed: ${/** @type {any} */ (e)?.message || e}`);
    }
  };
  /**
   * The page an agent's browser shows, for the gate's site and the rules' subject: its own tab's — or, where its pages
   * went with their host, the one its next call shows as they open again, where an act of that call lands (the E27 hunt
   * of 10-23).
   * @param {string} chain @param {SeatOf | null} [seat]  a sub-agent's, or the chat's own agent's
   */
  const pageOf = (chain, seat = null) => {
    const b = chats.get(String(chain));
    const s = b?.seats.get(seat ? String(seat.id) : MAIN);
    return (b && s && (s.away.find((p) => p.shown)?.url || activeTab(b, s)?.driver.url || s.away.at(-1)?.url)) || "";
  };
  /**
   * Whether an agent may act on a site without asking: the developer said yes to it for the chat, or — for a team's
   * worker (`team`) — its lead said yes to it for that team.
   * @param {string} chain @param {string} site @param {TeamOf | null} [team]
   */
  const allowed = (chain, site, team = null) => {
    const b = chats.get(String(chain));
    return !!site && !!b && (b.sites.has(site) || (!!team && !!b.teams.get(String(team.key))?.sites.has(site)));
  };
  /**
   * A yes for a site, kept for the chat: the developer's for every agent of it, a team's lead's (`team`) for that team's
   * workers alone.
   * @param {string} chain @param {string} site @param {TeamOf | null} [team]
   */
  const allow = (chain, site, team = null) => {
    if (!site) return;
    const b = chatOf(String(chain));
    if (!team) return void b.sites.add(site);
    const key = String(team.key);
    const t = b.teams.get(key) || { name: String(team.name || key), sites: new Set() };
    t.sites.add(site);
    b.teams.set(key, t);
  };

  /**
   * The tabs nobody has used for `TAB_IDLE_MS` closed, on every host — this machine's app, a device's, Chrome — as an
   * agent's close does: the host drops the page, the pane reads the tab gone, and its agent is told at its next call. A
   * chat whose agents work now keeps every tab, however long one stood unused: an agent may come back to it within the
   * turn, and the first look after the work ends closes it. Nor does one close while the person holds the browser, or
   * while a call of the chat's runs or opens its pages again.
   */
  function sweep() {
    const at = now();
    for (const b of [...chats.values()]) {
      if (b.taken || [...b.seats.values()].some((s) => s.busy || s.reopening)) continue;
      // A page that watches it live uses the tab shown, as a pane's read does: its half hour starts once it stops.
      const shown = b.watchers.size ? shownOf(b) : null;
      if (shown) shown.used = at;
      const idle = b.tabs.filter((t) => t.open && at - t.used >= TAB_IDLE_MS);
      if (!idle.length) continue;
      let busy = true;
      try {
        busy = working(b.chain);
      } catch (e) {
        log("warn", `browser: whether ${b.chain}'s agents work could not be read (${/** @type {any} */ (e)?.message || e}): its tabs stay`);
      }
      if (busy) continue;
      for (const t of idle) {
        const url = t.driver.url || t.url;
        void host.call("close", { tab: t.id }, { host: t.host }).catch(() => {});
        drop(b, t);
        tellOwner(b, t, idleWords(t.id, url));
      }
    }
  }
  // One look a minute for every chat, kept from holding the process open; `stop` ends it with Filament.
  const sweeping = setInterval(sweep, IDLE_SWEEP_MS);
  sweeping.unref?.();

  return {
    call,
    get available() {
      return host.available;
    },
    /** The tabs unused for `TAB_IDLE_MS` closed now, as the minute's look does: a test's clock drives it. */
    sweep,
    /** The minute's look stopped, as Filament stops (server.js). */
    stop: () => clearInterval(sweeping),
    /**
     * A chat deleted (server.js `onSessionsDeleted`): each of its tabs closed where it is open — a page it left went on,
     * signed in as it was, with nothing to reach it — and the chat forgotten here.
     * @param {string} chain
     */
    forget(chain) {
      const b = chats.get(String(chain));
      drivers.delete(String(chain));
      if (!b) return;
      for (const t of [...b.tabs]) {
        void host.call("close", { tab: t.id }, { host: t.host }).catch(() => {});
        drop(b, t);
      }
      chats.delete(b.chain);
    },
    /**
     * Who drives a chat now: the caller of its newest turn, by the key of their app's host (http/admin/browser.js
     * `driverOf`) — its new pages open in that app while it is linked. Kept while Filament runs; a page open stays on
     * the host it opened on.
     * @param {string} chain @param {string | null} at  HERE, or a device's host; null leaves the driver as it was
     */
    drive(chain, at) {
      if (!at) return;
      if (at === HERE) drivers.delete(String(chain));
      else drivers.set(String(chain), at);
    },
    /** The key of the host a chat's new page opens on now (host.js `choose`); null for none. @param {string} chain */
    hostFor: (chain) => host.choose(driverOf(String(chain))),
    pageOf,
    allowed,
    allow,
    /**
     * The chat's browser as one of its agents drives it (the loop's `browser`, a coding agent's call over Filament's
     * MCP server): the page its tab shows, whether it may act on a site without asking, and a yes kept — the
     * developer's for the chat; its lead's (`lead`) for its team's workers alone, and for nobody where it is in no team.
     * `team`: its team, which its question names.
     * @param {string} chain @param {SeatOf | null} seat  a sub-agent's, or the chat's own agent's
     * @param {TeamOf | null} team  a team's worker's team
     */
    forAgent: (chain, seat, team) => ({
      page: () => pageOf(chain, seat),
      allowed: (/** @type {string} */ site) => allowed(chain, site, team),
      allow: (/** @type {string} */ site, lead = false) => {
        if (!lead) allow(chain, site);
        else if (team) allow(chain, site, team);
      },
      team,
    }),
    /** @param {string} chain @param {string} site */
    forbid: (chain, site) => {
      const b = chats.get(String(chain));
      if (b) forget(b, site);
    },
    /**
     * What the Browser pane shows of a chat's browser: every agent's tabs, a sub-agent's named for it — each with when an
     * agent's call last worked on it (`droveAt`, null for none) and whether one works on it now (`busy`), so the pane's
     * veil lies on the agents' tabs alone, never on one the developer opened while an agent works on another (BS3).
     * @param {string} chain
     */
    async stateOf(chain) {
      const b = chats.get(String(chain));
      // The cast follows the tab shown however it moved: the pane reads this every moment it shows.
      if (b) recast(b);
      const tabs = b ? b.tabs.filter((t) => t.open) : [];
      const busy = busyOf(b);
      if (b && !busy) for (const t of tabs) await t.driver.where().catch(() => null);
      const shown = b ? shownOf(b) : null;
      // A pane reads this every moment it shows the chat's browser: the tab it shows is in use, and never closes unused.
      if (shown) shown.used = now();
      return {
        available: there(String(chain)),
        tabs: tabs.map((t) => ({
          id: t.id,
          url: t.driver.url,
          title: t.driver.title,
          shown: t === shown,
          size: { ...t.size },
          fit: t.fit,
          droveAt: t.drove || null,
          busy: !!b && workedOn(b, t),
          ...(t.seat !== MAIN ? { by: b?.seats.get(t.seat)?.name || t.seat } : {}),
        })),
        active: shown?.id ?? null,
        taken: !!b?.taken,
        takenAt: b?.taken?.at ?? null,
        hand: !!b?.taken?.hand,
        droveAt: b?.droveAt || null,
        sites: b ? [...b.sites].sort() : [],
        // A team's lead's yes, each with the team its workers are: one the developer said yes to for the chat is there.
        teamSites: b ? [...b.teams.values()].flatMap((t) => [...t.sites].filter((site) => !b.sites.has(site)).map((site) => ({ site, team: t.name }))).sort((x, y) => x.site.localeCompare(y.site) || x.team.localeCompare(y.team)) : [],
        busy,
        last: b?.last || null,
        lastUrl: (b && (b.seats.get(MAIN)?.away.find((p) => p.shown) || b.seats.get(MAIN)?.away.at(-1))?.url) || "",
      };
    },
    /**
     * What the developer does from the pane: take over or give back, go to an address, back, forward, reload, set the
     * page's size — on the tab the pane shows —, show, open or close a tab, take back a site's yes. Their address and
     * their size go through even while an agent works; the agent whose tab it is hears of it (BS-D3).
     * @param {string} chain @param {{ act: string, url?: string, tab?: string, site?: string, size?: string, width?: number, height?: number, fit?: boolean, hand?: boolean }} p
     * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
     */
    async person(chain, p) {
      const b = chatOf(String(chain));
      const act = String(p?.act || "");
      // Each act of the person's is a use of the tab the pane shows; one on another tab (select) uses that one below.
      const before = shownOf(b);
      if (before) before.used = now();
      if (act === "take") {
        // By hand — the page's own Take over, given back 5 s after the pointer leaves it (BS3) — or from the bar, held
        // until Give back (BS-D10). A take from the bar over one by hand holds it so; never the other way.
        const byHand = p.hand === true;
        if (b.taken && !b.taken.hand) return { ok: true };
        if (!b.taken) b.takes += 1;
        b.taken = { at: b.taken?.at ?? now(), hand: byHand };
        tell(b);
        return { ok: true };
      }
      if (act === "give") {
        if (b.taken) {
          const ms = now() - b.taken.at;
          tellAll(
            b,
            b.taken.hand
              ? `The developer used the page for ${Math.max(1, Math.round(ms / 1000))} s: the page may have moved — take a snapshot before acting.`
              : `The developer gave the browser back after ${Math.max(1, Math.round(ms / 60_000))} min: the page may have moved — take a snapshot before acting.`,
          );
        }
        const had = !!b.taken;
        b.taken = null;
        letGo(b);
        if (had) tell(b);
        return { ok: true };
      }
      if (act === "forbid") {
        forget(b, String(p.site || ""));
        return { ok: true };
      }
      if (!there(b.chain)) return { ok: false, error: NO_HOST };
      try {
        /** The tab the pane shows, or the chat's own agent's opened for the developer. */
        const shownTab = async () => shownOf(b) || (await ensure(b, seatOf(b), null));
        if (act === "navigate") {
          const to = wholeUrl(String(p.url || ""));
          const problem = inputProblem({ action: "navigate", url: to }, { own });
          if (problem) return { ok: false, error: problem };
          const t = await shownTab();
          await t.driver.navigate(to);
          tellOwner(b, t, `The developer opened ${to}${t.seat !== MAIN ? ` in your tab ${t.id}` : ""}.`);
        } else if (act === "back" || act === "forward" || act === "reload") {
          const t = await shownTab();
          await (act === "back" ? t.driver.back() : act === "forward" ? t.driver.forward() : t.driver.reload());
          // Its agent's handles were the page's before: it hears so, as it does of the developer's address.
          tellOwner(b, t, `The developer ${act === "back" ? "went back" : act === "forward" ? "went forward" : "reloaded the page"}${t.seat !== MAIN ? ` in your tab ${t.id}` : ""}: take a snapshot before acting.`);
        } else if (act === "select") {
          const t = openTab(b, String(p.tab || ""));
          if (!t) return { ok: false, error: `no tab ${p.tab} in this chat` };
          b.view = t.id;
          t.used = now();
          recast(b);
          // A tab of the chat's own agent's, shown, is the one it works on — and it hears so; another agent's stays that
          // agent's own.
          const main = seatOf(b);
          if (t.seat === MAIN && main.active !== t.id) {
            main.active = t.id;
            tellOwner(b, t, `The developer showed tab ${t.id} in the Browser pane: your calls work on it now (${t.driver.url.slice(0, 200)}) — take a snapshot before acting.`);
          }
        } else if (act === "close") {
          const t = b.tabs.find((x) => x.id === String(p.tab || ""));
          if (!t) return { ok: false, error: `no tab ${p.tab} in this chat` };
          await host.call("close", { tab: t.id }, { host: t.host }).catch(() => {});
          drop(b, t);
          if (t.seat !== MAIN) tellOwner(b, t, `The developer closed your tab ${t.id}.`);
        } else if (act === "size") {
          // The pane's size chip (BS2): a named size, width and height, or the pane's own (Fit the pane, BS-D5).
          const want = p.fit === true ? null : sizeWanted(p);
          if (want && !want.ok) return { ok: false, error: want.error };
          const t = await shownTab();
          await sized(t, want ? want : { fit: true });
          tellOwner(
            b,
            t,
            t.fit
              ? `The developer set the page${t.seat !== MAIN ? ` in your tab ${t.id}` : ""} to fit the Browser pane: it takes the pane's size, and lays itself out again as the pane moves — take a snapshot before acting.`
              : `The developer set the page${t.seat !== MAIN ? ` in your tab ${t.id}` : ""} to ${sizeWords(t.size)}: take a snapshot before acting.`,
          );
        } else if (act === "new") {
          await tabsStep(b, seatOf(b), { op: "new", url: p.url }, null);
        } else if (act === "clear") {
          // Where the chat's browser is: the host its new page opens on, and each that holds a tab of its.
          const where = new Set([host.choose(driverOf(b.chain)), ...b.tabs.filter((t) => t.open).map((t) => t.host)]);
          for (const at of where) if (at) await host.call("clear", {}, { host: at });
          tellAll(b, "The developer cleared the browser's data: sign-ins and cookies are gone.");
        } else return { ok: false, error: `${act} is nothing the pane does` };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(/** @type {any} */ (e)?.message || e) };
      }
    },
    /** A picture of the tab the pane shows, for the pane in a browser tab (BR-D11); null with none. @param {string} chain */
    async shot(chain) {
      const b = chats.get(String(chain));
      const t = b ? shownOf(b) : null;
      if (!t || !host.linked(t.host)) return null;
      return t.driver.screenshot();
    },
    /** The tab the pane shows: the id the app's view goes by. @param {string} chain */
    shownTab: (chain) => {
      const b = chats.get(String(chain));
      return (b && shownOf(b)?.id) || null;
    },
    /**
     * A page that watches a chat's browser live, with no app of its own to show the page itself (another machine's
     * harness, a browser's tab): told where the cast stands now and as it moves, and handed each frame of the tab the
     * pane shows — the newest at once, where the app has cast one. → the stop: the last watcher's stops the cast.
     * @param {string} chain @param {Watcher} w @returns {() => void}
     */
    watch(chain, w) {
      const b = chatOf(String(chain));
      b.watchers.add(w);
      if (!recast(b)) {
        sayCast(b, [w]);
        if (b.cast.frame) w.frame(b.cast.frame);
      }
      return () => {
        if (!b.watchers.delete(w)) return;
        if (b.pressed && b.pressed.by === w) letGo(b);
        recast(b);
        // A chat watched and never used keeps nothing here: a page may name any chat.
        if (chats.get(b.chain) === b && !b.watchers.size && !b.tabs.length && !b.seats.size && !b.sites.size && !b.teams.size && !b.taken && !b.droveAt) chats.delete(b.chain);
      };
    },
    /**
     * The person's click, key or paste on the page, from a pane outside the app (`watch`), while they have the browser
     * — taken over from the pane's bar, or by hand: Chrome's input on the tab the pane shows, at the page's own point.
     * Refused in words while the browser is the agent's — but a release, which lets go a button held as the hand went.
     * @param {string} chain @param {any} ev  `{ kind: "mouse" | "key" | "text", … }` (`inputCommand`)
     * @param {unknown} [by]  the watcher (`watch`) it comes from: a button it holds is let go as it stops
     */
    async input(chain, ev, by = null) {
      const b = chats.get(String(chain));
      const cmd = inputCommand(ev);
      const type = cmd?.method === "Input.dispatchMouseEvent" ? String(cmd.params.type) : "";
      if (!b?.taken) {
        if (type !== "mouseReleased") throw new Error(NOT_TAKEN_WORDS);
        // Let go where it was held, if the hand's end has not already; nothing to say either way.
        if (b) letGo(b);
        return;
      }
      if (!there(b.chain)) throw new Error(NO_HOST);
      const t = shownOf(b);
      if (!t || !cmd) {
        if (b.pressed && type === "mouseReleased") return letGo(b);
        throw new Error(!t ? "No page is shown: open one first." : "That is no click, key or text the browser takes.");
      }
      const p = cmd.params;
      if (type === "mousePressed") b.pressed = { tab: t.id, host: t.host, x: Number(p.x), y: Number(p.y), button: String(p.button), clicks: Number(p.clickCount) || 1, by };
      else if (type === "mouseReleased") b.pressed = null;
      else if (type && b.pressed?.tab === t.id) b.pressed = { ...b.pressed, x: Number(p.x), y: Number(p.y) };
      await host.call("cdp", { tab: t.id, method: cmd.method, params: cmd.params }, { ms: INPUT_MS, host: t.host });
    },
  };
}

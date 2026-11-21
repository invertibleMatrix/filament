// @ts-check
// Settings › Experimental (the owner's of 11-05): features still being tried, each off until it is turned on. Naming
// chats with memory's model — as a chat's first message is sent, memory's model for the chat reads about 1K tokens of
// it and names the chat while the agent works — and Parallelize tasks (the owner's of 11-06), on for every chat once on
// (the owner's of 11-08), the person's consent to their agent starting independent tasks on sub-agents itself (11-09).
// Drawn from the schema and kept at once (lib/config-rows.js); the model it names with is read from memory's, and opens
// Settings › Memory. Weigh your messages aside, your default for new chats (the owner's forked steer of 11-04), moved
// here from Settings › Instructions with its words (11-09), written as that page wrote it (lib/place-settings.js). And
// memory's one off switch (the owner's of 11-08 and 11-09: memory is core, on by default, its off switch here alone,
// hard to find on purpose): `memory.enabled` for every chat and app, through `POST /api/memory/enabled`. And Cursor
// through its SDK (the owner's of 11-10: Cursor is one agent, its CLI; its SDK a second way here, off by default). And
// Teams (the owner's of 11-17: still untested and not fully done, so off by default; src/ui/lib/teams-on.js reads it).
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { routeFor } from "../lib/router.js";
import { mountConfigPage } from "../lib/config-rows.js";
import { toggle } from "../lib/fields.js";
import { placeSettings } from "../lib/place-settings.js";
import { placeKit } from "./place-page.js";
import { WORDS } from "../lib/words.js";

/** Settings search's words for this page (search.js, HS-D68): each row it draws, checked against its code by a test. */
export const SEARCH_ROWS = Object.freeze([
  { path: "experimental.nameChats", label: "Name chats with memory's model", words: "title rename thread name" },
  { label: "Memory's model", words: "summarizer side model memory" },
  { path: "experimental.parallelizeTasks", label: "Parallelize tasks", words: "parallel sub-agents tasks at once plan every chat consent start card" },
  { label: "Weigh your messages aside", words: "steer fork message while it works correction question tasks letter" },
  { label: "Use memory", words: "memory off on turn off disable recall learn engine everywhere" },
  { path: "experimental.cursorSdk", label: "Cursor through its SDK", words: "cursor sdk api key coding agent second way official" },
  { path: "experimental.teams", label: "Teams", words: "team teams lead workers builders bughunters bug hunters in charge on the side brief" },
]);

/** What the switch for the forked steer says (the owner's of 11-04). */
export const STEER_FORK_WORDS = "On: a message you send while Filament's own agent works goes first to a fork of its conversation, read from the cache, one at a time. A correction reaches the agent once the fork has sorted it; a question is answered under your message while the agent works on; more work becomes tasks proposed on its plan, with a letter it opens when it chooses. Off, the default: every message goes straight to the agent, but one you send with the ⌄ menu's Weigh aside first, or as /steer-fork <your message>. A coding agent's chat sends them straight either way.";

/** What memory's switch says: what off means, plainly. */
export const MEMORY_OFF_WORDS = "On, Filament's default. Off, for every chat and every app that uses Filament: nothing is recalled into a chat, nothing is learned from one, no agent gets memory's tools, and memory's engine stops. Every turn is still kept, so your chats and their transcripts stay, and what memory holds is there again once it is on.";

/** What naming chats does, under its switch; its schema's words say it whole on hover. */
export const NAME_DESC = "As a chat's first message is sent — or its next once this is on — memory's model reads about 1K tokens of it and names the chat in a few words while your agent works, as Claude's desktop app does. A chat you named or renamed keeps yours, and memory's model never reads one kept from memory.";

/**
 * What Parallelize tasks does, under its switch — turning it on is the person's consent (the owner's of 11-09); off, a
 * card asks first, and starts them by itself after 60 seconds (the owner's of 11-14, and their choice, wherever each
 * would work) — and each chat's prompt is written anew once when it flips; its schema's words say it whole on hover.
 */
export const PARALLEL_DESC = "Turning this on is your consent: in every chat, where tasks of your agent's plan can run at once — truly independent, none needing another's work — your agent starts them on sub-agents itself, with no card asking you first. Off, it asks you on a card first: they start on your Accept, or after 60 seconds if you say nothing; One at a time keeps the work with your agent. Each works in its own worktree, so they may share a file — unless sub-agents work in the chat's folder (Session folder): then tasks that share a file run one after another. Switching it writes each chat's prompt anew once, at its next message.";

/** What Cursor through its SDK does, under its switch; its schema's words say it whole on hover. */
export const CURSOR_SDK_DESC = "Cursor is its CLI: its permission questions come to your chat's switch, and it signs in with your Cursor login. On, Settings › Coding agents offers Cursor's SDK beside it, signed in with an API key Cursor makes, each key an account. Its agent approves its own tools, so its shell and file tools are off and Filament's checked ones do that work; a chat stricter than Auto also runs without its sub-agents and your MCP servers. Off, an SDK account you have stays in your settings, its models out of the pickers.";

/** What Teams does, under its switch; its schema's words say it whole on hover. */
export const TEAMS_DESC = "A team is a lead that plans, briefs and checks, and workers that do the work: Builders and BugHunters ship with Filament. On: Library › Agents and teams holds them, a chat's Agents tab sends one on the side or puts one in charge, your agent may send one, and a flow's box may be one. Off: none starts and nothing offers one, and a chat you put a team in charge of is answered by your agent until this is on again. A team already at work finishes, and the team work in your chats stays. Switching it writes each chat's tools anew once, at its next message.";

/**
 * Memory's model as the page says it: the one set, else what names a chat where none is set, or why none does. `md`:
 * `GET /api/memory/models`' models.
 * @param {any} md @returns {string}
 */
export function sideWords(md) {
  if (!md) return "";
  if (md.summarizer === "off") return "None: memory's model is off, so no chat is renamed. Pick one in Settings › Memory.";
  if (md.summarizer && md.summarizer !== "auto") return String(md.summarizer);
  return "Not set: each chat is named by its compaction model, else its own model.";
}

/**
 * @param {HTMLElement} body
 * @param {{ onToast?: (msg: string, kind?: string) => void, onChanged?: () => void }} [cb]
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any> }} [io]
 */
export function renderExperimental(body, cb = {}, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  /** Memory's models, once read. @type {any} */
  let md = null;
  // Weigh your messages aside: your default for new chats, read and written as Settings › Instructions did, in a part of
  // its own the page's draws keep — its heading with it, so a default that could not be read leaves none over nothing.
  const steerEl = m("div", { class: "nset-part" });
  const place = placeSettings("all", { ...io, api: call });
  const paintSteer = () => {
    const pk = placeKit(place, paintSteer, cb, io);
    steerEl.replaceChildren(pk.head("While your agent works"), pk.switchRow("loop.steerFork", "Weigh your messages aside", STEER_FORK_WORDS, false));
  };
  place.read().then(paintSteer, () => {});
  const page = mountConfigPage(body, cb, { ...io, api: call }, {
    rows: (kit) => {
      const on = kit.value("memory.enabled") !== false;
      /** Memory on or off for everything, through its own route; the page read again either way. */
      const flip = async () => {
        try {
          await call("/memory/enabled", { method: "POST", body: { enabled: !on } });
          cb.onToast?.(on ? "Memory is off for every chat and app" : "Memory is on");
          cb.onChanged?.();
        } catch (/** @type {any} */ e) {
          cb.onToast?.(`Not changed: ${String(e?.body?.error || e?.message || e)}`, "err");
        }
        await kit.redraw();
      };
      return [
        kit.head(WORDS.chats),
        kit.field("experimental.nameChats", { label: "Name chats with memory's model", desc: NAME_DESC }),
        kit.row("Memory's model", sideWords(md) || "Memory's model names them.",
          m("a", { class: "inst-link", href: routeFor("settings", { section: "memory" }) }, "Settings › Memory")),
        kit.head("Planning"),
        kit.field("experimental.parallelizeTasks", { label: "Parallelize tasks", desc: PARALLEL_DESC }),
        steerEl,
        kit.head("Coding agents"),
        kit.field("experimental.cursorSdk", { label: "Cursor through its SDK", desc: CURSOR_SDK_DESC }),
        kit.head("Teams"),
        kit.field("experimental.teams", { label: "Teams", desc: TEAMS_DESC }),
        kit.head("Memory"),
        kit.row("Use memory", MEMORY_OFF_WORDS, toggle(m, on, "Use memory", () => void flip())),
      ];
    },
  });
  call("/memory/models")
    .then((r) => {
      md = r?.models || null;
      if (md) void page.redraw();
    })
    .catch(() => {});
}

// @ts-check
// Filament's own rows for an app's `filament` source (the Space Apps plan of 10-29, more reads): this Space's board,
// this project's chats, what each of them spent, and the project's places — each a JSON list an app's columns read, as
// a command's output is (core/dashboard-sources.js FILAMENT_READS says what each row is). Read only, with no AI: built
// from the stores the composition root hands it. An app's rows are one read every reader shares — its page, every chat's
// agent through the space tool, its watches' lines in What happened —, so a chat whose words are none of another chat's
// agent's to read (`apart`) is "an untitled chat" in them (core/space.js `readerNames`).
import { UNTITLED_CHAT, readerNames } from "../core/space.js";

/** A moment as an ISO date, or null; a time in seconds read as one. @param {unknown} t */
const iso = (t) => {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n < 1e12 ? n * 1000 : n).toISOString();
};

/**
 * @param {{ tasksOf: (project: string) => import("../core/space.js").SpaceTask[], chainsOf: (project: string) => any[],
 *   nameOf: (chain: string) => string, apart?: (chain: string) => boolean, working: () => Set<string>, spendOf: (chain: any) => ReturnType<typeof import("../services/spend.js").usageOf>,
 *   folderOf: (project: string) => string | null, placesOf: (folder: string) => Promise<any[]> }} deps
 *   `tasksOf`: the Space's board, none where the project has no Space; `chainsOf`: the project's listed chats, not
 *   archived, the newest first; `apart`: whether a chat's words are none of another chat's agent's to read; `working`:
 *   the chats at work now; `spendOf`: one chat's spend ledger; `placesOf`: each worktree of a folder's repository, read
 *   whole
 * @returns {(project: string, what: string) => Promise<import("../core/dashboard-sources.js").CommandOut>}
 */
export function createFilamentRows({ tasksOf, chainsOf, nameOf: named, apart, working, spendOf, folderOf, placesOf }) {
  // As no chat's agent reads it alone: every chat `apart` says is "an untitled chat".
  const { nameOf, apart: hidden } = readerNames({ nameOf: named, apart }, "");
  /** A chat's name as the Space says it: its title, else its first words. @param {any} c */
  const chatName = (c) => (hidden(String(c?.id)) ? UNTITLED_CHAT : String(c?.title || c?.preview || UNTITLED_CHAT));
  /** @type {Record<string, (project: string) => Promise<Record<string, unknown>[]>>} */
  const rowsOf = {
    board: async (project) =>
      tasksOf(project).map((t) => ({
        id: t.id,
        title: t.title,
        line: t.line || "",
        column: t.column,
        parked: !!t.parked,
        chat: t.chain ? nameOf(t.chain) : null,
        by: t.by?.kind === "you" ? "you" : t.by?.name || (t.by?.chain ? nameOf(t.by.chain) : t.by?.kind || null),
        moved: iso(t.movedAt || t.at),
        done: iso(t.doneAt),
      })),
    chats: async (project) => {
      const now = working();
      return chainsOf(project).map((c) => ({
        id: String(c.id),
        title: chatName(c),
        model: c.model || null,
        working: now.has(String(c.id)),
        turns: Number(c.turns) || 0,
        started: iso(c.started_at),
        last: iso(c.last_at),
      }));
    },
    usage: async (project) =>
      chainsOf(project).map((c) => {
        const u = spendOf(c);
        return { chat: String(c.id), title: chatName(c), requests: u.requests, input: u.input, output: u.output, cacheRead: u.cacheRead, cost: Math.round(u.usd * 10_000) / 10_000, last: iso(c.last_at) };
      }),
    places: async (project) => {
      const folder = folderOf(project);
      if (!folder) throw new Error("its project has no folder");
      return (await placesOf(folder)).map((p) => ({
        path: String(p.path),
        name: String(p.name || p.path),
        main: !!p.main,
        branch: p.branch || null,
        base: p.base || null,
        ahead: p.ahead ?? null,
        behind: p.behind ?? null,
        uncommitted: p.uncommitted ? p.uncommitted.files : null,
        added: p.uncommitted ? p.uncommitted.added : null,
        removed: p.uncommitted ? p.uncommitted.removed : null,
        missing: !!p.missing,
      }));
    },
  };
  return async (project, what) => {
    const read = Object.prototype.hasOwnProperty.call(rowsOf, what) ? rowsOf[what] : null;
    if (!read) return { ok: false, error: `Filament has no ${what} to read` };
    try {
      return { ok: true, out: JSON.stringify(await read(project)) };
    } catch (/** @type {any} */ e) {
      return { ok: false, error: `Filament's ${what} could not be read (${e?.message || e})` };
    }
  };
}

// @ts-check
// ＋ New app's starters (the Space Apps plan of 10-29, "Building and changing"): each a real folder Filament ships under
// `starters/apps/<id>/`, an app that runs as it is — its page on the shelf's libraries, its app.json's sources and
// buttons — which an agent adapts to the project: Pipeline, Team pulse, Reader; and Numbers, today's tile dashboard,
// which has no folder. Each says itself in its `starter.json` (title, the line under its button, the words its box
// starts with, app or dashboard, the Spaces it fits — a project's, one of your own's, or any —, its place in the row);
// a Space of your own's are made from their words alone (To-do list, Habits, A small game), and the Reader fits both. A starter chosen is copied into the project's
// `.filament/apps/<id>/` — a new name beside one already there, never over it —, each `{{folder}}` in its app.json
// written as that folder, so its commands run from the project's own folder; and the Start's words say what to make
// from it. Nothing is sent: the person reads the Start and sends it.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the starters are, in the checkout and in the installed app. */
export const STARTERS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "starters", "apps");
/** Where a starter goes in a project, its folder by the starter's id. */
export const APPS_FOLDER = ".filament/apps";
/** The file a starter says itself in, which is never copied. */
const STARTER_JSON = "starter.json";
/** What a starter's app.json names its own folder by, written as the folder it was copied to. */
const FOLDER_MARK = "{{folder}}";

/**
 * `for`: the Spaces it fits — a project's (its code: scripts, commits, commands), a Space of your own's, or any.
 * @typedef {{ id: string, title: string, says: string, words: string, kind: "app" | "dashboard", for: "project" | "own" | "any", order: number, folder: boolean }} AppStarter
 */

/** Every starter, in its order; one whose starter.json does not read is left out. @param {string} [dir] @returns {AppStarter[]} */
export function appStarters(dir = STARTERS_DIR) {
  let names = [];
  try {
    names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^[a-z0-9-]+$/.test(d.name)).map((d) => d.name);
  } catch {
    return [];
  }
  /** @type {AppStarter[]} */
  const out = [];
  for (const id of names) {
    try {
      const s = JSON.parse(readFileSync(join(dir, id, STARTER_JSON), "utf8"));
      const kind = s.kind === "dashboard" ? "dashboard" : "app";
      const fits = s.for === "project" || s.for === "own" ? s.for : "any";
      out.push({ id, title: String(s.title || id), says: String(s.says || ""), words: String(s.words || ""), kind, for: fits, order: Number(s.order) || 99, folder: kind === "app" && existsSync(join(dir, id, "app.json")) });
    } catch {
      // Not a starter: left out.
    }
  }
  return out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/**
 * The starters a Space offers (the Designer's redesign of 10-29): a project's, or a Space of your own's — none of them
 * about a codebase —, the Reader in both.
 * @param {boolean} own @param {string} [dir] @returns {AppStarter[]}
 */
export function startersFor(own, dir = STARTERS_DIR) {
  return appStarters(dir).filter((s) => s.for === "any" || s.for === (own ? "own" : "project"));
}

/** Every file under a folder, by its path inside it, `/` between its parts. @param {string} root @param {string} [at] @returns {string[]} */
const filesUnder = (root, at = root) =>
  readdirSync(at, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? filesUnder(root, join(at, d.name)) : d.isFile() ? [relative(root, join(at, d.name)).replace(/\\/g, "/")] : []));

/**
 * A starter copied into a project: `<cwd>/.filament/apps/<id>/`, or `<id>-2`… beside one there already — never over
 * it. Its app.json's `{{folder}}` is written as the folder, from the project's top.
 * @param {string} id @param {string} cwd  the project's folder @param {string} [dir]
 * @returns {{ ok: true, folder: string, files: string[] } | { ok: false, error: string }}
 */
export function copyStarter(id, cwd, dir = STARTERS_DIR) {
  const s = appStarters(dir).find((x) => x.id === id);
  if (!s) return { ok: false, error: `Filament has no starter ${id}: it has ${appStarters(dir).map((x) => x.id).join(", ")}` };
  if (!s.folder) return { ok: false, error: `${s.title} has no folder to copy: a dashboard is made in a chat` };
  if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) return { ok: false, error: `${cwd || "The project's folder"} is not a folder on this machine` };
  let name = id;
  for (let n = 2; existsSync(join(cwd, ...APPS_FOLDER.split("/"), name)); n++) name = `${id}-${n}`;
  const folder = `${APPS_FOLDER}/${name}`;
  const to = join(cwd, ...folder.split("/"));
  const from = join(dir, id);
  const files = filesUnder(from).filter((p) => p !== STARTER_JSON);
  mkdirSync(to, { recursive: true });
  for (const p of files) {
    const target = join(to, ...p.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    if (p === "app.json") writeFileSync(target, readFileSync(join(from, p), "utf8").split(FOLDER_MARK).join(folder));
    else cpSync(join(from, p), target);
  }
  return { ok: true, folder, files };
}

/**
 * The words the Start opens with to make an app (＋ New app): the person's request — what they said, a starter's own
 * words where they said nothing —, and where a starter was copied; a dashboard, for Numbers. How to make it is the
 * agent's guides' (the artifact tool's app guide: its folder under `.filament/apps/`, a starter adapted), not the
 * person's message (the Designer's redesign of 10-29).
 * @param {{ project: string, said: string, starter?: AppStarter | null, folder?: string | null, own?: boolean }} o
 *   `own`: a Space of your own, which is named for itself: "Make an app for Hobbies" (the Designer's second walk, 10-29)
 */
export function newAppWords({ project, said, starter = null, folder = null, own = false }) {
  const what = said.trim() || starter?.words || "";
  // recipes', not recipes's (the Designer's walk of 10-29).
  const space = own ? project : `${project}${/s$/i.test(project) ? "'" : "'s"} Space`;
  if (starter?.kind === "dashboard") return `Make a dashboard for ${space}: ${what}`;
  if (starter && folder) return `Make an app for ${space} from Filament's ${starter.title} starter, copied into ${folder}/: ${what}`;
  return `Make an app for ${space}: ${what}`;
}

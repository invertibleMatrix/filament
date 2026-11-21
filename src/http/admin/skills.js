// @ts-check
// The admin API's skills area (HarnessV4_Skills_Plan S1-6): Library › Skills. Your skills with where each is on for the
// place picked — all chats, a project or a Space, a chat — and the plugins' skills, on wherever their plugin is; what
// the coding agents keep on this computer (Found on this computer); Add — folders read where they stand, a git address
// cloned, a skill made here —, turned on at the place it names unless it says `on: false` (the page's, which turns
// nothing on: a tag loads a skill); a skill's page, its files, and a made one's
// written; Update a git one; Remove (a made or cloned one's files go too); a made one's books (step 2) — added, taken
// out, found in —; and a crafter chat opened (app/crafter-chats.js), whose agent crafts a skill in the open.
// Nothing here runs a skill.
import { sendJson } from "../../app/pipeline/respond.js";
import { guard as guardWith } from "./guard.js";
import { join } from "node:path";
import { SKILLS_MAX, pluginSkillName } from "../../app/agent/skills.js";
import { PAGES_PER_PART } from "../../app/skill-library.js";
import { estimateTokens } from "../../core/tokens.js";
import { noteFromMemory } from "../../app/skill-from-memory.js";

/**
 * The store's refusals name their status and are answered in their words; anything else is the shared guard's 500.
 * @param {(r: any, a: any) => any} fn
 */
const guard = (fn) =>
  guardWith(async (r, a) => {
    try {
      return await fn(r, a);
    } catch (/** @type {any} */ e) {
      if (Number.isInteger(e?.status) && e.status >= 400 && e.status < 600 && !r.res.headersSent) return sendJson(r.res, e.status, { error: e.message });
      throw e;
    }
  });

/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });

/**
 * A write's `from`, as Add to a skill… sends it: the memory, the section and the lines its words became.
 * @param {any} f @returns {{ memory: string, section: string, lines: string[] }}
 */
function fromOf(f) {
  const lines = Array.isArray(f?.lines) ? f.lines.filter((/** @type {unknown} */ l) => typeof l === "string" && l.trim()).slice(0, 200) : [];
  if (typeof f?.memory !== "string" || !f.memory.trim() || typeof f?.section !== "string" || !f.section.trim() || !lines.length)
    throw refused(400, "from says { memory, section, lines }: the memory, the section and the lines its words became");
  return { memory: f.memory.trim().slice(0, 64), section: f.section.trim().slice(0, 120), lines };
}

/**
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function skillRoutes(a) {
  /** @type {ReturnType<typeof import("../../app/skill-store.js").createSkillStore> | null} */
  const store = a.skillStore ?? null;
  /** @type {ReturnType<typeof import("../../app/skill-places.js").createSkillPlaces> | null} */
  const placesOf = a.skillPlaces ?? null;
  const skills = () => {
    if (!store) throw refused(503, "skills are not wired in this Filament");
    return store;
  };
  const places = () => {
    if (!placesOf) throw refused(503, "skills are not wired in this Filament");
    return placesOf;
  };
  /** @type {ReturnType<typeof import("../../app/skill-library.js").createSkillLibrary> | null} */
  const libraryOf = a.skillLibrary ?? null;
  const library = () => {
    if (!libraryOf) throw refused(503, "skills' libraries are not wired in this Filament");
    return libraryOf;
  };
  /** A skill's name in a route. @param {any} r */
  const nameOf = (r) => decodeURIComponent(String(r.params.name || ""));
  /** A body that is a JSON object, else the refusal that says what it is. @param {any} r @param {string} shape */
  const objectBody = async (r, shape) => {
    const b = await r.json();
    if (!b || typeof b !== "object" || Array.isArray(b)) throw refused(400, `a JSON object is required: ${shape}`);
    return b;
  };
  /** The place a query names, `all` where it names none. @param {any} r */
  const placeIn = (r) => String(r.url.searchParams.get("place") || "all");
  /** A project's folder, for its own skill folders. @param {string | null} projectId */
  const cwdOf = (projectId) => (projectId ? String(a.memory?.archive?.getProject(projectId)?.cwd || "") : "");

  /**
   * The plugins installed that bring skills or commands, each with them and whether it is on at the place.
   * @param {string} place
   */
  const pluginSkills = (place) => {
    const list = a.plugins?.list?.() || [];
    return list
      .filter((/** @type {any} */ p) => p.parts.skills.length || p.parts.commands.length)
      .map((/** @type {any} */ p) => ({
        id: p.id,
        name: p.name,
        title: p.title,
        // Each by the name it is called by: its front matter's, as an agent is given it (the Hunter's of 10-28).
        skills: p.parts.skills.map((/** @type {string} */ s) => (p.root ? pluginSkillName(join(p.root, ...s.split("/"), "SKILL.md"), p.name) : `${p.name}:${s.split("/").at(-1)}`)),
        commands: p.parts.commands.map((/** @type {string} */ c) => `${p.name}:${String(c.split("/").at(-1)).replace(/\.md$/i, "")}`),
        on: !!a.pluginPlaces?.at(p.id, place)?.on,
        places: (a.pluginPlaces?.everywhere()[p.id] || []).filter((/** @type {any} */ x) => x.on).map((/** @type {any} */ x) => x.label),
      }));
  };
  /** A skill's line in an agent's instructions, in tokens: what it costs every request where it is on. @param {{ name: string, description: string }} s */
  const lineTokens = (s) => estimateTokens(`- ${s.name}${s.description ? ` — ${s.description}` : ""}
`);

  return [
    // Your skills, each with where it stands at the place picked; the plugins' skills beside them.
    [
      "GET",
      "/skills",
      guard((r) => {
        const place = placeIn(r);
        const at = places().placeOf(place);
        const everywhere = places().everywhere();
        // Each with its line's cost, which Always on adds up (Product's mock A of 11-07).
        const list = skills().list().map((s) => ({ ...s, on: places().at(s.name, place), places: everywhere[s.name.toLowerCase()] || [], lineTokens: lineTokens(s) }));
        const plugins = pluginSkills(place);
        // How many reach a chat there: yours on and the on plugins' skills and commands, against the most a chat lists.
        const count = list.filter((s) => s.on.on).length + plugins.filter((p) => p.on).reduce((n, p) => n + p.skills.length + p.commands.length, 0);
        return sendJson(r.res, 200, { place: at, skills: list, plugins, count, most: SKILLS_MAX });
      }),
    ],
    // The skills the coding agents keep on this computer, per agent; a project's own folders too where the place is one.
    ["GET", "/skills/found", guard((r) => sendJson(r.res, 200, { agents: skills().found({ cwd: cwdOf(places().placeOf(placeIn(r)).projectId) }) }))],
    // Add: `{ paths }` folders read where they stand, `{ git, ref? }` a repository cloned, `{ make, description? }` a
    // skill made here; with `place`, each added is turned on there — unless `on` is false, where the place only says
    // whose a folder is (a project's own .claude/skills is Claude Code's). One added but not turned on (the place's list is
    // full, its layer can't be written) is said in `off` with why: it stays added, so the answer says what is so —
    // never a refusal after the skills were kept (Hunter's find).
    [
      "POST",
      "/skills",
      guard(async (r) => {
        const b = await objectBody(r, "{ paths } | { git, ref? } | { make, description? }, with place? and on?");
        const at = b.place == null ? null : places().placeOf(b.place);
        const place = at && b.on !== false ? at.place : null;
        /** @type {{ added: any[], skipped: any[] }} */
        let got;
        if (b.paths != null) got = skills().addPaths({ paths: b.paths, cwd: cwdOf(at?.projectId ?? null) });
        else if (b.git != null) got = await skills().addGit({ url: b.git, ref: b.ref });
        else if (b.make != null) got = { added: [skills().make({ name: b.make, description: b.description })], skipped: [] };
        else throw refused(400, "say what to add: { paths }, { git, ref? } or { make, description? }");
        /** @type {{ name: string, why: string }[]} */
        const off = [];
        if (place)
          for (const s of got.added)
            try {
              places().turn(s.name, { place, on: true });
            } catch (e) {
              off.push({ name: s.name, why: String(/** @type {any} */ (e)?.message || e).slice(0, 300) });
            }
        return sendJson(r.res, 200, { ok: true, ...got, place, off });
      }),
    ],
    // A crafter chat opened (the owner's word of 10-27): `/craft <words>` from a chat, or a made skill's Craft it in a
    // chat… — a new chat in the folder and with the model given, else the chat's it was asked in, whose agent crafts
    // the skill in the open with the craft tool. Nothing is sent: → its id, for the page to open, and its first message
    // as `draft`, for the page to put in its box until the person's Send.
    [
      "POST",
      "/skills/craft",
      guard(async (r) => {
        const b = await objectBody(r, "{ words, chain?, skill?, cwd?, model? }");
        if (!a.crafterChats) throw refused(503, "the crafter is not wired in this Filament");
        const str = (/** @type {unknown} */ v) => (typeof v === "string" && v.trim() ? v.trim() : null);
        const got = a.crafterChats.start({ words: str(b.words) || "", chain: str(b.chain), skill: str(b.skill), cwd: str(b.cwd), model: str(b.model) });
        return sendJson(r.res, 200, { ok: true, ...got });
      }),
    ],
    // One skill whole: its SKILL.md, its files, and where it is turned on.
    [
      "GET",
      "/skills/:name",
      guard((r) => {
        const s = skills().get(nameOf(r));
        const books = s.there && libraryOf ? libraryOf.books(s.path) : [];
        return sendJson(r.res, 200, { ...s, places: places().everywhere()[s.name.toLowerCase()] || [], lineTokens: lineTokens(s), books, readsPdf: !!libraryOf?.readsPdf(), pagesPerPart: PAGES_PER_PART });
      }),
    ],
    // Removed from your skills and taken off every place that names it.
    [
      "DELETE",
      "/skills/:name",
      guard((r) => {
        const got = skills().remove(nameOf(r));
        places().forget(got.removed);
        return sendJson(r.res, 200, { ok: true, ...got });
      }),
    ],
    // Where it stands at a place; turned on or off there — `all`, `project:<id>`, `chat:<id>` —, or back to what it
    // inherits (`on: null`).
    ["GET", "/skills/:name/on", guard((r) => sendJson(r.res, 200, places().at(skills().get(nameOf(r)).name, placeIn(r))))],
    [
      "POST",
      "/skills/:name/on",
      guard(async (r) => {
        const b = await objectBody(r, "{ place, on }");
        const s = skills().list().find((x) => x.name.toLowerCase() === nameOf(r).toLowerCase());
        if (!s) throw refused(404, `There is no skill named ${nameOf(r).slice(0, 64)} in your skills.`);
        return sendJson(r.res, 200, { ok: true, ...places().turn(s.name, { place: b.place, on: b.on }) });
      }),
    ],
    ["POST", "/skills/:name/update", guard(async (r) => sendJson(r.res, 200, { ok: true, ...(await skills().update(nameOf(r))) }))],
    // A made skill's books: added — `{ files: [{ name, data }] }` uploaded (base64), or `{ paths }` on this computer, a
    // file or a folder of them —, taken out by id; and a find in its library, as the skill tool's.
    [
      "POST",
      "/skills/:name/books",
      guard(async (r) => {
        const b = await objectBody(r, "{ files: [{ name, data }] } | { paths }");
        const s = skills().get(nameOf(r));
        const got = await library().add(skills().madeFolder(s.name), s.name, { files: b.files, paths: b.paths });
        return sendJson(r.res, 200, { ok: true, ...got });
      }),
    ],
    [
      "DELETE",
      "/skills/:name/books/:id",
      guard(async (r) => {
        const s = skills().get(nameOf(r));
        const got = await library().remove(skills().madeFolder(s.name), s.name, decodeURIComponent(String(r.params.id || "")));
        return sendJson(r.res, 200, { ok: true, ...got });
      }),
    ],
    [
      "GET",
      "/skills/:name/find",
      guard((r) => {
        const s = skills().get(nameOf(r));
        const got = library().find(s.path, r.url.searchParams.get("words") || "", { limit: Number(r.url.searchParams.get("limit")) || undefined });
        if (!got) throw refused(404, `${s.name} carries no library.`);
        return sendJson(r.res, 200, got);
      }),
    ],
    // A file of its folder as text; a made skill's written. `from`: the memory whose words Add to a skill… wrote into
    // its SKILL.md, the section and the lines — noted beside the skill, so a crafter chat keeps them, and on the memory's
    // History.
    ["GET", "/skills/:name/file", guard((r) => sendJson(r.res, 200, skills().readFile(nameOf(r), r.url.searchParams.get("path"))))],
    [
      "PUT",
      "/skills/:name/file",
      guard(async (r) => {
        const b = await objectBody(r, "{ path, text, from? }");
        if (typeof b.path !== "string" || typeof b.text !== "string") throw refused(400, "say { path, text }");
        const from = b.from == null ? null : fromOf(b.from);
        const got = skills().writeFile(nameOf(r), b.path, b.text);
        if (!from) return sendJson(r.res, 200, { ok: true, ...got });
        const s = skills().get(nameOf(r));
        noteFromMemory(skills().madeFolder(s.name), from);
        const ref = /^\d+$/.test(from.memory) ? `i${from.memory}` : from.memory;
        const noted = !!a.memory?.scope?.({ role: "owner" })?.addedToSkill(ref, { skill: s.name, section: from.section });
        return sendJson(r.res, 200, { ok: true, ...got, noted });
      }),
    ],
  ];
}

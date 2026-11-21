// @ts-check
// The Space's Connectors sheet (HarnessV4_Space_Plan S4b, the mock's screen 4; Connections until the owner's word of
// 10-26): which connectors this project's chats and its dashboards use, and the account each signs in with. Its list is
// Library › Plugins & Connectors' connectors at the project's layer (lib/mcp-list.js) — the same rows, Add, Test, sign-ins and account picks,
// a plugin's among them —, each row with what in this Space uses it; under it the programs the Space's dashboards run,
// which are no connector, and the door to the Library. No service is named here (your word 4): a connector is any MCP
// server.
import { h } from "../../lib/dom.js";
import { sheet, toast } from "../lib/ui.js";
import { createMcpList } from "../lib/mcp-list.js";
import { routeFor } from "../lib/router.js";
import { whose } from "../lib/words.js";

/** @typedef {{ name: string, title: string, reads: string[], presses: string[] }} Use  one dashboard's use of a connection */
/**
 * What a Space's kept dashboards reach out through (`GET /api/space/:project/connections`).
 * @typedef {{ connections: Record<string, Use[]>, programs: { program: string, by: string[] }[], folder: string | null }} Uses
 */

/** Words joined: "a", "a and b", "a, b and c". @param {string[]} xs */
const joined = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/**
 * What in this Space uses a connection, in a line (the mock's pin 4: removing one says what stops): "Used by CI (reads
 * runs · Re-run failed jobs…)".
 * @param {Use[] | undefined} uses
 */
export function usedWords(uses) {
  if (!uses?.length) return "Used by nothing in this Space yet";
  return `Used by ${uses.map((u) => `${u.title} (${[...(u.reads.length ? [`reads ${joined(u.reads)}`] : []), ...u.presses].join(" · ")})`).join(", ")}`;
}

/**
 * What this Space's kept dashboards call through a connection no row of the list is named now — renamed or removed
 * since they were kept —, a line each: what stops (found by the Hunter on S4b: every row said "Used by nothing", and
 * nothing said what no longer reaches its server). "" where none.
 * @param {Uses["connections"]} connections @param {readonly { name: string, spec?: any, orphan?: boolean }[]} rows
 */
export function missingWords(connections, rows) {
  const have = new Set(rows.filter((r) => r.spec && !r.orphan).map((r) => r.name));
  return Object.entries(connections || {})
    .filter(([name, uses]) => !have.has(name) && uses.length)
    .map(([name, uses]) => `${joined(uses.map((u) => u.title))} call${uses.length === 1 ? "s" : ""} ${name}, which no connector here is named now: what ${uses.length === 1 ? "it reads and presses" : "they read and press"} through it fails until one is.`)
    .join(" ");
}

/**
 * The programs this Space's dashboards run, in a line — every other way the project reaches out (the mock's pin 6) —,
 * or "" where they run none. `own`: a Space of the person's own, its folder the Space's (found by the Hunter on the
 * mock pass: it said "the project's folder").
 * @param {Uses["programs"]} programs @param {string | null} folder @param {{ own?: boolean }} [o]
 */
export function programsWords(programs, folder, { own = false } = {}) {
  if (!programs.length) return "";
  const each = programs.map((p) => `${joined(p.by)} run${p.by.length === 1 ? "s" : ""} ${p.program}`).join(" · ");
  return `${each} — in ${folder || (own ? "the Space's folder" : "the project's folder")}, signed in the way those programs are. Filament keeps no token for them.`;
}

/**
 * Whether a dashboard kept in this Space calls a connector's tool: the Space's ⋯ › Connectors… says "used here"
 * then, and not before (SG-D0; the top bar's Connectors until the reshape of 10-29); it opens the sheet always.
 * @param {{ state?: string, grant?: any }[]} dashboards
 */
export function usesConnections(dashboards) {
  return dashboards.some((d) => d.state === "kept" && !!d.grant && [...Object.values(d.grant.sources || {}), ...Object.values(d.grant.actions || {})].some((x) => !!x && typeof x === "object" && !!x.tool));
}

/**
 * The sheet, over the Space; `refresh` reads again what its dashboards use and its rows, as the Space moves while it is
 * open (found by the Hunter on S4b: a dashboard kept, or a server removed, meanwhile left it saying what was).
 * @param {{ project: { id: string, name: string }, own?: boolean, get: (path: string) => Promise<any>, onSettings: () => void, list?: typeof createMcpList }} o
 *   `own`: a Space of the person's own (E50), said as a Space; `get`: a read of the admin API; `onSettings`: Library ›
 *   Connectors with the project chosen; `list`: the list part (a test's stand-in)
 */
export async function connectionsSheet(o) {
  const make = o.list || createMcpList;
  /** @type {Uses} */
  let uses = { connections: {}, programs: [], folder: null };
  const readUses = async () => {
    try {
      uses = await o.get(`/space/${encodeURIComponent(o.project.id)}/connections`);
    } catch (e) {
      toast(`What this Space's dashboards use could not be read: ${String(/** @type {any} */ (e)?.message || e)}`, "err");
    }
  };
  await readUses();
  // A connection a kept dashboard calls that no row is named now: what stops, said under the rows.
  const missing = h("p", { class: "spc-missing", role: "status", hidden: "" });
  const servers = make({
    scope: `project:${o.project.id}`,
    at: "project",
    // In the person's words: accounts and services, and none of the harness's (the Designer's walk of 10-29).
    foot: null,
    none: `Nothing is connected to ${o.project.name} yet: connect an account or a service, and the chats here can use it.`,
    add: "Connect an account or service…",
    onToast: toast,
    more: (row) => [{ text: usedWords(uses.connections?.[row.name]) }],
    // A plugin's sheet is a Library page: the sheet makes way for it.
    openPlugin: (id) => { s.close(); location.hash = routeFor("library", { page: "plugins", scope: id }); },
    onRows: (rows) => {
      const words = missingWords(uses.connections || {}, rows);
      missing.hidden = !words;
      missing.textContent = words;
    },
  });
  const programsEl = h("div", { class: "spc-programs-part" });
  const paintPrograms = () => {
    const programs = programsWords(uses.programs || [], uses.folder, { own: !!o.own });
    programsEl.replaceChildren(...(programs ? [h("h4", { class: "spc-h" }, "Programs on this computer"), h("p", { class: "spc-programs" }, programs)] : []));
  };
  paintPrograms();
  const body = h("div", { class: "spc-body" },
    h("p", { class: "spc-lead" }, `What ${whose(o.project.name)} chats, routines and apps can use — an account or a service, like GitHub or Linear —, and the account each signs in with. Your other ${o.own ? "Spaces and projects" : "projects"} have their own.`),
    servers.el,
    missing,
    programsEl);
  const foot = h("div", { class: "spc-foot" },
    h("span", { class: "sp-quiet" }, `A connector added here is this ${o.own ? "Space" : "project"}'s; one for every chat is added in the Library.`),
    h("span", { class: "sb-sp" }),
    h("button", { class: "ghost sm spc-settings", type: "button", title: `Library › Plugins & Connectors, with this ${o.own ? "Space" : "project"} chosen`, onclick: () => { s.close(); o.onSettings(); } }, "All connectors in the Library ›"));
  /** What its dashboards use and its rows, read again; each row's Used by and the missing words follow. */
  const refresh = async () => {
    await readUses();
    paintPrograms();
    await servers.refresh();
  };
  // A server removed or renamed in another window says nothing on the events stream: back in this one, it reads again.
  const back = () => void refresh();
  if (typeof window !== "undefined") window.addEventListener("focus", back);
  const s = sheet({
    label: `Connectors · ${o.project.name}`, class: "spc-sheet", head: h("b", { class: "sp-sheet-title" }, `Connectors · ${o.project.name}`), body, foot,
    onClose: () => { if (typeof window !== "undefined") window.removeEventListener("focus", back); },
  });
  return { ...s, refresh };
}

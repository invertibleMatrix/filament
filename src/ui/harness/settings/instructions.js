// @ts-check
// Settings › Instructions (HarnessV4_Settings_Plan HS-3; HC-58, HC-59, HC-86, HC-87): what the agent is told and
// given in the chats that have not chosen their own — words every chat is also told, the instruction files read from
// the project folder, skills, hooks, the web tools and the agent's browser (HarnessV4_Browser_Plan BR2). "Applies to" picks the place, as on Permissions
// (settings/place-page.js); a project holds no mode, so there the told-words and the web switches give way to one
// line that says its chats take yours. Built with an injected `h`, `api` and menu, so it runs on the fake DOM.
import { hookLine, parseInput } from "../../lib/settings/knobs.js";
import { keptArea } from "../lib/fields.js";
import { mountPlacePage } from "./place-page.js";
import { holdJump } from "./search.js";
import { routeFor } from "../lib/router.js";
import { api } from "../lib/api.js";

/** Settings search's words for this page (search.js, HS-D68): each row it draws, checked against its code by a test. */
export const SEARCH_ROWS = Object.freeze([
  { label: "What every chat is also told", words: "system prompt instructions" },
  { label: "Told and given in every chat" },
  { label: "Your files, read in every chat", words: "CLAUDE.md user home global instructions" },
  { label: "Project instruction files", words: "AGENTS.md CLAUDE.md" },
  { label: "Your skills", words: "SKILL.md skill folders" },
  { label: "Hooks", words: "pre-tool post-tool turn-end session-start prompt-submit pre-compact subagent-end" },
  { label: "Read web pages", words: "web fetch" },
  { label: "Search the web", words: "web search" },
  { label: "Drive a browser", words: "browser chromium click type pages localhost" },
]);

/**
 * @param {HTMLElement} body
 * @param {import("./place-page.js").PageCallbacks} [cb]
 * @param {import("./place-page.js").PageIo} [io]
 */
export function renderInstructions(body, cb = {}, io = {}) {
  mountPlacePage(body, cb, io, {
    say: (project) => (project ? `Chats in ${project.name} take these over yours.` : "Every chat that has not chosen its own."),
    rows: instructionRows,
  });
}

/**
 * The page's rows over one place.
 * @param {import("./place-page.js").Kit} kit @param {import("./place-page.js").Project | null} project
 */
export function instructionRows(kit, project) {
  const { m, place, cb, io, write, row, head, switchRow, linesRow } = kit;
  return [
    head("What it is told"),
    project
      ? row("Told and given in every chat", "A project holds no words of its own for every chat, nor the web tools: its chats take what All chats sets.", null)
      : row("What every chat is also told", "Placed after the instruction files, in every chat that has not written its own.",
        keptArea(m, String(place.value("instructions.session") ?? ""), async (v) => (v ? write({ patch: { "instructions.session": v } }) : place.own("instructions.session") ? write({ unset: ["instructions.session"] }) : true),
          { placeholder: "Answer in British English. Run the tests before saying a change is done.", "aria-label": "What every chat is also told", rows: "4", class: "zc-input set-area nset-prose" }),
        { path: "instructions.session", wide: true }),
    ...(project ? [] : [yourFilesRow()]),
    linesRow("instructions.files", "Project instruction files", "Looked for in the chat's folder and each folder above it, up to the top of the repository; in a folder below it, when the agent first reads or changes a file there. One a line, relative to each folder: a path outside it is refused, and a missing file is skipped.", "AGENTS.md"),
    head("Skills"),
    row("Your skills", "Your skills, and where each is on, are in Library › Skills: a chat lists those on in one line, and the agent reads the rest when a request needs it.",
      m("a", {
        class: "inst-link inst-skills",
        href: routeFor("library", { page: "skills" }),
        // A project's page opens Library › Skills on that project.
        onclick: () => { if (project) holdJump({ section: "skills", start: `project:${project.id}` }); },
      }, "Library › Skills")),
    head("Hooks"),
    hooksRow(),
    ...(project ? [] : [
      head("The web"),
      switchRow("plugins.web.fetch", "Read web pages", "A tool that fetches a public page as text. It runs in every mode: a page's address can carry words out of the chat."),
      switchRow("plugins.web.search", "Search the web", "A tool that sends a query to the search page set in the console and reads the first results. The query leaves the chat."),
      switchRow("plugins.browser", "Drive a browser", "A browser in the desktop app's Browser pane, beside the chat, that the agent works and you watch and can take over — for the pages it builds and for sites. Looking runs in every mode; acting on a page asks once a site in Edit, runs in Full access, and never in read-only."),
    ]),
  ];

  /**
   * Your own files, read in every chat (the Designer's answer of 10-27): one a line, a line under the field for each
   * saying whether it is there; with none, Claude Code's own file is offered where this computer has one.
   */
  function yourFilesRow() {
    const path = "instructions.userFiles";
    const paths = (Array.isArray(place.value(path)) ? place.value(path) : []).map(String);
    const lines = m("div", { class: "inst-yours" });
    const call = io.api || api;
    void Promise.resolve()
      .then(() => call(`/instructions/your-files${paths.length ? `?${paths.map((p) => `path=${encodeURIComponent(p)}`).join("&")}` : ""}`))
      .then((/** @type {any} */ r) => {
        lines.replaceChildren(...(paths.length
          ? (Array.isArray(r?.files) ? r.files : []).map((/** @type {any} */ f) =>
            m("div", { class: `inst-yours-line${f.found ? "" : " is-missing"}` }, f.found ? `✓ ${f.path} · ${Number(f.chars).toLocaleString()} characters` : `✗ ${f.path}: not there, skipped`))
          : r?.offer
            ? [m("div", { class: "inst-yours-line" },
              `On this computer: ${r.offer.path} · ${Number(r.offer.chars).toLocaleString()} characters`,
              m("button", { class: "inst-yours-add", type: "button", onclick: () => void write({ patch: { [path]: [r.offer.path] } }) }, "Read it in every chat"))]
            : []));
      }, () => {});
    return row("Your files, read in every chat", "Read wherever the chat works, before the project's files, as Claude Code reads ~/.claude/CLAUDE.md. A file written for another agent brings that agent's rules with it.",
      m("div", { class: "nset-list" },
        keptArea(m, paths.join("\n"), async (text) => write({ patch: { [path]: text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) } }),
          { placeholder: "~/.claude/CLAUDE.md", "aria-label": "Your files, read in every chat", rows: "2", class: "zc-input set-area" }),
        lines),
      { path, wide: true });
  }

  /** Hooks one a line (HC-59): each line is checked, and a line that is not a hook is named, nothing written. */
  function hooksRow() {
    const path = "hooks";
    return row("Hooks", "Commands run in the project folder at an event, one a line: on(tool) command [timeout=ms]. pre-tool and post-tool take a tool; turn-end, session-start, prompt-submit (your message, before the model reads it), pre-compact and subagent-end take none.",
      keptArea(m, (Array.isArray(place.value(path)) ? place.value(path) : []).map(hookLine).join("\n"), async (text) => {
        const r = parseInput(path, /** @type {any} */ ({ type: "list" }), text, "hooks", "Hooks");
        if ("error" in r) { cb.onToast?.(r.error, "err"); return false; }
        return write({ patch: { [path]: "unset" in r ? [] : r.value } });
      }, { placeholder: "post-tool(edit) npm run lint", "aria-label": "Hooks, one a line", rows: "3" }),
      { path, wide: true });
  }
}

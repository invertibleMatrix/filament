// @ts-check
// The admin API's language servers (the owner's LSP of 11-04), for Settings › Language servers: the ones a place's
// chats have — yours (`lsp.servers`), the plugins' on there, then the ones Filament knows (adapters/lsp/servers.js), in
// the order a file picks among them — each with where it comes from, what it runs, the files it serves, whether it is on
// there, and whether its program is installed on this computer, as its start would find it. A plugin's arguments and
// environment are filled with its values, a secret among them: of how it starts, its program alone is said. Nothing
// starts there. And what an `@#` in the message box lists: the project's names a chat's servers know, a server
// started for it as a chat's first lsp call starts one.
import { homedir } from "node:os";
import { sendJson } from "../../app/pipeline/respond.js";
import { guard as guardWith } from "./guard.js";
import { allowedFolderSoon } from "./folder.js";
import { projectIdOf } from "../../core/project-id.js";
import { projectFolderOf } from "../../services/project-folder.js";
import { installed, languageServers } from "../../adapters/lsp/servers.js";

/**
 * The sessions service's refusals name their status (no such project) and are answered in their words; anything else
 * is the shared guard's 500.
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

/**
 * @param {any} a  the admin context: `sessions` reads your defaults, a project's and a chat's settings, `plugins` adds
 *   what the plugins on at a place bring, `projectSymbols` asks the servers the agent loop keeps warm, `memory` names a
 *   chat's project
 * @returns {import("../router.js").RouteRow[]}
 */
export function lspRoutes(a) {
  const { sessions = null, plugins = null, projectSymbols = null, memory = null, config } = a;
  return [
    [
      // `?cwd=<folder>&q=<words>`: the names that answer them, each with its file and lines (app/agent/lsp-tool.js
      // `projectSymbols`), and `said`, why none where none is found. `chain`: the chat's servers, as its turns have them;
      // else, for a chat not started yet, its folder's project's where the archive holds one (none is made here); else
      // your defaults'. The folder is judged as the files area judges it; a page that stops asking stops the search.
      "GET",
      "/lsp/symbols",
      guard(async (r) => {
        if (!sessions || !projectSymbols) return sendJson(r.res, 503, { error: "no archive: the chats' settings are not wired" });
        const q = r.url.searchParams;
        const f = await allowedFolderSoon(config.get(), q.get("cwd"));
        if (!f.ok) return sendJson(r.res, f.status, { error: f.error });
        const chain = q.get("chain") || "";
        const head = chain ? memory?.archive?.chainHead(chain) : null;
        if (chain && !head) return sendJson(r.res, 404, { error: `no such session: ${chain}` });
        const project = head ? head.project_id : memory?.archive?.getProject(projectIdOf(projectFolderOf(f.root)))?.id || null;
        const effective = head ? sessions.effectiveOf(chain) : project ? sessions.projectSettingsOf(project).resolved?.effective : sessions.defaultsOf().effective;
        const settings = plugins && effective ? plugins.into(effective, { project, chat: head ? chain : null, cwd: f.root }) : effective;
        const stop = new AbortController();
        r.res.on("close", () => stop.abort());
        const got = await projectSymbols(q.get("q") || "", { root: f.root, lsp: settings?.lsp, signal: stop.signal, limit: Math.min(50, Number(q.get("limit")) || 0) || undefined });
        return sendJson(r.res, 200, { cwd: f.root, q: q.get("q") || "", ...got });
      }),
    ],
    [
      // `?project=<id>`: that project's chats, a program looked for as a chat in its folder would; else your defaults'.
      "GET",
      "/lsp/servers",
      guard((r) => {
        if (!sessions) return sendJson(r.res, 503, { error: "no archive: the chats' settings are not wired" });
        const project = r.url.searchParams.get("project") || null;
        const doc = project ? sessions.projectSettingsOf(project) : sessions.defaultsOf();
        const effective = project ? doc.resolved?.effective : doc.effective;
        const cwd = project ? String(doc.cwd || "") : "";
        const settings = plugins && effective ? plugins.into(effective, { project, cwd }) : effective;
        const servers = languageServers(settings?.lsp).map((s) => ({
          name: s.name,
          from: s.from,
          ...(s.plugin ? { plugin: s.plugin } : {}),
          command: s.spec.command,
          ...(s.from !== "plugin" && s.spec.args?.length ? { args: s.spec.args } : {}),
          files: Object.keys(s.spec.languages),
          on: s.on,
          found: installed(s.spec, { cwd: cwd || homedir() }),
          ...(s.install ? { install: s.install } : {}),
        }));
        return sendJson(r.res, 200, { servers });
      }),
    ],
  ];
}

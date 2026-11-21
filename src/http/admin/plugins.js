// @ts-check
// The admin API's plugins area (HarnessV4_SpacesPlugins_Plan B1): where plugins come from, for the Plugins page —
// what Claude Code and Codex keep on this computer, Anthropic's directory as Claude Code keeps its copy, and the
// marketplaces the person adds (app/plugin-sources.js). Read only when the page asks; a marketplace added is cloned
// into Filament's own data folder, Refresh brings it up to date, Remove deletes Filament's copy. And the plugins
// installed (B2, app/plugins.js): Install copies one at its commit, Check for updates, Update, Uninstall, its values per
// place — a secret never sent back. Nothing here runs a plugin.
import { sendJson } from "../../app/pipeline/respond.js";
import { guard as guardWith } from "./guard.js";

/**
 * The sources' refusals name their status and are answered in their words; anything else is the shared guard's 500.
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
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function pluginRoutes(a) {
  /** @type {ReturnType<typeof import("../../app/plugin-sources.js").createPluginSources> | null} */
  const sources = a.pluginSources ?? null;
  /** The sources, or the refusal that says they are not wired. */
  const src = () => {
    if (!sources) throw refused(503, "plugins are not wired in this Filament");
    return sources;
  };
  /** A body that is a JSON object, else the refusal that says what it is. @param {any} r @param {string} shape */
  const objectBody = async (r, shape) => {
    const b = await r.json();
    if (!b || typeof b !== "object" || Array.isArray(b)) throw refused(400, `a JSON object is required: ${shape}`);
    return b;
  };
  /** @type {ReturnType<typeof import("../../app/plugins.js").createPlugins> | null} */
  const installed = a.plugins ?? null;
  /** The plugins installed, or the refusal that says they are not wired. */
  const inst = () => {
    if (!installed) throw refused(503, "plugins are not wired in this Filament");
    return installed;
  };
  /** @type {ReturnType<typeof import("../../app/plugin-places.js").createPluginPlaces> | null} */
  const places = a.pluginPlaces ?? null;
  /** An installed plugin's id in a route: `name@marketplace`. @param {any} r */
  const pluginId = (r) => decodeURIComponent(String(r.params.id || ""));
  /** An added marketplace's id in a route, its `added/` dropped where the page names it so. @param {any} r */
  const marketId = (r) => decodeURIComponent(String(r.params.id || "")).replace(/^added\//, "");
  /** @type {ReturnType<typeof import("../../app/connector-catalogue.js").createConnectorCatalogue> | null} */
  const catalogue = a.connectorCatalogue ?? null;
  /** The connectors' picker, or the refusal that says it is not wired. */
  const cat = () => {
    if (!catalogue) throw refused(503, "plugins are not wired in this Filament");
    return catalogue;
  };
  // A plugin installed or uninstalled is no config change, so the feed says it here, as a card's save does
  // (agents.js): the left bar's Plugins & Connectors counts again. A plugin turned on or off, or a connector of yours
  // changed, saves the config, which the feed says by itself.
  /** @param {string} id */
  const told = (id) => a.events?.publish("config", { type: "plugins-changed", id });
  /** A place the picker adds to: your defaults or a project's; a chat's own list keeps the hand-made form. @param {unknown} place */
  const pickPlace = (place) => {
    const s = String(place ?? "all");
    if (s !== "all" && !/^project:[A-Za-z0-9_-]{1,80}$/.test(s)) throw refused(400, "say the place: all or project:<id>");
    return s;
  };

  return [
    // The connectors' picker (the Designer's of 10-26): the marketplaces' plugins that bring an MCP server, found by `q`,
    // with where each is on for `place`; Add installs one and turns it on there; its setup says what it still needs;
    // with no marketplace here, Anthropic's is added from its repository.
    ["GET", "/plugins/connectors", guard(async (r) => sendJson(r.res, 200, await cat().list({ q: String(r.url.searchParams.get("q") || "").slice(0, 120), place: pickPlace(r.url.searchParams.get("place") || "all") })))],
    [
      "POST",
      "/plugins/connectors/add",
      guard(async (r) => {
        const b = await objectBody(r, "{ from, name, place }");
        if (typeof b.from !== "string" || typeof b.name !== "string") throw refused(400, "say { from, name, place }: the marketplace's id, the plugin's name and the place");
        const added = await cat().add({ from: b.from, name: b.name, place: pickPlace(b.place) });
        told(String(added.plugin));
        return sendJson(r.res, 200, { ok: true, ...added });
      }),
    ],
    // Finish setup… on a chat's own row sets the values where its plugin is on, which may be that chat.
    ["GET", "/plugins/connectors/setup", guard((r) => {
      const place = String(r.url.searchParams.get("place") || "all");
      return sendJson(r.res, 200, cat().setup(String(r.url.searchParams.get("id") || ""), /^chat:[A-Za-z0-9_-]{1,120}$/.test(place) ? place : pickPlace(place)));
    })],
    ["POST", "/plugins/connectors/anthropic", guard(async (r) => sendJson(r.res, 200, { ok: true, marketplace: await cat().fetchAnthropic() }))],

    // Everything found: the line the page heads its list with, Claude Code's, Anthropic's directory, Codex's, yours.
    ["GET", "/plugins/sources", guard((r) => sendJson(r.res, 200, src().found()))],
    // A page of one source's plugins, found by `q`: `?id=directory` or a marketplace's id, `limit` and `offset`.
    [
      "GET",
      "/plugins/entries",
      guard((r) => {
        const q = r.url.searchParams;
        const id = String(q.get("id") || "");
        if (!id) throw refused(400, "say which source: ?id=directory, or a marketplace's id");
        return sendJson(r.res, 200, src().entries(id, { q: q.get("q") || "", limit: Number(q.get("limit") || 50), offset: Number(q.get("offset") || 0) }));
      }),
    ],
    // A marketplace you add: `{ source }` — owner/repo, a git address, a marketplace.json's address, or a folder.
    ["POST", "/plugins/marketplaces", guard(async (r) => sendJson(r.res, 200, { ok: true, marketplace: await src().add((await objectBody(r, "{ source }")).source) }))],
    ["POST", "/plugins/marketplaces/:id/refresh", guard(async (r) => sendJson(r.res, 200, { ok: true, marketplace: await src().refresh(marketId(r)) }))],
    ["DELETE", "/plugins/marketplaces/:id", guard((r) => sendJson(r.res, 200, { ok: true, removed: src().remove(marketId(r)) }))],

    // Installed (B2): each with what it holds and an update that waits; install one a source lists, at its commit;
    // Check for updates; Update; Uninstall (`?data=1` its data folder too); its values per place.
    // Each with where it is on (B5): your defaults and each project that names it.
    [
      "GET",
      "/plugins/installed",
      guard((r) => {
        const on = places?.everywhere() || {};
        return sendJson(r.res, 200, { plugins: inst().list().map((p) => ({ ...p, on: on[p.id] || [] })) });
      }),
    ],
    ["GET", "/plugins/installed/:id", guard((r) => sendJson(r.res, 200, { ...inst().get(pluginId(r)), on: places?.everywhere()[pluginId(r)] || [] }))],
    // What a plugin holds before it is installed, for the install sheet: fetched, read, let go (B5).
    [
      "POST",
      "/plugins/preview",
      guard(async (r) => {
        const b = await objectBody(r, "{ from, name }: the source's id (a marketplace's, or directory) and the plugin's name");
        if (typeof b.from !== "string" || typeof b.name !== "string") throw refused(400, "say { from, name }: the source's id (a marketplace's, or directory) and the plugin's name");
        return sendJson(r.res, 200, await inst().preview({ from: b.from, name: b.name }));
      }),
    ],
    // Turned on or off at a place — `all`, `project:<id>`, `chat:<id>` —, its hooks switched there (B3, B5).
    [
      "POST",
      "/plugins/installed/:id/on",
      guard(async (r) => {
        const b = await objectBody(r, "{ place, on, hooks? }");
        const id = pluginId(r);
        inst().get(id);
        if (!places) throw refused(503, "plugins are not wired in this Filament");
        return sendJson(r.res, 200, { ok: true, ...places.turn(id, { place: b.place, on: b.on, hooks: b.hooks }) });
      }),
    ],
    ["GET", "/plugins/installed/:id/on", guard((r) => {
      if (!places) throw refused(503, "plugins are not wired in this Filament");
      return sendJson(r.res, 200, places.at(pluginId(r), r.url.searchParams.get("place")));
    })],
    [
      "POST",
      "/plugins/install",
      guard(async (r) => {
        const b = await objectBody(r, "{ from, name }: the source's id (a marketplace's, or directory) and the plugin's name");
        if (typeof b.from !== "string" || typeof b.name !== "string") throw refused(400, "say { from, name }: the source's id (a marketplace's, or directory) and the plugin's name");
        const plugin = await inst().install({ from: b.from, name: b.name });
        told(String(plugin.id));
        return sendJson(r.res, 200, { ok: true, plugin });
      }),
    ],
    ["POST", "/plugins/installed/:id/check", guard(async (r) => sendJson(r.res, 200, { ok: true, ...(await inst().check(pluginId(r))) }))],
    ["POST", "/plugins/installed/:id/update", guard((r) => sendJson(r.res, 200, { ok: true, plugin: inst().update(pluginId(r)) }))],
    // Uninstalled, it is taken off your defaults and every project too.
    [
      "DELETE",
      "/plugins/installed/:id",
      guard((r) => {
        const removed = inst().uninstall(pluginId(r), { data: r.url.searchParams.get("data") === "1" });
        places?.forget(removed.id);
        told(String(removed.id));
        return sendJson(r.res, 200, { ok: true, removed });
      }),
    ],
    ["GET", "/plugins/installed/:id/values", guard((r) => sendJson(r.res, 200, inst().valuesAt(pluginId(r), r.url.searchParams.get("place"))))],
    [
      "POST",
      "/plugins/installed/:id/values",
      guard(async (r) => {
        const b = await objectBody(r, "{ place, values }");
        return sendJson(r.res, 200, { ok: true, ...inst().setValues(pluginId(r), b.place, b.values ?? {}) });
      }),
    ],
  ];
}

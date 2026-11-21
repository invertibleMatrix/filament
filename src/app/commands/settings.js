// @ts-check
// `/set`, `/unset` and `/settings` (HarnessV3 §7, Step 2 D9/D10): every setting in the registry, from a chat Filament
// runs — the primitive under the feature commands. Commands write only the session's own layer, through the one
// writer; the project layer and the global settings are edited on the dashboard.
import { answerWith, commandChain, openCommandRecord } from "./answer.js";
import { engineProblemFor, isTeamChat } from "../engine.js";
import {
  KNOBS,
  asksLess,
  flatten,
  formatKnobText,
  knobByName,
  knobFormText,
  parseKnobText,
  reachOf,
  scopeOf,
  sessionEngineOf,
} from "../../services/session-settings.js";

/** Where a value came from, in the words `/settings` uses. Exported (Facade D6) so a test can pin the page's
 * `sourceWords` layer words equal to the server's. @param {string | undefined} source */
export const sourceWord = (source) =>
  source === "session" ? "this session" : source === "project" ? "this project" : source === "global" ? "your global settings" : "the built-in default";

/** The reach in words, for the exact-name explanation. @param {string} path */
const reachWords = (path) =>
  reachOf(path) === "every"
    ? "every client obeys it, a direct-to-model chat included"
    : reachOf(path) === "screens"
      ? "Filament's own screens and actions"
      : "obeyed in the harness, where Filament composes the session";

/**
 * `/set <setting> <value>` and `/unset <setting>`: one knob, no feature rules. The reply names the old value and
 * where it came from.
 * @param {any} memory @param {string | null} chainId  the session the command acts on (answer.js `commandChain`)
 * @param {{ verb: "set" | "unset", name: string, valueText: string, raw: string }} cmd
 * @param {{ teams?: import("../engine.js").Teams | null, named?: { model: string, agent: { model: string } | null } }} [o]
 *   `teams`: where the engine finds a session's team; `named`: the name this chat's request carries and what parse
 *   made of it
 */
export function settingsSetReply(memory, chainId, cmd, { teams = null, named = { model: "", agent: null } } = {}) {
  if (!chainId) return { text: `No archive, so this chat has no session to set anything on. ${memory.archiveWhy()}`, chainId: null };
  if (!String(cmd.name || "").trim() && cmd.verb === "set")
    return { text: "Usage: /set <setting> <value> — /settings lists what is in force.", chainId };
  if (!String(cmd.name || "").trim())
    return { text: "Usage: /unset <setting> — it returns the setting to the layers below; /settings <name> explains one.", chainId };
  const found = knobByName(cmd.name);
  if ("candidates" in found && found.candidates.length)
    return {
      text: `That name matches more than one setting:\n${found.candidates.map((c) => `- \`${c}\``).join("\n")}\nSay the whole dotted name, or a longer ending of it.`,
      chainId,
    };
  if ("suggestions" in found) {
    const near = found.suggestions?.length ? ` Did you mean \`${found.suggestions[0]}\`?` : "";
    return { text: `There is no setting called \`${cmd.name}\`.${near} \`/settings all\` lists every setting.`, chainId };
  }
  const path = /** @type {{ path: string }} */ (found).path;
  const doc = memory.docFor(chainId);
  const old = doc.flat[path];
  const oldSource = sourceWord(doc.sources[path]);
  if (cmd.verb === "set") {
    const parsed = parseKnobText(path, cmd.valueText);
    if ("error" in parsed) return { text: parsed.error, chainId };
    const r = memory.patchSessionSettings(chainId, { patch: { [path]: parsed.value } }, { via: `/set ${path}`, card: true });
    if (r.errors?.length) return { text: `Memory command failed: ${r.errors.join("; ")}`, chainId };
    // A value the session already holds — from its own layer or an identical one below — writes nothing; the reply
    // must not claim a write that did not happen (an `/unset` right after would say "doesn't set").
    if (!r.changes.length)
      return { text: `\`${path}\` is already ${formatKnobText(path, parsed.value)} (${oldSource}); nothing was written.`, chainId };
    const lines = [
      `\`${path}\` is ${formatKnobText(path, parsed.value)} for this session (it was ${formatKnobText(path, old)}, from ${oldSource}). The next request uses it.`,
    ];
    const engine = engineLine(memory, chainId, path, teams, named);
    if (engine) lines.push(engine);
    return { text: lines.join("\n"), chainId, card: r.card };
  }
  // /unset: no write when the session's own layer holds nothing
  if (doc.sources[path] !== "session")
    return {
      text: `This session doesn't set \`${path}\`; it already follows ${oldSource}: ${formatKnobText(path, old)}.`,
      chainId,
    };
  const r = memory.patchSessionSettings(chainId, { unset: [path] }, { via: `/unset ${path}`, card: true });
  if (r.errors?.length) return { text: `Memory command failed: ${r.errors.join("; ")}`, chainId };
  const after = memory.docFor(chainId).flat[path];
  const follows = sourceWord(memory.docFor(chainId).sources[path]);
  const engine = engineLine(memory, chainId, path, teams, named);
  return {
    text: `\`${path}\` follows ${follows} again: ${formatKnobText(path, after)}.${engine ? `\n${engine}` : ""}`,
    chainId,
    card: r.card,
  };
}

/**
 * Whether a `/set` or an `/unset` would let the agent do more unasked (session-settings.js `asksLess`): its mode, its
 * rules, the commands refused, the second look, what Filament starts by itself. A name that matches no one setting, or
 * a value its setting refuses, writes nothing. @param {{ verb: string, name: string, valueText: string }} cmd
 */
export function setAsksLess(cmd) {
  if (cmd.verb !== "set" && cmd.verb !== "unset") return false;
  const found = knobByName(cmd.name);
  if (!("path" in found)) return false;
  if (cmd.verb === "unset") return asksLess({ unset: [found.path] });
  const parsed = parseKnobText(found.path, cmd.valueText);
  return !("error" in parsed) && asksLess({ patch: { [found.path]: parsed.value } });
}

/**
 * After an `engine.*` write — or a `loop.tools` one, which can take a team's lead its agent tool — the line that says
 * the engine the session now names cannot run for this chat's name (app/engine.js's words): a setting written is not a
 * setting obeyed.
 * @param {any} memory @param {string} chainId @param {string} path @param {import("../engine.js").Teams | null} teams
 * @param {{ model: string, agent: { model: string } | null }} named
 */
function engineLine(memory, chainId, path, teams, named) {
  if (!path.startsWith("engine.") && path !== "loop.tools") return null;
  const problem = engineProblemFor(sessionEngineOf(memory.docFor(chainId).effective), memory.getConfig(), named, teams, isTeamChat(memory.archive, chainId));
  return problem ? `This session's engine cannot run yet: ${problem} — until it can, its turns go to the session's model.` : null;
}

/**
 * `/settings` — what is in force and where each value came from (D9): the default form lists everything not at the
 * built-in default, `all` lists every knob, a section or prefix narrows, an exact name explains one knob (its
 * description, form, value per layer with the winner, reach, and how to change it back).
 * @param {any} memory @param {string | null} chainId  the session the command reads (answer.js `commandChain`)
 * @param {{ arg: string }} cmd
 */
export function settingsListReply(memory, chainId, { arg }) {
  if (!chainId) return { text: `No archive, so this chat has no session to read. ${memory.archiveWhy()}`, chainId: null };
  const doc = memory.docFor(chainId);
  const ask = String(arg || "").trim().toLowerCase();
  const lines = [`**/settings — this session${` (${chainId})`}**`];
  if (ask === "help" || ask === "?")
    return {
      text: [
        `**/settings** — what is in force and where each value came from.`,
        `- \`/settings\` — everything not at the built-in default, by section.`,
        "- `/settings all` — every setting, the defaults included.",
        "- `/settings <section or prefix>` — one slice, e.g. `/settings memory`.",
        "- `/settings <exact name>` — one setting explained: its form, its value per layer, its reach, how to change it back.",
        "Change one: `/set <name> <value>` · return it to the layers below: `/unset <name>`.",
      ].join("\n"),
      chainId,
    };
  const exact = ask && knobByName(ask);
  if (ask && "path" in (exact || {})) {
    // One knob, explained: what it is, its form, its value in each layer and which one wins, its reach, how to go back.
    const path = /** @type {{ path: string }} */ (exact).path;
    const k = KNOBS[path];
    const layers = doc.layers || {};
    const ofLayer = (v) => (v === undefined ? "—" : formatKnobText(path, v));
    lines.push(
      `\`${path}\` — ${k.doc}`,
      `- form: ${knobFormText(path, { example: false })}${k.nullable ? ", or null" : ""}${k.default === null ? " (null is the default)" : ""}`,
      `- in force: ${formatKnobText(path, doc.flat[path])} · from ${sourceWord(doc.sources[path])}`,
      `- layers: session ${ofLayer(valueAt(layers.session, path))} · project ${ofLayer(valueAt(layers.project, path))} · global ${ofLayer(valueAt(layers.global, path))} · default ${ofLayer(k.default)}`,
      `- reach: ${reachWords(path)}${scopeOf(path) === "session" ? "; belongs to this session alone" : scopeOf(path) === "repo" ? "; a repo fact (the project layer or this session)" : ""}`,
      `- change it: \`/set ${path} <value>\`; back to ${sourceWord(sourceBelow(doc, path))}: \`/unset ${path}\``,
    );
    return { text: lines.join("\n"), chainId };
  }
  const all = ask === "all";
  const prefixFilter = ask && !all && ask !== "help" ? ask : null;
  // The rows are built once; the text and the card (Facade D4) render the same values, so the two forms cannot drift.
  /** @type {{ path: string, text: string, value: any, source: string, sourceText: string, isDefault: boolean }[]} */
  const rows = [];
  const row = (path) => {
    const source = doc.sources[path];
    if (!all && source === "default") return null;
    const r = {
      path,
      value: doc.flat[path],
      source,
      sourceText: sourceWord(source),
      isDefault: source === "default",
      text: `\`${path}\` = ${formatKnobText(path, doc.flat[path])} · ${sourceWord(source)}`,
    };
    rows.push(r);
    return r.text;
  };
  const sections = new Map();
  for (const path of Object.keys(KNOBS)) {
    if (prefixFilter && !path.toLowerCase().startsWith(prefixFilter)) continue;
    const r = row(path);
    if (r) {
      const sec = path.split(".")[0];
      if (!sections.has(sec)) sections.set(sec, []);
      sections.get(sec).push(r);
    }
  }
  if (!sections.size)
    return {
      text: prefixFilter
        ? `No setting's name starts with \`${prefixFilter}\`. \`/settings all\` lists every setting.`
        : "Nothing is set anywhere: this session runs on the built-in defaults throughout. `/settings all` lists every setting.",
      chainId,
    };
  const title = all ? "every setting" : prefixFilter ? `\`${prefixFilter}\`` : "what is in force (not at the built-in default)";
  lines.push(`${title}:`);
  for (const [sec, rs] of sections) {
    lines.push(`**${sec}**`);
    lines.push(...rs);
  }
  lines.push("Change one: `/set <name> <value>` · return it to the layers below: `/unset <name>` · one explained: `/settings <name>` · everything: `/settings all`");
  const card = {
    kind: "settings-list",
    v: 1,
    title: all ? "All settings" : prefixFilter ? `Settings under ${prefixFilter}` : "Settings in force",
    rows: rows.map(({ path, value, source, sourceText, isDefault }) => ({
      path,
      value: value === undefined ? null : value,
      valueText: formatKnobText(path, value),
      source,
      sourceText,
      reach: reachOf(path),
      isDefault,
    })),
  };
  return { text: lines.join("\n"), chainId, card };
}

/** A layer's own value for one knob, or undefined (the layers are stored nested). @param {any} layer @param {string} path */
const valueAt = (layer, path) => flatten(layer || {})[path];

/** The source a knob falls back to once this session's own value is unset: the project's, the global's, or the
 * built-in default — the same precedence the resolver reads the layers in, so it also names the current source
 * whenever the session holds nothing of its own. @param {any} doc @param {string} path */
function sourceBelow(doc, path) {
  if (valueAt(doc.layers?.project, path) !== undefined) return "project";
  if (valueAt(doc.layers?.global, path) !== undefined) return "global";
  return "default";
}

/**
 * The stage's entry: answer the parsed command on a record of its own.
 * @param {import("../pipeline/context.js").RequestContext} ctx
 * @param {import("../deps.js").AppDeps} deps
 * @param {{ verb: "set" | "unset" | "settings", name: string, valueText: string, arg: string }} cmd
 */
export function answerSettingsCommand(ctx, deps, cmd) {
  const rec = openCommandRecord(ctx, deps, { upstream: ctx.route.upstream });
  const chainId = commandChain(ctx, deps);
  const teams = deps.teams || null;
  const named = { model: ctx.body.model, agent: ctx.agent };
  const r =
    cmd.verb === "settings"
      ? settingsListReply(deps.memory, chainId, { arg: cmd.arg })
      : settingsSetReply(deps.memory, chainId, /** @type {any} */ (cmd), { teams, named });
  // The record names its session before it is written, so the log's line and the live feed carry it.
  if (r.chainId) rec.memory = { ...(rec.memory || {}), chain: r.chainId };
  answerWith(ctx, deps, rec, r.text, {
    changes: [`settings command (${cmd.verb}) answered by Filament, upstream not called`],
    local: true,
    card: r.card,
  });
}

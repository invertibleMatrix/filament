// Generates docs/PARAMETERS.md and docs/TEMPLATES.md from the schema and template definitions.
import { writeFileSync, mkdirSync } from "node:fs";
import { CONFIG_SCHEMA, RULES, UPSTREAM, ROUTE, isLeaf } from "../src/schema.js";
import { TEMPLATES } from "../src/templates.js";
import { commandsMarkdown } from "../src/commands.js";

const code = (v) => "`" + (typeof v === "string" ? v : JSON.stringify(v)) + "`";
// A table cell's words: a `|` in them, as in `@mem off|on`, would end the cell.
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|");
function section(title, node, prefix = "") {
  let out = "";
  if (node._doc) out += `${node._doc}\n\n`;
  const rows = [];
  const walk = (n, path) => {
    for (const [k, v] of Object.entries(n)) {
      if (k === "_doc") continue;
      const p = path ? `${path}.${k}` : k;
      if (isLeaf(v)) rows.push(v.type === "rules" || (v.itemSchema) ? null : { p, v });
      else { rows.push({ heading: p, doc: v._doc }); walk(v, p); }
    }
  };
  walk(node, prefix);
  for (const r of rows) {
    if (!r) continue;
    if (r.heading) { out += `\n### ${r.heading}\n\n${r.doc || ""}\n\n| parameter | type | default | what it does | effect |\n|---|---|---|---|---|\n`; continue; }
    const opts = r.v.options ? ` (${r.v.options.map((o) => "`" + o + "`").join(", ")})` : "";
    out += `| \`${r.p}\` | ${r.v.type}${opts} | ${cell(code(r.v.default))} | ${cell(r.v.description)} | ${cell(r.v.effect)} |\n`;
  }
  return `## ${title}\n\n${out}\n`;
}

mkdirSync("docs", { recursive: true });
let params = "# Filament parameters\n\nGenerated from `src/core/schema.js` by `npm run docs`. The same text appears next to every field in the settings UI.\n\n";
params += "## Layering\n\nRules apply in three layers: **global defaults** (Rules page) → **upstream overrides** → **route overrides**. A field left unset on a layer inherits from the layer below. Every rule field below can be overridden on any layer.\n\n";
// One line per top-level section, in the schema's order. A section without a line, or a line without a section, stops
// the generator: the table never names what the config doesn't hold.
const TOP = {
  server: "listener, keys, timeouts",
  observability: "what is recorded per request",
  rules: "global request-shaping rules",
  upstreams: "places requests are forwarded to",
  routes: "model name → upstream mapping, top to bottom",
  sessions: "your session defaults, one turn at a time, a turn a restart cut off",
  agentLoop: "the `agent/<model>` loop: a model given hands and permission modes",
  memory: "the long-term memory system",
  alerts: "what the console and tray warn about",
  ui: "the harness page's own choices for this data folder: the welcome tour seen",
  telemetry: "anonymous usage statistics: on or off, the notice shown",
  experimental: "features still being tried, each off until turned on: chats named by the side model",
};
const sections = Object.keys(CONFIG_SCHEMA).filter((k) => k !== "_doc");
const unmatched = [...sections.filter((k) => !TOP[k]), ...Object.keys(TOP).filter((k) => !sections.includes(k))];
if (unmatched.length) throw new Error(`the top-level table and the config's sections differ: ${unmatched.join(", ")}`);
params += "| top-level | what |\n|---|---|\n" + sections.map((k) => `| \`${k}${CONFIG_SCHEMA[k].type === "list" ? "[]" : ""}\` | ${TOP[k]} |`).join("\n") + "\n\n";
params += section("Rules", RULES, "rules");
params += section("Server", CONFIG_SCHEMA.server, "server");
params += section("Observability", CONFIG_SCHEMA.observability, "observability");
params += section("Upstream fields", UPSTREAM, "upstreams[]");
params += section("Route fields", ROUTE, "routes[]");
if (CONFIG_SCHEMA.agentLoop) params += section("Agent loop", CONFIG_SCHEMA.agentLoop, "agentLoop");
params += section("Long-term memory", CONFIG_SCHEMA.memory, "memory");
if (CONFIG_SCHEMA.sessions) params += section("Sessions", CONFIG_SCHEMA.sessions, "sessions");
if (CONFIG_SCHEMA.alerts) params += section("Alerts", CONFIG_SCHEMA.alerts, "alerts");
if (CONFIG_SCHEMA.ui) params += section("The harness page", CONFIG_SCHEMA.ui, "ui");
if (CONFIG_SCHEMA.telemetry) params += section("Telemetry", CONFIG_SCHEMA.telemetry, "telemetry");
if (CONFIG_SCHEMA.experimental) params += section("Experimental", CONFIG_SCHEMA.experimental, "experimental");
writeFileSync("docs/PARAMETERS.md", params);

let tpl = "# Filament templates\n\nTemplates are documented presets. Applying one merges its settings into your config; upstreams and routes it adds are matched by id/match so re-applying is safe. Templates that list `requires` apply those first.\n\n";
for (const t of TEMPLATES) {
  tpl += `## ${t.name}\n\n\`${t.id}\`\n\n${t.summary}\n\n**Effects**\n\n${t.effects.map((e) => `- ${e}`).join("\n")}\n\n`;
  if (t.requires?.length) tpl += `Requires: ${t.requires.map((r) => "`" + r + "`").join(", ")}\n\n`;
  tpl += "```json\n" + JSON.stringify(t.patch, null, 2) + "\n```\n\n";
}
writeFileSync("docs/TEMPLATES.md", tpl);
writeFileSync("docs/COMMANDS.md", commandsMarkdown());
console.log("wrote docs/PARAMETERS.md, docs/TEMPLATES.md and docs/COMMANDS.md");

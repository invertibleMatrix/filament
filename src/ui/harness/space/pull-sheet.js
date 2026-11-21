// @ts-check
// Pull from… (the Space Apps plan of 10-29, decision 7, "Board pulls"): Linear, GitHub or Jira — or any connector, set up
// by hand — onto the Space's board, through a connector of the project's. The sheet picks the service, which fills what
// it reads with (its tool, args and paths, as Filament's presets guess them) and the connector whose name says it; Read
// once calls the tool — only one its server marks read-only — and shows what its answer holds: each item's key, title,
// state, link and line, and each state with the column it goes to, all the person's to change. Moves back: the tool a
// move calls in the service, with {key} and {state}, and whether it goes without asking. Save keeps it; the board reads
// it as it is shown. Nothing of the service changes here.
import { h } from "../../lib/dom.js";
import { sheet } from "../lib/ui.js";

/**
 * @typedef {{ service: string, title: string, match: string[], tool: string, args: Record<string, unknown>, rows: string,
 *   key: string, name: string, state: string, url: string, line: string, back: { tool: string, args: Record<string, unknown> } | null }} PullPreset
 * @typedef {{ ok: true, rows: string, count: number, fields: string[], key: string, name: string, state: string, url: string,
 *   line: string, states: string[], columns: Record<string, string>, sample: string } | { ok: false, error: string }} PullGuess
 */

/** The board's columns, as a state's column picks them. */
const COLUMN_PICKS = Object.freeze([
  ["planned", "Planned"],
  ["doing", "Doing"],
  ["waits", "Waits for you"],
  ["done", "Done"],
]);
/** Each path of an item the sheet picks, its label, and whether it may be none. */
const PATHS = /** @type {const} */ ([
  ["key", "Key", false],
  ["name", "Title", false],
  ["state", "State", true],
  ["url", "Link", true],
  ["line", "Line", true],
]);

/** JSON as the sheet shows it. @param {unknown} v */
const pretty = (v) => JSON.stringify(v ?? {}, null, 1);

/**
 * The sheet, open: a new pull, or the one given to change. `get` and `post`: the Space's admin API under its project
 * (a refusal thrown, in its words); `servers`: the project's connectors by name; `onSaved`: the Space as the answer
 * has it, drawn; `onRemove`: Take it off the board; `onConnectors`: the Connectors sheet.
 * @param {{ place: string, pull: import("../lib/space-view.js").PullShown | null, get: (path: string) => Promise<any>,
 *   post: (path: string, body: any) => Promise<any>, servers: () => Promise<string[]>, onSaved: (answer: any) => void,
 *   onRemove?: () => Promise<boolean>, onConnectors: () => void }} o
 */
export function pullSheet(o) {
  /** @type {{ close: () => void } | null} */
  let s = null;
  /** @type {PullPreset[]} */
  let presets = [];
  /** @type {string[]} */
  let servers = [];
  let service = o.pull?.service || "linear";
  /** What Read once found, or the pull's own paths while it changes one that was not read again. @type {PullGuess | null} */
  let found = null;

  const said = h("p", { class: "spl-said", role: "status" });
  const picks = h("div", { class: "spl-services", role: "radiogroup", "aria-label": "Service" });
  const connection = /** @type {HTMLSelectElement} */ (h("select", { class: "zc-input spl-conn", "aria-label": "Connector" }));
  const noConn = h("p", { class: "sp-quiet spl-noconn", hidden: "" });
  const tool = /** @type {HTMLInputElement} */ (h("input", { class: "zc-input spl-tool", type: "text", list: "spl-tools", placeholder: "list_issues", "aria-label": "Tool that lists" }));
  const toolList = h("datalist", { id: "spl-tools" });
  const toolSays = h("span", { class: "sp-quiet spl-tool-says" });
  const args = /** @type {HTMLTextAreaElement} */ (h("textarea", { class: "zc-input spl-args", rows: "3", spellcheck: "false", "aria-label": "Its args, as JSON" }));
  const read = /** @type {HTMLButtonElement} */ (h("button", { class: "sm spl-read", type: "button" }, "Read once"));
  const readSays = h("span", { class: "sp-quiet spl-read-says", role: "status" });
  const pathsEl = h("div", { class: "spl-paths" });
  const columnsEl = h("div", { class: "spl-columns" });
  const backTool = /** @type {HTMLInputElement} */ (h("input", { class: "zc-input spl-back-tool", type: "text", list: "spl-tools", placeholder: "update_issue — none keeps moves on this board", "aria-label": "Tool a move calls" }));
  const backArgs = /** @type {HTMLTextAreaElement} */ (h("textarea", { class: "zc-input spl-back-args", rows: "2", spellcheck: "false", "aria-label": "A move's args, as JSON" }));
  const always = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", class: "spl-always" }));
  const title = /** @type {HTMLInputElement} */ (h("input", { class: "zc-input spl-title", type: "text", maxlength: "60", "aria-label": "What its cards say they are from" }));
  const save = /** @type {HTMLButtonElement} */ (h("button", { class: "sm primary spl-save", type: "button" }, o.pull ? "Save" : "Pull onto the board"));
  /** The path each item's part is read at. @type {Record<string, HTMLSelectElement>} */
  const pathPick = {};
  /** The column each state goes to. @type {Map<string, HTMLSelectElement>} */
  const columnPick = new Map();

  /** The args a box holds, or the refusal in words. @param {HTMLTextAreaElement} box @param {string} what */
  const json = (box, what) => {
    try {
      const v = box.value.trim() ? JSON.parse(box.value) : {};
      return v && typeof v === "object" && !Array.isArray(v) ? { ok: true, v } : { ok: false, error: `${what} are a JSON object` };
    } catch {
      return { ok: false, error: `${what} are no JSON: ${box.value.trim().slice(0, 40)}` };
    }
  };

  /** The services, the one picked pressed. */
  function paintPicks() {
    picks.replaceChildren(...presets.map((p) =>
      h("button", { class: `snew-starter spl-service${p.service === service ? " is-on" : ""}`, type: "button", role: "radio", "aria-checked": String(p.service === service), "data-service": p.service, onclick: () => pickService(p.service) },
        h("b", { class: "snew-starter-t" }, p.title || "Other"),
        h("span", { class: "sp-quiet snew-starter-s" }, p.service === "other" ? "any connector, set up by hand" : p.back ? "moves go back, when you say so" : "moves stay on this board"))));
  }

  /** The connectors, the one whose name says the service first picked. @param {string} [want] */
  function paintConnections(want) {
    const preset = presets.find((p) => p.service === service);
    const guess = want || servers.find((n) => (preset?.match || []).some((m) => n.toLowerCase().includes(m))) || connection.value || servers[0] || "";
    connection.replaceChildren(...servers.map((n) => h("option", { value: n, ...(n === guess ? { selected: "" } : {}) }, n)));
    const none = !servers.length || (!!preset?.match.length && !servers.some((n) => preset.match.some((m) => n.toLowerCase().includes(m))) && !want);
    noConn.hidden = !none;
    noConn.replaceChildren(
      servers.length ? `No connector of ${o.place} is named like ${preset?.title || "it"}: pick the one that reaches it, or add one. ` : `${o.place} has no connector yet: add the one that reaches ${preset?.title || "the service"}. `,
      h("button", { class: "ghost sm", type: "button", onclick: () => { s?.close(); o.onConnectors(); } }, "Connectors ›"));
    void paintTools();
  }

  /** The connector's tools, read-only ones offered; what the tool named is, said. */
  async function paintTools() {
    const conn = connection.value;
    toolList.replaceChildren();
    toolSays.textContent = "";
    if (!conn) return;
    try {
      const got = await o.get(`/pulls/tools?connection=${encodeURIComponent(conn)}`);
      if (conn !== connection.value) return;
      if (!got.ok) return void (toolSays.textContent = got.error);
      const tools = /** @type {{ name: string, readOnly: boolean, description: string }[]} */ (got.tools);
      toolList.replaceChildren(...tools.map((t) => h("option", { value: t.name }, `${t.readOnly ? "reads" : "acts"} — ${t.description}`)));
      const sayTool = () => {
        const t = tools.find((x) => x.name === tool.value.trim());
        toolSays.textContent = !tool.value.trim() ? "" : !t ? `${conn} has no tool ${tool.value.trim()}` : t.readOnly ? "only reads, its server says" : "its server does not say it only reads: a pull will not call it";
      };
      tool.oninput = sayTool;
      sayTool();
    } catch (e) {
      toolSays.textContent = String(/** @type {any} */ (e)?.message || e);
    }
  }

  /** A service picked: its preset fills what it reads with, its connector is picked. @param {string} svc */
  function pickService(svc) {
    service = svc;
    const p = presets.find((x) => x.service === svc);
    if (p) {
      tool.value = p.tool;
      args.value = pretty(p.args);
      backTool.value = p.back?.tool || "";
      backArgs.value = p.back ? pretty(p.back.args) : "";
      title.value = p.title;
    }
    found = null;
    paintPicks();
    paintConnections();
    paintFound();
  }

  /** What Read once found: each part's path, each state's column, the move back's part. */
  function paintFound() {
    const g = found && found.ok ? found : null;
    pathsEl.replaceChildren();
    columnsEl.replaceChildren();
    for (const k of Object.keys(pathPick)) delete pathPick[k];
    columnPick.clear();
    save.disabled = !g;
    if (!g) return void pathsEl.append(h("p", { class: "sp-quiet spl-before" }, "Read once fills these from what its answer holds: each item's key, title, state, link and line, and each state's column."));
    for (const [k, label, may] of PATHS) {
      const fields = [...new Set([...(g[k] ? [g[k]] : []), ...g.fields])];
      const sel = /** @type {HTMLSelectElement} */ (h("select", { class: "zc-input spl-path", "data-path": k, "aria-label": label },
        ...(may ? [h("option", { value: "" }, "none")] : []),
        ...fields.map((f) => h("option", { value: f, ...(f === g[k] ? { selected: "" } : {}) }, f))));
      if (k === "state") sel.addEventListener("change", () => paintColumns(g.states));
      pathPick[k] = sel;
      pathsEl.append(h("label", { class: "spl-path-row" }, h("span", { class: "spl-path-k" }, label), sel));
    }
    paintColumns(g.states);
  }

  /** Each state the answer says, with the column it goes to. @param {string[]} states */
  function paintColumns(states) {
    columnsEl.replaceChildren();
    columnPick.clear();
    const g = found && found.ok ? found : null;
    if (!g || !pathPick.state?.value) return void columnsEl.append(h("p", { class: "sp-quiet" }, "No state: every card stands in Planned."));
    if (pathPick.state.value !== g.state) return void columnsEl.append(h("p", { class: "sp-quiet" }, "Read once again to see the states this path says."));
    if (!states.length) return void columnsEl.append(h("p", { class: "sp-quiet" }, "Its items say no state yet."));
    for (const st of states) {
      const sel = /** @type {HTMLSelectElement} */ (h("select", { class: "zc-input spl-col", "aria-label": `${st} goes to` },
        ...COLUMN_PICKS.map(([v, w]) => h("option", { value: v, ...(g.columns[st] === v ? { selected: "" } : {}) }, w))));
      columnPick.set(st, sel);
      columnsEl.append(h("label", { class: "spl-col-row" }, h("span", { class: "spl-col-k" }, st), h("span", { class: "spl-col-to" }, "→"), sel));
    }
  }

  /** Read once: the tool called as the pull would call it, and what its answer holds. */
  async function readOnce() {
    const a = json(args, "Its args");
    if (!a.ok) return void (readSays.textContent = a.error);
    read.disabled = true;
    readSays.textContent = "Reading…";
    try {
      const was = found && found.ok ? found : null;
      // Read again, the paths and columns picked stand where its answer still has them.
      const paths = was ? { rows: was.rows, ...Object.fromEntries(PATHS.map(([k]) => [k, pathPick[k]?.value ?? was[k]])) } : undefined;
      const g = /** @type {PullGuess} */ (await o.post("/pulls/try", { service, connection: connection.value, tool: tool.value, args: a.v, ...(paths ? { paths } : {}) }));
      if (!g.ok) {
        readSays.textContent = g.error;
        return;
      }
      if (was) for (const [st, sel] of columnPick) if (g.states.includes(st)) g.columns[st] = sel.value;
      found = g;
      readSays.textContent = g.count ? `Read ${g.count} item${g.count === 1 ? "" : "s"}${g.rows ? ` at ${g.rows}` : ""}.` : "It answered an empty list: nothing to pull now, but its parts can be set once it has items.";
      paintFound();
    } catch (e) {
      readSays.textContent = String(/** @type {any} */ (e)?.message || e);
    } finally {
      read.disabled = false;
    }
  }

  /** Save: the pull as the sheet says it, kept. */
  async function doSave() {
    const g = found && found.ok ? found : null;
    if (!g) return;
    const a = json(args, "Its args");
    if (!a.ok) return void (said.textContent = a.error);
    /** @type {any} */
    let back = null;
    if (backTool.value.trim()) {
      const b = json(backArgs, "A move's args");
      if (!b.ok) return void (said.textContent = b.error);
      back = { tool: backTool.value.trim(), args: b.v };
    }
    const body = {
      ...(o.pull ? { id: o.pull.id } : {}),
      service,
      title: title.value.trim(),
      connection: connection.value,
      tool: tool.value.trim(),
      args: a.v,
      rows: g.rows,
      ...Object.fromEntries(PATHS.map(([k]) => [k, pathPick[k]?.value ?? ""])),
      columns: Object.fromEntries([...columnPick].map(([st, sel]) => [st, sel.value])),
      back,
      always: !!back && always.checked,
    };
    save.disabled = true;
    said.textContent = "";
    try {
      const got = await o.post("/pulls", body);
      s?.close();
      o.onSaved(got);
    } catch (e) {
      said.textContent = String(/** @type {any} */ (e)?.message || e);
      save.disabled = false;
    }
  }

  connection.addEventListener("change", () => { found = null; paintFound(); void paintTools(); });
  read.addEventListener("click", () => void readOnce());
  save.addEventListener("click", () => void doSave());

  let removing = false;
  const remove = h("button", { class: "ghost sm spl-remove", type: "button", onclick: async () => {
    if (!o.onRemove) return;
    if (!removing) { removing = true; remove.replaceChildren("Take it off the board?"); remove.classList.add("is-sure"); return; }
    if (await o.onRemove()) s?.close();
  } }, "Take it off the board");

  const body = h("div", { class: "spl-body" },
    picks,
    h("h4", { class: "sdb-keep-h" }, "What it reads"),
    h("label", { class: "spl-row" }, h("span", { class: "spl-k" }, "Through"), connection),
    noConn,
    h("label", { class: "spl-row" }, h("span", { class: "spl-k" }, "Tool"), tool, toolList),
    toolSays,
    h("label", { class: "spl-row spl-row-top" }, h("span", { class: "spl-k" }, "Args"), args),
    h("div", { class: "spl-row" }, h("span", { class: "spl-k" }), read, readSays),
    h("h4", { class: "sdb-keep-h" }, "Each item"),
    pathsEl,
    h("h4", { class: "sdb-keep-h" }, "Columns"),
    columnsEl,
    h("h4", { class: "sdb-keep-h" }, "Moves back"),
    h("p", { class: "sp-quiet" }, "A card you move asks first whether it moves in the service too; the service wins when it says another state. {key} is the card's key, {state} the state its column maps from, {owner} any of the args above."),
    h("label", { class: "spl-row" }, h("span", { class: "spl-k" }, "Tool"), backTool),
    h("label", { class: "spl-row spl-row-top" }, h("span", { class: "spl-k" }, "Args"), backArgs),
    h("label", { class: "spl-row spl-always-row" }, h("span", { class: "spl-k" }), always, "Moves go back without asking"),
    h("h4", { class: "sdb-keep-h" }, "Its cards say"),
    h("label", { class: "spl-row" }, h("span", { class: "spl-k" }, "From"), title),
    said);
  const foot = h("div", { class: "sdb-keep-foot" },
    ...(o.pull && o.onRemove ? [remove] : []),
    h("span", { class: "sb-sp" }),
    h("button", { class: "ghost sm", type: "button", onclick: () => s?.close() }, "Cancel"),
    save);
  s = sheet({ label: "Pull from", class: "sdb-keep-sheet spl-sheet", head: h("b", { class: "sp-sheet-title" }, o.pull ? `${o.pull.title} on ${o.place}'s board` : `Pull onto ${o.place}'s board`), body, foot });
  save.disabled = true;

  void Promise.all([o.get("/pulls/presets").then((r) => /** @type {PullPreset[]} */ (r.presets)), o.servers()]).then(([ps, sv]) => {
    presets = ps;
    servers = sv;
    if (o.pull) {
      const p = o.pull;
      tool.value = p.tool;
      args.value = pretty(p.args);
      backTool.value = p.back?.tool || "";
      backArgs.value = p.back ? pretty(p.back.args) : "";
      always.checked = p.always;
      title.value = p.title;
      if (!servers.includes(p.connection)) servers = [p.connection, ...servers];
      // Its own paths and columns stand until Read once reads again.
      found = { ok: true, rows: p.rows, count: 0, fields: [p.key, p.name, p.state, p.url, p.line].filter(Boolean), key: p.key, name: p.name, state: p.state, url: p.url, line: p.line, states: Object.keys(p.columns), columns: { ...p.columns }, sample: "" };
      readSays.textContent = "Read once reads it again, with what its answer has now.";
      paintPicks();
      paintConnections(p.connection);
      paintFound();
    } else pickService(service);
  }).catch((e) => void (said.textContent = String(e?.message || e)));
  return s;
}

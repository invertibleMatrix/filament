// @ts-check
// Library › Agents and teams on the fake DOM, over a thin stand-in for the admin routes with the real card store and
// the real team store behind them, as the server wires the two: a card a team uses cannot go, and who uses a card
// follows the teams. Every call is recorded. agents-page.test.js drives the cards and How to use them with it,
// teams-page.test.js the teams and the teams your agent may use (U13, one page).
import { renderLibraryAgents } from "../../src/ui/harness/library/agents.js";
import { CARD_MAY, CARD_VIEWS, CARD_CHANGES, CARD_LIMITS, CARD_TOOLS, OWN_WORKERS } from "../../src/services/agent-cards.js";
import { TEAM_LIMITS } from "../../src/services/teams.js";
import { SUBAGENT_STARTS } from "../../src/services/subagent-starts.js";
import { AGENT_TEAMS, agentTeamsOf } from "../../src/services/session-settings.js";
import { fakeH, textOf, buttonsOf } from "./fake-dom.js";
import { modelSelects } from "./team-view.js";
import { teamStore } from "./team.js";

/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
export const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** Every node under `n` wearing a class. @param {any} n @param {string} cls */
export const every = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls) || !!x.classList?.contains?.(cls));
/** The first. @param {any} n @param {string} cls */
export const one = (n, cls) => every(n, cls)[0];
/** The button under `n` whose words are these. @param {any} n @param {string} words */
export const btn = (n, words) => buttonsOf(n).find((b) => textOf(b) === words);
/** A field, by its label. @param {any} n @param {string} label */
export const field = (n, label) => all(n, (x) => ["input", "textarea", "select"].includes(x.tag) && x.attrs?.["aria-label"] === label)[0];
/** Type into a field as a person does. @param {any} f @param {string} value */
export const type = (f, value) => {
  f.value = value;
  f.dispatch("input", { target: f });
};
/** Pick an option of a select as a person does. @param {any} f @param {string} value */
export const pick = (f, value) => {
  f.value = value;
  f.dispatch("change", { target: f });
};
export const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
};

/**
 * The page on the fake DOM. `saved`: your agents to start with; `teams`: your teams to start with; `refuse(method,
 * path, body)`: an answer in words that refuses a call instead; `confirm`: the sheet's answer; `start`: what the page
 * opens on; `ask`: the tags ticked to start with; `problems`: why a model cannot run an agent now, by the model's
 * name; `pool`: the list as stored; `most`: the chat's number as set; `slots`: each model's number, as
 * `GET /api/subagents/slots` answers it;
 * `agentTeams`: the list of the teams your agent may start by itself, as the config saves it; `failRead`, `failTeams`: the read that fails until `heal`;
 * `hold(method, path)`: a promise a write waits on before it answers; `acts`: the page's head, where its New… buttons go, else a bar in the page; `dataDir`: the
 * folder the stores read their files from — an agents file of the test's own — else none; `copyRefused`: the
 * clipboard's refusal, in words, for every copy, else each copy is taken and recorded.
 * @param {{ saved?: any[], teams?: any[], refuse?: (method: string, path: string, body: any) => any, confirm?: boolean, start?: string,
 *   failRead?: boolean, failTeams?: boolean, ask?: string[], problems?: Record<string, string>, pool?: { model: string, seats?: number }[],
 *   most?: number | null, agentTeams?: string[],
 *   hold?: (method: string, path: string) => Promise<void> | null, slots?: any[],
 *   acts?: any, dataDir?: string, copyRefused?: string }} [o]
 */
export async function openAgents(o = {}) {
  const teams = teamStore({ dataDir: o.dataDir ?? null, now: () => 1 });
  const cardStore = teams.cards;
  for (const c of o.saved || []) cardStore.create(c);
  for (const t of o.teams || []) teams.create(t);
  let failRead = !!o.failRead;
  let failTeams = !!o.failTeams;
  let pool = o.pool ?? [{ model: "", seats: 4 }];
  let most = o.most ?? null;
  /** The chat's number in force, as the server reads it (U13-D15): the one set, else what the old counts add up to, else 4. */
  const mostOf = (/** @type {number | null} */ m, /** @type {any[]} */ rows) =>
    (Number.isInteger(m) && Number(m) >= 1 && Number(m) <= 32 ? Number(m) : Math.min(32, rows.reduce((n, r) => n + (r.seats || 0), 0)) || 4);
  let agentTeams = [...(o.agentTeams ?? AGENT_TEAMS)];
  /** Your teams held, as the routes answer them: each with what its editor opens on. */
  const heldTeams = () => teams.held().map((h) => ({ ...h, team: teams.heldTeam(h.key) }));
  /** The teams your agent may start by itself as the routes answer them: the list as a fire reads it. */
  const inForce = () => agentTeamsOf({ subagents: { teams: agentTeams } }, (k) => teams.find(k)?.key ?? null);
  /** A list as a launch reads it, as the route answers it: a row with no seats holds a row's most (U13-D12). @param {any[]} rows */
  const filled = (rows) => rows.map((r) => ({ model: r.model, seats: r.seats ?? 32 }));
  /** @type {[string, string, any][]} */
  const calls = [];
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  /** @type {any[]} */
  const sheets = [];
  let changed = 0;
  const saved = () => cardStore.list().filter((c) => !c.shipped);
  const savedTeams = () => teams.list().filter((t) => !t.shipped);
  /**
   * As the list's route says it: each card none of whose models can run an agent now, with why (each one's, of a
   * list), and each whose first cannot while another can — the one it runs on meanwhile, and those passed.
   */
  const modelsNow = () => {
    /** @type {Record<string, string>} */
    const problems = {};
    /** @type {Record<string, { model: string, passed: { model: string, why: string }[] }>} */
    const fallbacks = {};
    for (const c of cardStore.list()) {
      const whys = c.models.map((m) => ({ model: m, why: o.problems?.[m] ?? null }));
      const at = whys.findIndex((w) => !w.why);
      if (whys.length && at < 0) problems[c.tag] = whys.length === 1 ? String(whys[0].why) : whys.map((w) => `${w.model}: ${w.why}`).join("; ");
      else if (at > 0) fallbacks[c.tag] = { model: c.models[at], passed: whys.slice(0, at).map((w) => ({ model: w.model, why: String(w.why) })) };
    }
    return { problems, fallbacks };
  };
  /** Who uses each card, as the list's route says it. */
  const usedBy = () => {
    /** @type {Record<string, { teams: any[], starts: any[] }>} */
    const out = {};
    const of = (/** @type {string} */ tag) => (out[tag] ??= { teams: [], starts: [] });
    for (const c of cardStore.list()) for (const u of teams.usedBy(c.tag)) of(c.tag).teams.push({ key: u.key, name: u.name, as: u.as, words: !!u.line.trim() });
    for (const s of Object.values(SUBAGENT_STARTS)) of(s.worker).starts.push({ id: s.id, name: s.name });
    return out;
  };
  let ask = [...(o.ask || [])];
  /** How many at once (team_v2_plan TV2-D8), as the route answers it: a line a write names is set, or given back. */
  const slots = { default: 4, most: 64, rows: /** @type {any[]} */ ([...(o.slots || [])]) };
  /**
   * The view as the route answers it: a line the list's rows reach says so (U13-D15), and each model the list names has
   * a line, where its name lands — the stand-in's source, as its seats say —, whatever its number.
   */
  const slotsView = () => {
    const rows = slots.rows.map((l) => ({ ...structuredClone(l), onList: pool.some((r) => !!r.model && (r.model === l.name || r.model === l.model)) }));
    for (const r of pool)
      if (r.model && !rows.some((l) => l.name === r.model || l.model === r.model))
        rows.push({ upstream: "zai", source: "zai", model: r.model, name: r.model, set: null, cap: slots.default, lowered: null, running: 0, waiting: 0, whom: [], onList: true });
    return { ...structuredClone(slots), rows };
  };
  const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
    const method = init.method || "GET";
    calls.push([method, path, init.body]);
    await o.hold?.(method, path);
    const no = o.refuse?.(method, path, init.body);
    if (no) throw Object.assign(new Error(no.error), { status: no.status, body: no });
    try {
      if (method === "GET" && path === "/agents") {
        if (failRead) throw Object.assign(new Error("Filament is not answering"), { status: 0 });
        return { shipped: cardStore.list().filter((c) => c.shipped), saved: saved(), held: cardStore.held(), ask: [...ask], always: [...OWN_WORKERS], usedBy: usedBy(), ...modelsNow(), may: [...CARD_MAY], views: [...CARD_VIEWS], changes: [...CARD_CHANGES], tools: [...CARD_TOOLS], limits: CARD_LIMITS };
      }
      if (method === "GET" && path === "/teams") {
        if (failTeams) throw Object.assign(new Error("Filament is not answering"), { status: 0 });
        return { shipped: teams.list().filter((t) => t.shipped), saved: savedTeams(), held: heldTeams(), limits: TEAM_LIMITS, pool: filled(pool), poolRows: pool, most, mostIn: mostOf(most, pool), agentTeams: inForce() };
      }
      const checked = /^\/subagents\/model-problem\?model=(.+)$/.exec(path)?.[1];
      if (method === "GET" && checked) return { model: decodeURIComponent(checked), problem: o.problems?.[decodeURIComponent(checked)] ?? null };
      if (method === "PUT" && path === "/subagents/ask") {
        ask = [...init.body.tags];
        return { ok: true, ask: [...ask] };
      }
      if (method === "POST" && path === "/subagents/seats") {
        // Each row as a launch reads it: a named one where its name lands at the stand-in's source, with its number.
        const rows = /** @type {any[]} */ (init.body.pool);
        return { total: 4, seats: rows.map((r) => {
          const at = slots.rows.find((l) => l.name === r.model || l.model === r.model);
          const shared = r.model ? { key: `zai ${r.model}`, upstream: at?.upstream || "zai", model: at?.model || r.model, cap: at?.cap ?? slots.default, running: at?.running ?? 0, set: at?.set ?? null } : null;
          return { model: r.model, named: !!r.model, own: !r.model, seats: 32, lent: 32, running: 0, problem: null, lends: "", shared };
        }) };
      }
      if (method === "PUT" && path === "/subagents/teams") {
        const unknown = init.body.teams.filter((/** @type {string} */ k) => !teams.list().some((t) => t.key === k));
        if (unknown.length) throw Object.assign(new Error(`no team answers to ${unknown.join(", ")}`), { status: 400 });
        agentTeams = [...init.body.teams];
        return { ok: true, agentTeams: [...agentTeams] };
      }
      if (method === "GET" && path === "/models?all=1") return { models: [{ id: "glm-5.3" }, { id: "grok-4.6" }] };
      if (method === "GET" && path === "/subagents/slots") return slotsView();
      if (method === "PUT" && path === "/subagents/slots") {
        const b = init.body;
        const upstream = b.upstream || "zai";
        const model = b.model || b.name;
        const had = slots.rows.find((r) => r.upstream === upstream && r.model === model);
        const row = had || { upstream, source: upstream, model, name: model, set: null, cap: slots.default, lowered: null, running: 0, waiting: 0, whom: [] };
        row.set = b.n;
        row.cap = b.n ?? slots.default;
        if (!had) slots.rows.push(row);
        return { ok: true, ...slotsView() };
      }
      if (method === "POST" && path === "/agents") return { ok: true, agent: cardStore.create(init.body), saved: saved(), held: cardStore.held(), ...modelsNow() };
      const tag = /^\/agents\/([^/]+)$/.exec(path)?.[1];
      if (tag && method === "PUT") {
        const agent = cardStore.update(decodeURIComponent(tag), init.body);
        return { ok: true, agent, ...(agent.shipped ? { shipped: cardStore.list().filter((c) => c.shipped) } : {}), saved: saved(), ...modelsNow() };
      }
      if (tag && method === "DELETE") {
        const gone = cardStore.remove(decodeURIComponent(tag));
        if (!("kept" in gone)) ask = ask.filter((t) => t !== gone.tag);
        return { ok: true, removed: gone.tag, saved: saved(), held: cardStore.held(), ask: [...ask], ...modelsNow() };
      }
      if (method === "POST" && path === "/teams") return { ok: true, team: teams.create(init.body), saved: savedTeams(), agentTeams: inForce() };
      const key = /^\/teams\/([^/]+)$/.exec(path)?.[1];
      if (key && method === "PUT") return { ok: true, team: teams.update(decodeURIComponent(key), init.body), saved: savedTeams(), held: heldTeams(), agentTeams: inForce() };
      if (key && method === "DELETE") return { ok: true, removed: teams.remove(decodeURIComponent(key)).key, saved: savedTeams(), held: heldTeams(), agentTeams: inForce() };
    } catch (/** @type {any} */ e) {
      throw Object.assign(new Error(e.message), { status: e.status, body: { error: e.message } });
    }
    throw Object.assign(new Error(`no route ${method} ${path}`), { status: 404, body: {} });
  };
  const pickers = modelSelects();
  const confirm = async (/** @type {any} */ d) => {
    sheets.push(d);
    return o.confirm ?? true;
  };
  /**
   * The editors' sheet (editor-sheet.js) as lib/ui.js's dialog opens it: its tile, title and line over its body, its
   * guard asked on a close that is not forced — Esc, × —, gone from the list once closed.
   * @type {{ o: any, el: any, closed: boolean, close: (force?: boolean) => void }[]}
   */
  const dialogs = [];
  const dialog = (/** @type {any} */ d) => {
    const el = fakeH("div", { class: "zc-dialog", role: "dialog", "aria-label": d.title },
      d.glyph || null, fakeH("h2", { class: "zc-dialog-title" }, d.title), d.description ? fakeH("p", { class: "zc-dialog-desc" }, d.description) : null, d.body);
    /** @type {{ o: any, el: any, closed: boolean, close: (force?: boolean) => void }} */
    const self = {
      o: d,
      el,
      closed: false,
      close: (force = false) => {
        if (self.closed || (!force && d.guard && !d.guard())) return;
        self.closed = true;
        dialogs.splice(dialogs.indexOf(self), 1);
        d.onClose?.();
      },
    };
    dialogs.push(self);
    return self;
  };
  const body = /** @type {any} */ (fakeH("div", {}));
  /** The menus an effort chip opened, newest last: each its items. @type {any[][]} */
  const menus = [];
  const menu = (/** @type {any[]} */ items) => void menus.push(items);
  /** What the clipboard was given, in order. @type {string[]} */
  const copied = [];
  const copy = async (/** @type {string} */ text) => {
    if (o.copyRefused) throw new Error(o.copyRefused);
    copied.push(text);
  };
  const page = renderLibraryAgents(body, { onToast: (msg, kind) => toasts.push([msg, kind]), onChanged: () => { changed++; }, start: o.start, acts: o.acts || null }, { h: /** @type {any} */ (fakeH), api, modelSelect: /** @type {any} */ (pickers.make), confirm, dialog: /** @type {any} */ (dialog), menu: /** @type {any} */ (menu), copy });
  await settle();
  return {
    body, calls, toasts, sheets, pickers, store: cardStore, teams, page, dialogs, menus, copied,
    /** The editor's sheet open, whole — its title, its parts, its foot — or undefined. */
    editor: () => dialogs.at(-1)?.el,
    /** The open editor's title. */
    title: () => textOf(one(dialogs.at(-1)?.el, "zc-dialog-title")),
    /** The open editor's sheet closed the way Esc and × close it: asked first where something changed. */
    dismiss: () => dialogs.at(-1)?.close(),
    changed: () => changed,
    /** What the page changed: every call but a read — the seats asked of the server are one, though posted. */
    writes: () => calls.filter(([m, path]) => m !== "GET" && path !== "/subagents/seats"),
    heal: () => { failRead = false; failTeams = false; },
    /** The model picker standing under a node — the open editor's, say: the seats' rows have pickers of their own. @param {any} n */
    chipIn: (n) => pickers.made.findLast((c) => all(n, (x) => x === c.el).length > 0),
    /** The Teams part's pods. */
    groups: () => one(body, "aset-groups"),
    /** Each model, across all your chats: every model's number, the list's models first. */
    others: () => one(body, "lib-others"),
    /** Models for agents. */
    models: () => one(body, "lib-models"),
    /** A part of the page by its name: Teams, Advisors, Doers, On their own. @param {string} name */
    part: (name) => all(body, (x) => x.tag === "section" && x.attrs?.["aria-label"] === name)[0],
    /** A team's pod. @param {string} key */
    team: (key) => all(body, (x) => x.attrs?.["data-key"] === key)[0],
    /** Where a team's table stands: its pod — or the table a pod names it shows (`data-key-shown`). @param {string} key */
    table: (key) => all(body, (x) => x.attrs?.["data-key-shown"] === key)[0] || all(body, (x) => x.attrs?.["data-key"] === key)[0],
    /** A seat at a team's table, by its card's tag. @param {string} key @param {string} tag */
    seat: (key, tag) => all(all(body, (x) => x.attrs?.["data-key-shown"] === key)[0] || all(body, (x) => x.attrs?.["data-key"] === key)[0], (x) => x.attrs?.["data-seat"] === tag)[0],
  };
}

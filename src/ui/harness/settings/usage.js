// @ts-check
// The Usage stats section (§5.10; the owner's of 11-12): the whole breakdown of a chosen range — today, the last 7 or
// 30 days, all time — from one read of `GET /usage/breakdown`: the totals with paid, covered by plans and at list
// price said apart, the bars by day for a chosen measure, by account, by model, the cache and what it saved, speed and
// reliability, the hours, who asked. Then memory's own calls (`GET /memory/usage`) and the tools the runs' events name
// (the newest 50 runs at most, said on their line), each read apart and failing in its own section. Every number is
// the server's or a sum of its rows; the words and the figures are lib/usage-view.js's, and this draws them. The
// frames stand before the read lands, and a range change keeps what is drawn until its read does.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { ICONS } from "../lib/icons.js";
import { button, pills } from "../lib/ui.js";
import {
  MEASURES,
  RANGES,
  accountRows,
  breakdownPath,
  cacheView,
  csvPath,
  dayBars,
  daySlots,
  dayStart,
  dayWords,
  emptyWords,
  hourBars,
  keptTip,
  keptWords,
  measureFor,
  memoryPath,
  memoryView,
  modelRows,
  spanWords,
  speedView,
  toolsView,
  totalsView,
  whoView,
} from "../lib/usage-view.js";

/** The runs whose events are read for the tools, the newest of the range: a page of events a run. */
const TOOL_RUNS = 50;

/** Where a section's numbers come from, under its head; the sections whose line names their days write their own. */
const SOURCES = Object.freeze({
  time: "One bar a day, by this computer's calendar. A day with no call stays empty.",
  accounts: "The same calls by the account they ran on, the biggest by tokens first. Tokens are input, cache and output together. A row opens to its models.",
  models: "The same calls by the model that answered, as its provider names it, whatever account ran it. Input is new, read from cache and written to cache together. A row opens to the rest.",
  cache: "Input tokens by how they were sent. The saving is worked out as this page is read: nothing of it is kept.",
  speed: "Averages over the calls that reported the figure: a call that never streamed has no speed.",
  hours: "Calls by the hour they began, on the clock of the computer Filament runs on.",
  who: "A client is the tool that began a turn; a project is the folder its chat works in.",
  memory: "Memory's model calls — learning from a chat, naming it, compacting — over the same days, kept apart in memory-usage.json. They are in none of the figures above.",
  tools: "Counted from the runs' own events, which are kept apart from the daily record and go back less far.",
});

/** The CSV, saved under the name the server gives it. @param {string} path  the admin API's */
async function saveCsv(path) {
  const r = await fetch(`/api${path}`, { headers: { "x-filament-ui": "1" } });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || r.statusText);
  const file = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") || "")?.[1] || "filament-usage.csv";
  const url = URL.createObjectURL(await r.blob());
  const link = h("a", { href: url, download: file, class: "hidden" });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** An error's own words, as the server said them. @param {unknown} e */
const wordsOf = (e) => String(/** @type {any} */ (e)?.message || e);

/** @param {{ key: string, label: string, value: string, line: string }} t */
const tile = (t) =>
  h("div", { class: "set-tile", "data-key": t.key },
    h("div", { class: "set-tile-label" }, t.label),
    h("div", { class: "set-tile-value" }, t.value),
    h("div", { class: "set-tile-line" }, t.line));

/**
 * Bars as one picture with its own sentence: a bar a slot, its parts stacked from the baseline, its tip the slot and
 * its figure. Past 60 bars the gaps narrow, past 120 they close.
 * @param {{ tip: string, parts: { key: string, pct: number }[] }[]} bars @param {string} label @param {string} [cls]
 */
function barChart(bars, label, cls = "") {
  const density = bars.length > 120 ? " is-packed" : bars.length > 60 ? " is-dense" : "";
  return h("div", { class: `uset-chart${density}${cls}`, role: "img", "aria-label": label },
    ...bars.map((b) => h("div", { class: "uset-bar", title: b.tip }, ...b.parts.map((p) => h("span", { class: `uset-seg is-${p.key}`, style: `height:${p.pct}%` })))));
}

/** A figure's cell. @param {string} text */
const num = (text) => h("td", { class: "uset-num" }, text);
/** The list price's cell, the plan's part of it marked. @param {{ list: string, plan: string }} c */
const listCell = (c) => h("td", { class: "uset-num" }, c.list, c.plan ? h("span", { class: "uset-plan" }, c.plan) : null);
/** A thin bar for a share of the whole. @param {number} part  0 to 1 @param {string} [title] */
const shareBar = (part, title) => h("div", { class: "uset-share", ...(title ? { title } : {}) }, h("span", { class: "uset-share-fill", style: `width:${Math.round(part * 1000) / 10}%` }));

/**
 * A real table: its column heads — the first names the rows, the rest are figures — and its rows. It sits in a box of
 * its own and says how many figures a row has, so in a column too narrow for them the names keep their room and the
 * table scrolls sideways there: no column is dropped.
 * @param {string[]} heads @param {any[]} rows  `tr`s @param {string} [wide]  the head of a column that needs more room
 */
function table(heads, rows, wide = "At list price") {
  return h("div", { class: "uset-scroll" },
    h("table", { class: `uset-table is-figs-${heads.length - 1}` },
      h("thead", {}, h("tr", {}, ...heads.map((t, i) => h("th", { scope: "col", ...(i ? { class: t === wide ? "uset-num uset-wide" : "uset-num" } : {}) }, t)))),
      h("tbody", {}, ...rows)));
}

let opened = 0;
/**
 * A row's disclosure: a button, reached and pressed by the keyboard as any, that says whether the rows under it are
 * open and names them.
 * @param {string} label @param {any[]} under  the rows it opens, put away until then
 */
function opener(label, under) {
  for (const tr of under) {
    tr.setAttribute("id", `uset-under-${++opened}`);
    tr.setAttribute("hidden", "");
  }
  const b = h("button", {
    class: "uset-open",
    type: "button",
    "aria-expanded": "false",
    "aria-controls": under.map((tr) => tr.getAttribute("id")).join(" "),
    onclick: () => {
      const open = b.getAttribute("aria-expanded") !== "true";
      b.setAttribute("aria-expanded", open ? "true" : "false");
      for (const tr of under) tr.toggleAttribute("hidden", !open);
    },
  }, h("span", { class: "uset-chev", html: ICONS.chevronRight, "aria-hidden": "true" }), h("span", { class: "uset-open-label" }, label));
  return b;
}

/**
 * @param {HTMLElement} body
 * @param {{ onToast?: (msg: string, kind?: string) => void }} [cb]
 * @param {{ api?: (path: string) => Promise<any>, download?: (path: string) => Promise<void> }} [io]  the admin API and
 *   the CSV's save (a test's stand-ins)
 */
export function renderUsage(body, cb = {}, io = {}) {
  const call = io.api || api;
  const download = io.download || saveCsv;
  /** The range the pills say. */
  let range = "7d";
  /** The answer that is drawn, and the range it was read for. @type {any} */
  let drawn = null;
  let drawnRange = "";
  /** Each read's number: an answer that lands after a newer read began is not drawn. */
  let reads = 0;
  /** The measure the person chose for the bars by day; until then each range opens on its own. @type {string | null} */
  let chosen = null;

  /** @param {string} name @param {string} title @param {string} [source] @param {any} [beside]  what stands at the head's end */
  const section = (name, title, source = "", beside = null) => {
    const src = h("p", { class: "uset-src" }, source);
    const inner = h("div", { class: "uset-body" });
    const el = h("section", { class: "uset-sec", "data-sec": name },
      h("div", { class: "uset-h-row" }, h("h3", { class: "uset-h" }, title), beside ? h("span", { class: "grow" }) : null, beside),
      src,
      inner);
    return { el, src, body: inner };
  };

  const rangePills = pills(RANGES.map((r) => ({ id: r.id, label: r.label })), { active: range, onChange: (id) => load(id) });
  rangePills.el.setAttribute("aria-label", "Range");
  const measurePills = pills(MEASURES.map((m) => ({ id: m.id, label: m.label })), {
    active: MEASURES[0].id,
    onChange: (id) => {
      chosen = id;
      if (drawn) paintTime(drawn);
    },
  });
  measurePills.el.setAttribute("aria-label", "Measure");

  const kept = h("span", { class: "uset-kept" });
  const csv = button({
    variant: "outline",
    size: "sm",
    label: "Export CSV",
    title: "The days of the range that is drawn as a spreadsheet: a line for each day, account and model",
    disabled: true,
    onClick: () => {
      if (drawn) download(csvPath(drawn)).catch((e) => cb.onToast?.(`The CSV could not be saved: ${wordsOf(e)}`, "err"));
    },
  });
  const said = h("div", { class: "uset-said" });

  const totals = section("totals", "Totals");
  const time = section("time", "Over time", SOURCES.time, measurePills.el);
  const accounts = section("accounts", "By account", SOURCES.accounts);
  const models = section("models", "By model", SOURCES.models);
  const cache = section("cache", "Cache", SOURCES.cache);
  const speed = section("speed", "Speed and reliability", SOURCES.speed);
  const hours = section("hours", "When", SOURCES.hours);
  const who = section("who", "Who asked", SOURCES.who);
  const memory = section("memory", "Memory's own calls", SOURCES.memory);
  const tools = section("tools", "Tools", SOURCES.tools);
  /** The sections one read of the range fills. */
  const ofRange = [totals, time, accounts, models, cache, speed, hours, who];
  const main = h("div", { class: "uset-main", "aria-busy": "true" }, ...ofRange.map((s) => s.el));

  // The totals' frame: the tiles in their places, a dash in each until the read says.
  const frame = totalsView({ rows: [] }, {});
  /** @param {{ key: string, label: string, value: string, line: string }[]} tiles */
  const waiting = (tiles) => tiles.map((t) => tile({ ...t, value: "–", line: "" }));
  totals.body.replaceChildren(h("div", { class: "set-tiles" }, ...waiting(frame.work)), h("div", { class: "set-tiles" }, ...waiting(frame.money)));

  /** @param {any} b */
  function paintTotals(b) {
    const t = totalsView(b.total, b.accounts);
    totals.src.textContent = `From the daily record, ${spanWords(b)}: every model call that finished through this Filament, its memory's own aside.`;
    totals.body.replaceChildren(
      h("div", { class: "set-tiles" }, ...t.work.map(tile)),
      h("div", { class: "set-tiles" }, ...t.money.map(tile)),
      ...(t.sentence ? [h("p", { class: "uset-say" }, t.sentence)] : []));
  }

  /** @param {any} b */
  function paintTime(b) {
    const slots = daySlots(b);
    const measure = chosen || measureFor(b.total);
    measurePills.setActive(measure);
    // One day is no row of days: its hours say more.
    measurePills.el.classList.toggle("hidden", slots.length < 2);
    time.src.classList.toggle("hidden", slots.length < 2);
    if (slots.length < 2) return time.body.replaceChildren(h("p", { class: "uset-none" }, "One day: its hours are under When."));
    const c = dayBars(slots, measure, b.today);
    time.body.replaceChildren(
      h("div", { class: "uset-over" },
        c.legend ? h("div", { class: "uset-legend" }, ...c.legend.map((k) => h("span", { class: "uset-key" }, h("span", { class: `uset-swatch is-${k.key}`, "aria-hidden": "true" }), k.label))) : null,
        h("span", { class: "grow" }),
        h("span", { class: "uset-peak" }, c.peak)),
      barChart(c.bars, c.label),
      h("div", { class: "uset-axis" }, h("span", {}, c.first), h("span", {}, c.last)));
  }

  /** @param {any} b */
  function paintAccounts(b) {
    accounts.body.replaceChildren(
      table(["Account", "Calls", "Tokens", "Cache hit", "Paid", "At list price"], accountRows(b.total, b.accounts).flatMap((a) => {
        const under = a.models.map((m) => h("tr", { class: "uset-under" }, h("td", { class: "uset-sub", title: m.model }, m.model), num(m.cells.calls), num(m.cells.tokens), num(m.cells.cacheHit), num(m.cells.paid), listCell(m.cells)));
        return [
          h("tr", {},
            h("td", {}, opener(a.name, under), h("div", { class: "uset-what" }, a.what), shareBar(a.share, a.shareWords)),
            num(a.cells.calls), num(a.cells.tokens), num(a.cells.cacheHit), num(a.cells.paid), listCell(a.cells)),
          ...under,
        ];
      })));
  }

  /** @param {any} b */
  function paintModels(b) {
    const heads = ["Model", "Calls", "Input", "Output", "Cache hit", "Paid", "At list price"];
    models.body.replaceChildren(
      table(heads, modelRows(b.total, b.accounts).flatMap((m) => {
        const under = h("tr", { class: "uset-under" },
          h("td", { colspan: String(heads.length) }, h("dl", { class: "uset-details" }, ...m.details.flatMap((d) => [h("dt", {}, d.label), h("dd", {}, d.value)]))));
        return [
          h("tr", {}, h("td", { title: m.model }, opener(m.model, [under])), num(m.cells.calls), num(m.cells.input), num(m.cells.output), num(m.cells.cacheHit), num(m.cells.paid), listCell(m.cells)),
          under,
        ];
      })));
  }

  /** @param {any} b */
  function paintCache(b) {
    const c = cacheView(b.total, b.cache);
    cache.body.replaceChildren(
      ...(c.none ? [] : [
        h("div", { class: "set-tiles is-four" }, ...c.figures.map(tile)),
        h("div", { class: "uset-saved" }, h("span", { class: "uset-saved-label" }, "What caching saved"), h("span", { class: "uset-saved-value" }, c.saved)),
      ]),
      ...c.lines.map((line) => h("p", { class: "uset-note" }, line)));
  }

  /** @param {any} b */
  function paintSpeed(b) {
    const s = speedView(b.total, b.accounts);
    speed.body.replaceChildren(
      table(["Account", "Speed", "First token", "A call", "Failed", "Stopped"], [s.all, ...s.accounts].map((r, i) =>
        h("tr", i ? {} : { class: "uset-all" }, h("td", { title: r.name }, r.name), num(r.cells.speed), num(r.cells.first), num(r.cells.call), num(r.cells.failed), num(r.cells.stopped)))));
  }

  /** @param {any} b */
  function paintHours(b) {
    const c = hourBars(b.total.hours);
    hours.body.replaceChildren(
      h("div", { class: "uset-over" }, h("span", { class: "grow" }), h("span", { class: "uset-peak" }, c.busiest)),
      barChart(c.bars.map((x) => ({ tip: x.tip, parts: x.value ? [{ key: "all", pct: x.pct }] : [] })), c.label, " is-hours"),
      h("div", { class: "uset-axis" }, ...["00:00", "06:00", "12:00", "18:00", "24:00"].map((t) => h("span", {}, t))));
  }

  /** @param {any} b */
  function paintWho(b) {
    const w = whoView(b);
    who.src.textContent = `${b.who?.since ? `Kept by the day since ${dayWords(b.who.since, b.today)}. ` : ""}${SOURCES.who}`;
    /** @param {string} first @param {any[]} rows @param {string} none */
    const list = (first, rows, none) =>
      rows.length
        ? table([first, "Calls", "Tokens", "Paid", "At list price"], rows.map((r) =>
            h("tr", {}, h("td", {}, h("span", { class: "uset-name", ...(r.title ? { title: r.title } : {}) }, r.name), shareBar(r.share)), num(r.cells.calls), num(r.cells.tokens), num(r.cells.paid), listCell(r.cells))))
        : h("p", { class: "uset-none" }, none);
    who.body.replaceChildren(
      ...(w.note ? [h("p", { class: "uset-note" }, w.note)] : []),
      ...(w.none ? [] : [list("Client", w.clients, "No call of this range was counted by its client."), list("Project", w.projects, "No call of this range was booked on a project.")]));
  }

  /** The range's own sections, from its answer; or the one line that stands for them where it has no call. @param {any} b */
  function paint(b) {
    kept.textContent = keptWords(b.kept, b.today);
    const where = keptTip(b.kept);
    if (where) kept.setAttribute("title", where);
    else kept.removeAttribute("title");
    csv.toggleAttribute("disabled", !b.kept?.days);
    const none = emptyWords(b);
    if (none) return main.replaceChildren(h("p", { class: "uset-empty" }, none));
    if (!totals.el.parentNode) main.replaceChildren(...ofRange.map((s) => s.el));
    for (const draw of [paintTotals, paintTime, paintAccounts, paintModels, paintCache, paintSpeed, paintHours, paintWho]) draw(b);
  }

  /** Memory's own calls over the same days: read apart, said in their own section. @param {any} b @param {number} mine */
  async function readMemory(b, mine) {
    let m;
    try {
      m = await call(memoryPath(b));
    } catch (e) {
      if (mine === reads) memory.body.replaceChildren(h("p", { class: "set-error" }, `Memory's own calls could not be read: ${wordsOf(e)}`));
      return;
    }
    if (mine !== reads) return;
    const v = memoryView(m?.total, b.memoryPurposes);
    memory.body.replaceChildren(
      ...(v.none
        ? [h("p", { class: "uset-none" }, "No call of memory's own in this range.")]
        : [
            h("p", { class: "uset-line" }, v.line),
            table(["For", "Calls", "Tokens", "Paid", "At list price"], v.rows.map((r) => h("tr", {}, h("td", { title: r.label }, r.label), num(r.cells.calls), num(r.cells.tokens), num(r.cells.paid), listCell(r.cells)))),
          ]));
  }

  /**
   * The tools the range's runs called, from their `tool-start` events: the runs that began in the range, the newest 50
   * at most — a page of events a run —, and the line says which.
   * @param {any} b @param {number} mine
   */
  async function readTools(b, mine) {
    /** @type {Map<string, number>} */
    const counts = new Map();
    let inRange = 0;
    let read = 0;
    try {
      const since = b.from ? dayStart(b.from) : 0;
      const { runs } = await call("/runs?limit=200");
      const mineRuns = (runs || []).filter((/** @type {any} */ r) => (Number(r.startedAt) || 0) >= since);
      const newest = [...mineRuns].sort((/** @type {any} */ a, /** @type {any} */ c) => (Number(c.startedAt) || 0) - (Number(a.startedAt) || 0)).slice(0, TOOL_RUNS);
      inRange = mineRuns.length;
      read = newest.length;
      for (const run of newest) {
        if (mine !== reads) return;
        try {
          const page = await call(`/runs/${encodeURIComponent(run.id)}/events?since=0&limit=5000`);
          for (const e of page.events || []) {
            if (e.type !== "tool-start") continue;
            const name = String(e.name || "tool").toLowerCase();
            counts.set(name, (counts.get(name) || 0) + 1);
          }
        } catch { /* a run whose log is gone has no events to count: the line says the runs read */ }
      }
    } catch (e) {
      if (mine === reads) tools.body.replaceChildren(h("p", { class: "set-error" }, `The runs could not be read: ${wordsOf(e)}`));
      return;
    }
    if (mine !== reads) return;
    const v = toolsView(counts, { runs: inRange, read });
    const source = SOURCES.tools.charAt(0).toLowerCase() + SOURCES.tools.slice(1);
    tools.src.textContent = inRange ? `${v.total}, ${v.label}: ${source}` : SOURCES.tools;
    tools.body.replaceChildren(
      ...(!inRange
        ? [h("p", { class: "uset-none" }, "No run began in this range.")]
        : v.none
          ? [h("p", { class: "uset-none" }, "No tool was called in those runs.")]
          : v.rows.map((r) => h("div", { class: "set-break-row" },
              h("span", { class: "set-break-name", title: r.name }, r.name),
              h("span", { class: "set-break-track" }, h("span", { class: "set-break-bar", style: `width:${r.pct}%` })),
              h("span", { class: "set-break-n" }, r.n)))));
  }

  /** Read a range and draw it; what is drawn stays until the read lands, and stays where it fails. @param {string} id */
  async function load(id) {
    const mine = ++reads;
    range = id;
    main.setAttribute("aria-busy", "true");
    const label = RANGES.find((r) => r.id === id)?.label || id;
    let b;
    try {
      b = await call(breakdownPath(id));
    } catch (e) {
      if (mine !== reads) return;
      main.setAttribute("aria-busy", "false");
      // The pills say what is drawn: the range that could not be read is not it.
      if (drawnRange) rangePills.setActive((range = drawnRange));
      const still = drawnRange ? ` The page still shows ${RANGES.find((r) => r.id === drawnRange)?.label || drawnRange}.` : "";
      said.replaceChildren(h("p", { class: "set-error uset-head-fail", role: "alert" }, `${label} could not be read: ${wordsOf(e).replace(/\.$/, "")}.${still}`));
      return;
    }
    if (mine !== reads) return;
    drawn = b;
    drawnRange = id;
    said.replaceChildren();
    main.setAttribute("aria-busy", "false");
    paint(b);
    void readMemory(b, mine);
    void readTools(b, mine);
  }

  body.replaceChildren(
    h("div", { class: "uset" },
      h("div", { class: "uset-head" }, rangePills.el, kept, h("span", { class: "grow" }), csv),
      said,
      main,
      memory.el,
      tools.el));
  load(range);
}

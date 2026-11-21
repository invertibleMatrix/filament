// Durable per-day usage: tokens, cost, speed and cache numbers per (upstream, model), kept in daily-usage.json.
// The request log (requests.jsonl) rotates at 50 MB into a few numbered generations and the dashboard keeps only the
// last few hundred records; this file is small, grows by one entry per day and survives both, so "what did I use last
// month" always has an answer. Each finished request is counted as it finishes; the file is read as this build
// writes it (HarnessV3-AtHome AH-C1).
import { renameSync } from "node:fs";
import { mkdir, writeFile, rename, copyFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { NO_PROJECT_ID } from "../core/project-id.js";
import { STORE_FILES, readStoreFile } from "./store-files.js";

/**
 * The usage file this build writes and reads: another version is set aside and a new file starts. A build that changes
 * what a day holds (a counter, the rows' fields) changes the number, in the stores' table (services/store-files.js).
 * The one exception is a part a day may carry or not, beside its `rows` and `hours` (who asked: `clients`, `projects`):
 * a day without it reads as having none, and a build that does not know it passes it over and saves it back as it
 * read it. The number stays, because another version's file is set aside whole and the store starts empty: a part
 * added under a new number would hide every day kept so far.
 */
const USAGE_VERSION = STORE_FILES.usage.version;

// "2026-09-13" in the machine's own time zone (toISOString would give yesterday's date east of UTC).
export const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** How many days the file keeps. */
export const KEEP_DAYS = 400;
const COUNTERS = [
  "requests",
  "ok",
  "errors",
  "aborted",
  "input",
  "cacheRead",
  "cacheWrite",
  "output",
  "thinking",
  "cost",
  "costN",
  "listCost",
  "listCostN",
  "planListCost",
  "tpsSum",
  "tpsN",
  "ttftSum",
  "ttftN",
  "msSum",
  "estimated",
];
const blank = () => Object.fromEntries(COUNTERS.map((k) => [k, 0]));

function bump(b, rec) {
  const t = rec.tokens || {};
  b.requests++;
  if (rec.status === "ok") b.ok++;
  else if (rec.status === "aborted") b.aborted++;
  else b.errors++;
  b.input += t.input || 0;
  b.cacheRead += t.cacheRead || 0;
  b.cacheWrite += t.cacheWrite || 0;
  b.output += t.output || 0;
  b.thinking += t.thinking || 0;
  if (typeof rec.cost === "number") {
    b.cost += rec.cost;
    b.costN++;
  }
  // The same tokens at list price (Providers P4), and the part of it a plan paid instead.
  if (typeof rec.listCost === "number") {
    b.listCost += rec.listCost;
    b.listCostN++;
    if (rec.billing === "plan") b.planListCost += rec.listCost;
  }
  const tps = computeTps(rec);
  if (tps) {
    b.tpsSum += tps;
    b.tpsN++;
  }
  if (rec.ttftMs != null) {
    b.ttftSum += rec.ttftMs;
    b.ttftN++;
  }
  b.msSum += rec.totalMs || 0;
  if (rec.estimatedTokens) b.estimated++;
}

// Who asked (the owner's Usage stats of 11-12): a day's sums by the client that sent its calls and by the project they
// were booked on — the parts a day may carry (`USAGE_VERSION`). Counted from the build that first keeps them: a day
// from before has none, and a call a build that keeps no parts counted on a day that has them is the day's, in none.
const WHO_SUMS = ["requests", "input", "output", "cacheRead", "cacheWrite", "cost", "costN", "listCost", "listCostN", "planListCost"];
/** How many names one day keeps of each part; the rest are one `other`, so no user agent can grow the file. */
export const WHO_KEEPS = Object.freeze({ clients: 40, projects: 200 });
export const WHO_OTHER = "other";
/** A name's first characters are its key: a user agent is as long as its sender likes. */
const WHO_NAME = 80;
const blankWho = () => Object.fromEntries(WHO_SUMS.map((k) => [k, 0]));

/**
 * A map's own entry for a name, made where it has none. A name is what a client called itself: `__proto__` or
 * `constructor` is a name like any, never the object's own part.
 * @param {Record<string, any>} map @param {string} key
 */
function ownEntry(map, key) {
  if (!Object.hasOwn(map, key)) Object.defineProperty(map, key, { value: blankWho(), enumerable: true, writable: true, configurable: true });
  return map[key];
}

/**
 * One call onto a day's part, under its name — a name the day has, or one it still has room for; else `other`. Its
 * tokens and prices are added as `bump` adds them to the day.
 * @param {any} d  the day @param {"clients" | "projects"} part @param {string} name @param {any} rec
 */
function bumpWho(d, part, name, rec) {
  const map = (d[part] ||= {});
  const key = name.slice(0, WHO_NAME);
  const b = ownEntry(map, Object.hasOwn(map, key) || Object.keys(map).length < WHO_KEEPS[part] ? key : WHO_OTHER);
  const t = rec.tokens || {};
  b.requests++;
  b.input += t.input || 0;
  b.output += t.output || 0;
  b.cacheRead += t.cacheRead || 0;
  b.cacheWrite += t.cacheWrite || 0;
  if (typeof rec.cost === "number") {
    b.cost += rec.cost;
    b.costN++;
  }
  if (typeof rec.listCost === "number") {
    b.listCost += rec.listCost;
    b.listCostN++;
    if (rec.billing === "plan") b.planListCost += rec.listCost;
  }
}

/** A who-asked sum as it is read: dollars rounded as a day's are, and its tokens whole. @param {any} b */
const whoView = (b) => ({
  ...b,
  cost: Math.round(b.cost * 1e6) / 1e6,
  listCost: Math.round(b.listCost * 1e6) / 1e6,
  planListCost: Math.round(b.planListCost * 1e6) / 1e6,
  totalTokens: b.input + b.cacheRead + b.cacheWrite + b.output,
});

// Derived numbers every consumer wants; computed at read time so the file only holds sums and counts.
export function derive(b) {
  const cacheable = b.input + b.cacheRead + b.cacheWrite;
  return {
    ...b,
    cost: Math.round(b.cost * 1e6) / 1e6,
    listCost: Math.round(b.listCost * 1e6) / 1e6,
    planListCost: Math.round(b.planListCost * 1e6) / 1e6,
    cacheHitRate: cacheable ? b.cacheRead / cacheable : 0,
    avgTps: b.tpsN ? Math.round((b.tpsSum / b.tpsN) * 10) / 10 : null,
    avgTtftMs: b.ttftN ? Math.round(b.ttftSum / b.ttftN) : null,
    avgMs: b.requests ? Math.round(b.msSum / b.requests) : null,
    totalTokens: b.input + b.cacheRead + b.cacheWrite + b.output,
  };
}

// Output tokens per second. Measured after the first byte when the reply really streamed; a reply that arrived in one
// burst (agents often deliver the whole text at the end of a long tool-using turn) is rated over the whole turn instead,
// otherwise 2,000 tokens in 3 ms would read as 600,000 tok/s and wreck every average. Tiny replies are not rated.
// Agent turns (ACP) are rated over the whole turn: the agent's output count covers every internal model call it made,
// most of them before its first visible chunk reached us, so "after first byte" would overstate them tenfold.
export function computeTps(rec) {
  const out = rec?.tokens?.output || 0;
  const ms = writingMs(rec);
  if (out < 10 || ms == null) return null;
  return Math.round((out / (ms / 1000)) * 10) / 10;
}

/**
 * The time a finished call was writing its reply (ms), by computeTps's rule: from its first byte to its end, or its whole
 * time where it did not stream; null where that was too short to rate.
 * @param {any} rec
 */
export function writingMs(rec) {
  if (!(rec?.totalMs > 0)) return null;
  const gen = rec.ttftMs != null && !rec.acp ? rec.totalMs - rec.ttftMs : rec.totalMs;
  const ms = gen >= 200 ? gen : rec.totalMs;
  return ms >= 200 ? ms : null;
}

const rowKey = (rec) => `${rec.upstream || "?"}|${rec.upstreamModel || rec.model || "?"}`;

// A record is memory's OWN model call (learning, the engine's consolidation) — never a client request: the route stage
// tags it (`memoryFor`) from its purpose header or memory's user agent.
export const isMemoryRecord = (rec) => !!rec?.memoryFor;

export class DailyUsage {
  // `filter(rec) => bool`: which records this store counts (the general store model calls other than memory's own; the
  // memory store memory's alone).
  // `rowExtra(rec) => { purpose }`: extra fields that split the per-day rows further (the memory store keeps learning
  // and the engine's own calls apart).
  // `who(rec) => { client, project }`: who asked for a call, where the store keeps that by the day (the general store:
  // the client that began its turn and the project it is booked on; memory's keeps none).
  /**
   * @param {{ dataDir?: string, file?: string, persist?: boolean,
   *   filter?: ((rec: any) => boolean) | null, rowExtra?: ((rec: any) => any) | null,
   *   who?: ((rec: any) => { client?: string | null, project?: string | null } | null) | null,
   *   log?: ((level: string, msg: string) => void) | null }} [opts]
   */
  constructor({
    dataDir,
    file = "daily-usage.json",
    persist = true,
    filter = null,
    rowExtra = null,
    who = null,
    log = null,
  } = {}) {
    this.dataDir = dataDir;
    this.file = file;
    this.persist = persist && !!dataDir;
    this.log = log;
    this.filter = filter;
    this.rowExtra = rowExtra;
    this.whoOf = who;
    this.days = {};
    this.#timer = null;
    this.dirty = false;
    if (this.persist) this.#load();
  }
  #timer;
  #writing = null; // the in-flight write, so two never overlap and flush() can be awaited
  #again = false; // a save was requested while one was in flight: run once more when it finishes
  // Each day's text as a save last wrote it, by day, until a record changes the day: a save stringifies only the days
  // its records fell on. At the KEEP_DAYS ceiling the whole file is ~6.7 MB, and stringifying all of it every 1.5 s
  // while traffic flows held the event loop as the synchronous write once did.
  /** @type {Map<string, string>} */
  #texts = new Map();

  get path() {
    return this.dataDir ? join(this.dataDir, this.file) : null;
  }

  // The file as this build writes it, or nothing: one that cannot be read is set aside under `.broken` and a new one
  // starts; one of another build's version under its version's name, which that build takes back (r-itself, 11-12;
  // services/store-files.js).
  #load() {
    const p = this.path;
    try {
      const j = readStoreFile(p, STORE_FILES.usage, (level, msg) => this.log?.(level, msg));
      if (j?.version !== USAGE_VERSION || !j.days || typeof j.days !== "object" || Array.isArray(j.days))
        throw new Error(`it is not a version ${USAGE_VERSION} usage file`);
      this.days = j.days;
    } catch (e) {
      if (e?.code === "ENOENT") return;
      this.log?.("warn", `${this.file} is unreadable (${e.message}); starting a new one, the old file is kept as ${this.file}.broken`);
      try {
        renameSync(p, p + ".broken");
      } catch {}
    }
  }

  add(rec) {
    if (!rec || !rec.ts || rec.status === "pending") return;
    if (this.filter && !this.filter(rec)) return;
    this.#apply(rec);
    this.#scheduleSave();
  }

  #apply(rec) {
    const day = localDay(new Date(rec.ts));
    this.#texts.delete(day);
    const d = (this.days[day] ||= { ...blank(), hours: new Array(24).fill(0), rows: {} });
    bump(d, rec);
    const h = new Date(rec.ts).getHours();
    if (h >= 0 && h < 24) d.hours[h]++;
    const extra = this.rowExtra ? this.rowExtra(rec) || {} : {};
    const key = Object.values(extra).length
      ? `${Object.values(extra).join("|")}|${rowKey(rec)}`
      : rowKey(rec);
    const row = (d.rows[key] ||= {
      ...blank(),
      ...extra,
      upstream: rec.upstream || "?",
      model: rec.upstreamModel || rec.model || "?",
      asked: {},
    });
    bump(row, rec);
    const asked = rec.model || "?";
    if (asked in row.asked || Object.keys(row.asked).length < 20)
      row.asked[asked] = (row.asked[asked] || 0) + 1;
    if (this.whoOf) {
      const who = this.whoOf(rec) || {};
      bumpWho(d, "clients", String(who.client || "unknown"), rec);
      bumpWho(d, "projects", String(who.project || NO_PROJECT_ID), rec);
    }
  }

  // The `#again` flag matters here, not only in `#save`: a record can arrive WHILE a write is in flight, after
  // `flush()` has already captured that write's promise. Without this, the in-flight write finishes, sees no follow-up
  // requested, and the late record sits in memory until the next 1.5 s timer — which is unref'd, so a shutdown that
  // has already awaited flush() exits and the record is lost for good.
  #scheduleSave() {
    this.dirty = true;
    if (this.#writing) this.#again = true;
    if (!this.persist || this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#save();
    }, 1500);
    this.#timer.unref?.();
  }

  // Writes are serialized: never two in flight, and one requested during a write runs after it rather than racing it
  // (two renames of the same temp path would corrupt the file). Returns a promise so `flush()` can be awaited — and
  // the promise it returns covers the follow-up write too, because the `.then` returns it.
  #save() {
    if (!this.persist) return Promise.resolve();
    if (this.#writing) {
      this.#again = true;
      return this.#writing;
    }
    if (!this.dirty) return Promise.resolve();
    this.#writing = this.#writeAsync()
      .then(() => {
        this.#writing = null;
        if (this.#again) {
          this.#again = false;
          return this.#save();
        }
        return undefined;
      })
      // `.catch` rather than a second `then` argument, so it also covers a throw from the success callback above.
      // The point is that `#writing` is never left set: a wedged non-null value would make every later `#save()`
      // return the same settled promise and silently stop persisting, with `dirty` stuck true and no error surfaced.
      .catch((e) => {
        this.#writing = null;
        this.dirty = true;
        this.log?.("warn", `could not write ${this.file}: ${e?.message || e}; it will be retried`);
      });
    return this.#writing;
  }
  async #writeAsync() {
    try {
      const keys = Object.keys(this.days).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) {
        delete this.days[k];
        this.#texts.delete(k);
      }
      // Made synchronously — it snapshots one consistent view — but the I/O is async. At the KEEP_DAYS ceiling this
      // file reaches ~6.7 MB and a synchronous write measured ~18 ms of BLOCKED EVENT LOOP, every 1.5 s while traffic
      // flows: long enough to stall every concurrent request, including a chat client's SSE stream mid-reply. The text
      // is what one stringify of the whole gives — its days in the object's own order — with each day's kept until a
      // record changes it (`#texts`).
      const days = Object.keys(this.days).map((k) => {
        let t = this.#texts.get(k);
        if (t === undefined) this.#texts.set(k, (t = JSON.stringify(this.days[k])));
        return `${JSON.stringify(k)}:${t}`;
      });
      const body = `{"version":${JSON.stringify(USAGE_VERSION)},"savedAt":${JSON.stringify(new Date().toISOString())},"days":{${days.join(",")}}}`;
      this.dirty = false; // cleared before the await: a record arriving mid-write re-dirties and is picked up next time
      await mkdir(this.dataDir, { recursive: true });
      const tmp = this.path + ".tmp";
      await writeFile(tmp, body);
      try {
        await rename(tmp, this.path);
      } catch {
        await copyFile(tmp, this.path);
        try {
          await unlink(tmp);
        } catch {}
      }
    } catch (e) {
      this.dirty = true;
      this.log?.("warn", `could not write ${this.file}: ${e.message}`);
    }
  }

  // Returns a promise so shutdown can wait for the last write to land. Callers that ignore it still get the write;
  // they just cannot know when it finished — which is why `stop()` awaits it.
  flush() {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    return this.dirty ? this.#save() : this.#writing || Promise.resolve();
  }

  // Days newest first, each with derived numbers and its rows; optional inclusive from/to as YYYY-MM-DD.
  /** @param {{ from?: string | null, to?: string | null, limit?: number }} [span] */
  list({ from = null, to = null, limit = 0 } = {}) {
    let keys = Object.keys(this.days)
      .filter((k) => (!from || k >= from) && (!to || k <= to))
      .sort()
      .reverse();
    if (limit > 0) keys = keys.slice(0, limit);
    return keys.map((day) => this.#view(day));
  }
  #view(day) {
    const d = this.days[day];
    // Who asked is read by `who()`: a day's view is its sums, hours and rows, as it was before a day carried more.
    const { rows, hours, clients, projects, ...totals } = d;
    return {
      day,
      ...derive(totals),
      hours,
      rows: Object.values(rows)
        .map((r) => ({
          ...derive(r),
          asked: Object.entries(r.asked)
            .sort((a, b) => b[1] - a[1])
            .map(([name, n]) => ({ name, n })),
        }))
        .sort((a, b) => b.requests - a.requests || b.totalTokens - a.totalTokens),
    };
  }

  /** What is on record, whatever a read asks for: how many days, the first and the last. */
  reach() {
    const keys = Object.keys(this.days).sort();
    return { days: keys.length, first: keys[0] ?? null, last: keys.at(-1) ?? null };
  }

  // One combined bucket (and combined rows) for a span of days, for "last 7 days" style views.
  /** @param {{ from?: string | null, to?: string | null }} [span]  inclusive days, YYYY-MM-DD */
  aggregate({ from = null, to = null } = {}) {
    const days = this.list({ from, to });
    const total = blank();
    const rows = new Map();
    const hours = new Array(24).fill(0);
    for (const d of days) {
      for (const k of COUNTERS) total[k] += d[k];
      d.hours.forEach((n, i) => (hours[i] += n));
      for (const r of d.rows) {
        const key = `${r.purpose || ""}|${r.upstream}|${r.model}`;
        const acc = rows.get(key) || {
          ...blank(),
          ...(r.purpose ? { purpose: r.purpose } : {}),
          upstream: r.upstream,
          model: r.model,
          asked: {},
        };
        for (const k of COUNTERS) acc[k] += r[k];
        for (const a of r.asked) acc.asked[a.name] = (acc.asked[a.name] || 0) + a.n;
        rows.set(key, acc);
      }
    }
    return {
      from: days.at(-1)?.day || from,
      to: days[0]?.day || to,
      days: days.length,
      ...derive(total),
      hours,
      rows: [...rows.values()]
        .map((r) => ({
          ...derive(r),
          asked: Object.entries(r.asked)
            .sort((a, b) => b[1] - a[1])
            .map(([name, n]) => ({ name, n })),
        }))
        .sort((a, b) => b.requests - a.requests || b.totalTokens - a.totalTokens),
    };
  }

  /**
   * Who asked, over a span of days: the sums by client and by project of the days that carry them, added up, the
   * biggest by tokens first. `since`: the first day on record that carries them, whatever the span (null: none does);
   * `days` and `requests`: how many of the span's days carry them, and those days' calls — a reader says what is
   * missing from them (the days from before, and the calls a build that kept none counted on a day that has them).
   * As many names as one day keeps: the smallest of a long span go under `other`, last.
   * @param {{ from?: string | null, to?: string | null }} [span]  inclusive days, YYYY-MM-DD
   * @returns {{ since: string | null, days: number, requests: number, clients: any[], projects: any[] }}
   */
  who({ from = null, to = null } = {}) {
    const keys = Object.keys(this.days).sort();
    const carries = (/** @type {string} */ k) => !!(this.days[k].clients || this.days[k].projects);
    /** @type {Record<"clients" | "projects", Map<string, any>>} */
    const sums = { clients: new Map(), projects: new Map() };
    let days = 0;
    let requests = 0;
    for (const k of keys) {
      if ((from && k < from) || (to && k > to) || !carries(k)) continue;
      days++;
      requests += this.days[k].requests || 0;
      for (const part of /** @type {const} */ (["clients", "projects"]))
        for (const [name, b] of Object.entries(this.days[k][part] || {})) {
          const acc = sums[part].get(name) || blankWho();
          for (const c of WHO_SUMS) acc[c] += Number(b?.[c]) || 0;
          sums[part].set(name, acc);
        }
    }
    /** @param {"clients" | "projects"} part @param {string} label  what a row calls its name */
    const rowsOf = (part, label) => {
      const named = [...sums[part]].filter(([name]) => name !== WHO_OTHER).map(([name, b]) => ({ [label]: name, ...whoView(b) }));
      named.sort((a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests);
      const rest = sums[part].get(WHO_OTHER) || null;
      const over = named.splice(WHO_KEEPS[part]);
      if (!rest && !over.length) return named;
      const other = rest || blankWho();
      for (const r of over) for (const c of WHO_SUMS) other[c] += r[c];
      return [...named, { [label]: WHO_OTHER, ...whoView(other) }];
    };
    return { since: keys.find(carries) ?? null, days, requests, clients: rowsOf("clients", "name"), projects: rowsOf("projects", "id") };
  }

  // Spreadsheet-friendly export: one line per day × upstream × model.
  csv({ from = null, to = null } = {}) {
    const anyPurpose = Object.values(this.days).some((d) => Object.values(d.rows).some((r) => r.purpose));
    const head = [
      "day",
      ...(anyPurpose ? ["purpose"] : []),
      "upstream",
      "model",
      "requests",
      "ok",
      "errors",
      "aborted",
      "input_tokens",
      "cache_read_tokens",
      "cache_write_tokens",
      "output_tokens",
      "thinking_tokens",
      "cache_hit_rate",
      "avg_tokens_per_second",
      "avg_first_byte_ms",
      "estimated_cost_usd",
      "tokens_estimated_requests",
      "list_cost_usd",
      "plan_list_cost_usd",
    ];
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.join(",")];
    for (const d of this.list({ from, to }).reverse())
      for (const r of d.rows)
        lines.push(
          [
            d.day,
            ...(anyPurpose ? [r.purpose || ""] : []),
            r.upstream,
            r.model,
            r.requests,
            r.ok,
            r.errors,
            r.aborted,
            r.input,
            r.cacheRead,
            r.cacheWrite,
            r.output,
            r.thinking,
            r.cacheHitRate.toFixed(4),
            r.avgTps ?? "",
            r.avgTtftMs ?? "",
            r.costN ? r.cost.toFixed(6) : "",
            r.estimated,
            r.listCostN ? r.listCost.toFixed(6) : "",
            r.listCostN ? r.planListCost.toFixed(6) : "",
          ]
            .map(esc)
            .join(","),
        );
    return lines.join("\n") + "\n";
  }
}

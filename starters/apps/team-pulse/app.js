// The Team pulse: this week's commits as Filament reads them (its "week" source), and the weekly reports an agent wrote
// into filament.db's "reports" collection, the newest first, drawn from their Markdown. Write this week's pulse asks an
// agent for the report through filament.ask: the developer reads the ask in Filament's Start and sends it. Preact, htm,
// marked and DOMPurify from Filament's shelf, so it loads with no network.
import { html, render, useEffect, useState } from "/_filament/lib/preact@11/preact.js";
import { marked } from "/_filament/lib/marked@18/marked.js";
import DOMPurify from "/_filament/lib/dompurify@3/purify.js";

const f = window.filament;
/** This app's name, as the artifact tool knows it: its address's first label. */
const NAME = location.hostname.split(".")[0];

/** The ISO week a day is in, as "2026-W44". @param {Date} d */
function weekOf(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const n = Math.ceil(((t.getTime() - first.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(n).padStart(2, "0")}`;
}

/** What an agent is asked for this week's report. @param {string} week */
const askWords = (week) =>
  `Write this week's team pulse for the app ${NAME}: read its "week" source (the space tool's app action reads it), ` +
  `summarise what went in — grouped by what it was for, each with its pull request's link where its subject names one (#12), from this repository's remote —, ` +
  `and keep it with the artifact tool's write_db in ${NAME}'s collection "reports" as one record ` +
  `{ "id": "${week}", "week": "${week}", "at": <now in ms>, "markdown": "…" }, which replaces this week's if there is one.`;

function App() {
  const [week, setWeek] = useState(/** @type {any[] | null} */ (null));
  const [why, setWhy] = useState("");
  const [reports, setReports] = useState(/** @type {any[]} */ ([]));

  const readWeek = () =>
    f.source("week").then(
      (s) => {
        setWeek(s.rows || []);
        setWhy(s.error ? `Its last read failed: ${s.error}` : "");
      },
      (e) => {
        setWeek([]);
        setWhy(e.off === "draft" ? "A draft: Keep… on its page reads the week, and nothing reads before." : e.off === "paused" ? "Paused: Resume on its page reads it again." : String(e.message || e));
      },
    );
  const readReports = () =>
    f.db.list("reports").then(
      (r) => setReports([...r].sort((a, b) => String(b.week).localeCompare(String(a.week)))),
      () => setReports([]),
    );

  useEffect(() => {
    readWeek();
    readReports();
    const offSource = f.onSource(() => readWeek());
    const offData = f.db.onChange(({ collection }) => collection === "reports" && readReports());
    return () => {
      offSource();
      offData();
    };
  }, []);

  const now = weekOf(new Date());
  return html`
    <div class="head">
      <h1>Team pulse</h1>
      <button onClick=${() => f.ask(askWords(now))} title="Fills Filament's Start with the ask: nothing is sent until you send it">Write this week's pulse…</button>
    </div>
    <section>
      <h2>This week</h2>
      ${why && html`<p class="quiet">${why}</p>`}
      ${week === null
        ? html`<p class="quiet">Reading this week's commits…</p>`
        : !week.length && !why
          ? html`<p class="quiet">Nothing went in this week.</p>`
          : html`<ul class="week">${week.map((c) => html`<li><span class="sha">${c.sha}</span><span>${c.subject}</span><span class="who">${c.who} · ${c.date}</span></li>`)}</ul>`}
    </section>
    <section>
      <h2>Reports</h2>
      ${!reports.length
        ? html`<p class="quiet">No report yet: Write this week's pulse asks an agent for one.</p>`
        : reports.map((r) => html`<article class="report"><p class="quiet">${r.week}</p><div dangerouslySetInnerHTML=${{ __html: DOMPurify.sanitize(marked.parse(String(r.markdown || ""))) }}></div></article>`)}
    </section>
  `;
}

render(html`<${App} />`, /** @type {HTMLElement} */ (document.getElementById("app")));

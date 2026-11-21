// The Pipeline: package.json's scripts, each with a Run button and how its last run ended; the run picked shows its log
// as it comes. Preact and htm from Filament's shelf, so it loads with no network. Filament reads the scripts (its
// "scripts" source) and runs a script only from its own sheet: the page asks with filament.act, never runs anything.
import { html, render, useEffect, useRef, useState } from "/_filament/lib/preact@11/preact.js";

const f = window.filament;

/** How long ago, in words. @param {number} ms */
const ago = (ms) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};
/** How long a run took, in words. @param {any} j */
const took = (j) => (j.endedAt ? `${Math.max(1, Math.round((j.endedAt - j.startedAt) / 1000))} s` : "");

function App() {
  const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
  const [why, setWhy] = useState("");
  const [jobs, setJobs] = useState(/** @type {any[]} */ ([]));
  const [shown, setShown] = useState(/** @type {string | null} */ (null));
  const [log, setLog] = useState("");
  // The run whose log shows, for what its stream says as it comes.
  const showing = useRef(/** @type {string | null} */ (null));

  const readRows = () =>
    f.source("scripts").then(
      (s) => {
        setRows(s.rows || []);
        setWhy(s.error ? `Its last read failed: ${s.error}` : "");
      },
      (e) => {
        setRows([]);
        setWhy(e.off === "draft" ? "A draft: Keep… on its page runs it, and nothing reads or runs before." : e.off === "paused" ? "Paused: Resume on its page reads it again." : String(e.message || e));
      },
    );
  const readJobs = () => f.jobs().then((j) => setJobs(j || []), () => {});

  useEffect(() => {
    readRows();
    readJobs();
    const offSource = f.onSource(() => readRows());
    const offJob = f.onJob((/** @type {any} */ e) => {
      if (e.chunk && e.id === showing.current) setLog((l) => l + e.chunk);
      if (e.state) readJobs();
    });
    return () => {
      offSource();
      offJob();
    };
  }, []);

  // The run whose log shows: the newest one started, until another is picked.
  const shownNow = shown || jobs[0]?.id || null;
  showing.current = shownNow;
  useEffect(() => {
    if (!shownNow) return;
    f.job(shownNow).then((j) => setLog(j?.log || ""), () => setLog(""));
  }, [shownNow]);

  if (rows === null) return html`<p class="quiet">Reading this project's scripts…</p>`;
  const lastOf = (/** @type {string} */ name) => jobs.find((j) => j.key === name);
  const running = jobs.find((j) => j.state === "running");
  const job = jobs.find((j) => j.id === shownNow);
  return html`
    <h1>Pipeline</h1>
    ${why && html`<p class="quiet">${why}</p>`}
    ${!rows.length && !why ? html`<p class="quiet">package.json has no scripts.</p>` : null}
    <div class="rows">
      ${rows.map((r) => {
        const last = lastOf(r.name);
        return html`<div class=${`row${job && job.key === r.name ? " is-on" : ""}`}>
          <span class="name">${r.name}</span>
          <span class="cmd">${r.command}</span>
          ${last && html`<button class="ghost" onClick=${() => setShown(last.id)} title="Show its log"><span class=${`state ${last.state}`}>${last.state}</span>${last.endedAt ? ` · ${took(last)} · ${ago(last.endedAt)}` : ""}</button>`}
          ${last && last.state === "running"
            ? html`<button onClick=${() => f.stop(last.id)}>Stop</button>`
            : html`<button class="primary" disabled=${!!running} title=${running ? "One script runs at a time" : `npm run ${r.name}`} onClick=${() => f.act("run", r)}>Run</button>`}
        </div>`;
      })}
    </div>
    ${job && html`<div>
      <p class="quiet">${job.label || "Run"} ${job.key} · <span class=${`state ${job.state}`}>${job.state}</span>${job.said ? ` · ${job.said}` : ""}</p>
      <pre class="log">${log || "Nothing said yet."}</pre>
    </div>`}
  `;
}

render(html`<${App} />`, /** @type {HTMLElement} */ (document.getElementById("app")));

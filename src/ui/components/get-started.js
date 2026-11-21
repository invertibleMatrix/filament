// @ts-check
// Get started (HarnessV3-Launch LD-D2): the four steps from a first visit to work, each ticking from the server's
// facts (`GET /api/start`), never from a guess the page makes. One builder, for Home (in the hero's place until a
// model can answer, one folded line after) and for Start here. The page hands in `h` and its helpers, so this file
// never closes over app.js and a test draws it without a browser.

import { WITHOUT_ENGINE } from "../lib/engine.js";

/**
 * What the memory engine takes, in the Memory page's words: the copy that came with Filament, the only one it installs
 * (HarnessV3-AtHome AH-D2), or none here to install. @param {boolean} bundled
 */
const engineSize = (bundled) =>
  `about 500 MB (uv, a private Python 3.12, Mnemosyne and a 65 MB embedding model), ${bundled ? "installed from the copy that came with Filament, offline" : "but this Filament came without it: the Memory page says why"}`;

/**
 * Each step, and whether the facts say it is done. `done` is null for the one Filament can't see: which other tools
 * point here.
 * @param {any} f  what /api/start answered; null before it has
 * @returns {{ id: "connect" | "memory" | "harness" | "tools", title: string, done: boolean | null, optional: boolean }[]}
 */
export function startSteps(f) {
  const m = f?.memory || {};
  return [
    { id: "connect", title: "Connect a model", done: !!f?.connected?.ok, optional: false },
    // Memory is on for everyone and its engine installs itself (HarnessV3-AtHome AH-D1, D2, D13): the step is memory set
    // up, and its body says which part is still to come — the switch, for a config that saved it off, or the engine.
    { id: "memory", title: "Set up memory", done: !!(m.enabled && m.installed), optional: true },
    { id: "harness", title: "Open the harness", done: !!f?.harness?.used, optional: false },
    { id: "tools", title: "Use it from your other tools", done: null, optional: true },
  ];
}

/**
 * Get started's facts as the page holds them: what `/start` answers, read again at most every five seconds while a
 * page asks for them (`get`), or at once after a click (`read`). The newest read wins: one that began before a click is
 * not allowed to undo what the click did. `changed` is told when a read brings facts that differ; an install's progress
 * is no difference, its start and its end are.
 * @param {{ api: (path: string) => Promise<any>, changed: () => void, now?: () => number }} d
 */
export function createStartReader(d) {
  const now = d.now || Date.now;
  /** @type {any} */
  let facts = null;
  let at = 0;
  let reads = 0;
  let reading = false;
  const sig = (/** @type {any} */ f) =>
    JSON.stringify(f && { ...f, memory: { ...f.memory, installing: f.memory?.installing?.id || null } });
  const read = async () => {
    const mine = ++reads;
    try {
      const f = await d.api("/start");
      if (mine !== reads) return;
      const differs = sig(f) !== sig(facts);
      facts = f;
      if (differs) d.changed();
    } catch {
      // the server did not answer: the facts stay, and the next ask tries again five seconds on
    } finally {
      if (mine === reads) at = now();
    }
  };
  return {
    /** The facts now (null before the first answer), read again when the last read is five seconds old. */
    get() {
      if (now() - at >= 5000 && !reading) {
        reading = true;
        void read().finally(() => {
          reading = false;
        });
      }
      return facts;
    },
    /** Read them now: after a click. */
    read,
    /** The facts read with the configuration: the newest there are. @param {any} f */
    set(f) {
      facts = f;
      at = now();
      reads++;
    },
    /** What they are made of changed (a save's discovery answered): the next `get` reads them again. */
    stale() {
      at = 0;
    },
  };
}

/**
 * What Get started's clicks do, through the page's `api` and `toast`: memory's switch, saved on the server at once, so
 * the page's copies of the config (`copies`: the edited one and the saved one) learn it without an unsaved edit, as
 * the failover switch's do; with its engine's install when asked; the engine's install on its own; the providers'
 * models listed (the catalogue's Refresh). Either way the facts are read again after (`refresh`).
 * @param {{ api: (path: string, o?: any) => Promise<any>, toast: (msg: string, kind?: string) => void,
 *   copies: () => any[], refresh: () => void }} d
 */
export function startActions(d) {
  return {
    /** @param {{ install: boolean }} o */
    memoryOn: async ({ install }) => {
      try {
        await d.api("/memory/enabled", { method: "POST", body: { enabled: true } });
        for (const o of d.copies()) if (o) (o.memory ||= {}).enabled = true;
        if (install) await d.api("/memory/install", { method: "POST", body: {} });
        d.toast(install ? "Memory is on; its engine is installing" : "Memory is on");
      } catch (e) {
        d.toast(/** @type {any} */ (e).message, "err");
      }
      d.refresh();
    },
    install: async () => {
      try {
        await d.api("/memory/install", { method: "POST", body: {} });
      } catch (e) {
        d.toast(/** @type {any} */ (e).message, "err");
      }
      d.refresh();
    },
    // A Refresh answers for every provider it asked: one that did not answer is said, by its id as the answer keys it.
    listModels: async () => {
      try {
        const r = await d.api("/models?refresh=1");
        const failed = Object.entries(r?.upstreams || {}).filter(([, i]) => /** @type {any} */ (i)?.error);
        if (failed.length)
          d.toast(failed.map(([id, i]) => `${id} did not list its models: ${/** @type {any} */ (i).error}`).join("; "), "err");
      } catch (e) {
        d.toast(/** @type {any} */ (e).message, "err");
      }
      d.refresh();
    },
  };
}

/** Names in words: "A", "A and B", "A, B and C". @param {string[]} names */
const namesInWords = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * The steps open (`steps`) or folded to one line (`line`). `connect` opens the provider catalogue; `memoryOn` switches
 * memory on, and installs its engine too when asked (the facts said there is none); `listModels` asks the providers
 * set up for their models (the facts named some Filament has no list for); `refresh` re-reads the facts.
 * @param {{ h: (tag: string, attrs?: Record<string, any>, ...kids: any[]) => any, copyline: (text: string) => any,
 *   secretLine: (key: string) => any, jobPanel: (job: any, onDone: () => void) => any,
 *   settingsLink: (label: string) => any, connect: () => void, memoryOn: (o: { install: boolean }) => Promise<unknown>,
 *   install: () => Promise<unknown>, listModels: () => Promise<unknown>, refresh: () => void, open: () => void }} d
 */
export function createGetStarted(d) {
  const { h } = d;
  const mark = (/** @type {boolean | null} */ done) => h("span", { class: "step-mark" }, done ? "✓" : "");
  const says = (/** @type {any[]} */ ...kids) => h("div", { class: "muted small" }, ...kids);
  const acts = (/** @type {any[]} */ ...kids) => h("div", { class: "step-act" }, ...kids);
  /** A button that says it is working while its action runs. @param {string} label @param {string} busy @param {() => Promise<unknown>} run */
  const working = (label, busy, run) => {
    const b = h(
      "button",
      {
        type: "button",
        class: "primary",
        onclick: async () => {
          b.disabled = true;
          b.textContent = busy;
          try {
            await run();
          } finally {
            b.disabled = false;
            b.textContent = label;
          }
        },
      },
      label,
    );
    return b;
  };
  /**
   * What memory learns with, once it is on: the model set for it, else each chat's own; with none to call, why — and
   * where nothing can answer yet, step 1 is the action: nothing to name in the settings.
   * @param {any} m @param {any} f
   */
  const learns = (m, f) =>
    m.summarizer === "off"
      ? ["It learns nothing: memory's model is off. ", d.settingsLink("Change")]
      : m.learnsWith && !m.chosen
        ? ["It learns with ", h("code", {}, m.learnsWith), ". ", d.settingsLink("Change")]
        : m.learnsWith
          ? ["It learns with each chat's compaction model, else the chat's own — or one model you set for it in ", d.settingsLink("Memory → Settings"), "."]
          : !f?.connected?.ok
            ? ["Once a model can answer, it learns with each chat's own."]
            : ["It has no model to call (a coding agent's alone is none): set one in ", d.settingsLink("Memory → Settings"), "."];
  /** @type {Record<string, (f: any, done: boolean | null, o: { base: string, key: string | null }) => any[]>} */
  const body = {
    connect: (f, done) => {
      const unlisted = f.connected.unlisted || [];
      // Set up, but never asked for its models (LD-D3): the click that asks, not one that connects another.
      if (!done && unlisted.length) {
        const one = unlisted.length === 1;
        return [
          says(`${namesInWords(unlisted)} ${one ? "is" : "are"} set up, but Filament has no list of ${one ? "its" : "their"} models yet.`),
          acts(working(one ? "List its models" : "List their models", "Listing…", () => d.listModels())),
        ];
      }
      if (!done)
        return [
          says(
            "Filament answers with the models you connect: a provider's API key, a subscription you already pay for, or a coding agent on this machine. Until one is connected, nothing can answer.",
          ),
          acts(
            h("button", { type: "button", class: "primary", onclick: () => d.connect() }, "Connect a model"),
          ),
        ];
      const { models, example } = f.connected;
      return [
        says(
          `${models} model${models === 1 ? "" : "s"} can answer${example ? ", such as " : "."}`,
          ...(example ? [h("code", {}, example), "."] : []),
        ),
        acts(
          h(
            "a",
            {
              href: "#destinations:upstreams",
              class: "golink small",
              onclick: (/** @type {Event} */ e) => {
                e.preventDefault();
                d.connect();
              },
            },
            "Connect another →",
          ),
        ),
      ];
    },
    memory: (f) => {
      const m = f?.memory || {};
      if (m.installing) return [d.jobPanel(m.installing, d.refresh)];
      if (!m.enabled)
        return [
          says(
            `Filament remembers what your sessions decided and learned, and hands it to the next one, in any client. Its engine runs on this machine: ${engineSize(!!m.bundled)}.`,
          ),
          acts(
            // The label and the click read the same fact: with no engine yet and its copy here, the one click installs
            // it too; with none here, nothing can, and the click only switches memory on.
            working(!m.installed && m.bundled ? "Turn on memory and install it" : "Turn on memory", "Turning on…", () =>
              d.memoryOn({ install: !m.installed && !!m.bundled }),
            ),
          ),
        ];
      if (!m.installed)
        return [
          says(
            `Memory is on. Until its engine is installed, ${WITHOUT_ENGINE}. The engine is ${engineSize(!!m.bundled)}.`,
          ),
          m.bundled ? acts(working("Install the engine", "Starting…", () => d.install())) : null,
        ].filter(Boolean);
      return [says("Memory is on. ", ...learns(m, f))];
    },
    harness: (_f, done) => [
      says(
        done
          ? "Your tasks wait in its sidebar."
          : "Filament's own coding agent: give it a task in a folder, on any model you connected, with memory beside it.",
      ),
      acts(
        h(
          "a",
          {
            class: `button-link${done ? "" : " primary"}`,
            href: "/ui/harness.html",
            target: "filament-harness",
          },
          "Open the harness",
        ),
      ),
    ],
    tools: (f, _done, o) => [
      says(
        "Point Claude Code, Cursor or a script at Filament: every request gets the routes, the rules, failover and memory, and any model the harness lists answers here too.",
      ),
      h(
        "div",
        { class: "kv step-kv" },
        h("span", {}, "Base URL"),
        d.copyline(`${o.base}/v1`),
        h("span", {}, "API key"),
        o.key ? d.secretLine(o.key) : h("i", { class: "muted" }, "none set"),
        ...(f?.connected?.example ? [h("span", {}, "Model"), d.copyline(f.connected.example)] : []),
      ),
    ],
  };
  return {
    /** The steps, open. @param {any} f @param {{ base: string, key: string | null }} o */
    steps: (f, o) =>
      h(
        "ol",
        { class: "steps get-started" },
        ...startSteps(f).map((s, i) =>
          h(
            "li",
            { class: `step${s.done ? " done" : ""}` },
            mark(s.done),
            h(
              "div",
              {},
              h("b", {}, `${i + 1} · ${s.title}`),
              s.optional ? h("span", { class: "muted small" }, " · optional") : null,
              ...body[s.id](f, s.done, o),
            ),
          ),
        ),
      ),
    /** Folded: each step's tick on one line; a click opens the steps again. @param {any} f */
    line: (f) =>
      h(
        "button",
        { type: "button", class: "get-started-line", title: "Open Get started", onclick: () => d.open() },
        h("b", {}, "Get started"),
        ...startSteps(f).map((s) =>
          h("span", { class: `gs-tick${s.done ? " done" : ""}` }, mark(s.done), s.title),
        ),
        h("span", { class: "gs-open" }, "Open"),
      ),
  };
}

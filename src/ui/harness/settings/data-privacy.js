// @ts-check
// Settings › Data and privacy (HarnessV4_Settings_Plan HS-4): how much of your conversations the request log keeps and
// how far back it reaches, which warns how fast it rolls when whole bodies are kept (HC-69, ui/lib/log-reach.js, the
// console's words too); how long runs and their pictures are kept; where Filament keeps its data; the alerts. Kept at
// once (lib/config-rows.js). The rows are the owner's of 11-09, each in a person's words: the log's other settings are
// the console's (Settings › Observability), which draws every one.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { ICONS } from "../lib/icons.js";
import { mountConfigPage } from "../lib/config-rows.js";
import { toggle } from "../lib/fields.js";
import { reachWords } from "../../lib/log-reach.js";

/** Settings search's words for this page (search.js, HS-D68): each row it draws, checked against its code by a test;
 *  the alerts' group as drawn, so a new alert is found too. */
export const SEARCH_ROWS = Object.freeze([
  { path: "observability.storeBodies", label: "Your conversations in the log" },
  { path: "observability.storeInternalBodies", label: "Filament's own calls in the log" },
  { path: "observability.runEvents.retentionDays", label: "Keep runs for" },
  { path: "observability.runEvents.imagesMaxMB", label: "Room for pictures" },
  { label: "Data folder" },
  { label: "Configuration file", words: "config.json" },
  { group: "alerts", skip: ["alerts.dailyCostUsd"] },
  { path: "alerts.dailyCostUsd", label: "A day's spend" },
  { path: "telemetry.enabled", label: "Anonymous usage statistics", words: "telemetry analytics DO_NOT_TRACK" },
  { label: "What's sent", words: "telemetry payload" },
]);

/** Why telemetry sends nothing, in a person's words; null while it sends. @param {any} v  `GET /telemetry` */
export function telemetryWords(v) {
  if (!v) return null;
  if (v.why === "DO_NOT_TRACK") return "Off: DO_NOT_TRACK is set where Filament runs, and the switch can't turn it back on.";
  if (v.why === "FILAMENT_TELEMETRY") return "Off: FILAMENT_TELEMETRY=0 is set where Filament runs, and the switch can't turn it back on.";
  if (v.why === "not-armed") return "This Filament sends nothing: it runs in a test or inside another program, not as Filament itself.";
  if (v.why === "unofficial") return "Official builds from filamentdev.com send anonymous usage counts unless you turn them off; builds you make yourself, as this one is, send nothing unless you turn them on.";
  if (v.why === "notice") return "Nothing is sent until Filament's notice about it has been shown.";
  if (v.why === "setting") return null;
  return v.on ? "On. Nothing is sent but what Show what's sent shows." : null;
}

/**
 * Whether the switch shows on: the person's own choice where they made one, else what this build does — on in an
 * official build, off in one made elsewhere (`GET /telemetry`'s `onByDefault`).
 * @param {unknown} stored  `telemetry.enabled` as kept @param {any} v  `GET /telemetry`
 */
export const telemetrySwitchOn = (stored, v) => (typeof stored === "boolean" ? stored : v?.onByDefault === true);

/** A moment as the page says it: the day and the time. @param {string | number} at */
const when = (at) => new Date(at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * @param {HTMLElement} body
 * @param {{ onToast?: (msg: string, kind?: string) => void, onChanged?: () => void }} [cb]
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, copy?: (text: string) => Promise<void>, now?: () => number }} [io]
 */
export function renderDataPrivacy(body, cb = {}, io = {}) {
  const m = io.h || h;
  const copy = io.copy || ((/** @type {string} */ text) => navigator.clipboard.writeText(text));
  const toast = cb.onToast || (() => {});
  const now = io.now || Date.now;
  const call = io.api || api;
  mountConfigPage(body, cb, { ...io, api: call }, {
    rows: (kit) => {
      const reach = reachWords(kit.state.logReach, String(kit.value("observability.storeBodies") || ""), when, now());
      // Anonymous telemetry's state is read on its own (`GET /telemetry`): why it sends nothing, what this build does
      // where nothing is chosen — the switch shows it —, and the body last sent.
      const teleNote = m("p", { class: "nset-note hidden" });
      const sent = m("pre", { class: "cset-sent hidden" });
      const teleSwitch = m("span", {});
      const stored = kit.value("telemetry.enabled");
      const drawSwitch = (/** @type {boolean} */ on) => teleSwitch.replaceChildren(toggle(m, on, "Anonymous usage statistics", () => void kit.setField("telemetry.enabled", !on)));
      drawSwitch(telemetrySwitchOn(stored, null));
      void call("/telemetry").then(
        (v) => {
          const w = telemetryWords(v);
          teleNote.textContent = w || "";
          teleNote.classList.toggle("hidden", !w);
          drawSwitch(telemetrySwitchOn(stored, v));
        },
        () => {},
      );
      const showSent = m("button", {
        class: "ghost sm",
        type: "button",
        onclick: () =>
          call("/telemetry").then(
            (v) => {
              sent.textContent = v?.last ? `Sent ${when(v.last.at)}:\n${JSON.stringify(v.last.body, null, 2)}` : "Nothing has been sent from this Filament yet.";
              sent.classList.remove("hidden");
            },
            () => toast("What was sent could not be read", "err"),
          ),
      }, "Show what's sent");
      /** A path with its Copy. @param {string} path @param {string} what */
      const place = (path, what) =>
        m("div", { class: "cset-copy" },
          m("code", { class: "cset-code" }, path),
          m("button", { class: "mset-act", type: "button", title: `Copy ${what}`, "aria-label": `Copy ${what}`, html: ICONS.copy, onclick: () => copy(path).then(() => toast(`Copied ${what}`), () => toast("Copy failed: select it instead", "err")) }));
      return [
        kit.head("How much of your conversations the log keeps"),
        reach ? kit.note(reach.text, reach.heavy ? "warn" : "") : null,
        kit.field("observability.storeBodies", { label: "Your conversations in the log", desc: "What the request log keeps of each request. summary: the model, the sizes, the tools and every change made, never your conversation. none: tokens and timings alone. shaped: the whole conversation as sent to the provider too, secrets hidden; full: and as your app sent it. shaped and full fill the log fast: keep them for debugging." }),
        kit.field("observability.storeInternalBodies", { label: "Filament's own calls in the log", desc: "Also keep what Filament's own calls send — memory's learning, summaries, compaction — which quote your conversation. Off, they keep their tokens, timings and cost alone. For debugging." }),
        kit.head("Runs and their pictures"),
        kit.field("observability.runEvents.retentionDays", { label: "Keep runs for", desc: "Days a run's record is kept: what brings a turn back after a restart, and the pictures its calls showed. A run still going is never removed. 0 keeps them for good." }),
        kit.field("observability.runEvents.imagesMaxMB", { label: "Room for pictures", desc: "Megabytes of the pictures agents read or tools handed them, kept to show on the calls' cards. Past it, the oldest go first. 0 keeps none." }),
        kit.head("Where Filament keeps it"),
        kit.row("Data folder", "The configuration, the request log, the archive of chats and memory's folder unless it names its own.", place(String(kit.state.dataDir || ""), "the folder's path")),
        kit.row("Configuration file", "", place(String(kit.state.configFile || ""), "the file's path")),
        kit.head("Alerts"),
        kit.note("What Filament comes to find you about: a banner on every console page and a line on the tray card."),
        ...kit.group("alerts", { skip: ["alerts.dailyCostUsd"] }),
        // Spend is told, never held against an agent (the owner's of 11-09: no threshold that stops one at work).
        kit.field("alerts.dailyCostUsd", { label: "A day's spend", desc: "An alert once today's spend passes this many dollars, at most once a day. It only tells you: no agent or request is stopped or slowed by it. 0: no alert." }),
        kit.head("Anonymous usage statistics"),
        teleNote,
        kit.field("telemetry.enabled", { label: "Anonymous usage statistics", control: teleSwitch, desc: "Once a day, counts of how Filament was used — tokens, cost and speed by provider kind and model, runs by engine, accounts by kind, requests per hour, the version, system, language and time zone — under an id made for this alone, through filamentdev.com's relay, which drops your address. Never a prompt, a reply, code, a path, a name, a key or an account. DO_NOT_TRACK=1 or FILAMENT_TELEMETRY=0 turns it off too." }),
        kit.row("What's sent", "The last thing this Filament sent, exactly as it went.", showSent),
        sent,
      ].filter(Boolean);
    },
  });
}

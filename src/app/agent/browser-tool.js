// @ts-check
// The `browser` tool (HarnessV4_Browser_Plan BR2): its schema and words, whether a session offers it, and its gate.
// Offered by the session's switch `plugins.browser` alone (BR-D5) — not by whether the desktop app is connected or
// Chrome found on this machine, so the tool's bytes never move with either; a call with neither answers in words
// (app/browser/host.js). The gate:
// looking runs in every mode, as web_fetch does; acting — click, type, press, select, evaluate — is refused in
// read-only, runs in Full access, and in Edit mode asks the developer once per site, a yes kept for the chat (BR-D6).
// A rule names a site by the page the call works on (rules.js `subjectsOf`, BR-D7). Every agent of the chat has it —
// a sub-agent and a fork in tabs of their own, a coding agent through Filament's MCP server (HarnessV4_AgentTools_Plan
// AT-D2, AT-D6, AT-D7; BR-D13 gave sub-agents none). `resize` sets a tab's page to a size of its own, a look and no act
// (HarnessV4_BrowserSize_Plan BS2).
import { ACTIONS, BROWSER, acts, actionOf, actingSteps, browserArgWords, siteOf, wholeUrl } from "../../core/browser.js";

export { BROWSER };

export const BROWSER_TOOL = Object.freeze({
  name: BROWSER,
  description:
    "The browser in the Browser pane beside this chat (the Filament desktop app's Chromium, or Chrome on this machine), which the developer watches as you work and can take over. One profile for every chat, sign-ins kept; this chat's own tabs. Work from the snapshot: the page as a list of its headings, words, buttons, links and fields, each that can be pressed, typed in or chosen with a handle (e12) that stays the same for the same element until the page changes; and act by handle: click, type, select, press. navigate, back, forward, reload and every act end with the page's new snapshot (snapshot: false leaves it out). screenshot shows you the page as a picture; text reads its words; console and network read what the page logged and asked for (a web app's errors). Each tab's page keeps its own size, 1280 × 800 until you resize it (size: desktop, laptop, tablet, phone; or width and height); the pane draws it scaled, so what you see never changes with how the developer watches; the snapshot's first line names the size, and the developer can set it too, which you are told. batch does up to 20 steps in one call and stops at the first that fails. Looking (navigate, back, forward, reload, snapshot, text, screenshot, console, network, scroll, hover, wait, tabs, resize) runs in every permission mode; acting (click, type, press, select, evaluate) asks the developer once per site in Edit mode, runs in Full access, and is refused in read-only. Type no password, card number or other secret the developer did not give you for this page: ask them to take over instead.",
  input_schema: Object.freeze({
    type: "object",
    properties: {
      action: { type: "string", enum: [...ACTIONS], description: "What to do." },
      url: { type: "string", description: "navigate, and tabs new: the address (a bare host gets https://, localhost http://)." },
      ref: { type: "string", description: "click, hover, select, type, scroll: an element's handle from the snapshot, as e12 (type without it types where the focus is)." },
      text: { type: "string", description: "type: the text to type. wait: words to wait for on the page." },
      clear: { type: "boolean", description: "type: empty the field first." },
      submit: { type: "boolean", description: "type: press Enter after." },
      key: { type: "string", description: "press: a key or a combination (Enter, Tab, Escape, ArrowDown, Control+A)." },
      value: { type: "string", description: "select: the option's value or its words." },
      double: { type: "boolean", description: "click: a double click." },
      direction: { type: "string", enum: ["down", "up", "left", "right"], description: "scroll without ref: which way, a screen's worth (down by default)." },
      amount: { type: "number", description: "scroll: how far, in pixels." },
      expression: { type: "string", description: "evaluate: JavaScript run in the page; its value comes back as JSON." },
      ms: { type: "number", description: "wait: how long, 30000 at the most; with text, how long to wait for it (10000 by default)." },
      gone: { type: "boolean", description: "wait with text: wait until it is gone." },
      errors: { type: "boolean", description: "console: errors and warnings only." },
      failed: { type: "boolean", description: "network: only the requests that failed or answered 400 or more." },
      op: { type: "string", enum: ["list", "new", "select", "close"], description: "tabs: list them (the default), open a new one (url), show one or close one (tab)." },
      tab: { type: "string", description: "tabs select and close: the tab's id, as tabs list names it." },
      size: { type: "string", enum: ["desktop", "laptop", "tablet", "phone"], description: "resize: desktop 1440 × 900, laptop 1280 × 800 (the default), tablet 820 × 1180, phone 390 × 844." },
      width: { type: "number", description: "resize without size: the page's width in CSS pixels, 320–2560." },
      height: { type: "number", description: "resize without size: the page's height in CSS pixels, 320–1600." },
      steps: { type: "array", items: { type: "object" }, description: "batch: the steps, each an object with its own action and fields (no batch or tabs among them), done in order." },
      snapshot: { type: "boolean", description: "false: no snapshot after this call's navigation or act." },
    },
    required: ["action"],
  }),
});

/**
 * Whether a session offers the tool: its switch on, and not switched off in its tools (`loop.tools`).
 * @param {any} doc  the effective settings document @param {readonly string[]} [off]  the tools switched off
 */
export const browserOffered = (doc, off = []) => doc?.plugins?.browser === true && !off.includes(BROWSER);

/**
 * The site a call first acts on: the page's for one act, a batch's at its first acting step — after the navigations
 * before it. "" where it acts on no web page (none yet, about:blank) or does not act.
 * @param {any} input @param {string} page  the address the chat's browser shows now
 */
export function actingSite(input, page) {
  if (actionOf(input) !== "batch") return acts(input) ? siteOf(page) : "";
  let at = String(page || "");
  for (const s of Array.isArray(input?.steps) ? input.steps : []) {
    if (actionOf(s) === "navigate") at = wholeUrl(String(s.url || ""));
    else if (acts(s)) return siteOf(at);
  }
  return "";
}

/**
 * The question an act on a site asks the developer. A team's worker's (`team`) its lead may answer too, and the words
 * say what each allow holds for: the developer's for every agent of the chat, its lead's for that team's workers alone.
 * @param {string} site @param {any} input @param {import("../browser/registry.js").TeamOf | null} [team]
 */
export function browserQuestion(site, input, team = null) {
  const first = actingSteps(input)[0] || input;
  const holds = team
    ? `An allow holds for the rest of this chat — yours for every agent of it, my lead's for the ${team.name} team's workers alone (the Browser pane's ⋯ takes either back)`
    : `An allow lets me act on ${site} for the rest of this chat (the Browser pane's ⋯ takes it back)`;
  return `May I act on ${site} in the browser? First: ${browserArgWords(first)}. ${holds}; looking needs none. Answer /allow, or say what to do instead.`;
}

/** Read-only's refusal of an act, in the words the model reads. */
export const BROWSER_READ_ONLY =
  "Not run: this chat is read-only — the browser may look (navigate, snapshot, text, screenshot, console, network) but not act on a page (click, type, press, select, evaluate). Say what you would have done, or ask the developer to change the mode.";

/**
 * The gate for one call of the tool (BR-D6): looking runs; acting is refused in read-only, runs in Full access, and in
 * Edit mode runs on a site the developer said yes to for this chat, else asks — a team's worker (`team`) in words that
 * say its lead's yes holds for its team alone.
 * @param {import("./prompt.js").PermissionMode} mode @param {any} input
 * @param {{ page?: string, allowed?: (site: string) => boolean, team?: import("../browser/registry.js").TeamOf | null }} [o]
 * @returns {{ verdict: "run" } | { verdict: "ask", question: string } | { verdict: "refuse", text: string }}
 */
export function browserGate(mode, input, { page = "", allowed = () => false, team = null } = {}) {
  if (!actingSteps(input).length) return { verdict: "run" };
  if (mode === "read-only") return { verdict: "refuse", text: BROWSER_READ_ONLY };
  if (mode === "auto") return { verdict: "run" };
  const site = actingSite(input, page);
  if (!site || allowed(site)) return { verdict: "run" };
  return { verdict: "ask", question: browserQuestion(site, input, team) };
}

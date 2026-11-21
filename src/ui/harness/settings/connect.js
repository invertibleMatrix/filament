// @ts-check
// Settings › Connect other apps (HarnessV4_Settings_Plan HS-4): what another program needs to use Filament. Its address
// without and with /v1, each with the apps that take it; the inbound keys, masked, where Copy puts one on the clipboard and nowhere else (HC-63) and a new key
// leaves the four before it working (HC-64); a block to copy for Claude Code, Codex or an SDK, which names the key
// and never holds it; memory's door for other agents (lib/memory-door.js). The host and port are kept at once and wait
// for a restart, which the page says while they do (HC-67). Built with an injected `h`, `api` and clipboard, so it runs
// on the fake DOM.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { ICONS } from "../lib/icons.js";
import { segment } from "../lib/fields.js";
import { mountConfigPage } from "../lib/config-rows.js";
import { memoryDoor } from "../lib/memory-door.js";
import { hostAndPort } from "../../lib/format.js";

/** What a block names in the key's place. */
const KEY = "<your inbound key>";
/** How many keys Filament keeps: a new one and the four before it (`POST /api/keys/rotate`). */
const KEPT_KEYS = 5;

/** Settings search's words for this page (search.js, HS-D68): each row it draws, checked against its code by a test. */
export const SEARCH_ROWS = Object.freeze([
  { label: "Address", words: "url base" },
  { label: "Address with /v1", words: "openai compatible" },
  { path: "server.host", label: "Listens on" },
  { path: "server.port", label: "Port" },
  { label: "Newest key", words: "api key inbound bearer" },
  { label: "New key", words: "rotate" },
  { path: "server.requireAuth", label: "Ask apps for a key" },
  { label: "Set up an app", words: "Claude Code Codex SDK" },
  { label: "Other agents", words: "memory door mcp" },
  { path: "server.allowedHosts" },
  { path: "server.advertiseEffortSuffixes" },
]);

/**
 * Where Filament listens, as Listens on offers it (the owner's of 11-09): this computer alone, or every address it has.
 * Any other the configuration holds is shown and kept until one of these is picked.
 */
export const HOSTS = Object.freeze([
  { value: "127.0.0.1", label: "This computer only", title: "127.0.0.1" },
  { value: "0.0.0.0", label: "Every network address", title: "0.0.0.0" },
]);

/**
 * The setup blocks, by app: where the block goes, the block for the two addresses, and what to do after.
 * @type {readonly { value: string, label: string, where: string, text: (a: { anthropic: string, openai: string }) => string, after: string }[]}
 */
export const SETUPS = Object.freeze([
  {
    value: "claude",
    label: "Claude Code",
    where: "In ~/.claude/settings.json, or a project's .claude/settings.json:",
    text: (a) => JSON.stringify({ env: { ANTHROPIC_BASE_URL: a.anthropic, ANTHROPIC_AUTH_TOKEN: KEY } }, null, 2),
    after: "Claude Code asks for models by name: pick one Filament serves with /model, as each provider's page in Settings › Providers lists them.",
  },
  {
    value: "codex",
    label: "Codex",
    where: "In ~/.codex/config.toml, with FILAMENT_KEY set to your key where Codex starts:",
    text: (a) => `model_provider = "filament"\nmodel = "<a model name>"\n\n[model_providers.filament]\nname = "filament"\nbase_url = "${a.openai}"\nenv_key = "FILAMENT_KEY"\nwire_api = "responses"`,
    after: "Any model Filament serves works through Codex's Responses calls.",
  },
  {
    value: "sdk",
    label: "An SDK",
    where: "Python, with either SDK (the others take the same two values):",
    text: (a) => `from anthropic import Anthropic\nclient = Anthropic(base_url="${a.anthropic}", api_key="${KEY}")\n\nfrom openai import OpenAI\nclient = OpenAI(base_url="${a.openai}", api_key="${KEY}")`,
    after: "Both formats answer on one address, and any model works through either.",
  },
]);

/** What a new key did, with `before` keys kept before it (HC-64). @param {number} before */
export function rotateWords(before) {
  const kept = Math.min(before, KEPT_KEYS - 1);
  return [
    "A new key is first in the list.",
    kept === 1 ? "The one before it keeps working." : kept ? `The ${kept} before it keep working.` : "",
    before >= KEPT_KEYS ? "The oldest stopped working." : "",
  ].filter(Boolean).join(" ");
}

/** A key masked as Filament masks it (the configuration's `inboundKeysMasked`). @param {string} s */
const masked = (s) => (typeof s === "string" && s.length > 8 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s ? "••••" : "");

/**
 * @param {HTMLElement} body
 * @param {{ onToast?: (msg: string, kind?: string) => void, onChanged?: () => void }} [cb]
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, origin?: string, copy?: (text: string) => Promise<void> }} [io]
 *   `origin`: where this page is served, which an app on this machine reaches Filament at
 */
export function renderConnect(body, cb = {}, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const origin = io.origin ?? globalThis.location?.origin ?? "";
  const copy = io.copy || ((/** @type {string} */ text) => navigator.clipboard.writeText(text));
  const toast = cb.onToast || (() => {});
  const addr = { anthropic: origin, openai: `${origin}/v1` };

  /** Text with its Copy. @param {string} text @param {string} what  the toast's name for it */
  const copyable = (text, what) =>
    m("div", { class: "cset-copy" },
      m("code", { class: "cset-code" }, text),
      m("button", { class: "mset-act", type: "button", title: `Copy ${what}`, "aria-label": `Copy ${what}`, html: ICONS.copy, onclick: () => copy(text).then(() => toast(`Copied ${what}`), () => toast("Copy failed: select it instead", "err")) }));

  // The block picked stays picked when the page is drawn again; the door is read once.
  let setup = "claude";
  const setupEl = m("div", { class: "cset-setup" });
  const paintSetup = () => {
    const s = SETUPS.find((x) => x.value === setup) || SETUPS[0];
    const text = s.text(addr);
    setupEl.replaceChildren(
      segment(m, SETUPS.map((x) => ({ value: x.value, label: x.label })), s.value, (v) => { setup = v; paintSetup(); }, "The app to set up"),
      m("p", { class: "nset-note" }, s.where),
      m("div", { class: "cset-block" },
        m("pre", { class: "cset-pre" }, text),
        m("button", { class: "mset-act cset-block-copy", type: "button", title: "Copy the block", "aria-label": "Copy the block", html: ICONS.copy, onclick: () => copy(text).then(() => toast("Copied: fill in your key where it says so"), () => toast("Copy failed: select the block instead", "err")) })),
      m("p", { class: "nset-note" }, `${s.after} The block names your key and never holds it: copy a key from the list above.`));
  };
  paintSetup();
  const doorEl = m("div", {});
  call("/memory/mcp")
    .then((door) => {
      const part = memoryDoor(m, door, { origin, copy, toast });
      doorEl.replaceChildren(m("div", { class: "settings-row nset-row is-wide" },
        m("div", { class: "settings-row-text" }, m("div", { class: "settings-row-label" }, part.label), m("div", { class: "settings-row-desc" }, part.desc)),
        m("div", { class: "nset-wide" }, part.control)));
    })
    .catch(() => {});

  mountConfigPage(body, cb, io, {
    rows: (kit) => {
      const server = kit.cfg.server || {};
      const at = kit.state.listening;
      const waits = at && (server.host !== at.host || server.port !== at.port);
      const host = String(server.host ?? "");
      const otherHost = !HOSTS.some((x) => x.value === host);
      /** @type {string[]} */
      const shown = Array.isArray(server.inboundKeysMasked) ? server.inboundKeysMasked : [];

      /** Key `i` to the clipboard, only once the key read is the one the page shows. @param {number} i */
      const copyKey = async (i) => {
        try {
          const keys = (await call("/keys"))?.keys || [];
          if (typeof keys[i] !== "string" || masked(keys[i]) !== shown[i]) {
            toast("The keys changed since the page read them: here they are as they stand", "err");
            return void kit.redraw();
          }
          await copy(keys[i]);
          toast("Key copied: paste it where the app asks for an API key");
        } catch (/** @type {any} */ e) {
          toast(`Not copied: ${String(e?.body?.error || e?.message || e)}`, "err");
        }
      };
      const rotate = async () => {
        const before = shown.length;
        try {
          await call("/keys/rotate", { method: "POST", body: {} });
          toast(rotateWords(before));
        } catch (/** @type {any} */ e) {
          toast(`No new key: ${String(e?.body?.error || e?.message || e)}`, "err");
        }
        await kit.redraw();
      };

      return [
        kit.head("Address"),
        kit.row("Address", "For Claude Code and the Anthropic SDKs, which add /v1/messages themselves.", copyable(addr.anthropic, "the address")),
        kit.row("Address with /v1", "For Codex, the OpenAI SDKs and most “OpenAI-compatible” apps, which add /messages, /chat/completions or /responses.", copyable(addr.openai, "the address with /v1")),
        waits ? kit.note(`Saved: ${hostAndPort(server.host, server.port)}. Filament listens at ${hostAndPort(at.host, at.port)} until it restarts (About › Restart Filament).`, "warn") : null,
        kit.field("server.host", {
          label: "Listens on",
          desc: `${otherHost ? `Now ${host || "empty"}, as Filament's configuration says: it stays until you pick one. ` : ""}This computer only keeps Filament to this machine; every network address lets other machines reach it too. Takes effect after a restart. For a phone or another computer, Settings › Remote access pairs it with a code.`,
          control: segment(m, HOSTS, host, (v) => { if (v !== host) void kit.setField("server.host", v); }, "Listens on"),
        }),
        // Open beyond this machine with no agentLoop.roots: the server's words (`exposed` on /state).
        kit.state?.exposed ? kit.note(kit.state.exposed, "warn") : null,
        kit.field("server.port", { label: "Port", desc: "Takes effect after a restart." }),
        kit.head("Keys"),
        kit.note(`Apps send one as Authorization: Bearer or x-api-key. Filament keeps ${KEPT_KEYS}: a new key comes first and the four before it keep working.`),
        ...shown.map((k, i) => kit.row(i === 0 ? "Newest key" : `Key ${i + 1}`, "",
          m("div", { class: "cset-copy" },
            m("code", { class: "cset-code" }, k),
            m("button", { class: "ghost sm", type: "button", title: "Copy this key to the clipboard", onclick: () => void copyKey(i) }, "Copy")))),
        shown.length ? null : kit.note("No key yet: make one, and apps can reach Filament with it."),
        kit.row("New key", "For an app you no longer trust with an old one: the new key comes first in the list.",
          m("button", { class: "ghost sm", type: "button", onclick: () => void rotate() }, "Make a new key")),
        kit.field("server.requireAuth", { label: "Ask apps for a key" }),
        kit.head("Set up an app"),
        setupEl,
        kit.head("Memory for other agents"),
        doorEl,
        kit.head("Advanced"),
        kit.field("server.allowedHosts"),
        kit.field("server.advertiseEffortSuffixes"),
      ].filter(Boolean);
    },
  });
}

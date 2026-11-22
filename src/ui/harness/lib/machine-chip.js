// @ts-check
// The machine chip (the owner's of 11-08, from the Mac over LAN: a dropdown left of Changes in the rail's place): in the
// desktop app, once another machine is kept beside this one, the header's chip says which machine this page is — its
// state's dot, its icon in its colour (the remote desk of 11-22), its name — and how many chats wait on you on the
// others; a press opens the app's own popover under it
// (desktop/lib/rail.js), where another machine is picked or added. What it hears and asks goes through the app's
// `filamentMachines` — This computer's page has it (harness-preload.cjs), another machine's page in the window has it
// alone (machine-preload.cjs) —; in a browser there is none, and no chip.
import { h, setHtml } from "../../lib/dom.js";
import { glyphOf, icon } from "./icons.js";

/** The state's words, as the popover says them. */
const STATE_WORDS = { online: "connected", reconnecting: "reconnecting", offline: "offline" };
/** The colours a machine wears (desktop/lib/machines.js MACHINE_COLORS): a class of the chip's icon each. */
const COLORS = ["blue", "orange", "green", "purple", "teal", "pink", "indigo", "yellow"];
/** Its icons (MACHINE_ICONS): one the app says that the page has not drawn none. */
const ICONS = ["monitor", "laptop", "server", "cloud", "house", "terminal"];

/**
 * The chip, or null where no bridge is: hidden until the app says another machine is kept, then drawn as each state
 * the app sends says — and its press asks the app for the popover at its rectangle.
 * @param {{ bridge?: any, tip?: (el: HTMLElement, o: { title: string | (() => string) }) => void }} [o]  `bridge`: the app's
 *   `filamentMachines`; `tip`: the header's tooltip
 * @returns {{ el: HTMLButtonElement, stop: () => void } | null}
 */
export function machineChip({ bridge = /** @type {any} */ (globalThis).filamentMachines, tip } = {}) {
  if (!bridge || typeof bridge.onState !== "function" || typeof bridge.open !== "function") return null;
  const dot = h("i", { class: "mc-dot", "aria-hidden": "true" });
  const face = h("span", { class: "mc-ic", "aria-hidden": "true", hidden: true });
  const name = h("span", { class: "pbtn-label mc-name" });
  const count = h("span", { class: "mc-count", hidden: true });
  const el = /** @type {HTMLButtonElement} */ (
    h("button", { class: "pbtn hdr-machine hidden", type: "button", "aria-haspopup": "menu", "aria-expanded": "false" }, dot, face, name, h("span", { class: "pbtn-chev", html: icon("chevronDown") }), count)
  );
  /** The icon drawn now, by its name and colour: drawn again only when either moves. */
  let faced = "";
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    const r = el.getBoundingClientRect();
    bridge.open({ x: r.left, y: r.top, width: r.width, height: r.height });
  });
  /** Its tooltip's words, as the last state said them. */
  let titled = "";
  if (tip) tip(el, { title: () => titled });
  const stop = bridge.onState((/** @type {any} */ s) => {
    const shown = !!s?.shown;
    el.classList.toggle("hidden", !shown);
    if (!shown) return;
    const status = s.status === "online" || s.status === "offline" ? s.status : "reconnecting";
    const n = Math.max(0, Math.floor(Number(s.waiting) || 0));
    const who = String(s.name || "");
    dot.className = `mc-dot s-${status}`;
    // Its icon in its colour, where the app says one (an app before the remote desk says none).
    const ic = ICONS.includes(s.icon) ? String(s.icon) : "";
    const tone = COLORS.includes(s.color) ? String(s.color) : "";
    if (`${ic} ${tone}` !== faced) {
      faced = `${ic} ${tone}`;
      face.hidden = !ic;
      face.className = `mc-ic${tone ? ` c-${tone}` : ""}`;
      setHtml(face, ic ? glyphOf(ic) : "");
    }
    name.textContent = who;
    count.hidden = !n;
    count.textContent = n ? (n > 99 ? "99+" : String(n)) : "";
    el.classList.toggle("on", !!s.open);
    el.setAttribute("aria-expanded", String(!!s.open));
    const away = n ? ` · ${n} chat${n === 1 ? " waits" : "s wait"} on you on another machine` : "";
    el.setAttribute("aria-label", `Machine: ${who}, ${STATE_WORDS[status]}${away}`);
    titled = `${who} — ${STATE_WORDS[status]}${away}. Switch machine`;
    if (!tip) el.title = titled;
  });
  return { el, stop: typeof stop === "function" ? stop : () => {} };
}

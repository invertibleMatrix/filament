// @ts-check
// The Appearance section (§5.10): the theme and UI font size, the code font size, and under Chat the transcript
// switches (reasoning, todos, the three groups), the status panel mode and performance mode. Rows write prefs; the
// regions that read them repaint live or on the next render.
import { prefs } from "../prefs.js";
import { themePref, setThemePref, uiFontSize, setUiFontSize, codeFontSize, setCodeFontSize, motionPref, setMotionPref } from "../theme.js";
import { row, switchControl, selectControl, numberControl, segmented, groupDoc } from "./rows.js";
import { STATUS_PLACES } from "../conversation/status-panel.js";

/** Settings search's words for this page (search.js, HS-D68): each row it draws, checked against its code by a test. */
export const SEARCH_ROWS = Object.freeze([
  { label: "App theme", words: "light dark system" },
  { label: "Animations", words: "motion reduced" },
  { label: "UI font size", words: "text size" },
  { label: "Code font size" },
  { label: "Show reasoning", words: "thinking" },
  { label: "Show todos" },
  { label: "Group exploration tools", words: "explore" },
  { label: "Group terminal commands" },
  { label: "Group file changes" },
  { label: "Chat status", words: "status panel capsule floating header working" },
  { label: "Performance mode", words: "plain text streaming" },
]);

/** @param {HTMLElement} body */
export function renderAppearance(body) {
  const theme = segmented({
    value: themePref(),
    options: [
      { value: "system", label: "System" },
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
    ],
    onChange: (v) => setThemePref(/** @type {"system"|"light"|"dark"} */ (v)),
  });
  const motion = segmented({
    value: motionPref(),
    options: [
      { value: "full", label: "Full" },
      { value: "reduced", label: "Reduced" },
      { value: "off", label: "Off" },
    ],
    onChange: (v) => setMotionPref(/** @type {"full"|"reduced"|"off"} */ (v)),
  });
  const status = selectControl({
    value: String(prefs.get("statusPanel") || "composer"),
    options: STATUS_PLACES.map((x) => ({ value: x.value, label: x.label })),
    label: "Chat status",
    onChange: (v) => prefs.set("statusPanel", v),
  });
  const onOff = (key, label, desc) => row(label, desc, switchControl({
    checked: prefs.get(key) !== false,
    label,
    onChange: (on) => prefs.set(key, on),
  }));

  body.replaceChildren(
    row("App theme", "Choose light, dark, or follow the system theme.", theme.el),
    row("Animations", "Panel slides, arriving blocks and streaming motion — transforms and opacity only, on the GPU. A system reduced-motion preference starts this at Reduced.", motion.el),
    row("UI font size", "Adjust interface text without changing icons or layout dimensions.",
      numberControl({ value: uiFontSize(), min: 12, max: 20, step: 1, label: "UI font size", onCommit: setUiFontSize })),
    groupDoc("Code preview"),
    row("Code font size", "The code blocks and the terminal card; 12 to 20.",
      numberControl({ value: codeFontSize(), min: 12, max: 20, step: 1, label: "Code font size", onCommit: setCodeFontSize })),
    // What the chat shows and where, apart from code (the owner's of 11-09: none of these is about code).
    groupDoc("Chat"),
    onOff("showReasoning", "Show reasoning", "Show thinking blocks in the message stream."),
    onOff("showTodos", "Show todos", "Show Todo tool cards inside the message stream."),
    onOff("groupExplore", "Group exploration tools", "Group consecutive reads and searches into an Explore section."),
    onOff("groupTerminal", "Group terminal commands", "Group consecutive non-read-only shell commands into a Terminal section."),
    onOff("groupChanges", "Group file changes", "Group consecutive Write, Edit, and ApplyPatch calls into a Changes section."),
    row("Chat status", "Where what the chat is doing shows: the capsule under the message box, or a panel floating over the chat.", status),
    // What it does (lib/md-stream.js `mdChat`): a streaming reply's open block paints as plain text (the owner's of 11-09).
    onOff("performanceMode", "Performance mode", "The part of a reply still being written shows as plain text, and takes its formatting once it is done: less work for the page while replies stream."),
  );
}

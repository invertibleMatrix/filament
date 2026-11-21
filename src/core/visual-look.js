// @ts-check
// What a visual may load and the names it reads its look by (HarnessV4_Visuals_Plan, E16): the hosts its frame lets
// it load scripts and fonts from (VS-D4), and the color and type names the page gives it from the harness's theme
// (VS-D5). One list for the guide that names them to the agent, the frame that defines them, and an artifact's
// policy and the sheet its page reads its look from (HarnessV4_Artifacts_Plan AF-D15; VS-D17).

/**
 * The hosts a visual loads its libraries and fonts from; nothing else loads or connects. Google Fonts is two: its
 * sheets and its font files.
 */
export const VISUAL_HOSTS = Object.freeze([
  "https://cdnjs.cloudflare.com",
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://esm.sh",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
]);

/** Whether a visual's code draws one SVG (an XML prolog and comments may come first). @param {string} code */
export const isSvg = (code) => /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(code);

/** The hues a visual may color by, each a strong color and a fill its text reads on. */
export const VISUAL_HUES = Object.freeze(["blue", "indigo", "purple", "pink", "red", "orange", "yellow", "green", "teal", "gray"]);

/** How many series colors a chart takes, in order. */
export const VISUAL_SERIES = 6;

/**
 * Every name a visual's code reads its look by, with what it is for, in the order the guide lists them.
 * @type {Readonly<Record<string, string>>}
 */
export const VISUAL_NAMES = Object.freeze({
  "--text": "text: words, labels, values",
  "--text-muted": "secondary text: captions, axis labels, notes",
  "--text-faint": "the quietest text: hints, what is off",
  "--surface": "a box's or a card's fill, a shade apart from the background",
  "--surface-raised": "a card raised above another",
  "--line": "hairlines: borders, dividers, grid lines",
  "--line-strong": "a line that must show: an outline, a divider that means something",
  "--accent": "the one primary action, a selection, a focus ring",
  "--on-accent": "text on the accent",
  ...Object.fromEntries(VISUAL_HUES.flatMap((h) => [[`--${h}`, `${h}: lines, marks, colored text`], [`--${h}-fill`, `a ${h} tint for a box's fill; --text reads on it`]])),
  ...Object.fromEntries(Array.from({ length: VISUAL_SERIES }, (_, i) => [`--series-${i + 1}`, `a chart's series ${i + 1}`])),
  "--font": "the harness's sans-serif",
  "--mono": "its monospace, for code and figures in columns",
  "--radius": "a card's corner (12px)",
  "--radius-sm": "a control's or a small box's corner (8px)",
});

/**
 * Where each name comes from in the harness's theme (VS-D5): text, surfaces, lines and the accent from the Aqua tokens
 * the chat itself is drawn in, the hues from the system colors, the series from the usage charts'. A hue's fill is its
 * color, faint (`FILL_ALPHA`). A visual's frame and an artifact's page read them the same way (AF-D15).
 * @type {Readonly<Record<string, string>>}
 */
export const LOOK_TOKENS = Object.freeze({
  "--text": "--color-foreground",
  "--text-muted": "--color-foreground-subtle",
  "--text-faint": "--color-foreground-subtlest",
  "--surface": "--aq-card",
  "--surface-raised": "--color-card",
  "--line": "--aq-hairline",
  "--line-strong": "--aq-hairline-strong",
  "--accent": "--aq-accent",
  "--on-accent": "--color-on-accent",
  ...Object.fromEntries(VISUAL_HUES.map((h) => [`--${h}`, `--color-sys-${h}`])),
  ...Object.fromEntries(Array.from({ length: VISUAL_SERIES }, (_, i) => [`--series-${i + 1}`, `--color-usage-chart-${i + 1}`])),
  "--font": "--font",
  "--mono": "--mono",
  "--radius": "--r",
  "--radius-sm": "--r-sm",
});
/** How strong a hue's fill is, so `--text` reads on it: a dark page needs a little more. */
export const FILL_ALPHA = Object.freeze({ dark: 0.22, light: 0.14 });
/** The names that are no colors: a page reads them as they are. */
export const NOT_COLORS = Object.freeze(["--font", "--mono", "--radius", "--radius-sm"]);

/** Claude desktop's hues for a tint, by the hue of Filament's that stands for each. */
const DESKTOP_TINTS = Object.freeze({ red: "red", orange: "orange", yellow: "yellow", green: "green", aqua: "teal", blue: "blue", violet: "purple", magenta: "pink" });
/** Claude desktop's color classes for an SVG shape, by the hue of Filament's that stands for each. */
const DESKTOP_RAMPS = Object.freeze({ purple: "purple", teal: "teal", coral: "orange", pink: "pink", gray: "gray", blue: "blue", green: "green", amber: "yellow", red: "red" });
/** Claude desktop's roles, by the hue of Filament's that stands for each; accent is Filament's own. */
const DESKTOP_ROLES = Object.freeze({ danger: "red", success: "green", warning: "yellow", pro: "purple" });

/**
 * Claude desktop's names for its look, each given the value of Filament's name that does the same job (VS-D56): its
 * text, surfaces, borders, roles, tints, fonts and spacing. Its `--text-muted` is quieter than Filament's and its
 * `--radius` a control's, so in such a frame those two take Claude desktop's meaning.
 * @param {{ names: Record<string, string>, background: string }} look  Filament's names, and the page's background
 * @returns {Record<string, string>}
 */
export function desktopNames(look) {
  const n = look.names;
  /** @type {Record<string, string>} */
  const out = {
    "--text-primary": n["--text"],
    "--text-secondary": n["--text-muted"],
    "--text-muted": n["--text-faint"],
    "--text-disabled": n["--text-faint"],
    "--p": n["--text"],
    "--s": n["--text-muted"],
    "--t": n["--text-faint"],
    "--surface-0": look.background,
    "--surface-1": n["--surface"],
    "--surface-2": n["--surface-raised"],
    "--surface-3": n["--surface-raised"],
    "--surface-panel": n["--surface-raised"],
    "--surface-popover": n["--surface-raised"],
    "--bg2": n["--surface"],
    "--border": n["--line"],
    "--border-strong": n["--line-strong"],
    "--border-stronger": n["--line-strong"],
    "--b": n["--line"],
    "--text-accent": n["--accent"],
    "--fill-accent": n["--accent"],
    "--fill-accent-hover": n["--accent"],
    "--border-accent": n["--accent"],
    "--bg-accent": n["--blue-fill"],
    "--bg-accent-muted": n["--blue-fill"],
    "--on-accent": n["--on-accent"],
    "--fill-primary": n["--text"],
    "--fill-primary-hover": n["--text-muted"],
    "--on-primary": look.background,
    "--fill-secondary": "transparent",
    "--fill-secondary-hover": n["--surface"],
    "--fill-ghost-hover": n["--surface"],
    "--fill-ghost-selected": n["--gray-fill"],
    "--fill-control": n["--gray-fill"],
    "--fill-control-hover": n["--surface-raised"],
    "--fill-disabled": n["--surface"],
    "--fill-field": "transparent",
    "--font-sans": n["--font"],
    "--font-voice": n["--font"],
    "--font-mono": n["--mono"],
    "--radius": n["--radius-sm"],
    "--h-control": "32px",
    "--pad-sm": "8px",
    "--pad-md": "12px",
    "--pad-lg": "16px",
    "--pad-xl": "24px",
    "--gap-xs": "4px",
    "--gap-sm": "8px",
    "--gap-md": "12px",
    "--gap-lg": "16px",
    "--gap-xl": "24px",
  };
  for (const [role, hue] of Object.entries(DESKTOP_ROLES)) {
    // A warning's words read in orange: yellow text is lost on a light page.
    out[`--text-${role}`] = n[role === "warning" ? "--orange" : `--${hue}`];
    out[`--fill-${role}`] = n[`--${hue}`];
    out[`--fill-${role}-hover`] = n[`--${hue}`];
    out[`--border-${role}`] = n[`--${hue}`];
    out[`--bg-${role}`] = n[`--${hue}-fill`];
    out[`--on-${role}`] = n["--on-accent"];
  }
  for (const [tint, hue] of Object.entries(DESKTOP_TINTS)) {
    out[`--bg-tint-${tint}`] = n[`--${hue}-fill`];
    out[`--bg-tint-${tint}-opaque`] = n[`--${hue}-fill`];
    out[`--text-tint-${tint}`] = n[`--${hue}`];
  }
  return out;
}

/**
 * Claude desktop's classes for a picture's parts, drawn in Filament's look (VS-D56): an SVG's text (`t`, `ts`, `th`),
 * box, arrow, leader line, clickable node and color classes (`c-teal` …, on a shape or on the group holding it), a
 * line only a screen reader reads, headings, and the buttons and fields its frame styles by itself. Its icon font's
 * marks (`<i class="ti ti-…">`) take no room: Filament has no such font, and an empty mark would leave a gap.
 */
export const DESKTOP_STYLE = [
  ".t,.ts,.th{font-family:var(--font-sans)}",
  ".t{font-size:14px;fill:var(--text-primary)}",
  ".ts{font-size:12px;fill:var(--text-secondary)}",
  ".th{font-size:14px;font-weight:500;fill:var(--text-primary)}",
  ".box{fill:var(--surface-1);stroke:var(--border-strong)}",
  ".arr{fill:none;stroke:var(--text-secondary);stroke-width:1.5px}",
  ".leader{fill:none;stroke:var(--text-muted);stroke-width:.5px;stroke-dasharray:3 3}",
  ".node{cursor:pointer}",
  ".node:hover{opacity:.85}",
  ...Object.entries(DESKTOP_RAMPS).map(([ramp, hue]) => {
    const c = `.c-${ramp}`;
    return `${c}>rect,${c}>circle,${c}>ellipse,${c}>polygon,rect${c},circle${c},ellipse${c}{fill:var(--${hue}-fill);stroke:var(--${hue})}${c}>.t,${c}>.th{fill:var(--text-primary)}${c}>.ts{fill:var(--text-secondary)}`;
  }),
  ".sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}",
  "i.ti{display:none}",
  "h1,h2,h3{font-weight:500;color:var(--text-primary);margin:0 0 .5em}",
  "h1{font-size:22px}",
  "h2{font-size:18px}",
  "h3{font-size:16px}",
  "button{background:transparent;border:.5px solid var(--border-strong);border-radius:var(--radius);padding:6px 12px;cursor:pointer}",
  "button:hover{background:var(--surface-1)}",
  "input:not([type]),input[type=text],input[type=number],input[type=search],input[type=email],select,textarea{background:transparent;border:.5px solid var(--border-strong);border-radius:var(--radius);padding:6px 10px}",
  "input[type=range],input[type=checkbox],input[type=radio]{accent-color:var(--accent)}",
].join("");

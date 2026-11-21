// @ts-check
// The agent's visuals (HarnessV4_Visuals_Plan, E16): a picture it draws with code — an SVG drawing, or an HTML
// fragment with its own style and scripts — that Filament shows in the person's chat, in a closed frame inside the
// agent's answer. Two tools of Filament's own, the same for both engines (VS-D1, VS-D2): `visual_guide` answers with
// Filament's rules for the kinds about to be drawn (VS-D13), and `show_visual` takes the code, which Filament keeps whole
// on the turn it was drawn in (VS-D9), and answers that it was shown — not that it was seen (VS-D8). The loop offers
// them; a coding agent reaches them over Filament's MCP server, or as Cursor's custom tools (agent-tools.js).
import { VISUAL_HOSTS, VISUAL_NAMES } from "../../core/visual-look.js";
import { VISUAL_LINES_MAX, VISUAL_TITLE_MAX as TITLE_MAX, visualLines as loadingOf, visualTitle as titleOf } from "../../core/messages.js";

/** The kinds the guide has a part for. */
export const VISUAL_KINDS = Object.freeze(["diagram", "chart", "mockup", "interactive"]);
export const VISUAL_GUIDE = "visual_guide";
export const SHOW_VISUAL = "show_visual";
/** Both, as a toolset lists them. A session switches visuals off by `show_visual`: the guide goes with it. */
export const VISUAL_TOOL_NAMES = Object.freeze([VISUAL_GUIDE, SHOW_VISUAL]);

/** The hosts as the guide and the tool's description name them. */
const HOSTS_WORDS = "cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com, esm.sh and Google Fonts";

export const VISUAL_GUIDE_TOOL = Object.freeze({
  name: VISUAL_GUIDE,
  description:
    "Filament's rules for a visual you draw in the developer's chat with show_visual: the look (its colors follow light and dark), sizes, what the frame allows, and how a button in it talks back. Read it once in a session before your first visual, naming the kinds you are about to draw; read it again for a kind you have not read yet.",
  input_schema: {
    type: "object",
    required: ["kinds"],
    properties: {
      kinds: {
        type: "array",
        minItems: 1,
        items: { type: "string", enum: [...VISUAL_KINDS] },
        description: "The kinds you are about to draw: diagram (boxes and arrows), chart (numbers), mockup (a screen), interactive (a piece to try).",
      },
    },
  },
});

export const SHOW_VISUAL_TOOL = Object.freeze({
  name: SHOW_VISUAL,
  description:
    "Draw a picture in the developer's chat: an SVG drawing or an HTML fragment, shown inside your answer in a closed frame at the chat's width, its height following what you draw. Draw when a picture says it better than words (how parts connect, how numbers compare, what a screen could look like, something to try), not for what a sentence, a list or a table says as well. Read visual_guide first. The basics: send a fragment, never a whole page (no <!DOCTYPE>, <html>, <head> or <body>); give an SVG viewBox and width=\"100%\"; take every color from the names the guide lists, so it reads in light and dark; scripts and fonts load only from " +
    `${HOSTS_WORDS}, and nothing else is reachable; no position: fixed, no 100vh, no inner scrolling. The developer sees it; you are told only that it was shown.`,
  input_schema: {
    type: "object",
    required: ["title", "code"],
    properties: {
      title: { type: "string", description: "What it shows, in snake_case (compaction_flow): it heads the visual and names its file." },
      code: { type: "string", description: "An SVG drawing (<svg …>…</svg>), or an HTML fragment (what would go inside <body>) with its <style> first and its <script> last." },
      loading: { type: "array", maxItems: VISUAL_LINES_MAX, items: { type: "string" }, description: "One to four short lines shown while it is drawn." },
    },
  },
});

/** @typedef {{ title: string, code: string, loading: string[] }} Visual */
/**
 * Where a visual is kept: on the turn it was drawn in — or, for a helper no turn launched, on its session (VS-D48) —
 * under its call's id, with the round it was drawn in. → its code's size and its turn's number in the session (what a
 * page asks for it by; null where the session keeps it), or why it was not kept.
 * @typedef {(v: Visual, at: { id: string, round: number | null }) => { ok: true, bytes: number, n: number | null } | { ok: false, error: string }} FileVisual
 */

/** A whole page: its doctype, or the tags a fragment leaves to the frame. */
const WHOLE_PAGE = /<!doctype\b|<(?:html|head|body)(?=[\s>/])/i;
/** A size in the agent's words. @param {number} bytes */
const sizeWords = (bytes) => (bytes < 1024 ? `${bytes} bytes` : `${Math.round(bytes / 1024).toLocaleString("en-US")} KB`);

/**
 * A show_visual call's input as Filament keeps it, or what is wrong with it, in words the agent acts on (VC-15, VC-16):
 * a title, and code that is an SVG drawing or an HTML fragment — a whole page is sent back for its fragment.
 * @param {any} input
 * @returns {{ ok: true, visual: Visual } | { ok: false, error: string }}
 */
export function visualOf(input) {
  const title = titleOf(input?.title);
  if (!title) return { ok: false, error: "Not shown: show_visual needs a title — a short name in snake_case, such as compaction_flow. It heads the visual and names its file." };
  if (title.length > TITLE_MAX) return { ok: false, error: `Not shown: the title is ${title.length} characters; a title is a short name (${TITLE_MAX} at most). Say the rest in your answer.` };
  const code = typeof input?.code === "string" ? input.code : "";
  if (!code.trim()) return { ok: false, error: "Not shown: show_visual needs code — an SVG drawing (<svg …>…</svg>), or an HTML fragment with its <style> and <script>." };
  if (WHOLE_PAGE.test(code))
    return { ok: false, error: "Not shown: the code is a whole page (it has <!DOCTYPE>, <html>, <head> or <body>). Send only what would go inside <body> — its <style> and <script> tags in it — and call show_visual again." };
  if (!code.trimStart().startsWith("<"))
    return { ok: false, error: "Not shown: the code starts with text, not a tag. Send an SVG drawing or an HTML fragment. A mermaid diagram goes in your answer as a ```mermaid block instead: the chat draws that by itself." };
  return { ok: true, visual: { title, code, loading: loadingOf(input?.loading) } };
}

/**
 * A show_visual call: checked, kept on its turn (`file`), and answered — shown to the developer, not seen by them yet
 * (VS-D8). A refusal is the call's error, in its words.
 * @param {any} input @param {{ id: string, round: number | null }} at  the call's own id, which the visual is kept
 *   under, and the round it was made in
 * @param {FileVisual | null} file  where it is kept; null where nothing would show it
 * @returns {{ ok: true, visual: Visual, bytes: number, n: number | null, text: string } | { ok: false, error: string }}  `n`:
 *   the turn it is kept on, by its number in the session; null where its session keeps it
 */
export function showVisual(input, at, file) {
  const v = visualOf(input);
  if (!v.ok) return v;
  if (!file) return { ok: false, error: VISUALS_OFF };
  const kept = file(v.visual, at);
  if (!kept.ok) return kept;
  return {
    ok: true,
    visual: v.visual,
    bytes: kept.bytes,
    n: kept.n,
    text: `Shown to the developer in the chat as ${v.visual.title} (${sizeWords(kept.bytes)}). They can see it and click in it; what they say comes as their next message.`,
  };
}

/** How often a visual being written is said again while only its size grows. */
export const WRITING_EVERY_MS = 250;

/** The title's string value where its key stands, once the string is whole. */
const TITLE_HERE = /"title"\s*:\s*("(?:[^"\\]|\\.)*")/y;
/** The loading lines whole so far where their key stands, and the list closing after them. */
const LOADING_HERE = /"loading"\s*:\s*\[((?:\s*"(?:[^"\\]|\\.)*"\s*,?)*)/y;
const CLOSES_HERE = /\s*\]/y;
const STRINGS = /"(?:[^"\\]|\\.)*"/g;

/**
 * Where a key of a JSON object stands in its text as the text grows, its value opening with `open` (`"` a string, `[`
 * a list); -1 while it does not. Inside a JSON string every quote is escaped, so the key's name in its quotes is the key
 * itself or another key's whole value (`"title": "loading"`), never inside a string: each place the name stands is
 * looked at once the characters after it say which — the first whose value opens is the key — and the text is
 * searched only from where it was left. Where the key's value is a string not yet whole, nothing after it can be a key.
 * @param {string} key @param {string} open
 * @returns {(json: string) => number}  the text so far, each time the same text grown
 */
function keyIn(key, open) {
  const name = `"${key}"`;
  const opens = new RegExp(`${name}\\s*:\\s*\\${open}`, "y");
  const unsaid = new RegExp(`${name}\\s*(?::\\s*)?$`, "y");
  let from = 0;
  let at = -1;
  return (json) => {
    while (at < 0) {
      const q = json.indexOf(name, from);
      if (q < 0) {
        // The name may stand across the end, its last characters still to come.
        from = Math.max(from, json.length - name.length + 1);
        break;
      }
      opens.lastIndex = q;
      if (opens.test(json)) at = q;
      else {
        unsaid.lastIndex = q;
        if (unsaid.test(json)) {
          from = q;
          break;
        }
        from = q + 1;
      }
    }
    return at;
  };
}
/** A JSON string's text, or "" where it is not one. @param {string} s */
const unquote = (s) => {
  try {
    const v = JSON.parse(s);
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
};

/**
 * What a show_visual call says of itself while the model writes it (VS-D11), read from its input's JSON so far: its
 * title once the title's string is whole, and each of its loading lines once that line is whole. Inside a JSON string
 * every quote is escaped, so a key's name followed by its quote is never inside the code.
 * @param {string} json  the input as written so far
 * @returns {{ title: string, loading: string[] }}
 */
export function writingOf(json) {
  return writingReader()(json);
}

/**
 * `writingOf` for one call as its input grows, read where each piece adds (`keyIn`): a call's code is most of it, and
 * searching the whole of what had come at every piece cost the square of its length. A whole title, and a list of
 * loading lines that closed, are read no more.
 * @returns {(json: string) => { title: string, loading: string[] }}  the input so far, each time the same input grown
 */
export function writingReader() {
  const titleAt = keyIn("title", '"');
  const loadingAt = keyIn("loading", "[");
  /** @type {string | null} */
  let title = null;
  /** @type {string[] | null} */
  let loading = null;
  return (json) => {
    let t = title;
    if (t === null) {
      const at = titleAt(json);
      TITLE_HERE.lastIndex = at;
      const m = at < 0 ? null : TITLE_HERE.exec(json);
      t = m ? (title = titleOf(unquote(m[1])).slice(0, TITLE_MAX)) : "";
    }
    let l = loading;
    if (l === null) {
      const at = loadingAt(json);
      LOADING_HERE.lastIndex = at;
      const m = at < 0 ? null : LOADING_HERE.exec(json);
      l = m ? loadingOf((m[1].match(STRINGS) || []).map(unquote)) : [];
      CLOSES_HERE.lastIndex = at + (m?.[0].length ?? 0);
      if (m && CLOSES_HERE.test(json)) loading = l;
    }
    return { title: t, loading: [...l] };
  };
}

/**
 * The news of the visuals a round's model writes (VS-D11). Fed every piece of every tool call as it streams
 * (internal-call.js `onCall`), it says each show_visual call as it opens, then again when its title or a loading line
 * is whole, and as its size grows at most every WRITING_EVERY_MS — every wait shows progress. `drop()` says the calls
 * still being written are gone: the round's stream broke and its call is asked again. `drop(id)` says one is: the
 * reply was cut at its ceiling while writing it (HarnessV3-TaskGraph-v2 TG2-D62).
 * @param {(news: { id: string, title: string, loading: string[], chars: number } | { id: string, gone: true }) => void} say
 * @param {() => number} [now]
 * @returns {{ piece: (c: { id: string, name: string, text: string }) => void, drop: (id?: string) => void }}
 */
export function visualWriting(say, now = Date.now) {
  /** @type {Map<string, { json: string, read: ReturnType<typeof writingReader>, title: string, lines: number, at: number }>} */
  const calls = new Map();
  return {
    piece: (c) => {
      if (c.name !== SHOW_VISUAL || !c.id) return;
      let w = calls.get(c.id);
      if (!w) calls.set(c.id, (w = { json: "", read: writingReader(), title: "", lines: 0, at: -Infinity }));
      w.json += c.text;
      const { title, loading } = w.read(w.json);
      const t = now();
      if (title === w.title && loading.length === w.lines && t - w.at < WRITING_EVERY_MS) return;
      Object.assign(w, { title, lines: loading.length, at: t });
      say({ id: c.id, title, loading, chars: w.json.length });
    },
    drop: (one) => {
      for (const id of calls.keys()) if (one === undefined || id === one) say({ id, gone: true });
      if (one === undefined) calls.clear();
      else calls.delete(one);
    },
  };
}

/** A call where the session shows no visuals: switched off, or nothing of Filament's draws its chat. */
export const VISUALS_OFF = "Not run: visuals are off in this session.";

/**
 * Why a visual was not kept: more than the archive keeps of one message, so it could not be drawn again later (VC-18).
 * @param {number} bytes @param {number} cap
 */
export const tooBigWords = (bytes, cap) =>
  `Not shown: the visual is ${sizeWords(bytes)}, more than Filament keeps of one message (${sizeWords(cap)}, memory.capture.messageCapBytes), so it could not be drawn again later. Draw it smaller, or as two visuals.`;

/**
 * @typedef {{ addTurnVisual: (turnId: number, v: any) => { ok: true, bytes: number, n: number } | { ok: false, bytes: number, cap: number },
 *   addChainVisual: (chainId: string, v: any) => { ok: true, bytes: number } | { ok: false, bytes: number, cap: number } }} VisualStore
 * @typedef {{ id: string, exchange: number }} Drawer  the helper that draws, and which of its exchanges
 */

/**
 * Where a turn's visuals are kept: on the archive's turn, `by` the helper that draws them where one does — the turn
 * that launched it (archive.js `addTurnVisual`). One the archive would not keep whole, or a turn it no longer has, is
 * the call's refusal in words.
 * @param {VisualStore} archive @param {number} turnId @param {Drawer | null} [by]
 * @returns {FileVisual}
 */
export const visualsKeptOn = (archive, turnId, by = null) => (v, at) => kept(() => archive.addTurnVisual(turnId, { ...v, id: at.id, round: at.round, ...drawer(by) }), (r) => r.n);

/**
 * Where the visuals of a helper no turn launched are kept (VS-D48): one the developer asked, one that started by
 * itself — on its session, `by` it (archive.js `addChainVisual`); and the chat's own agent's in a turn memory keeps no
 * row of — one it leaves out for a reason of its own, or whose situate or prepare failed —, by nobody.
 * @param {VisualStore} archive @param {string} chainId @param {Drawer | null} by
 * @returns {FileVisual}
 */
export const visualsKeptInSession = (archive, chainId, by) => (v, at) => kept(() => archive.addChainVisual(chainId, { ...v, id: at.id, round: at.round, ...drawer(by) }), () => null);

/** @param {Drawer | null} by */
const drawer = (by) => (by ? { by: by.id, exchange: by.exchange } : {});
/**
 * @template {{ ok: true, bytes: number } | { ok: false, bytes: number, cap: number }} R
 * @param {() => R} keep @param {(r: any) => number | null} n
 * @returns {ReturnType<FileVisual>}
 */
const kept = (keep, n) => {
  try {
    const r = keep();
    return r.ok ? { ok: true, bytes: r.bytes, n: n(r) } : { ok: false, error: tooBigWords(r.bytes, r.cap) };
  } catch (/** @type {any} */ e) {
    return { ok: false, error: `Not shown: Filament could not keep the visual (${e.message}).` };
  }
};

/**
 * Where a call's visual goes: its turn's, else its session's — for a helper no turn launched, or for the chat's own agent
 * in a turn that runs with no row of memory's (`rowless`: one memory leaves out, or whose situate or prepare failed) —
 * else nowhere (null: nothing shows it).
 * @param {VisualStore | null | undefined} archive
 * @param {{ turn: number | null, chain: string | null, by: Drawer | null, rowless?: boolean }} at
 * @returns {FileVisual | null}
 */
export function visualHome(archive, { turn, chain, by, rowless = false }) {
  if (!archive) return null;
  if (Number.isInteger(turn) && Number(turn) > 0) return visualsKeptOn(archive, Number(turn), by);
  return chain && (by || rowless) ? visualsKeptInSession(archive, chain, by) : null;
}

/**
 * The live event a kept visual is said by on the run that drew it (VS-D26): where it is kept, as the page reads it
 * back — its turn's number, or `session`.
 * @param {{ id: string, round: number | null }} at @param {{ visual: Visual, bytes: number, n: number | null }} r
 */
export const visualEvent = (at, r) => ({ type: "visual", ...at, title: r.visual.title, bytes: r.bytes, ...(r.n == null ? { session: true } : { turn: r.n }) });

/**
 * A visual_guide call: the common rules, then a part for each kind asked for, in the guide's order.
 * @param {any} input @returns {{ ok: true, text: string } | { ok: false, error: string }}
 */
export function visualGuide(input) {
  const asked = (Array.isArray(input?.kinds) ? input.kinds : typeof input?.kinds === "string" ? [input.kinds] : []).map((k) => String(k).trim().toLowerCase()).filter(Boolean);
  const known = VISUAL_KINDS.join(", ");
  if (!asked.length) return { ok: false, error: `visual_guide needs kinds: one or more of ${known}.` };
  const unknown = asked.filter((k) => !VISUAL_KINDS.includes(k));
  if (unknown.length) return { ok: false, error: `visual_guide has a part for ${known}; ${unknown.join(", ")} is none of them.` };
  return { ok: true, text: [GUIDE.common, ...VISUAL_KINDS.filter((k) => asked.includes(k)).map((k) => GUIDE[k])].join("\n\n") };
}

/** The names, a line each, as the guide lists them. */
const NAMES_LIST = Object.entries(VISUAL_NAMES)
  .map(([name, says]) => `  - \`${name}\`: ${says}`)
  .join("\n");

/**
 * The look, as both guides give it (HarnessV4_Artifacts_Plan AF-D15): a visual's, drawn in a frame, and an artifact's,
 * a page, or a Design's screen. `ground`: what the drawing is drawn on there.
 * @param {{ where: "frame" | "page" | "screen", thing: "visual" | "page" | "screen", ground: string }} o
 */
export const lookRules = ({ where, thing, ground }) => `## The look
Filament looks like a quiet macOS app: the system font, hairline lines, rounded corners, room to breathe, few colors, and each color meaning one thing.
- Take every color from these names, never a fixed text or background color: the developer may be in light or dark, and the names follow (the ${where}'s \`<html>\` carries \`data-theme="light"\` or \`"dark"\`).
${NAMES_LIST}
- ${ground} A box or a card is \`--surface\` with a \`--line\` border.
- Type: \`font-family: var(--font)\`; 14 px for text, 12 px for captions and labels, never under 11 px; sentence case; figures with \`font-variant-numeric: tabular-nums\`.
- Corners: \`--radius\` for cards, \`--radius-sm\` for controls and small boxes.
- Color carries meaning: two or three hues in one ${thing}, a legend where they stand for something, and words beside any color that warns (\`--orange\`) or stops (\`--red\`).
- Motion: the ${where}'s \`<html>\` carries \`data-motion\`: \`"full"\`, \`"reduced"\` or \`"off"\`, the developer's setting. Animate only under full, briefly (under half a second), and never in a loop unless they asked for one.`;

/**
 * Filament's guide (VS-D13): its own words, in the harness's look — a quiet macOS app (HarnessV3 Instruments and Aqua).
 * One part for every visual, and one for each kind.
 * @type {Readonly<Record<string, string>>}
 */
export const GUIDE = Object.freeze({
  common: `# Drawing a visual in Filament

A visual is a picture you draw with code: an SVG drawing, or an HTML fragment with its own style and scripts. Filament shows it in the developer's chat, inside your answer, in a closed frame at the chat column's width — about 680 px, and as narrow as 320 px on a small pane. Its height follows what you draw.

Draw one when a picture says it better than words: how parts connect, how numbers compare, what a screen could look like, a small thing to try. Do not draw what a sentence, a list or a table says as well. For a diagram alone, a \`\`\`mermaid block in your answer costs less: the chat draws it by itself, offline.

## The code
- An SVG starts with \`<svg\` and has \`viewBox="0 0 680 H"\` and \`width="100%"\`, so it scales to any width; its root has no width or height in pixels.
- An HTML fragment is what would go inside \`<body>\`: no \`<!DOCTYPE>\`, \`<html>\`, \`<head>\` or \`<body>\`. Put \`<style>\` first, then the markup, then \`<script>\`.
- Scripts run once, when the whole code has arrived. Load a library with \`<script src>\` or an \`import\`, at an exact version, from ${VISUAL_HOSTS.map((h) => h.replace("https://", "")).join(", ")}. Nothing else loads or connects: no fetch, no XHR, no WebSocket, no image or font from anywhere else.
- The frame has no storage (\`localStorage\` throws) and cannot reach Filament, the page around it or the internet past those hosts. Put the data the visual needs into its code.
- No forms that submit, no alert, confirm or prompt, no new windows.
- \`position: fixed\`, \`height: 100vh\` and an area that scrolls inside break the frame's height: lay everything out in the flow.

${lookRules({ where: "frame", thing: "visual", ground: "The frame's background is clear: draw on it." })}

## Talking back
- \`filament.ask("Go with layout B")\`, called on a click, writes those words into the developer's message box; they read them and press Send. Nothing is sent for them, and a call without a click does nothing. Use it for a choice they make in the visual.
- A link (\`<a href="https://…">\`) opens in their browser after the page shows its whole address.
- When something fails — a script's error, a library that did not load — Filament shows the developer a line under the visual. Where you can, draw a plain fallback (the numbers as a table) so the visual still says something.

## The call
- \`title\`: what it shows, in snake_case (\`compaction_flow\`, \`spend_by_day\`). It heads the visual and names its file.
- \`code\`: the SVG, or the fragment.
- \`loading\`: one to four short lines shown while it is drawn.
- After it, say in a sentence what to look at, if anything. Do not describe the picture again in words.`,

  diagram: `## Diagram
- SVG, 680 wide, and as tall as the drawing: about 24 px around it, no empty band above or below (H is the lowest shape's bottom plus 24).
- A box is \`<rect rx="8">\` filled with a hue's \`-fill\`, its border that hue at 1 px; its words in \`--text\`, 13 or 14 px, centered (\`text-anchor="middle"\`, \`dominant-baseline="middle"\`). Size a box to its words — about 7.5 px a character at 13 px, plus 24 — and two lines at most; widen it before a third.
- Arrows: one \`<marker>\` in \`<defs>\`; lines in \`--text-muted\` at 1.5 px, straight or turning at right angles, never across a word. An arrow's label is 12 px \`--text-muted\`, on a \`--surface\` patch where it sits on a line.
- One direction, left to right or top to bottom. About twelve boxes at most; more is two diagrams.
- A group is a larger rect in \`--surface\` with a dashed \`--line\` border, its name at its top left in 12 px.
- One hue for each kind of thing (inputs blue, steps gray, outcomes green), and a legend when the hues are not plain.
- Mermaid works inside a visual too: \`<pre class="mermaid">graph LR; A-->B</pre>\` and \`<script type="module">import mermaid from "https://esm.sh/mermaid@11.4.1"; mermaid.initialize({ startOnLoad: false, theme: document.documentElement.dataset.theme === "dark" ? "dark" : "default" }); await mermaid.run();</script>\`. In an answer, a \`\`\`mermaid block is simpler.`,

  chart: `## Chart
- Chart.js (\`https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js\`) for anything past a few bars; a handful of bars can be plain SVG. D3 (\`https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js\`) for a chart of your own; the same rules hold.
- The canvas sits in \`<div style="position: relative; height: 300px">\`, with \`responsive: true, maintainAspectRatio: false\`.
- Colors from the names, read in the script: \`getComputedStyle(document.documentElement).getPropertyValue("--series-1").trim()\`. Series take \`--series-1\` to \`--series-6\` in order; axis text \`--text-muted\`; grid lines \`--line\`; type \`--font\` at 12 px.
- \`animation: false\` unless \`document.documentElement.dataset.motion === "full"\`.
- A title above the chart as plain HTML (14 px, weight 600), the unit in it or on the axis; a legend only with more than one series.
- If \`typeof Chart === "undefined"\` once it should have loaded, write the numbers as a small table instead.`,

  mockup: `## Mockup
- A screen as it could look, in HTML with CSS grid or flex, at the column's width — never a 1440 px desktop shrunk. Rows wrap when it is narrow (\`flex-wrap\`, \`minmax\`).
- Filament's own look: a sidebar and a content area; cards in \`--surface\` with \`--radius\`; a header ruled off by \`--line\`; controls as a Mac has them — capsule buttons (\`border-radius: 999px\`), the primary one \`--accent\` with \`--on-accent\` text, segmented controls, switches in \`--accent\`.
- Real words, never lorem ipsum. A picture is a \`--surface\` box with a short label.
- Several options: a card each, side by side when wide and stacked when narrow, each named (A, B, C), each with a button that calls \`filament.ask("Go with layout B")\`.`,

  interactive: `## Interactive
- A small working piece: a slider over a formula, a calculator, a step-through of a process.
- Native inputs (\`<input type="range">\`, \`type="number"\`, \`<select>\`) with \`accent-color: var(--accent)\`, each with its label.
- The result big (24 to 32 px, weight 600, \`tabular-nums\`), its unit beside it; few words.
- State in plain variables: the script runs once and keeps it. Nothing is kept between one view and the next.
- A button that hands a result to the agent calls \`filament.ask(…)\` with the words the developer would say.`,
});

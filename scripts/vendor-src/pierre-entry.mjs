// The hast serializer pierre's rendered lines are shaped as (ElementContent) - one small dep, bundled in.
export { toHtml } from "hast-util-to-html";
// The vendored @pierre/diffs bundle's source of truth (see scripts/vendor-render-deps.mjs): only the headless core —
// parse a patch, render a file diff with a highlighter, trim context. The React bindings stay out.
export { parsePatchFiles, getSingularPatch, trimPatchContext, renderDiffWithHighlighter, wrapCoreCSS } from "@pierre/diffs";

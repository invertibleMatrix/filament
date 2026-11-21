# Third-party notices

Filament's own code is under the licence in [LICENSE](LICENSE). This file names the third-party code the repository
carries and the third-party software Filament's builds ship, each with its version, where it lives, its licence (an SPDX
id), its copyright line and its source, and then gives the licence texts in full, once per distinct licence and
copyright holder. Development tools that build Filament but never ship in it (esbuild, electron-builder, TypeScript) are
not listed.

Where a licence cannot be determined from this repository, its entry says "licence: see" and links the source.

## Vendored browser code: `src/ui/harness/vendor/`

Each folder keeps its licences beside its code, in `LICENSE` (and `NOTICE`, where a package has one).
`scripts/vendor-render-deps.mjs` rewrites those of `shiki/`, `pierre/`, `katex/` and `mermaid/` whenever it rebuilds them,
from the packages esbuild put in each bundle; `shelf/` keeps its own, written by `scripts/vendor-shelf.mjs`.

### xterm.js: `xterm/`

| Component | Version | Where | Licence | Copyright | Link |
|---|---|---|---|---|---|
| @xterm/addon-fit | 0.10.0 | src/ui/harness/vendor/xterm/addon-fit.js | MIT | Copyright (c) 2019, The xterm.js authors (https://github.com/xtermjs/xterm.js) | <https://github.com/xtermjs/xterm.js/tree/master/addons/addon-fit> |
| @xterm/xterm | 5.5.0 | src/ui/harness/vendor/xterm/xterm.js, xterm.css | MIT | Copyright (c) 2017-2019, The xterm.js authors (https://github.com/xtermjs/xterm.js); Copyright (c) 2014-2016, SourceLair Private Company (https://www.sourcelair.com); Copyright (c) 2012-2013, Christopher Jeffrey (https://github.com/chjj/) | <https://github.com/xtermjs/xterm.js> |

### KaTeX: `katex/`

| Component | Version | Where | Licence | Copyright | Link |
|---|---|---|---|---|---|
| katex | 0.18.2 | src/ui/harness/vendor/katex/katex.min.js, katex.min.css | MIT | Copyright (c) 2013-2020 Khan Academy and other contributors | <https://github.com/KaTeX/KaTeX> |
| KaTeX fonts | 0.18.2 (KaTeX's) | src/ui/harness/vendor/katex/fonts/*.woff2 | OFL-1.1 | Copyright (c) 2009-2010, Design Science, Inc. (<www.mathjax.org>); Copyright (c) 2014-2018 Khan Academy (<www.khanacademy.org>), | <https://github.com/KaTeX/KaTeX> |

### Syntax highlighting: `shiki/shiki.mjs`

One esbuild bundle of `scripts/vendor-src/shiki-entry.mjs`: shiki's core, its JavaScript regular-expression engine, 23
languages (with the grammars they embed: javascript, typescript, jsx, tsx, json, css, html, markdown, shellscript (bash),
powershell, python, rust, go, java, c, cpp, cpp-macro, glsl, regexp, csharp, yaml, sql, diff, toml, ini) and the
github-dark and github-light themes. Each grammar and theme keeps its own licence, which shiki's tm-grammars and tm-themes
packages record with its source: licence: see <https://github.com/shikijs/textmate-grammars-themes/tree/main/packages/tm-grammars>
and <https://github.com/shikijs/textmate-grammars-themes/tree/main/packages/tm-themes>.

| Component | Version | Where | Licence | Copyright | Link |
|---|---|---|---|---|---|
| @shikijs/core | 4.4.3 | src/ui/harness/vendor/shiki/shiki.mjs | MIT | Copyright (c) 2021 Pine Wu; Copyright (c) 2023 Anthony Fu <https://github.com/antfu> | <https://github.com/shikijs/shiki> |
| @shikijs/engine-javascript | 4.4.3 | src/ui/harness/vendor/shiki/shiki.mjs | MIT | Copyright (c) 2021 Pine Wu; Copyright (c) 2023 Anthony Fu <https://github.com/antfu> | <https://github.com/shikijs/shiki> |
| @shikijs/langs | 4.4.3 | src/ui/harness/vendor/shiki/shiki.mjs; src/ui/harness/vendor/pierre/pierre.mjs | MIT | Copyright (c) 2021 Pine Wu; Copyright (c) 2023 Anthony Fu <https://github.com/antfu> | <https://github.com/shikijs/shiki> |
| @shikijs/primitive | 4.4.3 | src/ui/harness/vendor/shiki/shiki.mjs | MIT | Copyright (c) 2021 Pine Wu; Copyright (c) 2023 Anthony Fu <https://github.com/antfu> | <https://github.com/shikijs/shiki> |
| @shikijs/themes | 4.4.3 | src/ui/harness/vendor/shiki/shiki.mjs | MIT | Copyright (c) 2021 Pine Wu; Copyright (c) 2023 Anthony Fu <https://github.com/antfu> | <https://github.com/shikijs/shiki> |
| @shikijs/types | 4.4.3 | src/ui/harness/vendor/shiki/shiki.mjs | MIT | Copyright (c) 2021 Pine Wu; Copyright (c) 2023 Anthony Fu <https://github.com/antfu> | <https://github.com/shikijs/shiki> |
| @shikijs/vscode-textmate | 10.0.2 | src/ui/harness/vendor/shiki/shiki.mjs | MIT | Copyright (c) Microsoft Corporation | <https://github.com/shikijs/vscode-textmate> |
| ccount | 2.0.1 | src/ui/harness/vendor/shiki/shiki.mjs; src/ui/harness/vendor/pierre/pierre.mjs | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> | <https://github.com/wooorm/ccount> |
| character-entities-html4 | 2.1.0 | src/ui/harness/vendor/shiki/shiki.mjs; src/ui/harness/vendor/pierre/pierre.mjs | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> | <https://github.com/wooorm/character-entities-html4> |
| character-entities-legacy | 3.0.0 | src/ui/harness/vendor/shiki/shiki.mjs; src/ui/harness/vendor/pierre/pierre.mjs | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> | <https://github.com/wooorm/character-entities-legacy> |
| comma-separated-tokens | 2.0.3 | src/ui/harness/vendor/shiki/shiki.mjs; src/ui/harness/vendor/pierre/pierre.mjs | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | <https://github.com/wooorm/comma-separated-tokens> |
| hast-util-to-html | 9.0.5 | src/ui/harness/vendor/shiki/shiki.mjs; src/ui/harness/vendor/pierre/pierre.mjs | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> | <https://github.com/syntax-tree/hast-util-to-html> |
| hast-util-whitespace | 3.0.0 | src/ui/harness/vendor/shiki/shiki.mjs; src/ui/harness/vendor/pierre/pierre.mjs | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | <https://github.com/syntax-tree/hast-util-whitespace> |
| html-void-elements | 3.0.0 | src/ui/harness/vendor/shiki/shiki.mjs; src/ui/harness/vendor/pierre/pierre.mjs | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | <https://github.com/wooorm/html-void-elements> |
| oniguruma-parser | 0.12.2 | src/ui/harness/vendor/shiki/shiki.mjs | MIT | Copyright (c) 2025-2026 Steven Levithan | <https://github.com/slevithan/oniguruma-parser> |
| oniguruma-to-es | 4.3.6 | src/ui/harness/vendor/shiki/shiki.mjs | MIT | Copyright (c) 2024-2026 Steven Levithan | <https://github.com/slevithan/oniguruma-to-es> |
| property-information | 7.2.0 | src/ui/harness/vendor/shiki/shiki.mjs; src/ui/harness/vendor/pierre/pierre.mjs | MIT | Copyright (c) Titus Wormer <mailto:tituswormer@gmail.com> | <https://github.com/wooorm/property-information> |
| regex | 6.1.0 | src/ui/harness/vendor/shiki/shiki.mjs | MIT | Copyright (c) 2025 Steven Levithan | <https://github.com/slevithan/regex> |
| regex-recursion | 6.0.2 | src/ui/harness/vendor/shiki/shiki.mjs | MIT | Copyright (c) 2025 Steven Levithan | <https://github.com/slevithan/regex-recursion> |
| regex-utilities | 2.3.0 | src/ui/harness/vendor/shiki/shiki.mjs | MIT | Copyright (c) 2024 Steven Levithan | <https://github.com/slevithan/regex-utilities> |
| space-separated-tokens | 2.0.2 | src/ui/harness/vendor/shiki/shiki.mjs; src/ui/harness/vendor/pierre/pierre.mjs | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | <https://github.com/wooorm/space-separated-tokens> |
| stringify-entities | 4.0.4 | src/ui/harness/vendor/shiki/shiki.mjs; src/ui/harness/vendor/pierre/pierre.mjs | MIT | Copyright (c) 2015 Titus Wormer <mailto:tituswormer@gmail.com> | <https://github.com/wooorm/stringify-entities> |
| zwitch | 2.0.4 | src/ui/harness/vendor/shiki/shiki.mjs; src/ui/harness/vendor/pierre/pierre.mjs | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | <https://github.com/wooorm/zwitch> |

### Diffs: `pierre/pierre.mjs`

One esbuild bundle of `scripts/vendor-src/pierre-entry.mjs`: @pierre/diffs' headless core, with the curated shiki above
(the same grammars, whose licences are as said there). @pierre/diffs and @pierre/theming are Apache-2.0 and ship no
NOTICE file.

| Component | Version | Where | Licence | Copyright | Link |
|---|---|---|---|---|---|
| @pierre/diffs | 1.4.3 | src/ui/harness/vendor/pierre/pierre.mjs | Apache-2.0 | Copyright 2025 Pierre Computer Company | <https://www.npmjs.com/package/@pierre/diffs> |
| @pierre/theming | 1.0.1 | src/ui/harness/vendor/pierre/pierre.mjs | Apache-2.0 | Copyright 2025 Pierre Computer Company | <https://www.npmjs.com/package/@pierre/theming> |
| @shikijs/transformers | 4.4.3 | src/ui/harness/vendor/pierre/pierre.mjs | MIT | Copyright (c) 2021 Pine Wu; Copyright (c) 2023 Anthony Fu <https://github.com/antfu> | <https://github.com/shikijs/shiki> |
| diff | 9.0.0 | src/ui/harness/vendor/pierre/pierre.mjs | BSD-3-Clause | Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com> | <https://github.com/kpdecker/jsdiff> |

### Diagrams: `mermaid/mermaid.mjs`

One esbuild bundle of `scripts/vendor-src/mermaid-entry.mjs`: mermaid's complete ESM build with every package it imports.
`mermaid/LICENSE` holds each one's licence text, `mermaid/NOTICE` es-toolkit's NOTICE. Every package here carries its own
licence file except fastdom, which ships none (its package.json says MIT).

| Component | Version | Where | Licence | Copyright | Link |
|---|---|---|---|---|---|
| mermaid | 11.17.2 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2014 - 2022 Knut Sveidqvist | <https://github.com/mermaid-js/mermaid> |
| @braintree/sanitize-url | 7.1.2 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2017 Braintree | <https://github.com/braintree/sanitize-url> |
| @iconify/utils | 3.1.7 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2021-PRESENT Vjacheslav Trushkin | <https://github.com/iconify/iconify> |
| @mermaid-js/parser | 1.2.1 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2023 Yokozuna59 | <https://github.com/mermaid-js/mermaid> |
| @upsetjs/venn.js | 2.0.0 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2013 Ben Frederickson; Copyright (c) 2021 Samuel Gratzl | <https://github.com/upsetjs/venn.js> |
| cose-base | 1.0.3 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2019 - present, iVis@Bilkent. | <https://github.com/iVis-at-Bilkent/cose-base> |
| cose-base | 2.2.0 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2019 - present, iVis@Bilkent. | <https://github.com/iVis-at-Bilkent/cose-base> |
| cytoscape | 3.34.3 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2016-2026, The Cytoscape Consortium. | <https://github.com/cytoscape/cytoscape.js> |
| cytoscape-cose-bilkent | 4.1.0 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2016-2018, The Cytoscape Consortium. | <https://github.com/cytoscape/cytoscape.js-cose-bilkent> |
| cytoscape-fcose | 2.2.0 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2018 - present, iVis-at-Bilkent. | <https://github.com/iVis-at-Bilkent/cytoscape.js-fcose> |
| d3 | 7.9.0 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2023 Mike Bostock | <https://github.com/d3/d3> |
| d3-array | 2.12.1 | src/ui/harness/vendor/mermaid/mermaid.mjs | BSD-3-Clause | Copyright 2010-2020 Mike Bostock | <https://github.com/d3/d3-array> |
| d3-array | 3.2.4 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2023 Mike Bostock | <https://github.com/d3/d3-array> |
| d3-axis | 3.0.0 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2021 Mike Bostock | <https://github.com/d3/d3-axis> |
| d3-brush | 3.0.0 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2021 Mike Bostock | <https://github.com/d3/d3-brush> |
| d3-chord | 3.0.1 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2021 Mike Bostock | <https://github.com/d3/d3-chord> |
| d3-color | 3.1.0 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2022 Mike Bostock | <https://github.com/d3/d3-color> |
| d3-contour | 4.0.2 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2012-2023 Mike Bostock | <https://github.com/d3/d3-contour> |
| d3-delaunay | 6.0.4 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2018-2021 Observable, Inc.; Copyright 2021 Mapbox | <https://github.com/d3/d3-delaunay> |
| d3-dispatch | 3.0.1 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2021 Mike Bostock | <https://github.com/d3/d3-dispatch> |
| d3-drag | 3.0.0 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2021 Mike Bostock | <https://github.com/d3/d3-drag> |
| d3-dsv | 3.0.1 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2013-2021 Mike Bostock | <https://github.com/d3/d3-dsv> |
| d3-ease | 3.0.1 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | BSD-3-Clause | Copyright 2010-2021 Mike Bostock; Copyright 2001 Robert Penner | <https://github.com/d3/d3-ease> |
| d3-fetch | 3.0.1 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2016-2021 Mike Bostock | <https://github.com/d3/d3-fetch> |
| d3-force | 3.0.0 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2021 Mike Bostock | <https://github.com/d3/d3-force> |
| d3-format | 3.1.2 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2026 Mike Bostock | <https://github.com/d3/d3-format> |
| d3-geo | 3.1.1 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2024 Mike Bostock; Copyright 2008-2012 Charles Karney | <https://github.com/d3/d3-geo> |
| d3-hierarchy | 3.1.2 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2021 Mike Bostock | <https://github.com/d3/d3-hierarchy> |
| d3-interpolate | 3.0.1 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2021 Mike Bostock | <https://github.com/d3/d3-interpolate> |
| d3-path | 1.0.9 | src/ui/harness/vendor/mermaid/mermaid.mjs | BSD-3-Clause | Copyright 2015-2016 Mike Bostock | <https://github.com/d3/d3-path> |
| d3-path | 3.1.0 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2015-2022 Mike Bostock | <https://github.com/d3/d3-path> |
| d3-polygon | 3.0.1 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2021 Mike Bostock | <https://github.com/d3/d3-polygon> |
| d3-quadtree | 3.0.1 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2021 Mike Bostock | <https://github.com/d3/d3-quadtree> |
| d3-random | 3.0.1 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2021 Mike Bostock | <https://github.com/d3/d3-random> |
| d3-sankey | 0.12.3 | src/ui/harness/vendor/mermaid/mermaid.mjs | BSD-3-Clause | Copyright 2015, Mike Bostock | <https://github.com/d3/d3-sankey> |
| d3-scale | 4.0.2 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2021 Mike Bostock | <https://github.com/d3/d3-scale> |
| d3-scale-chromatic | 3.1.0 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2024 Mike Bostock; Copyright 2002 Cynthia Brewer, Mark Harrower, and The Pennsylvania State University | <https://github.com/d3/d3-scale-chromatic> |
| d3-selection | 3.0.0 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2021 Mike Bostock | <https://github.com/d3/d3-selection> |
| d3-shape | 1.3.7 | src/ui/harness/vendor/mermaid/mermaid.mjs | BSD-3-Clause | Copyright 2010-2015 Mike Bostock | <https://github.com/d3/d3-shape> |
| d3-shape | 3.2.0 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2022 Mike Bostock | <https://github.com/d3/d3-shape> |
| d3-time | 3.1.0 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2022 Mike Bostock | <https://github.com/d3/d3-time> |
| d3-time-format | 4.1.0 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2021 Mike Bostock | <https://github.com/d3/d3-time-format> |
| d3-timer | 3.0.1 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2021 Mike Bostock | <https://github.com/d3/d3-timer> |
| d3-transition | 3.0.1 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2021 Mike Bostock | <https://github.com/d3/d3-transition> |
| d3-zoom | 3.0.0 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2010-2021 Mike Bostock | <https://github.com/d3/d3-zoom> |
| dagre-d3-es | 7.0.14 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2022-2024 Thibaut Lassalle, David Newell, Alois Klink, Sidharth Vinod and dagre-es contributors | <https://github.com/tbo47/dagre-es> |
| dayjs | 1.11.23 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2018-present, iamkun | <https://github.com/iamkun/dayjs> |
| dompurify | 3.4.17 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/dompurify@3/purify.js, purify.umd.js | MPL-2.0 OR Apache-2.0 | (c) Cure53 and other contributors (its dist's licence banner) | <https://github.com/cure53/DOMPurify> |
| es-toolkit | 1.52.0 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2024 Viva Republica, Inc. | <https://github.com/toss/es-toolkit> |
| fastdom | 1.0.12 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | not stated in the package, which ships no licence file | <https://github.com/wilsonpage/fastdom> |
| internmap | 2.0.3 | src/ui/harness/vendor/mermaid/mermaid.mjs; src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright 2021 Mike Bostock | <https://github.com/mbostock/internmap> |
| katex | 0.18.2 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2013-2020 Khan Academy and other contributors | <https://github.com/KaTeX/KaTeX> |
| khroma | 2.1.0 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2019-present Fabio Spampinato, Andrew Maney | <https://github.com/fabiospampinato/khroma> |
| layout-base | 1.0.2 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2019 iVis@Bilkent | <https://github.com/iVis-at-Bilkent/layout-base> |
| layout-base | 2.0.1 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2019 iVis@Bilkent | <https://github.com/iVis-at-Bilkent/layout-base> |
| lodash-es | 4.18.1 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright OpenJS Foundation and other contributors <https://openjsf.org/> | <https://github.com/lodash/lodash> |
| marked | 16.4.2 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/); Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/); Copyright © 2004, John Gruber | <https://github.com/markedjs/marked> |
| roughjs | 4.6.6 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2019 Preet Shihn | <https://github.com/pshihn/rough> |
| stylis | 4.4.0 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2016-present Sultan Tarimo | <https://github.com/thysultan/stylis.js> |
| ts-dedent | 2.3.0 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2018 Tamino Martinius | <https://github.com/tamino-martinius/node-ts-dedent> |
| uuid | 14.0.2 | src/ui/harness/vendor/mermaid/mermaid.mjs | MIT | Copyright (c) 2010-2020 Robert Kieffer and other contributors | <https://github.com/uuidjs/uuid> |

Packed inside other packages' dist files before esbuild reads them, as those dists' own path comments name them (not
installed on their own, so their licence files are not in `node_modules`):

| Component | Version | Where | Licence | Copyright | Link |
|---|---|---|---|---|---|
| @chevrotain/gast | 11.1.2 | src/ui/harness/vendor/mermaid/mermaid.mjs (inside @mermaid-js/parser's dist) | Apache-2.0 | the Chevrotain/chevrotain authors (see the licence text) (from https://github.com/Chevrotain/chevrotain/blob/HEAD/LICENSE.txt) | <https://github.com/Chevrotain/chevrotain> |
| @chevrotain/regexp-to-ast | 11.1.2 | src/ui/harness/vendor/mermaid/mermaid.mjs (inside @mermaid-js/parser's dist) | Apache-2.0 | the Chevrotain/chevrotain authors (see the licence text) (from https://github.com/Chevrotain/chevrotain/blob/HEAD/LICENSE.txt) | <https://github.com/Chevrotain/chevrotain> |
| @chevrotain/utils | 11.1.2 | src/ui/harness/vendor/mermaid/mermaid.mjs (inside @mermaid-js/parser's dist) | Apache-2.0 | the Chevrotain/chevrotain authors (see the licence text) (from https://github.com/Chevrotain/chevrotain/blob/HEAD/LICENSE.txt) | <https://github.com/Chevrotain/chevrotain> |
| chevrotain | 11.1.2 | src/ui/harness/vendor/mermaid/mermaid.mjs (inside @mermaid-js/parser's dist) | Apache-2.0 | the Chevrotain/chevrotain authors (see the licence text) (from https://github.com/Chevrotain/chevrotain/blob/HEAD/LICENSE.txt) | <https://github.com/Chevrotain/chevrotain> |
| chevrotain-allstar | 0.3.1 | src/ui/harness/vendor/mermaid/mermaid.mjs (inside @mermaid-js/parser's dist) | MIT | Copyright 2022 TypeFox GmbH (from https://github.com/langium/chevrotain-allstar/blob/HEAD/LICENSE) | <https://github.com/langium/chevrotain-allstar> |
| js-yaml | 4.3.0 | src/ui/harness/vendor/mermaid/mermaid.mjs (inside mermaid's own dist) | MIT | Copyright (C) 2011-2015 by Vitaly Puzrin | <https://github.com/nodeca/js-yaml> |
| langium | 4.2.1 | src/ui/harness/vendor/mermaid/mermaid.mjs (inside @mermaid-js/parser's dist) | MIT | Copyright 2021 TypeFox GmbH (from https://github.com/eclipse-langium/langium/blob/HEAD/LICENSE) | <https://github.com/eclipse-langium/langium> |
| lodash-es | 4.17.23 | src/ui/harness/vendor/mermaid/mermaid.mjs (inside @mermaid-js/parser's dist) | MIT | Copyright OpenJS Foundation and other contributors <https://openjsf.org/> | <https://github.com/lodash/lodash> |
| vscode-jsonrpc | 8.2.0 | src/ui/harness/vendor/mermaid/mermaid.mjs (inside @mermaid-js/parser's dist) | MIT | Copyright (c) Microsoft Corporation (from https://github.com/microsoft/vscode-languageserver-node/blob/HEAD/License.txt) | <https://github.com/microsoft/vscode-languageserver-node> |
| vscode-languageserver-protocol | 3.17.5 | src/ui/harness/vendor/mermaid/mermaid.mjs (inside @mermaid-js/parser's dist) | MIT | Copyright (c) Microsoft Corporation (from https://github.com/microsoft/vscode-languageserver-node/blob/HEAD/License.txt) | <https://github.com/microsoft/vscode-languageserver-node> |
| vscode-languageserver-textdocument | 1.0.12 | src/ui/harness/vendor/mermaid/mermaid.mjs (inside @mermaid-js/parser's dist) | MIT | Copyright (c) Microsoft Corporation (from https://github.com/microsoft/vscode-languageserver-node/blob/HEAD/License.txt) | <https://github.com/microsoft/vscode-languageserver-node> |
| vscode-languageserver-types | 3.17.5 | src/ui/harness/vendor/mermaid/mermaid.mjs (inside @mermaid-js/parser's dist) | MIT | Copyright (c) Microsoft Corporation (from https://github.com/microsoft/vscode-languageserver-node/blob/HEAD/License.txt) | <https://github.com/microsoft/vscode-languageserver-node> |
| vscode-uri | 3.1.0 | src/ui/harness/vendor/mermaid/mermaid.mjs (inside @mermaid-js/parser's dist) | MIT | Copyright (c) Microsoft (from https://github.com/microsoft/vscode-uri/blob/HEAD/LICENSE.md) | <https://github.com/microsoft/vscode-uri> |

Code of others inside those dists, under the notices they carry, which the bundle keeps as legal comments:

| Component | Version | Where | Licence | Copyright | Link |
|---|---|---|---|---|---|
| Bezier curve function generator | as embedded | src/ui/harness/vendor/mermaid/mermaid.mjs (inside cytoscape's dist) | MIT | Copyright Gaetan Renaudeau. MIT License |  |
| Embeddable Minimum Strictly-Compliant Promises/A+ 1.1.1 Thenable | as embedded | src/ui/harness/vendor/mermaid/mermaid.mjs (inside cytoscape's dist) | MIT | Copyright (c) 2013-2014 Ralf S. Engelschall (http://engelschall.com); Licensed under The MIT License |  |
| regenerator-runtime | as embedded | src/ui/harness/vendor/mermaid/mermaid.mjs (inside DOMPurify's dist) | MIT | Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE |  |
| Runge-Kutta spring physics function generator (adapted from Framer.js) | as embedded | src/ui/harness/vendor/mermaid/mermaid.mjs (inside cytoscape's dist) | MIT | copyright Koen Bok. MIT License |  |

### The shelf: `shelf/`

The libraries every artifact's address serves at `/_filament/lib/`, each folder with its `LICENSE.txt`. d3's rows list
the modules it is built from at the versions this checkout's `node_modules` resolves d3 7.9.0's ranges to.

| Component | Version | Where | Licence | Copyright | Link |
|---|---|---|---|---|---|
| @kurkle/color | 0.3.4 (chart.js), 0.3.2 (chart.umd.js) | src/ui/harness/vendor/shelf/chart.js@4/chart.js, chart.umd.js | MIT | Copyright (c) 2018-2024 Jukka Kurkela | <https://github.com/kurkle/color> |
| Chart.js | 4.6.1 | src/ui/harness/vendor/shelf/chart.js@4/chart.js, chart.umd.js | MIT | Copyright (c) 2014-2024 Chart.js Contributors | <https://github.com/chartjs/Chart.js> |
| delaunator | 5.1.0 | src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | ISC | Copyright (c) 2026, Mapbox | <https://github.com/mapbox/delaunator> |
| htm | 3.1.1 | src/ui/harness/vendor/shelf/preact@11/preact.js | Apache-2.0 | Copyright 2018 Google Inc. | <https://github.com/developit/htm> |
| marked | 18.1.2 | src/ui/harness/vendor/shelf/marked@18/marked.js, marked.umd.js | MIT | Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/); Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/); Copyright © 2004, John Gruber | <https://github.com/markedjs/marked> |
| Preact | 11.1.0 | src/ui/harness/vendor/shelf/preact@11/preact.js | MIT | Copyright (c) 2015-present Jason Miller | <https://github.com/preactjs/preact> |
| robust-predicates | 3.0.3 | src/ui/harness/vendor/shelf/d3@7/d3.js, d3.umd.js | Unlicense | none: dedicated to the public domain (Unlicense) | <https://github.com/mourner/robust-predicates> |
| three.js | 0.186.1 | src/ui/harness/vendor/shelf/three@0.186/*.js | MIT | Copyright © 2010-2026 three.js authors | <https://github.com/mrdoob/three.js> |

## Shipped with the desktop app and the server tarball

electron-builder takes Electron from its release archive, which carries Electron's `LICENSE` and Chromium's
`LICENSES.chromium.html`; the Windows and Linux builds keep both in the app's folder (`LICENSE.electron.txt`,
`LICENSES.chromium.html`).

| Component | Version | Where | Licence | Copyright | Link |
|---|---|---|---|---|---|
| Chromium and its dependencies | as Electron 45.0.0 ships it | the desktop app, inside Electron | BSD-3-Clause and others: see LICENSES.chromium.html in Electron's distribution | Copyright The Chromium Authors and others: see LICENSES.chromium.html | <https://www.chromium.org/> |
| ConPTY (conpty.dll, OpenConsole.exe) | 1.23.251008001 | node_modules/node-pty/prebuilds/win32-*/conpty/ (Windows) | MIT | Copyright (c) Microsoft Corporation. All rights reserved. (from https://github.com/microsoft/terminal/blob/HEAD/LICENSE) | <https://github.com/microsoft/terminal> |
| Electron | 45.0.0 | the desktop app (electron-builder downloads it at build time) | MIT | Copyright (c) Electron contributors; Copyright (c) 2013-2020 GitHub Inc. | <https://github.com/electron/electron> |
| node-pty | 1.1.0 | node_modules/node-pty (desktop app, server tarball) | MIT | Copyright (c) 2012-2015, Christopher Jeffrey (https://github.com/chjj/); Copyright (c) 2016, Daniel Imms (http://www.growingwiththeweb.com); Copyright (c) 2018 - present Microsoft Corporation | <https://github.com/microsoft/node-pty> |
| Node.js | the Node that runs `npm run dist:server` | the server tarball, node/ (scripts/dist-server.mjs packs its LICENSE as node/LICENSE) | MIT, with its dependencies' licences in its own LICENSE | Copyright Node.js contributors and others: see node/LICENSE | <https://github.com/nodejs/node> |
| winpty | 0.4.4-dev | node_modules/node-pty/prebuilds/win32-*/winpty.dll, winpty-agent.exe (Windows) | MIT | Copyright (c) 2011-2016 Ryan Prichard | <https://github.com/rprichard/winpty> |

## Downloaded at build time into the memory engine's bundle

`scripts/build-memory-bundle.mjs` (with `src/adapters/sidecar/install.js`) downloads these and lays them out under
`vendor/memory-engine/<platform>-<arch>/`; the desktop app and the server tarball carry that bundle. The exact versions
are those the bundle's `manifest.json` and `requirements.txt` record when it is built.

| Component | Version | Where | Licence | Copyright | Link |
|---|---|---|---|---|---|
| CPython 3.12, python-build-standalone's build | the one uv installs when the bundle is built (its manifest.json's `python`) | downloaded at build time into vendor/memory-engine/<platform>-<arch>/ (npm run engine:bundle), shipped in the desktop app and server tarball | licence: see https://github.com/astral-sh/python-build-standalone and https://docs.python.org/3/license.html | see the links | <https://github.com/astral-sh/python-build-standalone> |
| Embedding model sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 | as fastembed downloads it when the bundle is built | downloaded at build time into vendor/memory-engine/<platform>-<arch>/fastembed/ (npm run engine:bundle), shipped in the desktop app and server tarball | licence: see https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 | see the link | <https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2> |
| Every other package mnemosyne-memory[embeddings] installs | each as the bundle's requirements.txt pins it | downloaded at build time into vendor/memory-engine/<platform>-<arch>/ (npm run engine:bundle), shipped in the desktop app and server tarball | licence: see each wheel's .dist-info in the bundle's wheels/ folder and its PyPI page | see each package | <https://pypi.org/> |
| fastembed | as the bundle's requirements.txt pins it | downloaded at build time into vendor/memory-engine/<platform>-<arch>/ (npm run engine:bundle), shipped in the desktop app and server tarball | licence: see https://pypi.org/project/fastembed/ | see the link | <https://pypi.org/project/fastembed/> |
| mnemosyne-memory (the memory engine) | 3.15.1, commit 78506708aae344635e01a24f67a7319efc36fce9 | downloaded at build time into vendor/memory-engine/<platform>-<arch>/ (npm run engine:bundle), shipped in the desktop app and server tarball | MIT | Copyright (c) 2026 Abdias J | <https://github.com/invertibleMatrix/mnemosyne> |
| sqlite-vec | as the bundle's requirements.txt pins it | downloaded at build time into vendor/memory-engine/<platform>-<arch>/ (npm run engine:bundle), shipped in the desktop app and server tarball | licence: see https://pypi.org/project/sqlite-vec/ | see the link | <https://pypi.org/project/sqlite-vec/> |
| uv | the latest release when the bundle is built (its manifest.json's `uv`) | downloaded at build time into vendor/memory-engine/<platform>-<arch>/ (npm run engine:bundle), shipped in the desktop app and server tarball | licence: see https://github.com/astral-sh/uv | see the link | <https://github.com/astral-sh/uv/releases> |

## Licence texts

Each text once, under the components it covers, with their copyright lines. DOMPurify is used under Apache-2.0, one of
the two licences it offers.

### Apache-2.0: @pierre/diffs 1.4.3, @pierre/theming 1.0.1, htm 3.1.1

```text
Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1.  Definitions.

    "License" shall mean the terms and conditions for use, reproduction, and
    distribution as defined by Sections 1 through 9 of this document.

    "Licensor" shall mean the copyright owner or entity authorized by the
    copyright owner that is granting the License.

    "Legal Entity" shall mean the union of the acting entity and all other
    entities that control, are controlled by, or are under common control with
    that entity. For the purposes of this definition, "control" means (i) the
    power, direct or indirect, to cause the direction or management of such
    entity, whether by contract or otherwise, or (ii) ownership of fifty percent
    (50%) or more of the outstanding shares, or (iii) beneficial ownership of
    such entity.

    "You" (or "Your") shall mean an individual or Legal Entity exercising
    permissions granted by this License.

    "Source" form shall mean the preferred form for making modifications,
    including but not limited to software source code, documentation source, and
    configuration files.

    "Object" form shall mean any form resulting from mechanical transformation
    or translation of a Source form, including but not limited to compiled
    object code, generated documentation, and conversions to other media types.

    "Work" shall mean the work of authorship, whether in Source or Object form,
    made available under the License, as indicated by a copyright notice that is
    included in or attached to the work (an example is provided in the Appendix
    below).

    "Derivative Works" shall mean any work, whether in Source or Object form,
    that is based on (or derived from) the Work and for which the editorial
    revisions, annotations, elaborations, or other modifications represent, as a
    whole, an original work of authorship. For the purposes of this License,
    Derivative Works shall not include works that remain separable from, or
    merely link (or bind by name) to the interfaces of, the Work and Derivative
    Works thereof.

    "Contribution" shall mean any work of authorship, including the original
    version of the Work and any modifications or additions to that Work or
    Derivative Works thereof, that is intentionally submitted to Licensor for
    inclusion in the Work by the copyright owner or by an individual or Legal
    Entity authorized to submit on behalf of the copyright owner. For the
    purposes of this definition, "submitted" means any form of electronic,
    verbal, or written communication sent to the Licensor or its
    representatives, including but not limited to communication on electronic
    mailing lists, source code control systems, and issue tracking systems that
    are managed by, or on behalf of, the Licensor for the purpose of discussing
    and improving the Work, but excluding communication that is conspicuously
    marked or otherwise designated in writing by the copyright owner as "Not a
    Contribution."

    "Contributor" shall mean Licensor and any individual or Legal Entity on
    behalf of whom a Contribution has been received by Licensor and subsequently
    incorporated within the Work.

2.  Grant of Copyright License. Subject to the terms and conditions of this
    License, each Contributor hereby grants to You a perpetual, worldwide,
    non-exclusive, no-charge, royalty-free, irrevocable copyright license to
    reproduce, prepare Derivative Works of, publicly display, publicly perform,
    sublicense, and distribute the Work and such Derivative Works in Source or
    Object form.

3.  Grant of Patent License. Subject to the terms and conditions of this
    License, each Contributor hereby grants to You a perpetual, worldwide,
    non-exclusive, no-charge, royalty-free, irrevocable (except as stated in
    this section) patent license to make, have made, use, offer to sell, sell,
    import, and otherwise transfer the Work, where such license applies only to
    those patent claims licensable by such Contributor that are necessarily
    infringed by their Contribution(s) alone or by combination of their
    Contribution(s) with the Work to which such Contribution(s) was submitted.
    If You institute patent litigation against any entity (including a
    cross-claim or counterclaim in a lawsuit) alleging that the Work or a
    Contribution incorporated within the Work constitutes direct or contributory
    patent infringement, then any patent licenses granted to You under this
    License for that Work shall terminate as of the date such litigation is
    filed.

4.  Redistribution. You may reproduce and distribute copies of the Work or
    Derivative Works thereof in any medium, with or without modifications, and
    in Source or Object form, provided that You meet the following conditions:

    (a) You must give any other recipients of the Work or Derivative Works a
    copy of this License; and

    (b) You must cause any modified files to carry prominent notices stating
    that You changed the files; and

    (c) You must retain, in the Source form of any Derivative Works that You
    distribute, all copyright, patent, trademark, and attribution notices from
    the Source form of the Work, excluding those notices that do not pertain to
    any part of the Derivative Works; and

    (d) If the Work includes a "NOTICE" text file as part of its distribution,
    then any Derivative Works that You distribute must include a readable copy
    of the attribution notices contained within such NOTICE file, excluding
    those notices that do not pertain to any part of the Derivative Works, in at
    least one of the following places: within a NOTICE text file distributed as
    part of the Derivative Works; within the Source form or documentation, if
    provided along with the Derivative Works; or, within a display generated by
    the Derivative Works, if and wherever such third-party notices normally
    appear. The contents of the NOTICE file are for informational purposes only
    and do not modify the License. You may add Your own attribution notices
    within Derivative Works that You distribute, alongside or as an addendum to
    the NOTICE text from the Work, provided that such additional attribution
    notices cannot be construed as modifying the License.

    You may add Your own copyright statement to Your modifications and may
    provide additional or different license terms and conditions for use,
    reproduction, or distribution of Your modifications, or for any such
    Derivative Works as a whole, provided Your use, reproduction, and
    distribution of the Work otherwise complies with the conditions stated in
    this License.

5.  Submission of Contributions. Unless You explicitly state otherwise, any
    Contribution intentionally submitted for inclusion in the Work by You to the
    Licensor shall be under the terms and conditions of this License, without
    any additional terms or conditions. Notwithstanding the above, nothing
    herein shall supersede or modify the terms of any separate license agreement
    you may have executed with Licensor regarding such Contributions.

6.  Trademarks. This License does not grant permission to use the trade names,
    trademarks, service marks, or product names of the Licensor, except as
    required for reasonable and customary use in describing the origin of the
    Work and reproducing the content of the NOTICE file.

7.  Disclaimer of Warranty. Unless required by applicable law or agreed to in
    writing, Licensor provides the Work (and each Contributor provides its
    Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, either express or implied, including, without limitation, any
    warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or
    FITNESS FOR A PARTICULAR PURPOSE. You are solely responsible for determining
    the appropriateness of using or redistributing the Work and assume any risks
    associated with Your exercise of permissions under this License.

8.  Limitation of Liability. In no event and under no legal theory, whether in
    tort (including negligence), contract, or otherwise, unless required by
    applicable law (such as deliberate and grossly negligent acts) or agreed to
    in writing, shall any Contributor be liable to You for damages, including
    any direct, indirect, special, incidental, or consequential damages of any
    character arising as a result of this License or out of the use or inability
    to use the Work (including but not limited to damages for loss of goodwill,
    work stoppage, computer failure or malfunction, or any and all other
    commercial damages or losses), even if such Contributor has been advised of
    the possibility of such damages.

9.  Accepting Warranty or Additional Liability. While redistributing the Work or
    Derivative Works thereof, You may choose to offer, and charge a fee for,
    acceptance of support, warranty, indemnity, or other liability obligations
    and/or rights consistent with this License. However, in accepting such
    obligations, You may act only on Your own behalf and on Your sole
    responsibility, not on behalf of any other Contributor, and only if You
    agree to indemnify, defend, and hold each Contributor harmless for any
    liability incurred by, or claims asserted against, such Contributor by
    reason of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

Copyright 2025 Pierre Computer Company
Copyright 2018 Google Inc.

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.
```

### Apache-2.0: dompurify 3.4.17

```text
Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### BSD-3-Clause: d3-array 2.12.1, d3-path 1.0.9, d3-sankey 0.12.3, d3-shape 1.3.7

```text
Copyright 2010-2020 Mike Bostock
Copyright 2015, Mike Bostock
Copyright 2015-2016 Mike Bostock
Copyright 2010-2015 Mike Bostock
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the author nor the names of contributors may be used to
  endorse or promote products derived from this software without specific prior
  written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### BSD-3-Clause: d3-ease 3.0.1

```text
Copyright 2010-2021 Mike Bostock
Copyright 2001 Robert Penner
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the author nor the names of contributors may be used to
  endorse or promote products derived from this software without specific prior
  written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### BSD-3-Clause: diff 9.0.0

```text
BSD 3-Clause License

Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### ISC: d3 7.9.0, d3-array 3.2.4, d3-axis 3.0.0, d3-brush 3.0.0, d3-chord 3.0.1, d3-color 3.1.0, d3-contour 4.0.2, d3-dispatch 3.0.1, d3-drag 3.0.0, d3-dsv 3.0.1, d3-fetch 3.0.1, d3-force 3.0.0, d3-format 3.1.2, d3-hierarchy 3.1.2, d3-interpolate 3.0.1, d3-path 3.1.0, d3-polygon 3.0.1, d3-quadtree 3.0.1, d3-random 3.0.1, d3-scale 4.0.2, d3-selection 3.0.0, d3-shape 3.2.0, d3-time 3.1.0, d3-time-format 4.1.0, d3-timer 3.0.1, d3-transition 3.0.1, d3-zoom 3.0.0, internmap 2.0.3

```text
Copyright 2010-2023 Mike Bostock
Copyright 2021 Mike Bostock
Copyright 2010-2021 Mike Bostock
Copyright 2010-2022 Mike Bostock
Copyright 2015-2022 Mike Bostock
Copyright 2012-2023 Mike Bostock
Copyright 2013-2021 Mike Bostock
Copyright 2016-2021 Mike Bostock
Copyright 2010-2026 Mike Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

### ISC: d3-delaunay 6.0.4

```text
Copyright 2018-2021 Observable, Inc.
Copyright 2021 Mapbox

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

### ISC: d3-geo 3.1.1

```text
Copyright 2010-2024 Mike Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.

This license applies to GeographicLib, versions 1.12 and later.

Copyright 2008-2012 Charles Karney

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### ISC: d3-scale-chromatic 3.1.0

```text
Copyright 2010-2024 Mike Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.

Apache-Style Software License for ColorBrewer software and ColorBrewer Color Schemes

Copyright 2002 Cynthia Brewer, Mark Harrower, and The Pennsylvania State University

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.
```

### ISC: delaunator 5.1.0

```text
ISC License

Copyright (c) 2026, Mapbox

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

### MIT: @braintree/sanitize-url 7.1.2

```text
MIT License

Copyright (c) 2017 Braintree

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: @iconify/utils 3.1.7

```text
MIT License

Copyright (c) 2021-PRESENT Vjacheslav Trushkin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: @kurkle/color 0.3.4 (chart.js), 0.3.2 (chart.umd.js)

```text
The MIT License (MIT)

Copyright (c) 2018-2024 Jukka Kurkela

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### MIT: @mermaid-js/parser 1.2.1

```text
The MIT License (MIT)

Copyright (c) 2023 Yokozuna59

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: @shikijs/core 4.4.3, @shikijs/engine-javascript 4.4.3, @shikijs/langs 4.4.3, @shikijs/primitive 4.4.3, @shikijs/themes 4.4.3, @shikijs/transformers 4.4.3, @shikijs/types 4.4.3

```text
MIT License

Copyright (c) 2021 Pine Wu
Copyright (c) 2023 Anthony Fu <https://github.com/antfu>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: @shikijs/vscode-textmate 10.0.2

```text
The MIT License (MIT)

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: @upsetjs/venn.js 2.0.0

```text
MIT License

Copyright (c) 2013 Ben Frederickson
Copyright (c) 2021 Samuel Gratzl

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: @xterm/addon-fit 0.10.0

```text
Copyright (c) 2019, The xterm.js authors (https://github.com/xtermjs/xterm.js)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### MIT: @xterm/xterm 5.5.0

```text
Copyright (c) 2017-2019, The xterm.js authors (https://github.com/xtermjs/xterm.js)
Copyright (c) 2014-2016, SourceLair Private Company (https://www.sourcelair.com)
Copyright (c) 2012-2013, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### MIT: ccount 2.0.1, character-entities-html4 2.1.0, character-entities-legacy 3.0.0, comma-separated-tokens 2.0.3, hast-util-whitespace 3.0.0, html-void-elements 3.0.0, space-separated-tokens 2.0.2, stringify-entities 4.0.4, zwitch 2.0.4

```text
(The MIT License)

Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com>
Copyright (c) 2015 Titus Wormer <mailto:tituswormer@gmail.com>
Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### MIT: Chart.js 4.6.1

```text
The MIT License (MIT)

Copyright (c) 2014-2024 Chart.js Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### MIT: cose-base 1.0.3, cose-base 2.2.0, layout-base 1.0.2, layout-base 2.0.1

```text
MIT License

Copyright (c) 2019 iVis@Bilkent
Copyright (c) 2019 - present, iVis@Bilkent.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: cytoscape 3.34.3, cytoscape-cose-bilkent 4.1.0

```text
Copyright (c) 2016-2026, The Cytoscape Consortium.
Copyright (c) 2016-2018, The Cytoscape Consortium.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: cytoscape-fcose 2.2.0

```text
Copyright (c) 2018 - present, iVis-at-Bilkent.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: dagre-d3-es 7.0.14

```text
Original dagre-d3 copyright: Copyright (c) 2013 Chris Pettitt
Original dagre copyright: Copyright (c) 2012-2014 Chris Pettitt
Original graphlib copyright: Copyright (c) 2012-2014 Chris Pettitt

Copyright (c) 2022-2024 Thibaut Lassalle, David Newell, Alois Klink, Sidharth Vinod and dagre-es contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### MIT: dayjs 1.11.23

```text
MIT License

Copyright (c) 2018-present, iamkun

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: Electron 45.0.0

```text
Copyright (c) Electron contributors
Copyright (c) 2013-2020 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### MIT: es-toolkit 1.52.0

```text
MIT License

Copyright (c) 2024 Viva Republica, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: hast-util-to-html 9.0.5

```text
(The MIT License)

Copyright (c) Titus Wormer <tituswormer@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### MIT: js-yaml 4.3.0

js-yaml 4.3.0: the text is js-yaml 4.3.2's LICENSE, as installed.

```text
(The MIT License)

Copyright (C) 2011-2015 by Vitaly Puzrin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### MIT: katex 0.18.2

```text
The MIT License (MIT)

Copyright (c) 2013-2020 Khan Academy and other contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: khroma 2.1.0

```text
The MIT License (MIT)

Copyright (c) 2019-present Fabio Spampinato, Andrew Maney

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### MIT: lodash-es 4.17.23, lodash-es 4.18.1

lodash-es 4.17.23: the text is lodash-es 4.18.1's LICENSE, as installed.

```text
Copyright OpenJS Foundation and other contributors <https://openjsf.org/>

Based on Underscore.js, copyright Jeremy Ashkenas,
DocumentCloud and Investigative Reporters & Editors <http://underscorejs.org/>

This software consists of voluntary contributions made by many
individuals. For exact contribution history, see the revision history
available at https://github.com/lodash/lodash

The following license applies to all parts of this software except as
documented below:

====

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

====

Copyright and related rights for sample code are waived via CC0. Sample
code is defined as all source code displayed within the prose of the
documentation.

CC0: http://creativecommons.org/publicdomain/zero/1.0/

====

Files located in the node_modules and vendor directories are externally
maintained libraries used by this software which have their own
licenses; we recommend you read them, as their terms may differ from the
terms above.
```

### MIT: marked 16.4.2, marked 18.1.2

```text
# License information

## Contribution License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license. You are also implicitly verifying that
all code is your original work. `</legalese>`

## Marked

Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/)
Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Markdown

Copyright © 2004, John Gruber
http://daringfireball.net/
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
* Neither the name “Markdown” nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

This software is provided by the copyright holders and contributors “as is” and any express or implied warranties, including, but not limited to, the implied warranties of merchantability and fitness for a particular purpose are disclaimed. In no event shall the copyright owner or contributors be liable for any direct, indirect, incidental, special, exemplary, or consequential damages (including, but not limited to, procurement of substitute goods or services; loss of use, data, or profits; or business interruption) however caused and on any theory of liability, whether in contract, strict liability, or tort (including negligence or otherwise) arising in any way out of the use of this software, even if advised of the possibility of such damage.
```

### MIT: mermaid 11.17.2

```text
The MIT License (MIT)

Copyright (c) 2014 - 2022 Knut Sveidqvist

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: mnemosyne-memory (the memory engine) 3.15.1, commit 78506708aae344635e01a24f67a7319efc36fce9

```text
MIT License

Copyright (c) 2026 Abdias J

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: node-pty 1.1.0

```text
Copyright (c) 2012-2015, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.



The MIT License (MIT)

Copyright (c) 2016, Daniel Imms (http://www.growingwiththeweb.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.



MIT License

Copyright (c) 2018 - present Microsoft Corporation

All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: oniguruma-parser 0.12.2, oniguruma-to-es 4.3.6, regex 6.1.0, regex-recursion 6.0.2, regex-utilities 2.3.0

```text
MIT License

Copyright (c) 2025-2026 Steven Levithan
Copyright (c) 2025 Steven Levithan
Copyright (c) 2024 Steven Levithan
Copyright (c) 2024-2026 Steven Levithan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: Preact 11.1.0

```text
The MIT License (MIT)

Copyright (c) 2015-present Jason Miller

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: property-information 7.2.0

```text
(The MIT License)

Copyright (c) Titus Wormer <mailto:tituswormer@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### MIT: roughjs 4.6.6

```text
MIT License

Copyright (c) 2019 Preet Shihn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: stylis 4.4.0

```text
MIT License

Copyright (c) 2016-present Sultan Tarimo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: three.js 0.186.1

```text
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### MIT: ts-dedent 2.3.0

```text
MIT License

Copyright (c) 2018 Tamino Martinius

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT: uuid 14.0.2

```text
The MIT License (MIT)

Copyright (c) 2010-2020 Robert Kieffer and other contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### MIT: winpty 0.4.4-dev

```text
The MIT License (MIT)

Copyright (c) 2011-2016 Ryan Prichard

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
```

### OFL-1.1: KaTeX fonts 0.18.2 (KaTeX's)

```text
Copyright (c) 2009-2010, Design Science, Inc. (<www.mathjax.org>)
Copyright (c) 2014-2018 Khan Academy (<www.khanacademy.org>),
with Reserved Font Names KaTeX_AMS, KaTeX_Caligraphic, KaTeX_Fraktur, KaTeX_Main,
KaTeX_Math, KaTeX_SansSerif, KaTeX_Script, KaTeX_Size1, KaTeX_Size2, KaTeX_Size3,
KaTeX_Size4 and KaTeX_Typewriter.

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### Unlicense: robust-predicates 3.0.3

```text
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <http://unlicense.org>
```

### Apache-2.0: @chevrotain/gast 11.1.2, @chevrotain/regexp-to-ast 11.1.2, @chevrotain/utils 11.1.2, chevrotain 11.1.2

```text
Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### MIT: chevrotain-allstar 0.3.1

```text
Copyright 2022 TypeFox GmbH

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### MIT: langium 4.2.1

```text
Copyright 2021 TypeFox GmbH

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### MIT: vscode-jsonrpc 8.2.0, vscode-languageserver-protocol 3.17.5, vscode-languageserver-textdocument 1.0.12, vscode-languageserver-types 3.17.5

```text
Copyright (c) Microsoft Corporation

All rights reserved.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### MIT: vscode-uri 3.1.0

```text
The MIT License (MIT)

Copyright (c) Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### MIT: ConPTY (conpty.dll, OpenConsole.exe) 1.23.251008001

```text
Copyright (c) Microsoft Corporation. All rights reserved.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

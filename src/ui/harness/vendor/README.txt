Vendored, verbatim or bundled at dev time — the served page never reads node_modules.
shiki@4.4.3 (MIT) — core + engine-javascript + 23 languages + github-dark/light, bundled by esbuild from scripts/vendor-src/shiki-entry.mjs.
@pierre/diffs@1.4.3 (Apache-2.0) — the headless core (parse/render/trim), bundled with the shiki shim; the React bindings are not part of the entry.
katex@0.18.2 (MIT) — the shipped dist (js, css, woff2 fonts), copied.
mermaid@11.17.2 (MIT) — the complete ESM build bundled by esbuild from scripts/vendor-src/mermaid-entry.mjs (the shipped dist lazy-loads chunks, so a copy cannot be imported whole).
Rebuild after bumping the devDependencies: node scripts/vendor-render-deps.mjs
shelf/ — the libraries every artifact's address serves at /_filament/lib/ (Preact with htm, Chart.js, d3, three.js, marked, DOMPurify; MIT, ISC, Apache-2.0), at the exact versions scripts/vendor-shelf.mjs names, each folder with its licences. Rebuild: node scripts/vendor-shelf.mjs
Licences: each folder's LICENSE (and NOTICE, where a package has one), beside its code; every third-party component, with its version, licence and source, in THIRD_PARTY_NOTICES.md at the repository's root.

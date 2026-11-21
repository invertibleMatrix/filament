// @ts-check
// Reproducibly builds the harness's vendored renderer dependencies (all MIT/Apache-2.0 — the owner's dependency rule,
// 2026-09-22): the curated shiki bundle, the headless @pierre/diffs core, KaTeX's dist (js + css + woff2 fonts) and
// mermaid's single-file dist. Run with `node scripts/vendor-render-deps.mjs` after bumping the devDependencies; the vendor folder is committed, the served page never reads node_modules.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const vendor = (p) => join(root, "src", "ui", "harness", "vendor", p);
const here = (p) => join(root, "scripts", "vendor-src", p);

// Each rebuilt folder gets its licences beside its code: every package esbuild put in its bundle (the build's metafile
// names them) or its files are copied from. THIRD_PARTY_NOTICES.md at the repository's root lists them all, with the
// code packages carry pre-bundled in their own dist, which no metafile sees.
/** The package folders a bundle holds code from. @param {import("esbuild").Metafile} meta */
const packagesIn = (meta) => [
  ...new Set(
    Object.values(meta.outputs).flatMap((o) =>
      Object.entries(o.inputs).flatMap(([file, i]) => {
        const m = i.bytesInOutput ? /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(resolve(file)) : null;
        return m ? [m[1]] : [];
      }),
    ),
  ),
];
/**
 * A folder's LICENSE: `main`'s licence files whole, then every other package's by name, a text several share given once
 * under all their names, then `extra`'s [title, text]; and NOTICE, their NOTICE files whole, where any has one.
 * @param {string} folder @param {string[]} dirs @param {string} main @param {[string, string][]} [extra]
 */
const licences = (folder, dirs, main, extra = []) => {
  /** @type {Map<string, string[]>} */
  const texts = new Map();
  const notices = [];
  const key = (/** @type {{ name: string, version: string }} */ p) => (p.name === main ? "" : `${p.name} ${p.version}`);
  const pkgs = dirs.map((dir) => ({ dir, ...JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) })).sort((a, b) => (key(a) < key(b) ? -1 : 1));
  for (const { dir, name, version, license, repository } of pkgs) {
    const files = readdirSync(dir).sort();
    const read = (/** @type {RegExp} */ re) => files.filter((f) => re.test(f)).map((f) => readFileSync(join(dir, f), "utf8").trim()).join("\n\n");
    const text = read(/^licen[cs]e(-\w+)?(\.(md|txt))?$/i) || `${license}, by its package.json; the package ships no licence text (${repository?.url ?? repository}).`;
    texts.set(text, [...(texts.get(text) ?? []), `${name} ${version}`]);
    const notice = read(/^notice(\.(md|txt))?$/i);
    if (notice) notices.push(`${name} ${version}\n\n${notice}`);
  }
  const block = (/** @type {string} */ title, /** @type {string} */ text) => `${title}\n${"=".repeat(Math.max(...title.split("\n").map((l) => l.length)))}\n\n${text.trim()}\n`;
  const head = "The licences of the third-party code in this folder. THIRD_PARTY_NOTICES.md at the repository's root lists every component.\n";
  writeFileSync(vendor(`${folder}/LICENSE`), [head, ...[...texts].map(([text, names]) => block(names.join("\n"), text)), ...extra.map(([t, x]) => block(t, x))].join("\n\n"));
  if (notices.length) writeFileSync(vendor(`${folder}/NOTICE`), `${notices.join("\n\n")}\n`);
};
const GRAMMAR_LICENCES = "Each grammar @shikijs/langs holds keeps its own licence, which the tm-grammars package records with its source: https://github.com/shikijs/textmate-grammars-themes/tree/main/packages/tm-grammars";
const THEME_LICENCES = "Each theme @shikijs/themes holds keeps its own licence, which the tm-themes package records with its source: https://github.com/shikijs/textmate-grammars-themes/tree/main/packages/tm-themes";

// pierre/diffs imports from the full "shiki" package (every language, lazily fetched, plus an optional wasm
// engine). Our curated bundle is the only shiki that ships, so "shiki" and "shiki/*" resolve to the shim, which
// forwards to the curated core.
const shikiShim = {
  name: "shiki-shim",
  setup(b) {
    b.onResolve({ filter: /^shiki$/ }, () => ({ path: here("shiki-shim/index.mjs") }));
    b.onResolve({ filter: /^shiki\/wasm$/ }, () => ({ path: here("shiki-shim/wasm.mjs") }));
    b.onResolve({ filter: /^shiki\/.+$/ }, () => ({ path: here("shiki-shim/index.mjs") }));
  },
};

mkdirSync(vendor("shiki"), { recursive: true });
mkdirSync(vendor("pierre"), { recursive: true });

// 1. The curated shiki bundle: core + the JavaScript regex engine (no wasm), 23 languages,
//    github-dark/light. One file, lazily imported by the page when the first code block closes.
const shiki = await build({
  entryPoints: [here("shiki-entry.mjs")],
  bundle: true,
  minify: true,
  format: "esm",
  outfile: vendor("shiki/shiki.mjs"),
  metafile: true,
  logLevel: "warning",
});
licences("shiki", packagesIn(shiki.metafile), "@shikijs/core", [["The grammars", GRAMMAR_LICENCES], ["The themes", THEME_LICENCES]]);

// 2. The headless pierre core: parse a patch, render a file diff (word-level, syntax-highlighted, context-collapsed)
//    through OUR shiki. The React bindings stay out of the entry, so they stay out of the bundle.
const pierre = await build({
  entryPoints: [here("pierre-entry.mjs")],
  bundle: true,
  minify: true,
  format: "esm",
  outfile: vendor("pierre/pierre.mjs"),
  plugins: [shikiShim],
  metafile: true,
  logLevel: "warning",
});
licences("pierre", packagesIn(pierre.metafile), "@pierre/diffs", [["The grammars", GRAMMAR_LICENCES]]);

// 3. KaTeX: dist as shipped (js, css, woff2 fonts — the css references the fonts relatively).
rmSync(vendor("katex"), { recursive: true, force: true });
mkdirSync(vendor("katex/fonts"), { recursive: true });
const katexDist = join(root, "node_modules", "katex", "dist");
cpSync(join(katexDist, "katex.min.js"), vendor("katex/katex.min.js"));
cpSync(join(katexDist, "katex.min.css"), vendor("katex/katex.min.css"));
for (const f of readdirSync(join(katexDist, "fonts"))) if (f.endsWith(".woff2")) cpSync(join(katexDist, "fonts", f), vendor("katex/fonts/" + f));
licences("katex", [join(root, "node_modules", "katex")], "katex", [["KaTeX's fonts (fonts/*.woff2)", readFileSync(here("katex-fonts-OFL.txt"), "utf8")]]);

// 4. mermaid: the complete ESM build bundled to one file (the shipped dist lazy-loads its diagram chunks, so a
//    copied file cannot be import()ed whole); the page imports it only when a mermaid fence appears.
rmSync(vendor("mermaid"), { recursive: true, force: true });
mkdirSync(vendor("mermaid"), { recursive: true });
const mermaid = await build({
  entryPoints: [here("mermaid-entry.mjs")],
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  outfile: vendor("mermaid/mermaid.mjs"),
  metafile: true,
  logLevel: "warning",
});
licences("mermaid", packagesIn(mermaid.metafile), "mermaid");

const v = (name) => require(join(root, "node_modules", name, "package.json")).version;
writeFileSync(vendor("README.txt"), [
  "Vendored, verbatim or bundled at dev time — the served page never reads node_modules.",
  `shiki@${v("shiki")} (MIT) — core + engine-javascript + 23 languages + github-dark/light, bundled by esbuild from scripts/vendor-src/shiki-entry.mjs.`,
  `@pierre/diffs@${v("@pierre/diffs")} (Apache-2.0) — the headless core (parse/render/trim), bundled with the shiki shim; the React bindings are not part of the entry.`,
  `katex@${v("katex")} (MIT) — the shipped dist (js, css, woff2 fonts), copied.`,
  `mermaid@${v("mermaid")} (MIT) — the complete ESM build bundled by esbuild from scripts/vendor-src/mermaid-entry.mjs (the shipped dist lazy-loads chunks, so a copy cannot be imported whole).`,
  "Rebuild after bumping the devDependencies: node scripts/vendor-render-deps.mjs",
  "shelf/ — the libraries every artifact's address serves at /_filament/lib/ (Preact with htm, Chart.js, d3, three.js, marked, DOMPurify; MIT, ISC, Apache-2.0), at the exact versions scripts/vendor-shelf.mjs names, each folder with its licences. Rebuild: node scripts/vendor-shelf.mjs",
  "Licences: each folder's LICENSE (and NOTICE, where a package has one), beside its code; every third-party component, with its version, licence and source, in THIRD_PARTY_NOTICES.md at the repository's root.",
  "",
].join("\n"));

console.log("vendor tree rebuilt under src/ui/harness/vendor/");

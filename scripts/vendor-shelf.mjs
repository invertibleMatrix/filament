// @ts-check
// Builds the shelf (the Space Apps plan of 10-29, "Runtime and offline"): the browser libraries every artifact's
// address serves at `/_filament/lib/`, so an app's page loads them with no network — Preact with its hooks and htm,
// Chart.js, d3, three.js with a few of its addons, marked and DOMPurify, each at the exact version below, each in a
// folder named by its major version, so a later shelf keeps an older major beside a newer one. Each library is one ES
// module (bundled and minified by esbuild) and, where the library ships one, a classic script that sets its global;
// each folder keeps its licences. Writes `src/ui/harness/vendor/shelf/` and its `shelf.json`, which Filament serves and its guide
// names; the served page never reads node_modules. Installs the libraries into a temporary folder of its own (never the
// project's node_modules), or reads an install already made: `node scripts/vendor-shelf.mjs [--from <folder>]`.
import { build, transform } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shelf = join(root, "src", "ui", "harness", "vendor", "shelf");

/** The libraries and the exact versions the shelf holds. */
const VERSIONS = Object.freeze({
  preact: "11.1.0",
  htm: "3.1.1",
  "chart.js": "4.6.1",
  d3: "7.9.0",
  three: "0.186.1",
  marked: "18.1.2",
  dompurify: "3.4.17",
});

const fromAt = process.argv.indexOf("--from");
const made = fromAt < 0 ? mkdtempSync(join(tmpdir(), "filament-shelf-")) : null;
const from = made || process.argv[fromAt + 1];
if (made) {
  writeFileSync(join(made, "package.json"), JSON.stringify({ name: "filament-shelf", private: true }));
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(npm, ["install", "--no-audit", "--no-fund", "--ignore-scripts", ...Object.entries(VERSIONS).map(([p, v]) => `${p}@${v}`)], { cwd: made, stdio: "inherit", shell: process.platform === "win32" });
}
const mods = join(from, "node_modules");
for (const [p, v] of Object.entries(VERSIONS)) {
  const had = JSON.parse(readFileSync(join(mods, p, "package.json"), "utf8")).version;
  if (had !== v) throw new Error(`${p} is ${had} in ${mods}, and the shelf holds ${v}`);
}

/** A library's folder on the shelf: its name and its major version (three's minor, as three has no major). */
const folderOf = (/** @type {keyof typeof VERSIONS} */ p) => {
  const [major, minor] = VERSIONS[p].split(".");
  return `${p}@${major === "0" ? `0.${minor}` : major}`;
};

rmSync(shelf, { recursive: true, force: true });
mkdirSync(shelf, { recursive: true });

/** One ES module from `contents`, resolved in the install, minified; `external` names import paths kept as written. */
const moduleOf = async (/** @type {string} */ out, /** @type {string} */ contents, /** @type {Record<string, string>} */ external = {}) => {
  mkdirSync(dirname(join(shelf, out)), { recursive: true });
  await build({
    stdin: { contents, resolveDir: from, sourcefile: `${out}.entry.mjs` },
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2022",
    outfile: join(shelf, out),
    legalComments: "eof",
    logLevel: "warning",
    plugins: [
      {
        name: "kept-as-written",
        setup(b) {
          for (const [spec, to] of Object.entries(external))
            b.onResolve({ filter: new RegExp(`^${spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }, () => ({ path: to, external: true }));
        },
      },
    ],
  });
};
/** A classic script, copied as the library ships it (minified again where it ships unminified). */
const scriptOf = async (/** @type {string} */ out, /** @type {string} */ file, minify = false) => {
  mkdirSync(dirname(join(shelf, out)), { recursive: true });
  const text = readFileSync(join(mods, file), "utf8");
  writeFileSync(join(shelf, out), minify ? (await transform(text, { minify: true, legalComments: "inline", target: "es2020" })).code : text);
};
/** A folder's licences, each library's whole under its name. */
const licences = (/** @type {string} */ folder, /** @type {[string, string][]} */ files) =>
  writeFileSync(
    join(shelf, folder, "LICENSE.txt"),
    files.map(([name, file]) => `${name}\n${"=".repeat(name.length)}\n\n${readFileSync(join(mods, file), "utf8").trim()}\n`).join("\n\n"),
  );

const preact = folderOf("preact");
await moduleOf(
  `${preact}/preact.js`,
  'export * from "preact"; export * from "preact/hooks"; import { h } from "preact"; import htm from "htm"; export { htm }; export const html = htm.bind(h);',
);
licences(preact, [[`preact ${VERSIONS.preact}`, "preact/LICENSE"], [`htm ${VERSIONS.htm}`, "htm/LICENSE"]]);

const chart = folderOf("chart.js");
await moduleOf(`${chart}/chart.js`, 'export * from "chart.js"; export { default } from "chart.js/auto";');
await scriptOf(`${chart}/chart.umd.js`, "chart.js/dist/chart.umd.min.js");
licences(chart, [[`chart.js ${VERSIONS["chart.js"]}`, "chart.js/LICENSE.md"], ["@kurkle/color", "@kurkle/color/LICENSE.md"]]);

const d3 = folderOf("d3");
await moduleOf(`${d3}/d3.js`, 'export * from "d3";');
await scriptOf(`${d3}/d3.umd.js`, "d3/dist/d3.min.js");
licences(d3, [[`d3 ${VERSIONS.d3} (each of its d3-* modules is under the same licence, by the same author)`, "d3/LICENSE"]]);

const three = folderOf("three");
await moduleOf(`${three}/three.js`, 'export * from "three";');
// A few addons games and 3D views reach for, each importing the shelf's own three.
const ADDONS = Object.freeze({ OrbitControls: "controls/OrbitControls.js", PointerLockControls: "controls/PointerLockControls.js", GLTFLoader: "loaders/GLTFLoader.js" });
for (const [name, file] of Object.entries(ADDONS)) await moduleOf(`${three}/${name}.js`, `export * from "three/examples/jsm/${file}";`, { three: "./three.js" });
licences(three, [[`three ${VERSIONS.three}`, "three/LICENSE"]]);

const marked = folderOf("marked");
await moduleOf(`${marked}/marked.js`, 'export * from "marked"; export { marked as default } from "marked";');
await scriptOf(`${marked}/marked.umd.js`, "marked/lib/marked.umd.js", true);
licences(marked, [[`marked ${VERSIONS.marked}`, "marked/LICENSE"]]);

const purify = folderOf("dompurify");
await moduleOf(`${purify}/purify.js`, 'export * from "dompurify"; export { default } from "dompurify";');
await scriptOf(`${purify}/purify.umd.js`, "dompurify/dist/purify.min.js");
licences(purify, [[`dompurify ${VERSIONS.dompurify}`, "dompurify/LICENSE"]]);

/** What the shelf holds, as Filament serves it and its guide names it. */
const libraries = [
  {
    name: "Preact",
    version: VERSIONS.preact,
    with: `htm ${VERSIONS.htm}`,
    license: "MIT; htm Apache-2.0",
    module: `${preact}/preact.js`,
    words: "components with no build step: h, render, Component, Fragment, every hook (useState, useEffect …) and htm's html tag",
  },
  { name: "Chart.js", version: VERSIONS["chart.js"], license: "MIT", module: `${chart}/chart.js`, script: `${chart}/chart.umd.js`, global: "Chart", words: "charts, every chart type registered: Chart (the default export too)" },
  { name: "d3", version: VERSIONS.d3, license: "ISC", module: `${d3}/d3.js`, script: `${d3}/d3.umd.js`, global: "d3", words: "every d3 module: import * as d3" },
  {
    name: "three.js",
    version: VERSIONS.three,
    license: "MIT",
    module: `${three}/three.js`,
    addons: Object.keys(ADDONS).map((n) => `${three}/${n}.js`),
    words: `3D: import * as THREE; its addons ${Object.keys(ADDONS).join(", ")} beside it, each importing this three`,
  },
  { name: "marked", version: VERSIONS.marked, license: "MIT", module: `${marked}/marked.js`, script: `${marked}/marked.umd.js`, global: "marked", words: "Markdown to HTML: marked (the default export too)" },
  {
    name: "DOMPurify",
    version: VERSIONS.dompurify,
    license: "Apache-2.0 or MPL-2.0",
    module: `${purify}/purify.js`,
    script: `${purify}/purify.umd.js`,
    global: "DOMPurify",
    words: "HTML made safe to show: DOMPurify.sanitize (the default export)",
  },
];
/** Every file under the shelf, by its path in it. @param {string} dir @returns {string[]} */
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [relative(shelf, join(dir, n)).replace(/\\/g, "/")]));
const files = walk(shelf).sort();
writeFileSync(join(shelf, "shelf.json"), `${JSON.stringify({ libraries, files }, null, 2)}\n`);
writeFileSync(
  join(shelf, "README.txt"),
  [
    "The shelf: browser libraries every artifact's address serves at /_filament/lib/, so an app's page loads them with no network.",
    "Built by node scripts/vendor-shelf.mjs, from the exact versions it names; each folder keeps its libraries' licences.",
    ...libraries.map((l) => `${l.name}@${l.version}${l.with ? ` with ${l.with}` : ""} (${l.license})`),
    "",
  ].join("\n"),
);
for (const f of files) console.log(`${f}  ${Math.round(statSync(join(shelf, f)).size / 1024)} KB`);
if (made) rmSync(made, { recursive: true, force: true });

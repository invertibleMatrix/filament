// The vendored shiki bundle's source of truth (see scripts/vendor-render-deps.mjs). Curated languages: every
// addition is a real bundle-size cost, so nothing speculative ships.
import { createHighlighterCore } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import javascript from "@shikijs/langs/javascript";
import typescript from "@shikijs/langs/typescript";
import jsx from "@shikijs/langs/jsx";
import tsx from "@shikijs/langs/tsx";
import json from "@shikijs/langs/json";
import css from "@shikijs/langs/css";
import html from "@shikijs/langs/html";
import markdown from "@shikijs/langs/markdown";
import bash from "@shikijs/langs/bash";
import shellscript from "@shikijs/langs/shellscript";
import powershell from "@shikijs/langs/powershell";
import python from "@shikijs/langs/python";
import rust from "@shikijs/langs/rust";
import go from "@shikijs/langs/go";
import java from "@shikijs/langs/java";
import c from "@shikijs/langs/c";
import cpp from "@shikijs/langs/cpp";
import csharp from "@shikijs/langs/csharp";
import yaml from "@shikijs/langs/yaml";
import sql from "@shikijs/langs/sql";
import diff from "@shikijs/langs/diff";
import toml from "@shikijs/langs/toml";
import ini from "@shikijs/langs/ini";
import githubDark from "@shikijs/themes/github-dark";
import githubLight from "@shikijs/themes/github-light";

export { createHighlighterCore, createJavaScriptRegexEngine };
export const LANGS = {
  javascript, typescript, jsx, tsx, json, css, html, markdown, bash, shellscript, powershell,
  python, rust, go, java, c, cpp, csharp, yaml, sql, diff, toml, ini,
};
export const THEMES = { "github-dark": githubDark, "github-light": githubLight };

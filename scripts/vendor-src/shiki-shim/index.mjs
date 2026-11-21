// pierre/diffs imports from the full "shiki" package: every language, lazily fetched, plus helpers. Our curated
// bundle is the only shiki that ships, so "shiki"/"shiki/*" resolve here. Grammar-free helpers re-export from
// @shikijs/core directly; the language-bearing paths are answered from the curated set.
import { createHighlighterCore, createJavaScriptRegexEngine, LANGS, THEMES } from "../shiki-entry.mjs";
import { normalizeTheme, getTokenStyleObject, stringifyTokenStyle } from "@shikijs/core";

export { normalizeTheme, getTokenStyleObject, stringifyTokenStyle, createJavaScriptRegexEngine };
export { createHighlighterCore, LANGS, THEMES };

// The full package's bundledLanguages is a map of name → lazy loader; ours loads the curated grammar, unknown names
// resolve to undefined so pierre falls back to plain text.
export const bundledLanguages = Object.fromEntries(
  Object.entries(LANGS).map(([name, mod]) => [name, () => Promise.resolve(mod)]),
);
export const bundledLanguagesInfo = Object.keys(LANGS).map((id) => ({ id, name: id, import: () => Promise.resolve(LANGS[id]) }));

export async function createHighlighter({ themes = [], langs = [] } = {}) {
  return createHighlighterCore({
    themes: [...themes, ...Object.values(THEMES)],
    langs: [...langs, ...Object.values(LANGS)],
    engine: createJavaScriptRegexEngine(),
  });
}

// The oniguruma engine never ships; pierre only reaches for it when asked for wasm explicitly.
export const createOnigurumaEngine = () => {
  throw new Error("the oniguruma engine is not shipped: the JavaScript regex engine is in use");
};

let hlSingleton = null;
const shared = () => (hlSingleton ??= createHighlighterCore({ themes: Object.values(THEMES), langs: Object.values(LANGS), engine: createJavaScriptRegexEngine() }));

export async function codeToHtml(code, options) {
  return (await shared()).codeToHtml(code, options);
}
export async function codeToTokensBase(code, options) {
  return (await shared()).codeToTokensBase(code, options);
}
export async function codeToHast(code, options) {
  return (await shared()).codeToHast(code, options);
}
// A CSS-variables theme (shiki ThemeRegistration) — pierre uses it so diff colors come from the page's tokens.
export const createCssVariablesTheme = () => ({ name: "filament-vars", type: "dark", colors: {}, tokenColors: [] });

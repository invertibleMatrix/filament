// @ts-check
// The files a session's rules refuse a read of, in a form a worker thread carries — the grep hand's walk reads in one:
// the rules that speak for read, in their order, each its glob's source and its verdict (app/agent/rules.js
// `readRules`). Claude Code's Read rules speak for its Grep and Glob; Filament's do so too: what grep searches and glob
// lists leaves out the files a read of would be refused, so a search is no way around a deny.

/** The rules that speak for a read, in order: each glob compiled to its source (case-insensitive), and its verdict. @typedef {{ source: string, verdict: string }[]} ReadRules */

/**
 * Whether a file is kept out — a read naming it from `root` (`src/a.js`) or whole would be refused: the first rule that
 * covers the name denies, or a review covers it beside a deny, as `ruleFor` judges a read. Null where no rule refuses.
 * @param {{ root: string, rules: ReadRules } | null | undefined} fence
 * @returns {((path: string) => boolean) | null}
 */
export function keptOut(fence) {
  if (!fence?.rules?.length) return null;
  const rules = fence.rules.map((r) => ({ re: new RegExp(r.source, "i"), verdict: r.verdict }));
  /** @param {string} name */
  const refused = (name) => {
    const covering = rules.filter((r) => r.re.test(name));
    if (!covering.length) return false;
    return covering[0].verdict === "deny" || (covering.some((r) => r.verdict === "review") && covering.some((r) => r.verdict === "deny"));
  };
  const root = fence.root.replace(/\\/g, "/").replace(/\/+$/, "");
  const folded = process.platform === "win32" ? root.toLowerCase() : root;
  return (path) => {
    const whole = path.replace(/\\/g, "/");
    const at = process.platform === "win32" ? whole.toLowerCase() : whole;
    const rel = at.startsWith(`${folded}/`) ? whole.slice(root.length + 1) : "";
    return [path, whole, ...(rel ? [rel, rel.replace(/\//g, "\\")] : [])].some(refused);
  };
}

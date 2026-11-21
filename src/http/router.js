// @ts-check
// One route table for the whole HTTP surface: [method, pattern, handler] rows matched in order, first match wins.
// A pattern is literal segments; `:name` takes one segment, `:name*` takes one or more (a greedy tail). Params arrive
// undecoded; a handler decodes the ones it reads.

/** @typedef {[method: string, pattern: string, handler: (r: any, a?: any) => any]} RouteRow */
/** @typedef {(method: string, path: string) => { handler: (r: any, a?: any) => any, params: Record<string, string>, pattern: string } | null} RouteMatch */

/** @param {string} pattern */
// Empty segments are KEPT on both sides: `//` never matches a literal segment (404 there), but it does fill a `:name`
// or a `:name*` with the empty string — `/requests//cancel` reaches the cancel row with id "" and `/requests/` reaches
// the detail row; a handler that needs an id answers its own 404 for an empty one. Both pattern and path start with
// one empty segment from the leading `/`, which cancels. test/http-router.test.js pins each case.
const compile = (pattern) => {
  const segs = pattern.split("/");
  /** @returns {{ params: Record<string, string> } | null} */
  return (path) => {
    const parts = path.split("/");
    /** @type {Record<string, string>} */
    const params = {};
    let i = 0;
    for (let s = 0; s < segs.length; s++, i++) {
      const seg = segs[s];
      if (seg.length > 2 && seg.startsWith(":") && seg.endsWith("*")) {
        const take = parts.length - i - (segs.length - s - 1);
        if (take < 1) return null;
        params[seg.slice(1, -1)] = parts.slice(i, i + take).join("/");
        i += take - 1;
        continue;
      }
      if (i >= parts.length) return null;
      if (seg.startsWith(":")) {
        params[seg.slice(1)] = parts[i];
        continue;
      }
      if (seg !== parts[i]) return null;
    }
    return i === parts.length ? { params } : null;
  };
};

/**
 * @param {RouteRow[]} rows  in match order: where two rows could answer the same path, the first one wins.
 *   Method `"*"` answers any method (the admin area 404s unknown ones itself). A match says its row's pattern, which
 *   a gate that judges by the row asks (the admin API's view-only devices, admin/remote.js).
 * @returns {RouteMatch}
 */
export function createRouter(rows) {
  const table = rows.map(([method, pattern, handler]) => ({ method, pattern, match: compile(pattern), handler }));
  return (method, path) => {
    for (const t of table) {
      if (t.method !== method && t.method !== "*") continue;
      const m = t.match(path);
      if (m) return { handler: t.handler, params: m.params, pattern: t.pattern };
    }
    return null;
  };
}

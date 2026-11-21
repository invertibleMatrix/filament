// @ts-check
// A file-path glob as a regular expression, the way the MCP server's Glob and the `glob` hand read one: `*` within
// one path segment, `**` across segments (`**/` optional), `?` one character, `{a,b}` alternatives, each a glob too;
// case-insensitive; backslashes are read as forward slashes, so a Windows-flavoured pattern matches a normalised path.
/** @param {string} pattern */
export function globToRegExp(pattern) {
  return new RegExp(`^${source(String(pattern).replace(/\\/g, "/"))}$`, "i");
}

/** A glob's expression, unanchored. @param {string} p */
function source(p) {
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        i++;
        if (p[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = p.indexOf("}", i);
      if (end > i) {
        re += "(?:" + p.slice(i + 1, end).split(",").map(source).join("|") + ")";
        i = end;
      } else re += "\\{";
    } else if (/[.+^$()|[\]\\]/.test(c)) re += "\\" + c;
    else re += c;
  }
  return re;
}

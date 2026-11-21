// Vendored from shared-utils 1.4.2.

/** One CSV line from its fields. */
export function csvRow(fields) {
  return fields.map((f) => String(f)).join(",");
}

/** The fields of one CSV line, a quoted field read with its commas and doubled quotes. */
export function parseRow(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

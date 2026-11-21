// Vendored from shared-utils 1.4.2.

/** One CSV line from its fields, each quoted where it holds a comma, a quote or a line break. */
export function csvRow(fields) {
  return fields
    .map((f) => {
      const s = String(f);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(",");
}

/** The fields of one CSV line. */
export function parseRow(line) {
  return line.split(",");
}

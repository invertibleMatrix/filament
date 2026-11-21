// The Pipeline's rows: package.json's scripts, each by its name with the command it runs, as one JSON answer on
// stdout ({ "scripts": [{ "name", "command" }] }). Filament runs it in the project's folder; it only reads.
import { readFileSync } from "node:fs";

let pkg = {};
try {
  pkg = JSON.parse(readFileSync("package.json", "utf8"));
} catch {
  // No package.json: no scripts, and the page says so.
}
const scripts = Object.entries(pkg.scripts || {}).map(([name, command]) => ({ name, command: String(command) }));
process.stdout.write(JSON.stringify({ scripts }));

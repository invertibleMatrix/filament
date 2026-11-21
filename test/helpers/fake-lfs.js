// @ts-check
// A stand-in for Git LFS in a test's own repository (Phase 0 of the owner's 11-09 plan for big repos): git's
// long-running filter (gitattributes' protocol, version 2) as `filter.lfs.process` in the repository's own config —
// never the machine's —, so it stands in for git-lfs whether or not git-lfs is installed, and over a `git lfs install`
// in the user's global config. Clean stores a file's content by its sha256 and answers its pointer, a pointer as it
// is; smudge answers the content a pointer names, and writes a line to its log — so a test reads whether a copy's
// checkout smudged, and with which GIT_LFS_SKIP_SMUDGE.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FILTER = String.raw`
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const [store, log] = process.argv.slice(2);
let buf = Buffer.alloc(0);
const readers = [];
const take = () => {
  if (buf.length < 4) return undefined;
  const n = parseInt(buf.toString("latin1", 0, 4), 16);
  if (n === 0) { buf = buf.subarray(4); return null; }
  if (buf.length < n) return undefined;
  const d = buf.subarray(4, n);
  buf = buf.subarray(n);
  return d;
};
const pump = () => {
  while (readers.length) {
    const got = take();
    if (got === undefined) return;
    readers.shift()(got);
  }
};
process.stdin.on("data", (c) => { buf = Buffer.concat([buf, c]); pump(); });
process.stdin.on("end", () => process.exit(0));
const pkt = () => new Promise((r) => { readers.push(r); pump(); });
const list = async () => { const out = []; for (let p; (p = await pkt()) !== null; ) out.push(p); return out; };
const write = (d) => { const b = Buffer.from(d); process.stdout.write(Buffer.concat([Buffer.from((b.length + 4).toString(16).padStart(4, "0")), b])); };
const flush = () => process.stdout.write("0000");
const POINTER = "version https://git-lfs.github.com/spec/v1\n";
(async () => {
  await list();
  write("git-filter-server\n"); write("version=2\n"); flush();
  await list();
  write("capability=clean\n"); write("capability=smudge\n"); flush();
  for (;;) {
    const head = Object.fromEntries((await list()).map((b) => b.toString().replace(/\n$/, "").split("=")).map(([k, ...v]) => [k, v.join("=")]));
    const content = Buffer.concat(await list());
    const text = content.toString("latin1");
    let out = content;
    if (head.command === "clean") {
      if (!text.startsWith(POINTER)) {
        const oid = crypto.createHash("sha256").update(content).digest("hex");
        fs.mkdirSync(store, { recursive: true });
        fs.writeFileSync(path.join(store, oid), content);
        out = Buffer.from(POINTER + "oid sha256:" + oid + "\nsize " + content.length + "\n");
      }
    } else {
      fs.appendFileSync(log, "smudge " + head.pathname + " skip=" + (process.env.GIT_LFS_SKIP_SMUDGE || "") + "\n");
      const oid = /oid sha256:([0-9a-f]{64})/.exec(text)?.[1];
      if (text.startsWith(POINTER) && oid) {
        try {
          out = fs.readFileSync(path.join(store, oid));
        } catch {
          write("status=error\n"); flush();
          continue;
        }
      }
    }
    write("status=success\n"); flush();
    for (let i = 0; i < out.length; i += 65516) write(out.subarray(i, i + 65516));
    flush(); flush();
  }
})();
`;

/** @param {string} p */
const fwd = (p) => p.replace(/\\/g, "/");

/** A pointer as Git LFS writes one. @param {string} oid @param {number} size */
export const pointerOf = (oid, size) => `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`;

/**
 * The fake's program, store and log, in a folder of their own under the system's temp folder; `made` collects it for
 * the test's cleanup.
 * @param {string[]} made
 */
export function fakeLfs(made) {
  const dir = mkdtempSync(join(tmpdir(), "filament-fake-lfs-"));
  made.push(dir);
  const program = join(dir, "fake-lfs.cjs");
  writeFileSync(program, FILTER);
  const store = join(dir, "store");
  mkdirSync(store);
  const log = join(dir, "smudged.log");
  writeFileSync(log, "");
  return {
    /** The command `filter.lfs.process` names. */
    process: `"${fwd(process.execPath)}" "${fwd(program)}" "${fwd(store)}" "${fwd(log)}"`,
    /** What its smudges wrote, one line each: `smudge <path> skip=<GIT_LFS_SKIP_SMUDGE>`. */
    smudged: () => readFileSync(log, "utf8").split("\n").filter(Boolean),
    /** Its log emptied. */
    forget: () => writeFileSync(log, ""),
  };
}

/**
 * The fake set up as `dir`'s lfs filter, in its own config — process, required — as `git lfs install --local` would.
 * @param {string} dir @param {ReturnType<typeof fakeLfs>} lfs
 */
export function useFakeLfs(dir, lfs) {
  execFileSync("git", ["config", "--local", "filter.lfs.process", lfs.process], { cwd: dir });
  execFileSync("git", ["config", "--local", "filter.lfs.required", "true"], { cwd: dir });
}

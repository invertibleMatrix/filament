// @ts-check
// The link guard (agent/link-guard.js, the owner's list of 11-08): on Windows a link made outside the chat's folder that
// leads into it, and a recursive delete of a folder holding a link that leads out of it, ask in every mode, Full access
// too, and no learned permission, allow rule or brief's grant lets one through unasked. Read from the command's syntax,
// never a message's words.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { linkOutOf, linkRisk, segmentsOf } from "../src/app/agent/link-guard.js";
import { gate, ruled } from "../src/app/agent/tools.js";

/** Links first, then folders: a link is never deleted through (the pitfall of 11-07). @type {string[]} */
const links = [];
/** @type {string[]} */
const dirs = [];
after(() => {
  for (const l of links)
    try {
      unlinkSync(l);
    } catch {}
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
/** A folder of its own under the system's temp folder. @param {string} name */
const temp = (name) => {
  const d = mkdtempSync(join(tmpdir(), `filament-links-${name}-`));
  dirs.push(d);
  return d;
};
/** A junction on Windows, a folder's symbolic link elsewhere. @param {string} to @param {string} at */
const link = (to, at) => {
  symlinkSync(to, at, "junction");
  links.push(at);
};
/** The guard as it reads on Windows, wherever the test runs. @param {string} name @param {string} command @param {string} [at] */
const risk = (name, command, at = root) => linkRisk(name, command, at, { platform: "win32" });
const WINDOWS = process.platform === "win32";

const root = temp("project");
mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
writeFileSync(join(root, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
const outside = temp("scratch");
const lc = (/** @type {string | undefined} */ s) => String(s).toLowerCase();

test("a command's segments and words, read as the rules read them: separators split, each shell's escapes, a continued line one line", () => {
  assert.deepEqual(segmentsOf(`rm -rf "a b" && ls | wc -l`, false), [["rm", "-rf", "a b"], ["ls"], ["wc", "-l"]]);
  assert.deepEqual(segmentsOf("& 'C:\\Program Files\\x.exe' -a; Remove-Item -Recurse C:\\t", true), [["&", "C:\\Program Files\\x.exe", "-a"], ["Remove-Item", "-Recurse", "C:\\t"]], "PowerShell keeps a path's backslashes, and its call operator is a word");
  assert.deepEqual(segmentsOf('rm -r "C:\\Users\\me\\x" C:\\y', false), [["rm", "-r", "C:\\Users\\me\\x", "C:y"]], "bash keeps them in double quotes, and reads them as escapes bare, as Git Bash runs it");
  // (fails before: yes — the review of 11-08: a continued line ended the segment, and bash's `rm -rf \` read the path `\`)
  assert.deepEqual(segmentsOf("rm -rf \\\n  build", false), [["rm", "-rf", "build"]]);
  assert.deepEqual(segmentsOf("Remove-Item -Recurse `\n  build", true), [["Remove-Item", "-Recurse", "build"]]);
});

test("a link made outside the folder that leads into it is read in each shell's spelling, its target read from where each tool reads it", () => {
  const nm = join(root, "node_modules");
  const at = join(outside, "nm");
  for (const [name, command] of [
    ["powershell", `cmd /c mklink /J "${at}" "${nm}"`],
    ["bash", `cmd //c "mklink /J ${at} ${nm}"`],
    ["powershell", `New-Item -ItemType Junction -Path "${at}" -Target "${nm}"`],
    ["powershell", `New-Item -Path "${outside}" -Name nm -ItemType SymbolicLink -Value "${nm}" -Force`],
    ["powershell", `$null = New-Item -ItemType Junction -Path "${at}" -Target "${nm}"`],
    ["bash", `ln -sfn "${nm}" "${at}"`],
    ["bash", `powershell -NoProfile -Command "New-Item -ItemType Junction -Path '${at}' -Target '${nm}'"`],
    // (fails before: yes — the review of 11-08: a junction's relative target was read from the link's folder; mklink /J
    // and New-Item read it from the folder they run in)
    ["powershell", `New-Item -ItemType Junction -Path "${relative(root, at)}" -Target node_modules`],
    ["powershell", `cmd /c mklink /J "${at}" node_modules`],
  ]) {
    const r = risk(name, command);
    assert.equal(r?.kind, "link", command);
    assert.deepEqual(r && r.kind === "link" ? [lc(r.link), lc(r.to)] : null, [lc(at), lc(nm)], command);
  }
  assert.equal(risk("powershell", `cmd /c mklink /J "${join(root, "lib")}" "${nm}"`), null, "inside the folder: deleting the folder takes both");
  assert.equal(risk("bash", `ln -s "${outside}" "${join(outside, "loop")}"`), null, "leading elsewhere");
  assert.equal(risk("bash", `ln -s "${join(nm, "pkg", "index.js")}" "${join(outside, "index.js")}"`), null, "a link to a file is never deleted through");
  // (not keyed on words: the same words as an argument to echo make nothing)
  assert.equal(risk("bash", `echo "mklink /J ${at} ${nm}"`), null);
  assert.equal(linkRisk("bash", `ln -sfn "${nm}" "${at}"`, root, { platform: "linux" }), null, "elsewhere no delete follows a folder's link");
});

test("a recursive delete of a folder holding a link that leads out of it is read in each shell's spelling, from where cd left it; once the link is gone, nothing is", () => {
  const scratch = join(outside, "copy");
  mkdirSync(join(scratch, "src"), { recursive: true });
  writeFileSync(join(scratch, "a.log"), "");
  link(join(root, "node_modules"), join(scratch, "node_modules"));
  for (const [name, command] of [
    ["powershell", `Remove-Item -Recurse -Force "${scratch}"`],
    ["powershell", `rm -r -fo ${scratch}`],
    ["powershell", `Remove-Item -LiteralPath "${scratch}" -Recurse:$true`],
    ["powershell", `cmd /c rmdir /s /q "${scratch}"`],
    ["powershell", `cmd /c "cd /d ${outside} && rd /s /q copy"`],
    ["bash", `rm -rf "${scratch.split("\\").join("/")}"`],
    ["bash", `cd "${outside}" && rm --recursive --force copy`],
    ["bash", `bash -c 'rm -rf "${scratch.split("\\").join("/")}"'`],
    ["bash", `git worktree remove --force "${scratch}"`],
    ["powershell", `Set-Location "${scratch}"; Remove-Item * -Recurse -Force`],
  ]) {
    const r = risk(name, command);
    assert.equal(r?.kind, "deletes", command);
    assert.equal(r && r.kind === "deletes" ? lc(r.link) : null, lc(join(scratch, "node_modules")), command);
  }
  assert.equal(risk("powershell", `Remove-Item "${scratch}"`), null, "no -Recurse: it refuses a full folder itself");
  assert.equal(risk("bash", `rm -f "${join(scratch, "a.txt")}"`), null);
  assert.equal(risk("bash", `echo rm -rf "${scratch}"`), null, "words to echo delete nothing");
  // (fails before: yes — the review of 11-08: a wildcard was read as the whole folder)
  assert.equal(risk("powershell", `Set-Location "${scratch}"; Remove-Item *.log -Recurse`), null, "a wildcard takes what it matches alone");
  // A link that leads inside the folder deleted takes nothing outside it.
  const inner = join(outside, "inner");
  mkdirSync(join(inner, "real"), { recursive: true });
  link(join(inner, "real"), join(inner, "alias"));
  assert.equal(linkOutOf(inner), null);
  assert.equal(linkRisk("powershell", `Remove-Item -Recurse -Force "${scratch}"`, root, { platform: "darwin" }), null, "elsewhere no delete follows a folder's link");
  unlinkSync(join(scratch, "node_modules"));
  // (another spelling: a reading is kept a moment, for the gate's several looks at one call)
  assert.equal(risk("powershell", `Remove-Item -Force -Recurse "${scratch}"`), null, "the link removed by itself first");
});

test("the gate asks in every mode, Full access too, naming the link, and neither a learned permission nor an allow rule runs it unasked", { skip: !WINDOWS && "the guard reads Windows' deletes" }, () => {
  const scratch = join(outside, "held");
  mkdirSync(scratch, { recursive: true });
  link(join(root, "node_modules"), join(scratch, "node_modules"));
  const input = { command: `Remove-Item -Recurse -Force "${scratch}"` };
  for (const mode of /** @type {const} */ (["auto", "edit", "ask"])) {
    const g = gate(mode, "powershell", input, () => true, undefined, () => ({ ok: false, why: "it deletes" }), root);
    assert.equal(g.verdict, "ask", mode);
    assert.ok(g.verdict === "ask" && g.links, mode);
    assert.match(g.verdict === "ask" ? g.question : "", /a link in there leads out of it \(.*node_modules to .*node_modules\): the delete may follow the link and empty what it leads to; remove the link by itself first \(cmd \/c rmdir on a junction\), so Filament asks in every mode\. Answer \/allow to run it/i, mode);
  }
  assert.equal(gate("read-only", "powershell", input, null, undefined, () => ({ ok: false, why: "it deletes" }), root).verdict, "refuse");
  const g = gate("auto", "powershell", input, null, undefined, null, root);
  const rule = /** @type {any} */ ({ verdict: "allow", rule: { tool: "powershell", pattern: "Remove-Item *" }, rules: [], subject: input.command });
  assert.equal(ruled(g, rule, "powershell", input, root).verdict, "ask", "an allow rule leaves it asking");
  // Without the link, Full access runs it unread, as before.
  unlinkSync(join(scratch, "node_modules"));
  assert.equal(gate("auto", "powershell", { command: `Remove-Item -Recurse -Force "${scratch}" ` }, null, undefined, null, root).verdict, "run");
});

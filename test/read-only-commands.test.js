// @ts-check
// HarnessV3-Launch LD-D11: in Edit mode a command that only reads runs without asking. `readOnlyCommand` decides,
// conservatively — what it cannot read is a no, and Edit mode asks for that as it always did — and the gate and the
// loop act on its answer.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs, { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, chmodSync, realpathSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, parse, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readOnlyCommand } from "../src/adapters/tools/read-only-commands.js";
import { SHELL } from "../src/adapters/tools/shell.js";
import { gate, toolSetFor } from "../src/app/agent/tools.js";
import { runAgentTurn } from "../src/app/agent/loop.js";

const WIN = process.platform === "win32";
/** The programs a fake Git (Windows) or the fake PATH folder (elsewhere) holds; rg, node and python sit in their own. */
const PROGRAMS = ["ls", "cat", "head", "tail", "wc", "du", "grep", "sed", "find", "git", "cut", "sort", "uniq", "tr"];
const exe = (/** @type {string} */ name) => (WIN ? `${name}.exe` : name);
/** A program file the lookup can find. @param {string} dir @param {string} name */
const tool = (dir, name) => {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, exe(name));
  writeFileSync(file, WIN ? "" : "#!/bin/sh\n");
  if (!WIN) chmodSync(file, 0o755);
  return file;
};

describe("readOnlyCommand (HarnessV3-Launch LD-D11)", () => {
  let base = "";
  let root = "";
  let bin = "";
  let jbin = "";
  let lbin = "";
  let fileLinks = true;
  /** @type {import("../src/adapters/tools/shell.js").Shell} */
  let SH = { kind: "bash", name: "bash", file: "/bin/bash" };
  /** @type {Record<string, string>} */
  let ENV = {};

  before(() => {
    // base/work is the working folder: two files, src/ and its two, a folder holding a link out (linked/out) and one
    // holding a link back inside (nest/alias → src), and tools/ with a planted rg. base/outside is outside; base/bin
    // holds rg on the PATH; base/jbin is a link to work/tools; base/lbin/rg is a link to the planted rg.
    base = mkdtempSync(join(tmpdir(), "filament-roc-"));
    root = join(base, "work");
    for (const d of ["src", "nest", "linked", "tools"]) mkdirSync(join(root, d), { recursive: true });
    writeFileSync(join(root, "a.txt"), "a\n");
    writeFileSync(join(root, "b.md"), "b\n");
    writeFileSync(join(root, "src", "x.js"), "x\n");
    writeFileSync(join(root, "src", "y.js"), "y\n");
    mkdirSync(join(base, "outside"));
    writeFileSync(join(base, "outside", "secret.txt"), "s\n");
    symlinkSync(join(base, "outside"), join(root, "linked", "out"), "junction");
    symlinkSync(join(root, "src"), join(root, "nest", "alias"), "junction");
    bin = join(base, "bin");
    for (const p of ["rg", "node", "python", "filament"]) tool(bin, p);
    const git = join(base, "git");
    for (const p of PROGRAMS) tool(WIN ? join(git, "usr", "bin") : bin, p);
    const planted = tool(join(root, "tools"), "rg");
    jbin = join(base, "jbin");
    symlinkSync(join(root, "tools"), jbin, "junction");
    lbin = join(base, "lbin");
    mkdirSync(lbin);
    try {
      symlinkSync(planted, join(lbin, exe("rg")), "file");
    } catch {
      fileLinks = false; // Windows without developer mode makes no file links
    }
    SH = WIN ? { kind: "git-bash", name: "Git Bash", file: join(git, "bin", "bash.exe") } : { kind: "bash", name: "bash", file: "/bin/bash" };
    ENV = { PATH: bin };
  });
  after(() => rmSync(base, { recursive: true, force: true }));

  /** @param {string} command @param {Partial<Parameters<typeof readOnlyCommand>[1]>} [o] */
  const check = (command, o = {}) => readOnlyCommand(command, { root, shell: SH, env: ENV, ...o });
  /** @param {string} command @param {Partial<Parameters<typeof readOnlyCommand>[1]>} [o] */
  const yes = (command, o) => assert.deepEqual(check(command, o), { ok: true }, JSON.stringify(command));
  /** @param {string} command @param {RegExp} why @param {Partial<Parameters<typeof readOnlyCommand>[1]>} [o] */
  const no = (command, why, o) => {
    const v = check(command, o);
    assert.equal(v.ok, false, `${JSON.stringify(command)} should ask`);
    assert.match(/** @type {{ why: string }} */ (v).why, why, JSON.stringify(command));
  };
  /** The working folder's path as Git Bash writes it: /c/… */
  const msys = (/** @type {string} */ p) => `/${p[0].toLowerCase()}${p.slice(2).replaceAll("\\", "/")}`;

  // (fails before: yes — there was no reader: every command asked)
  test("commands that only read, inside the working folder: yes", () => {
    for (const c of [
      "ls",
      "ls -la src",
      "ls -1 -- src",
      "cat a.txt",
      "cat -n a.txt b.md",
      "head -n 20 a.txt",
      "head -20 a.txt",
      "tail -n +5 a.txt",
      "tail --lines=3 a.txt",
      "wc -l a.txt b.md",
      "grep -rn 'foo bar' src",
      "grep -e foo -e bar a.txt",
      "grep --regexp=foo a.txt",
      "grep foo",
      "rg -n foo src --glob '*.js'",
      "rg --files src",
      "rg -e foo -- src",
      "find . -name '*.js' -type f",
      "find src -maxdepth 1 ! -name x.js -print",
      "find . -newer a.txt",
      "pwd",
      "pwd -P",
      "echo hello world",
      "echo -n hi",
      "ls src | head -5",
      "cat a.txt && wc -c a.txt",
      "ls || pwd",
      "ls; pwd",
      "ls\npwd\n",
      "ls;",
      "cd src && ls",
      "cd src && cat ../a.txt",
      "cd src && ls | wc -l && pwd",
      "ls 2>/dev/null",
      "ls >/dev/null 2>&1",
      "grep x a.txt >&2",
      "ls 1>/dev/null",
      "ls >> /dev/null",
      "ls src/*.js",
      "wc -l -- *.md",
      "cat src/?.js",
      "echo *",
      "echo src/*",
      "grep 'a;b|c' a.txt",
      'grep "x|y" a.txt',
      'grep "say \\"hi\\"" a.txt',
      "grep a\\ b a.txt",
      "cat -",
      "grep -c x -",
      "ls a.txt~",
      "cat 'notes'~old",
    ])
      yes(c);
    if (WIN) yes(`cat '${msys(join(root, "a.txt"))}'`);
  });

  test("anything outside the syntax it reads: no, with the reason", () => {
    for (const [c, why] of /** @type {[string, RegExp][]} */ ([
      ["rm a.txt", /^`rm` is not one of the programs known to only read$/],
      ["git push", /^git push is not one of git's reading forms: status, log, diff, show, rev-parse, branch --list$/],
      ["awk 1 a.txt", /^`awk` is not one/],
      ["l? a.txt", /^`l\?` is not one/],
      ["ls $HOME", /a `\$`/],
      ["ls `pwd`", /a backtick/],
      ["(ls)", /a parenthesis/],
      ["{ ls; }", /a brace/],
      ["cat < a.txt", /a `<`/],
      ["ls ~", /a `~`/],
      // (fails before: no — HarnessV3-FailurePoints S5-7 let a tilde inside a word read: where bash still expands one)
      ["ls ~/x", /a `~`/],
      ["ls x=~/y", /a `~`/],
      ["ls x:~/y", /a `~`/],
      ["ls ''~", /a `~`/],
      ["ls & pwd", /a lone `&`/],
      ["ls &> /dev/null", /`&>`/],
      ["ls |& cat", /`\|&`/],
      ["FOO=1 ls", /a variable set before the program/],
      ["ls # list", /a comment/],
      ['echo "$HOME"', /inside double quotes/],
      ['echo "`pwd`"', /inside double quotes/],
      ["ls 'a.txt", /an unclosed quote/],
      ['ls "a.txt', /an unclosed quote/],
      ["ls \\\nsrc", /a line continuation/],
      ['ls "a\\\nb"', /a line continuation/],
      ["ls \\", /a line continuation/],
      ["ls\r\n", /a carriage return/],
      ["ls > out.txt", /only \/dev\/null/],
      ["ls >> out.txt", /only \/dev\/null/],
      ["ls >/dev/nullx", /only \/dev\/null/],
      ["ls 3>/dev/null", /descriptor 3/],
      ["ls 2>&3", /other than `2>&1` and `>&2`/],
      ["ls >&1", /other than `2>&1` and `>&2`/],
      ["ls 2>&1x", /other than `2>&1` and `>&2`/],
      ["ls >| /dev/null", /`>\|` writes a file/],
      ["", /^no command$/],
      ["ls;;", /^an empty command$/],
      ["ls &&", /^an empty command$/],
      ["; ls", /^an empty command$/],
    ]))
      no(c, why);
  });

  // (fails before: yes — every `$` asked, so a worker that printed its granted check's exit code waited for the
  // developer's answer: the drive of HarnessV3-TaskGraph-v2 §13 Phase 1 saw `node acceptance.mjs format; echo "exit: $?"`)
  test("`$?`, the last command's exit status, reads as the digits it expands to; every other `$` still asks", () => {
    for (const c of ['echo "exit: $?"', "echo $?", 'ls; echo "EXIT=$?"', 'echo "code $?."', "echo $?x"]) yes(c);
    for (const [c, why] of /** @type {[string, RegExp][]} */ ([
      ["echo $HOME", /a `\$`/],
      ["echo $$", /a `\$`/],
      ['echo "$1"', /inside double quotes/],
      ['echo "${?}"', /inside double quotes/],
      ['echo "$?$HOME"', /inside double quotes/],
      ["echo ${?}", /a `\$`/],
      ["echo $(pwd)", /a `\$`/],
      ["cat $?/../../x", /`\.\.` after a name in 0\/\.\.\/\.\.\/x/],
    ]))
      no(c, why);
  });

  // (fails before: yes — x20: two hunts of 11-23 had `cut`, `sort | uniq -c` and `grep --include=*.js` refused, and
  // looked by reading alone)
  test("cut, sort, uniq and tr as filters, and a glob after a long option's `=`: yes; their forms that write or run: no", () => {
    for (const c of [
      "cut -d: -f1 a.txt",
      "cut -c1-10 a.txt b.md",
      "cut --fields=2 --delimiter=, -- a.txt",
      "grep -o foo a.txt | cut -d' ' -f2 | sort | uniq -c",
      "sort -k2,2n -t, a.txt",
      "sort -u --reverse a.txt b.md",
      "uniq -c a.txt",
      "uniq -f 2 -c a.txt",
      "uniq -cf2 a.txt",
      "uniq --skip-fields 2 a.txt",
      "uniq --group -c a.txt",
      "uniq --all-repeated=separate",
      "ls | tr a-z A-Z",
      "cat a.txt | tr -d '\\r'",
      "tr '[:upper:]' '[:lower:]'",
      "grep -rn --include=*.js foo src",
      "grep -rn --exclude-dir=node_* --include=*.md foo .",
      "rg --glob=*.js foo src",
      "ls --ignore=*.md",
    ])
      yes(c);
    for (const [c, why] of /** @type {[string, RegExp][]} */ ([
      ["sort -o out.txt a.txt", /sort -o is not an option known to only read/],
      ["sort --output=out.txt a.txt", /sort --output is not an option known to only read/],
      ["sort -T . a.txt", /sort -T is not an option known to only read/],
      ["sort --compress-program=gzip a.txt", /sort --compress-program is not an option known to only read/],
      ["sort --files0-from=list a.txt", /sort --files0-from is not an option known to only read/],
      ["uniq a.txt out.txt", /^uniq out\.txt: uniq's second operand is a file it writes$/],
      // BSD's uniq (macOS) takes an option after its input for its second operand, a file it writes.
      ["uniq a.txt -c", /^uniq -c: an option after its input — put it before$/],
      ["uniq -f 2 a.txt --count", /^uniq --count: an option after its input — put it before$/],
      ["uniq -- a.txt -c", /^uniq -c: an option after its input — put it before$/],
      ["cut -f1 ../outside/secret.txt", /is outside the working folder/],
      ["tr x* y", /^tr x\*: a set with an unquoted glob — quote it$/],
      ["tr", /^tr takes one set or two$/],
      ["tr a b c", /^tr takes one set or two$/],
      // Not after its `=`, nor in the option that gives the pattern: a name the agent made could become another script.
      ["sed -n --expression=1p* a.txt", /an option with an unquoted glob — quote it/],
      ["grep --regexp=a* a.txt", /an option with an unquoted glob — quote it/],
      ["grep --inc*=x foo a.txt", /an option with an unquoted glob — quote it/],
      ["grep --include *.js foo src", /a value with an unquoted glob — quote it/],
      ["ls -I*.md", /an option with an unquoted glob — quote it/],
    ]))
      no(c, why);
  });

  // (fails before: no — L4's round two: the table looked up with `in`, or by a truthy index, finds every object's own
  // methods on its prototype and runs them as programs)
  test("a word named like one of every object's own methods is not a program", () => {
    for (const p of ["constructor", "toString", "__proto__", "hasOwnProperty"])
      no(`${p} a.txt`, new RegExp("^`" + p + "` is not one of the programs known to only read$"));
  });

  test("an option that follows links, runs or writes something, reads names from a file, or never ends: no", () => {
    for (const [c, why] of /** @type {[string, RegExp][]} */ ([
      ["grep -R x .", /^grep -R is not an option known to only read$/],
      ["grep -f pats.txt a.txt", /grep -f/],
      ["grep --file=pats.txt a.txt", /grep --file/],
      ["grep -d skip x a.txt", /grep -d/],
      ["rg --pre=./x foo", /rg --pre/],
      ["rg -z foo", /rg -z/],
      ["rg -L foo", /rg -L/],
      ["rg --ignore-file=x foo", /rg --ignore-file/],
      ["find . -delete", /^find -delete is not a word known to only read$/],
      ["find . -exec cat '{}' +", /find -exec/],
      ["find . -fprint out.txt", /find -fprint/],
      ["find -L .", /find -L/],
      ["tail -f a.txt", /tail -f/],
      ["tail --follow a.txt", /tail --follow/],
      ["wc --files0-from=list a.txt", /wc --files0-from/],
      ["ls -L src", /ls -L/],
      ["ls --rec src", /ls --rec/],
      ["head -n", /head -n needs a value/],
      ["grep -e", /grep -e needs a value/],
      ["grep --regexp", /grep --regexp needs a value/],
      ["find . -name", /find -name needs a value/],
      ["pwd src", /pwd takes -L or -P only/],
      ["rg -g *.js foo", /a value with an unquoted glob/],
      ["rg --glob *.js foo", /a value with an unquoted glob/],
      ["ls -* src", /an option with an unquoted glob/],
      ["grep x* a.txt", /pattern has an unquoted glob/],
      ["find . -name *.js", /quote find's patterns/],
      ["find . -name x -o *.js", /quote find's patterns/],
    ]))
      no(c, why);
  });

  // (fails before: yes — the owner's agent_loop_test of 11-02: `sed -n '1,80p' file`, the agent's way to read part of a
  // file, asked every time)
  test("sed picking lines to print: yes; a script that writes, reads another file or runs something, -i or -f: no", () => {
    for (const c of [
      "sed -n '1,80p' a.txt",
      "sed -n 5p a.txt",
      "sed -n '$p' a.txt",
      "sed -n '/^x/,/y$/p' src/x.js",
      "sed -n '/a\\/b/Ip' a.txt",
      "sed -n -e '1p' -e '$=' a.txt b.md",
      "sed -n --expression='2,+3p' a.txt",
      "sed -nE '0~4p;10q' a.txt",
      "sed '/^#/d' a.txt",
      "sed -n '3!p' a.txt",
      "sed -n '1,5 p ; 9 q' a.txt",
      "cd src && sed -n 1p x.js",
      "ls src | sed -n 1p",
    ])
      yes(c);
    for (const [c, why] of /** @type {[string, RegExp][]} */ ([
      ["sed -i 's/a/b/' a.txt", /^sed -i is not an option known to only read$/],
      ["sed -ni 1p a.txt", /^sed -i is not an option known to only read$/],
      ["sed --in-place 1p a.txt", /^sed --in-place is not/],
      ["sed -f script.sed a.txt", /^sed -f is not/],
      ["sed -n '1w out.txt' a.txt", /^sed's script `1w out\.txt` does more than pick lines to print/],
      ["sed -n '1,5W out.txt' a.txt", /does more than pick lines to print/],
      ["sed '1r ../outside/secret.txt' a.txt", /does more than pick lines to print/],
      ["sed '1e ls' a.txt", /does more than pick lines to print/],
      ["sed 's/a/b/' a.txt", /does more than pick lines to print/],
      ["sed -n '1{p}' a.txt", /does more than pick lines to print/],
      ["sed -n 'pw out' a.txt", /does more than pick lines to print/],
      ["sed -n '/x' a.txt", /does more than pick lines to print/],
      ["sed -n '' a.txt", /does more than pick lines to print/],
      ["sed -n -e 1p -e '1w x' a.txt", /^sed's script `1w x`/],
      ["sed -n 1p ../outside/secret.txt", /is outside the working folder/],
      ["sed -n", /^sed with no script$/],
    ]))
      no(c, why);
  });

  // (fails before: no — L4's mutation pass: nothing held `-NUM` to the programs that take a count)
  test("`-NUM` is a count only where the program takes one: elsewhere it is an option nobody vouched for", () => {
    for (const c of ["head -5 a.txt", "tail -20 a.txt", "grep -2 x a.txt"]) yes(c);
    for (const [c, why] of /** @type {[string, RegExp][]} */ ([
      ["wc -5 a.txt", /^wc -5 is not an option known to only read$/],
      ["cat -5 a.txt", /^cat -5 is not an option known to only read$/],
      ["ls -5 src", /^ls -5 is not an option known to only read$/],
    ]))
      no(c, why);
  });

  test("a path outside the working folder, through a link, or `..` after a name: no", () => {
    for (const [c, why] of /** @type {[string, RegExp][]} */ ([
      ["cat ../outside/secret.txt", /^\.\.\/outside\/secret\.txt is outside the working folder$/],
      ["cat /etc/passwd", /is outside the working folder/],
      ["cat src/../../outside/secret.txt", /`\.\.` after a name/],
      ["cat src/../a.txt", /`\.\.` after a name/],
      ["cat linked/out/secret.txt", /reaches outside the working folder through a link/],
      ["ls linked/out", /through a link/],
      ["find . -newer ../outside/secret.txt", /is outside the working folder/],
      ["find ../outside", /is outside the working folder/],
      ["grep x ../outside/secret.txt", /is outside the working folder/],
      // (fails before: no — L4's mutation pass: with the pattern given by -e, the first operand is a path like the rest)
      ["grep -e root ../outside/secret.txt", /is outside the working folder/],
      ["rg --regexp=root ../outside/secret.txt", /is outside the working folder/],
    ]))
      no(c, why);
    if (WIN) {
      no("cat //server/share/x", /is outside the working folder/);
      no("cat /usr/bin/ls", /is outside the working folder/);
      no("cat C:x", /names a drive's current folder/);
      no("rg foo CON", /names a Windows device/);
      no("cat src/nul.txt", /names a Windows device/);
      no("cat 'src\\..\\..\\outside\\secret.txt'", /`\.\.` after a name/);
    }
  });

  // (fails before: yes — HarnessV4_Overnight_Plan OC-56, OC-57: a folder added to the working folder was outside it,
  // and a command that read there asked)
  test("a folder added to the working folder (loop.addedFolders) reads as the working folder does; a link there that leads elsewhere, and any other folder, do not", () => {
    const added = join(base, "added");
    mkdirSync(added);
    writeFileSync(join(added, "note.txt"), "n\n");
    symlinkSync(join(base, "outside"), join(added, "away"), "junction");
    const r = { reads: [added] };
    no("cat ../added/note.txt", /^\.\.\/added\/note\.txt is outside the working folder$/);
    for (const c of ["cat ../added/note.txt", "head -n 1 ../added/note.txt", "ls ../added", "wc -l ../added/note.txt", "grep n ../added/note.txt", "cd ../added && cat note.txt"]) yes(c, r);
    no("cat ../added/away/secret.txt", /reaches outside the working folder through a link/, r);
    no("cd ../added/away && cat secret.txt", /through a link|outside/, r);
    no("cat ../outside/secret.txt", /^\.\.\/outside\/secret\.txt is outside the working folder and the folders added to it$/, r);
    if (WIN) yes(`cat '${msys(join(added, "note.txt"))}'`, r);
    yes("cat ../added/note.txt", { reads: [join(base, "missing"), added] }); // a folder that is gone is passed over
  });

  test("a glob only in a path's last part, not able to match `..`, from a folder with no link, never at a word's start before `--`", () => {
    for (const [c, why] of /** @type {[string, RegExp][]} */ ([
      ["cat s*/x.js", /a glob before the last part/],
      ["cat src/.*", /starts with `\.` or `\[`/],
      ["cat src/[xy].js", /starts with `\.` or `\[`/],
      ["ls src/**", /`\*\*`/],
      ["echo linked/*", /holds a link/],
      ["ls nosuch/*", /cannot be read/],
      ["echo ../*", /is outside the working folder/],
      ["cat *.md", /a glob that starts a word can expand into an option/],
      ["rg foo *", /can expand into an option/],
      ["grep -n foo *.md", /can expand into an option/],
      ["find * -name x", /can expand into an expression/],
    ]))
      no(c, why);
  });

  test("`cd <folder>` first, before the commands it runs in, inside, no link on the way", () => {
    for (const [c, why] of /** @type {[string, RegExp][]} */ ([
      ["cd src", /`cd` only first/],
      ["ls && cd src && ls", /`cd` only first/],
      ["cd .. && ls", /is outside the working folder/],
      ["cd linked/out && ls", /through a link/],
      ["cd nest/alias && cat ../a.txt", /a link on the way/],
      ["cd - && ls", /takes one folder/],
      ["cd src nest && ls", /takes one folder/],
      ["cd s* && ls", /takes one folder/],
      ["cd nosuch && ls", /no such folder/],
    ]))
      no(c, why);
    no("cd src && ls", /a CDPATH is set/, { env: { ...ENV, CDPATH: "/elsewhere" } });
    yes("cd src && ls", { env: { ...ENV, CDPATHS: "/elsewhere" } });
  });

  // The re-read of 11-11: Antigravity names the folder its command runs in (`Cwd`), and off Windows its command was read
  // as run in the working folder, so `cat secret.txt` run in another passed as a read of the working folder's.
  // (fails before: yes — the folder was not read: `cat secret.txt` run outside passed, `cat x.js` run in src did not)
  test("a command run in the folder its call names: read from there, which must be inside, there, and reached through no link", () => {
    yes("cat x.js", { cwd: join(root, "src") });
    yes("cat x.js && cat ../a.txt", { cwd: "src" });
    no("cat ../../a.txt", /^\.\.\/\.\.\/a\.txt is outside the working folder$/, { cwd: "src" });
    for (const [cwd, why] of /** @type {[string, RegExp][]} */ ([
      [join(base, "outside"), /^it runs in .*outside, and .*outside is outside the working folder$/],
      ["..", /^it runs in \.\., and \.\. is outside the working folder$/],
      ["linked/out", /^it runs in linked\/out, and linked\/out reaches outside the working folder through a link$/],
      ["nest/alias", /^it runs in nest\/alias, reached through a link$/],
      ["nosuch", /^it runs in nosuch, which is not there$/],
    ]))
      no("cat secret.txt", why, { cwd });
    yes("cat a.txt", { cwd: null });
  });

  // HarnessV3-AtHome AH-F2: the owner's spin put a `;` after a `cd` (`cd <clone> && grep … | head -5; echo "==="; grep …`),
  // which the reader refused whole. Were the cd to fail, what follows a `;`, a `||` or a line break runs in the working
  // folder: every later path is read from both folders. After `&&` alone, nothing runs if the cd fails.
  // (fails before: yes — after a `cd`, only `&&` and `|` were read)
  test("after a `cd`, a `;`, `||` or line break: every later path is read from the cd's folder and from the working folder", () => {
    for (const c of [
      "cd src; ls",
      "cd src\nls",
      "cd src || pwd",
      "cd src && ls || pwd",
      "cd src && ls; cat x.js",
      `cd src && grep -rn 'x' . | head -5; echo "==="; grep -n y y.js | head -25`,
    ])
      yes(c);
    for (const c of ["cd src; cat ../a.txt", "cd src && ls || cat ../a.txt", "cd src && ls; cat ../a.txt", "cd src\nhead ../a.txt"])
      no(c, /^if `cd src` fails, the rest runs in the working folder, and there \.\.\/a\.txt is outside the working folder$/);
    yes("cd src && cat ../a.txt");
    no("cd src | cat ../a.txt", /a `cd` piped into a command does not move it/);
  });

  test("only a real bash, and a working folder that exists", () => {
    no("ls", /^cmd\.exe is not a bash/, { shell: { kind: "cmd", name: "cmd.exe", file: "cmd.exe" } });
    for (const kind of /** @type {const} */ (["git-bash", "bash", "sh"])) yes("echo hi", { shell: { kind, name: kind, file: SH.file } });
    no("ls", /the working folder does not exist/, { root: join(base, "nowhere") });
  });

  test("the program is found before any folder the agent could write to (Git Bash)", { skip: !WIN }, () => {
    const tools = join(root, "tools");
    yes("rg foo", { env: { PATH: bin } });
    no("rg foo", /^the PATH searches .*tools \(inside the working folder\) before it finds rg$/, { env: { PATH: `${tools};${bin}` } });
    no("rg foo", /tools \(inside the working folder\)/, { env: { Path: `${tools};${bin}` } });
    yes("rg foo", { env: { PATH: `${bin};${tools}` } });
    no("rg foo", /jbin \(inside the working folder\)/, { env: { PATH: `${jbin};${bin}` } });
    no("rg foo", /deeper \(inside the working folder\)/, { env: { PATH: `${join(jbin, "deeper")};${bin}` } });
    no("rg foo", /tools\\bin \(relative to the folder a command runs in\)/, { env: { PATH: `tools\\bin;${bin}` } });
    no("rg foo", /\(a network folder, not touched here\)/, { env: { PATH: `\\\\server\\share;${bin}` } });
    yes("rg foo", { env: { PATH: `;;"${bin}";` } });
    yes("rg foo", { env: { PATH: join(base, "empty") } });
    // Git's own folders come first, then $HOME\bin, then the Windows PATH.
    yes("ls src", { env: { PATH: `${tools};${bin}` } });
    no("ls", /mingw64\\bin \(inside the working folder\) before it finds ls/, { shell: { ...SH, file: join(root, "git", "bin", "bash.exe") } });
    no("rg foo", /work\\bin \(inside the working folder\) before it finds rg/, { env: { HOME: root, PATH: bin } });
    no("rg foo", /work\\bin \(inside the working folder\)/, { env: { HOME: msys(root), PATH: bin } });
    no("rg foo", /work\\bin \(inside the working folder\)/, { env: { USERPROFILE: root, PATH: bin } });
    no("rg foo", /work\\bin \(inside the working folder\)/, { env: { HOMEDRIVE: root.slice(0, 2), HOMEPATH: root.slice(2), PATH: bin } });
    yes("rg foo", { env: { HOME: base, PATH: bin } });
    if (fileLinks) no("rg foo", /^rg is .*lbin\\rg\.exe, which leads into the working folder$/, { env: { PATH: `${lbin};${bin}` } });
    // (fails before: no — L4's mutation pass: a folder of the program's name is passed over, as the shell passes it)
    const decoy = join(base, "decoy");
    mkdirSync(join(decoy, exe("rg")), { recursive: true });
    no("rg foo", /tools \(inside the working folder\) before it finds rg/, { env: { PATH: `${decoy};${tools};${bin}` } });
    // Bash's own echo and pwd look nothing up.
    yes("echo hi && pwd", { env: { PATH: tools } });
    // A bash without a PATH searches its own, which ends with the folder a command runs in.
    no("ls", /the PATH searches \. \(relative to the folder a command runs in\) before it finds ls/, { shell: { kind: "bash", name: "bash", file: "/bin/bash" }, env: {} });
  });

  test("the program is found before any folder the agent could write to (bash)", { skip: WIN }, () => {
    const tools = join(root, "tools");
    yes("rg foo", { env: { PATH: bin } });
    no("rg foo", /tools \(inside the working folder\) before it finds rg/, { env: { PATH: `${tools}:${bin}` } });
    yes("rg foo", { env: { PATH: `${bin}:${tools}` } });
    no("rg foo", /an empty entry \(the folder a command runs in\)/, { env: { PATH: `:${bin}` } });
    no("rg foo", /tools\/bin \(relative to the folder a command runs in\)/, { env: { PATH: `tools/bin:${bin}` } });
    if (fileLinks) no("rg foo", /lbin\/rg, which leads into the working folder/, { env: { PATH: `${lbin}:${bin}` } });
    // A file of the name that is not executable is passed over, as bash passes it.
    const idle = join(base, "idle");
    mkdirSync(idle, { recursive: true });
    writeFileSync(join(idle, "rg"), "");
    chmodSync(join(idle, "rg"), 0o644);
    no("rg foo", /tools \(inside the working folder\)/, { env: { PATH: `${idle}:${tools}:${bin}` } });
    // (fails before: no — L4's mutation pass: a folder of the program's name is passed over too)
    const decoy = join(base, "decoy");
    mkdirSync(join(decoy, "rg"), { recursive: true });
    no("rg foo", /tools \(inside the working folder\)/, { env: { PATH: `${decoy}:${tools}:${bin}` } });
  });

  // (fails before: no — L4's mutation pass: nothing held what a folder whose real path cannot be read counts as)
  test("a PATH folder whose real path cannot be read counts as one the agent could write to", () => {
    const odd = join(base, "odd");
    mkdirSync(odd, { recursive: true });
    const path = { PATH: [odd, bin].join(WIN ? ";" : ":") };
    yes("rg foo", { env: path });
    const fsMod = /** @type {any} */ (fs);
    const real = fsMod.realpathSync;
    fsMod.realpathSync = Object.assign(
      (/** @type {any} */ p, /** @type {any} */ o) => {
        if (String(p).toLowerCase() === odd.toLowerCase()) throw Object.assign(new Error(`EACCES: permission denied, realpath '${p}'`), { code: "EACCES" });
        return real(p, o);
      },
      { native: real.native },
    );
    syncBuiltinESMExports();
    try {
      no("rg foo", /^the PATH searches .*odd \(/, { env: path });
    } finally {
      fsMod.realpathSync = real;
      syncBuiltinESMExports();
    }
  });

  // (fails before: no — L4's mutation pass: on a working folder at a drive's root, Git Bash's /… read as that drive's)
  test("Git Bash reads /… as its own tree, never as the working folder's drive — even with the working folder at its root", () => {
    const top = parse(base).root;
    const below = join(base, "below");
    mkdirSync(below, { recursive: true });
    writeFileSync(join(below, "f.txt"), "f\n");
    const posix = `/${relative(top, below).replaceAll("\\", "/")}`;
    no(`echo ${posix}/*`, /is outside the working folder/, { root: top, shell: { kind: "git-bash", name: "Git Bash", file: SH.file } });
  });

  // (fails before: yes — HarnessV3-FailurePoints §8 item 4: a read-only scout's `node -v` was refused)
  test("a toolchain asked its version: one of the table, with one of its own version flags and nothing else", () => {
    for (const c of ["node -v", "node --version", "python --version", "python -V", "git --version", "node -v && python --version", "cd src && node -v"]) yes(c);
    for (const [c, why] of /** @type {[string, RegExp][]} */ ([
      ["node", /^of node, only `node -v` and `node --version` are known to only read$/],
      ["node -v a.js", /^of node, only/],
      ["node --eval 1", /^of node, only/],
      ["npm test", /^of npm, only `npm -v` and `npm --version` are known to only read$/],
      ["make all", /^of make, only `make --version` is known to only read$/],
      // To python, -v is verbose.
      ["python -v", /^of python, only `python -V` and `python --version` are known to only read$/],
      // Not any program: a window of its own, or a launcher that acts on a file in the folder.
      ["notepad --version", /^`notepad` is not one of the programs known to only read$/],
      ["cargo --version", /^`cargo` is not one/],
      ["yarn -v", /^`yarn` is not one/],
    ]))
      no(c, why);
  });

  // (fails before: yes — Filament's command line was no program known to only read: an agent's `filament status` asked)
  test("Filament's own command line: the forms that only ask the Filament that runs — never one that changes it, prints its key or names another folder", () => {
    for (const c of ["filament status", "filament status --json", "filament models", "filament chats --json", "filament agents", "filament agents list", "filament keys", "filament keys list --json", "filament memory", "filament settings get agentLoop.permissions", "filament help", "filament help keys", "filament keys --help", "filament --version", "filament -v"]) yes(c);
    for (const [c, why] of /** @type {[string, RegExp][]} */ ([
      ["filament", /^filament with no command starts Filament$/],
      ["filament --json", /^filament with no command starts Filament$/],
      ["filament start", /^filament start is not one of its forms that only read/],
      ["filament keys add anthropic --key-stdin", /^filament --key-stdin: of its flags, only --json and --help are read here$/],
      ["filament keys add anthropic", /^filament keys add anthropic is not one of its forms/],
      ["filament agents sign-in codex", /^filament agents sign-in codex is not one/],
      ["filament chat hello", /^filament chat hello is not one/],
      ["filament settings set agentLoop.permissions auto", /^filament settings set/],
      ["filament stop", /^filament stop is not one/],
      ["filament doctor", /^filament doctor is not one/],
      ["filament print-key", /^filament print-key is not one/],
      ["filament where", /^filament where is not one/],
      ["filament status --data-dir x", /^filament --data-dir: of its flags, only --json and --help/],
      ["filament status --json=1", /^filament --json=1: of its flags/],
      ["filament keys *", /^filament \*: an unquoted glob/],
    ]))
      no(c, why);
    no("filament status", /^filament is not found on the PATH$/, { env: { PATH: join(base, "outside") } });
  });

  // (fails before: yes — the review of 9fc83b83a: the Environment names the command line by its path, and only the
  // bare name was read, so every status asked)
  test("Filament's command line as the Environment names it: this Node on Filament's own script, outside the working folder — not one the agent could rewrite", () => {
    const script = fileURLToPath(new URL("../bin/filament.js", import.meta.url)).replaceAll("\\", "/");
    const node = process.execPath.replaceAll("\\", "/");
    yes(`node ${script} status`);
    yes(`"${node}" ${script} keys --json`);
    no(`node ${script} chat hello`, /^filament chat hello is not one of its forms that only read/);
    no(`node ${script} status --data-dir x`, /^filament --data-dir: of its flags/);
    no("node other.js status", /^of node, only/);
    // Filament's own checkout as the working folder: its script is the agent's to change.
    const repo = fileURLToPath(new URL("..", import.meta.url));
    no(`node ${script} status`, /^of node, only/, { root: repo });
  });

  // (fails before: yes — the same: and a program not found at all ran, bash saying so — a version query must be found)
  test("a toolchain is found on the PATH, a file Filament can read, before any folder the agent could write to — never a Windows app alias", () => {
    const SEP = WIN ? ";" : ":";
    const tools = join(root, "tools");
    no("npm -v", /^npm is not found on the PATH$/);
    no("node -v", /tools \(inside the working folder\) before it finds node$/, { env: { PATH: [tools, bin].join(SEP) } });
    // A PATH entry that is a file holds no program: the search goes on.
    writeFileSync(join(base, "afile"), "");
    yes("node -v", { env: { PATH: [join(base, "afile"), bin].join(SEP) } });
    // A Windows app alias stands on the PATH as a name Filament can't read: the shell may run it, and it may open the
    // Store. Before any program Filament can read, a toolchain asks; any other program's search goes on, as it did.
    const alias = join(base, "alias");
    mkdirSync(alias, { recursive: true });
    const unread = new Set(["python", "rg"].flatMap((p) => [join(alias, p), join(alias, `${p}.exe`)].map((f) => f.toLowerCase())));
    // So is a program file whose real path Filament can't follow.
    const opaque = join(base, "opaque");
    const unfollowed = new Set(["node", "rg"].map((p) => tool(opaque, p).toLowerCase()));
    const fsMod = /** @type {any} */ (fs);
    const real = fsMod.statSync;
    const realPath = fsMod.realpathSync;
    fsMod.statSync = (/** @type {any} */ p, /** @type {any} */ o) => {
      if (unread.has(String(p).toLowerCase())) throw Object.assign(new Error(`EACCES: permission denied, stat '${p}'`), { code: "EACCES" });
      return real(p, o);
    };
    fsMod.realpathSync = Object.assign((/** @type {any} */ p, /** @type {any} */ o) => {
      if (unfollowed.has(String(p).toLowerCase())) throw Object.assign(new Error(`EACCES: permission denied, realpath '${p}'`), { code: "EACCES" });
      return realPath(p, o);
    }, { native: realPath.native });
    syncBuiltinESMExports();
    try {
      no("python --version", /alias[\\/]python(\.exe)? stands on the PATH before any python Filament can read$/, { env: { PATH: [alias, bin].join(SEP) } });
      yes("python --version", { env: { PATH: [bin, alias].join(SEP) } });
      yes("rg foo", { env: { PATH: [alias, bin].join(SEP) } });
      no("node -v", /opaque[\\/]node(\.exe)? stands on the PATH before any node Filament can read$/, { env: { PATH: [opaque, bin].join(SEP) } });
      yes("rg foo", { env: { PATH: [opaque, bin].join(SEP) } });
    } finally {
      fsMod.statSync = real;
      fsMod.realpathSync = realPath;
      syncBuiltinESMExports();
    }
  });

  describe("git's reading forms (HarnessV3-FailurePoints §8 item 4)", () => {
    let repo = "";
    /** @type {{ root: string }} */
    let at = { root: "" };
    before(() => {
      // base/repo is a working folder that holds its own .git; its src/ holds x.js.
      repo = join(base, "repo");
      mkdirSync(join(repo, ".git"), { recursive: true });
      writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
      mkdirSync(join(repo, "src"));
      writeFileSync(join(repo, "src", "x.js"), "x\n");
      at = { root: repo };
    });

    // (fails before: yes — git asked in every form, and read-only mode refused it)
    test("status, log, diff, show, rev-parse and branch --list, with options known to only read and every operand a path inside: yes", () => {
      for (const c of [
        "git status",
        "git status --short",
        "git status -sb",
        "git status --porcelain=v2 -z",
        "git log --oneline -10",
        "git log -n 5 --stat -- src",
        "git log --format='%h %s' --since='2 weeks ago'",
        "git log HEAD~3..HEAD",
        "git log -p -S'parse(' -- src/x.js",
        "git diff",
        "git diff --cached --stat",
        "git diff HEAD~1 HEAD -- src/x.js",
        "git diff --name-only main...HEAD",
        "git show HEAD",
        "git show --stat HEAD~2",
        "git show HEAD:src/x.js",
        "git rev-parse HEAD",
        "git rev-parse --abbrev-ref HEAD",
        "git rev-parse --show-toplevel",
        "git branch --list",
        "git branch -a --list 'feat*'",
        "git branch -al",
        "git --no-pager log --oneline -3",
        "git status && git diff --stat",
        "git log --oneline | head -5",
      ])
        yes(c, at);
    });

    test("another form, an option nobody vouched for, an option before the form, or a path outside: no", () => {
      for (const [c, why] of /** @type {[string, RegExp][]} */ ([
        ["git push", /^git push is not one of git's reading forms/],
        ["git checkout -- src/x.js", /^git checkout is not one of git's reading forms/],
        ["git", /^git with no form$/],
        ["git -c core.fsmonitor=x status", /^git -c before its form: only --no-pager is read here/],
        ["git -C ../outside status", /^git -C before its form/],
        ["git --git-dir=x status", /^git --git-dir=x before its form/],
        ["git -p log", /^git -p before its form/],
        ["git diff --no-index a b", /^git diff --no-index is not an option known to only read$/],
        ["git diff --output=out.txt", /^git diff --output is not an option known to only read$/],
        ["git log --ext-diff -p", /^git log --ext-diff is not an option known to only read$/],
        ["git log -O order.txt", /^git log -O is not an option known to only read$/],
        ["git show --show-signature HEAD", /^git show --show-signature is not an option known to only read$/],
        ["git log -L 1,2:src/x.js", /^git log -L is not an option known to only read$/],
        ["git status -n", /^git status -n is not an option known to only read$/],
        ["git branch feature", /^git branch lists only with --list: with a name, it makes a branch$/],
        ["git branch -a", /^git branch lists only with --list/],
        ["git branch --list -D main", /^git branch -D is not an option known to only read$/],
        ["git branch --list -m a b", /^git branch -m is not an option known to only read$/],
        ["git branch --list feat*", /^git branch feat\*: a pattern with an unquoted glob — quote it$/],
        ["git log -- ../outside/secret.txt", /is outside the working folder/],
        ["git diff ../outside/secret.txt src/x.js", /is outside the working folder/],
        ["git log ~", /a `~`/],
        ["git log --since=~/x", /a `~`/],
      ]))
        no(c, why, at);
    });

    // (fails before: yes — the same: and git searches folders for a repository, where a few files the agent wrote pass
    // for a bare one, whose config names the commands git runs)
    test("only in the working folder itself, which holds its own .git: after a cd, with none, or one whose config the agent could write — no", () => {
      no("cd src && git status", /^git runs here only in the working folder itself: in another folder, files the agent wrote could pass for a repository/, at);
      no("cd src; git status", /^git runs here only in the working folder itself/, at);
      no("git status", /^the working folder holds no \.git of its own: git would search the folders above it$/);
      const headless = join(base, "headless");
      mkdirSync(join(headless, ".git"), { recursive: true });
      no("git status", /^\.git holds no HEAD: git would read the working folder itself as a repository$/, { root: headless });
      // A worktree's .git is a file naming its git folder: outside, yes; inside, the agent could write its config.
      const wt = join(base, "wt");
      mkdirSync(wt, { recursive: true });
      writeFileSync(join(wt, ".git"), `gitdir: ${join(repo, ".git")}\n`);
      yes("git log --oneline -3", { root: wt });
      writeFileSync(join(wt, ".git"), "gitdir: inner/gitdir\n");
      no("git status", /^\.git names a git folder inside the working folder \(inner\/gitdir\), whose config the agent could write$/, { root: wt });
      writeFileSync(join(wt, ".git"), "nothing here\n");
      no("git status", /^\.git names no git folder$/, { root: wt });
      // git is found before any folder the agent could write to, like any program.
      const tools = join(repo, "tools");
      tool(tools, "git");
      no("git status", /tools \(inside the working folder\) before it finds git$/, { root: repo, env: { PATH: [tools, bin].join(WIN ? ";" : ":") }, ...(WIN ? { shell: { ...SH, file: join(base, "nogit", "bin", "bash.exe") } } : {}) });
      // Not found at all, it asks: bash would only say so, but a reading form needs git itself.
      no("git status", /^git is not found on the PATH$/, { root: repo, env: { PATH: join(base, "outside") }, ...(WIN ? { shell: { ...SH, file: join(base, "nogit", "bin", "bash.exe") } } : {}) });
      // A .git that is a link — a junction here — is no git folder of the working folder's own: it could lead anywhere.
      const linked = join(base, "linkd");
      mkdirSync(linked);
      symlinkSync(join(repo, ".git"), join(linked, ".git"), "junction");
      no("git status", /^\.git is a link$/, { root: linked });
    });
  });

  // (fails before: yes — the owner's of 11-09: du was no program known to only read, so a Reviewer could not size a folder)
  test("du, which only sizes: inside the working folder, yes; an option that follows a link or reads names from a file, no", () => {
    for (const c of ["du -sh src", "du -a -d 1 .", "du -s --apparent-size -- src a.txt", "du -hc --max-depth=1 src", "du --exclude='*.js' -sh src"]) yes(c);
    for (const [c, why] of /** @type {[string, RegExp][]} */ ([
      ["du -L src", /^du -L is not an option known to only read$/],
      ["du -H src", /^du -H is not an option known to only read$/],
      ["du -D src", /^du -D is not an option known to only read$/],
      ["du --dereference src", /^du --dereference is not an option known to only read$/],
      ["du -X pats.txt src", /^du -X is not an option known to only read$/],
      ["du --exclude-from=pats.txt src", /^du --exclude-from is not an option known to only read$/],
      ["du --files0-from=list.txt", /^du --files0-from is not an option known to only read$/],
      ["du -sh ../outside", /is outside the working folder$/],
      ["du -sh linked/out", /reaches outside the working folder through a link$/],
    ]))
      no(c, why);
  });

  // The owner's of 11-09: Filament's Reviewer only reads, and was refused `git -C <worktree> status` and `du` on the
  // repository's own worktrees, so it could not size or status them. A run that only reads is handed the top folders
  // `git worktree list` names (agent/turn.js `worktreeReadsOf`) as folders it reads.
  describe("a run that only reads, and its repository's own worktrees (the owner's of 11-09)", () => {
    let main = "";
    let side = "";
    let helper = "";
    let other = "";
    /** A path as a bash command names it: forward slashes. */
    const fw = (/** @type {string} */ p) => p.replaceAll("\\", "/");
    /** git as the test's own setup runs it, with the few settings a commit needs. @param {string} cwd @param {...string} a */
    const gitIn = (cwd, ...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...a], { cwd, stdio: "pipe" });
    const secret = () => fw(join(base, "outside", "secret.txt"));
    before(() => {
      // base/wt/main is a repository with a commit; base/wt/side a worktree of it on a branch of its own, and
      // main/.git/filament-worktrees/sa_h a helper copy where Filament makes them; base/wt/other another repository.
      const top = join(base, "wt");
      main = join(top, "main");
      other = join(top, "other");
      for (const r of [main, other]) {
        mkdirSync(join(r, "sub"), { recursive: true });
        gitIn(r, "init", "-q", "-b", "main");
        writeFileSync(join(r, "a.txt"), "a\n");
        writeFileSync(join(r, "sub", "b.txt"), "b\n");
        gitIn(r, "add", "-A");
        gitIn(r, "commit", "-q", "-m", "one");
      }
      side = join(top, "side");
      helper = join(main, ".git", "filament-worktrees", "sa_h");
      gitIn(main, "worktree", "add", "-q", "-b", "side", side);
      gitIn(main, "worktree", "add", "-q", "--detach", helper);
      [main, side, helper, other] = [main, side, helper, other].map((p) => realpathSync(p));
    });

    // (fails before: yes — git took no -C and ran in the working folder alone, and du was no program known to only read)
    test("git's reading forms in one, after -C or a cd, and ls, wc and du on one or on a helper copy: yes, from each of them", () => {
      const [M, S, H] = [main, side, helper].map(fw);
      const fromMain = { root: main, reads: [side, helper] };
      for (const c of [
        `git -C ${S} status`,
        `git -C ${S} status --short`,
        `git -C ${S} log --oneline -3`,
        `git -C ${S} diff --stat`,
        `git -C ${S} diff -- a.txt sub`,
        `git --no-pager -C ${S} log -1`,
        `git -C ${S} --no-pager show --stat HEAD`,
        `git -C ${S}/ branch --list`,
        `git -C ${H} status --porcelain`,
        `git -C ${H} rev-parse HEAD`,
        "git -C . status",
        `cd ${S} && git status`,
        `cd ${H} && git log --oneline -1 && git diff --stat`,
        `ls -la ${S}`,
        `ls ${H}/sub`,
        `wc -l ${S}/a.txt ${H}/sub/b.txt`,
        `du -sh ${S}`,
        `du -sh -- ${S} ${H}`,
        `du -a -d 1 ${H}`,
        `find ${S} -name '*.txt'`,
        `git -C ${S} status && du -sh ${S} | tail -1`,
      ])
        yes(c, fromMain);
      // From a helper copy: the main folder and the other worktree. From that worktree: the main folder and the copy.
      for (const c of [`git -C ${M} status`, `git -C ${S} log --oneline -1`, `du -sh ${M}`, `cd ${M} && git diff --stat`]) yes(c, { root: helper, reads: [main, side] });
      for (const c of [`git -C ${H} status`, `git -C ${M} diff --stat`]) yes(c, { root: side, reads: [main, helper] });
      if (WIN) yes(`git -C ${msys(side)} status`, fromMain);
    });

    // (fails before: no — each was refused before too, most in other words: pinned with the reason that holds now —
    // another repository, a folder inside a worktree, a second -C, every command that writes, node --test among them)
    test("never another repository, a folder inside a worktree, a second -C, a write there, nor a path outside them", () => {
      const [S, H, O] = [side, helper, other].map(fw);
      const fromMain = { root: main, reads: [side, helper] };
      for (const [c, why] of /** @type {[string, RegExp][]} */ ([
        [`git -C ${O} status`, /^git -C before its form: .+ is outside the working folder and the folders added to it$/],
        [`git -C ${S}/sub status`, /^git runs here only in the working folder itself: in another folder, files the agent wrote could pass for a repository/],
        [`cd ${S}/sub && git status`, /^git runs here only in the working folder itself: in another folder, files the agent wrote could pass for a repository/],
        [`git -C ${S} -C ${H} status`, /^git -C twice before its form: one is read here$/],
        [`git -C ${S} -c core.fsmonitor=x status`, /^git -c before its form: only --no-pager is read here, and one -C to the working folder or a worktree of its repository that the run reads/],
        [`git -C ${S} commit -m x`, /^git commit is not one of git's reading forms/],
        [`git -C ${S} checkout -- a.txt`, /^git checkout is not one of git's reading forms/],
        [`git -C ${S} branch gone`, /^git branch lists only with --list: with a name, it makes a branch$/],
        [`git -C ${S} log -- ${secret()}`, /secret\.txt is outside the working folder and the folders added to it$/],
        // An operand is read from the folder -C names.
        [`git -C ${S} diff ../other/a.txt`, /^\.\.\/other\/a\.txt is outside the working folder and the folders added to it$/],
        [`touch ${S}/x`, /^`touch` is not one of the programs known to only read$/],
        [`ls > ${S}/x`, /only \/dev\/null/],
        [`cd ${S} && rm a.txt`, /^`rm` is not one of the programs known to only read$/],
        [`cat ${secret()}`, /is outside the working folder and the folders added to it$/],
        [`du -sh ${O}`, /is outside the working folder and the folders added to it$/],
        ["node --test", /^of node, only `node -v` and `node --version` are known to only read$/],
        [`cd ${S} && node --test`, /^of node, only `node -v` and `node --version` are known to only read$/],
      ]))
        no(c, why, fromMain);
    });

    // (fails before: yes — its words: -C was refused before anything was read of the folder it names)
    test("a folder the run reads that git's own records do not tie to this repository — another one, or a .git forged to pass for a worktree: no, said so", () => {
      const why = /^.+ is no worktree of the working folder's own repository, by git's own records: there, files an agent wrote could pass for a repository, whose config names commands git runs$/;
      // Another repository the run reads: by git's records, never by its letters.
      no(`git -C ${fw(other)} status`, why, { root: main, reads: [side, helper, other] });
      no(`cd ${fw(other)} && git status`, why, { root: main, reads: [side, helper, other] });
      // A .git naming another worktree's record, which names that worktree back.
      const forged = join(base, "wt", "forged");
      mkdirSync(join(forged, "rec"), { recursive: true });
      writeFileSync(join(forged, ".git"), `gitdir: ${fw(join(main, ".git", "worktrees", "side"))}\n`);
      no(`git -C ${fw(forged)} status`, why, { root: main, reads: [side, forged] });
      // A .git naming a record of its own, which names this repository's git folder as its common one and this .git back.
      writeFileSync(join(forged, "rec", "HEAD"), "ref: refs/heads/main\n");
      writeFileSync(join(forged, "rec", "commondir"), `${fw(join(main, ".git"))}\n`);
      writeFileSync(join(forged, "rec", "gitdir"), `${fw(join(forged, ".git"))}\n`);
      writeFileSync(join(forged, ".git"), "gitdir: rec\n");
      no(`git -C ${fw(forged)} status`, why, { root: main, reads: [side, forged] });
      // A .git folder of its own: a repository, never this one's main folder.
      rmSync(join(forged, ".git"));
      mkdirSync(join(forged, ".git"));
      writeFileSync(join(forged, ".git", "HEAD"), "ref: refs/heads/main\n");
      no(`git -C ${fw(forged)} status`, why, { root: main, reads: [side, forged] });
    });

    // (fails before: no — each was refused before too, some in other words: a run that may write is handed none of
    // them — agent/turn.js hands them to a run that only reads alone — and finds them where it did)
    test("a run that may write, handed none of them: the same commands are refused as before", () => {
      const [S, H] = [side, helper].map(fw);
      for (const [c, why] of /** @type {[string, RegExp][]} */ ([
        [`git -C ${S} status`, /^git -C before its form: .+ is outside the working folder$/],
        [`cd ${S} && git status`, /is outside the working folder$/],
        [`ls ${S}`, /is outside the working folder$/],
        [`du -sh ${S}`, /is outside the working folder$/],
        // A helper copy inside the main folder is inside the working folder, as it was; git there is not.
        [`git -C ${H} status`, /^git runs here only in the working folder itself: in another folder, files the agent wrote could pass for a repository/],
        [`cd ${H} && git status`, /^git runs here only in the working folder itself/],
      ]))
        no(c, why, { root: main });
      yes(`ls ${H}`, { root: main });
    });
  });
});

describe("the gate and the loop (HarnessV3-Launch LD-D11)", () => {
  // (fails before: yes — the gate took no reader, and Edit mode asked for every command)
  // HarnessV3-AtHome AH-F2 took the reader from Edit mode into every mode. (fails before: yes — Ask asked and read-only refused it)
  test("a bash command the reader passes runs in every mode but Full access's own, said as readOnly; the other hands stay as they were", () => {
    /** @type {string[]} */
    const asked = [];
    const reads = (/** @type {string} */ c) => (asked.push(c), /** @type {const} */ ({ ok: true }));
    const nope = () => /** @type {const} */ ({ ok: false, why: "`npm` is not one of the programs known to only read" });
    assert.deepEqual(gate("edit", "bash", { command: "ls -la" }, null, undefined, reads), { verdict: "run", readOnly: true });
    assert.deepEqual(asked, ["ls -la"], "the reader is handed the command");
    assert.equal(gate("edit", "bash", { command: "npm test" }, null, undefined, nope).verdict, "ask");
    assert.equal(gate("edit", "bash", { command: "ls" }).verdict, "ask", "without a reader, Edit mode asks as before");
    asked.length = 0;
    assert.deepEqual(gate("ask", "bash", { command: "ls" }, null, undefined, reads), { verdict: "run", readOnly: true }, "Ask runs it");
    assert.deepEqual(gate("read-only", "bash", { command: "ls" }, null, undefined, reads), { verdict: "run", readOnly: true }, "and read-only, the mode for looking");
    assert.deepEqual(gate("auto", "bash", { command: "ls" }, null, undefined, reads), { verdict: "run" }, "auto runs everything, unread");
    assert.deepEqual(asked, ["ls", "ls"], "Full access never asks the reader");
    asked.length = 0;
    assert.equal(gate("edit", "bash_background", { command: "ls" }, null, undefined, reads).verdict, "ask", "bash_background still asks");
    assert.deepEqual(gate("edit", "write", { path: "a.txt", content: "" }, null, undefined, reads), { verdict: "run" }, "a write runs in Edit mode as before");
    assert.deepEqual(asked, [], "only a foreground command is read");
    // HarnessV4_Tasks C10: PowerShell's foreground hand is read too, by the reader the caller picks for its name.
    assert.deepEqual(gate("edit", "powershell", { command: "Get-Location" }, null, undefined, reads), { verdict: "run", readOnly: true });
    assert.deepEqual(asked, ["Get-Location"]);
    assert.deepEqual(gate("edit", "bash", { command: "npm test" }, () => true, undefined, nope), { verdict: "run", learned: true }, "a learned permission still runs what the reader turns down");
  });

  const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  const reply = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
  const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
  /** @param {Partial<import("../src/app/agent/loop.js").LoopArgs>} over */
  const args = (over) =>
    /** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
      model: "m",
      messages: [{ role: "user", content: "go" }],
      system: "s",
      tools: toolSetFor({ delegateRead: false }),
      modeNow: () => "edit",
      root: tmpdir(),
      readerModel: "",
      maxTokens: 100,
      call: async () => reply([{ type: "text", text: "Done." }]),
      costOf: () => 0,
      runHand: async (/** @type {string} */ name) => `${name} ran`,
      delegateRead: null,
      mailbox: { read: () => [] },
      permissions: null,
      tree: null,
      onEvent: () => {},
      previewChars: 0,
      sink,
      signal: null,
      resume: null,
      ...over,
    });

  // (fails before: yes — `ls -la` paused the turn on "May I run this command?")
  test("the loop: in Edit mode `ls -la` runs without asking and the record says why; `npm test` still asks", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "filament-ldd11-loop-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(join(root, "a.txt"), "a\n");
    /** @type {string[]} */
    const ran = [];
    const runHand = async (/** @type {string} */ name, /** @type {any} */ input) => (ran.push(`${name}: ${input.command}`), "a.txt");
    let n = 0;
    const out = await runAgentTurn(args({ root, runHand, call: async () => (++n === 1 ? reply([toolUse("c1", "bash", { command: "ls -la" })]) : reply([{ type: "text", text: "Done." }])) }));
    if (SHELL.kind === "cmd") {
      // cmd.exe is not a bash: its commands are not read, and every one asks.
      assert.equal(out.status, "paused");
      return;
    }
    assert.equal(out.status, "done");
    assert.deepEqual(ran, ["bash: ls -la"]);
    assert.deepEqual(out.notes.filter((x) => /without asking/.test(x)), ["agent: bash ran without asking — it only reads"]);
    const asks = await runAgentTurn(args({ root, runHand, call: async () => reply([toolUse("c2", "bash", { command: "npm test" })]) }));
    assert.equal(asks.status, "paused");
    assert.match(asks.final[0].text, /May I run this command\? `npm test`/);
    assert.deepEqual(ran, ["bash: ls -la"], "npm test did not run");
  });
});

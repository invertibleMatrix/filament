# Build and run Filament yourself — the no-AI guide

*For the person who owns this machine. Everything here works without an AI assistant: what to
install, how to start and stop Filament, how to check it is healthy, how to fix the common
breakages, and what lives where. Windows first; the few places macOS/Linux differ are marked.*

## 1. What "building" Filament actually means

Filament is plain JavaScript run by Node.js. There is **nothing to compile**, and today nothing to
download at install time beyond Node itself. "Building" it is:

1. Have Node installed.
2. Have the code folder on disk (you already do — it is this folder).
3. Run one command.

That is the whole build.

## 2. What you need installed (once)

| Tool | Check it is there | If not |
|---|---|---|
| **Node.js 22.13 or newer** | Open PowerShell and type `node -v` — you want `v22.13…` or higher, or `v24…` | Download the LTS installer from <https://nodejs.org> and click through it. Then close and reopen PowerShell. |
| **Git** (only for getting updates) | `git -v` | <https://git-scm.com/download/windows> — defaults are fine. |

Nothing else, and one command once in this folder: `npm install --omit=dev`, which installs
Filament's one dependency, `node-pty` (the harness's terminal; without it Filament runs and the
terminal says it is missing). No database server, no Docker. (The memory engine — Mnemosyne — installs itself, with its own private Python, the
first time Filament starts, from the copy Filament carries: in a git checkout like this one, the copy
`npm run engine:bundle` puts in `vendor\memory-engine` (about 500 MB to download, once per engine
version). Nothing is downloaded as Filament starts. You never run Python yourself.)

**The installed app and this folder.** Once you install Filament (`dist\windows\<version>\Filament-<version>-setup-x64.exe`,
see [The desktop app](#the-desktop-app)), the installed app is the one Filament you use: its data is
`%APPDATA%\Filament`, on port 20300. A change made in this folder reaches it when you build the
installer (`npm run dist:win`) and run it: it upgrades the installed app in place, your chats and
sessions as they were. A running Filament is asked to quit first, as the tray's Quit does. The version
is `"version"` in `package.json`; each version's build stays in its own folder, so an older installer
is there to go back to. Filament started straight from this folder
(`npm run desktop`, `node bin\filament.js`) is not your Filament: it keeps its data in
`%APPDATA%\Filament-dev` and listens on port 20301, so it can never open your real chats, memory and
keys. `--data-dir` (or `FILAMENT_DATA_DIR`) points either at another folder.

**Where to type commands:** PowerShell (Start → type "PowerShell"). `cd` into the project
first, e.g. `cd C:\Filament`. Every command below assumes you are in that folder.

## 3. Starting it the first time

```powershell
node bin\filament.js --open
```

- `--open` also opens Filament in your browser: the console's Home until a model can answer, then the
  harness. Without it, open <http://127.0.0.1:20300/> yourself.
- On first start Filament **creates** its data folder (`%APPDATA%\Filament`; from a git checkout
  `%APPDATA%\Filament-dev`, on port 20301 — read 20301 for 20300 below), a configuration
  file, an inbound API key, and detects the coding agents installed on the machine. The
  window prints all of it — read the lines once, they tell you the port, the console's and the
  harness's addresses and the key.
- The window must stay open while Filament runs. Closing it stops Filament. (Step 5 makes that
  unnecessary.)

The window says `listening` — that is your "it works". Leave it running for the next step.

## 4. First-time setup (5 minutes, all in the browser)

1. Open the console → **Home**. Your inbound key is shown there (eye to reveal, Copy to
   copy). Any program that talks to Filament uses this key like a password.
2. Follow **Get started** on Home (its first step opens the provider catalogue), or do it by hand:
   - **Destinations → Upstreams → Add**: pick a provider (or a template from Settings →
     Templates), paste *their* API key, press **Test**, then **Save**.
   - **Destinations → Routes**: a route says which model names go to which upstream. Adding a
     provider from the catalogue creates one for you; `*` (a catch-all) is allowed.
3. Point your coding tool at Filament:

   | setting in your tool | value |
   |---|---|
   | base URL | `http://127.0.0.1:20300/v1` |
   | API key | the inbound key from Home |
   | model | a route name from step 2, e.g. `claude-opus-5` |

If your tool now answers, you are done. Everything else on this page is reference.

## 5. Everyday running (the part you will actually do)

**The comfortable way on Windows:** the desktop app (below). `npm run desktop` starts it; its
icon appears in the tray (bottom-right, near the clock) and it starts Filament with it. A click
on the icon shows the card (what needs you, what works, today's numbers); right-click for
Restart Filament, Start at logon, Notifications and Quit. Starting it when it is already running
opens its harness (one app at a time).

If you want it to start by itself at every logon as well: tray right-click → **Start at logon**.

| You want to… | Do this |
|---|---|
| Start Filament with its tray | `npm run desktop` |
| Start (visible window, for debugging) | `node bin\filament.js` |
| Start and open it in your browser | `node bin\filament.js --open` |
| Start it at every logon | tray right-click → **Start at logon** |
| Stop cleanly | tray right-click → **Quit**, or Ctrl+C in its window. Filament finishes the requests in flight (up to 20 s) first — just let it |
| Restart | tray right-click → **Restart Filament** (it tells you what it is doing) |
| See the inbound key again | `node bin\filament.js print-key` (or Home in the console) |
| Check everything is wired up right | `node bin\filament.js doctor` (add `--turn` for one real one-word test turn per coding agent) |
| Use a different port, once | `node bin\filament.js --port 20400` |

**Keep the console open while you work.** Traffic, Usage and Memory answer most "what is
happening" questions faster than any log file.

### The desktop app

The desktop app is Filament with windows of its own: the harness in one, the console in
another, a tray icon of its own. It runs the same server on the same data folder as Filament
started from a terminal — the installed app's `%APPDATA%\Filament`, or, run from this folder,
`%APPDATA%\Filament-dev` (a taskbar button and Start at logon of its own too, so it never takes
the installed app's). There is no published installer yet; from this folder:

```powershell
npm install          # once: also fetches Electron and its builder (development tools)
npm run desktop      # run the app over this folder
npm run engine:bundle # once per engine version: the memory engine the installer carries (~500 MB download)
npm run dist:win     # or build it, into dist\windows\<version>\: win-unpacked\Filament.exe and Filament-<version>-setup-x64.exe
```

*macOS/Linux:* `npm run dist:mac` on a Mac, `npm run dist:linux` on Linux (WSL's Ubuntu will do). Each system's app is
built on that system, and GitHub Actions builds all three — [releasing.md](releasing.md) says how, what Apple needs
from you once, and how a release reaches the installed apps.

- The installer installs for you alone, without administrator rights. It is not signed, so
  Windows warns before it runs it ("More info" → "Run anyway").
- Run over an installed Filament, it upgrades it in place and keeps your data. A running Filament
  is asked to quit first (while a turn runs, Filament asks you); one still running a minute later
  gets the installer's own box: close it, or cancel the install.
- **Closing its windows does not stop Filament**: the tray icon stays. A click on it shows the
  card; a double-click opens the harness; right-click → **Quit** stops Filament and the app.
- **Start at logon** and **Notifications** are checks in its tray menu.
- If a Filament already runs on that folder (a terminal's, say), the app shows
  it and leaves it running when you quit; if that Filament goes, the app starts its own after
  45 seconds.
- The app's own files are in `%APPDATA%\Filament\desktop\`; `server.log` there is what the
  server printed. Uninstalling never touches `%APPDATA%\Filament`.

## 6. Where everything lives

| File / folder | What it is | Safe to… |
|---|---|---|
| `%APPDATA%\Filament\config.json` | All settings. Secrets inside are encrypted. | Edit only while Filament is stopped, or better: change settings in the console |
| `%APPDATA%\Filament\secret.key` | The encryption key for those secrets | **Never delete.** Lose it = lose every stored API key and the memory archive's readable content |
| `%APPDATA%\Filament\requests.jsonl` | Request log (rotates at 50 MB) | Delete old `.1` file whenever |
| `%APPDATA%\Filament\daily-usage.json` | Per-day usage totals | Leave it alone |
| `%APPDATA%\Filament\memory\` | The memory folder: `archive.db` (your conversations), `mnemosyne\` (what was learned), `memory.json` | Back it up; never edit by hand |
| `%APPDATA%\Filament\memory-engine\` | The engine's private Python + Mnemosyne | Safe to delete entirely; Filament installs it again at its next start (or Memory → Overview → Install) |
| `C:\Filament\` (this folder) | The program itself | Update with `git pull` |

On macOS/Linux the data folder is `~/.config/filament` instead. Run from a git checkout, every
path above is `Filament-dev` (`filament-dev`) in place of `Filament` — see
[The installed app and this folder](#2-what-you-need-installed-once).

## 7. Updating to a newer version

```powershell
git pull
npm test
npm run docs
```

then restart Filament (tray → Restart). What each step means:

- `git pull` fetches the newest code. If it complains about local changes, someone (you or an
  agent) edited files without committing — ask before overwriting anything.
- `npm test` runs the test suite. **All green = safe to restart.** If it fails, do not deploy
  the update; go back to the previous commit (`git log` to see them, `git checkout <hash>` to
  stand on one).
- `npm run docs` regenerates two doc files from the code. Run it if `git status` shows
  `PARAMETERS.md` or `TEMPLATES.md` as modified.

The **memory engine** is never updated on its own: each Filament carries the engine it was tested with, and the
installed app puts its engine in as it starts (memory is backed up first when the Mnemosyne version changes). A
checkout gets its copy with `npm run engine:bundle` (about 500 MB to download, once per engine version).

## 8. When something breaks (most likely first)

| Symptom | Likely cause | Fix |
|---|---|---|
| Tool says *connection refused* | Filament is not running | Start it (`npm run desktop` or `node bin\filament.js`); check the port on Home |
| Tool gets **401 / invalid key** | The tool's API key is not the inbound key | Copy the key from Home into the tool |
| Tool gets **404 no route matches** | The model name is not in Routes | Add a route, or use an advertised name from `http://127.0.0.1:20300/v1/models` |
| `EADDRINUSE` on start | Port 20300 already taken | A Filament is already running (check the tray icon), or pick `--port 20400` |
| The console will not open from a weird address | Protection against DNS rebinding | Use `http://127.0.0.1:20300/` exactly |
| The window says `config.json is not valid JSON` | A hand edit broke it | A `.broken-…` copy was saved next to it. Fix your edit, or delete config.json to start fresh (you will re-enter keys) |
| Secrets show as "could not decrypt" at start | `secret.key` was deleted or replaced | Restore `secret.key` from a backup; Filament refuses to invent a new one |
| The app shows old behaviour after an update | **Restart Filament restarts the server only — the app is its own program and keeps running its old copy** | Tray right-click → **Quit**, then `npm run desktop` again |
| Memory page says engine *not installed* | Its install failed (the card and the alerts say why), it was removed, or `memory.engine.autoInstall` is off | Memory → Overview → Install, or restart Filament. In a git checkout without the engine's copy, `npm run engine:bundle` first (~500 MB to download, one time) |
| Memory page says *degraded* | The engine crashed 3× | Read the error on the card; memory keeps working from the archive alone meanwhile; Restart under Memory → Settings (or the Live tab's engine panel), or Uninstall then Install there |
| Everything is slow after a fresh start | First model list asks every agent for its models | Wait a minute; it is cached afterwards |
| `git pull` → `npm test` fails | A broken update arrived | `git log --oneline` then `git checkout <previous hash>` and report it |

Nuclear option, in order of destruction: delete `%APPDATA%\Filament\config.json` (lose settings,
keep memory) → delete the whole `memory` folder (lose memory, keep settings) → delete
`%APPDATA%\Filament` (start over; copy `secret.key` and the `memory` folder somewhere first if
you ever want them back).

## 9. If you ever edit things by hand

- **Settings**: use the console. If you must edit `config.json`, stop Filament first, make a
  copy of the file next to itself, and start again. Bad JSON is caught (see the table above).
- **Code**: it is one file per job (see the map below). After any change:
  `npm test` → all green → restart Filament. If you touched `src/schema.js` (any setting), also
  `npm run docs` so the parameter documentation matches.
- **Keep a way back**: `git add -A` and `git commit -m "what I changed and why"` *before*
  experimenting, so `git checkout .` always returns you to safety.
- The memory folder is production data. No experiment should ever point at it — if you are
  testing, use a fresh folder (`memory.folder` setting) and switch back afterwards.

## 10. Map of the code (what to open for what)

| File | Job in one line |
|---|---|
| `bin\filament.js` | The command line: start, print-key, doctor |
| `src\server.js` | The HTTP server: every endpoint, the request pipeline, admin API |
| `src\config.js` / `src\schema.js` | Settings: load/save/validate; every settable parameter with its description |
| `src\rules.js` | How requests are reshaped (thinking, effort, caching) before forwarding |
| `src\translate.js` / `src\proxy.js` | Anthropic↔OpenAI translation; streaming and usage counting |
| `src\upstreams.js` / `src\resilience.js` | Routing and model lists; health, cooldowns, failover |
| `src\acp.js` | Coding agents driven as models (Cursor, Claude Code, …) |
| `src\archive.js` | The encrypted record of every conversation |
| `src\memory-brain.js` | The autopilot: what memory adds to each request |
| `src\memory-engine.js` + `sidecar\` | The Mnemosyne child process and how it is spoken to |
| `src\memory-learn.js` | The cheap model that distils sessions at boundaries |
| `src\ui\app.js` | The console (plain JavaScript, refresh the page after edits) |
| `desktop\` | The desktop app (Electron): its windows, tray, card and notifications around the same server |
| `test\` | The tests. `npm test` runs them all, no internet needed |

Glossary: **upstream** = where a request goes (a provider or an agent). **route** = which model
names go to which upstream. **inbound key** = the password your tools use against Filament.
**chain** = one conversation as memory sees it. **briefing** = the once-per-session memory
block in the system prompt. **engine** = the Mnemosyne child process that holds learned facts.

## 11. Cheat sheet (print this bit)

```powershell
cd C:\Filament
node -v                     # want v22.13 or newer
node bin\filament.js --open  # start + open it
node bin\filament.js print-key
node bin\filament.js doctor  # add --turn for a real test turn
npm test                    # the whole suite, no internet needed
npm run desktop             # the desktop app (after npm install once)
npm run engine:bundle       # the memory engine the installer carries (once per engine version)
npm run dist:win            # build the app + its installer into dist\windows\<version>\ (refused without that bundle)
npm run dist:mac            # on a Mac; dist:linux on Linux (docs\releasing.md)
npm run docs                # regenerate parameter docs after schema changes
git pull                    # get updates, then: npm test → restart
```

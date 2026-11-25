# Filament on a server

How to run Filament on a Linux server with no desktop: install it with one command, set it up over SSH, keep it
running under systemd, reach it from your laptop, and update it. Everything runs as your own user; nothing needs root
except the few system steps marked `sudo`. A Windows host is set up the same way, by PowerShell
([section 10](#10-a-windows-host)), and a Mac with Apple silicon under launchd ([section 11](#11-a-mac)).

## 1. What a server runs

Filament for servers is Filament with no desktop app: the server, the harness it serves to browsers, the command line
(`filament`), its own Node, and the memory engine. Its chats, agents and terminals run on the server, and your laptop's
browser or Filament app shows and drives them ([Remote access](GUIDE.md#remote-access-this-filament-from-another-machine)).

It runs on:

- **Linux on x86_64 or arm64 (aarch64)** with **glibc 2.28 or newer**: Debian, Ubuntu, Fedora, RHEL and their kin,
  on a PC server, a cloud's arm64 machine (AWS Graviton, Ampere, Azure Cobalt) or a Raspberry Pi 4 or 5 with a 64-bit
  system. Not Alpine or another musl system: Filament's Node does not run there. Not a 32-bit system, Raspberry Pi
  OS's 32-bit release included.
- **Its terminals** need the glibc the build was made on, or newer: 2.35 for releases, which are built on Ubuntu 22.04,
  on x86_64 and on arm64 alike. On an older glibc Filament runs, but its terminals don't open.
- **Windows on x64 (AMD64)**: Windows 10 1803 or newer, or Windows Server 2019 or newer, reached with Windows' own
  OpenSSH Server ([section 10](#10-a-windows-host)). Not Windows on ARM.
- **A Mac with Apple silicon** on **macOS 13.5 or newer**: a Mac mini or Mac Studio kept as a server, or a cloud's
  Mac, reached over SSH with Remote Login on ([section 11](#11-a-mac)). Not an Intel Mac.

**The agent's browser.** A chat's browser is the desktop app of whoever drives the chat
([Which machine's browser a chat uses](GUIDE.md#the-agents-browser)). In your laptop's app, Settings › Remote access ›
Machines, the **Browser** pill on the server's card, makes it the browser of the chats you drive on the server:
their pages open on your laptop, and their `localhost` is the server's, so the agent's dev server on the server opens
at `http://localhost:5173` there. Without that, or while your laptop's app is away, the server runs Chrome or Chromium
headless, if it has one: `sudo apt install chromium` on Debian or Ubuntu (or Google Chrome's .deb, or
`FILAMENT_CHROME` set to its path). With neither, the agent's browser calls say so, and it does the work another way.
When your laptop's app goes mid-turn, the pages it held open again in that Chrome at the agent's next call.

## 2. Install

**From the Filament app on your laptop**, sections 2 to 5 are one sheet: Settings › Remote access › **Set up over
SSH…**, then `you@server` or a Host of your SSH config. It runs each step below on the server over SSH — install (this
app's version, or the newest release where this app's has no server build), the service with lingering, the coding
agents installed there connected and memory on, the tailnet or the network, the pairing — and says each as it goes;
what only you answer (a host key, a password, `sudo`) runs in a terminal on the sheet. Run again, it does only what is
missing. Signing its coding agents in and giving it keys are on its card afterwards (section 3)
([Setting a machine up over SSH](GUIDE.md#remote-access-this-filament-from-another-machine)). By hand, on the server:

```sh
curl -fsSL https://github.com/invertibleMatrix/filament/releases/latest/download/install.sh | sh
```

It reads the newest release's `latest-server.yml`, downloads the tarball it names (about 370 MB), checks its SHA-512
against it, and unpacks it. It needs `curl` or `wget`, `tar`, `gzip`, and `sha512sum` or `openssl`; it says which are
missing, and installs nothing until they are there. The checksum catches a damaged download. It does not catch a
dishonest mirror: the file of checksums and the tarball come from the same place.

**On arm64** the same command installs arm64's build: `uname -m` says `aarch64`, and the installer reads
`latest-server-arm64.yml` and downloads `filament-server-<v>-linux-arm64.tar.gz` in place of x64's. Nothing to choose.
A release built without arm64's has no `latest-server-arm64.yml`, and the installer says so; `FILAMENT_VERSION`
installs an earlier release that has it.

A pipe takes no flags, so options go in the environment, on the `sh` side of the pipe:

| Option | What it does |
|---|---|
| `FILAMENT_VERSION=1.2.3` | That release, not the newest. One installed already is pointed at again, not downloaded |
| `FILAMENT_NO_ENGINE=1` | The tarball without the memory engine (about 53 MB). Memory still records your chats, and recalls by matching words, not by meaning |
| `FILAMENT_RELEASES_URL=…` | Where the releases are, for a mirror |

```sh
curl -fsSL https://github.com/invertibleMatrix/filament/releases/latest/download/install.sh | FILAMENT_NO_ENGINE=1 sh
```

Where things go:

| Path | What it is |
|---|---|
| `~/.local/share/filament/<version>/` | One version, whole. `$XDG_DATA_HOME/filament` where that is set |
| `~/.local/share/filament/current` | A link to the version that runs |
| `~/.local/bin/filament` | The command line, a link through `current`. A file or a link of yours already at that path is left alone, and the installer names `current/bin/filament` to run instead |
| `~/.config/filament/` | The data folder: settings, keys, chats, memory. `$XDG_CONFIG_HOME/filament` where that is set; `--data-dir` or `FILAMENT_DATA_DIR` picks another |

Two versions are kept: the one that runs and the one before it, for a roll back. Older ones are removed, once the new
one is in. An install that fails or is stopped partway is undone: `current`, the command and a build of the same
version it replaced are as they were, and a first install leaves nothing behind. If
`~/.local/bin` is not on your `PATH`, the installer says so and gives the line that adds it. With memory on, the memory
engine installs itself into the data folder the first time Filament starts (about 650 MB more), from the copy in the
tarball, with nothing downloaded.

Filament listens on `127.0.0.1:20300`, the server alone, until you share it (section 5).

## 3. Set it up

```sh
filament setup
```

It starts Filament where none runs, then asks, a step at a time: which coding agents to connect and sign in, which
provider's API key to add (typed as stars), and whether memory is on. Each step can be skipped and run again
later. Over SSH it opens no page: it prints each address for you to open on your laptop.

A model needs either a provider's key or a coding agent:

- **A key:** `filament keys add anthropic` (or `openai`, `openrouter`…). Nothing more is needed.
- **Codex:** pick **ChatGPT on another device**, which over SSH is listed first, or run
  `filament agents sign-in codex --way chatgpt-code`. It prints a page and a code: open the page in any browser, on any
  machine, and type the code there.
- **Claude Code:** the sign-in prints a line to run. Run it in a second SSH terminal on the server, then press Enter in
  the first.

`filament status` says what runs, what can answer, and who each agent is signed in as. `filament agents` lists the
coding agents it finds, and `filament agents install <id>` installs one or prints the line that does.

**From the Filament app on your laptop**, once it is paired (section 5), the server's card in Settings › Remote access ›
Machines says who each coding agent there is signed in as. **Sign in there…** opens the server's own Settings › Coding
agents in the app; **Copy keys…** sends the providers' keys you tick from your laptop to the server, and no others. A
key the server holds already under another name is left as it is, and said.

## 4. Keep it running

```sh
filament service install
```

This writes a systemd user unit, `~/.config/systemd/user/filament.service` (no root), and starts it. The unit runs the
installed Filament by its stable path (`current`), on this data folder, with `--port` where you give it. systemd starts
it again 3 s after it ends by itself. A Filament you started by hand, `filament setup`'s included, is stopped first,
once no turn runs.

A user unit starts when you log in and stops when your last session ends (the last SSH session, or WSL's last window,
closed), and a turn that runs then stops with it. To start it at boot with no one logged in, turn on lingering.
`service install` checks it and says so:

```sh
loginctl enable-linger $USER          # some systems need: sudo loginctl enable-linger $USER
```

| Command | What it does |
|---|---|
| `filament service status` | Whether it runs and starts at boot, what it runs, lingering, and its log's last lines. `--json` too |
| `filament service logs` | Follows its log (journalctl), until Ctrl+C |
| `filament service uninstall` | Stops it, once no turn runs (`--force`: now), and removes the unit |
| `filament stop` · `filament restart` | Go through `systemctl --user` while systemd runs Filament, so systemd does not start again what you stopped. Both wait for running turns unless `--force`; a Filament whose stop hangs past a minute and a half is restarted by systemd all the same |

**Without systemd** (a container, WSL without systemd), run `filament start` under a supervisor of your own: a
container's restart policy, or `tmux` or `screen`. `filament stop` stops it; nothing starts it again.

## 5. Reach it from your laptop

A server has no browser of its own, so its Settings › Remote access is opened from your laptop, or set with
`filament settings` on the server. Pick one way in.

**Programs on the server.** Filament answers a program on the server by its owner key: `owner.key` in the data
folder, made anew at each start. The `filament` command line sends it with every call, and a script of yours sends it
as the `x-filament-owner` header. A program that sends no key, pairing or session is no one's, whatever account it runs
as. `filament settings set server.loopbackTrust legacy` lets every program on the server in with no key, every other
account's too; Filament says so as it starts, and `filament doctor` warns while it is on and counts the calls that came
without the key.

**SSH, from the Filament app.** On your laptop: Settings › Remote access › **Add a machine…**, and type `ssh://` and the
server's Host from your SSH config, or `ssh://you@server`. The app holds the tunnel itself, with your SSH keys and
agent (it never asks for a password, and the server's host key must be known already). No code to type: **Pair** runs
`filament pair` on the server over SSH and claims its code through the tunnel, so the app is a full device there — its
agents, its chats' browser and the server's models work through the tunnel as over the network, while the app holds
it. Where the Filament app runs on the server, which makes its codes in its own window, the server is added with no
device, and the sheet says why. Once paired, the app learns the server's other ways — its network addresses, pinned to
its certificate, and its tailnet address — and reaches it by the best one that answers, the SSH tunnel last.

**An SSH tunnel by hand.** On your laptop:

```sh
ssh -N -L 20400:127.0.0.1:20300 you@server
```

Then open `http://127.0.0.1:20400` there. Any free port on your laptop will do; 20300 is taken where Filament runs on
the laptop too. A caller through the tunnel that sends no device's token is a program on the server as the server
sees it: no one's without its owner key, so its browser is sent to the pairing page. `filament open --no-open` on the
server says a one-time link (`http://127.0.0.1:20300/ui/pair.html#code=…`) that pairs that browser by name, opened on
your laptop at the tunnel's own address and port (`http://127.0.0.1:20400/ui/pair.html#code=…`).
A command line connects with a code from `filament pair`: `filament connect http://127.0.0.1:20400 <code>`.

**Your network.** On the server:

```sh
filament settings set server.lan.enabled true
```

At once, Filament also listens on the server's network addresses over https at port 20343 (`server.lan.port`), with
a certificate of its own. Artifacts' pages are at the port after it, 20344. Open both in the server's firewall, and in
your cloud's security group where there is one:

```sh
sudo ufw allow 20343:20344/tcp
```

**Tailscale.** With Tailscale installed and signed in on the server, and HTTPS turned on for your tailnet:

```sh
sudo tailscale set --operator=$USER       # once: lets your user run tailscale serve
filament settings set server.tailscale.serve true
```

Filament asks Tailscale to serve it at `https://<server>.<your tailnet>.ts.net`, while it listens on the server
alone; nothing to open in the firewall. `filament settings set server.tailscale.trustOwnLogin true` lets in your own
machines on the tailnet without pairing. Tailscale hands each request on below a random path that only it and
Filament know, and your tailnet login is believed on those requests alone: a program on the server that calls
Filament's port saying it comes from the tailnet is no one's.

**Pairing.** On the network or the tailnet, every device pairs once. On the server:

```sh
filament pair            # --view for a device that only reads
```

It prints a code, good for five minutes and one claim, and a link for each address; where a link is on the network,
it prints the certificate's fingerprint too. On your laptop, open a link in a browser (where it warns of the
certificate, check that the fingerprint it shows is the one printed; a tailnet link opens with no warning); or paste it
into the Filament app's **Add a machine…**; or run `filament connect <link>`. The server's Settings › Remote access,
opened from a paired device, shows each link with a QR code for a phone's camera. Then any command goes there with
`--machine <name>`: `filament status --machine build-box`. `filament devices` on the server lists what is paired, and
`filament devices revoke <device>` stops one.

## 6. Let your laptop's agents work there

Your laptop's Filament can let its agents start chats in the server's projects, send them turns and follow them. In
the Filament app on the laptop: Settings › Remote access › Machines, the **Agents** pill on the server's card.
It needs the app paired with the server as a full device — over the network, the tailnet, or by `ssh://`, where
**Pair** makes the device over SSH. Through an SSH tunnel your laptop's agents reach the server while the app runs,
holding the tunnel, as their device. The tunnel's port on your laptop is open to every program there, and the server
takes a caller through it that sends no device's token as a program of its own with no owner key: no one's, refused.

What their chats may do there, and what they never touch, is in
[Another machine's agents](GUIDE.md#remote-access-this-filament-from-another-machine). In short: they start in the
folders of your projects and chats on the server, never a home folder, the data folder or a credentials folder; they
take words, pictures, documents, a model, effort and a permission mode, and no other setting; a sub-agent's chat runs in
the mode of the chat that sent it, *auto* only with **Without asking** or **Full control** on for their device, with
memory off; so does a single command. A command or a chat sent with no mode, from a Filament that sends none, runs in the server's own mode:

```sh
filament settings set agentLoop.permissions edit    # read-only, edit, ask or auto
```

Even in `auto` their commands ask first, as in `edit`, and Filament runs no command task or check of theirs, until
**Without asking** is pressed on the laptop's card in the server's Settings › Remote access › Machines. Their
chats don't run on the server's coding agents (Claude Code, Codex, Cursor) until **Coding agents** is on there too.

**Full control**, the last pill on their line, lets them act on the server as you: any folder but the data folder,
*auto* unasked, the server's MCP servers, skills and memory, and its coding agents as yours (what stays shut is in
[Another machine's agents](GUIDE.md#remote-access-this-filament-from-another-machine)). The laptop's app switches it
on the server's card in Settings › Remote access › Machines, as it does Agents. A command they run can read
and change whatever Filament's account on the server can, its keys and Filament's owner key among it, and so reach
Filament there as the server's owner: with no app on the server, that is pairing a device of its own, which outlasts Full control. A
command **Without asking** lets run unasked can do the same. Switch either on only for a server that is yours.

Your laptop's agents then send sub-agents there and run commands there — one check, or the same check on every machine —
and the asks of both come to your chat on the laptop
([Your agents on your other machines](GUIDE.md#your-agents-on-your-other-machines)).

## 7. Update and roll back

```sh
filament update
```

It finds the newest published release, of the kind installed (with the memory engine or without) and for the machine
its build is for (Linux on x64 or arm64, Windows on x64, a Mac with Apple silicon), downloads it, checks its SHA-512,
unpacks it beside the version that runs, and points `current` at it. The Filament its service runs (systemd's unit; on
a Windows host, its scheduled task; on a Mac, launchd's LaunchAgent) then restarts on it, once no turn runs. While a turn runs it exits with code 5 and keeps the update:
`filament restart` starts the new version once the turn ends. A Filament started by hand is told to start again. A
download, a checksum or an unpack that fails changes nothing, nor does a release built on a newer glibc than the
server's. A new version that does not come up under its service — it ends as it starts, or does not answer within a
minute — is left for the one before: `current` points back at it, it is started again, and the update says so in one
line and exits with code 1.

| Command | What it does |
|---|---|
| `filament update --check` | Only says whether a newer release is out |
| `filament update --version 1.2.3` | That release, older or newer. One kept beside is pointed at again, with nothing downloaded |
| `filament update --back` | Points `current` back at the version kept before, and restarts the same way |
| `filament update --force` | Restarts now, cutting a turn that runs |
| `filament update --wait` | Waits until no turn runs, asking again every few seconds, then restarts; the new version, started by its service meanwhile, that does not come up is left for the one before — the desktop app's **Update Filament** runs it so |

Where no Filament answers and systemd cannot say whether its unit runs, `filament update` says so, restarts nothing
and goes back to nothing, and exits with code 1: `filament service status` says where it stands.

**From the Filament app on your laptop.** A server older than the app has **Update Filament on** *it* in its ⋯ in the
machines menu, and **Update all machines…** above Add a machine updates every older one; a server too old for the app
to open has the same button on its page. Each goes to the app's version and restarts once no turn runs there, as
`filament update --wait` does, and the app says how each went: a new version that does not come up goes back to the one
before, and while an installed update waits for its restart, no other version goes over it. A server the app reaches
only over SSH, or whose Filament has no update route, is updated over SSH.

Every version runs on the same data folder. Where the version that starts does not read a file as another saved
it — your teams, your agents, a Space, the usage files, telemetry's —, it sets the file aside whole beside itself,
under a name that says its version (`teams.json.v3.20261112T093005Z`), saves nothing over it, and starts that store
with none; the version that saved it takes it back when it runs again, and nothing is merged. `filament update` says
which files those are before it restarts, and what the version it starts does with them; going back to a version
that does not carry this rule, which would save over such a file and takes none back, it keeps a copy of the file beside it
first, and puts that version's own file back in place where a newer one had set it aside.

Running the installer again updates too, and `FILAMENT_VERSION` rolls back to a kept version. The installer restarts
nothing, so restart after it:

```sh
curl -fsSL https://github.com/invertibleMatrix/filament/releases/latest/download/install.sh | FILAMENT_VERSION=1.2.3 sh
filament restart
```

## 8. Uninstall

```sh
filament service uninstall       # or filament stop, where you started it by hand
rm -rf ~/.local/share/filament
rm -f ~/.local/bin/filament
rm -rf ~/.config/filament        # only to forget everything: settings, keys, chats and memory
```

## 9. When something goes wrong

| What you see | Why | What to do |
|---|---|---|
| `… built for Linux on x86_64 and on arm64 (aarch64), and for a Mac with Apple silicon, and this machine is …` | Windows, a Linux machine of another kind (32-bit ARM, RISC-V), or another system | A Windows host installs with `install.ps1` (section 10). Others are not built for |
| `Filament for servers runs on a Mac with Apple silicon, and this Mac's chip is Intel's` | An Intel Mac | Filament is not built for Intel Macs |
| `Filament for servers needs macOS 13.5 or newer, and this Mac runs …` | An older macOS | Update macOS (System Settings › General › Software Update) |
| `Filament for Windows hosts is built for x64 (AMD64), and this machine is Windows on ARM64.` | Windows on ARM | Install the desktop app there |
| `Filament's installer unpacks with Windows' own tar.exe, which this Windows does not have` | A Windows older than 10 1803, or than Windows Server 2019 | A newer Windows |
| `filament service install` says registering a task `takes an administrator` | Task Scheduler refused your account a task that runs at boot with no one logged in | Run it in a PowerShell opened as administrator, or over SSH as an administrator (its sessions are elevated) |
| `… runs 64-bit programs, and this machine's are 32-bit …` | A 32-bit system on a 64-bit kernel, as Raspberry Pi OS's 32-bit release is on a Pi 4 or 5 | Install the system's 64-bit release |
| `Filament's releases gave no latest-server-arm64.yml …` on arm64 | That release was built without arm64's tarballs | `FILAMENT_VERSION=` a release that has them, or wait for the next |
| `filament update` refuses: `release … carries no filament-server-…-linux-arm64.tar.gz` | The newest release was built without arm64's tarballs | Stay on the version you have; the next release with them updates it |
| `… this machine's C library is another (Alpine's musl?)` | A musl system | Use a Debian, Ubuntu, Fedora or RHEL server or container |
| `… needs glibc 2.28 or newer, and this machine has …` | The system is too old | A newer release of the system |
| `… Filament runs, but its terminals don't open here` | glibc older than the build's (2.35 for releases) | Ubuntu 22.04 or newer, Debian 12 or newer, or another system with glibc 2.35 or newer |
| `…/.local/bin is not on your PATH` | The shell doesn't look there | Run the line the installer gives, then open a new shell |
| `systemd's user manager does not answer here` | WSL without systemd, a container, or a login with no user session | On WSL: `[boot]` then `systemd=true` in `/etc/wsl.conf`, then `wsl --shutdown` in Windows. Elsewhere: `filament start` under a supervisor (section 4) |
| `There is no systemctl here` | No systemd at all | `filament start` under a supervisor (section 4) |
| Filament doesn't start at boot; `filament service status` says linger is off | A user unit starts at login without lingering | `loginctl enable-linger $USER`, with `sudo` where it asks |
| The laptop can't reach the server | The network listener is off, a firewall closes the port, or the address is wrong | `filament settings get server.lan.enabled`; open 20343 and 20344 (section 5); use an address `filament pair` prints |
| `filament pair` says `Filament runs in WSL behind its NAT` | WSL 2's default networking: its address opens from that Windows computer alone | `networkingMode=mirrored` under `[wsl2]` in `.wslconfig` in your Windows user folder, then `wsl --shutdown`; or share Filament on your tailnet |
| `filament chat` says `The connection dropped mid-reply` | The network between the laptop and the server went away mid-turn | Nothing is lost: the turn goes on on the server. `filament chat --chat <id> <message>` goes on with it once it ends |
| `filament chat` says `Nothing came from Filament for 45 s` | The connection went quiet without closing (a sleeping laptop, a network that dropped silently) | As above: the turn may go on on the server; `filament chat --chat <id> <message>` once it ends |
| `Host "…" does not name this machine` | Filament was called by a name it doesn't know (a reverse proxy, a hosts alias) | `filament settings set server.allowedHosts '["that.name"]'` |
| A Codex sign-in waits and never ends | The sign-in that opens a page on this machine was picked, and over SSH that page is on the server | Stop it, then `filament agents sign-in codex --way chatgpt-code` |
| `filament update` refuses: `not where install.sh installs it` (on Windows, `install.ps1`), `runs from a checkout`, or `no server build` | This Filament was not installed by its installer | Install with `install.sh` (section 2), or `install.ps1` on a Windows host (section 10). A checkout updates with `git pull`, then `filament restart` |
| `filament update` refuses: `it was built on glibc …` | The new release needs a newer glibc than the server has | Stay on the version you have, or move to a newer system |
| `filament update` exits with code 5 | A turn runs | The update is in place: `filament restart` once the turn ends, or `filament update --force` next time |
| `filament update` says `… did not come up … so current points at … again` | The new version did not start on this server | The version before runs again. `filament service status` shows the log; `filament update` tries the new one again |
| `filament update` says `… answers at …, not …: its unit starts another than current leads to` | The service's unit starts one version's own folder, not `current` | `filament service install` writes the unit again, and starts the new version |
| The app says `<server> runs Filament …, too old for this app: update Filament on <server>.` | The server speaks an older wire than the app | Its ⋯ › **Update Filament on** *it* in the app, or `filament update` on the server |
| The app says `… too new for this app: update this app.` | The app is older than the server | Update the Filament app (its tray's Check for updates) |
| A script on the server gets 403, saying Filament answers a program on this computer by its owner key | It sent no owner key | Send `owner.key` from the data folder as the `x-filament-owner` header (made anew at each start), or use the `filament` command line (section 5) |

## 10. A Windows host

Filament for servers runs on a Windows host too — a Windows Server, or a Windows 10 or 11 PC you reach over SSH, on
x64 — with no desktop app: the same server, harness, command line and memory engine, with Node for Windows. Everything
above holds, with these differences.

**Set up over SSH** from the Filament app (section 2) does it all, each step in PowerShell there, as Windows' own
OpenSSH Server starts it. That server must be on there first (Settings › System › Optional features › OpenSSH Server,
then `Start-Service sshd`). A host that asks for a password gets your laptop's key from the sheet, its PowerShell
adding it to `%USERPROFILE%\.ssh\authorized_keys`, or for an administrator to
`C:\ProgramData\ssh\administrators_authorized_keys` with the access Windows' OpenSSH requires of it.

**Install by hand**, in PowerShell on the host:

```powershell
irm https://github.com/invertibleMatrix/filament/releases/latest/download/install.ps1 | iex
```

It reads the release's `latest-server-win32-x64.yml`, downloads the tarball it names, checks its SHA-512 and unpacks it
with Windows' own `tar.exe`. No administrator is needed: everything goes in your own folder.

| Path | What it is |
|---|---|
| `%LOCALAPPDATA%\filament\<version>\` | One version, whole |
| `%LOCALAPPDATA%\filament\current` | A junction to the version that runs |
| `%LOCALAPPDATA%\filament\current\bin\filament.cmd` | The command line. `current\bin` goes on your user PATH (`FILAMENT_NO_MODIFY_PATH=1` leaves the PATH as it is); a new terminal finds `filament` |
| `%APPDATA%\Filament\` | The data folder: settings, keys, chats, memory |

Its options are environment variables, set before the line: `$env:FILAMENT_VERSION = '1.2.3'`, and
`FILAMENT_NO_ENGINE` and `FILAMENT_RELEASES_URL` as on Linux. Two versions are kept, and an install that fails partway
is undone, as `install.sh` does. A version a run was stopped partway through removing (Ctrl+C) goes at the next run.

**Keep it running.** `filament service install` registers Task Scheduler's task `\Filament\Filament`. It starts at
boot with no one logged in, as you without your password (S4U: it reaches no network share, and Windows' Credential
Manager is closed to it). Its runner starts Filament again 3 s after it ends by itself, as systemd does. Registering
the task takes an administrator: a PowerShell opened as administrator, or SSH as one. `filament service status`,
`logs` and `uninstall` work as on Linux, and its log is `<data folder>\service\server.log`. With its task installed,
`filament start`, `stop` and `restart` go through its runner.

**Your network.** Windows Firewall lets no one in to Filament's ports until a rule does. In a PowerShell opened as
administrator:

```powershell
New-NetFirewallRule -DisplayName Filament -Direction Inbound -Protocol TCP -LocalPort 20343-20344 -Action Allow
```

Tailscale serves Filament with no rule, as on Linux, and Windows' Tailscale names no operator to set.

**Update.** `filament update` updates it as on Linux, its scheduled task restarting it on the new version. The app's
**Update Filament** runs the update apart from Filament, by the build's own Node, so the restart it makes ends
Filament alone.

**Uninstall**, in PowerShell:

```powershell
filament service uninstall       # or filament stop, where you started it by hand
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\filament"
Remove-Item -Recurse -Force "$env:APPDATA\Filament"   # only to forget everything: settings, keys, chats and memory
```

Then take `%LOCALAPPDATA%\filament\current\bin` off your user PATH (Settings › System › About › Advanced system
settings › Environment Variables).

## 11. A Mac

Filament for servers runs on a Mac with Apple silicon too — a Mac mini or Mac Studio kept as a server, or a cloud's
Mac — with no desktop app: the same server, harness, command line and memory engine, with Node for macOS. Everything
above holds, with these differences.

**Set up over SSH** from the Filament app (section 2) does it all. Remote Login must be on there first (System
Settings › General › Sharing › Remote Login).

**Install by hand**, in Terminal on the Mac, with the same line as on Linux:

```sh
curl -fsSL https://github.com/invertibleMatrix/filament/releases/latest/download/install.sh | sh
```

It reads the release's `latest-server-darwin-arm64.yml` and installs into the same folders as on Linux:
`~/.local/share/filament`, `~/.local/bin/filament`, and the data folder `~/.config/filament`. A Terminal under Rosetta
installs it too, as the installer asks the Mac's own chip. Where `~/.local/bin` is not on your PATH, the installer
gives the line for your shell (`~/.zprofile` for zsh). The Filament app on the same Mac uses that data folder and port
too, so one of them runs at a time; the installer says so where it finds the app.

**Keep it running.** `filament service install` writes launchd's LaunchAgent,
`~/Library/LaunchAgents/com.filamentdev.server.plist` (no root), and loads it: its runner starts Filament, and starts
it again 3 s after it ends by itself. A LaunchAgent runs once you log in at the Mac. To start Filament at boot with
no one logged in, install its LaunchDaemon, which runs as you: `service install` writes it beside the runner's files
and says the one line that installs it, which **Set up over SSH** runs in a terminal on its sheet:

```sh
sudo launchctl bootout system/com.filamentdev.server 2>/dev/null; sudo install -m 644 -o root -g wheel ~/.config/filament/service/com.filamentdev.server.plist /Library/LaunchDaemons/com.filamentdev.server.plist && sudo launchctl bootstrap system /Library/LaunchDaemons/com.filamentdev.server.plist
```

`filament service status`, `logs` and `uninstall` work as on Linux, and its log is
`~/.config/filament/service/server.log`. `filament start`, `stop` and `restart` go through its runner, with no `sudo`,
whether launchd started it by its LaunchAgent or its LaunchDaemon.

**What a Mac asks of a server.**

- **Sleep.** A Mac that sleeps runs nothing: System Settings › Energy, **Prevent automatic sleeping when the display is
  off** (or `sudo pmset -a sleep 0`).
- **FileVault.** After a restart, a Mac with FileVault on runs nothing until someone unlocks its disk at the Mac. For a
  restart you plan, `sudo fdesetup authrestart` unlocks it once.
- **Your folders.** macOS asks before a program reads `~/Documents`, `~/Desktop` or `~/Downloads`, and a Filament
  launchd runs has no one to ask: keep projects in another folder (`~/code`), or give Filament's Node Full Disk Access
  (System Settings › Privacy & Security).
- **Sign-ins.** Claude Code keeps its sign-in in your login keychain, which stays locked until you log in at the Mac;
  started at boot before that, it may ask to sign in again.

**Your network.** macOS's firewall, where it is on, lets in programs rather than ports, and asks at the Mac before it
lets a new one in. With no one there to answer, let Filament's Node in:

```sh
n=$(readlink -f ~/.local/bin/filament); n=$(cd "${n%/*}/../node/bin" && pwd -P)/node
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$n" && sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "$n"
```

Each update's Node is a program of its own to it, so run it again after an update; **Set up over SSH** says it on
every run while the firewall is on. Tailscale serves Filament with no rule, as on Linux, and a Mac names no operator
to set.

**Update.** `filament update` updates it as on Linux, launchd's runner restarting it on the new version. The app's
**Update Filament** runs the update apart from Filament, by the build's own Node, as on a Windows host.

**Uninstall:**

```sh
filament service uninstall       # or filament stop, where you started it by hand
rm -rf ~/.local/share/filament
rm -f ~/.local/bin/filament
rm -rf ~/.config/filament        # only to forget everything: settings, keys, chats and memory, the app's too
```

Where its LaunchDaemon is installed, `service uninstall` says the line that removes it:
`sudo launchctl bootout system/com.filamentdev.server; sudo rm /Library/LaunchDaemons/com.filamentdev.server.plist`.

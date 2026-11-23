# Filament on a server

How to run Filament on a Linux server with no desktop: install it with one command, set it up over SSH, keep it
running under systemd, reach it from your laptop, and update it. Everything runs as your own user; nothing needs root
except the few system steps marked `sudo`.

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

**The agent's browser.** A chat's browser is the desktop app of whoever drives the chat
([Which machine's browser a chat uses](GUIDE.md#the-agents-browser)). In your laptop's app, Settings › Remote access ›
Machines, the **Browser** pill on the server's card, makes it the browser of the chats you drive on the server:
their pages open on your laptop, and their `localhost` is the server's, so the agent's dev server on the server opens
at `http://localhost:5173` there. Without that, or while your laptop's app is away, the server runs Chrome or Chromium
headless, if it has one: `sudo apt install chromium` on Debian or Ubuntu (or Google Chrome's .deb, or
`FILAMENT_CHROME` set to its path). With neither, the agent's browser calls say so, and it does the work another way.
When your laptop's app goes mid-turn, the pages it held open again in that Chrome at the agent's next call.

## 2. Install

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

**SSH, from the Filament app.** On your laptop: Settings › Remote access › **Add a machine…**, and type `ssh://` and the
server's Host from your SSH config, or `ssh://you@server`. The app holds the tunnel itself, with your SSH keys and
agent (it never asks for a password, and the server's host key must be known already). No code to type: **Pair** runs
`filament pair` on the server over SSH and claims its code through the tunnel, so the app is a full device there — its
agents, its chats' browser and the server's models work through the tunnel as over the network, while the app holds
it. Where the Filament app runs on the server, which makes its codes in its own window, the server is added with no
device, and the sheet says why.

**An SSH tunnel by hand.** On your laptop:

```sh
ssh -N -L 20400:127.0.0.1:20300 you@server
```

Then open `http://127.0.0.1:20400` there. Any free port on your laptop will do; 20300 is taken where Filament runs on
the laptop too. The server answers a caller through the tunnel that sends no device's token as itself: whoever can
open the tunnel — any program on your laptop — can sign in to the server already. `filament open --no-open` on the
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
machines on the tailnet without pairing.

**Pairing.** On the network or the tailnet, every device pairs once. On the server:

```sh
filament pair            # --view for a device that only reads
```

It prints a code, good for five minutes and one claim, a link for each address, and the certificate's fingerprint. On
your laptop, open a link in a browser (where it warns of the certificate, check that the fingerprint it shows is the
one printed); or paste it into the Filament app's **Add a machine…**; or run `filament connect <link>`. Then any command goes there with
`--machine <name>`: `filament status --machine build-box`. `filament devices` on the server lists what is paired, and
`filament devices revoke <device>` stops one.

## 6. Let your laptop's agents work there

Your laptop's Filament can let its agents start chats in the server's projects, send them turns and follow them. In
the Filament app on the laptop: Settings › Remote access › Machines, the **Agents** pill on the server's card.
It needs the app paired with the server as a full device — over the network, the tailnet, or by `ssh://`, where
**Pair** makes the device over SSH. Through an SSH tunnel your laptop's agents reach the server while the app runs,
holding the tunnel — whose port on your laptop is open to every program there, and the server answers one that sends
no device's token as itself: Agents' grants fence your agents' device, not the tunnel.

What their chats may do there, and what they never touch, is in
[Another machine's agents](GUIDE.md#remote-access-this-filament-from-another-machine). In short: they start in the
folders of your projects and chats on the server, never a home folder, the data folder or a credentials folder; they
take words, pictures, documents, a model, effort and a permission mode, and no other setting; a sub-agent's chat runs in
the mode of the chat that sent it, *auto* only with **Without asking** or **Full control** on for their device, with
memory off; so does a single command. A command or a chat sent with no mode, from a Filament before these, runs in the server's own mode:

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
and change whatever Filament's account on the server can, its keys among it, and reach Filament there as the server's
own programs do: with no app on the server, that is pairing a device of its own, which outlasts Full control. A
command **Without asking** lets run unasked can do the same. Switch either on only for a server that is yours.

Your laptop's agents then send sub-agents there and run commands there — one check, or the same check on every machine —
and the asks of both come to your chat on the laptop
([Your agents on your other machines](GUIDE.md#your-agents-on-your-other-machines)).

## 7. Update and roll back

```sh
filament update
```

It finds the newest published release, of the kind installed (with the memory engine or without) and for the machine
its build is for (x64 or arm64), downloads it, checks its SHA-512, unpacks it beside the version that runs, and points
`current` at it. The Filament systemd runs then
restarts on it, once no turn runs. While a turn runs it exits with code 5 and keeps the update: `filament restart`
starts the new version once the turn ends. A Filament started by hand is told to start again. A download, a checksum
or an unpack that fails changes nothing, nor does a release built on a newer glibc than the server's. A new version
that does not come up under systemd — it ends as it starts, or does not answer within a minute — is left for the one
before: `current` points back at it, it is started again, and the update says so in one line and exits with code 1.

| Command | What it does |
|---|---|
| `filament update --check` | Only says whether a newer release is out |
| `filament update --version 1.2.3` | That release, older or newer. One kept beside is pointed at again, with nothing downloaded |
| `filament update --back` | Points `current` back at the version kept before, and restarts the same way |
| `filament update --force` | Restarts now, cutting a turn that runs |
| `filament update --wait` | Waits until no turn runs, asking again every few seconds, then restarts; the new version, started by systemd meanwhile, that does not come up is left for the one before — the desktop app's **Update Filament** runs it so |

Every version runs on the same data folder. Where the version that starts does not read a file as another saved
it — your teams, your agents, a Space, the usage files, telemetry's —, it sets the file aside whole beside itself,
under a name that says its version (`teams.json.v3.20261112T093005Z`), saves nothing over it, and starts that store
with none; the version that saved it takes it back when it runs again, and nothing is merged. `filament update` says
which files those are before it restarts, and what the version it starts does with them; going back to a version
from before this rule, which would save over such a file and takes none back, it keeps a copy of the file beside it
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
| `… built for Linux on x86_64 and on arm64 (aarch64), and this machine is …` | A Mac, Windows, or a Linux machine of another kind (32-bit ARM, RISC-V) | Install the desktop app on a Mac or Windows. Other Linux machines are not built for |
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
| `filament update` refuses: `not where install.sh installs it`, `runs from a checkout`, or `no server build` | This Filament was not installed by `install.sh` | Install with `install.sh` (section 2). A checkout updates with `git pull`, then `filament restart` |
| `filament update` refuses: `it was built on glibc …` | The new release needs a newer glibc than the server has | Stay on the version you have, or move to a newer system |
| `filament update` exits with code 5 | A turn runs | The update is in place: `filament restart` once the turn ends, or `filament update --force` next time |
| `filament update` says `… did not come up … so current points at … again` | The new version did not start on this server | The version before runs again. `filament service status` shows the log; `filament update` tries the new one again |
| `filament update` says `… answers at …, not …: its unit starts another than current leads to` | The service's unit starts one version's own folder, not `current` | `filament service install` writes the unit again, and starts the new version |

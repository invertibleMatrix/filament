# Building and releasing Filament

How Filament's desktop app is built for Windows, macOS and Linux, on your own machines and on GitHub Actions; what
Apple needs from you once; and how a release reaches the people who installed Filament.

## 1. How it fits together

**What a build is.** Filament's desktop app is an Electron app: Chromium and Node, packed with Filament's own code into
an app for one system. [electron-builder](https://www.electron.build) does the packing, and `electron-builder.yml` says
what goes in. `npm run dist:<system>` checks the memory engine's bundle, runs electron-builder, and then checks the
app it built. What it makes, in `dist/<system>/<version>/`:

| System | Command | What people install | Update file |
|---|---|---|---|
| Windows (x64) | `npm run dist:win` | `Filament-<v>-setup-x64.exe`, an installer that needs no administrator | `latest.yml` |
| macOS (Apple Silicon) | `npm run dist:mac` | `Filament-<v>-mac-arm64.dmg`: open it, drag Filament to Applications. The `.zip` beside it is what updates download | `latest-mac.yml` |
| Linux (x64) | `npm run dist:linux` | `Filament-<v>-linux-x86_64.AppImage`, a single file for any distribution, and `Filament-<v>-linux-amd64.deb` for Debian and Ubuntu | `latest-linux.yml` |
| Linux servers (x64), no desktop app | `npm run dist:server` | `filament-server-<v>-linux-x64.tar.gz`, and `…-no-engine.tar.gz` without the memory engine, which `install.sh` installs (section 6) | `latest-server.yml` |
| Linux servers (arm64), no desktop app | `npm run dist:server`, on an arm64 machine | `filament-server-<v>-linux-arm64.tar.gz`, and `…-no-engine.tar.gz` | `latest-server-arm64.yml` |

The update file lists each install file with its SHA-512. An installed Filament checks a download against it and
keeps nothing that doesn't match.

**Each system is built on its own machine.** Cross-building doesn't work here, for three reasons:

- The memory engine's bundle (`npm run engine:bundle`, about 500 MB to download, once per engine version) is Python
  and native libraries for the machine it is built on.
- A Mac app can only be signed and notarized on a Mac.
- node-pty, the terminal library, has no prebuilt Linux binary, so `npm ci` compiles it on Linux.

`npm run dist:mac` on Windows is refused and tells you why. GitHub Actions builds all three systems, each on its own
machine.

**Signing.** An operating system trusts an app by who signed it:

- **macOS:** an app signed with a *Developer ID Application* certificate and *notarized* (Apple scans it and issues a
  ticket) opens anywhere. Unsigned, it opens only on the Mac that built it. Elsewhere macOS says it "is damaged" or
  "can't be opened".
- **Windows:** an unsigned installer runs, but SmartScreen shows "Windows protected your PC" until people press
  **More info › Run anyway**. Filament's Windows build is unsigned for now (section 7).
- **Linux:** nothing to sign.

**Where releases live.** Releases go to a repository that holds only releases, apart from the code:
`invertibleMatrix/filament-releases`, named in `electron-builder.yml`'s `publish`. Every build records it inside the app
(`resources/app-update.yml`), and the app looks there for updates.

**How an installed app updates.** A minute after it starts, and every six hours after that, the app asks GitHub for the
releases repository's newest published release. A newer one shows a notice at the foot of the sidebar,
**Filament x is out**, with **Update**, and an item in the tray menu. Nothing downloads until someone presses Update.
The download runs while they work, and the notice then says **Restart to update**. How the update installs depends on
how Filament was installed:

- **Windows installer:** the new installer runs silently as Filament quits, and starts the new version.
- **macOS:** Electron's updater (Squirrel.Mac) checks that the new app is signed by the same team, and swaps it in on
  restart. An app not in Applications is asked to move there first, because macOS won't update an app run from the
  disk image or Downloads.
- **AppImage:** the new file replaces the old one at the same path, and Filament starts again from it.
- **deb:** the system's password prompt asks to install it with apt, and Filament starts again. Dismissing the prompt
  installs nothing.
- **Mac App Store or Microsoft Store builds:** the button opens the store, which does the updating.
- **Anything else** (an rpm, a Flatpak, an unpacked folder): the button opens the release's page.

Quitting Filament while an update is ready installs it too, except a deb, which needs the password prompt. On a Mac,
any way the app ends installs it, a logout included: the Mac's updater has it from the moment it is downloaded.
**Settings › About › Updates › Check now** looks at once, rather than at the next look, and says what it found.
**Check for updates** in the tray menu turns the looking off and on. A git checkout updates with git and looks for
nothing.

## 2. The version

`package.json`'s `"version"` is the only place the version is set. Every build and every release is named by it. Change
it with `npm version 0.9.1 --no-git-tag-version` (or by hand), then commit. A version built again replaces its own
folder in `dist/`; another version gets a folder of its own, so you can still go back to any version you built.

## 3. Building on your own machines

### Windows

```powershell
npm ci
npm run engine:bundle     # once per engine version
npm run dist:win          # dist\windows\<version>\Filament-<version>-setup-x64.exe
```

### macOS (Apple Silicon)

Once, on the Mac:

1. Install the command line tools: `xcode-select --install`.
2. Install Node 24 from [nodejs.org](https://nodejs.org), or with `brew install node@24`.
3. Get the code: `git clone https://github.com/invertibleMatrix/filament.git`, then `cd filament` and `npm ci`.
4. Set up the certificate and the notarization key (section 4). Put the certificate in your keychain **before** the
   next step: the memory engine's bundle signs its programs with it.
5. `npm run engine:bundle`.
6. Store the notarization key in your keychain under a name, so builds can use it without the key file:

   ```sh
   xcrun notarytool store-credentials filament-notary \
     --key ~/Downloads/AuthKey_ABC123DEFG.p8 --key-id ABC123DEFG --issuer 01234567-89ab-cdef-0123-456789abcdef
   ```

Then, for every build:

```sh
APPLE_KEYCHAIN_PROFILE=filament-notary npm run dist:mac
```

This signs the app with your Developer ID and notarizes it, which takes a few minutes while Apple scans it. The last line
says what you got: `Signed by Developer ID Application: … (TEAMID), and notarized: it opens on any Mac.` Without
`APPLE_KEYCHAIN_PROFILE` the app is signed but not notarized: it runs on your Mac, but other Macs refuse it.

A bundle built before the certificate was in the keychain is unsigned, and `dist:mac` refuses to notarize an app that
carries it. Run `npm run engine:bundle` again once the certificate is there. A bundle built before 8 November 2026
left the programs inside its wheels and Python archive unsigned, and Apple refuses those; `dist:mac` refuses it too, for
the same fix.

The first time `engine:bundle` signs, macOS asks whether `codesign` may use your key: type your Mac password and press
**Always Allow**, or it asks again for each of the hundred or so programs.

### Linux

You don't need a Linux machine: Windows 11's WSL runs Ubuntu. Once, in PowerShell:

```powershell
wsl --install -d Ubuntu-22.04
```

Then, in the Ubuntu terminal:

```sh
sudo apt update && sudo apt install -y build-essential python3 git curl
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt install -y nodejs
# In Linux's own folders (~), not /mnt/c or /mnt/h: Windows' drives are slow from WSL, and keep no Linux file modes.
git clone https://github.com/invertibleMatrix/filament.git ~/filament && cd ~/filament
npm ci
npm run engine:bundle
npm run dist:linux        # dist/linux/<version>/: the AppImage and the deb
```

Ubuntu 22.04 is the build machine because an app built there runs on that release and every newer one. Built on a
newer release, it would not run on older ones.

To try the AppImage, Ubuntu 22.04 and newer need FUSE 2: `sudo apt install libfuse2` (on 24.04 the package is named
`libfuse2t64`). Then `chmod +x` the file and run it. To try the deb: `sudo apt install ./Filament-<v>-linux-amd64.deb`,
then `filament-desktop`. The command is `filament-desktop`, not `filament`, which stays the name of Filament's command
line.

### Linux servers

In the same Ubuntu 22.04, after `npm run engine:bundle`:

```sh
npm run dist:server       # dist/server/<version>/: both tarballs and latest-server.yml
```

It builds both tarballs, the whole one and the `-no-engine` one, and one `latest-server.yml` with each one's SHA-512.
Each tarball is unpacked into a throwaway folder and tried there before it is kept: its launcher, its memory engine,
a terminal, and its Filament started and serving the harness. `npm run dist:server -- --no-engine` builds the small one alone, with no
bundle needed. The Node that runs the build goes into the tarballs, so it must carry its own libraries: Node from
nodejs.org, or nvm's. The build refuses one that uses the system's. It builds from a git checkout alone, and packs only the
files git tracks: a folder with no `.git` is refused, since nothing there tells a developer's own `.env` from the checkout's.

It builds for the machine it runs on: Linux x64, or Linux arm64 (an arm64 Ubuntu 22.04 machine, after its own
`npm ci` and `npm run engine:bundle`). There it makes `filament-server-<v>-linux-arm64.tar.gz`, its `-no-engine` one
and `latest-server-arm64.yml`. It refuses every other machine, and never builds one machine's tarballs on another: the
memory engine's bundle and node-pty are built for the machine they run on. `latest-server.yml` is x64's alone, which
every x64 install reads; a release by hand carries both machines' folders' files side by side.

## 4. Apple, once

You need an Apple Developer Program membership (you have one), and these two things from it.

### The Developer ID Application certificate

This signs the app. Do these steps on the Mac:

1. Open **Keychain Access** (Spotlight: "Keychain Access"). From the menu bar: **Keychain Access › Certificate
   Assistant › Request a Certificate From a Certificate Authority…**. Enter your email and name, leave CA Email empty,
   pick **Saved to disk**, **Continue**, and save `CertificateSigningRequest.certSigningRequest`.
2. In a browser, go to [developer.apple.com/account](https://developer.apple.com/account) › **Certificates, IDs &
   Profiles** › **Certificates** › the **+** next to the title. Pick **Developer ID Application**, **Continue**. For
   Profile Type keep **G2 Sub-CA**, upload the request from step 1, **Continue**, then **Download**.
3. Double-click the downloaded `developerID_application.cer`: Keychain Access adds it to your **login** keychain. Check
   with `security find-identity -v -p codesigning` in Terminal. It lists `"Developer ID Application: Your Name (TEAMID)"`.
4. For GitHub Actions, export it with its private key: in Keychain Access, **login** › **My Certificates**, right-click
   **Developer ID Application: Your Name (TEAMID)** › **Export…**, format **Personal Information Exchange (.p12)**, save
   it as `filament-developer-id.p12`, and give it a strong password. Keep the file and the password somewhere safe, such
   as a password manager. Anyone who has both can sign apps in your name.

### The App Store Connect API key

Notarization uses this key to sign in to Apple:

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com) › **Users and Access** › **Integrations** ›
   **App Store Connect API** › **Team Keys**. The first time, press **Request Access** and accept the terms.
2. Press **+** (Generate API Key). Name it `Filament notarization`, set Access to **Developer**, and press **Generate**.
3. Press **Download** next to the new key: `AuthKey_<KEYID>.p8`. Apple lets you download it **once**, so keep it
   safe. Write down its **Key ID** (in the key's row) and the **Issuer ID** (above the list of keys).

## 5. GitHub, once

### The releases repository

Create a public repository that holds only releases. It needs one commit (the README), because a release's tag is made
on its branch when the release is published.

```sh
gh repo create invertibleMatrix/filament-releases --public --add-readme --description "Filament's releases"
```

To use another name, change `publish` in `electron-builder.yml` and `RELEASES_REPO` in
`.github/workflows/build.yml` together; `test/build-workflow.test.js` checks that they match. An installed app keeps
looking in the repository it was built with.

### A token that can write its releases

The workflow runs in the code repository, and its own token can't write to another repository. So it uses a token of
yours:

1. Go to github.com › your picture › **Settings** › **Developer settings** › **Personal access tokens** ›
   **Fine-grained tokens** › **Generate new token**.
2. Name it `Filament releases` and set an expiration; a year is the most allowed, so put a reminder in your calendar.
   Resource owner: **invertibleMatrix**. Repository access: **Only select repositories** › `filament-releases`.
3. Under **Permissions › Repository permissions**, set **Contents** to **Read and write**. **Metadata: Read** comes
   with it. Press **Generate token** and copy it.

### The secrets

Secrets go straight from your terminal into GitHub. **Never paste them into a chat, an issue or a commit.** Run these
from the folder holding the files. Each `gh secret set` without `--body` asks for the value and hides what you type.

```sh
R=invertibleMatrix/filament
gh secret set RELEASES_TOKEN --repo $R                                  # paste the token
base64 -i filament-developer-id.p12 | gh secret set MAC_CERT_P12 --repo $R
gh secret set MAC_CERT_PASSWORD --repo $R                               # the .p12's password
gh secret set APPLE_API_KEY_P8 --repo $R < AuthKey_ABC123DEFG.p8
gh secret set APPLE_API_KEY_ID --repo $R --body ABC123DEFG
gh secret set APPLE_API_ISSUER --repo $R --body 01234567-89ab-cdef-0123-456789abcdef
gh secret list --repo $R                                                # the six names, never their values
```

These are the Mac's commands, run where the `.p12` and the `.p8` are. From Windows, run them in Git Bash, with
`base64 -w 0 filament-developer-id.p12` in place of `base64 -i …`.

## 6. Building and releasing on GitHub Actions

The workflow is `.github/workflows/build.yml`. A version job checks the tag and, on a tag's run, drafts the release.
Then, in parallel: the Windows installer, the Mac app on an Apple Silicon machine, the Linux AppImage and deb on Ubuntu
22.04, and the server tarballs on Ubuntu 22.04 too, x64's and arm64's. The typecheck and the tests are not run there:
they run on your machine before a commit lands. On a tag's run each build puts its files straight into the draft, and
keeps no artifact: artifacts count toward the account's Actions storage, 2 GB on its plan, and one release's builds
(about 2.9 GB for 0.9.77) outgrew it; a release's files count toward none. A build by hand keeps its files as an
artifact of the run for a day. To see what artifacts take room, and delete one:
`gh api "repos/invertibleMatrix/filament/actions/artifacts" --jq '.artifacts[] | "\(.id) \(.name) \(.size_in_bytes)"'`,
then `gh api -X DELETE repos/invertibleMatrix/filament/actions/artifacts/<id>`. GitHub counts what is freed again only
every 6 to 12 hours. Each memory engine bundle is cached until the engine's pins change. A tag's run can only use a
cache made on main, though, so run a build by hand from **main** once after the engine changes; otherwise every
release downloads its 500 MB again.

**A build by hand:** github.com › `filament` › **Actions** › **Build** › **Run workflow**. Pick the branch and which
systems to build. The builds are under the run's **Artifacts** for a day. With the five Mac
secrets set, the Mac app is signed and notarized exactly as a release's is. Without them it is built unsigned, with a
warning, and opens only on a Mac that allows it.

**Your first run:** once the secrets are set, run it by hand with **mac** alone, before you tag any release. It is the
first time Apple sees the app. Apple's notary service checks every program inside the app, and opens every archive in
it: the memory engine's Python archive and its wheels. The bundle's build signs the programs inside them
(`npm run engine:bundle`; the first notarized run, on 8 November 2026, was refused 67 programs in them before it
did). If Apple refuses one, the step's output holds Apple's log: each file it refused, and why.
`xcrun notarytool log <id> --keychain-profile filament-notary` on your Mac reads it again by the submission's id.

**The server build:** the `server` job runs `npm run dist:server`, which builds both tarballs and one
`latest-server.yml` for them (section 3), then copies `scripts/install.sh` beside them. It shares the Linux job's
memory engine bundle: the same cache, so one build of it serves both. It makes Filament for servers, with no desktop
app:

| File | What it is |
|---|---|
| `filament-server-<v>-linux-x64.tar.gz` | Filament with its own Node and the memory engine |
| `filament-server-<v>-linux-x64-no-engine.tar.gz` | The same without the memory engine |
| `latest-server.yml` | Each tarball's SHA-512, which `install.sh` checks a download by |
| `install.sh` | `scripts/install.sh`, the one-command installer |

A release carries all four. A server installs the newest published release with:

```sh
curl -fsSL https://github.com/invertibleMatrix/filament-releases/releases/latest/download/install.sh | sh
```

A draft changes nothing for it until it is published. Built on Ubuntu 22.04 (glibc 2.35), Filament's terminals open
on servers with that glibc or newer; Filament itself runs on glibc 2.28 and newer. To build it alone: **Actions** ›
**Build** › **Run workflow**, systems **server**. How a server installs, runs and updates it:
[Filament on a server](server.md).

**The arm64 server build:** the `server-arm64` job does the same on an arm64 machine, with its own memory engine
bundle, and adds three files to the release: `filament-server-<v>-linux-arm64.tar.gz`, its `-no-engine` one and
`latest-server-arm64.yml`. `install.sh` on an arm64 server reads that file, and `filament update` there too. x64's
`latest-server.yml` lists x64's tarballs alone, so every x64 install finds its file as it does in a release without
arm64's. Two repository variables steer the job (github.com › `filament` › **Settings** › **Secrets and variables** ›
**Actions** › **Variables**, or `gh variable set`):

| Variable | What it does |
|---|---|
| `ARM64_RUNNER` | The runner the job runs on. Unset, it is `ubuntu-22.04-arm`: GitHub's own arm64 runner, with 2 CPUs and its minutes counted against the plan's. Set it to an arm64 larger runner's name (Team and Enterprise plans) or a self-hosted runner's label. It must run Ubuntu 22.04: the job stops on any other glibc than 2.35 |
| `SERVER_ARM64` | `off` skips the arm64 job: the release goes out with x64's server files alone, and arm64 servers keep the version they have |

```sh
R=invertibleMatrix/filament
gh variable set ARM64_RUNNER --repo $R --body my-arm64-runner   # only for a runner other than GitHub's own
gh variable set SERVER_ARM64 --repo $R --body off               # skip arm64; gh variable delete SERVER_ARM64 --repo $R builds it again
```

A job no runner picks up waits, queued, for up to a day, and the release waits on it. Where the repository has no
arm64 runner, set `SERVER_ARM64` to `off` before you tag; on a run that waits already, cancel it, set the variable and
run the tag's build again. A failed arm64 job stops the release, as any build's does: **Re-run failed jobs** runs it
again.

**A release:**

1. Set the version: `npm version 0.9.1 --no-git-tag-version`. Commit it and push it to main.
2. Tag that commit and push the tag:

   ```sh
   git tag v0.9.1
   git push origin v0.9.1
   ```

   A tag that isn't `v` plus `package.json`'s version stops the run at once.
3. The run drafts the release **Filament 0.9.1** in `filament-releases`, then builds all three systems and the server
   tarballs, x64's and arm64's (unless `SERVER_ARM64` is `off`), each putting its files into the draft as it ends. The
   Mac build is signed and notarized; without the five Mac secrets it fails rather than make a release Macs refuse.
   The run then checks that every installer, every update file and `install.sh` are in the draft, and writes its
   notes.
4. Look at the draft: github.com › `filament-releases` › **Releases**. Download and try what you want to, edit the
   notes, then press **Publish release**.
5. Installed apps find it within six hours, or a minute after they start, or at once with **Settings › About › Updates ›
   Check now**. Until the release is published, nothing sees it.

If a build fails, the draft keeps the files that got up, without notes: **Re-run failed jobs** puts the rest in,
replacing any of the same name. A tag whose release is already published stops the run in its version job: release
a new version instead. To give up on a tag, delete its draft and the tag.

## 7. Windows signing, later

Windows works unsigned. SmartScreen warns on a downloaded installer until people press **More info › Run anyway**,
and the warning fades as an installer's download count builds reputation. Updates never show it: the app downloads the
installer itself, so the file carries no "from the internet" mark.

When signing is worth it:

- **Azure Artifact Signing** (formerly Trusted Signing; $9.99 a month). The certificate is kept in Azure, and
  electron-builder signs with it through `win.azureSignOptions`. It gives certificates to organizations in the USA,
  Canada, the EU and the UK, but to *individuals* only in the USA and Canada.
- **SignPath Foundation**: free signing for open-source projects. The code has to be public under an OSI license,
  with no proprietary parts, and the certificate names SignPath Foundation as the publisher.
- **The Microsoft Store**: registration is free for individual developers (since September 2025). Microsoft signs an
  MSIX package for you, but MSIX moves what an app writes in AppData into a per-package location, where Filament's
  command line wouldn't see it. That needs work first.
- **winget**, Windows' package manager (`winget install Filament`): free, and installs from it show no browser warning.
  It's a manifest pointing at the GitHub release, sent to `microsoft/winget-pkgs` as a pull request.
- A certificate from a certificate authority (Certum, Sectigo, SSL.com): a yearly fee and an identity check. It's the
  one way for an individual outside the USA and Canada whose code isn't open source.

## 8. When something goes wrong

| What you see | Why | What to do |
|---|---|---|
| `No installer without the memory engine` | No bundle for this machine, or one for another engine version | `npm run engine:bundle` |
| `No notarized build with an unsigned memory engine bundle` | The bundle was built before the certificate was in the keychain | `npm run engine:bundle` again |
| Notarization fails: `The software is not signed` / `invalid signature` | A program inside the app wasn't signed | Find the submission's id in the build's output, then read Apple's log: `xcrun notarytool log <id> --keychain-profile filament-notary`. It names every file it refused |
| A Mac says Filament "is damaged and can't be opened" | An unsigned or unnotarized app, downloaded | Build it signed and notarized. To try an unsigned one anyway: `xattr -dr com.apple.quarantine /Applications/Filament.app` |
| A Mac build ends: `… and notarized …, but stapler validate didn't confirm the ticket here` | Apple notarized it and the ticket was stapled, but `stapler validate` said no on the build machine (GitHub's runners have, of a stapled app) | On a Mac: `spctl -a -vv /Applications/Filament.app`. `source=Notarized Developer ID` means it opens on any Mac |
| The Mac job fails: `Some of the Mac signing secrets are set, not all` | One of the five is missing | `gh secret list` and set the missing one (section 5) |
| The version job or a build's **Into the draft release** fails: `No RELEASES_TOKEN secret` or `HTTP 403` | The token is missing, expired, or can't write `filament-releases` | Make a new token (section 5) and set it again |
| The version job fails: `… is published in filament-releases already` | The tag's release was published before this run | Bump the version and tag that (section 6) |
| A build by hand fails on `Artifact storage quota has been hit` | Earlier runs' artifacts fill the account's 2 GB | Delete them (section 6), and wait up to 12 hours for GitHub to count again |
| The AppImage won't start: `dlopen(): error loading libfuse.so.2` | FUSE 2 isn't installed | `sudo apt install libfuse2` (`libfuse2t64` on 24.04) |
| An installed app offers no update | The release is still a draft, or it lacks this system's `latest*.yml` | Publish it. A published release missing a file: build that system by hand from the tag, then `gh release upload v<version> <file> --repo invertibleMatrix/filament-releases` from the run's artifact |
| The arm64 server job sits at `Waiting for a runner to pick up this job` | The repository has no runner by `ARM64_RUNNER`'s name (or `ubuntu-22.04-arm`), or its plan's minutes are spent | Cancel the run, then set `ARM64_RUNNER` to a runner it has, or `SERVER_ARM64` to `off`, and run it again (section 6) |
| The arm64 server job fails: `This runner has glibc …` | `ARM64_RUNNER` names a runner on another system than Ubuntu 22.04 | Name an Ubuntu 22.04 arm64 runner |

## 9. The Mac App Store

The app already handles a Mac App Store build: a build from the Store sends its updates through the Store and never
downloads anything itself. But a Store build must run in Apple's App Sandbox, which shuts an app inside its own
container. Filament runs shells, starts coding agents and works in any folder you point it at, and the sandbox forbids
all three. A Store version would need a separate, sandboxed build with less in it. Until then, Filament is distributed
outside the Store, signed and notarized, as most developer tools are.

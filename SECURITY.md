# Security

Filament runs commands, edits files and holds your providers' keys, so a security problem in it matters. Thank you for
taking the time to report one.

## How to report

Please report it privately, not in a public issue:

- **On GitHub:** this repository's **Security** tab › **Report a vulnerability**.
- **By email:** hello@filamentdev.com, with "Security" in the subject.

Say what you found, the version (Settings › About, or `filament --version`), your system, and the steps that show it.
A proof of concept helps. You will get an answer as soon as we can give one, and word when a fix ships.

## What counts

- The desktop app, the server and the command line built from this repository.
- The install script (`scripts/install.sh`, served at filamentdev.com/install.sh) and the update check.
- Anything that lets a page, a model's output, a file in a project or another machine run code, read files or reach
  keys it should not.

Fixes go into the newest release; installed apps update themselves. Please don't test against other people's
machines or accounts.

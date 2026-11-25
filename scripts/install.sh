#!/bin/sh
# Filament for servers, in one command — no root, everything the user's (a release's asset beside the tarball):
#   curl -fsSL https://github.com/invertibleMatrix/filament/releases/latest/download/install.sh | sh
# It reads the newest release's latest-server.yml (latest-server-arm64.yml on arm64, latest-server-darwin-arm64.yml on a
# Mac with Apple silicon), downloads the tarball it names for this machine (scripts/dist-server.mjs makes both, on each
# machine), checks the download's SHA-512 against it, and unpacks it to ~/.local/share/filament/<version>
# ($XDG_DATA_HOME/filament where that is set): `current` there points at the version that runs, and ~/.local/bin/filament
# is its command line. A Mac's goes in the same folders, and its desktop app, where it has one, is said.
# Run again, it installs a newer release beside, keeps the one before for a roll back and removes older ones; the same
# version changes nothing. A pipe takes no flags, so it reads its options from the environment:
#   FILAMENT_VERSION=1.2.3   that release, not the newest — one installed already is pointed at again, not downloaded
#   FILAMENT_NO_ENGINE=1     the small tarball without the memory engine, where the release publishes one
#   FILAMENT_RELEASES_URL=…  where the releases are, for a mirror (GitHub's of invertibleMatrix/filament otherwise)
# POSIX sh (dash, busybox ash): everything is in functions run by the last line, so a download cut short runs nothing.
set -eu

RELEASES=https://github.com/invertibleMatrix/filament/releases
MARKER=build-info.json

work=""
made_base=""
swapping=""
placed=""
made_bin=""
made_link=""
was=""

say() { printf '%s\n' "$*"; }
refuse() {
  printf '%s\n' "$*" >&2
  exit 1
}
has() { command -v "$1" >/dev/null 2>&1; }

# A folder's path without the slashes it ends in: one folder, one spelling (/ is the empty one).
unslashed() {
  p=$1
  while [ "${p%/}" != "$p" ]; do p=${p%/}; done
  printf '%s' "$p"
}

# The first folder of the path `$1`, it or one above, that is not there (the first mkdir -p makes), or none.
first_missing() {
  [ ! -d "$1" ] || return 0
  m=$1
  while [ -n "${m%/*}" ] && [ ! -d "${m%/*}" ]; do m=${m%/*}; done
  printf '%s' "$m"
}

# The folder `$1` and those above it removed while they are empty, up to `$2`, the first a run made (with none, none).
unmake() {
  d=$1
  while [ -n "$2" ] && rmdir "$d" 2>/dev/null && [ "$d" != "$2" ]; do d=${d%/*}; done
}

# A run that ends while it swaps, undone: the command it made taken out, with the folders made for it, current as it
# was, and the version's folder it put in taken out, with the build that was there back. Fails where one could not be.
put_back() {
  ok=0
  rm -f "$base/current.new-$$" "$bindir/filament.new-$$"
  if [ -n "$made_link" ] && [ -L "$bindir/filament" ]; then rm -f "$bindir/filament" || ok=1; fi
  unmake "$bindir" "$made_bin"
  if [ -z "$was" ]; then
    rm -f "$base/current" || ok=1
  elif [ "$(readlink "$base/current" 2>/dev/null)" != "$was" ]; then
    point "$was" "$base/current" || ok=1
  fi
  if [ -n "$placed" ] && { [ -e "$dir" ] || [ -L "$dir" ]; }; then mv "$dir" "$work/new" || ok=1; fi
  if [ -n "$work" ] && { [ -e "$work/old" ] || [ -L "$work/old" ]; }; then
    if [ -e "$dir" ] || [ -L "$dir" ]; then ok=1; else mv "$work/old" "$dir" || ok=1; fi
  fi
  return "$ok"
}

# The folder made for this run gone however it ends, and the folders it made for Filament's while they are empty, up to
# the first it made (`made_base`). One that ends while it swaps is undone first, and says so; the build a version's
# folder held before stays in the run's folder where it could not go back.
cleanup() {
  s=$?
  set +e
  if [ -n "$swapping" ]; then
    if put_back; then
      say "Filament $version could not be put in place, so this run is undone: nothing was installed, and $base and $bindir/filament are as they were." >&2
    else
      say "Filament $version could not be put in place, nor this run all undone: look at $base/current and $bindir/filament before Filament runs again." >&2
      if [ -n "$work" ] && { [ -e "$work/old" ] || [ -L "$work/old" ]; }; then
        say "The build $dir held before is kept in $work/old." >&2
        work=""
      fi
    fi
  fi
  [ -z "$work" ] || rm -rf "$work"
  unmake "$base" "$made_base"
  exit "$s"
}

# A version as a folder's name: digits first, three parts, nothing a path could climb out by.
is_version() {
  case $1 in
    '' | *[!0-9A-Za-z.+-]* | [!0-9]*) return 1 ;;
    [0-9]*.[0-9]*.[0-9]*) return 0 ;;
  esac
  return 1
}

# A yml value: the text after its key's colon, without the spaces around it or its quotes.
value() {
  v=$1
  v=${v#"${v%%[! ]*}"}
  v=${v%"${v##*[! ]}"}
  case $v in
    \'*\' | \"*\")
      v=${v#?}
      v=${v%?}
      ;;
  esac
  printf '%s' "$v"
}

# The url or file `$1` into the file `$2` (- for what it prints).
fetch() {
  if has curl; then curl -fsSL --retry 2 -o "$2" "$1" </dev/null; else wget -q -O "$2" "$1" </dev/null; fi
}

# The SHA-512 the update file gives the file `$1` — its `files` entry, or the older path/sha512 pair — or none.
sha_of() {
  while read -r u s; do
    if [ "$u" = "$1" ]; then
      printf '%s' "$s"
      return 0
    fi
  done <<EOF
$pairs
EOF
  if [ "$path" = "$1" ] && [ -n "$top_sha" ]; then
    printf '%s' "$top_sha"
    return 0
  fi
  return 1
}

# A file's SHA-512 in hex, by sha512sum or openssl.
hex_of_file() {
  if has sha512sum; then
    out=$(sha512sum <"$1")
    printf '%s' "${out%% *}"
  else
    out=$(openssl dgst -sha512 <"$1")
    printf '%s' "${out##* }"
  fi
}

# A base64 SHA-512, as the yml gives it, in hex. A base64 that decodes with -D alone (macOS's before 13) gives nothing
# to -d: it is asked again so.
hex_of_base64() {
  out=$(printf '%s' "$1" | base64 -d 2>/dev/null | od -An -v -tx1) || out=""
  [ -n "$out" ] || out=$(printf '%s' "$1" | base64 -D | od -An -v -tx1)
  hex=""
  for byte in $out; do hex=$hex$byte; done
  printf '%s' "$hex"
}

# This machine's glibc, as major.minor, by getconf or else ldd's first line; none where the C library is another
# (Alpine's musl), on which Filament's own Node does not run.
glibc_here() {
  v=$(getconf GNU_LIBC_VERSION 2>/dev/null </dev/null) || v=""
  case $v in
    glibc\ *) v=${v#glibc } ;;
    *)
      v=""
      first=$(ldd --version 2>&1 </dev/null | {
        IFS= read -r l || true
        printf '%s' "$l"
      }) || first=""
      case $first in *GLIBC* | *"GNU libc"*) v=${first##* } ;; esac
      ;;
  esac
  case $v in [0-9]*.[0-9]*) printf '%s' "$v" ;; esac
}

# Whether the version `$1` (a glibc's, or macOS's) is older than `$2`, each major.minor (a third part is left out).
older() {
  a=${1%%.*} b=${1#*.} c=${2%%.*} d=${2#*.}
  b=${b%%.*} d=${d%%.*}
  [ "$a" -lt "$c" ] || { [ "$a" -eq "$c" ] && [ "$b" -lt "$d" ]; }
}

# The glibc a build's build-info.json says it was built on (dist-server.mjs's `glibc`), or none.
glibc_built() {
  while IFS= read -r l; do
    case $l in *'"glibc": "'*)
      l=${l#*'"glibc": "'}
      printf '%s' "${l%%\"*}"
      return 0
      ;;
    esac
  done <"$1/$MARKER"
}

# Whether the folder `$1` is the build of the tarball `$2`: its build-info.json names that file.
built_from() {
  [ -x "$1/bin/filament" ] || return 1
  [ -f "$1/$MARKER" ] || return 1
  while IFS= read -r l; do
    case $l in *"\"file\": \"$2\""*) return 0 ;; esac
  done <"$1/$MARKER"
  return 1
}

# The link `$2` made to point at `$1` in one rename, where mv -T is there (a Mac's mv says it -h, which GNU's refuses);
# busybox's without either, removed and made again. A new link that cannot be made leaves the one there as it is,
# cleanup's put_back too.
point() {
  rm -f "$2.new-$$"
  ln -s "$1" "$2.new-$$" || return 1
  if ! mv -T "$2.new-$$" "$2" 2>/dev/null && ! mv -h "$2.new-$$" "$2" 2>/dev/null; then
    rm -f "$2"
    mv "$2.new-$$" "$2"
  fi
}

# current pointed from the version `$before` to `$version`: every version folder but those two removed — a folder named
# as a version that holds a server build's build-info.json. With no version before, or the same one, there is none older.
prune() {
  if [ -z "$before" ] || [ "$before" = "$version" ]; then return 0; fi
  for d in "$base"/*; do
    n=${d##*/}
    if [ "$n" != "$version" ] && [ "$n" != "$before" ] && [ -d "$d" ] && [ ! -L "$d" ] && is_version "$n" && [ -f "$d/$MARKER" ]; then
      rm -rf "$d"
      say "Removed Filament $n, not one of the two kept ($d)."
    fi
  done
}

# ~/.local/bin/filament, a link to current/bin/filament (the launcher follows it): a file of the user's there is left,
# and so is a link of theirs to anything else, pointing nowhere too.
link_command() {
  run=$base/current/bin/filament
  linked=""
  runs_as=$bindir/filament
  if [ -L "$bindir/filament" ]; then
    to=$(readlink "$bindir/filament")
    if [ "$to" = "$run" ]; then return 0; fi
    say "$bindir/filament is a link of yours, to $to, not to Filament: it is left as it is, and Filament runs as $run."
    runs_as=$run
    return 0
  fi
  if [ -e "$bindir/filament" ]; then
    say "$bindir/filament is a file of yours, not a link to Filament: it is left as it is, and Filament runs as $run."
    runs_as=$run
    return 0
  fi
  made_bin=$(first_missing "$bindir")
  mkdir -p "$bindir"
  made_link=1
  point "$run" "$bindir/filament"
  linked=1
}

# The command made where it is not there, then current pointed at the version — one rename, after which it runs. Until
# then the run swaps (`swapping`, which the caller sets): one that ends before is undone by cleanup.
swap() {
  link_command
  if [ "$before" != "$version" ]; then point "$version" "$base/current"; fi
  swapping=""
}

# The version, where it is, and what to run next. ~/.local/bin is put on the PATH by the file the login shell reads:
# zsh's (a Mac's own), bash's where the person has one (bash reads no ~/.profile then), else ~/.profile.
done_with() {
  if [ "$runs_as" = "$bindir/filament" ]; then
    case ":${PATH:-}:" in
      *":$bindir:"* | *":$bindir/:"*) runs_as=filament ;;
      *)
        rc='~/.profile'
        case ${SHELL:-} in
          */zsh) rc='~/.zprofile' ;;
          */bash) [ ! -f "$home/.bash_profile" ] || rc='~/.bash_profile' ;;
        esac
        say "$bindir is not on your PATH: add it to run Filament as filament - echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> $rc, then open a new shell."
        ;;
    esac
  fi
  say "$1"
  # The app and Filament for servers keep one data folder (~/.config/filament) and one port: one of them runs at a time.
  if [ -n "$app" ]; then say "Filament's desktop app is on this Mac too ($app): it and Filament for servers share one data folder and port, so one of them runs at a time."; fi
  say "Next: $runs_as setup"
}

main() {
  os=$(uname -s 2>/dev/null || echo unknown)
  arch=$(uname -m 2>/dev/null || echo unknown)
  # Each machine's tarballs and their update file: x64's latest-server.yml, arm64's and a Mac's beside it.
  target=""
  case $os in
    Linux)
      case $arch in
        x86_64) target=linux-x64 FEED=latest-server.yml ;;
        aarch64 | arm64) target=linux-arm64 FEED=latest-server-arm64.yml ;;
      esac
      ;;
    Darwin)
      # A terminal under Rosetta says x86_64 on Apple silicon: the Mac's own chip is asked.
      if [ "$arch" = arm64 ] || [ "$(sysctl -n hw.optional.arm64 2>/dev/null </dev/null)" = 1 ]; then
        target=darwin-arm64 FEED=latest-server-darwin-arm64.yml
      else
        refuse "Filament for servers runs on a Mac with Apple silicon, and this Mac's chip is Intel's ($arch): nothing was installed."
      fi
      ;;
  esac
  if [ -z "$target" ]; then
    refuse "Filament for servers is built for Linux on x86_64 and on arm64 (aarch64), and for a Mac with Apple silicon, and this machine is $os on $arch: nothing was installed. On Windows, install the desktop app, or Filament for Windows hosts in PowerShell: irm $RELEASES/latest/download/install.ps1 | iex"
  fi
  # A 64-bit kernel can run 32-bit programs alone (Raspberry Pi OS's 32-bit release on a Pi's arm64 kernel): Filament's
  # Node would not start there.
  bits=$(getconf LONG_BIT 2>/dev/null </dev/null) || bits=""
  [ "$bits" != 32 ] || refuse "Filament for servers runs 64-bit programs, and this machine's are 32-bit, on its $arch kernel: nothing was installed. Its system's 64-bit release runs it."
  missing=""
  has curl || has wget || missing="$missing, curl or wget"
  for t in tar gzip; do has "$t" || missing="$missing, $t"; done
  has sha512sum || has openssl || missing="$missing, sha512sum or openssl"
  for t in base64 od mktemp readlink ln; do has "$t" || missing="$missing, $t"; done
  [ -z "$missing" ] || refuse "Filament's installer needs ${missing#, }, which this machine does not have: install them with its package manager and run it again. Nothing was installed."
  [ -n "${HOME:-}" ] || refuse "HOME is not set: Filament installs into the user's own folder, and there is none to install into."
  app=""
  if [ "$os" = Darwin ]; then
    # Node's own Mac builds need macOS 13.5 or newer.
    mac=$(sw_vers -productVersion 2>/dev/null </dev/null) || mac=""
    case $mac in
      *.*) ;;
      [0-9]*) mac=$mac.0 ;;
    esac
    case $mac in
      [0-9]*.[0-9]*) if older "$mac" 13.5; then refuse "Filament for servers needs macOS 13.5 or newer, and this Mac runs $mac: nothing was installed."; fi ;;
    esac
  else
    # Node's own Linux builds need glibc 2.28 or newer.
    glibc=$(glibc_here)
    [ -n "$glibc" ] || refuse "Filament for servers runs on glibc, and this machine's C library is another (Alpine's musl?): nothing was installed. A Debian, Ubuntu, Fedora or RHEL server runs it."
    if older "$glibc" 2.28; then refuse "Filament for servers needs glibc 2.28 or newer, and this machine has $glibc: nothing was installed."; fi
  fi

  # HOME however many slashes it ends in: ~/.local/bin is the folder the PATH names, the command's link the same each run.
  home=$(unslashed "$HOME")
  case ${XDG_DATA_HOME:-} in
    /*) base=$(unslashed "$XDG_DATA_HOME")/filament ;;
    *) base=$home/.local/share/filament ;;
  esac
  bindir=$home/.local/bin
  # A Mac's desktop app, in either Applications folder, is said with what was installed.
  if [ "$os" = Darwin ]; then
    for a in /Applications/Filament.app "$home/Applications/Filament.app"; do
      if [ -z "$app" ] && [ -d "$a" ]; then app=$a; fi
    done
  fi
  case ${FILAMENT_NO_ENGINE:-} in
    '' | 0) engine=1 ;;
    *) engine=0 ;;
  esac
  releases=${FILAMENT_RELEASES_URL:-$RELEASES}
  releases=${releases%/}
  asked=${FILAMENT_VERSION:-}
  asked=${asked#v}
  if [ -n "$asked" ]; then
    is_version "$asked" || refuse "FILAMENT_VERSION=$FILAMENT_VERSION is no version: say one like 1.2.3."
    feed_url=$releases/download/v$asked/$FEED
  else
    feed_url=$releases/latest/download/$FEED
  fi

  yml=$(fetch "$feed_url" -) || refuse "Filament's releases gave no $FEED at $feed_url${asked:+ (is $asked a release of Filament for servers?)}: nothing was installed."
  version="" path="" top_sha="" pairs="" url=""
  cr=$(printf '\r')
  nl='
'
  while IFS= read -r line; do
    line=${line%"$cr"}
    case $line in
      version:*) version=$(value "${line#version:}") ;;
      path:*) path=$(value "${line#path:}") ;;
      sha512:*) top_sha=$(value "${line#sha512:}") ;;
      ' '*-*url:*) url=$(value "${line#*url:}") ;;
      ' '*sha512:*)
        if [ -n "$url" ]; then pairs="$pairs$url $(value "${line#*sha512:}")$nl"; fi
        url=""
        ;;
    esac
  done <<EOF
$yml
EOF
  is_version "$version" || refuse "$feed_url names no version Filament can install (version: ${version:-none}): nothing was installed."
  if [ -n "$asked" ] && [ "$version" != "$asked" ]; then
    refuse "$feed_url is for Filament $version, not $asked: nothing was installed."
  fi
  whole=filament-server-$version-$target.tar.gz
  small=filament-server-$version-$target-no-engine.tar.gz
  if [ "$engine" = 1 ]; then name=$whole; else name=$small; fi
  if ! sha=$(sha_of "$name"); then
    if [ "$engine" = 0 ]; then
      refuse "Filament $version is not published without its memory engine: its $FEED lists no $small. Leave FILAMENT_NO_ENGINE out for the whole one."
    elif sha_of "$small" >/dev/null; then
      refuse "Filament $version is published without its memory engine alone: run again with FILAMENT_NO_ENGINE=1 for $small."
    fi
    refuse "$feed_url lists no $whole: nothing was installed."
  fi
  case $sha in *[!A-Za-z0-9+/=]*) sha="" ;; esac
  [ "${#sha}" -eq 88 ] || refuse "$feed_url gives no SHA-512 for $name that can be read: nothing was installed."

  dir=$base/$version
  before=""
  if [ -L "$base/current" ]; then
    was=$(readlink "$base/current")
    before=${was##*/}
  elif [ -e "$base/current" ]; then
    refuse "$base/current is not the link Filament's installer makes: move it away and run it again."
  fi
  engine_words=""
  [ "$engine" = 1 ] || engine_words=", without its memory engine,"
  kept=""
  [ "$before" = "$version" ] || kept=$before

  trap cleanup EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if built_from "$dir" "$name"; then
    swapping=1
    swap
    if [ "$before" = "$version" ]; then
      if [ -n "$linked" ]; then
        done_with "Filament $version$engine_words is installed already, in $dir: $bindir/filament points at it again."
      else
        done_with "Filament $version$engine_words is installed already, in $dir: nothing changed."
      fi
      return 0
    fi
    prune
    done_with "Filament $version$engine_words was installed already, in $dir: current points at it now${kept:+, and $kept is kept beside it for a roll back}."
    return 0
  fi

  made_base=$(first_missing "$base")
  mkdir -p "$base"
  work=$(mktemp -d "$base/.install-XXXXXX")
  say "Downloading Filament $version ($name)..."
  fetch "$releases/download/v$version/$name" "$work/$name" || refuse "$name could not be downloaded from $releases/download/v$version: nothing was installed."
  if [ "$(hex_of_file "$work/$name")" != "$(hex_of_base64 "$sha")" ]; then
    refuse "The download of $name is not the file $FEED describes: its SHA-512 differs. Nothing was installed; run it again, and if it says so again, the release or a mirror on the way is damaged."
  fi
  mkdir "$work/unpack"
  tar -xzf "$work/$name" -C "$work/unpack" </dev/null || refuse "$name could not be unpacked into $work: nothing was installed."
  rm -f "$work/$name"
  top=${name%.tar.gz}
  [ -x "$work/unpack/$top/bin/filament" ] || refuse "$name holds no $top/bin/filament to run: nothing was installed."
  # Its build-info.json is how a run knows a version installed and one to remove, and `filament update` the build.
  [ -f "$work/unpack/$top/$MARKER" ] || refuse "$name holds no $top/$MARKER, so it is no build of Filament for servers: nothing was installed."
  # node-pty binds to the glibc it was built on: Filament runs on an older one, its terminals don't. A Mac has none.
  if [ "$os" = Linux ]; then
    built=$(glibc_built "$work/unpack/$top")
    case $built in
      [0-9]*.[0-9]*) if older "$glibc" "$built"; then say "This machine has glibc $glibc, older than the $built Filament $version was built on: Filament runs, but its terminals don't open here."; fi ;;
    esac
  fi
  # The version's folder comes in by one rename, from beside it: a half one is never at its path. One there that is
  # not this build (the other tarball of the version, or one damaged) goes back if the run fails before current is
  # swapped, as does all it changed (cleanup); the versions but the two kept are removed after.
  swapping=1
  if [ -e "$dir" ] || [ -L "$dir" ]; then mv "$dir" "$work/old"; fi
  placed=1
  mv "$work/unpack/$top" "$dir"
  swap
  made_base=""
  prune
  done_with "Filament $version$engine_words is installed in $dir, and current points at it${kept:+; $kept is kept beside it for a roll back}."
}

main "$@"

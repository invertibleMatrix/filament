# Filament for a Windows host, in one command: no administrator, everything the user's (a release's asset beside the
# tarball):
#   irm https://github.com/invertibleMatrix/filament/releases/latest/download/install.ps1 | iex
# or, saved first: powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
# It reads the release's latest-server-win32-x64.yml, downloads the tarball it names (scripts/dist-server.mjs makes it on
# Windows x64), checks the download's SHA-512 against it, and unpacks it with Windows' own tar.exe to
# %LOCALAPPDATA%\filament\<version>: `current` there, a junction, points at the version that runs, and current\bin, with
# filament.cmd, goes on the user's PATH. Run again, it installs a newer release beside, keeps the one before for a roll
# back and removes the others; the same version changes nothing. Its options come from the environment, as install.sh's:
#   FILAMENT_VERSION=1.2.3     that release, not the newest; one installed already is pointed at again, not downloaded
#   FILAMENT_NO_ENGINE=1       the small tarball without the memory engine, where the release publishes one
#   FILAMENT_RELEASES_URL=...  where the releases are, for a mirror (GitHub's of invertibleMatrix/filament otherwise)
#   FILAMENT_NO_MODIFY_PATH=1  the user's PATH left as it is
# Written for Windows PowerShell 5.1 and PowerShell 7 alike. Everything is in one script block, run by its last line,
# so a download cut short runs nothing. How a run went is its exit code where the PowerShell ends with it (-File, or
# `powershell -c "irm ... | iex"` as a script or an SSH session runs it), as install.sh's under `curl | sh`; a PowerShell
# a person types in stays open, with $LASTEXITCODE saying it. Its text is ASCII alone: Windows PowerShell 5.1 reads a
# script without a BOM, and irm a download, in the system's code page.
& {
  Set-StrictMode -Version 2
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  # GitHub answers TLS 1.2 alone, which Windows PowerShell 5.1 does not offer by itself on every Windows.
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

  $Releases = 'https://github.com/invertibleMatrix/filament/releases'
  $Marker = 'build-info.json'
  $Target = 'win32-x64'
  $Feed = 'latest-server-win32-x64.yml'

  # What a run changed, for its undoing where it ends before it is done.
  $s = @{ work = ''; madeBase = $false; swapping = $false; placed = $false; was = ''; dir = ''; base = ''; version = '' }
  # The PATH this run started with: the one a PowerShell that ran it by -File goes on with.
  $pathAtStart = $env:Path

  # Words for the person, by the host: a console's stdout and stderr, and a remote session's (Enter-PSSession) too.
  function Say([string]$words) { $Host.UI.WriteLine($words) }
  function Err([string]$words) { $Host.UI.WriteErrorLine($words) }
  # A refusal: its words, thrown to the end, which says them and undoes what the run changed.
  function Refuse([string]$words) { throw [System.Exception]::new($words) }
  # An error's own words: what a .NET call said, without PowerShell's "Exception calling ..." around it.
  function Why($e) {
    $x = $e.Exception
    while ($x -is [Management.Automation.MethodInvocationException] -and $x.InnerException) { $x = $x.InnerException }
    return $x.Message
  }

  # Whether this PowerShell ends once this run does: started with -Command or -EncodedCommand and no -NoExit, as
  # `powershell -c "irm ... | iex"` is by a script, a provisioner or an SSH session. A console a person types in is not.
  function Ends {
    if ($Host.Name -ne 'ConsoleHost') { return $false }
    $shot = $false
    $stay = $false
    foreach ($a in @([Environment]::GetCommandLineArgs() | Select-Object -Skip 1)) {
      if ($a -notmatch '^(--?|/)([A-Za-z]+)$') { continue }
      $k = $Matches[2].ToLowerInvariant()
      if ($k.Length -ge 3 -and 'noexit'.StartsWith($k)) { $stay = $true }
      elseif ($k -eq 'ec' -or 'encodedcommand'.StartsWith($k)) { $shot = $true }
      # what follows -Command is the command
      elseif ('command'.StartsWith($k)) { $shot = $true; break }
    }
    return $shot -and -not $stay
  }

  # A version as a folder's name: digits first, three parts, nothing a path could climb out by, and no dot at its end
  # (Windows drops one from a folder's name, which would make it another version's).
  function IsVersion([string]$v) { return $v -match '^[0-9][0-9A-Za-z.+-]*$' -and $v -match '^[0-9]+\.[0-9]+\.[0-9]+' -and $v -match '[0-9A-Za-z]$' }

  # A yml value: the text after its key's colon, without the spaces around it or its quotes.
  function ValueOf([string]$v) {
    $v = $v.Trim()
    if ($v.Length -ge 2 -and (($v[0] -eq "'" -and $v[-1] -eq "'") -or ($v[0] -eq '"' -and $v[-1] -eq '"'))) { $v = $v.Substring(1, $v.Length - 2) }
    return $v
  }

  # Whether `$p` is a junction or a link: Windows' reparse point, which Remove-Item may follow and a rename may not.
  function IsLink([string]$p) {
    $i = Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
    return [bool]($i -and ($i.Attributes -band [IO.FileAttributes]::ReparsePoint))
  }
  # Where the junction `$p` points: its full path.
  function TargetOf([string]$p) {
    $t = (Get-Item -LiteralPath $p -Force).Target
    if ($t -is [array]) { $t = $t[0] }
    return [string]$t
  }
  # The junction itself taken away, never what it points at.
  function Unlink([string]$p) { [IO.Directory]::Delete($p, $false) }
  # A folder and all in it removed by cmd's rd, which takes a junction in it away and never follows it: Remove-Item
  # -Recurse follows one in Windows PowerShell 5.1 and empties the folder it points at, and .NET's recursive delete
  # refuses one.
  function DeleteTree([string]$p) {
    & (Join-Path $env:SystemRoot 'System32\cmd.exe') /d /c rd /s /q $p | Out-Null
    if (Test-Path -LiteralPath $p) { throw [System.Exception]::new("rd /s /q left $($p): a file in it is in use") }
  }
  # A folder renamed, tried again for a few seconds where Windows says it is in use: an antivirus looks at a new
  # node.exe as it lands. The last try's error where none works.
  function MoveDir([string]$from, [string]$to, [int]$tries = 10) {
    for ($i = 1; ; $i++) {
      try { [IO.Directory]::Move($from, $to); return } catch {
        if ($i -ge $tries -or -not (Test-Path -LiteralPath $from)) { throw }
        Start-Sleep -Milliseconds 300
      }
    }
  }
  # current pointed at the folder `$to` (a full path: a junction holds no other), as update.js's point: one made beside
  # it, the old one taken away, the new one renamed in its place, and the old one made again where it could not be.
  function Point([string]$to, [string]$link) {
    $next = "$link.new-$PID"
    if (IsLink $next) { Unlink $next }
    New-Item -ItemType Junction -Path $next -Value $to | Out-Null
    $before = if (IsLink $link) { TargetOf $link } else { '' }
    try {
      if ($before) { Unlink $link }
      [IO.Directory]::Move($next, $link)
    } catch {
      $why = Why $_
      try { if (IsLink $next) { Unlink $next } } catch {}
      if ($before -and -not (Test-Path -LiteralPath $link)) { New-Item -ItemType Junction -Path $link -Value $before | Out-Null }
      throw [System.Exception]::new($why)
    }
  }

  # Whether the folder `$d` is the build of the tarball `$name`: its build-info.json names that file.
  function BuiltFrom([string]$d, [string]$name) {
    if ((IsLink $d) -or -not (Test-Path -LiteralPath (Join-Path $d 'bin\filament.cmd'))) { return $false }
    $m = Join-Path $d $Marker
    if (-not (Test-Path -LiteralPath $m)) { return $false }
    return (Get-Content -LiteralPath $m -Raw) -match ('"file":\s*"' + [regex]::Escape($name) + '"')
  }

  # current moved from `$before` to `$version`: every version's folder but those two removed (a folder named as a
  # version that holds a server build's build-info.json). Each is renamed aside first: Windows renames no folder a
  # running Filament has a file open in, so one still running is kept whole, never half removed. What a run cut short
  # left aside goes too.
  function Prune([string]$base, [string]$version, [string]$before) {
    if (-not $before -or $before -eq $version) { return }
    foreach ($d in Get-ChildItem -LiteralPath $base -Directory -Force) {
      $n = $d.Name
      if ($n -match '^\.prune-[0-9a-f]{8}$' -and -not (IsLink $d.FullName)) { try { DeleteTree $d.FullName } catch {}; continue }
      if ($n -eq $version -or $n -eq $before -or -not (IsVersion $n) -or (IsLink $d.FullName) -or -not (Test-Path -LiteralPath (Join-Path $d.FullName $Marker))) { continue }
      $gone = Join-Path $base (".prune-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
      try { [IO.Directory]::Move($d.FullName, $gone) } catch {
        Say "Filament $n is kept, in use ($(Why $_)): a Filament still runs from it, or a program has a file in it open. An install of another version removes it."
        continue
      }
      try {
        DeleteTree $gone
        Say "Removed Filament $n, not one of the two kept ($($d.FullName))."
      } catch {
        Say "Filament $n could not be all removed ($(Why $_)): remove $gone by hand."
      }
    }
  }

  # The user's PATH (the registry's, its %variables% kept) with current\bin on it, once; this PowerShell's too. "" where
  # it is there already, else what was done, or what to do where it could not be.
  function OnPath([string]$bin) {
    $shown = '%LOCALAPPDATA%\filament\current\bin'
    try {
      $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
      if (-not $key) { $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment') }
      try {
        $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        $parts = @($raw -split ';' | Where-Object { $_ })
        $there = $parts | Where-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') -ieq $bin.TrimEnd('\') }
        if (-not $there) { $key.SetValue('Path', (@($parts) + $shown) -join ';', [Microsoft.Win32.RegistryValueKind]::ExpandString) }
      } finally { $key.Close() }
    } catch {
      return "Filament could not put $shown on your PATH ($(Why $_)): add it to your user PATH to run Filament as filament."
    }
    if (-not (@($env:Path -split ';') | Where-Object { $_.TrimEnd('\') -ieq $bin.TrimEnd('\') })) { $env:Path = "$env:Path;$bin" }
    if ($there) { return '' }
    # Programs started from now on read it: a variable set and taken away tells Windows' own the environment changed.
    try {
      [Environment]::SetEnvironmentVariable('FILAMENT_PATH_CHANGED', '1', 'User')
      [Environment]::SetEnvironmentVariable('FILAMENT_PATH_CHANGED', $null, 'User')
    } catch {}
    return "$shown is on your PATH now: a new window or SSH session runs Filament as filament."
  }

  # What to run next: by the name where the PowerShell the person goes on in finds this Filament first by it (this one,
  # run by iex, whose PATH OnPath changed too; else the one that ran it, with the PATH this run started with), else by
  # its path.
  function SayNext([string]$bin) {
    $now = $env:Path
    try {
      if ($PSCommandPath -or (Ends)) { $env:Path = $pathAtStart }
      $first = Get-Command filament -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    } finally { $env:Path = $now }
    if ($first -and ([IO.Path]::GetDirectoryName($first.Source)).TrimEnd('\') -ieq $bin.TrimEnd('\')) { Say 'Next: filament setup'; return }
    $runs = Join-Path $bin 'filament.cmd'
    if ($first) { Say "$($first.Source) comes first on your PATH, not this Filament: it runs as $runs." }
    Say "Next: `"$runs`" setup"
  }

  # A run that ends while it swaps, undone: current as it was, the version's folder it put in taken out, the build that
  # was there back. $false where any of it could not be.
  function PutBack {
    $ok = $true
    $link = Join-Path $s.base 'current'
    try {
      if (IsLink "$link.new-$PID") { Unlink "$link.new-$PID" }
      if (-not $s.was) { if (IsLink $link) { Unlink $link } }
      elseif (-not (IsLink $link) -or (TargetOf $link) -ne $s.was) { Point $s.was $link }
    } catch { $ok = $false }
    try {
      if ($s.placed -and (Test-Path -LiteralPath $s.dir)) { MoveDir $s.dir (Join-Path $s.work 'new') }
      if ($s.work -and (Test-Path -LiteralPath (Join-Path $s.work 'old'))) {
        if (Test-Path -LiteralPath $s.dir) { $ok = $false } else { MoveDir (Join-Path $s.work 'old') $s.dir }
      }
    } catch { $ok = $false }
    return $ok
  }

  function Main {
    if ((Get-Variable IsWindows -ErrorAction SilentlyContinue) -and -not $IsWindows) {
      Refuse "This is Filament's installer for Windows, and this machine is not Windows: install.sh installs Filament for servers on Linux ($Releases/latest/download/install.sh)."
    }
    $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    if ($arch -ne 'AMD64') { Refuse "Filament for Windows hosts is built for x64 (AMD64), and this machine is $($arch): nothing was installed. The Filament app runs here: $Releases/latest." }
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (-not (Test-Path -LiteralPath $tar)) { Refuse "Filament's installer unpacks with Windows' own tar.exe, which this Windows does not have (Windows 10 1803 and Windows Server 2019 have it, and newer): nothing was installed." }
    if (-not $env:LOCALAPPDATA) { Refuse 'LOCALAPPDATA is not set: Filament installs into the user''s own folder, and there is none to install into.' }

    $base = Join-Path $env:LOCALAPPDATA 'filament'
    $s.base = $base
    $bin = Join-Path $base 'current\bin'
    $engine = -not ($env:FILAMENT_NO_ENGINE -and $env:FILAMENT_NO_ENGINE -ne '0')
    $modifyPath = -not ($env:FILAMENT_NO_MODIFY_PATH -and $env:FILAMENT_NO_MODIFY_PATH -ne '0')
    $releases = if ($env:FILAMENT_RELEASES_URL) { $env:FILAMENT_RELEASES_URL.TrimEnd('/') } else { $Releases }
    $asked = if ($env:FILAMENT_VERSION) { $env:FILAMENT_VERSION -replace '^v', '' } else { '' }
    if ($asked) {
      if (-not (IsVersion $asked)) { Refuse "FILAMENT_VERSION=$($env:FILAMENT_VERSION) is no version: say one like 1.2.3." }
      $feedUrl = "$releases/download/v$asked/$Feed"
    } else {
      $feedUrl = "$releases/latest/download/$Feed"
    }

    $web = New-Object Net.WebClient
    try { $yml = $web.DownloadString($feedUrl) } catch {
      Refuse "Filament's releases gave no $Feed at $feedUrl ($(Why $_)): nothing was installed.$(if ($asked) { " Is $asked a release of Filament for Windows hosts?" })"
    }
    $version = ''; $path = ''; $topSha = ''; $url = ''
    $pairs = @{}
    foreach ($line in ($yml -split "`n")) {
      $line = $line.TrimEnd("`r")
      if ($line -match '^version:(.*)$') { $version = ValueOf $Matches[1] }
      elseif ($line -match '^path:(.*)$') { $path = ValueOf $Matches[1] }
      elseif ($line -match '^sha512:(.*)$') { $topSha = ValueOf $Matches[1] }
      elseif ($line -match '^\s+-\s*url:(.*)$') { $url = ValueOf $Matches[1] }
      elseif ($line -match '^\s+sha512:(.*)$') { if ($url) { $pairs[$url] = ValueOf $Matches[1] }; $url = '' }
    }
    if (-not (IsVersion $version)) { Refuse "$feedUrl names no version Filament can install (version: $(if ($version) { $version } else { 'none' })): nothing was installed." }
    if ($asked -and $version -ne $asked) { Refuse "$feedUrl is for Filament $version, not $($asked): nothing was installed." }
    $s.version = $version
    $whole = "filament-server-$version-$Target.tar.gz"
    $small = "filament-server-$version-$Target-no-engine.tar.gz"
    $name = if ($engine) { $whole } else { $small }
    $shaOf = { param($n) if ($pairs.ContainsKey($n)) { $pairs[$n] } elseif ($path -eq $n -and $topSha) { $topSha } else { $null } }
    $sha = & $shaOf $name
    if (-not $sha) {
      if (-not $engine) { Refuse "Filament $version is not published without its memory engine: its $Feed lists no $small. Leave FILAMENT_NO_ENGINE out for the whole one." }
      if (& $shaOf $small) { Refuse "Filament $version is published without its memory engine alone: run again with FILAMENT_NO_ENGINE=1 for $small." }
      Refuse "$feedUrl lists no $($whole): nothing was installed."
    }
    if ($sha -notmatch '^[A-Za-z0-9+/=]{88}$') { Refuse "$feedUrl gives no SHA-512 for $name that can be read: nothing was installed." }

    $dir = Join-Path $base $version
    $s.dir = $dir
    $current = Join-Path $base 'current'
    $before = ''
    if (IsLink $current) {
      $s.was = TargetOf $current
      $before = Split-Path -Leaf $s.was
    } elseif (Test-Path -LiteralPath $current) {
      Refuse "$current is not the junction Filament's installer makes: move it away and run it again."
    }
    # A junction at the version's own path is no build of this installer's, and moving it would carry what it points at.
    if (IsLink $dir) { Refuse "$dir is a junction or a link, not a folder Filament's installer made: move it away and run it again." }
    $engineWords = if ($engine) { '' } else { ', without its memory engine,' }
    $kept = if ($before -ne $version) { $before } else { '' }
    $keptWords = if ($kept) { ", and $kept is kept beside it for a roll back" } else { '' }

    if (BuiltFrom $dir $name) {
      $s.swapping = $true
      if ($before -ne $version) { Point $dir $current }
      $s.swapping = $false
      $pathWords = if ($modifyPath) { OnPath $bin } else { '' }
      if ($before -eq $version) { Say "Filament $version$engineWords is installed already, in $($dir): nothing changed." }
      else {
        Prune $base $version $before
        Say "Filament $version$engineWords was installed already, in $($dir): current points at it now$keptWords."
      }
      if ($pathWords) { Say $pathWords }
      SayNext $bin
      return
    }

    if (-not (Test-Path -LiteralPath $base)) {
      New-Item -ItemType Directory -Path $base | Out-Null
      $s.madeBase = $true
    }
    $work = Join-Path $base (".install-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $work | Out-Null
    $s.work = $work
    Say "Downloading Filament $version ($name)..."
    $file = Join-Path $work $name
    try { $web.DownloadFile("$releases/download/v$version/$name", $file) } catch {
      Refuse "$name could not be downloaded from $releases/download/v$version ($(Why $_)): nothing was installed."
    }
    $want = [BitConverter]::ToString([Convert]::FromBase64String($sha)).Replace('-', '')
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA512).Hash -ne $want) {
      Refuse "The download of $name is not the file $Feed describes: its SHA-512 differs. Nothing was installed; run it again, and if it says so again, the release or a mirror on the way is damaged."
    }
    $unpack = Join-Path $work 'unpack'
    New-Item -ItemType Directory -Path $unpack | Out-Null
    # Its stderr not redirected: Windows PowerShell 5.1 makes a redirected line of a program's an error that stops the run.
    & $tar -xzf $file -C $unpack | Out-Null
    if ($LASTEXITCODE -ne 0) { Refuse "$name could not be unpacked into $work (tar.exe's exit code $LASTEXITCODE): nothing was installed." }
    Remove-Item -LiteralPath $file -Force
    $top = Join-Path $unpack ($name -replace '\.tar\.gz$', '')
    if (-not (Test-Path -LiteralPath (Join-Path $top 'bin\filament.cmd'))) { Refuse "$name holds no bin\filament.cmd to run: nothing was installed." }
    # Its build-info.json is how a run knows a version installed and one to remove, and `filament update` the build.
    if (-not (Test-Path -LiteralPath (Join-Path $top $Marker))) { Refuse "$name holds no $Marker, so it is no build of Filament for Windows hosts: nothing was installed." }
    # The version's folder comes in by one rename, from beside it: a half one is never at its path. One there that is
    # not this build goes back if the run fails before current is pointed at it, as does all it changed.
    $s.swapping = $true
    if (Test-Path -LiteralPath $dir) {
      try { MoveDir $dir (Join-Path $work 'old') } catch {
        Refuse "$dir is in use ($(Why $_)): a Filament still runs from it, or a program has a file in it open. Stop it (filament stop) and run this again."
      }
    }
    $s.placed = $true
    MoveDir $top $dir
    Point $dir $current
    $s.swapping = $false
    $s.madeBase = $false
    Prune $base $version $before
    $pathWords = if ($modifyPath) { OnPath $bin } else { '' }
    Say "Filament $version$engineWords is installed in $dir, and current points at it$(if ($kept) { "; $kept is kept beside it for a roll back" })."
    if ($pathWords) { Say $pathWords }
    SayNext $bin
  }

  $code = 0
  try { Main } catch {
    $code = 1
    Err (Why $_)
  } finally {
    # A run that ends while it swaps is undone here: one stopped by Ctrl+C too, which no catch sees.
    if ($s.swapping) {
      $code = 1
      $link = Join-Path $s.base 'current'
      if (PutBack) { Err "Filament $($s.version) could not be put in place, so this run is undone: nothing was installed, and $($s.base) is as it was." }
      else {
        Err "Filament $($s.version) could not be put in place, nor this run all undone: look at $link before Filament runs again$(if ($s.was) { " (it is to be a junction at $($s.was))" })."
        if ($s.work -and (Test-Path -LiteralPath (Join-Path $s.work 'old'))) {
          Err "The build $($s.dir) held before is kept in $(Join-Path $s.work 'old')."
          $s.work = ''
        }
      }
    }
    if ($s.work -and (Test-Path -LiteralPath $s.work)) { try { DeleteTree $s.work } catch {} }
    if ($s.madeBase -and (Test-Path -LiteralPath $s.base) -and -not (Get-ChildItem -LiteralPath $s.base -Force)) { Remove-Item -LiteralPath $s.base -Force -ErrorAction SilentlyContinue }
  }
  # Its exit code says how it went where the PowerShell ends with it (-File, or a one-shot -Command); a PowerShell that
  # goes on stays open, with $LASTEXITCODE saying it.
  $global:LASTEXITCODE = $code
  if ($code -and ($PSCommandPath -or (Ends))) { exit $code }
}

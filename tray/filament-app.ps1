# Filament app window: the harness in a Chromium "app" window (Edge or Chrome, whichever is installed) - its own
# taskbar entry and window, no address bar or tabs, its own browser profile under the Filament data folder so nothing
# it stores mixes with your everyday browsing. It is the same page the browser tab shows, served by the same server:
# a fix in the tree is live in this window on the next reload (Ctrl+R / F5), nothing is packaged or copied. The window
# opens at a one-time link `filament open` makes, which pairs it as this computer's own (Filament's owner key), at
# Filament's own name under localhost.
# Windows PowerShell 5.1, no dependencies. Run with:
#   powershell -NoProfile -ExecutionPolicy Bypass -File filament-app.ps1
# Options: -Page ui/harness.html   the page to open, once paired (default: the harness; "/" is the console; a full
#                                  address opens as given, unpaired)
#          -Browser edge|chrome    prefer one; default: Edge, then Chrome, then whichever is found
#          -SharedProfile          use the browser's normal profile instead of the dedicated one
#          -NoStart                do not start the server when it is not running; wait for it instead
#          -WaitSeconds 180        how long to wait for it to answer before giving up with no window
param([string]$Page = "ui/harness.html", [string]$Browser = "", [switch]$SharedProfile, [switch]$NoStart, [int]$WaitSeconds = 180)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
# The folder and port the server picks (src/services/config/store.js): from a git checkout, Filament-dev on 20301, so it
# runs beside the installed app and never opens its data; else Filament on 20300. The config's port wins either way.
$devDir = Join-Path $env:APPDATA "Filament-dev"
$dataDir = if ($env:FILAMENT_DATA_DIR) { $env:FILAMENT_DATA_DIR } elseif (Test-Path (Join-Path $root ".git")) { $devDir } else { Join-Path $env:APPDATA "Filament" }
# A folder is known by its full path, its case aside, as the server knows it (store.js `defaultPort`): one named with a
# trailing slash, in another case or relative to here is still the dev folder.
function Full-Path([string]$p) { try { [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($p)).TrimEnd('\', '/') } catch { $p } }
$dataDir = Full-Path $dataDir
$port = if ($dataDir.ToLowerInvariant() -eq (Full-Path $devDir).ToLowerInvariant()) { 20301 } else { 20300 }
try { $cfg = Get-Content (Join-Path $dataDir "config.json") -Raw | ConvertFrom-Json; if ($cfg.server.port) { $port = [int]$cfg.server.port } } catch {}
# Where a Filament of this folder says it listens wins, as the command line reads it (src/cli/client.js): one started
# with --port, or on any free port, answers nowhere else.
try { $l = Get-Content (Join-Path $dataDir "listening.json") -Raw | ConvertFrom-Json; if ($l.port) { $listens = [int]$l.port; try { $null = Invoke-RestMethod -Uri "http://127.0.0.1:$listens/health" -TimeoutSec 1; $port = $listens } catch {} } } catch {}
$base = "http://127.0.0.1:$port"
$path = $Page.TrimStart('/')
$url = if ($Page -match '^https?://') { $Page } else { "$base/$path" }

function Find-Browser([string]$prefer) {
  $edge = @("$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe")
  $chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
  foreach ($exe in @("msedge.exe", "chrome.exe")) {
    try { $p = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$exe" -ErrorAction Stop).'(default)'; if ($p -and (Test-Path $p)) { if ($exe -eq "msedge.exe") { $edge = @($p) + $edge } else { $chrome = @($p) + $chrome } } } catch {}
  }
  $order = switch ($prefer.ToLower()) { "chrome" { @($chrome, $edge) } default { @($edge, $chrome) } }
  foreach ($list in $order) { foreach ($c in $list) { if ($c -and (Test-Path $c)) { return $c } } }
  return $null
}
# /health answers without the owner key: /api/state refuses a caller with none, which read as no Filament and started a
# second one beside it.
function Test-Server { try { $null = Invoke-RestMethod -Uri "$base/health" -TimeoutSec 1; return $true } catch { return $false } }

$browser = Find-Browser $Browser
if (-not $browser) { [Console]::Error.WriteLine("no Edge or Chrome found - the app window needs one (Firefox has no app mode); run ``node bin/filament.js open`` for a browser tab instead"); exit 2 }

$node = $null; try { $node = (Get-Command node -ErrorAction Stop).Source } catch { foreach ($c in @("$env:ProgramFiles\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) { if (Test-Path $c) { $node = $c; break } } }
if (-not (Test-Server)) {
  # A Filament of this folder still opening holds its start lock (src/cli/listening.js START_LOCK) before it answers:
  # waited for, never started beside (a second would be refused all the same).
  $other = 0; try { $l = Get-Content (Join-Path $dataDir "filament.lock") -Raw | ConvertFrom-Json; if ($l.pid -and (Get-Process -Id ([int]$l.pid) -ErrorAction Stop)) { $other = [int]$l.pid } } catch {}
  if ($other) { Write-Host "a Filament of this data folder is starting (pid $other) - waiting for it" }
  elseif (-not $NoStart) {
    if ($node) {
      Write-Host "Filament is not running on port $port - starting it"
      Start-Process -FilePath $node -ArgumentList "`"$(Join-Path $root 'bin\filament.js')`"", "--data-dir", "`"$dataDir`"" -WorkingDirectory $root -WindowStyle Hidden | Out-Null
    } else { Write-Host "Filament is not running on port $port and node was not found - waiting for it" }
  } else { Write-Host "Filament is not running on port $port - waiting up to $WaitSeconds s" }
  # Its first start installs memory's engine and opens memory before it listens: a minute or more is no failure. A line
  # every ten seconds says it is still waited for.
  $started = Get-Date
  $deadline = $started.AddSeconds($WaitSeconds)
  $told = 0
  while (-not (Test-Server) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 400
    $s = [int]((Get-Date) - $started).TotalSeconds
    if ($s -ge $told + 10) { $told = $s - ($s % 10); Write-Host "still waiting for Filament to answer ($told s)" }
  }
  # A window opened at 127.0.0.1 with no link is the pairing page under the owner key, and stays it: none opens.
  if (-not (Test-Server)) { [Console]::Error.WriteLine("Filament did not answer on port $port within $WaitSeconds s, so no window was opened: run this again once it answers (node bin/filament.js status says how it stands)"); exit 1 }
}

# A window at 127.0.0.1 is no one's under the owner key (server.loopbackTrust "token"): the link `filament open --no-open`
# makes pairs it as this computer's own, at Filament's own name under localhost, where its profile keeps the pairing. A
# window paired already goes straight on, and the link's code runs out unused in five minutes. -Page rides on the link
# (`&to=`, src/ui/pair.js `goesTo`).
$link = $null
if ($Page -notmatch '^https?://' -and (Test-Server)) {
  if ($node) {
    $words = @(if ($path -eq "") { "console" })
    Write-Host "asking Filament for this window's pairing link (while Filament opens its memory, this waits up to 30 s)"
    # Its stderr is the command line's words, never an error of this script's: a redirected stderr (an agent's shell)
    # would otherwise stop the call under "Stop" and lose the link. Its output read as the UTF-8 it is.
    $enc = [Console]::OutputEncoding
    $said = @(& {
      $ErrorActionPreference = "Continue"
      try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
      & $node (Join-Path $root "bin\filament.js") --data-dir $dataDir open --no-open @words
    })
    try { [Console]::OutputEncoding = $enc } catch {}
    $link = $said | Where-Object { $_ -is [string] -and $_ -match '^https?://\S+/ui/pair\.html#code=' } | Select-Object -First 1
    if ($link) { $url = if ($path -ne "" -and $path -ne "ui/harness.html") { "$link&to=$([Uri]::EscapeDataString("/$path"))" } else { $link } }
    else { $said | ForEach-Object { Write-Host $_ } }
  } else { Write-Host "node was not found, so no pairing link was made for this window" }
  # No link (the Filament app holds the key, or the command line failed): the page at Filament's own name, where a
  # window paired already goes straight on, and one not yet paired types a code there, which pairs it at that name.
  if (-not $link) {
    # (PowerShell's names know no case: $Page is the option.)
    $ownName = ""; try { $ownName = [string](Get-Content (Join-Path $dataDir "machine.json") -Raw | ConvertFrom-Json).page } catch {}
    if ($ownName -match '^filament-[0-9a-f]{12}$') { $url = "http://$ownName.localhost:$port/$path" }
  }
}

$argList = @("--app=$url", "--no-first-run", "--no-default-browser-check", "--window-size=1480,940")
$profileDir = ""
if (-not $SharedProfile) {
  $profileDir = Join-Path $dataDir "app-profile"
  if (-not (Test-Path $profileDir)) { New-Item -ItemType Directory -Path $profileDir -Force | Out-Null }
  $argList += "`"--user-data-dir=$profileDir`""
}
Start-Process -FilePath $browser -ArgumentList $argList | Out-Null
# Filament's own name is said to no one (services/machine.js): a program that knew it could be sent the window's sign-in.
$shown = if ($url -match '^http://filament-[0-9a-f]{12}\.localhost') { "/$path at Filament's own name (port $port)" } else { $url -replace '#.*$', '' }
Write-Host "opened $shown in $([IO.Path]::GetFileNameWithoutExtension($browser)) app mode$(if ($profileDir) { " (profile: $profileDir)" } else { '' })"

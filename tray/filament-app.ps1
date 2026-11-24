# Filament app window: the harness in a Chromium "app" window (Edge or Chrome, whichever is installed) - its own
# taskbar entry and window, no address bar or tabs, its own browser profile under the Filament data folder so nothing
# it stores mixes with your everyday browsing. It is the same page the browser tab shows, served by the same server:
# a fix in the tree is live in this window on the next reload (Ctrl+R / F5), nothing is packaged or copied. The window
# opens at a one-time link `filament open` makes, which pairs it as this computer's own (Filament's owner key).
# Windows PowerShell 5.1, no dependencies. Run with:
#   powershell -NoProfile -ExecutionPolicy Bypass -File filament-app.ps1
# Options: -Page ui/harness.html   the page to open (default: the harness; "/" is the console; a full address as given)
#          -Browser edge|chrome    prefer one; default: Edge, then Chrome, then whichever is found
#          -SharedProfile          use the browser's normal profile instead of the dedicated one
#          -NoStart                do not start the server when it is not running; wait for it instead
param([string]$Page = "ui/harness.html", [string]$Browser = "", [switch]$SharedProfile, [switch]$NoStart, [int]$WaitSeconds = 20)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
# The folder and port the server picks (src/services/config/store.js): from a git checkout, Filament-dev on 20301, so it
# runs beside the installed app and never opens its data; else Filament on 20300. The config's port wins either way.
$devDir = Join-Path $env:APPDATA "Filament-dev"
$dataDir = if ($env:FILAMENT_DATA_DIR) { $env:FILAMENT_DATA_DIR } elseif (Test-Path (Join-Path $root ".git")) { $devDir } else { Join-Path $env:APPDATA "Filament" }
$port = if ($dataDir -eq $devDir) { 20301 } else { 20300 }
try { $cfg = Get-Content (Join-Path $dataDir "config.json") -Raw | ConvertFrom-Json; if ($cfg.server.port) { $port = [int]$cfg.server.port } } catch {}
$base = "http://127.0.0.1:$port"
$url = if ($Page -match '^https?://') { $Page } else { "$base/$($Page.TrimStart('/'))" }

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
  if (-not $NoStart) {
    if ($node) {
      Write-Host "Filament is not running on port $port - starting it"
      Start-Process -FilePath $node -ArgumentList "`"$(Join-Path $root 'bin\filament.js')`"" -WorkingDirectory $root -WindowStyle Hidden | Out-Null
    } else { Write-Host "Filament is not running on port $port and node was not found - waiting for it" }
  } else { Write-Host "Filament is not running on port $port - waiting up to $WaitSeconds s" }
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  while (-not (Test-Server) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 400 }
  if (-not (Test-Server)) { Write-Host "still not answering; the window opens anyway and shows the browser's error until it does (reload when Filament is up)" }
}

# A window at 127.0.0.1 is no one's under the owner key (server.loopbackTrust "token"): the link `filament open --no-open`
# makes pairs it as this computer's own, at Filament's own name under localhost, where its profile keeps the pairing. A
# window paired already goes straight on, and the link's code runs out unused in five minutes.
if ($Page -notmatch '^https?://' -and $node -and (Test-Server)) {
  $words = @(if ($Page.Trim('/') -eq "") { "console" })
  $said = @()
  try { $said = @(& $node (Join-Path $root "bin\filament.js") --data-dir $dataDir open --no-open @words) } catch {}
  $link = $said | Where-Object { $_ -match '^https?://\S+/ui/pair\.html#code=' } | Select-Object -First 1
  if ($link) { $url = $link } else { $said | ForEach-Object { Write-Host $_ } }
}

$argList = @("--app=$url", "--no-first-run", "--no-default-browser-check", "--window-size=1480,940")
$profileDir = ""
if (-not $SharedProfile) {
  $profileDir = Join-Path $dataDir "app-profile"
  if (-not (Test-Path $profileDir)) { New-Item -ItemType Directory -Path $profileDir -Force | Out-Null }
  $argList += "`"--user-data-dir=$profileDir`""
}
Start-Process -FilePath $browser -ArgumentList $argList | Out-Null
Write-Host "opened $($url -replace '#.*$', '') in $([IO.Path]::GetFileNameWithoutExtension($browser)) app mode$(if ($profileDir) { " (profile: $profileDir)" } else { '' })"

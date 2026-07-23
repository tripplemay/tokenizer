<#
.SYNOPSIS
  Installs the Tokenizer usage-collection client on native Windows.

.DESCRIPTION
  The Windows counterpart to install.sh. The differences from the POSIX script
  are forced by the platform, not by preference:

    * No symlink. Creating one needs Developer Mode or elevation, so a
      tokenizer.cmd shim is generated instead and its directory is added to
      the user's PATH.
    * No chmod. Credential file permissions are handled by the CLI itself via
      icacls (see src/cli/file-permissions.ts).
    * No pkill. A running agent is stopped through Task Scheduler, falling
      back to matching the node process by command line.

.EXAMPLE
  & ([scriptblock]::Create((irm https://token.vpanel.cc/install.ps1))) -EnrollToken abc123
#>

[CmdletBinding()]
param(
  [string] $ServerUrl        = $(if ($env:TOKENIZER_SERVER_URL)   { $env:TOKENIZER_SERVER_URL }   else { "https://token.vpanel.cc" }),
  [string] $EnrollToken      = $env:TOKENIZER_ENROLL_TOKEN,
  [string] $DeviceName       = $env:TOKENIZER_DEVICE_NAME,
  [string] $ProjectRoot      = $(if ($env:TOKENIZER_PROJECT_ROOT) { $env:TOKENIZER_PROJECT_ROOT } else { Join-Path $HOME "project" }),
  [int]    $HeartbeatSeconds = $(if ($env:TOKENIZER_HEARTBEAT_SECONDS) { [int]$env:TOKENIZER_HEARTBEAT_SECONDS } else { 60 }),
  [int]    $SyncMinutes      = $(if ($env:TOKENIZER_SYNC_MINUTES)      { [int]$env:TOKENIZER_SYNC_MINUTES }      else { 15 }),
  [switch] $NoService,
  [switch] $ForceEnroll,
  [switch] $Yes,
  # Branch to install from. Exists so a change can be tested end-to-end on a
  # real machine before it is merged and deployed.
  [string] $Branch = $(if ($env:TOKENIZER_BRANCH) { $env:TOKENIZER_BRANCH } else { "main" })
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoUrl         = "https://github.com/tripplemay/tokenizer.git"
$TokenizerHome   = Join-Path $HOME ".tokenizer"
$InstallDir      = Join-Path $TokenizerHome "app"
$BinDir          = Join-Path $TokenizerHome "bin"
$CredentialsFile = Join-Path $TokenizerHome "credentials.json"

function Write-Log { param([string] $Message) Write-Host "[tokenizer] $Message" }

# $ErrorActionPreference = "Stop" only covers PowerShell's own terminating
# errors — a native executable exiting non-zero sails straight past it. Without
# this wrapper a failed `npm ci` would keep going and still report success,
# which is the behaviour `set -euo pipefail` gives install.sh for free.
function Invoke-Checked {
  param([Parameter(Mandatory)][string] $Exe, [Parameter(ValueFromRemainingArguments)][string[]] $Arguments)
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $Exe $($Arguments -join ' ')"
  }
}

function Assert-Command {
  param([string] $Name, [string] $WingetId, [string] $Hint)
  if (Get-Command $Name -ErrorAction SilentlyContinue) { return }
  Write-Host ""
  Write-Host "Tokenizer needs '$Name', which is not on your PATH." -ForegroundColor Yellow
  if ($WingetId) { Write-Host "  Install it with:  winget install $WingetId" }
  if ($Hint)     { Write-Host "  $Hint" }
  Write-Host ""
  throw "Missing required command: $Name"
}

# Node 22+ is required: the CLI relies on undici's EnvHttpProxyAgent and on
# fetch being available without a flag.
function Assert-NodeVersion {
  $raw = (& node --version) 2>$null
  if (-not $raw) { throw "Could not determine the Node.js version." }
  $major = [int]($raw.TrimStart("v").Split(".")[0])
  if ($major -lt 22) {
    throw "Node.js 22 or newer is required (found $raw). Install it with: winget install OpenJS.NodeJS.LTS"
  }
}

function Stop-RunningAgent {
  # A daemon started before this install keeps executing its old in-memory
  # modules, so the upgrade would appear to succeed while the dashboard
  # silently stayed on stale features.
  #
  # Disable before ending: the task has a repeating revive trigger, so between
  # this stop and the re-registration at the end of the install it could fire
  # and relaunch the OLD definition. /Create /F re-registers with
  # <Enabled>true</Enabled>, which lifts the disable.
  try { & schtasks /Change /TN "Tokenizer Agent" /DISABLE 2>$null | Out-Null } catch { }
  try { & schtasks /End /TN "Tokenizer Agent" 2>$null | Out-Null } catch { }
  # The task's own process is the wscript launcher; schtasks /End is not
  # guaranteed to take the child node.exe down with it, so both are matched
  # explicitly. Anchored to the install's own directories: a looser match
  # would also kill unrelated scripts or Node tools that share the shape.
  Get-CimInstance Win32_Process -Filter "Name = 'wscript.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and
      $_.CommandLine.Contains($BinDir) -and
      $_.CommandLine.Contains("tokenizer-agent.vbs")
    } |
    ForEach-Object {
      Write-Log "Stopping agent launcher (pid $($_.ProcessId))"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and
      $_.CommandLine.Contains($InstallDir) -and
      $_.CommandLine -match "cli[\\/]index\.ts.*\bagent\b"
    } |
    ForEach-Object {
      Write-Log "Stopping running agent (pid $($_.ProcessId))"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function New-CmdShim {
  # pushd/popd because tsx is resolved relative to the working directory —
  # the same constraint that makes bin/tokenizer set cwd on POSIX.
  # The install path is deliberately NOT interpolated here. It contains the
  # username, which on Windows may be non-ASCII (CJK, Cyrillic, accented
  # Latin); writing it into a .cmd would corrupt it under any single-byte
  # encoding. %~dp0 resolves relative to the shim at runtime instead, so the
  # file stays pure ASCII whatever the user is called.
  $shim = @'
@echo off
pushd "%~dp0..\app"
node --import tsx "src\cli\index.ts" %*
set TOKENIZER_EXIT=%ERRORLEVEL%
popd
exit /b %TOKENIZER_EXIT%
'@
  Set-Content -Path (Join-Path $BinDir "tokenizer.cmd") -Value $shim -Encoding ASCII
}

function Add-ToUserPath {
  param([string] $Directory)
  $current = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($current -and ($current -split ";" | Where-Object { $_ -eq $Directory })) { return }
  $updated = if ([string]::IsNullOrEmpty($current)) { $Directory } else { "$current;$Directory" }
  [Environment]::SetEnvironmentVariable("Path", $updated, "User")
  Write-Log "Added $Directory to your user PATH (open a new terminal to pick it up)"
}

Assert-Command -Name "node" -WingetId "OpenJS.NodeJS.LTS"
Assert-Command -Name "git"  -WingetId "Git.Git"
Assert-NodeVersion

Write-Log "Installing Tokenizer client to $InstallDir"
New-Item -ItemType Directory -Force -Path $TokenizerHome, $BinDir, (Join-Path $TokenizerHome "logs") | Out-Null

Stop-RunningAgent

if ($Branch -ne "main") { Write-Log "Installing from branch '$Branch'" }

if (Test-Path (Join-Path $InstallDir ".git")) {
  Invoke-Checked git -C $InstallDir fetch --prune origin
  Invoke-Checked git -C $InstallDir checkout --force "origin/$Branch"
} else {
  if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
  Invoke-Checked git clone $RepoUrl $InstallDir
  Invoke-Checked git -C $InstallDir checkout --force "origin/$Branch"
}

Push-Location $InstallDir
try {
  # better-sqlite3 (the OpenCode collector) resolves a win32-x64 prebuild
  # here. If that download is blocked, npm falls back to node-gyp and will
  # ask for Visual Studio Build Tools.
  Invoke-Checked npm ci
} finally {
  Pop-Location
}

New-CmdShim
Add-ToUserPath -Directory $BinDir
$env:Path = "$BinDir;$env:Path"

$tokenizer = Join-Path $BinDir "tokenizer.cmd"

if ($DeviceName) { Invoke-Checked $tokenizer init --device-name $DeviceName } else { Invoke-Checked $tokenizer init }
Invoke-Checked $tokenizer configure --server-url $ServerUrl --project-root $ProjectRoot

$needEnroll = $ForceEnroll -or -not (Test-Path $CredentialsFile)
if ($needEnroll) {
  if (-not $EnrollToken) {
    throw "An enrollment token is required for a first install. Pass -EnrollToken <token>."
  }
  $enrollArgs = @("enroll", "--enroll-token", $EnrollToken, "--server-url", $ServerUrl)
  if ($DeviceName) { $enrollArgs += @("--device-name", $DeviceName) }
  if ($Yes)        { $enrollArgs += "--yes" }
  Invoke-Checked $tokenizer @enrollArgs
} else {
  Write-Log "Re-using existing credentials at $CredentialsFile."
}

if (-not $NoService) {
  Invoke-Checked $tokenizer install-service --heartbeat-seconds $HeartbeatSeconds --sync-minutes $SyncMinutes
  # The task's repeating revive trigger will start the agent within 15 minutes
  # on its own. Run it now so the first heartbeat lands immediately.
  try { & schtasks /Run /TN "Tokenizer Agent" | Out-Null } catch {
    Write-Log "Could not start the scheduled task immediately; it will start within 15 minutes."
  }
}

# Best-effort, mirroring `tokenizer run || true` in install.sh: a first
# collection failure should not undo a successful install.
& $tokenizer run
Write-Log "Tokenizer installed. Run: tokenizer status"

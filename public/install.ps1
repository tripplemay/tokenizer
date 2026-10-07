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
  [switch] $Rollback
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoUrl         = "https://github.com/tripplemay/tokenizer.git"
$TokenizerHome   = Join-Path $HOME ".tokenizer"
$InstallDir      = Join-Path $TokenizerHome "app"
$ReleasesDir     = Join-Path $TokenizerHome "releases"
$PreviousFile    = Join-Path $TokenizerHome "previous-release.txt"
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

if ($Rollback -and $ForceEnroll) { throw "-Rollback and -ForceEnroll cannot be combined." }
$needEnroll = $ForceEnroll -or -not (Test-Path $CredentialsFile)
if (-not $Rollback -and $needEnroll -and -not $EnrollToken) {
  throw "An enrollment token is required for a first install. Pass -EnrollToken <token>."
}

New-Item -ItemType Directory -Force -Path $TokenizerHome, $ReleasesDir, $BinDir, (Join-Path $TokenizerHome "logs") | Out-Null
$stageDir = $null
$candidateDir = $null
$oldDir = $null
$oldMoved = $false
$newMoved = $false
$stopAttempted = $false
$hadExistingApp = $false
$tokenizer = Join-Path $BinDir "tokenizer.cmd"

try {
  if ($Rollback) {
    if (-not (Test-Path $InstallDir) -or -not (Test-Path $PreviousFile)) {
      throw "No previous release available for rollback."
    }
    $candidateDir = [IO.Path]::GetFullPath((Get-Content -Raw $PreviousFile).Trim())
    $releasePrefix = [IO.Path]::GetFullPath($ReleasesDir).TrimEnd('\') + '\'
    if (-not $candidateDir.StartsWith($releasePrefix, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path (Join-Path $candidateDir ".git"))) {
      throw "Previous release path is invalid."
    }
  } else {
    # Old servers, offline hosts, and malformed manifests fail before touching
    # the current checkout or Task Scheduler. There is no origin/main fallback.
    $serverUri = [Uri]$ServerUrl
    if ($serverUri.UserInfo -or
        ($serverUri.Scheme -ne "https" -and -not ($serverUri.Scheme -eq "http" -and $serverUri.IsLoopback))) {
      throw "Agent release manifest requires HTTPS (except loopback testing)."
    }
    $manifest = Invoke-RestMethod -Uri "$($ServerUrl.TrimEnd('/'))/api/agent/releases" -TimeoutSec 15
    $release = $manifest.release
    if ($manifest.schema_version -ne 1 -or
        $release.version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' -or
        $release.commit -cnotmatch '^[0-9a-f]{40}$' -or
        $release.repository -cne $RepoUrl) {
      throw "Invalid pinned Agent release manifest."
    }
    Assert-Command -Name "git" -WingetId "Git.Git"
    $stageDir = Join-Path $TokenizerHome (".stage-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $stageDir | Out-Null
    Invoke-Checked git -C $stageDir init -q
    Invoke-Checked git -C $stageDir remote add origin $RepoUrl
    Invoke-Checked git -C $stageDir fetch --no-tags --depth=1 origin $release.commit
    Invoke-Checked git -C $stageDir checkout --detach --force $release.commit
    $actualCommit = (& git -C $stageDir rev-parse --verify HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $actualCommit -cne $release.commit) {
      throw "Agent commit digest mismatch."
    }
    Push-Location $stageDir
    try {
      Invoke-Checked npm ci
      Invoke-Checked node --import tsx "src\cli\index.ts" --help
    } finally {
      Pop-Location
    }
    $candidateDir = Join-Path $ReleasesDir ("$($release.commit)-" + [guid]::NewGuid().ToString("N"))
    Move-Item -LiteralPath $stageDir -Destination $candidateDir
    $stageDir = $null
  }

  if ((Test-Path $InstallDir) -and -not (Test-Path (Join-Path $InstallDir ".git"))) {
    throw "Existing app path is not a Git checkout; refusing to replace it."
  }
  Push-Location $candidateDir
  try { Invoke-Checked node --import tsx "src\cli\index.ts" --help } finally { Pop-Location }

  $hadExistingApp = Test-Path $InstallDir
  if ($hadExistingApp) {
    $oldDir = Join-Path $ReleasesDir ("previous-" + [guid]::NewGuid().ToString("N"))
  }
  $stopAttempted = $true
  Stop-RunningAgent
  if ($oldDir) {
    Move-Item -LiteralPath $InstallDir -Destination $oldDir
    $oldMoved = $true
  }
  Move-Item -LiteralPath $candidateDir -Destination $InstallDir
  $newMoved = $true

  New-CmdShim
  $env:Path = "$BinDir;$env:Path"
  if (-not $Rollback) {
    if ($DeviceName) { Invoke-Checked $tokenizer init --device-name $DeviceName } else { Invoke-Checked $tokenizer init }
    Invoke-Checked $tokenizer configure --server-url $ServerUrl --project-root $ProjectRoot
    if ($needEnroll) {
      $enrollArgs = @("enroll", "--enroll-token", $EnrollToken, "--server-url", $ServerUrl)
      if ($DeviceName) { $enrollArgs += @("--device-name", $DeviceName) }
      if ($Yes) { $enrollArgs += "--yes" }
      Invoke-Checked $tokenizer @enrollArgs
    } else {
      Write-Log "Re-using existing credentials at $CredentialsFile."
    }
  }
  if (-not $NoService) {
    Invoke-Checked $tokenizer install-service --heartbeat-seconds $HeartbeatSeconds --sync-minutes $SyncMinutes
    try { & schtasks /Run /TN "Tokenizer Agent" | Out-Null } catch {
      Write-Log "Could not start the scheduled task immediately; it will start within 15 minutes."
    }
  }
  if ($oldDir) { Set-Content -Path $PreviousFile -Value $oldDir -Encoding ASCII }
  Add-ToUserPath -Directory $BinDir
  if (-not $Rollback) { & $tokenizer run }
  Write-Log "Tokenizer installed. Run: tokenizer status"
} catch {
  if ($newMoved -and (Test-Path $InstallDir)) {
    Move-Item -LiteralPath $InstallDir -Destination $candidateDir
  }
  if ($oldMoved -and (Test-Path $oldDir)) {
    Move-Item -LiteralPath $oldDir -Destination $InstallDir
  }
  if (-not $hadExistingApp -and (Test-Path $tokenizer)) {
    Remove-Item -LiteralPath $tokenizer -Force
  }
  if ($stopAttempted -and $hadExistingApp -and -not $NoService -and (Test-Path $tokenizer)) {
    try { Invoke-Checked $tokenizer install-service --heartbeat-seconds $HeartbeatSeconds --sync-minutes $SyncMinutes }
    catch { Write-Warning "Previous Agent restored, but service restart failed. Run tokenizer install-service manually." }
  }
  throw
} finally {
  if ($stageDir -and (Test-Path $stageDir)) { Remove-Item -Recurse -Force $stageDir }
}

#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REPOSITORY="WuSiYu/singbox-multipath"
UPSTREAM_COMMIT="1c36787d956d750f2ee58d73710d8006a11ccf2c"
MIERU_REPOSITORY="enfein/mieru"
MIERU_VERSION="3.36.0"
MIERU_TAG="v${MIERU_VERSION}"
MIERU_COMMIT="155ebbd60f86e472586a60d7ffe58ec8f8682cb1"
MIERU_ASSET="mieru_${MIERU_VERSION}_windows_amd64.zip"
MIERU_ASSET_SHA256="f0136fa3bbfb1489a0a41c1ef5c3aa58ecf5b4793dc51d5a813cf7f5803017d1"
MIERU_EXE_SHA256="ed9dbf733321c3010f4e3431b46f65b7d1560f6b633f79a76f33219986d9e927"
OUTPUT_DIR="${1:-$PWD/dist/dual-windows-gray}"
WORK_ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/forwardx-dual-windows-${UPSTREAM_COMMIT:0:12}"
SOURCE_DIR="$WORK_ROOT/source"
MIERU_SOURCE_DIR="$WORK_ROOT/mieru-source"

if [[ -d "$OUTPUT_DIR" && -n "$(find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  printf 'Refusing to build into non-empty output directory: %s\n' "$OUTPUT_DIR" >&2
  printf 'Use a fresh directory so secret-bearing Gray configs cannot be packaged accidentally.\n' >&2
  exit 2
fi

rm -rf "$WORK_ROOT"
mkdir -p "$SOURCE_DIR" "$OUTPUT_DIR"

printf 'Cloning pinned upstream %s@%s\n' "$UPSTREAM_REPOSITORY" "$UPSTREAM_COMMIT"
git init "$SOURCE_DIR"
git -C "$SOURCE_DIR" remote add origin "https://github.com/${UPSTREAM_REPOSITORY}.git"
git -C "$SOURCE_DIR" fetch --depth=1 --filter=blob:none origin "$UPSTREAM_COMMIT"
git -C "$SOURCE_DIR" checkout --detach FETCH_HEAD

ACTUAL_COMMIT="$(git -C "$SOURCE_DIR" rev-parse HEAD)"
if [[ "$ACTUAL_COMMIT" != "$UPSTREAM_COMMIT" ]]; then
  echo "Pinned upstream commit mismatch: expected=$UPSTREAM_COMMIT actual=$ACTUAL_COMMIT" >&2
  exit 1
fi

cd "$SOURCE_DIR"

BUILD_TAGS="$(tr -d '\r\n' < release/DEFAULT_BUILD_TAGS_OTHERS)"
case ",${BUILD_TAGS}," in
  *,with_quic,*) ;;
  *)
    echo "Pinned upstream Windows build tags do not contain with_quic" >&2
    exit 1
    ;;
esac

LDFLAGS_SHARED="$(tr -d '\r\n' < release/LDFLAGS)"
VERSION="forwardx-dual-gray-${UPSTREAM_COMMIT:0:12}"

printf 'Building Windows amd64 with tags: %s\n' "$BUILD_TAGS"
go version
mkdir -p "$WORK_ROOT/dist"
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -v -trimpath \
  -o "$WORK_ROOT/dist/sing-box.exe" \
  -tags "$BUILD_TAGS" \
  -ldflags "-X 'github.com/sagernet/sing-box/constant.Version=${VERSION}' ${LDFLAGS_SHARED} -s -w -buildid=" \
  ./cmd/sing-box

install -m 0755 "$WORK_ROOT/dist/sing-box.exe" "$OUTPUT_DIR/sing-box-windows-amd64.exe"
sha256sum "$OUTPUT_DIR/sing-box-windows-amd64.exe" > "$OUTPUT_DIR/sing-box-windows-amd64.exe.sha256"

printf 'Downloading official Mieru %s Windows amd64 artifact\n' "$MIERU_VERSION"
curl -fsSL -o "$WORK_ROOT/$MIERU_ASSET" \
  "https://github.com/${MIERU_REPOSITORY}/releases/download/${MIERU_TAG}/${MIERU_ASSET}"
printf '%s  %s\n' "$MIERU_ASSET_SHA256" "$WORK_ROOT/$MIERU_ASSET" | sha256sum -c -
unzip -q -j "$WORK_ROOT/$MIERU_ASSET" mieru.exe -d "$WORK_ROOT/mieru-bin"
printf '%s  %s\n' "$MIERU_EXE_SHA256" "$WORK_ROOT/mieru-bin/mieru.exe" | sha256sum -c -
install -m 0755 "$WORK_ROOT/mieru-bin/mieru.exe" "$OUTPUT_DIR/mieru-windows-amd64.exe"
sha256sum "$OUTPUT_DIR/mieru-windows-amd64.exe" > "$OUTPUT_DIR/mieru-windows-amd64.exe.sha256"

git init "$MIERU_SOURCE_DIR"
git -C "$MIERU_SOURCE_DIR" remote add origin "https://github.com/${MIERU_REPOSITORY}.git"
git -C "$MIERU_SOURCE_DIR" fetch --depth=1 --filter=blob:none origin "$MIERU_COMMIT"
git -C "$MIERU_SOURCE_DIR" checkout --detach FETCH_HEAD
[[ "$(git -C "$MIERU_SOURCE_DIR" rev-parse HEAD)" == "$MIERU_COMMIT" ]]
install -m 0644 "$MIERU_SOURCE_DIR/LICENSE" "$OUTPUT_DIR/MIERU-LICENSE-GPL-3.0.txt"
git -C "$MIERU_SOURCE_DIR" archive --format=tar.gz --prefix="mieru-${MIERU_VERSION}/" \
  -o "$OUTPUT_DIR/mieru-${MIERU_VERSION}-source.tar.gz" HEAD
sha256sum "$OUTPUT_DIR/mieru-${MIERU_VERSION}-source.tar.gz" > "$OUTPUT_DIR/mieru-${MIERU_VERSION}-source.tar.gz.sha256"

cat > "$OUTPUT_DIR/build-metadata.json" <<EOF
{
  "purpose": "ForwardX Dual Windows gray validation only",
  "upstreamRepository": "$UPSTREAM_REPOSITORY",
  "upstreamCommit": "$UPSTREAM_COMMIT",
  "platform": "windows",
  "architecture": "amd64",
  "requiredBuildTag": "with_quic",
  "buildTags": "$BUILD_TAGS",
  "mieru": {
    "repository": "$MIERU_REPOSITORY",
    "version": "$MIERU_VERSION",
    "tag": "$MIERU_TAG",
    "commit": "$MIERU_COMMIT",
    "releaseAsset": "$MIERU_ASSET",
    "releaseAssetSha256": "$MIERU_ASSET_SHA256",
    "executableSha256": "$MIERU_EXE_SHA256",
    "license": "GPL-3.0",
    "correspondingSourceIncluded": true
  },
  "runtimeActivation": false,
  "deployment": false
}
EOF

cat > "$OUTPUT_DIR/run-dual-test.cmd" <<'EOF'
@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-forwardx-dual-gray.ps1"
exit /b %ERRORLEVEL%
EOF

cat > "$OUTPUT_DIR/run-forwardx-dual-gray.ps1" <<'EOF'
$ErrorActionPreference = "Stop"
$script:stopRequested = $false
$mieruProcess = $null
$multipathProcess = $null
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$mieruBinary = Join-Path $root "mieru-windows-amd64.exe"
$multipathBinary = Join-Path $root "sing-box-windows-amd64.exe"
$mieruConfig = Join-Path $root "mieru-gray.json"
$dualConfig = Join-Path $root "dual-test.json"

function Assert-File([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required file not found: $Path" }
}

function Assert-LoopbackPortFree([int]$Port) {
  $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
  try { $probe.Start() } catch { throw "127.0.0.1:$Port is already in use; nothing was started" } finally { $probe.Stop() }
}

function Start-GrayChild([string]$FilePath, [string]$Arguments, [hashtable]$Environment) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $FilePath
  $info.Arguments = $Arguments
  $info.UseShellExecute = $false
  foreach ($entry in $Environment.GetEnumerator()) { $info.EnvironmentVariables[$entry.Key] = $entry.Value }
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $info
  if (-not $process.Start()) { throw "Failed to start managed Gray child: $FilePath" }
  return $process
}

function Wait-LoopbackReady([System.Diagnostics.Process]$Process, [int]$Port, [int]$TimeoutMs) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($Process.HasExited) { throw "Managed Gray child exited before 127.0.0.1:$Port became ready (code $($Process.ExitCode))" }
    $client = New-Object System.Net.Sockets.TcpClient
    try {
      $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
      if ($async.AsyncWaitHandle.WaitOne(100) -and $client.Connected) { $client.EndConnect($async); return }
    } catch { } finally { $client.Close() }
    Start-Sleep -Milliseconds 100
  }
  throw "Timed out waiting for 127.0.0.1:$Port"
}

function Stop-GrayChild([System.Diagnostics.Process]$Process) {
  if ($null -ne $Process -and -not $Process.HasExited) {
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    $Process.WaitForExit(5000) | Out-Null
  }
}

$cancelHandler = [ConsoleCancelEventHandler]{ param($sender, $eventArgs); $eventArgs.Cancel = $true; $script:stopRequested = $true }
[Console]::add_CancelKeyPress($cancelHandler)
try {
  Assert-File $mieruBinary
  Assert-File $multipathBinary
  Assert-File $mieruConfig
  Assert-File $dualConfig

  $mieruJson = Get-Content -LiteralPath $mieruConfig -Raw | ConvertFrom-Json
  if ($mieruJson.socks5Port -ne 24181 -or $mieruJson.socks5ListenLAN -ne $false -or $mieruJson.rpcPort -ne 0) {
    throw "mieru-gray.json must use loopback-only SOCKS 24181 and rpcPort 0"
  }
  $dualJson = Get-Content -LiteralPath $dualConfig -Raw | ConvertFrom-Json
  if ($dualJson.inbounds[0].listen -ne "127.0.0.1" -or $dualJson.inbounds[0].listen_port -ne 24180) {
    throw "dual-test.json must use loopback-only ingress 24180"
  }

  Assert-LoopbackPortFree 24180
  Assert-LoopbackPortFree 24181

  & $multipathBinary check -c $dualConfig
  if ($LASTEXITCODE -ne 0) { throw "dual-test.json failed pinned sing-box check; nothing was started" }

  $mieruProcess = Start-GrayChild $mieruBinary "run" @{ "MIERU_CONFIG_JSON_FILE" = $mieruConfig }
  Wait-LoopbackReady $mieruProcess 24181 15000
  $multipathProcess = Start-GrayChild $multipathBinary "run -c `"$dualConfig`"" @{}
  Wait-LoopbackReady $multipathProcess 24180 15000

  Write-Host "ForwardX Dual Gray is running on 127.0.0.1:24180. Press Ctrl+C to stop both managed children."
  while (-not $script:stopRequested) {
    if ($mieruProcess.HasExited) { throw "Managed Mieru child exited (code $($mieruProcess.ExitCode))" }
    if ($multipathProcess.HasExited) { throw "Managed multipath child exited (code $($multipathProcess.ExitCode))" }
    Start-Sleep -Milliseconds 250
  }
} finally {
  [Console]::remove_CancelKeyPress($cancelHandler)
  Stop-GrayChild $multipathProcess
  Stop-GrayChild $mieruProcess
}
EOF

cat > "$OUTPUT_DIR/README-WINDOWS-GRAY.txt" <<'EOF'
ForwardX Dual Windows Gray test package

1. Do not run the Gray proxy until a real dual-test.json has been generated.
2. Put secret-bearing mieru-gray.json and dual-test.json in this same folder.
3. Double-click run-dual-test.cmd.
4. The launcher checks the config first. If check fails, runtime is not started.
5. Press Ctrl+C in the terminal window to stop the Gray test.

The private leg is owned by the bundled official enfein/mieru client and listens only on 127.0.0.1:24181.
The launcher does not read, modify, stop, or depend on Clash Mi and never uses port 7890.
Mieru is GPL-3.0 software. The license and corresponding pinned source are included in this bundle.
EOF

(
  cd "$OUTPUT_DIR"
  sha256sum \
    sing-box-windows-amd64.exe \
    mieru-windows-amd64.exe \
    "mieru-${MIERU_VERSION}-source.tar.gz" \
    run-forwardx-dual-gray.ps1 \
    run-dual-test.cmd \
    README-WINDOWS-GRAY.txt \
    MIERU-LICENSE-GPL-3.0.txt > SHA256SUMS.txt
)

printf '\n===== Windows artifact =====\n'
ls -lh "$OUTPUT_DIR/sing-box-windows-amd64.exe"
ls -lh "$OUTPUT_DIR/mieru-windows-amd64.exe"
cat "$OUTPUT_DIR/sing-box-windows-amd64.exe.sha256"
cat "$OUTPUT_DIR/mieru-windows-amd64.exe.sha256"
cat "$OUTPUT_DIR/build-metadata.json"

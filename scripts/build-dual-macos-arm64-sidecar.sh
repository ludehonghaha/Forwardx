#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REPOSITORY="WuSiYu/singbox-multipath"
UPSTREAM_COMMIT="1c36787d956d750f2ee58d73710d8006a11ccf2c"
MIERU_REPOSITORY="enfein/mieru"
MIERU_VERSION="3.36.0"
MIERU_TAG="v${MIERU_VERSION}"
MIERU_COMMIT="155ebbd60f86e472586a60d7ffe58ec8f8682cb1"
MIERU_ASSET="mieru_${MIERU_VERSION}_macos_arm64.tar.gz"
MIERU_ASSET_SHA256="291ee21377a037d622acc37456295712bc5e77fe700436414d7706b49f1f57d7"
OUTPUT_DIR="${1:-$PWD/dist/dual-macos-arm64-gray}"
WORK_ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/forwardx-dual-macos-arm64-${UPSTREAM_COMMIT:0:12}"
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
    echo "Pinned upstream macOS arm64 build tags do not contain with_quic" >&2
    exit 1
    ;;
esac

LDFLAGS_SHARED="$(tr -d '\r\n' < release/LDFLAGS)"
VERSION="forwardx-dual-gray-${UPSTREAM_COMMIT:0:12}"

printf 'Building macOS arm64 with tags: %s\n' "$BUILD_TAGS"
go version
mkdir -p "$WORK_ROOT/dist"
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -v -trimpath \
  -o "$WORK_ROOT/dist/sing-box" \
  -tags "$BUILD_TAGS" \
  -ldflags "-X 'github.com/sagernet/sing-box/constant.Version=${VERSION}' ${LDFLAGS_SHARED} -s -w -buildid=" \
  ./cmd/sing-box

install -m 0755 "$WORK_ROOT/dist/sing-box" "$OUTPUT_DIR/sing-box-macos-arm64"
sha256sum "$OUTPUT_DIR/sing-box-macos-arm64" > "$OUTPUT_DIR/sing-box-macos-arm64.sha256"

printf 'Downloading official Mieru %s macOS arm64 artifact\n' "$MIERU_VERSION"
curl -fsSL -o "$WORK_ROOT/$MIERU_ASSET" \
  "https://github.com/${MIERU_REPOSITORY}/releases/download/${MIERU_TAG}/${MIERU_ASSET}"
printf '%s  %s\n' "$MIERU_ASSET_SHA256" "$WORK_ROOT/$MIERU_ASSET" | sha256sum -c -
mkdir -p "$WORK_ROOT/mieru-bin"
tar -xzf "$WORK_ROOT/$MIERU_ASSET" -C "$WORK_ROOT/mieru-bin"
if [[ ! -f "$WORK_ROOT/mieru-bin/mieru" ]]; then
  echo "Official Mieru archive does not contain expected mieru binary" >&2
  exit 1
fi
install -m 0755 "$WORK_ROOT/mieru-bin/mieru" "$OUTPUT_DIR/mieru-macos-arm64"
sha256sum "$OUTPUT_DIR/mieru-macos-arm64" > "$OUTPUT_DIR/mieru-macos-arm64.sha256"

git init "$MIERU_SOURCE_DIR"
git -C "$MIERU_SOURCE_DIR" remote add origin "https://github.com/${MIERU_REPOSITORY}.git"
git -C "$MIERU_SOURCE_DIR" fetch --depth=1 --filter=blob:none origin "$MIERU_COMMIT"
git -C "$MIERU_SOURCE_DIR" checkout --detach FETCH_HEAD
[[ "$(git -C "$MIERU_SOURCE_DIR" rev-parse HEAD)" == "$MIERU_COMMIT" ]]
install -m 0644 "$MIERU_SOURCE_DIR/LICENSE" "$OUTPUT_DIR/MIERU-LICENSE-GPL-3.0.txt"
git -C "$MIERU_SOURCE_DIR" archive --format=tar.gz --prefix="mieru-${MIERU_VERSION}/" \
  -o "$OUTPUT_DIR/mieru-${MIERU_VERSION}-source.tar.gz" HEAD
sha256sum "$OUTPUT_DIR/mieru-${MIERU_VERSION}-source.tar.gz" > "$OUTPUT_DIR/mieru-${MIERU_VERSION}-source.tar.gz.sha256"

cat > "$OUTPUT_DIR/run-forwardx-dual-gray.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
MIERU_BIN="$ROOT/mieru-macos-arm64"
MULTIPATH_BIN="$ROOT/sing-box-macos-arm64"
MIERU_CONFIG="$ROOT/mieru-gray.json"
DUAL_CONFIG="$ROOT/dual-test.json"
MIERU_PID=""
MULTIPATH_PID=""

cleanup() {
  set +e
  if [[ -n "$MULTIPATH_PID" ]]; then kill "$MULTIPATH_PID" 2>/dev/null; wait "$MULTIPATH_PID" 2>/dev/null; fi
  if [[ -n "$MIERU_PID" ]]; then kill "$MIERU_PID" 2>/dev/null; wait "$MIERU_PID" 2>/dev/null; fi
}
trap cleanup EXIT INT TERM HUP

for file in "$MIERU_BIN" "$MULTIPATH_BIN" "$MIERU_CONFIG" "$DUAL_CONFIG"; do
  [[ -f "$file" ]] || { echo "Required file not found: $file" >&2; exit 2; }
done

for port in 24180 24181; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "127.0.0.1:$port is already in use; nothing was started" >&2
    exit 2
  fi
done

"$MULTIPATH_BIN" check -c "$DUAL_CONFIG"

MIERU_CONFIG_JSON_FILE="$MIERU_CONFIG" "$MIERU_BIN" run &
MIERU_PID=$!
for _ in $(seq 1 150); do
  kill -0 "$MIERU_PID" 2>/dev/null || { echo "Managed Mieru child exited before 24181 became ready" >&2; exit 1; }
  if nc -z 127.0.0.1 24181 >/dev/null 2>&1; then break; fi
  sleep 0.1
done
nc -z 127.0.0.1 24181 >/dev/null 2>&1 || { echo "Timed out waiting for Mieru 127.0.0.1:24181" >&2; exit 1; }

"$MULTIPATH_BIN" run -c "$DUAL_CONFIG" &
MULTIPATH_PID=$!
for _ in $(seq 1 150); do
  kill -0 "$MULTIPATH_PID" 2>/dev/null || { echo "Managed multipath child exited before 24180 became ready" >&2; exit 1; }
  if nc -z 127.0.0.1 24180 >/dev/null 2>&1; then break; fi
  sleep 0.1
done
nc -z 127.0.0.1 24180 >/dev/null 2>&1 || { echo "Timed out waiting for Dual ingress 127.0.0.1:24180" >&2; exit 1; }

echo "ForwardX Dual Gray is running on 127.0.0.1:24180. Press Ctrl+C to stop both managed children."
wait "$MULTIPATH_PID"
EOF
chmod 0755 "$OUTPUT_DIR/run-forwardx-dual-gray.sh"

cat > "$OUTPUT_DIR/README-MACOS-ARM64-GRAY.txt" <<'EOF'
ForwardX Dual macOS arm64 Gray package

This package is for the first isolated Dual E2E validation only. It is not a production client.

Before use:
1. Confirm the Mac reports arm64 with uname -m.
2. Materialize authorized secret-bearing mieru-gray.json and dual-test.json beside these binaries.
3. Keep both configs outside git and never upload them as artifacts.
4. Run ./run-forwardx-dual-gray.sh from Terminal.
5. Ctrl+C stops both managed children.

Local listeners are fixed to loopback-only Gray ports:
- 127.0.0.1:24181 = official Mieru private leg
- 127.0.0.1:24180 = multipath SOCKS ingress

The launcher does not change system proxy settings, routes, firewall, Clash Mi, or global Mieru configuration.
Mieru is GPL-3.0 software. The license and corresponding pinned source are included.
EOF

cat > "$OUTPUT_DIR/build-metadata.json" <<EOF
{
  "purpose": "ForwardX Dual macOS arm64 first E2E gray validation only",
  "upstreamRepository": "$UPSTREAM_REPOSITORY",
  "upstreamCommit": "$UPSTREAM_COMMIT",
  "platform": "macos",
  "architecture": "arm64",
  "requiredBuildTag": "with_quic",
  "buildTags": "$BUILD_TAGS",
  "mieru": {
    "repository": "$MIERU_REPOSITORY",
    "version": "$MIERU_VERSION",
    "tag": "$MIERU_TAG",
    "commit": "$MIERU_COMMIT",
    "releaseAsset": "$MIERU_ASSET",
    "releaseAssetSha256": "$MIERU_ASSET_SHA256",
    "license": "GPL-3.0",
    "correspondingSourceIncluded": true
  },
  "runtimeConfigIncluded": false,
  "secretMaterialIncluded": false,
  "systemProxyMutation": false,
  "routeMutation": false,
  "runtimeActivation": false,
  "deployment": false
}
EOF

(
  cd "$OUTPUT_DIR"
  sha256sum \
    sing-box-macos-arm64 \
    mieru-macos-arm64 \
    "mieru-${MIERU_VERSION}-source.tar.gz" \
    run-forwardx-dual-gray.sh \
    README-MACOS-ARM64-GRAY.txt \
    MIERU-LICENSE-GPL-3.0.txt > SHA256SUMS.txt
)

printf '\n===== macOS arm64 artifact =====\n'
ls -lh "$OUTPUT_DIR/sing-box-macos-arm64" "$OUTPUT_DIR/mieru-macos-arm64"
cat "$OUTPUT_DIR/sing-box-macos-arm64.sha256"
cat "$OUTPUT_DIR/mieru-macos-arm64.sha256"
cat "$OUTPUT_DIR/build-metadata.json"

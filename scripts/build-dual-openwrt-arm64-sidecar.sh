#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REPOSITORY="WuSiYu/singbox-multipath"
UPSTREAM_COMMIT="1c36787d956d750f2ee58d73710d8006a11ccf2c"
MIERU_REPOSITORY="enfein/mieru"
MIERU_VERSION="3.36.0"
MIERU_TAG="v${MIERU_VERSION}"
MIERU_COMMIT="155ebbd60f86e472586a60d7ffe58ec8f8682cb1"
MIERU_ASSET="mieru_${MIERU_VERSION}_linux_arm64.tar.gz"
MIERU_ASSET_SHA256="9206d3cb89b9a591ce4adc0ddfda72f1124f75a8a4e6f45bee501d89320e101e"
OUTPUT_DIR="${1:-$PWD/dist/dual-openwrt-arm64-gray}"
WORK_ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/forwardx-dual-openwrt-arm64-${UPSTREAM_COMMIT:0:12}"
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
    echo "Pinned upstream Linux arm64 build tags do not contain with_quic" >&2
    exit 1
    ;;
esac

LDFLAGS_SHARED="$(tr -d '\r\n' < release/LDFLAGS)"
VERSION="forwardx-dual-gray-${UPSTREAM_COMMIT:0:12}"

printf 'Building Linux arm64 candidate with tags: %s\n' "$BUILD_TAGS"
go version
mkdir -p "$WORK_ROOT/dist"
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -v -trimpath \
  -o "$WORK_ROOT/dist/sing-box" \
  -tags "$BUILD_TAGS" \
  -ldflags "-X 'github.com/sagernet/sing-box/constant.Version=${VERSION}' ${LDFLAGS_SHARED} -s -w -buildid=" \
  ./cmd/sing-box

install -m 0755 "$WORK_ROOT/dist/sing-box" "$OUTPUT_DIR/sing-box-linux-arm64"
sha256sum "$OUTPUT_DIR/sing-box-linux-arm64" > "$OUTPUT_DIR/sing-box-linux-arm64.sha256"

printf 'Downloading official Mieru %s Linux arm64 artifact\n' "$MIERU_VERSION"
curl -fsSL -o "$WORK_ROOT/$MIERU_ASSET" \
  "https://github.com/${MIERU_REPOSITORY}/releases/download/${MIERU_TAG}/${MIERU_ASSET}"
printf '%s  %s\n' "$MIERU_ASSET_SHA256" "$WORK_ROOT/$MIERU_ASSET" | sha256sum -c -
mkdir -p "$WORK_ROOT/mieru-bin"
tar -xzf "$WORK_ROOT/$MIERU_ASSET" -C "$WORK_ROOT/mieru-bin"
if [[ ! -f "$WORK_ROOT/mieru-bin/mieru" ]]; then
  echo "Official Mieru archive does not contain expected mieru binary" >&2
  exit 1
fi
install -m 0755 "$WORK_ROOT/mieru-bin/mieru" "$OUTPUT_DIR/mieru-linux-arm64"
sha256sum "$OUTPUT_DIR/mieru-linux-arm64" > "$OUTPUT_DIR/mieru-linux-arm64.sha256"

git init "$MIERU_SOURCE_DIR"
git -C "$MIERU_SOURCE_DIR" remote add origin "https://github.com/${MIERU_REPOSITORY}.git"
git -C "$MIERU_SOURCE_DIR" fetch --depth=1 --filter=blob:none origin "$MIERU_COMMIT"
git -C "$MIERU_SOURCE_DIR" checkout --detach FETCH_HEAD
[[ "$(git -C "$MIERU_SOURCE_DIR" rev-parse HEAD)" == "$MIERU_COMMIT" ]]
install -m 0644 "$MIERU_SOURCE_DIR/LICENSE" "$OUTPUT_DIR/MIERU-LICENSE-GPL-3.0.txt"
git -C "$MIERU_SOURCE_DIR" archive --format=tar.gz --prefix="mieru-${MIERU_VERSION}/" \
  -o "$OUTPUT_DIR/mieru-${MIERU_VERSION}-source.tar.gz" HEAD
sha256sum "$OUTPUT_DIR/mieru-${MIERU_VERSION}-source.tar.gz" > "$OUTPUT_DIR/mieru-${MIERU_VERSION}-source.tar.gz.sha256"

cat > "$OUTPUT_DIR/README-OPENWRT-ARM64-GRAY.txt" <<'EOF'
ForwardX Dual OpenWrt/Linux arm64 Gray candidate package

This package is prepared offline only. It is NOT approved for runtime deployment yet.

Before copying anything to a router, verify the actual target with uname -m.
Only use this arm64 candidate when the target reports a compatible 64-bit ARM architecture such as aarch64/arm64.
Do not guess from the router model name alone.

The bundle contains:
- pinned singbox-multipath Linux arm64 binary
- official enfein/mieru Linux arm64 binary
- Mieru GPL-3.0 license and corresponding pinned source

The bundle intentionally contains NO Dual runtime config, Mieru credential, HY2 auth, TLS private key, firewall rule, init script, or OpenClash mutation.
OpenClash integration remains a later Gray step after real target discovery and the first Dual E2E pass.
EOF

cat > "$OUTPUT_DIR/build-metadata.json" <<EOF
{
  "purpose": "ForwardX Dual OpenWrt/Linux arm64 gray candidate only",
  "upstreamRepository": "$UPSTREAM_REPOSITORY",
  "upstreamCommit": "$UPSTREAM_COMMIT",
  "platform": "linux",
  "architecture": "arm64",
  "targetClass": "openwrt-linux-arm64-candidate",
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
  "targetArchitectureVerified": false,
  "runtimeConfigIncluded": false,
  "secretMaterialIncluded": false,
  "openClashMutation": false,
  "runtimeActivation": false,
  "deployment": false
}
EOF

(
  cd "$OUTPUT_DIR"
  sha256sum \
    sing-box-linux-arm64 \
    mieru-linux-arm64 \
    "mieru-${MIERU_VERSION}-source.tar.gz" \
    README-OPENWRT-ARM64-GRAY.txt \
    MIERU-LICENSE-GPL-3.0.txt > SHA256SUMS.txt
)

printf '\n===== OpenWrt/Linux arm64 candidate artifact =====\n'
ls -lh "$OUTPUT_DIR/sing-box-linux-arm64" "$OUTPUT_DIR/mieru-linux-arm64"
cat "$OUTPUT_DIR/sing-box-linux-arm64.sha256"
cat "$OUTPUT_DIR/mieru-linux-arm64.sha256"
cat "$OUTPUT_DIR/build-metadata.json"

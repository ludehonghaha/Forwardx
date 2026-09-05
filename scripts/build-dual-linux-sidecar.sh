#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REPOSITORY="WuSiYu/singbox-multipath"
UPSTREAM_COMMIT="1c36787d956d750f2ee58d73710d8006a11ccf2c"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CORE_PATCH="$SCRIPT_DIR/../patches/singbox-multipath-ack-window.patch"
OUTPUT_DIR="${1:-$PWD/dist/dual-linux-gray}"
WORK_ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/forwardx-dual-linux-${UPSTREAM_COMMIT:0:12}"
SOURCE_DIR="$WORK_ROOT/source"

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

git -C "$SOURCE_DIR" apply --check "$CORE_PATCH"
git -C "$SOURCE_DIR" apply "$CORE_PATCH"
PATCH_SHA256="$(sha256sum "$CORE_PATCH" | awk '{print $1}')"

cd "$SOURCE_DIR"
BUILD_TAGS="$(tr -d '\r\n' < release/DEFAULT_BUILD_TAGS_OTHERS)"
case ",${BUILD_TAGS}," in
  *,with_quic,*) ;;
  *)
    echo "Pinned upstream Linux build tags do not contain with_quic" >&2
    exit 1
    ;;
esac

LDFLAGS_SHARED="$(tr -d '\r\n' < release/LDFLAGS)"
VERSION="forwardx-dual-gray-${UPSTREAM_COMMIT:0:12}-ackwin-${PATCH_SHA256:0:12}"

printf 'Building Linux amd64 with tags: %s\n' "$BUILD_TAGS"
go version
mkdir -p "$WORK_ROOT/dist"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -v -trimpath \
  -o "$WORK_ROOT/dist/sing-box" \
  -tags "$BUILD_TAGS" \
  -ldflags "-X 'github.com/sagernet/sing-box/constant.Version=${VERSION}' ${LDFLAGS_SHARED} -s -w -buildid=" \
  ./cmd/sing-box

install -m 0755 "$WORK_ROOT/dist/sing-box" "$OUTPUT_DIR/sing-box-linux-amd64"
sha256sum "$OUTPUT_DIR/sing-box-linux-amd64" > "$OUTPUT_DIR/sing-box-linux-amd64.sha256"

cat > "$OUTPUT_DIR/build-metadata.json" <<EOF
{
  "purpose": "ForwardX Dual server gray validation only",
  "upstreamRepository": "$UPSTREAM_REPOSITORY",
  "upstreamCommit": "$UPSTREAM_COMMIT",
  "forwardxPatch": "patches/singbox-multipath-ack-window.patch",
  "forwardxPatchSha256": "$PATCH_SHA256",
  "platform": "linux",
  "architecture": "amd64",
  "requiredBuildTag": "with_quic",
  "buildTags": "$BUILD_TAGS",
  "runtimeActivation": false,
  "deployment": false
}
EOF

printf '\n===== Linux artifact =====\n'
ls -lh "$OUTPUT_DIR/sing-box-linux-amd64"
cat "$OUTPUT_DIR/sing-box-linux-amd64.sha256"
cat "$OUTPUT_DIR/build-metadata.json"

#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REPOSITORY="WuSiYu/singbox-multipath"
UPSTREAM_COMMIT="1c36787d956d750f2ee58d73710d8006a11ccf2c"
OUTPUT_DIR="${1:-$PWD/dist/dual-android-gray}"
WORK_ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/forwardx-dual-android-${UPSTREAM_COMMIT:0:12}"
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

cd "$SOURCE_DIR"

if [[ -z "${ANDROID_NDK_HOME:-}" ]]; then
  echo "ANDROID_NDK_HOME is required" >&2
  exit 1
fi

CC="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android23-clang"
CXX="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android23-clang++"
if [[ ! -x "$CC" || ! -x "$CXX" ]]; then
  echo "Android arm64 NDK compiler not found under ANDROID_NDK_HOME=$ANDROID_NDK_HOME" >&2
  exit 1
fi

BUILD_TAGS="$(tr -d '\r\n' < release/DEFAULT_BUILD_TAGS_OTHERS)"
case ",${BUILD_TAGS}," in
  *,with_quic,*) ;;
  *)
    echo "Pinned upstream Android build tags do not contain with_quic" >&2
    exit 1
    ;;
esac

LDFLAGS_SHARED="$(tr -d '\r\n' < release/LDFLAGS)"
VERSION="forwardx-dual-gray-${UPSTREAM_COMMIT:0:12}"

printf 'Building Android arm64 with tags: %s\n' "$BUILD_TAGS"
go version
go install -v ./cmd/internal/build

export CC CXX
export CGO_ENABLED=1
export BUILD_GOOS=android
export BUILD_GOARCH=arm64

mkdir -p "$WORK_ROOT/dist"
GOOS="$BUILD_GOOS" GOARCH="$BUILD_GOARCH" build go build -v -trimpath \
  -o "$WORK_ROOT/dist/sing-box" \
  -tags "$BUILD_TAGS" \
  -ldflags "-X 'github.com/sagernet/sing-box/constant.Version=${VERSION}' ${LDFLAGS_SHARED} -s -w -buildid=" \
  ./cmd/sing-box

install -m 0755 "$WORK_ROOT/dist/sing-box" "$OUTPUT_DIR/sing-box-android-arm64"
sha256sum "$OUTPUT_DIR/sing-box-android-arm64" > "$OUTPUT_DIR/sing-box-android-arm64.sha256"

cat > "$OUTPUT_DIR/build-metadata.json" <<EOF
{
  "purpose": "ForwardX Dual mobile gray validation only",
  "upstreamRepository": "$UPSTREAM_REPOSITORY",
  "upstreamCommit": "$UPSTREAM_COMMIT",
  "platform": "android",
  "architecture": "arm64",
  "androidApi": 23,
  "requiredBuildTag": "with_quic",
  "buildTags": "$BUILD_TAGS",
  "runtimeActivation": false,
  "deployment": false
}
EOF

printf '\n===== Android artifact =====\n'
ls -lh "$OUTPUT_DIR/sing-box-android-arm64"
cat "$OUTPUT_DIR/sing-box-android-arm64.sha256"
cat "$OUTPUT_DIR/build-metadata.json"

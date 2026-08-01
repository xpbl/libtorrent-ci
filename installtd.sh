#!/usr/bin/env bash
set -euo pipefail

REPO="xpbl/libtorrent-ci"

INSTALL_DIR="${HOME}/.local/bin"

# --- Platform detection ---
OS="$(uname -s)"
ARCH="$(uname -m)"

case "${OS}-${ARCH}" in
  Linux-x86_64)  ASSET="td-linux-x86_64" ;;
  Darwin-arm64)  ASSET="td-macos-arm64" ;;
  *)             echo "error: unsupported platform ${OS}/${ARCH}" >&2
                 echo "  supported: Linux/x86_64, Darwin/arm64" >&2
                 exit 1 ;;
esac

# --- Find the latest td release with this platform asset ---
API="https://api.github.com/repos/${REPO}/releases"
PAGE=1
URL=""

while [ -z "$URL" ]; do
  RELEASES="$(curl -fsSL "${API}?per_page=100&page=${PAGE}")"
  [ "$RELEASES" != "[]" ] || break
  URL="$(printf '%s\n' "$RELEASES" \
    | grep -E -m1 "\"browser_download_url\"[[:space:]]*:[[:space:]]*\"https://github.com/${REPO}/releases/download/td-[^\"]+/${ASSET}\"" \
    | sed -E 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' || true)"
  PAGE=$((PAGE + 1))
done

if [ -z "$URL" ]; then
  echo "error: no ${ASSET} asset found in td-* releases for ${REPO}" >&2
  exit 1
fi

TAG="${URL#*/releases/download/}"
TAG="${TAG%%/*}"

# --- Download and install ---
mkdir -p "$INSTALL_DIR"

echo "Installing td from ${TAG}..."
curl -fsSL -o "${INSTALL_DIR}/td" "$URL"
chmod +x "${INSTALL_DIR}/td"

echo "Installed ${INSTALL_DIR}/td"
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  echo "Note: ${INSTALL_DIR} is not in your PATH."
  echo "Add this to your shell profile:"
  echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
fi

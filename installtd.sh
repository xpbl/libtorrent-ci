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

# --- Find latest td release ---
API="https://api.github.com/repos/${REPO}/releases"
TAG="$(curl -fsSL "$API" \
  | grep -m1 '"tag_name"' \
  | grep -o 'td-[^"]*')"

if [ -z "$TAG" ]; then
  echo "error: no td-* release found in ${REPO}" >&2
  exit 1
fi

# --- Download and install ---
URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"
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

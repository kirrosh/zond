#!/bin/sh
# apitool installer — downloads the latest release binary for your platform
# Usage: curl -fsSL https://raw.githubusercontent.com/kirrosh/apitool/master/install.sh | sh

set -e

REPO="kirrosh/apitool"

# Detect OS
OS=$(uname -s)
case "$OS" in
  Linux)  PLATFORM="linux" ;;
  Darwin) PLATFORM="darwin" ;;
  *)
    echo "Error: Unsupported OS: $OS"
    echo "For Windows, download the zip from https://github.com/$REPO/releases/latest"
    exit 1
    ;;
esac

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64)  ARCH_SUFFIX="x64" ;;
  arm64|aarch64)  ARCH_SUFFIX="arm64" ;;
  *)
    echo "Error: Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

TARGET="${PLATFORM}-${ARCH_SUFFIX}"
echo "Detected platform: $TARGET"

# Get latest release tag
echo "Fetching latest release..."
RELEASE_URL="https://api.github.com/repos/$REPO/releases/latest"
TAG=$(curl -fsSL "$RELEASE_URL" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"//;s/".*//')

if [ -z "$TAG" ]; then
  echo "Error: Could not determine latest release tag"
  exit 1
fi
echo "Latest release: $TAG"

# Download binary
ARTIFACT="apitool-${TARGET}.tar.gz"
DOWNLOAD_URL="https://github.com/$REPO/releases/download/$TAG/$ARTIFACT"
echo "Downloading $DOWNLOAD_URL ..."

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

curl -fsSL "$DOWNLOAD_URL" -o "$TMPDIR/$ARTIFACT"
tar -xzf "$TMPDIR/$ARTIFACT" -C "$TMPDIR"

# Install binary
BINARY="$TMPDIR/apitool"
if [ ! -f "$BINARY" ]; then
  echo "Error: Binary not found in archive"
  exit 1
fi
chmod +x "$BINARY"

# Choose install directory
INSTALL_DIR="/usr/local/bin"
if [ ! -w "$INSTALL_DIR" ]; then
  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
  echo "Installing to $INSTALL_DIR (no write access to /usr/local/bin)"
  case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *) echo "Warning: $INSTALL_DIR is not in your PATH. Add it with:"
       echo "  export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
  esac
fi

cp "$BINARY" "$INSTALL_DIR/apitool"
echo "Installed to $INSTALL_DIR/apitool"

# Verify
"$INSTALL_DIR/apitool" --version
echo "Done! Run 'apitool init' to set up a new project."

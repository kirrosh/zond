#!/bin/sh
# zond installer — downloads the latest release binary for your platform
# Usage: curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh

set -e

REPO="kirrosh/zond"

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
ARTIFACT="zond-${TARGET}.tar.gz"
DOWNLOAD_URL="https://github.com/$REPO/releases/download/$TAG/$ARTIFACT"
echo "Downloading $DOWNLOAD_URL ..."

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

curl -fsSL "$DOWNLOAD_URL" -o "$TMPDIR/$ARTIFACT"
tar -xzf "$TMPDIR/$ARTIFACT" -C "$TMPDIR"

# Install binary
BINARY="$TMPDIR/zond"
if [ ! -f "$BINARY" ]; then
  echo "Error: Binary not found in archive"
  exit 1
fi
chmod +x "$BINARY"

# Choose install directory
INSTALL_DIR="/usr/local/bin"
if [ ! -w "$INSTALL_DIR" ]; then
  # Try with sudo first
  if command -v sudo >/dev/null 2>&1; then
    echo "Need sudo to install to $INSTALL_DIR"
    sudo cp "$BINARY" "$INSTALL_DIR/zond"
    sudo chmod +x "$INSTALL_DIR/zond"
  else
    INSTALL_DIR="$HOME/.local/bin"
    mkdir -p "$INSTALL_DIR"
    cp "$BINARY" "$INSTALL_DIR/zond"
    echo "Installed to $INSTALL_DIR"

    # Add to PATH in shell profile if not already there
    case ":$PATH:" in
      *":$INSTALL_DIR:"*) ;;
      *)
        PROFILE=""
        if [ -f "$HOME/.zshrc" ]; then
          PROFILE="$HOME/.zshrc"
        elif [ -f "$HOME/.bashrc" ]; then
          PROFILE="$HOME/.bashrc"
        elif [ -f "$HOME/.profile" ]; then
          PROFILE="$HOME/.profile"
        fi

        if [ -n "$PROFILE" ]; then
          echo "" >> "$PROFILE"
          echo "# zond" >> "$PROFILE"
          echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$PROFILE"
          echo "Added $INSTALL_DIR to PATH in $PROFILE"
          echo "Run: source $PROFILE   (or open a new terminal)"
        else
          echo "Warning: $INSTALL_DIR is not in your PATH. Add it with:"
          echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
        fi
        ;;
    esac
  fi
else
  cp "$BINARY" "$INSTALL_DIR/zond"
fi

echo "Installed to $INSTALL_DIR/zond"

# macOS: `cp` adds a `com.apple.provenance` xattr that invalidates the adhoc
# codesign baked into the binary, which makes Gatekeeper SIGKILL the freshly
# installed file with exit 137 (no useful error). Strip the xattr and re-sign
# in place — adhoc is enough to satisfy Gatekeeper for local execution.
if [ "$PLATFORM" = "darwin" ]; then
  if command -v xattr >/dev/null 2>&1; then
    xattr -c "$INSTALL_DIR/zond" 2>/dev/null || sudo xattr -c "$INSTALL_DIR/zond" 2>/dev/null || true
  fi
  if command -v codesign >/dev/null 2>&1; then
    codesign --force --sign - "$INSTALL_DIR/zond" 2>/dev/null \
      || sudo codesign --force --sign - "$INSTALL_DIR/zond" 2>/dev/null \
      || echo "Warning: failed to re-sign $INSTALL_DIR/zond — may be SIGKILL'd by Gatekeeper on first run."
  fi
fi

# Verify
"$INSTALL_DIR/zond" --version
echo "Done! Run 'zond init' to set up a new project."

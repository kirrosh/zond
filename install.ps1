# zond installer for Windows — downloads the latest release binary
# Usage: iwr https://raw.githubusercontent.com/kirrosh/zond/master/install.ps1 | iex

$ErrorActionPreference = "Stop"

$REPO = "kirrosh/zond"

# Detect architecture. PROCESSOR_ARCHITECTURE reflects the current shell;
# on x64 Windows running an ARM64 build of PowerShell it'll say ARM64, etc.
switch ($env:PROCESSOR_ARCHITECTURE) {
    "AMD64" { $ARCH_SUFFIX = "x64" }
    # No win-arm64 artifact (bun has no windows-arm64 compile target);
    # Windows 11 on ARM runs the x64 binary through emulation.
    "ARM64" {
        $ARCH_SUFFIX = "x64"
        Write-Host "Note: no native ARM64 build - installing x64 (runs via Windows emulation)" -ForegroundColor Yellow
    }
    default {
        Write-Host "Error: Unsupported architecture: $env:PROCESSOR_ARCHITECTURE" -ForegroundColor Red
        exit 1
    }
}

$TARGET = "win-$ARCH_SUFFIX"
$ARTIFACT = "zond-$TARGET.zip"

Write-Host "Detected platform: $TARGET" -ForegroundColor Cyan

# Download binary. `releases/latest/download/...` avoids the api.github.com
# call and its unauthenticated rate-limit 403s (shared NAT / CI runners).
$DOWNLOAD_URL = "https://github.com/$REPO/releases/latest/download/$ARTIFACT"
Write-Host "Downloading $DOWNLOAD_URL ..." -ForegroundColor Yellow

$TEMP_DIR = [System.IO.Path]::GetTempPath()
$DOWNLOAD_PATH = Join-Path $TEMP_DIR $ARTIFACT

try {
    Invoke-WebRequest -Uri $DOWNLOAD_URL -OutFile $DOWNLOAD_PATH -UseBasicParsing
} catch {
    Write-Host "Error: Could not download release" -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit 1
}

# Extract
$EXTRACT_DIR = Join-Path $TEMP_DIR "zond-install"
if (Test-Path $EXTRACT_DIR) {
    Remove-Item $EXTRACT_DIR -Recurse -Force
}
New-Item -ItemType Directory -Path $EXTRACT_DIR | Out-Null

Write-Host "Extracting..." -ForegroundColor Yellow
Expand-Archive -Path $DOWNLOAD_PATH -DestinationPath $EXTRACT_DIR -Force

$BINARY = Join-Path $EXTRACT_DIR "zond.exe"
if (-not (Test-Path $BINARY)) {
    Write-Host "Error: Binary not found in archive" -ForegroundColor Red
    exit 1
}

# Install binary — user-local install dir mirrors the .sh fallback to
# `~/.local/bin`; no admin elevation required.
$INSTALL_DIR = "$env:LOCALAPPDATA\zond"
if (-not (Test-Path $INSTALL_DIR)) {
    New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
}

Copy-Item $BINARY $INSTALL_DIR -Force
$FINAL_PATH = Join-Path $INSTALL_DIR "zond.exe"

Write-Host "Installed to $FINAL_PATH" -ForegroundColor Green

# Add to PATH if not already there
$currentPath = [System.Environment]::GetEnvironmentVariable("Path", "User")

if ($currentPath -notlike "*$INSTALL_DIR*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$currentPath;$INSTALL_DIR", "User")
    Write-Host "Added $INSTALL_DIR to User PATH" -ForegroundColor Green
    Write-Host "Note: You may need to restart your terminal for changes to take effect" -ForegroundColor Yellow
} else {
    Write-Host "$INSTALL_DIR already in PATH" -ForegroundColor Cyan
}

# Verify
& $FINAL_PATH --version
Write-Host "Done! Run 'zond init' to set up a new project." -ForegroundColor Cyan

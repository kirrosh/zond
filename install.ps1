# apitool installer for Windows - downloads the latest release binary
# Usage: iwr https://raw.githubusercontent.com/kirrosh/apitool/master/install.ps1 | iex

$ErrorActionPreference = "Stop"

$REPO = "kirrosh/apitool"
$TARGET = "win-x64"
$ARTIFACT = "apitool-$TARGET.zip"

Write-Host "Detected platform: $TARGET" -ForegroundColor Cyan

# Get latest release tag
Write-Host "Fetching latest release..." -ForegroundColor Yellow
$RELEASE_URL = "https://api.github.com/repos/$REPO/releases/latest"
$TAG = (Invoke-RestMethod $RELEASE_URL).tag_name

if (-not $TAG) {
    Write-Host "Error: Could not determine latest release tag" -ForegroundColor Red
    exit 1
}
Write-Host "Latest release: $TAG" -ForegroundColor Green

# Download binary
$DOWNLOAD_URL = "https://github.com/$REPO/releases/download/$TAG/$ARTIFACT"
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
$EXTRACT_DIR = Join-Path $TEMP_DIR "apitool-install"
if (Test-Path $EXTRACT_DIR) {
    Remove-Item $EXTRACT_DIR -Recurse -Force
}
New-Item -ItemType Directory -Path $EXTRACT_DIR | Out-Null

Write-Host "Extracting..." -ForegroundColor Yellow
Expand-Archive -Path $DOWNLOAD_PATH -DestinationPath $EXTRACT_DIR -Force

$BINARY = Join-Path $EXTRACT_DIR "apitool.exe"
if (-not (Test-Path $BINARY)) {
    Write-Host "Error: Binary not found in archive" -ForegroundColor Red
    exit 1
}

# Install binary
$INSTALL_DIR = "$env:LOCALAPPDATA\apitool"
if (-not (Test-Path $INSTALL_DIR)) {
    New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
}

Copy-Item $BINARY $INSTALL_DIR -Force
$FINAL_PATH = Join-Path $INSTALL_DIR "apitool.exe"

Write-Host "Installed to $FINAL_PATH" -ForegroundColor Green

# Add to PATH if not already there
$PATH_ENTRY = $INSTALL_DIR
$currentPath = [System.Environment]::GetEnvironmentVariable("Path", "User")

if ($currentPath -notlike "*$PATH_ENTRY*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$currentPath;$PATH_ENTRY", "User")
    Write-Host "Added $PATH_ENTRY to User PATH" -ForegroundColor Green
    Write-Host "Note: You may need to restart your terminal for changes to take effect" -ForegroundColor Yellow
} else {
    Write-Host "$PATH_ENTRY already in PATH" -ForegroundColor Cyan
}

# Verify
& $FINAL_PATH --version
Write-Host "Done!" -ForegroundColor Green
Write-Host "Run 'apitool init' to set up a new project." -ForegroundColor Cyan

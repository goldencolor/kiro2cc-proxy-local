# kiro2cc-proxy Windows build script
# Builds admin-ui first, then compiles the Rust binary.

$ErrorActionPreference = "Stop"
$NPM_REGISTRY = "https://registry.npmmirror.com"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $SCRIPT_DIR

Write-Host "=================================================="
Write-Host "  kiro2cc-proxy build script (Windows)"
Write-Host "=================================================="

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "[!] npm not found. Install Node.js first: https://nodejs.org"
    Read-Host "Press Enter to exit"
    exit 1
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "[!] cargo not found. Install Rust first: https://rustup.rs"
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "[1/2] Building admin-ui..."
Set-Location "$SCRIPT_DIR\admin-ui"
npm install --registry $NPM_REGISTRY --progress
npm run build
Set-Location $SCRIPT_DIR
Write-Host "[*] admin-ui build complete"

Write-Host ""
Write-Host "[2/2] Compiling Rust binary..."
cargo build --release
Write-Host "[*] Build complete"

Write-Host ""
Write-Host "=================================================="
Write-Host "  Build succeeded"
Write-Host "  Binary: .\target\release\kiro2cc-proxy.exe"
Write-Host "  Run: .\run-local-service-windows.ps1"
Write-Host "=================================================="

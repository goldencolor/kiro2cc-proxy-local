#!/bin/bash
# Build script for macOS

set -eo pipefail

NPM_REGISTRY="https://registry.npmmirror.com"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

cd "$(dirname "$0")"

echo "=================================================="
echo "  kiro2cc-proxy build script"
echo "=================================================="

if ! command -v npm &>/dev/null; then
    echo "[!] npm not found. Install Node.js first."
    echo "    brew install node"
    exit 1
fi

if ! command -v cargo &>/dev/null; then
    echo "[!] cargo not found. Install Rust first."
    echo "    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

echo ""
echo "[1/2] Building admin-ui..."
cd admin-ui
log "npm install start (registry: $NPM_REGISTRY)"
npm install --registry "$NPM_REGISTRY" --progress
log "npm install done, building..."
npm run build
cd ..
log "admin-ui build complete"

echo ""
echo "[2/2] Compiling Rust binary..."
log "cargo build --release start"
cargo build --release -v
log "build complete"

echo ""
echo "=================================================="
echo "  Build succeeded"
echo "  Binary: ./target/release/kiro2cc-proxy"
echo "  Run: ./run-local-service-mac.sh"
echo "=================================================="

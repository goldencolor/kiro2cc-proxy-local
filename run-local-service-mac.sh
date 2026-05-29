#!/bin/bash
# macOS local start script for kiro2cc-proxy

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

CONFIG_DIR="$SCRIPT_DIR/app/config"
CONFIG_FILE="$CONFIG_DIR/config.json"
CREDENTIALS_FILE="$CONFIG_DIR/credentials.json"
BINARY="$SCRIPT_DIR/target/release/kiro-rs"

echo "=================================================="
echo "  kiro2cc-proxy startup script"
echo "=================================================="

setup_config() {
    echo ""
    echo "config.json not found. Initial setup is required."
    echo ""
    mkdir -p "$CONFIG_DIR"

    API_KEY_INPUT=""
    while [ -z "$API_KEY_INPUT" ]; do
        read -p "  API Key: " API_KEY_INPUT
    done

    read -p "  Admin API Key (optional): " ADMIN_KEY_INPUT

    while true; do
        read -p "  Port [default: 5678]: " input_port
        PORT_INPUT="${input_port:-5678}"
        if [[ "$PORT_INPUT" =~ ^[0-9]+$ ]] && [ "$PORT_INPUT" -ge 1024 ] && [ "$PORT_INPUT" -le 65535 ]; then
            break
        fi
        echo "  [!] Port must be between 1024 and 65535."
    done

    read -p "  Region [default: us-east-1]: " input_region
    REGION_INPUT="${input_region:-us-east-1}"

    read -p "  Local HTTP proxy port (optional): " input_proxy_port

    PROXY_BLOCK=""
    if [ -n "$input_proxy_port" ]; then
        PROXY_BLOCK=",
  \"proxyUrl\": \"http://127.0.0.1:$input_proxy_port\""
    fi

    ADMIN_BLOCK=""
    if [ -n "$ADMIN_KEY_INPUT" ]; then
        ADMIN_BLOCK=",
  \"adminApiKey\": \"$ADMIN_KEY_INPUT\""
    fi

    cat > "$CONFIG_FILE" <<EOF
{
  "host": "127.0.0.1",
  "port": $PORT_INPUT,
  "apiKey": "$API_KEY_INPUT",
  "tlsBackend": "rustls",
  "region": "$REGION_INPUT"$ADMIN_BLOCK$PROXY_BLOCK
}
EOF
    echo ""
    echo "config.json generated."
}

if [ ! -f "$BINARY" ]; then
    echo "[!] Binary not found: $BINARY"
    echo "[*] Running full build..."
    "$SCRIPT_DIR/build-mac.sh"
fi

if [ ! -f "$CONFIG_FILE" ]; then
    setup_config
elif ! grep -q '"apiKey"' "$CONFIG_FILE" 2>/dev/null; then
    echo "[!] config.json does not contain apiKey: $CONFIG_FILE"
    open "$CONFIG_FILE"
    read -p "Edit the file, then press Enter to continue..."
fi

CONFIGURED_PORT=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('port',5678))" 2>/dev/null || echo "5678")
OLD_PID=$(lsof -ti tcp:"$CONFIGURED_PORT" 2>/dev/null | head -1)
if [ -n "$OLD_PID" ]; then
    echo "[*] Port $CONFIGURED_PORT is occupied by PID $OLD_PID, stopping it..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
fi

echo "[*] Starting kiro2cc-proxy on port $CONFIGURED_PORT"
echo "[*] API endpoint: http://127.0.0.1:${CONFIGURED_PORT}/v1/messages"

has_admin=0
if grep -q '"adminApiKey"' "$CONFIG_FILE" 2>/dev/null; then
    has_admin=1
    echo "[*] Admin panel: http://127.0.0.1:${CONFIGURED_PORT}/admin"
fi
echo "=================================================="
echo ""

if [ "$has_admin" -eq 1 ]; then
    (sleep 3 && open "http://127.0.0.1:${CONFIGURED_PORT}/admin") &
fi

exec "$BINARY" --config "$CONFIG_FILE" --credentials "$CREDENTIALS_FILE"

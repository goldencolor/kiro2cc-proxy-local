#!/bin/bash
# Install aliases for kiro2cc-proxy-local in common shell profiles.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_LINE="alias build_kiro2cc_proxy='\"$SCRIPT_DIR/build-mac.sh\"'"
RUN_LINE="alias run_kiro2cc_proxy='\"$SCRIPT_DIR/run-local-service-mac.sh\"'"

ADDED=0

add_to_profile() {
    local file="$1"
    [ ! -f "$file" ] && return
    local changed=0

    if ! grep -q "build_kiro2cc_proxy" "$file"; then
        printf '\n# kiro2cc-proxy-local aliases\n%s\n' "$BUILD_LINE" >> "$file"
        echo "  [+] build_kiro2cc_proxy -> $file"
        changed=1
    else
        echo "  [~] build_kiro2cc_proxy already exists in $file"
    fi

    if ! grep -q "run_kiro2cc_proxy" "$file"; then
        printf '%s\n' "$RUN_LINE" >> "$file"
        echo "  [+] run_kiro2cc_proxy   -> $file"
        changed=1
    else
        echo "  [~] run_kiro2cc_proxy already exists in $file"
    fi

    [ "$changed" -eq 1 ] && ADDED=1
}

echo "=================================================="
echo "  kiro2cc-proxy-local alias install"
echo "=================================================="
echo ""
echo "Project dir: $SCRIPT_DIR"
echo ""

add_to_profile "$HOME/.zshrc"
add_to_profile "$HOME/.bashrc"
add_to_profile "$HOME/.bash_profile"

echo ""
if [ "$ADDED" -eq 1 ]; then
    echo "Installed. Run one of these to activate it:"
    echo ""
    echo "  source ~/.zshrc"
    echo "  source ~/.bashrc"
    echo ""
    echo "Then use:"
    echo "  build_kiro2cc_proxy"
    echo "  run_kiro2cc_proxy"
else
    echo "All aliases already exist. No changes made."
fi
echo "=================================================="

#!/bin/bash
# 一键安装 kiro2cc-proxy-local 快捷命令
# 运行后可在任意终端使用：
#   build_kiro2cc_proxy  —— 构建项目
#   run_kiro2cc_proxy    —— 启动服务

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
        echo "  [+] build_kiro2cc_proxy → $file"
        changed=1
    else
        echo "  [~] build_kiro2cc_proxy 已存在于 $file，跳过"
    fi

    if ! grep -q "run_kiro2cc_proxy" "$file"; then
        printf '%s\n' "$RUN_LINE" >> "$file"
        echo "  [+] run_kiro2cc_proxy   → $file"
        changed=1
    else
        echo "  [~] run_kiro2cc_proxy 已存在于 $file，跳过"
    fi

    [ "$changed" -eq 1 ] && ADDED=1
}

echo "=================================================="
echo "  kiro2cc-proxy-local 快捷命令安装"
echo "=================================================="
echo ""
echo "项目目录: $SCRIPT_DIR"
echo ""

add_to_profile "$HOME/.zshrc"
add_to_profile "$HOME/.bashrc"
add_to_profile "$HOME/.bash_profile"

echo ""
if [ "$ADDED" -eq 1 ]; then
    echo "✓ 安装完成！请执行以下命令使其立即生效："
    echo ""
    echo "  source ~/.zshrc    # zsh（macOS 默认）"
    echo "  source ~/.bashrc   # bash"
    echo ""
    echo "之后即可使用："
    echo "  build_kiro2cc_proxy  —— 构建项目"
    echo "  run_kiro2cc_proxy    —— 启动服务"
else
    echo "所有命令已存在，无需重新安装。"
fi
echo "=================================================="

# 一键安装 kiro2cc-proxy-local 快捷命令（Windows PowerShell）
# 运行后可在任意 PowerShell 窗口使用：
#   build_kiro2cc_proxy  —— 构建项目
#   run_kiro2cc_proxy    —— 启动服务

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$BuildScript = Join-Path $ScriptDir "build-windows.ps1"
$RunScript   = Join-Path $ScriptDir "run-local-service-windows.ps1"

$BuildFunc = "function build_kiro2cc_proxy { & `"$BuildScript`" }"
$RunFunc   = "function run_kiro2cc_proxy   { & `"$RunScript`" }"

Write-Host "=================================================="
Write-Host "  kiro2cc-proxy-local 快捷命令安装"
Write-Host "=================================================="
Write-Host ""
Write-Host "项目目录: $ScriptDir"
Write-Host ""

$ProfileDir = Split-Path -Parent $PROFILE
if (-not (Test-Path $ProfileDir)) {
    New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
}
if (-not (Test-Path $PROFILE)) {
    New-Item -ItemType File -Path $PROFILE -Force | Out-Null
    Write-Host "  [+] 已创建 PowerShell Profile: $PROFILE"
}

$ProfileContent = Get-Content $PROFILE -Raw -ErrorAction SilentlyContinue
$Added = $false

if ($ProfileContent -match "build_kiro2cc_proxy") {
    Write-Host "  [~] build_kiro2cc_proxy 已存在于 $PROFILE，跳过"
} else {
    Add-Content $PROFILE "`n# kiro2cc-proxy-local"
    Add-Content $PROFILE $BuildFunc
    Write-Host "  [+] build_kiro2cc_proxy -> $PROFILE"
    $Added = $true
}

if ($ProfileContent -match "run_kiro2cc_proxy") {
    Write-Host "  [~] run_kiro2cc_proxy 已存在于 $PROFILE，跳过"
} else {
    Add-Content $PROFILE $RunFunc
    Write-Host "  [+] run_kiro2cc_proxy   -> $PROFILE"
    $Added = $true
}

Write-Host ""
if ($Added) {
    Write-Host "✓ 安装完成！请执行以下命令使其立即生效："
    Write-Host ""
    Write-Host "  . `$PROFILE"
    Write-Host ""
    Write-Host "之后即可使用："
    Write-Host "  build_kiro2cc_proxy  —— 构建项目"
    Write-Host "  run_kiro2cc_proxy    —— 启动服务"
} else {
    Write-Host "所有命令已存在，无需重新安装。"
}
Write-Host "=================================================="

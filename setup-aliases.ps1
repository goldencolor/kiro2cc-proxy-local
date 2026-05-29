# One-click install for kiro2cc-proxy-local aliases (Windows PowerShell)
# After running, the following commands will be available in any PowerShell window:
#   build_kiro2cc_proxy
#   run_kiro2cc_proxy

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$BuildScript = Join-Path $ScriptDir "build-windows.ps1"
$RunScript   = Join-Path $ScriptDir "run-local-service-windows.ps1"

$BuildFunc = "function build_kiro2cc_proxy { & `"$BuildScript`" }"
$RunFunc   = "function run_kiro2cc_proxy   { & `"$RunScript`" }"

Write-Host "=================================================="
Write-Host "  kiro2cc-proxy-local alias install"
Write-Host "=================================================="
Write-Host ""
Write-Host "Project dir: $ScriptDir"
Write-Host ""

$ProfileDir = Split-Path -Parent $PROFILE
if (-not (Test-Path $ProfileDir)) {
    New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
}

if (-not (Test-Path $PROFILE)) {
    New-Item -ItemType File -Path $PROFILE -Force | Out-Null
    Write-Host "  [+] Created PowerShell profile: $PROFILE"
}

$ProfileContent = Get-Content $PROFILE -Raw -ErrorAction SilentlyContinue
$Added = $false

if ($ProfileContent -notmatch "build_kiro2cc_proxy") {
    Add-Content $PROFILE "`n# kiro2cc-proxy-local"
    Add-Content $PROFILE $BuildFunc
    Write-Host "  [+] build_kiro2cc_proxy -> $PROFILE"
    $Added = $true
} else {
    Write-Host "  [~] build_kiro2cc_proxy already exists in $PROFILE"
}

if ($ProfileContent -notmatch "run_kiro2cc_proxy") {
    Add-Content $PROFILE $RunFunc
    Write-Host "  [+] run_kiro2cc_proxy   -> $PROFILE"
    $Added = $true
} else {
    Write-Host "  [~] run_kiro2cc_proxy already exists in $PROFILE"
}

Write-Host ""
if ($Added) {
    Write-Host "✔ Installed. Run this to activate it now:"
    Write-Host ""
    Write-Host "  . `$PROFILE"
    Write-Host ""
    Write-Host "Then use:"
    Write-Host "  build_kiro2cc_proxy"
    Write-Host "  run_kiro2cc_proxy"
} else {
    Write-Host "All aliases already exist. No changes made."
}

Write-Host "=================================================="

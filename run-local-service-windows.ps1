# kiro2cc-proxy local start script for Windows

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $SCRIPT_DIR

$CONFIG_DIR = "$SCRIPT_DIR\app\config"
$CONFIG_FILE = "$CONFIG_DIR\config.json"
$CREDENTIALS_FILE = "$CONFIG_DIR\credentials.json"
$BINARY = "$SCRIPT_DIR\target\release\kiro2cc-proxy.exe"

Write-Host "=================================================="
Write-Host "  kiro2cc-proxy startup script (Windows)"
Write-Host "=================================================="

function Setup-Config {
    Write-Host ""
    Write-Host "config.json not found. Initial setup is required."
    Write-Host ""
    New-Item -ItemType Directory -Force -Path $CONFIG_DIR | Out-Null

    $API_KEY_INPUT = ""
    while ([string]::IsNullOrWhiteSpace($API_KEY_INPUT)) {
        $API_KEY_INPUT = Read-Host "  API Key"
    }

    $ADMIN_KEY_INPUT = Read-Host "  Admin API Key (press Enter to skip)"

    $PORT_INPUT = 5678
    while ($true) {
        $input_port = Read-Host "  Port [default: 5678]"
        if ([string]::IsNullOrWhiteSpace($input_port)) {
            $PORT_INPUT = 5678
            break
        }
        if ($input_port -match '^\d+$' -and [int]$input_port -ge 1024 -and [int]$input_port -le 65535) {
            $PORT_INPUT = [int]$input_port
            break
        }
        Write-Host "  [!] Port must be an integer between 1024 and 65535."
    }

    $input_region = Read-Host "  Region [default: us-east-1]"
    $REGION_INPUT = if ([string]::IsNullOrWhiteSpace($input_region)) { "us-east-1" } else { $input_region }

    $input_proxy_port = Read-Host "  Local HTTP proxy port (optional, press Enter to skip)"

    $config = @{
        host       = "127.0.0.1"
        port       = $PORT_INPUT
        apiKey     = $API_KEY_INPUT
        tlsBackend  = "rustls"
        region     = $REGION_INPUT
    }
    if (-not [string]::IsNullOrWhiteSpace($ADMIN_KEY_INPUT)) {
        $config.adminApiKey = $ADMIN_KEY_INPUT
    }
    if (-not [string]::IsNullOrWhiteSpace($input_proxy_port)) {
        $config.proxyUrl = "http://127.0.0.1:$input_proxy_port"
    }

    $config | ConvertTo-Json | Set-Content -Encoding UTF8 $CONFIG_FILE
    Write-Host ""
    Write-Host "config.json generated."
}

if (-not (Test-Path $BINARY)) {
    Write-Host "[!] Binary not found: $BINARY"
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        Write-Host "[!] cargo not found. Install Rust first: https://rustup.rs"
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "[*] Building release binary..."
    cargo build --release
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[!] Build failed"
        Read-Host "Press Enter to exit"
        exit 1
    }
}

if (-not (Test-Path $CONFIG_FILE)) {
    Setup-Config
}

if (-not (Select-String -Path $CONFIG_FILE -Pattern '"apiKey"' -Quiet)) {
    Write-Host "[!] config.json does not contain apiKey: $CONFIG_FILE"
    Start-Process notepad $CONFIG_FILE
    Read-Host "Edit the file, then press Enter to continue"
}

$CONFIGURED_PORT = 5678
try {
    $cfg = Get-Content $CONFIG_FILE -Raw | ConvertFrom-Json
    if ($cfg.port) { $CONFIGURED_PORT = $cfg.port }
} catch {}

$occupied = netstat -ano | Select-String "TCP.*:$CONFIGURED_PORT\s.*LISTENING" | ForEach-Object {
    ($_ -split '\s+')[-1]
} | Select-Object -First 1
if ($occupied) {
    Write-Host "[*] Port $CONFIGURED_PORT is occupied by PID $occupied, stopping it..."
    Stop-Process -Id $occupied -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

Write-Host "[*] Starting kiro2cc-proxy on port $CONFIGURED_PORT"
Write-Host "[*] API endpoint: http://127.0.0.1:${CONFIGURED_PORT}/v1/messages"

$has_admin = Select-String -Path $CONFIG_FILE -Pattern '"adminApiKey"' -Quiet
if ($has_admin) {
    Write-Host "[*] Admin panel: http://127.0.0.1:${CONFIGURED_PORT}/admin"
}
Write-Host "=================================================="
Write-Host ""

if ($has_admin) {
    Start-Job -ScriptBlock {
        param($port)
        Start-Sleep -Seconds 2
        Start-Process "http://127.0.0.1:${port}/admin"
    } -ArgumentList $CONFIGURED_PORT | Out-Null
}

& $BINARY --config $CONFIG_FILE --credentials $CREDENTIALS_FILE

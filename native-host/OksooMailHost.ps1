# OKSOOHT Security — Chrome Native Messaging Host (PowerShell)
# Chrome/Edge/Whale → Electron mail-bridge HTTP 전달
param(
    [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"

function Get-BridgeConfig {
    param([string]$Path)
    $port = 38471
    $token = ""
    if ($Path -and (Test-Path $Path)) {
        Get-Content $Path | ForEach-Object {
            if ($_ -match '^PORT=(.+)$') { $port = $Matches[1].Trim() }
            if ($_ -match '^TOKEN=(.+)$') { $token = $Matches[1].Trim() }
        }
    }
    if (-not $token) {
        # 실제 런타임 userData 폴더명은 package.json "name" 기준 "oksoo-security" (하이픈) 이므로 먼저 확인
        $tokenPath = Join-Path $env:APPDATA "oksoo-security\mail-bridge.token"
        if (-not (Test-Path $tokenPath)) {
            $tokenPath = Join-Path $env:APPDATA "OksooSecurity\mail-bridge.token"
        }
        if (Test-Path $tokenPath) { $token = (Get-Content $tokenPath -Raw).Trim() }
    }
    if ($port -eq 38471) {
        $portPath = Join-Path $env:APPDATA "oksoo-security\mail-bridge.port"
        if (-not (Test-Path $portPath)) {
            $portPath = Join-Path $env:APPDATA "OksooSecurity\mail-bridge.port"
        }
        if (Test-Path $portPath) {
            $parsed = (Get-Content $portPath -Raw).Trim()
            if ($parsed) { $port = [int]$parsed }
        }
    }
    return @{ Port = [int]$port; Token = $token }
}

function Read-ChromeMessage {
    param([System.IO.Stream]$Stream)
    $lenBuf = New-Object byte[] 4
    $read = $Stream.Read($lenBuf, 0, 4)
    if ($read -lt 4) { return $null }
    $len = [BitConverter]::ToInt32($lenBuf, 0)
    if ($len -le 0 -or $len -gt 10MB) { return $null }
    $buf = New-Object byte[] $len
    $offset = 0
    while ($offset -lt $len) {
        $n = $Stream.Read($buf, $offset, $len - $offset)
        if ($n -le 0) { break }
        $offset += $n
    }
    return [System.Text.Encoding]::UTF8.GetString($buf)
}

function Write-ChromeMessage {
    param([System.IO.Stream]$Stream, [string]$Json)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Json)
    $lenBuf = [BitConverter]::GetBytes([int32]$bytes.Length)
    $Stream.Write($lenBuf, 0, 4)
    $Stream.Write($bytes, 0, $bytes.Length)
    $Stream.Flush()
}

function Forward-ToElectron {
    param([string]$Json, [hashtable]$Config)
    try {
        $uri = "http://127.0.0.1:$($Config.Port)/mail-log"
        $headers = @{ "Content-Type" = "application/json; charset=utf-8" }
        if ($Config.Token) { $headers["x-bridge-token"] = $Config.Token }
        Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $Json -TimeoutSec 8 | Out-Null
        return $true
    } catch {
        return $false
    }
}

$stdin = [Console]::OpenStandardInput()
$stdout = [Console]::OpenStandardOutput()

if (-not $EnvFile) {
    $EnvFile = Join-Path $env:APPDATA "oksoo-security\mail-bridge.env"
    if (-not (Test-Path $EnvFile)) {
        $EnvFile = Join-Path $env:APPDATA "OksooSecurity\mail-bridge.env"
    }
    if (-not (Test-Path $EnvFile)) {
        $EnvFile = Join-Path $env:LOCALAPPDATA "oksoo-security\mail-bridge.env"
    }
    if (-not (Test-Path $EnvFile)) {
        $EnvFile = Join-Path $env:LOCALAPPDATA "OksooSecurity\mail-bridge.env"
    }
}
$config = Get-BridgeConfig -Path $EnvFile

while ($true) {
    $raw = Read-ChromeMessage -Stream $stdin
    if (-not $raw) { break }

    $response = @{ success = $false; error = "unknown" }
    try {
        $msg = $raw | ConvertFrom-Json
        if ($msg.type -eq "ping") {
            $response = @{ success = $true; pong = $true }
        } elseif ($msg.type -eq "mail_send") {
            $payload = $msg.payload
            if (-not $payload.timestamp) {
                $payload | Add-Member -NotePropertyName timestamp -NotePropertyValue ([DateTime]::UtcNow.ToString("o")) -Force
            }
            $body = ($payload | ConvertTo-Json -Depth 8 -Compress)
            $ok = Forward-ToElectron -Json $body -Config $config
            if ($ok) {
                $response = @{ success = $true }
            } else {
                $response = @{ success = $false; error = "bridge_unreachable" }
            }
        } else {
            $response = @{ success = $false; error = "invalid_type" }
        }
    } catch {
        $response = @{ success = $false; error = $_.Exception.Message }
    }

    Write-ChromeMessage -Stream $stdout -Json ($response | ConvertTo-Json -Compress)
}

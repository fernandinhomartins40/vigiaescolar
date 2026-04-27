# =============================================================================
# VigiaEscolar — Instalador do Gateway Local para dispositivo kiosk (Windows)
#
# Uso (PowerShell como Administrador):
#   .\install-kiosk-windows.ps1 `
#     -ApiUrl   "https://vigiaescolar.com.br/api" `
#     -Token    "SEU_CAMERA_GATEWAY_SERVICE_TOKEN" `
#     -GatewayId "portao-principal-01"
#
# O que faz:
#   1. Verifica Node.js 22 e FFmpeg (instrui instalação se ausentes)
#   2. Copia o camera-gateway para C:\vigia-gateway
#   3. Instala como Windows Service via NSSM (inicia no boot SEM login)
#   4. (Opcional) configura Chrome em kiosk mode no Task Scheduler
# =============================================================================

param(
  [Parameter(Mandatory=$true)]  [string]$ApiUrl,
  [Parameter(Mandatory=$true)]  [string]$Token,
  [string]$GatewayId      = "$env:COMPUTERNAME-gateway",
  [string]$UsbDevice      = "",
  [int]   $FrameIntervalMs = 5000,
  [int]   $PollIntervalMs  = 30000,
  [string]$KioskUrl       = ""
)

$ErrorActionPreference = "Stop"
$InstallDir = "C:\vigia-gateway"
$ServiceName = "VigiaGateway"
$NssmUrl = "https://nssm.cc/release/nssm-2.24.zip"

Write-Host "=== VigiaEscolar Gateway — Instalacao Windows ===" -ForegroundColor Cyan
Write-Host "API URL:    $ApiUrl"
Write-Host "Gateway ID: $GatewayId"

# ── 1. Verificar Node.js ──────────────────────────────────────────────────────

try {
  $nodeVersion = node --version 2>$null
  if (-not $nodeVersion -or -not $nodeVersion.StartsWith("v22")) {
    throw "Versao incorreta"
  }
  Write-Host "✓ Node.js $nodeVersion encontrado"
} catch {
  Write-Host "ERRO: Node.js 22 nao encontrado." -ForegroundColor Red
  Write-Host "Instale em: https://nodejs.org/en/download (versao LTS 22.x)"
  Write-Host "Apos instalar, execute este script novamente."
  exit 1
}

# ── 2. Verificar FFmpeg ───────────────────────────────────────────────────────

$ffmpegFound = $false
try {
  $null = ffmpeg -version 2>$null
  $ffmpegFound = $true
  Write-Host "✓ FFmpeg encontrado"
} catch {}

if (-not $ffmpegFound) {
  Write-Host "Baixando FFmpeg..." -ForegroundColor Yellow
  $ffmpegZip = "$env:TEMP\ffmpeg.zip"
  Invoke-WebRequest -Uri "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" -OutFile $ffmpegZip
  Expand-Archive -Path $ffmpegZip -DestinationPath "$env:TEMP\ffmpeg-extract" -Force
  $ffmpegExe = Get-ChildItem "$env:TEMP\ffmpeg-extract" -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
  Copy-Item $ffmpegExe.FullName "C:\Windows\System32\ffmpeg.exe" -Force
  Write-Host "✓ FFmpeg instalado em C:\Windows\System32"
}

# ── 3. Copiar gateway ─────────────────────────────────────────────────────────

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$GatewaySrc = Join-Path (Split-Path -Parent $ScriptDir) "apps\camera-gateway"

if (-not (Test-Path $GatewaySrc)) {
  Write-Host "ERRO: Diretorio do gateway nao encontrado em $GatewaySrc" -ForegroundColor Red
  Write-Host "Execute este script a partir do repositorio VigiaEscolar."
  exit 1
}

if (Test-Path $InstallDir) {
  Remove-Item $InstallDir -Recurse -Force
}
Copy-Item $GatewaySrc $InstallDir -Recurse

Set-Location $InstallDir
npm install --omit=dev --no-audit --prefer-offline 2>$null
npm run build 2>$null

Write-Host "✓ Gateway instalado em $InstallDir"

# ── 4. Arquivo de configuração ────────────────────────────────────────────────

$envContent = @"
VIGIA_API_URL=$ApiUrl
CAMERA_GATEWAY_SERVICE_TOKEN=$Token
CAMERA_GATEWAY_ID=$GatewayId
CAMERA_GATEWAY_LOCAL=true
CAMERA_GATEWAY_FRAME_INTERVAL_MS=$FrameIntervalMs
CAMERA_GATEWAY_POLL_INTERVAL_MS=$PollIntervalMs
CAMERA_GATEWAY_SNAPSHOT_DIR=C:\vigia-gateway\snapshots
CAMERA_GATEWAY_MAX_CONCURRENT_CAPTURES=2
FFMPEG_PATH=ffmpeg
"@

if ($UsbDevice) {
  $envContent += "`nCAMERA_USB_DEVICE=$UsbDevice"
}

$envContent | Set-Content "$InstallDir\.env" -Encoding UTF8
New-Item -ItemType Directory -Force -Path "C:\vigia-gateway\snapshots" | Out-Null

Write-Host "✓ Configuracao gravada em $InstallDir\.env"

# ── 5. Instalar como Windows Service via NSSM ─────────────────────────────────

$nssmPath = "C:\vigia-gateway\nssm.exe"
if (-not (Test-Path $nssmPath)) {
  Write-Host "Baixando NSSM..." -ForegroundColor Yellow
  $nssmZip = "$env:TEMP\nssm.zip"
  Invoke-WebRequest -Uri $NssmUrl -OutFile $nssmZip
  Expand-Archive -Path $nssmZip -DestinationPath "$env:TEMP\nssm-extract" -Force
  $nssmExe = Get-ChildItem "$env:TEMP\nssm-extract" -Recurse -Filter "nssm.exe" | Where-Object { $_.Directory.Name -eq "win64" } | Select-Object -First 1
  Copy-Item $nssmExe.FullName $nssmPath -Force
  Write-Host "✓ NSSM instalado"
}

# Remove serviço existente se houver
try { & $nssmPath stop $ServiceName 2>$null } catch {}
try { & $nssmPath remove $ServiceName confirm 2>$null } catch {}

$nodePath = (Get-Command node).Source

& $nssmPath install $ServiceName $nodePath "$InstallDir\dist\index.js"
& $nssmPath set $ServiceName AppDirectory $InstallDir
& $nssmPath set $ServiceName AppEnvironmentExtra "NODE_ENV=production"
& $nssmPath set $ServiceName DisplayName "VigiaEscolar Camera Gateway"
& $nssmPath set $ServiceName Description "Captura frames de cameras e envia para reconhecimento facial"
& $nssmPath set $ServiceName Start SERVICE_AUTO_START
& $nssmPath set $ServiceName AppStdout "C:\vigia-gateway\logs\gateway.log"
& $nssmPath set $ServiceName AppStderr "C:\vigia-gateway\logs\gateway-error.log"
& $nssmPath set $ServiceName AppRotateFiles 1
& $nssmPath set $ServiceName AppRotateSeconds 86400

New-Item -ItemType Directory -Force -Path "C:\vigia-gateway\logs" | Out-Null

# Carregar variáveis do .env para o serviço
$envLines = Get-Content "$InstallDir\.env" | Where-Object { $_ -match "^[^#]+=.+" }
foreach ($line in $envLines) {
  $key, $value = $line -split "=", 2
  & $nssmPath set $ServiceName AppEnvironmentExtra "+$key=$value"
}

& $nssmPath start $ServiceName

Write-Host "✓ Servico Windows instalado e iniciado"

# ── 6. Kiosk display no Chrome (opcional) ─────────────────────────────────────

if ($KioskUrl) {
  $chromePaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe"
  )
  $chromeExe = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

  if ($chromeExe) {
    $action = New-ScheduledTaskAction `
      -Execute $chromeExe `
      -Argument "--kiosk --app=$KioskUrl --disable-infobars --noerrdialogs --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required --no-first-run"

    $trigger = New-ScheduledTaskTrigger -AtLogon
    $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
    $principal = New-ScheduledTaskPrincipal -RunLevel Highest -LogonType Interactive

    Register-ScheduledTask `
      -TaskName "VigiaEscolar Kiosk" `
      -Action $action `
      -Trigger $trigger `
      -Settings $settings `
      -Principal $principal `
      -Force | Out-Null

    Write-Host "✓ Chrome kiosk configurado para $KioskUrl"
  } else {
    Write-Host "! Chrome nao encontrado. Instale o Google Chrome para usar o kiosk." -ForegroundColor Yellow
  }
}

# ── 7. Status ─────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "=== Instalacao concluida ===" -ForegroundColor Green
Write-Host ""
& $nssmPath status $ServiceName
Write-Host ""
Write-Host "Comandos uteis:"
Write-Host "  Get-Service $ServiceName                    # status do servico"
Write-Host "  Restart-Service $ServiceName                # reiniciar gateway"
Write-Host "  Stop-Service $ServiceName                   # parar gateway"
Write-Host "  Get-Content C:\vigia-gateway\logs\gateway.log -Tail 50  # logs"
Write-Host ""
Write-Host "Para listar cameras USB disponiveis:"
Write-Host "  ffmpeg -list_devices true -f dshow -i dummy 2>&1"

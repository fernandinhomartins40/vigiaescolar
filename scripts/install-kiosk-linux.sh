#!/usr/bin/env bash
# =============================================================================
# VigiaEscolar — Instalador do Gateway Local para dispositivo kiosk (Linux)
#
# Uso:
#   sudo bash install-kiosk-linux.sh \
#     --api-url   https://vigiaescolar.com.br/api \
#     --token     SEU_CAMERA_GATEWAY_SERVICE_TOKEN \
#     --gateway-id portao-principal-01
#
# O que faz:
#   1. Instala Node.js 22 e FFmpeg (via apt ou apk)
#   2. Copia o camera-gateway para /opt/vigia-gateway
#   3. Cria serviço systemd que inicia no boot SEM login de usuário
#   4. (Opcional) configura Chromium em kiosk mode para exibir o painel
# =============================================================================

set -euo pipefail

INSTALL_DIR="/opt/vigia-gateway"
SERVICE_NAME="vigia-gateway"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

API_URL=""
TOKEN=""
GATEWAY_ID="$(hostname)-gateway"
USB_DEVICE=""
KIOSK_URL=""
FRAME_INTERVAL_MS=5000
POLL_INTERVAL_MS=30000

usage() {
  echo "Uso: sudo $0 --api-url URL --token TOKEN [opções]"
  echo ""
  echo "Obrigatório:"
  echo "  --api-url       URL base da API (ex: https://vigiaescolar.com.br/api)"
  echo "  --token         CAMERA_GATEWAY_SERVICE_TOKEN"
  echo ""
  echo "Opcional:"
  echo "  --gateway-id    Identificador único deste gateway (default: hostname)"
  echo "  --usb-device    Dispositivo de câmera (ex: /dev/video0, default: auto)"
  echo "  --frame-interval  Intervalo entre capturas em ms (default: 5000)"
  echo "  --poll-interval   Intervalo de polling da API em ms (default: 30000)"
  echo "  --kiosk-url     URL para abrir no Chromium em kiosk (opcional)"
  exit 1
}

# Parse argumentos
while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-url)     API_URL="$2";         shift 2 ;;
    --token)       TOKEN="$2";           shift 2 ;;
    --gateway-id)  GATEWAY_ID="$2";      shift 2 ;;
    --usb-device)  USB_DEVICE="$2";      shift 2 ;;
    --frame-interval) FRAME_INTERVAL_MS="$2"; shift 2 ;;
    --poll-interval)  POLL_INTERVAL_MS="$2";  shift 2 ;;
    --kiosk-url)   KIOSK_URL="$2";       shift 2 ;;
    *) usage ;;
  esac
done

[[ -z "$API_URL" || -z "$TOKEN" ]] && usage

echo "=== VigiaEscolar Gateway — Instalação Linux ==="
echo "API URL:    $API_URL"
echo "Gateway ID: $GATEWAY_ID"
echo "Dispositivo USB: ${USB_DEVICE:-auto-detectado}"

# ── 1. Dependências ───────────────────────────────────────────────────────────

if command -v apt-get &>/dev/null; then
  apt-get update -qq
  apt-get install -y -qq ffmpeg curl

  # Node.js 22 via NodeSource
  if ! node --version 2>/dev/null | grep -q "^v22"; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
elif command -v apk &>/dev/null; then
  apk add --no-cache ffmpeg nodejs npm
fi

echo "✓ Dependências instaladas"

# ── 2. Instalar gateway ───────────────────────────────────────────────────────

mkdir -p "$INSTALL_DIR"

# Copia os arquivos do gateway a partir do diretório do script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_SRC="$(dirname "$SCRIPT_DIR")/apps/camera-gateway"

if [[ -d "$GATEWAY_SRC" ]]; then
  cp -r "$GATEWAY_SRC/." "$INSTALL_DIR/"
  cd "$INSTALL_DIR"
  npm install --omit=dev --no-audit --prefer-offline 2>/dev/null || npm install --omit=dev
  npm run build 2>/dev/null || true
  echo "✓ Gateway copiado e compilado"
else
  echo "ERRO: Diretório do gateway não encontrado em $GATEWAY_SRC"
  echo "Execute este script a partir do repositório VigiaEscolar."
  exit 1
fi

# ── 3. Arquivo de configuração (.env) ─────────────────────────────────────────

cat > "$INSTALL_DIR/.env" <<EOF
VIGIA_API_URL=${API_URL}
CAMERA_GATEWAY_SERVICE_TOKEN=${TOKEN}
CAMERA_GATEWAY_ID=${GATEWAY_ID}
CAMERA_GATEWAY_LOCAL=true
CAMERA_GATEWAY_FRAME_INTERVAL_MS=${FRAME_INTERVAL_MS}
CAMERA_GATEWAY_POLL_INTERVAL_MS=${POLL_INTERVAL_MS}
CAMERA_GATEWAY_SNAPSHOT_DIR=/var/lib/vigia-gateway/snapshots
CAMERA_GATEWAY_MAX_CONCURRENT_CAPTURES=2
FFMPEG_PATH=ffmpeg
${USB_DEVICE:+CAMERA_USB_DEVICE=${USB_DEVICE}}
EOF

chmod 600 "$INSTALL_DIR/.env"
mkdir -p /var/lib/vigia-gateway/snapshots

echo "✓ Configuração gravada em $INSTALL_DIR/.env"

# ── 4. Serviço systemd ────────────────────────────────────────────────────────

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=VigiaEscolar Camera Gateway
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=/usr/bin/node ${INSTALL_DIR}/dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=vigia-gateway

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

echo "✓ Serviço systemd instalado e iniciado"

# ── 5. Kiosk display (opcional) ───────────────────────────────────────────────

if [[ -n "$KIOSK_URL" ]]; then
  if command -v chromium-browser &>/dev/null || command -v chromium &>/dev/null; then
    CHROMIUM_BIN=$(command -v chromium-browser 2>/dev/null || command -v chromium)
    AUTOSTART_DIR="/etc/xdg/autostart"
    mkdir -p "$AUTOSTART_DIR"

    cat > "$AUTOSTART_DIR/vigia-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=VigiaEscolar Kiosk
Exec=${CHROMIUM_BIN} --kiosk --app=${KIOSK_URL} --disable-infobars --noerrdialogs --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required --no-first-run
X-GNOME-Autostart-enabled=true
EOF
    echo "✓ Kiosk Chromium configurado para $KIOSK_URL"
  else
    echo "! Chromium não encontrado. Instale-o manualmente e configure o kiosk."
  fi
fi

# ── 6. Status ─────────────────────────────────────────────────────────────────

echo ""
echo "=== Instalação concluída ==="
echo ""
systemctl status "$SERVICE_NAME" --no-pager || true
echo ""
echo "Comandos úteis:"
echo "  journalctl -u $SERVICE_NAME -f          # logs em tempo real"
echo "  systemctl status $SERVICE_NAME           # status do serviço"
echo "  systemctl restart $SERVICE_NAME          # reiniciar gateway"
echo "  systemctl stop $SERVICE_NAME             # parar gateway"
echo ""
echo "Para verificar se a câmera USB está sendo detectada:"
echo "  ffmpeg -f v4l2 -list_devices true -i dummy 2>&1 | grep video"

#!/bin/bash
set -euo pipefail

APP_DIR="/opt/vigiaescolar"
COMPOSE="docker compose -f $APP_DIR/docker-compose.prod.yml"
DOMAIN="vigiaescolar.com.br"
WWW_DOMAIN="www.vigiaescolar.com.br"
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
NGINX_CONF="/etc/nginx/sites-available/vigiaescolar"

# ─── 1. Dependências ──────────────────────────────────────────────────────────
echo "==> [1/7] Verificando dependências..."
if ! command -v docker &>/dev/null; then
  apt-get update -qq
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker --now
fi

if ! command -v nginx &>/dev/null; then
  apt-get update -qq
  apt-get install -y nginx
fi

if ! command -v certbot &>/dev/null; then
  apt-get install -y certbot python3-certbot-nginx
fi

# ─── 2. .env ──────────────────────────────────────────────────────────────────
echo "==> [2/7] Verificando .env..."
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo "AVISO: .env criado — edite /opt/vigiaescolar/.env com os valores reais."
fi

# O relay desktop publica vídeo contínuo no MediaMTX com esta credencial.
# Preserva tokens existentes; gera apenas para instalações antigas/placeholder.
if ! grep -Eq '^CAMERA_PUBLISH_TOKEN=.+$' "$APP_DIR/.env" \
  || grep -Eq '^CAMERA_PUBLISH_TOKEN=change-this-' "$APP_DIR/.env"; then
  CAMERA_PUBLISH_TOKEN="$(openssl rand -hex 24)"
  if grep -q '^CAMERA_PUBLISH_TOKEN=' "$APP_DIR/.env"; then
    sed -i "s|^CAMERA_PUBLISH_TOKEN=.*|CAMERA_PUBLISH_TOKEN=$CAMERA_PUBLISH_TOKEN|" "$APP_DIR/.env"
  else
    printf '\n# Token de publicacao do streaming ao vivo (gerado no deploy)\nCAMERA_PUBLISH_TOKEN=%s\n' \
      "$CAMERA_PUBLISH_TOKEN" >> "$APP_DIR/.env"
  fi
  echo "  CAMERA_PUBLISH_TOKEN gerado para o streaming ao vivo."
fi

# ─── 3. Nginx: config HTTP (apenas se ainda não existe config com SSL) ─────────
echo "==> [3/7] Configurando nginx..."

# Só escreve a config HTTP se o certbot ainda não gerenciou este arquivo.
# Após o primeiro certbot, ele insere blocos SSL — não sobrescrevemos mais.
if [ ! -d "$CERT_DIR" ]; then
  cat > "$NGINX_CONF" <<NGINX
server {
    listen 80;
    server_name $DOMAIN $WWW_DOMAIN;

    client_max_body_size 20m;

    # Webroot para validação do Let's Encrypt
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:7003/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location / {
        proxy_pass http://127.0.0.1:7003/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX

  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/vigiaescolar
  rm -f /etc/nginx/sites-enabled/default
  mkdir -p /var/www/certbot
  nginx -t
  systemctl enable nginx --now
  systemctl reload nginx || systemctl restart nginx
else
  # Config com SSL já existe — apenas recarrega se a sintaxe for válida
  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/vigiaescolar
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
fi

# ─── 4. SSL: emissão (primeira vez) ou renovação ─────────────────────────────
echo "==> [4/7] Gerenciando certificado SSL..."

if [ ! -d "$CERT_DIR" ]; then
  echo "  Emitindo certificado pela primeira vez..."
  certbot --nginx \
    -d "$DOMAIN" \
    -d "$WWW_DOMAIN" \
    --non-interactive \
    --agree-tos \
    --email "admin@$DOMAIN" \
    --redirect
  echo "  Certificado emitido. Config nginx atualizada pelo certbot."
else
  echo "  Certificado já existe — tentando renovação se necessário..."
  certbot renew --quiet --deploy-hook "systemctl reload nginx" || true
fi

# Garante renovação automática via cron (idempotente)
if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
  (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --deploy-hook 'systemctl reload nginx'") | crontab -
  echo "  Cron de renovação SSL configurado."
fi

# ─── 5. Docker: build e up preservando volumes ───────────────────────────────
echo "==> [5/7] Subindo serviços Docker (preservando volumes)..."
cd "$APP_DIR"

# Build das imagens sem derrubar os containers ainda
$COMPOSE build --parallel

# up -d: recria apenas containers cujas imagens mudaram.
# --remove-orphans: remove containers de serviços removidos do compose.
# Volumes nomeados são SEMPRE preservados pelo Docker (nunca deletados pelo up/down).
$COMPOSE up -d --remove-orphans

# ─── 6. Migrações Prisma ──────────────────────────────────────────────────────
echo "==> [6/7] Executando migrações do banco de dados..."

# Aguarda API estar saudável antes de migrar
MAX_WAIT=60
ELAPSED=0
until $COMPOSE exec -T api sh -c "exit 0" 2>/dev/null; do
  sleep 3
  ELAPSED=$((ELAPSED + 3))
  if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo "AVISO: container api não respondeu em ${MAX_WAIT}s, pulando migrate."
    break
  fi
done

$COMPOSE exec -T api sh -c "cd /app/apps/api && npx prisma migrate deploy" \
  && echo "  Migrações aplicadas com sucesso." \
  || echo "  AVISO: migrate falhou ou não havia migrações pendentes."

# ─── 7. Status final ──────────────────────────────────────────────────────────
echo "==> [7/7] Status dos containers..."
$COMPOSE ps

echo ""
echo "Deploy concluido!"
echo "  https://$DOMAIN"
echo "  https://$WWW_DOMAIN"

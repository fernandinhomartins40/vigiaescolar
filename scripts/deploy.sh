#!/bin/bash
set -euo pipefail

APP_DIR="/opt/vigiaescolar"
COMPOSE="docker compose -f $APP_DIR/docker-compose.prod.yml"

echo "==> [1/6] Verificando dependências..."
if ! command -v docker &>/dev/null; then
  apt-get update -qq
  curl -fsSL https://get.docker.com | sh
fi

if ! command -v certbot &>/dev/null; then
  apt-get install -y certbot python3-certbot-nginx
fi

echo "==> [2/6] Criando .env de produção (se não existir)..."
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo ""
  echo "AVISO: .env criado a partir do .env.example."
  echo "       Edite /opt/vigiaescolar/.env com os valores reais antes de continuar."
  echo ""
fi

echo "==> [3/6] Configurando nginx para os domínios..."
cat > /etc/nginx/sites-available/vigiaescolar <<'NGINX'
server {
    listen 80;
    server_name vigiaescolar.com.br www.vigiaescolar.com.br;

    client_max_body_size 20m;

    location /api/ {
        proxy_pass http://127.0.0.1:7003/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location / {
        proxy_pass http://127.0.0.1:7003/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX

ln -sf /etc/nginx/sites-available/vigiaescolar /etc/nginx/sites-enabled/vigiaescolar
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl reload nginx || systemctl restart nginx

echo "==> [4/6] Emitindo/renovando certificado SSL..."
if [ ! -d "/etc/letsencrypt/live/vigiaescolar.com.br" ]; then
  certbot --nginx \
    -d vigiaescolar.com.br \
    -d www.vigiaescolar.com.br \
    --non-interactive \
    --agree-tos \
    --email admin@vigiaescolar.com.br \
    --redirect || echo "AVISO: certbot falhou, continuando com HTTP"
else
  certbot renew --quiet --no-self-upgrade || true
fi

echo "==> [5/6] Subindo serviços Docker..."
cd "$APP_DIR"
$COMPOSE pull --ignore-pull-failures || true
$COMPOSE build --parallel
$COMPOSE up -d --remove-orphans
$COMPOSE run --rm api node -e "
  const { execSync } = require('child_process');
  execSync('npx prisma migrate deploy', { stdio: 'inherit', cwd: '/app/apps/api' });
" 2>/dev/null || \
$COMPOSE exec -T api sh -c "cd /app/apps/api && npx prisma migrate deploy" || \
echo "AVISO: migrate deploy falhou ou já está atualizado"

echo "==> [6/6] Status dos containers..."
$COMPOSE ps

echo ""
echo "✓ Deploy concluído!"
echo "  http://vigiaescolar.com.br"
echo "  https://vigiaescolar.com.br (se SSL emitido)"

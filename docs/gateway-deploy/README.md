# Deploy do Gateway Desktop na VPS

Este guia descreve como publicar uma nova versão do `apps/camera-gateway-desktop` para a URL pública `https://vigiaescolar.com.br/downloads/gateway/`.

## 1. Build na máquina Windows

```bash
cd apps/camera-gateway-desktop
npm install
npm run package:msi
```

Saída em `apps/camera-gateway-desktop/release/`:

- `VigiaEscolar-Gateway-Setup-X.Y.Z.exe` — instalador NSIS
- `latest.yml` — manifesto para auto-update
- `*.blockmap` — diff blocks para download incremental

## 2. Upload para a VPS

```bash
# Substitua a versão pela atual
VERSION=0.1.0
RELEASE_DIR=apps/camera-gateway-desktop/release

# Copia para a VPS (servida pelo nginx central):
scp $RELEASE_DIR/VigiaEscolar-Gateway-Setup-$VERSION.exe \
    $RELEASE_DIR/latest.yml \
    $RELEASE_DIR/*.blockmap \
    root@vigiaescolar.com.br:/var/www/vigiaescolar-static/downloads/gateway/
```

## 3. Configuração do nginx (uma vez)

Adicionar ao bloco `server { server_name vigiaescolar.com.br; ... }` em `/etc/nginx/sites-enabled/vigiaescolar` na VPS:

```nginx
location /downloads/ {
    alias /var/www/vigiaescolar-static/downloads/;
    autoindex on;
    autoindex_format html;

    # Permite resume e Range requests (electron-updater usa isso)
    add_header Accept-Ranges bytes;

    # CORS pra renderer pegar latest.yml
    add_header Access-Control-Allow-Origin "*";

    # Cache curto pra latest.yml, longo pra .exe
    location ~ \.yml$  { add_header Cache-Control "no-cache"; }
    location ~ \.exe$  { add_header Cache-Control "public, max-age=3600"; }
}
```

Depois:

```bash
nginx -t && systemctl reload nginx
mkdir -p /var/www/vigiaescolar-static/downloads/gateway
chown -R www-data:www-data /var/www/vigiaescolar-static/downloads
```

## 4. Verificação

```bash
curl -I https://vigiaescolar.com.br/downloads/gateway/VigiaEscolar-Gateway-Setup-0.1.0.exe
# 200 OK + Content-Length

curl https://vigiaescolar.com.br/downloads/gateway/latest.yml
# version: 0.1.0
# files: ...
```

## 5. Página HTML de download (opcional)

Pra usuário leigo, o painel já tem botão "Baixar instalador" apontando direto pro `.exe`. Mas se quiser uma página bonita, criar `/var/www/vigiaescolar-static/downloads/gateway/index.html` com instruções.

## Auto-update funcionamento

Quando o gateway desktop reinicia, ele lê `https://vigiaescolar.com.br/downloads/gateway/latest.yml` e compara com a versão local. Se houver versão maior, baixa silenciosamente o novo `.exe`, e na próxima reinicialização aplica.

Para forçar update imediato sem esperar restart do user, podemos no futuro adicionar um endpoint `POST /api/gateways/force-update` que o gateway lê via heartbeat — mas por enquanto o ciclo natural é suficiente.

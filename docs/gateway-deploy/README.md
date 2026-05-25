# Deploy do Gateway Desktop na VPS

Este guia descreve como publicar o instalador do gateway e habilitar o relay de vídeo ao vivo `DVRIP -> RTMPS -> MediaMTX`.

## 1. Build na máquina Windows

```bash
npm install
npm run gateway:installer
```

Saída em `apps/camera-gateway-desktop/release/`:

- `VigiaEscolar-Gateway-Setup-X.Y.Z.exe` — instalador NSIS
- `VigiaEscolar-Gateway-Setup.exe` — cópia estável usada pelo botão do painel
- `latest.yml` — manifesto para auto-update
- `*.blockmap` — diff blocks para download incremental

O build baixa e incorpora `go2rtc.exe` v1.9.14, que lê as câmeras XM pela porta DVRIP 34567 e publica o vídeo continuamente para a VPS. Também inclui FFmpeg como fallback: se a câmera fornecer apenas H265, o PC converte o fluxo para H264, codec exigido pela publicação RTMPS. Alterações em `apps/camera-gateway-desktop/` enviadas para `main` acionam `.github/workflows/gateway-installer.yml`, que faz esse build em Windows e publica os arquivos abaixo na VPS automaticamente.

## 2. Variáveis da VPS

No `.env` usado pelo compose, defina:

```bash
CAMERA_PUBLISH_TOKEN=<token-aleatorio-longo>
MEDIA_INGEST_SCHEME=rtmps
MEDIA_INGEST_HOST=vigiaescolar.com.br
MEDIA_INGEST_PORT=1936
```

O deploy gera `CAMERA_PUBLISH_TOKEN` automaticamente quando ele ainda não existe. O `docker-compose.prod.yml` inicia o MediaMTX com RTMPS usando o certificado Let's Encrypt existente, entrega HLS somente através da API autenticada e configura o processador facial para ler o RTSP interno.

## 3. Upload manual do instalador (fallback)

```bash
# Substitua a versão pela atual
VERSION=0.1.1
RELEASE_DIR=apps/camera-gateway-desktop/release

# Copia para a VPS (servida pelo nginx central):
scp $RELEASE_DIR/VigiaEscolar-Gateway-Setup-$VERSION.exe \
    $RELEASE_DIR/VigiaEscolar-Gateway-Setup.exe \
    $RELEASE_DIR/latest.yml \
    $RELEASE_DIR/*.blockmap \
    root@vigiaescolar.com.br:/var/www/vigiaescolar-static/downloads/gateway/

```

## 4. Configuração do nginx para downloads (uma vez)

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

## 5. Verificação

```bash
curl -I https://vigiaescolar.com.br/downloads/gateway/VigiaEscolar-Gateway-Setup-0.1.1.exe
# 200 OK + Content-Length

curl -I https://vigiaescolar.com.br/downloads/gateway/VigiaEscolar-Gateway-Setup.exe
# 200 OK; este é o link usado pelo painel

curl https://vigiaescolar.com.br/downloads/gateway/latest.yml
# version: 0.1.1
# files: ...

# Depois de parear e descobrir a câmera, o painel deve reproduzir:
# /api/cameras/<camera-id>/live/index.m3u8 (rota exige sessão web)
```

## 6. Página HTML de download (opcional)

Pra usuário leigo, o painel já tem botão "Baixar instalador" apontando direto pro `.exe`. Mas se quiser uma página bonita, criar `/var/www/vigiaescolar-static/downloads/gateway/index.html` com instruções.

## Fluxo de vídeo

1. O app desktop encontra a câmera XM por DVRIP e a API cria o cadastro vinculado à escola.
2. O `go2rtc` incluído no instalador abre o stream DVRIP contínuo e publica RTMPS em `live/<SerialNumber>`.
3. O MediaMTX expõe o mesmo fluxo como RTSP interno para reconhecimento e HLS para a API.
4. A aba **Vídeo ao Vivo** do painel carrega HLS e o processamento facial analisa frames decodificados do stream.

O MediaMTX marca a câmera online somente depois que a publicação RTMPS existe; o processador facial não abre caminhos RTSP ainda ausentes.

## Auto-update funcionamento

Quando o gateway desktop inicia, e depois a cada seis horas, ele lê `https://vigiaescolar.com.br/downloads/gateway/latest.yml` e compara com a versão local. Se houver versão maior, baixa silenciosamente o novo `.exe`, e na próxima reinicialização aplica.

Para forçar update imediato sem esperar restart do user, podemos no futuro adicionar um endpoint `POST /api/gateways/force-update` que o gateway lê via heartbeat — mas por enquanto o ciclo natural é suficiente.

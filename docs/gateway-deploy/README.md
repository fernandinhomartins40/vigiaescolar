# Deploy do VigiaEscolar Edge Desktop

O desktop agora e um app de processamento local. A VPS nao precisa receber video continuo; ela serve cadastro/sincronizacao e recebe eventos reconhecidos.

## Fluxo atual

```text
Camera XM -> DVRIP -> PC da escola
                     -> go2rtc local -> HLS local no Electron
                     -> face-api.js local
                     -> POST /api/gateways/edge/recognitions
```

## Build do instalador

```bash
npm install
npm run gateway:installer
```

Saida em `apps/camera-gateway-desktop/release/`:

- `VigiaEscolar-Gateway-Setup-X.Y.Z.exe`
- `VigiaEscolar-Gateway-Setup.exe`
- `latest.yml`
- `*.blockmap`

O workflow `.github/workflows/gateway-installer.yml` compila em Windows e publica automaticamente em:

```text
https://vigiaescolar.com.br/downloads/gateway/
```

## VPS

A VPS deve manter:

- API publica em `https://vigiaescolar.com.br/api`
- download estatico em `/downloads/gateway/`
- banco com tabelas `Gateway`, `GatewayPairingCode`, `CameraRuntimeStatus`, biometria e presenca

O MediaMTX pode continuar no compose por compatibilidade e relay remoto futuro, mas o modo edge local nao depende de transmissao RTMPS continua.

## Endpoints novos

| Metodo | Path | Auth | Uso |
|---|---|---|---|
| GET | `/api/gateways/edge/sync` | Bearer gateway | Desktop baixa cameras, embeddings e configuracoes |
| POST | `/api/gateways/edge/recognitions` | Bearer gateway | Desktop envia evento reconhecido localmente |

## Verificacao

```bash
curl https://vigiaescolar.com.br/downloads/gateway/latest.yml
# version: 0.2.0

curl https://vigiaescolar.com.br/api/health
# {"status":"ok",...}
```

No painel `Gateways`, o app atualizado deve reportar `appVersion = 0.2.0`.

## Operacao na escola

1. Instalar `VigiaEscolar-Gateway-Setup.exe`.
2. Parear com codigo do painel.
3. Clicar em `Procurar cameras agora`.
4. Clicar em `Sincronizar faces`.
5. Iniciar o reconhecimento local no app desktop.

Eventos reconhecidos entram na fila local se a internet cair e sao reenviados quando a conexao voltar.

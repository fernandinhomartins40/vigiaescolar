# VigiaEscolar Gateway (Desktop)

App Electron que roda em um PC com Windows na **mesma rede Wi-Fi das câmeras** (geralmente o computador da secretaria ou portaria). Faz a ponte entre as câmeras locais e o servidor VigiaEscolar:

```
[Câmera XM 192.168.0.x] → DVRIP → [Gateway + go2rtc no PC] → RTMPS → [MediaMTX na VPS]
                                                                           ↓
                                                                  HLS no painel + RTSP para reconhecimento
```

- Câmera fica na rede da escola, **sem precisar de port forward, sem VPN, sem hardware adicional**
- O gateway abre uma conexão **de saída** com a VPS (passa por qualquer firewall doméstico)
- Vídeo ao vivo é publicado continuamente; o reconhecimento lê o mesmo stream
- Se a câmera fornecer apenas H265, o gateway converte para H264 localmente antes da publicação
- Funciona em qualquer Windows 10 ou 11 que já exista na escola

## Pareamento (configuração inicial)

1. No painel web **vigiaescolar.com.br** → **Gateways** → **Novo gateway**
2. Gere um código de 6 dígitos (válido por 10 min)
3. No PC da escola, abra o instalador `VigiaEscolar-Gateway-Setup-X.Y.Z.exe` e instale
4. Quando o app abrir, digite o código de 6 dígitos
5. Pronto. Daqui em diante o app roda no boot, fica no tray, e procura câmeras a cada 5 min

## Desenvolvimento local

```bash
cd apps/camera-gateway-desktop
npm install
npm run dev        # abre a janela em modo dev (vite + electron)
```

Configuração persistida em `%APPDATA%/VigiaEscolar Gateway/config.json` (Windows) ou `~/.config/VigiaEscolar Gateway/config.json` (Linux).

## Build do instalador

### Pré-requisitos

- Node.js 20+
- Windows (ou WSL2 com cross-build) para gerar o `.exe`

### Build

```bash
npm install
npm run gateway:installer
```

O instalador assistido é gerado em `apps/camera-gateway-desktop/release/VigiaEscolar-Gateway-Setup-X.Y.Z.exe` (NSIS), junto com a cópia estável `VigiaEscolar-Gateway-Setup.exe` usada pelo painel. Ele instala por usuário, cria atalhos, abre o pareamento ao concluir e inicia minimizado no tray nos próximos logins do Windows.

### Assinatura digital

Sem assinatura, o SmartScreen do Windows mostra aviso na primeira execução. Para produção, comprar certificado **Code Signing** (Sectigo OV ~ R$ 800/ano) e configurar `signingHashAlgorithms` no `electron-builder.yml`.

### Publish (auto-update)

O `electron-builder.yml` está configurado para buscar updates em `https://vigiaescolar.com.br/downloads/gateway/`. Para publicar nova versão:

1. Bump da versão em `package.json`
2. `npm run gateway:installer`
3. Envie a alteração para `main`; o workflow `Publish Gateway Installer` compila no Windows e publica os `.exe`, `latest.yml` e `.blockmap` na VPS
4. Apps existentes consultam updates ao iniciar e periodicamente, baixando a nova versão para aplicação no próximo restart

## Arquitetura interna

- `src/main/index.ts` — entry point Electron, cria janela e tray
- `src/main/config.ts` — `electron-store` para persistência
- `src/main/pairing.ts` — `POST /api/gateways/pair` + helpers HTTP autenticados
- `src/main/dvrip.ts` — login e descoberta DVRIP das câmeras XM
- `src/main/lanDiscovery.ts` — varredura `/24` da subnet local a cada 5 min
- `src/main/streamRelay.ts` — inicia `go2rtc` com fonte `dvrip://`, usando FFmpeg como fallback H264, e publica vídeo contínuo via RTMPS
- `src/preload/index.ts` — ponte segura contextBridge entre main e renderer
- `src/renderer/App.tsx` — UI React (tela de pareamento + tela de status)

## Endpoints utilizados na API VigiaEscolar

| Método | Path | Auth | Uso |
|---|---|---|---|
| POST | `/api/gateways/pair` | nenhum (código) | Troca código de pareamento por Bearer token |
| POST | `/api/gateways/heartbeat` | Bearer gateway | Ping a cada 60s |
| POST | `/api/gateways/cameras/discovered` | Bearer gateway | Cadastra a câmera descoberta e retorna destino RTMPS |
| GET | `/api/cameras/:id/live/index.m3u8` | Sessão web | Reprodução HLS autenticada do vídeo ao vivo |

## Componentes de terceiros

O instalador inclui `go2rtc` para leitura DVRIP e um binário independente de `FFmpeg` GPLv3 usado somente no fallback de transcodificação H264. O FFmpeg é distribuído como programa separado e sua licença/código-fonte estão disponíveis em https://ffmpeg.org/.

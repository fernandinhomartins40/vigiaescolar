# VigiaEscolar Gateway (Desktop)

App Electron que roda em um PC com Windows na **mesma rede Wi-Fi das câmeras** (geralmente o computador da secretaria ou portaria). Faz a ponte entre as câmeras locais e o servidor VigiaEscolar:

```
[Câmera XM 192.168.0.x] → [Gateway desktop neste PC] → HTTPS → [VPS vigiaescolar.com.br]
                                                                  ↓
                                                          face-server + API
```

- Câmera fica na rede da escola, **sem precisar de port forward, sem VPN, sem hardware adicional**
- O gateway abre uma conexão **de saída** com a VPS (passa por qualquer firewall doméstico)
- Frames JPEG são enviados a cada 5 segundos para o face-server
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
cd apps/camera-gateway-desktop
npm install
npm run package:msi
```

O instalador é gerado em `release/VigiaEscolar-Gateway-Setup-0.1.0.exe` (NSIS one-click). Tamanho final ~80 MB (Electron incluído).

### Assinatura digital

Sem assinatura, o SmartScreen do Windows mostra aviso na primeira execução. Para produção, comprar certificado **Code Signing** (Sectigo OV ~ R$ 800/ano) e configurar `signingHashAlgorithms` no `electron-builder.yml`.

### Publish (auto-update)

O `electron-builder.yml` está configurado para buscar updates em `https://vigiaescolar.com.br/downloads/gateway/`. Para publicar nova versão:

1. Bump da versão em `package.json`
2. `npm run package:msi`
3. Upload do `release/*.exe`, `release/*.yml` (latest.yml) e `release/*.blockmap` para `/var/www/vigiaescolar-static/downloads/gateway/` na VPS
4. Apps existentes detectam a nova versão no próximo restart e baixam sozinhos

## Arquitetura interna

- `src/main/index.ts` — entry point Electron, cria janela e tray
- `src/main/config.ts` — `electron-store` para persistência
- `src/main/pairing.ts` — `POST /api/gateways/pair` + helpers HTTP autenticados
- `src/main/dvrip.ts` — cliente DVRIP em Node.js (header 20-byte, sofia_hash, OPSnapPicture). Ver `apps/camera-configurator/.../MainActivity.java` para a versão Java equivalente
- `src/main/lanDiscovery.ts` — varredura `/24` da subnet local a cada 5 min
- `src/main/captureLoop.ts` — captura de frame JPEG a cada 5 s por câmera + upload para `/api/gateways/frame`
- `src/preload/index.ts` — ponte segura contextBridge entre main e renderer
- `src/renderer/App.tsx` — UI React (tela de pareamento + tela de status)

## Endpoints utilizados na API VigiaEscolar

| Método | Path | Auth | Uso |
|---|---|---|---|
| POST | `/api/gateways/pair` | nenhum (código) | Troca código de pareamento por Bearer token |
| POST | `/api/gateways/heartbeat` | Bearer gateway | Ping a cada 60s |
| POST | `/api/gateways/cameras/discovered` | Bearer gateway | Envia lista de câmeras descobertas |
| POST | `/api/gateways/frame` | Bearer gateway | Upload de JPEG (Content-Type: image/jpeg) |

# VigiaEscolar Edge (Desktop)

App Electron que roda em um PC com Windows na mesma rede Wi-Fi das cameras. Ele processa video e reconhecimento facial localmente e envia para a VPS apenas eventos de entrada/saida.

```text
[Camera XM 192.168.0.x] -> DVRIP -> [VigiaEscolar Edge no PC]
                                      |-> video local no app desktop
                                      |-> face-api.js local
                                      `-> HTTPS: eventos de entrada/saida -> VPS
```

- Sem port forward, sem VPN, sem hardware adicional.
- Video ao vivo fica local no desktop.
- Reconhecimento facial roda no PC da escola.
- A VPS recebe somente eventos pequenos: aluno, camera, horario, confianca e direcao.
- Se a internet cair, eventos ficam em fila local e sincronizam depois.
- Se a camera entregar H265, o app usa FFmpeg local para gerar H264 para a tela/analise.

## Pareamento

1. No painel web `vigiaescolar.com.br` -> `Gateways` -> `Novo gateway`.
2. Gere um codigo de 6 digitos.
3. Instale `VigiaEscolar-Gateway-Setup.exe` no PC da escola.
4. Digite o codigo no app desktop.
5. Clique em `Procurar cameras agora`.
6. Clique em `Sincronizar faces`.
7. Inicie o reconhecimento local pela tela do app.

## Desenvolvimento local

```bash
cd apps/camera-gateway-desktop
npm install
npm run dev
```

Configuracao persistida em `%APPDATA%/VigiaEscolar Gateway/config.json`.

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

## Arquitetura interna

- `src/main/index.ts`: janela, tray, pareamento, auto-start e IPC.
- `src/main/dvrip.ts`: login e descoberta DVRIP das cameras XM.
- `src/main/lanDiscovery.ts`: varredura da LAN e cadastro automatico das cameras.
- `src/main/streamRelay.ts`: go2rtc local em `127.0.0.1:1984`, HLS local e fallback FFmpeg H264.
- `src/main/edgeSync.ts`: baixa referencias biometricas, mantem cache local e fila eventos offline.
- `src/renderer/EdgeRecognition.tsx`: video local + face-api.js + envio de eventos.

## Endpoints usados

| Metodo | Path | Auth | Uso |
|---|---|---|---|
| POST | `/api/gateways/pair` | codigo | Troca codigo por token do gateway |
| POST | `/api/gateways/heartbeat` | Bearer gateway | Mantem gateway online |
| POST | `/api/gateways/cameras/discovered` | Bearer gateway | Cadastra cameras descobertas |
| GET | `/api/gateways/edge/sync` | Bearer gateway | Baixa cameras, referencias faciais e configuracoes |
| POST | `/api/gateways/edge/recognitions` | Bearer gateway | Envia reconhecimento local |

## Terceiros

O instalador inclui `go2rtc` para leitura DVRIP e `FFmpeg` GPLv3 como programa separado para fallback H264. O codigo-fonte/licenca do FFmpeg estao em https://ffmpeg.org/.

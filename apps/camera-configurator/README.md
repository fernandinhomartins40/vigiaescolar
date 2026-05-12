# Vigia Camera Configurator

APK nativo Android para apoiar a instalacao de cameras Wi-Fi no Vigia Escolar.

## Funcoes da versao inicial

- Escaneia dispositivos Bluetooth LE proximos.
- Conecta em um dispositivo BLE selecionado e lista services/characteristics.
- Escaneia a rede Wi-Fi local procurando portas comuns de camera: `554`, `34567`, `80`, `8080`, `8899`, `8554`.
- Preenche o IP encontrado no formulario.
- Cadastra camera H264DVR/XM/iCSee na API do Vigia Escolar usando URL RTSP com placeholders:

```txt
rtsp://IP:554/user={username}_password={password}_channel=1_stream=0.sdp?real_stream
```

## Limite conhecido

O app ainda nao provisiona SSID/senha Wi-Fi via BLE, porque o protocolo BLE da camera precisa ser descoberto.
Use a tela Bluetooth para coletar UUIDs de services/characteristics e evoluir o fluxo de pareamento com base nesses dados.

## Seguranca

- O scan de rede roda somente quando o operador toca em "Buscar cameras na rede Wi-Fi".
- O scan se limita a rede local do celular e a portas conhecidas de camera.
- O app nao envia dados BLE para terceiros.
- O cadastro e enviado apenas para a URL da API informada pelo operador.
- A senha da camera e enviada para a API do Vigia Escolar, que ja armazena segredo criptografado.

## Build

Abra `apps/camera-configurator` no Android Studio e gere o APK:

```txt
Build > Build Bundle(s) / APK(s) > Build APK(s)
```

Ou, com Gradle/Android SDK configurado:

```bash
gradle assembleDebug
```

No Windows, se `gradle` estiver no PATH:

```powershell
.\scripts\build-debug.ps1
```

## Campos para cadastro

- URL da API: detectada automaticamente por `/api/health` em portas comuns (`3001`, `7003`, `80`, `8080`); o campo manual fica como fallback.
- E-mail/senha: credenciais de um usuario autorizado do Vigia Escolar
- Token Bearer: preenchido automaticamente pelo botao "Entrar na API"; tambem pode ser colado manualmente
- ID da escola: preenchido automaticamente quando houver uma escola, ou por selecao na lista apos o login
- IP da camera: preenchido pelo scan ou digitado manualmente
- Usuario/senha da camera: credenciais do dispositivo

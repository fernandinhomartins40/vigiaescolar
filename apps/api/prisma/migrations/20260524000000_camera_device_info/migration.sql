-- Adiciona campos de identificação física da câmera (BLE/XM iCSee)
-- usados pelo APK configurador para sincronizar câmeras com o servidor.
ALTER TABLE "Camera" ADD COLUMN "bluetoothMac" TEXT;
ALTER TABLE "Camera" ADD COLUMN "serialNumber" TEXT;
ALTER TABLE "Camera" ADD COLUMN "wifiSsid" TEXT;

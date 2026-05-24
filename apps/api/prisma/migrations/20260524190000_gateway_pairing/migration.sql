-- Tabelas Gateway e GatewayPairingCode para o app desktop VigiaEscolar Gateway
-- (apps/camera-gateway-desktop). Permite parear um PC da escola com o tenant
-- via código de 6 dígitos gerado no painel web.

CREATE TYPE "GatewayStatus" AS ENUM ('PAIRED', 'ACTIVE', 'REVOKED');

CREATE TABLE "Gateway" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "schoolId"       TEXT,
  "name"           TEXT NOT NULL,
  "tokenEncrypted" TEXT NOT NULL,
  "hostname"       TEXT,
  "platform"       TEXT,
  "arch"           TEXT,
  "appVersion"     TEXT,
  "lastSeenAt"     TIMESTAMP(3),
  "status"         "GatewayStatus" NOT NULL DEFAULT 'PAIRED',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Gateway_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Gateway_tenantId_fkey" FOREIGN KEY ("tenantId")
    REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Gateway_schoolId_fkey" FOREIGN KEY ("schoolId")
    REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Gateway_tenantId_idx" ON "Gateway"("tenantId");
CREATE INDEX "Gateway_schoolId_idx" ON "Gateway"("schoolId");

CREATE TABLE "GatewayPairingCode" (
  "code"                TEXT NOT NULL,
  "tenantId"            TEXT NOT NULL,
  "schoolId"            TEXT,
  "name"                TEXT NOT NULL,
  "expiresAt"           TIMESTAMP(3) NOT NULL,
  "consumedAt"          TIMESTAMP(3),
  "consumedByGatewayId" TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GatewayPairingCode_pkey" PRIMARY KEY ("code")
);

CREATE INDEX "GatewayPairingCode_tenantId_idx" ON "GatewayPairingCode"("tenantId");
CREATE INDEX "GatewayPairingCode_expiresAt_idx" ON "GatewayPairingCode"("expiresAt");

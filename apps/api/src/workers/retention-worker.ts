import { prisma } from "../lib/prisma";
import { addDays } from "../lib/security";

const intervalMs = Number(process.env.RETENTION_WORKER_INTERVAL_MS || 3_600_000);

function log(message: string, context?: Record<string, unknown>) {
  console.log(JSON.stringify({
    level: "info",
    service: "retention-worker",
    message,
    ...(context ?? {}),
    timestamp: new Date().toISOString(),
  }));
}

async function processRetention() {
  const settings = await prisma.tenantSettings.findMany({
    select: {
      tenantId: true,
      recordingsRetentionDays: true,
      logsRetentionDays: true,
    },
  });

  for (const item of settings) {
    const recordingsBefore = addDays(new Date(), -item.recordingsRetentionDays);
    const logsBefore = addDays(new Date(), -item.logsRetentionDays);

    const [cameraEvents, faceEvents, notifications] = await Promise.all([
      prisma.cameraEvent.deleteMany({
        where: {
          tenantId: item.tenantId,
          createdAt: { lt: recordingsBefore },
        },
      }),
      prisma.faceRecognitionEvent.deleteMany({
        where: {
          tenantId: item.tenantId,
          createdAt: { lt: recordingsBefore },
        },
      }),
      prisma.notification.deleteMany({
        where: {
          tenantId: item.tenantId,
          createdAt: { lt: logsBefore },
        },
      }),
    ]);

    log("retention_tenant_completed", {
      tenantId: item.tenantId,
      cameraEvents: cameraEvents.count,
      faceEvents: faceEvents.count,
      notifications: notifications.count,
    });
  }
}

async function main() {
  log("worker_started", { intervalMs });
  while (true) {
    await processRetention();
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({
    level: "error",
    service: "retention-worker",
    message: "worker_crashed",
    error: error instanceof Error ? error.message : String(error),
    timestamp: new Date().toISOString(),
  }));
  process.exit(1);
});

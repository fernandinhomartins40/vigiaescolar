import { NotificationChannel, NotificationStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";

const batchSize = Number(process.env.NOTIFICATION_WORKER_BATCH_SIZE || 50);
const intervalMs = Number(process.env.NOTIFICATION_WORKER_INTERVAL_MS || 30_000);
const whatsappWebhookUrl = process.env.WHATSAPP_WEBHOOK_URL?.trim() || "";

function log(message: string, context?: Record<string, unknown>) {
  console.log(JSON.stringify({
    level: "info",
    service: "notification-worker",
    message,
    ...(context ?? {}),
    timestamp: new Date().toISOString(),
  }));
}

function errorLog(message: string, context?: Record<string, unknown>) {
  console.error(JSON.stringify({
    level: "error",
    service: "notification-worker",
    message,
    ...(context ?? {}),
    timestamp: new Date().toISOString(),
  }));
}

async function deliver(notification: {
  id: string;
  channel: NotificationChannel;
  message: string;
  guardian: { whatsapp: string; email: string };
}) {
  if (notification.channel === NotificationChannel.PUSH) {
    return {
      delivered: false,
      error: "Push provider ainda nao configurado",
    };
  }

  if (!whatsappWebhookUrl) {
    return {
      delivered: false,
      error: "WHATSAPP_WEBHOOK_URL nao configurado",
    };
  }

  const response = await fetch(whatsappWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      to: notification.guardian.whatsapp,
      email: notification.guardian.email,
      message: notification.message,
      notificationId: notification.id,
    }),
  });

  if (!response.ok) {
    return {
      delivered: false,
      error: `Provider respondeu ${response.status}`,
    };
  }

  return { delivered: true, error: null };
}

async function processBatch() {
  const notifications = await prisma.notification.findMany({
    where: { status: NotificationStatus.PENDING },
    include: {
      guardian: {
        select: {
          whatsapp: true,
          email: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });

  for (const notification of notifications) {
    try {
      const result = await deliver(notification);
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: result.delivered ? NotificationStatus.SENT : NotificationStatus.FAILED,
          sentAt: result.delivered ? new Date() : null,
        },
      });
      log("notification_processed", {
        notificationId: notification.id,
        delivered: result.delivered,
        error: result.error,
      });
    } catch (error) {
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: NotificationStatus.FAILED,
          sentAt: null,
        },
      });
      errorLog("notification_failed", {
        notificationId: notification.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return notifications.length;
}

async function main() {
  log("worker_started", { intervalMs, batchSize });
  while (true) {
    await processBatch();
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

void main().catch((error) => {
  errorLog("worker_crashed", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});

import { AttendanceStatus, NotificationChannel, NotificationStatus, NotificationType, StudentStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { localDateKey } from "../lib/security";

const intervalMs = Number(process.env.ABSENCE_WORKER_INTERVAL_MS || 60_000);

function log(message: string, context?: Record<string, unknown>) {
  console.log(JSON.stringify({
    level: "info",
    service: "absence-worker",
    message,
    ...(context ?? {}),
    timestamp: new Date().toISOString(),
  }));
}

function schoolDeadlinePassed(openingTime: string, toleranceMinutes: number) {
  const [hours, minutes] = openingTime.split(":").map((value) => Number(value));
  const deadline = new Date();
  deadline.setHours(hours, minutes + toleranceMinutes, 0, 0);
  return new Date() > deadline;
}

async function processAbsences() {
  const date = localDateKey();
  const schools = await prisma.school.findMany({
    where: { isActive: true },
    include: {
      students: {
        where: { status: StudentStatus.ACTIVE },
        include: {
          guardianLinks: {
            orderBy: { createdAt: "asc" },
            include: { guardian: true },
          },
        },
      },
    },
  });

  let created = 0;
  for (const school of schools) {
    if (!schoolDeadlinePassed(school.openingTime, school.toleranceMinutes)) {
      continue;
    }

    for (const student of school.students) {
      const existing = await prisma.attendance.findUnique({
        where: {
          tenantId_studentId_date: {
            tenantId: student.tenantId,
            studentId: student.id,
            date,
          },
        },
      });

      if (existing) {
        continue;
      }

      const attendance = await prisma.attendance.create({
        data: {
          tenantId: student.tenantId,
          studentId: student.id,
          schoolId: school.id,
          date,
          status: AttendanceStatus.ABSENT,
          recognized: false,
          notified: false,
          notes: "Ausencia gerada automaticamente apos horario limite.",
        },
      });

      const guardian = student.guardianLinks.find((link) => link.guardianId === student.primaryGuardianId)?.guardian ?? student.guardianLinks[0]?.guardian;
      if (guardian) {
        await prisma.notification.create({
          data: {
            tenantId: student.tenantId,
            schoolId: school.id,
            studentId: student.id,
            guardianId: guardian.id,
            attendanceId: attendance.id,
            type: NotificationType.ABSENCE,
            channel: guardian.whatsapp ? NotificationChannel.WHATSAPP : NotificationChannel.PUSH,
            status: NotificationStatus.PENDING,
            message: `${student.name} ainda nao registrou entrada em ${school.name}.`,
          },
        });
      }

      created += 1;
    }
  }

  log("absence_batch_completed", { created });
}

async function main() {
  log("worker_started", { intervalMs });
  while (true) {
    await processAbsences();
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({
    level: "error",
    service: "absence-worker",
    message: "worker_crashed",
    error: error instanceof Error ? error.message : String(error),
    timestamp: new Date().toISOString(),
  }));
  process.exit(1);
});

import { AttendanceStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { formatTime, localDateKey } from "./security";

export async function refreshStudentPresence(tenantId: string, studentId: string) {
  const dateKey = localDateKey();
  const latest = await prisma.attendance.findFirst({
    where: { tenantId, studentId, date: dateKey },
    orderBy: { createdAt: "desc" },
  });

  if (!latest) {
    await prisma.student.update({
      where: { id: studentId },
      data: {
        currentPresence: AttendanceStatus.ABSENT,
        entryTime: null,
        exitTime: null,
      },
    });
    return;
  }

  await prisma.student.update({
    where: { id: studentId },
    data: {
      currentPresence: latest.status,
      entryTime: latest.entryAt ? formatTime(latest.entryAt) : null,
      exitTime: latest.exitAt ? formatTime(latest.exitAt) : null,
    },
  });
}

import { Router } from "express";
import { UserRole } from "@prisma/client";
import { NotificationStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, notFound, badRequest } from "../lib/http";
import { requireAuth, requireRole } from "../middleware/auth";
import { toNotificacaoDTO } from "../lib/serializers";
import {
  parseNotificationChannel,
  parseNotificationStatus,
  parseNotificationType,
} from "../lib/mappers";
import { localDateKey } from "../lib/security";
import { singleParam } from "../lib/route";

const router = Router();

router.use(requireAuth);
router.use(requireRole(UserRole.OWNER, UserRole.ADMIN, UserRole.STAFF));

const querySchema = z.object({
  q: z.string().trim().optional(),
  tipo: z.string().trim().optional(),
  status: z.string().trim().optional(),
  alunoId: z.string().trim().optional(),
  responsavelId: z.string().trim().optional(),
});

const notificationSchema = z.object({
  tipo: z.string().trim(),
  alunoId: z.string().trim().min(1),
  responsavelId: z.string().trim().min(1),
  canal: z.string().trim().default("WhatsApp"),
  status: z.string().trim().default("Entregue"),
  mensagem: z.string().trim().min(1).optional(),
  horario: z.string().trim().optional(),
});

async function ensureStudentAndGuardian(tenantId: string, studentId: string, guardianId: string) {
  const [student, guardian] = await Promise.all([
    prisma.student.findFirst({ where: { id: studentId, tenantId } }),
    prisma.guardian.findFirst({ where: { id: guardianId, tenantId } }),
  ]);

  if (!student) {
    throw badRequest("Aluno inválido");
  }

  if (!guardian) {
    throw badRequest("Responsável inválido");
  }

  const relation = await prisma.studentGuardian.findFirst({
    where: {
      tenantId,
      studentId: student.id,
      guardianId: guardian.id,
    },
  });

  if (!relation) {
    throw badRequest("Responsável não está vinculado ao aluno");
  }

  return { student, guardian };
}

async function loadNotification(tenantId: string, notificationId: string) {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, tenantId },
  });

  if (!notification) {
    throw notFound("Notificação não encontrada");
  }

  return notification;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const query: z.infer<typeof querySchema> = querySchema.parse(req.query);

    const notifications = await prisma.notification.findMany({
      where: {
        tenantId,
        ...(query.alunoId ? { studentId: query.alunoId } : {}),
        ...(query.responsavelId ? { guardianId: query.responsavelId } : {}),
        ...(query.tipo ? { type: parseNotificationType(query.tipo) } : {}),
        ...(query.status ? { status: parseNotificationStatus(query.status) } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(notifications.map(toNotificacaoDTO));
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const notificationId = singleParam(req.params.id);
    if (!notificationId) {
      throw notFound("Notificação não encontrada");
    }

    res.json(toNotificacaoDTO(await loadNotification(req.auth!.tenantId, notificationId)));
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const body = notificationSchema.parse(req.body);

    const { student, guardian } = await ensureStudentAndGuardian(
      tenantId,
      body.alunoId,
      body.responsavelId,
    );

    const notification = await prisma.notification.create({
      data: {
        tenantId,
        schoolId: student.schoolId,
        studentId: student.id,
        guardianId: guardian.id,
        type: parseNotificationType(body.tipo),
        channel: parseNotificationChannel(body.canal),
        status: parseNotificationStatus(body.status),
        sentAt: body.horario ? new Date(`${localDateKey()}T${body.horario}:00-03:00`) : new Date(),
        message: body.mensagem ?? `Notificação ${body.tipo.toLowerCase()} para ${student.name}`,
      },
    });

    res.status(201).json(toNotificacaoDTO(notification));
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const body = notificationSchema.partial().parse(req.body);
    const notificationId = singleParam(req.params.id);
    if (!notificationId) {
      throw notFound("Notificação não encontrada");
    }

    const current = await loadNotification(tenantId, notificationId);

    if (body.alunoId || body.responsavelId) {
      await ensureStudentAndGuardian(
        tenantId,
        body.alunoId ?? current.studentId,
        body.responsavelId ?? current.guardianId,
      );
    }

    const notification = await prisma.notification.update({
      where: { id: current.id },
      data: {
        type: body.tipo ? parseNotificationType(body.tipo) : current.type,
        studentId: body.alunoId ?? current.studentId,
        guardianId: body.responsavelId ?? current.guardianId,
        channel: body.canal ? parseNotificationChannel(body.canal) : current.channel,
        status: body.status ? parseNotificationStatus(body.status) : current.status,
        sentAt: body.horario ? new Date(`${localDateKey()}T${body.horario}:00-03:00`) : current.sentAt,
        message: body.mensagem ?? current.message,
      },
    });

    res.json(toNotificacaoDTO(notification));
  }),
);

router.post(
  "/:id/resend",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const notificationId = singleParam(req.params.id);
    if (!notificationId) {
      throw notFound("Notificação não encontrada");
    }

    const notification = await loadNotification(tenantId, notificationId);

    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: NotificationStatus.PENDING,
        sentAt: null,
      },
    });

    res.json(toNotificacaoDTO(updated));
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const notificationId = singleParam(req.params.id);
    if (!notificationId) {
      throw notFound("Notificação não encontrada");
    }

    const notification = await loadNotification(tenantId, notificationId);

    await prisma.notification.delete({
      where: { id: notification.id },
    });

    res.status(204).send();
  }),
);

export default router;

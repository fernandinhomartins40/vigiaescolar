import {
  AttendanceStatus,
  CameraStatus,
  CameraType,
  GuardianRelationship,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  StudentShift,
} from "@prisma/client";

export const guardianRelationshipToEnum: Record<string, GuardianRelationship> = {
  Pai: "FATHER",
  Mãe: "MOTHER",
  Avó: "GRANDMOTHER",
  Avô: "GRANDFATHER",
  Tio: "UNCLE",
  Tia: "AUNT",
  "Responsável Legal": "LEGAL_GUARDIAN",
  Outro: "OTHER",
};

export const studentShiftToEnum: Record<string, StudentShift> = {
  "Manhã": "MORNING",
  Tarde: "AFTERNOON",
  Integral: "FULL_DAY",
};

export const cameraTypeToEnum: Record<string, CameraType> = {
  IP: "IP",
  USB: "USB",
  RTSP: "RTSP",
};

export const cameraStatusToEnum: Record<string, CameraStatus> = {
  Ativa: "ACTIVE",
  Inativa: "INACTIVE",
  Manutenção: "MAINTENANCE",
};

export const attendanceStatusToEnum: Record<string, AttendanceStatus> = {
  presente: "PRESENT",
  ausente: "ABSENT",
  atrasado: "LATE",
  saiu: "LEFT",
};

export const notificationTypeToEnum: Record<string, NotificationType> = {
  Entrada: "ENTRY",
  Saída: "EXIT",
  Falta: "ABSENCE",
  Atraso: "LATE",
};

export const notificationChannelToEnum: Record<string, NotificationChannel> = {
  "PWA Push": "PUSH",
  WhatsApp: "WHATSAPP",
};

export const notificationStatusToEnum: Record<string, NotificationStatus> = {
  Entregue: "SENT",
  Falhou: "FAILED",
  Pendente: "PENDING",
};

export function requireMap<T extends string, U>(map: Record<T, U>, key: string, fallbackMessage: string): U {
  if (key in map) {
    return map[key as T];
  }

  throw new Error(fallbackMessage);
}

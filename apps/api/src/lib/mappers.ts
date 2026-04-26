import {
  AttendanceStatus,
  CameraStatus,
  CameraType,
  GuardianRelationship,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  StudentShift,
  StudentStatus,
} from "@prisma/client";
import type {
  AttendanceDTO,
  CameraDTO,
  NotificacaoDTO,
  ResponsavelDTO,
  AlunoDTO,
} from "../domain";

const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

export function parseGuardianRelationship(value: string): GuardianRelationship {
  const normalized = normalize(value);
  switch (normalized) {
    case "pai":
    case "father":
      return GuardianRelationship.FATHER;
    case "mae":
    case "mother":
      return GuardianRelationship.MOTHER;
    case "avo":
    case "grandmother":
      return GuardianRelationship.GRANDMOTHER;
    case "grandfather":
      return GuardianRelationship.GRANDFATHER;
    case "tio":
    case "uncle":
      return GuardianRelationship.UNCLE;
    case "tia":
    case "aunt":
      return GuardianRelationship.AUNT;
    case "responsavellegal":
    case "legalguardian":
      return GuardianRelationship.LEGAL_GUARDIAN;
    default:
      return GuardianRelationship.OTHER;
  }
}

export function parseStudentShift(value: string): StudentShift {
  const normalized = normalize(value);
  switch (normalized) {
    case "manha":
    case "morning":
      return StudentShift.MORNING;
    case "tarde":
    case "afternoon":
      return StudentShift.AFTERNOON;
    case "integral":
    case "fullday":
      return StudentShift.FULL_DAY;
    default:
      return StudentShift.MORNING;
  }
}

export function parseCameraType(value: string): CameraType {
  const normalized = normalize(value);
  switch (normalized) {
    case "ip":
      return CameraType.IP;
    case "usb":
      return CameraType.USB;
    default:
      return CameraType.RTSP;
  }
}

export function parseCameraStatus(value: string): CameraStatus {
  const normalized = normalize(value);
  switch (normalized) {
    case "inativa":
    case "inactive":
      return CameraStatus.INACTIVE;
    case "manutencao":
    case "maintenance":
      return CameraStatus.MAINTENANCE;
    default:
      return CameraStatus.ACTIVE;
  }
}

export function parseAttendanceStatus(value: string): AttendanceStatus {
  const normalized = normalize(value);
  switch (normalized) {
    case "presente":
    case "present":
      return AttendanceStatus.PRESENT;
    case "atrasado":
    case "late":
      return AttendanceStatus.LATE;
    case "saiu":
    case "left":
      return AttendanceStatus.LEFT;
    default:
      return AttendanceStatus.ABSENT;
  }
}

export function parseNotificationType(value: string): NotificationType {
  const normalized = normalize(value);
  switch (normalized) {
    case "entrada":
    case "entry":
      return NotificationType.ENTRY;
    case "saida":
    case "saída":
    case "exit":
      return NotificationType.EXIT;
    case "falta":
    case "absence":
      return NotificationType.ABSENCE;
    default:
      return NotificationType.LATE;
  }
}

export function parseNotificationChannel(value: string): NotificationChannel {
  const normalized = normalize(value);
  switch (normalized) {
    case "whatsapp":
      return NotificationChannel.WHATSAPP;
    default:
      return NotificationChannel.PUSH;
  }
}

export function parseNotificationStatus(value: string): NotificationStatus {
  const normalized = normalize(value);
  switch (normalized) {
    case "falhou":
    case "failed":
      return NotificationStatus.FAILED;
    case "pendente":
    case "pending":
      return NotificationStatus.PENDING;
    default:
      return NotificationStatus.SENT;
  }
}

export function parseStudentStatus(value: string): StudentStatus {
  const normalized = normalize(value);
  switch (normalized) {
    case "transferido":
    case "transferred":
      return StudentStatus.TRANSFERRED;
    case "inativo":
    case "inactive":
      return StudentStatus.INACTIVE;
    default:
      return StudentStatus.ACTIVE;
  }
}

export const attendanceStatusToLabel = {
  [AttendanceStatus.PRESENT]: "presente",
  [AttendanceStatus.ABSENT]: "ausente",
  [AttendanceStatus.LATE]: "atrasado",
  [AttendanceStatus.LEFT]: "saiu",
} satisfies Record<AttendanceStatus, AttendanceDTO["status"]>;

export const guardianRelationshipToLabel = {
  [GuardianRelationship.FATHER]: "Pai",
  [GuardianRelationship.MOTHER]: "Mãe",
  [GuardianRelationship.GRANDMOTHER]: "Avó",
  [GuardianRelationship.GRANDFATHER]: "Avô",
  [GuardianRelationship.UNCLE]: "Tio",
  [GuardianRelationship.AUNT]: "Tia",
  [GuardianRelationship.LEGAL_GUARDIAN]: "Responsável Legal",
  [GuardianRelationship.OTHER]: "Outro",
} satisfies Record<GuardianRelationship, ResponsavelDTO["parentesco"]>;

export const studentShiftToLabel = {
  [StudentShift.MORNING]: "Manhã",
  [StudentShift.AFTERNOON]: "Tarde",
  [StudentShift.FULL_DAY]: "Integral",
} satisfies Record<StudentShift, AlunoDTO["turno"]>;

export const cameraTypeToLabel = {
  [CameraType.IP]: "IP",
  [CameraType.USB]: "USB",
  [CameraType.RTSP]: "RTSP",
} satisfies Record<CameraType, CameraDTO["tipo"]>;

export const cameraStatusToLabel = {
  [CameraStatus.ACTIVE]: "Ativa",
  [CameraStatus.INACTIVE]: "Inativa",
  [CameraStatus.MAINTENANCE]: "Manutenção",
} satisfies Record<CameraStatus, CameraDTO["status"]>;

export const notificationTypeToLabel = {
  [NotificationType.ENTRY]: "Entrada",
  [NotificationType.EXIT]: "Saída",
  [NotificationType.ABSENCE]: "Falta",
  [NotificationType.LATE]: "Atraso",
} satisfies Record<NotificationType, NotificacaoDTO["tipo"]>;

export const notificationChannelToLabel = {
  [NotificationChannel.WHATSAPP]: "WhatsApp",
  [NotificationChannel.PUSH]: "PWA Push",
} satisfies Record<NotificationChannel, NotificacaoDTO["canal"]>;

export const notificationStatusToLabel = {
  [NotificationStatus.SENT]: "Entregue",
  [NotificationStatus.FAILED]: "Falhou",
  [NotificationStatus.PENDING]: "Pendente",
} satisfies Record<NotificationStatus, NotificacaoDTO["status"]>;

export const studentStatusToLabel = {
  [StudentStatus.ACTIVE]: "Ativo",
  [StudentStatus.TRANSFERRED]: "Transferido",
  [StudentStatus.INACTIVE]: "Inativo",
} satisfies Record<StudentStatus, string>;

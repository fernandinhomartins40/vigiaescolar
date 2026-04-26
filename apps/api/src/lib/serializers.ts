import type {
  AttendanceDTO,
  AlunoDTO,
  AuthResponseDTO,
  AuthSessionDTO,
  AuthUserDTO,
  CameraDTO,
  DashboardDTO,
  EscolaDTO,
  EventoCameraDTO,
  GuardianPortalChildDTO,
  GuardianPortalDTO,
  NotificacaoDTO,
  ResponsavelDTO,
  TurmaDTO,
  TenantDTO,
  TenantSettingsDTO,
} from "../domain";
import {
  attendanceStatusToLabel,
  cameraStatusToLabel,
  cameraTypeToLabel,
  guardianRelationshipToLabel,
  notificationChannelToLabel,
  notificationStatusToLabel,
  notificationTypeToLabel,
  studentShiftToLabel,
} from "./mappers";
import { avatarUrl, formatTime, logoUrl, localDateKey } from "./security";
import { prisma } from "./prisma";

type SchoolRecord = {
  id: string;
  name: string;
  cnpj: string;
  address: string;
  city: string;
  state: string;
  phone: string;
  email: string;
  logoUrl: string | null;
  openingTime: string;
  closingTime: string;
  toleranceMinutes: number;
  isActive: boolean;
};

type SchoolClassRecord = {
  id: string;
  schoolId: string;
  name: string;
  shift: string;
  isActive: boolean;
  school?: {
    name: string;
  } | null;
};

type GuardianRecord = {
  id: string;
  name: string;
  cpf: string;
  whatsapp: string;
  email: string;
  relationship: string;
  photoUrl: string | null;
  isActive: boolean;
};

type StudentRecord = {
  id: string;
  name: string;
  registrationNumber: string;
  birthDate: Date;
  schoolId: string;
  classId: string | null;
  className: string;
  shift: string;
  photoUrl: string | null;
  status: string;
  biometricEnabled: boolean;
  currentPresence: string;
  entryTime: string | null;
  exitTime: string | null;
  primaryGuardianId: string | null;
};

type CameraRecord = {
  id: string;
  name: string;
  schoolId: string;
  location: string;
  type: string;
  streamUrl: string;
  resolution: string;
  fps: number;
  status: string;
  runtimeStatus?: {
    gatewayId: string | null;
    healthStatus: string;
    lastHeartbeatAt: Date | null;
    lastFrameAt: Date | null;
    lastError: string | null;
    measuredFps: number | null;
  } | null;
};

type NotificationRecord = {
  id: string;
  studentId: string;
  guardianId: string;
  type: string;
  channel: string;
  status: string;
  sentAt: Date | null;
};

type AttendanceRecord = {
  id: string;
  studentId: string;
  schoolId: string;
  cameraId: string | null;
  date: string;
  status: string;
  entryAt: Date | null;
  exitAt: Date | null;
  recognized: boolean;
  confidence: number | null;
  notified: boolean;
};

type TenantRecord = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  isActive: boolean;
};

type UserRecord = {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  avatarUrl?: string | null;
  tenantName?: string;
  responsibleId?: string;
  schoolId?: string;
};

type SessionRecord = {
  id: string;
  expiresAt: Date;
  lastUsedAt: Date | null;
};

type SettingsRecord = {
  notifyEntry: boolean;
  notifyExit: boolean;
  notifyLate: boolean;
  notifyAbsence: boolean;
  whatsappEnabled: boolean;
  pushEnabled: boolean;
  confidenceThreshold: number;
  framesPerSecond: number;
  saveFrames: boolean;
  detectMasks: boolean;
  twoFactorEnabled: boolean;
  auditLogEnabled: boolean;
  recordingsRetentionDays: number;
  logsRetentionDays: number;
};

export function toEscolaDTO(
  school: SchoolRecord,
  counts: { students: number; cameras: number },
): EscolaDTO {
  return {
    id: school.id,
    nome: school.name,
    cnpj: school.cnpj,
    endereco: school.address,
    cidade: school.city,
    estado: school.state,
    telefone: school.phone,
    email: school.email,
    logo: school.logoUrl ?? logoUrl(school.name),
    horarioEntrada: school.openingTime,
    horarioSaida: school.closingTime,
    toleranciaMin: school.toleranceMinutes,
    ativa: school.isActive,
    totalAlunos: counts.students,
    totalCameras: counts.cameras,
  };
}

export function toTurmaDTO(
  schoolClass: SchoolClassRecord,
  counts: { students: number },
): TurmaDTO {
  return {
    id: schoolClass.id,
    nome: schoolClass.name,
    escolaId: schoolClass.schoolId,
    escolaNome: schoolClass.school?.name ?? "Escola sem nome",
    turno: studentShiftToLabel[schoolClass.shift as keyof typeof studentShiftToLabel] ?? "Manhã",
    ativa: schoolClass.isActive,
    totalAlunos: counts.students,
  };
}

export function toResponsavelDTO(
  guardian: GuardianRecord,
  childrenIds: string[],
): ResponsavelDTO {
  const relationship =
    guardian.relationship as keyof typeof guardianRelationshipToLabel;

  return {
    id: guardian.id,
    nome: guardian.name,
    cpf: guardian.cpf,
    whatsapp: guardian.whatsapp,
    email: guardian.email,
    parentesco:
      guardianRelationshipToLabel[relationship] ?? "Responsável Legal",
    foto: guardian.photoUrl ?? avatarUrl(guardian.name),
    ativo: guardian.isActive,
    filhosIds: childrenIds,
  };
}

export function toAlunoDTO(
  student: StudentRecord,
  responsaveisIds: string[],
): AlunoDTO {
  return {
    id: student.id,
    nome: student.name,
    matricula: student.registrationNumber,
    dataNascimento: student.birthDate.toISOString().slice(0, 10),
    escolaId: student.schoolId,
    turmaId: student.classId ?? undefined,
    turma: student.className,
    turno: studentShiftToLabel[student.shift as keyof typeof studentShiftToLabel] ?? "Manhã",
    foto: student.photoUrl ?? avatarUrl(student.name),
    ativo: student.status === "ACTIVE",
    responsaveisIds,
    responsavelPrincipalId: student.primaryGuardianId ?? "",
    biometriaAtiva: student.biometricEnabled,
    presencaHoje:
      attendanceStatusToLabel[student.currentPresence as keyof typeof attendanceStatusToLabel] ??
      "ausente",
    horarioEntrada: student.entryTime ?? undefined,
    horarioSaida: student.exitTime ?? undefined,
  };
}

export function toCameraDTO(camera: CameraRecord): CameraDTO {
  return {
    id: camera.id,
    nome: camera.name,
    escolaId: camera.schoolId,
    localizacao: camera.location,
    tipo: cameraTypeToLabel[camera.type as keyof typeof cameraTypeToLabel] ?? "RTSP",
    url: camera.streamUrl,
    resolucao: camera.resolution as CameraDTO["resolucao"],
    fps: camera.fps,
    status: cameraStatusToLabel[camera.status as keyof typeof cameraStatusToLabel] ?? "Ativa",
    operacional: {
      status: (camera.runtimeStatus?.healthStatus as CameraDTO["operacional"]["status"]) ?? "UNKNOWN",
      gatewayId: camera.runtimeStatus?.gatewayId ?? undefined,
      ultimoHeartbeat: camera.runtimeStatus?.lastHeartbeatAt?.toISOString(),
      ultimoFrame: camera.runtimeStatus?.lastFrameAt?.toISOString(),
      ultimoErro: camera.runtimeStatus?.lastError ?? undefined,
      fpsMedido: camera.runtimeStatus?.measuredFps ?? undefined,
    },
  };
}

export function toNotificacaoDTO(notification: NotificationRecord): NotificacaoDTO {
  return {
    id: notification.id,
    tipo: notificationTypeToLabel[notification.type as keyof typeof notificationTypeToLabel] ?? "Atraso",
    alunoId: notification.studentId,
    responsavelId: notification.guardianId,
    canal:
      notificationChannelToLabel[notification.channel as keyof typeof notificationChannelToLabel] ??
      "PWA Push",
    horario: notification.sentAt ? formatTime(notification.sentAt) : "—",
    status:
      notificationStatusToLabel[notification.status as keyof typeof notificationStatusToLabel] ??
      "Pendente",
  };
}

export function toAttendanceDTO(attendance: AttendanceRecord): AttendanceDTO {
  return {
    id: attendance.id,
    alunoId: attendance.studentId,
    escolaId: attendance.schoolId,
    cameraId: attendance.cameraId ?? undefined,
    data: attendance.date,
    status:
      attendanceStatusToLabel[attendance.status as keyof typeof attendanceStatusToLabel] ??
      "ausente",
    horarioEntrada: attendance.entryAt ? formatTime(attendance.entryAt) : undefined,
    horarioSaida: attendance.exitAt ? formatTime(attendance.exitAt) : undefined,
    reconhecido: attendance.recognized,
    confianca: attendance.confidence ?? undefined,
    notificado: attendance.notified,
  };
}

export function toEventoCameraDTO(event: {
  id: string;
  studentId: string | null;
  cameraId: string;
  happenedAt: Date;
  type: string;
  recognized: boolean;
  confidence?: number | null;
  snapshotUrl?: string | null;
}): EventoCameraDTO {
  return {
    id: event.id,
    alunoId: event.studentId ?? "",
    cameraId: event.cameraId,
    horario: formatTime(event.happenedAt),
    tipo: event.type === "ENTRY" ? "Entrou" : event.type === "EXIT" ? "Saiu" : "Desconhecido",
    reconhecido: event.recognized,
    confianca: event.confidence ?? undefined,
    snapshotUrl: event.snapshotUrl ?? undefined,
  };
}

export function toTenantDTO(tenant: TenantRecord): TenantDTO {
  return {
    id: tenant.id,
    nome: tenant.name,
    slug: tenant.slug,
    plano: tenant.plan,
    ativa: tenant.isActive,
  };
}

export function toAuthUserDTO(user: UserRecord): AuthUserDTO {
  const roleMap = {
    OWNER: "admin",
    ADMIN: "gestor",
    STAFF: "operador",
    GUARDIAN: "responsavel",
  } as const;

  const enriched = user as UserRecord & {
    tenantName?: string;
    responsibleId?: string;
    schoolId?: string;
  };

  return {
    id: user.id,
    nome: user.name,
    email: user.email,
    role: roleMap[user.role as keyof typeof roleMap] ?? "operador",
    tenantId: user.tenantId,
    tenantNome: enriched.tenantName,
    avatar: user.avatarUrl ?? avatarUrl(user.name),
    responsibleId: enriched.responsibleId,
    schoolId: enriched.schoolId,
    ativo: user.isActive,
  };
}

export function toAuthSessionDTO(session: SessionRecord): AuthSessionDTO {
  return {
    id: session.id,
    expiresAt: session.expiresAt.toISOString(),
    lastUsedAt: session.lastUsedAt?.toISOString(),
  };
}

export function toAuthResponseDTO(params: {
  user: UserRecord;
  tenant: TenantRecord;
  session: SessionRecord;
  accessToken?: string;
}): AuthResponseDTO {
  return {
    user: toAuthUserDTO(params.user),
    tenant: toTenantDTO(params.tenant),
    session: toAuthSessionDTO(params.session),
    accessToken: params.accessToken,
  };
}

export function toTenantSettingsDTO(settings: SettingsRecord): TenantSettingsDTO {
  return {
    notifications: {
      notifyEntry: settings.notifyEntry,
      notifyExit: settings.notifyExit,
      notifyLate: settings.notifyLate,
      notifyAbsence: settings.notifyAbsence,
      whatsapp: settings.whatsappEnabled,
      push: settings.pushEnabled,
    },
    recognition: {
      confidenceThreshold: settings.confidenceThreshold,
      framesPerSecond: settings.framesPerSecond,
      saveFrames: settings.saveFrames,
      detectMasks: settings.detectMasks,
    },
    security: {
      twoFactor: settings.twoFactorEnabled,
      auditLog: settings.auditLogEnabled,
    },
    retention: {
      recordingsDays: settings.recordingsRetentionDays,
      logsDays: settings.logsRetentionDays,
    },
  };
}

export function toGuardianPortalDTO(params: {
  guardian: GuardianRecord;
  children: Array<{
    student: StudentRecord;
    school: SchoolRecord;
    responsaveisIds: string[];
    timeline: GuardianPortalChildDTO["timeline"];
  }>;
  recentNotifications: NotificationRecord[];
  latestEvent?: {
    id: string;
    studentId: string | null;
    cameraId: string;
    happenedAt: Date;
    type: string;
    recognized: boolean;
  };
}): GuardianPortalDTO {
  const guardianDTO = toResponsavelDTO(params.guardian, []);

  return {
    guardian: guardianDTO,
    children: params.children.map((child) => ({
      ...toAlunoDTO(child.student, child.responsaveisIds),
      escolaNome: child.school.name,
      timeline: child.timeline,
    })),
    recentNotifications: params.recentNotifications.map(toNotificacaoDTO),
    latestEvent: params.latestEvent ? toEventoCameraDTO(params.latestEvent) : undefined,
  };
}

export async function buildSchoolDTOs(tenantId: string, schools: SchoolRecord[]) {
  const studentCounts = await prisma.student.groupBy({
    by: ["schoolId"],
    where: { tenantId },
    _count: { schoolId: true },
  });

  const cameraCounts = await prisma.camera.groupBy({
    by: ["schoolId"],
    where: { tenantId },
    _count: { schoolId: true },
  });

  const studentMap = new Map(studentCounts.map((item) => [item.schoolId, item._count.schoolId]));
  const cameraMap = new Map(cameraCounts.map((item) => [item.schoolId, item._count.schoolId]));

  return schools.map((school) =>
    toEscolaDTO(school, {
      students: studentMap.get(school.id) ?? 0,
      cameras: cameraMap.get(school.id) ?? 0,
    }),
  );
}

export async function buildTurmaDTOs(tenantId: string, classes: SchoolClassRecord[]) {
  const studentCounts = await prisma.student.groupBy({
    by: ["classId"],
    where: { tenantId, classId: { not: null } },
    _count: { classId: true },
  });

  const studentMap = new Map(studentCounts.map((item) => [item.classId ?? "", item._count.classId]));

  return classes.map((schoolClass) =>
    toTurmaDTO(schoolClass, {
      students: studentMap.get(schoolClass.id) ?? 0,
    }),
  );
}

export function buildDashboardDTO(params: {
  resumo: DashboardDTO["resumo"];
  schools: EscolaDTO[];
  students: AlunoDTO[];
  events: EventoCameraDTO[];
  attendanceSeries: DashboardDTO["entradasPorHora"];
  cameras: CameraDTO[];
  notifications: NotificacaoDTO[];
  classAttendance: DashboardDTO["classAttendance"];
}): DashboardDTO {
  return {
    resumo: params.resumo,
    escolas: params.schools,
    alunos: params.students,
    eventosHoje: params.events,
    entradasPorHora: params.attendanceSeries,
    cameras: params.cameras,
    notificacoes: params.notifications,
    classAttendance: params.classAttendance,
  };
}

export type SerializedSchool = SchoolRecord;
export type SerializedGuardian = GuardianRecord;
export type SerializedStudent = StudentRecord;
export type SerializedCamera = CameraRecord;
export type SerializedNotification = NotificationRecord;
export type SerializedAttendance = AttendanceRecord;
export type SerializedTenant = TenantRecord;
export type SerializedUser = UserRecord;
export type SerializedSession = SessionRecord;
export type SerializedSettings = SettingsRecord;

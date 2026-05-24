import {
  AttendanceStatus,
  CameraStatus,
  CameraType,
  GuardianRelationship,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  StudentShift,
  UserRole,
} from "@prisma/client";

export type EscolaDTO = {
  id: string;
  nome: string;
  cnpj: string;
  endereco: string;
  cidade: string;
  estado: string;
  telefone: string;
  email: string;
  logo: string;
  horarioEntrada: string;
  horarioSaida: string;
  toleranciaMin: number;
  ativa: boolean;
  totalAlunos: number;
  totalCameras: number;
};

export type TurmaDTO = {
  id: string;
  nome: string;
  escolaId: string;
  escolaNome: string;
  turno: "Manhã" | "Tarde" | "Integral";
  ativa: boolean;
  totalAlunos: number;
};

export type ResponsavelDTO = {
  id: string;
  nome: string;
  cpf: string;
  whatsapp: string;
  email: string;
  parentesco: "Pai" | "Mãe" | "Avó" | "Avô" | "Tio" | "Tia" | "Responsável Legal" | "Outro";
  foto: string;
  ativo: boolean;
  filhosIds: string[];
};

export type AlunoDTO = {
  id: string;
  nome: string;
  matricula: string;
  dataNascimento: string;
  escolaId: string;
  turmaId?: string;
  turma: string;
  turno: "Manhã" | "Tarde" | "Integral";
  foto: string;
  ativo: boolean;
  responsaveisIds: string[];
  responsavelPrincipalId: string;
  biometriaAtiva: boolean;
  presencaHoje: "presente" | "ausente" | "atrasado" | "saiu";
  horarioEntrada?: string;
  horarioSaida?: string;
};

export type CameraDTO = {
  id: string;
  nome: string;
  escolaId: string;
  localizacao: string;
  tipo: "IP" | "USB" | "RTSP";
  url: string;
  resolucao: "720p" | "1080p" | "4K";
  fps: number;
  status: "Ativa" | "Inativa" | "Manutenção";
  // Identificadores físicos da câmera (opcionais — preenchidos pelo APK configurador)
  bluetoothMac?: string;
  serialNumber?: string;
  wifiSsid?: string;
  operacional: {
    status: "ONLINE" | "OFFLINE" | "DEGRADED" | "ERROR" | "UNKNOWN";
    gatewayId?: string;
    ultimoHeartbeat?: string;
    ultimoFrame?: string;
    ultimoErro?: string;
    fpsMedido?: number;
  };
};

export type EventoCameraDTO = {
  id: string;
  alunoId: string;
  cameraId: string;
  horario: string;
  tipo: "Entrou" | "Saiu" | "Desconhecido";
  reconhecido: boolean;
  confianca?: number;
  snapshotUrl?: string;
};

export type NotificacaoDTO = {
  id: string;
  tipo: "Entrada" | "Saída" | "Falta" | "Atraso";
  alunoId: string;
  responsavelId: string;
  canal: "PWA Push" | "WhatsApp";
  horario: string;
  status: "Entregue" | "Falhou" | "Pendente";
};

export type AttendanceDTO = {
  id: string;
  alunoId: string;
  escolaId: string;
  cameraId?: string;
  data: string;
  status: "presente" | "ausente" | "atrasado" | "saiu";
  horarioEntrada?: string;
  horarioSaida?: string;
  reconhecido: boolean;
  confianca?: number;
  notificado: boolean;
};

export type AttendanceSeriesDTO = {
  hora: string;
  entradas: number;
};

export type ClassAttendanceDTO = {
  turma: string;
  escola: string;
  total: number;
  presentes: number;
  pct: number;
};

export type TenantSettingsDTO = {
  notifications: {
    notifyEntry: boolean;
    notifyExit: boolean;
    notifyLate: boolean;
    notifyAbsence: boolean;
    whatsapp: boolean;
    push: boolean;
  };
  recognition: {
    confidenceThreshold: number;
    framesPerSecond: number;
    saveFrames: boolean;
    detectMasks: boolean;
  };
  security: {
    twoFactor: boolean;
    auditLog: boolean;
  };
  retention: {
    recordingsDays: number;
    logsDays: number;
  };
};

export type TenantDTO = {
  id: string;
  nome: string;
  slug: string;
  plano: string;
  ativa: boolean;
};

export type AuthUserDTO = {
  id: string;
  nome: string;
  email: string;
  role: "admin" | "gestor" | "operador" | "responsavel";
  tenantId: string;
  tenantNome?: string;
  avatar?: string;
  responsibleId?: string;
  schoolId?: string;
  ativo: boolean;
};

export type AuthSessionDTO = {
  id: string;
  expiresAt: string;
  lastUsedAt?: string;
};

export type AuthResponseDTO = {
  user: AuthUserDTO;
  tenant: TenantDTO;
  session: AuthSessionDTO;
  accessToken?: string;
};

export type DashboardDTO = {
  resumo: {
    escolas: number;
    alunos: number;
    presentesHoje: number;
    ausentesHoje: number;
    camerasAtivas: number;
    notificacoesPendentes: number;
  };
  escolas: EscolaDTO[];
  alunos: AlunoDTO[];
  eventosHoje: EventoCameraDTO[];
  entradasPorHora: AttendanceSeriesDTO[];
  cameras: CameraDTO[];
  notificacoes: NotificacaoDTO[];
  classAttendance: ClassAttendanceDTO[];
};

export type GuardianPortalChildDTO = AlunoDTO & {
  escolaNome: string;
  timeline: Array<{
    horario: string;
    tipo: "Entrou" | "Saiu" | "Sem registro";
    descricao: string;
  }>;
};

export type GuardianPortalDTO = {
  guardian: ResponsavelDTO;
  children: GuardianPortalChildDTO[];
  recentNotifications: NotificacaoDTO[];
  latestEvent?: EventoCameraDTO;
};

export const guardianRelationshipLabels: Record<GuardianRelationship, ResponsavelDTO["parentesco"]> = {
  FATHER: "Pai",
  MOTHER: "Mãe",
  GRANDMOTHER: "Avó",
  GRANDFATHER: "Avô",
  UNCLE: "Tio",
  AUNT: "Tia",
  LEGAL_GUARDIAN: "Responsável Legal",
  OTHER: "Outro",
};

export const studentShiftLabels: Record<StudentShift, AlunoDTO["turno"]> = {
  MORNING: "Manhã",
  AFTERNOON: "Tarde",
  FULL_DAY: "Integral",
};

export const cameraTypeLabels: Record<CameraType, CameraDTO["tipo"]> = {
  IP: "IP",
  USB: "USB",
  RTSP: "RTSP",
};

export const cameraStatusLabels: Record<CameraStatus, CameraDTO["status"]> = {
  ACTIVE: "Ativa",
  INACTIVE: "Inativa",
  MAINTENANCE: "Manutenção",
};

export const attendanceStatusLabels: Record<AttendanceStatus, AttendanceDTO["status"]> = {
  PRESENT: "presente",
  ABSENT: "ausente",
  LATE: "atrasado",
  LEFT: "saiu",
};

export const notificationTypeLabels: Record<NotificationType, NotificacaoDTO["tipo"]> = {
  ENTRY: "Entrada",
  EXIT: "Saída",
  ABSENCE: "Falta",
  LATE: "Atraso",
};

export const notificationChannelLabels: Record<NotificationChannel, NotificacaoDTO["canal"]> = {
  WHATSAPP: "WhatsApp",
  PUSH: "PWA Push",
};

export const notificationStatusLabels: Record<NotificationStatus, NotificacaoDTO["status"]> = {
  SENT: "Entregue",
  FAILED: "Falhou",
  PENDING: "Pendente",
};

export const userRoleLabels: Record<UserRole, string> = {
  OWNER: "Proprietário",
  ADMIN: "Administrador",
  STAFF: "Operador",
  GUARDIAN: "Responsável",
};

export const labels = {
  guardianRelationshipLabels,
  studentShiftLabels,
  cameraTypeLabels,
  cameraStatusLabels,
  attendanceStatusLabels,
  notificationTypeLabels,
  notificationChannelLabels,
  notificationStatusLabels,
  userRoleLabels,
};

export type TenantSettingsShape = TenantSettingsDTO;

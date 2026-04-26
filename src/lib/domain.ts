export type Relationship =
  | "Pai"
  | "Mãe"
  | "Avó"
  | "Avô"
  | "Tio"
  | "Tia"
  | "Responsável Legal"
  | "Outro";

export type Shift = "Manhã" | "Tarde" | "Integral";

export type StudentPresence = "presente" | "ausente" | "atrasado" | "saiu";

export type CameraStatus = "Ativa" | "Inativa" | "Manutenção";

export type CameraType = "IP" | "USB" | "RTSP";

export type CameraResolution = "720p" | "1080p" | "4K";

export type NotificationType = "Entrada" | "Saída" | "Falta" | "Atraso";

export type NotificationStatus = "Entregue" | "Falhou" | "Pendente";

export type NotificationChannel = "PWA Push" | "WhatsApp";

export type UserRole = "admin" | "gestor" | "operador" | "responsavel";

export type Escola = {
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
  tenantId?: string;
};

export type Turma = {
  id: string;
  nome: string;
  escolaId: string;
  escolaNome: string;
  turno: Shift;
  ativa: boolean;
  totalAlunos: number;
  tenantId?: string;
};

export type Responsavel = {
  id: string;
  nome: string;
  cpf: string;
  whatsapp: string;
  email: string;
  parentesco: Relationship;
  foto: string;
  ativo: boolean;
  filhosIds: string[];
  tenantId?: string;
};

export type Aluno = {
  id: string;
  nome: string;
  matricula: string;
  dataNascimento: string;
  escolaId: string;
  turmaId?: string;
  turma: string;
  turno: Shift;
  foto: string;
  ativo: boolean;
  responsaveisIds: string[];
  responsavelPrincipalId: string;
  biometriaAtiva: boolean;
  presencaHoje: StudentPresence;
  horarioEntrada?: string;
  horarioSaida?: string;
  tenantId?: string;
};

export type Camera = {
  id: string;
  nome: string;
  escolaId: string;
  localizacao: string;
  tipo: CameraType;
  url: string;
  resolucao: CameraResolution;
  fps: number;
  status: CameraStatus;
  operacional?: {
    status: "ONLINE" | "OFFLINE" | "DEGRADED" | "ERROR" | "UNKNOWN";
    gatewayId?: string;
    ultimoHeartbeat?: string;
    ultimoFrame?: string;
    ultimoErro?: string;
    fpsMedido?: number;
  };
  usuario?: string;
  senha?: string;
  tenantId?: string;
};

export type BiometricRecognitionEmbedding = {
  id: string;
  modelName: string;
  modelVersion?: string | null;
  vector: number[];
  qualityScore?: number | null;
  isActive: boolean;
  createdAt: string;
};

export type BiometricRecognitionStudent = {
  id: string;
  nome: string;
  escolaId: string;
  foto: string;
  ativo: boolean;
  biometriaAtiva: boolean;
};

export type BiometricRecognitionReference = {
  id: string;
  tenantId: string;
  studentId: string;
  schoolId: string;
  label: string;
  isActive: boolean;
  student: BiometricRecognitionStudent | null;
  school: {
    id: string;
    nome: string;
  } | null;
  embeddings: BiometricRecognitionEmbedding[];
  totalEmbeddings: number;
  createdAt: string;
  updatedAt: string;
};

export type BiometricRecognitionEvent = {
  id: string;
  tenantId: string;
  schoolId: string;
  cameraId?: string | null;
  studentId?: string | null;
  identityId?: string | null;
  type: "ENTRY" | "EXIT" | "UNKNOWN";
  matchStatus: "MATCHED" | "REVIEW_REQUIRED" | "UNMATCHED";
  confidence?: number | null;
  reviewReason?: string | null;
  snapshotPath?: string | null;
  recognizedAt: string;
  student?: {
    id: string;
    name: string;
    photoUrl?: string | null;
    className?: string;
  } | null;
  school?: {
    id: string;
    name: string;
  } | null;
  camera?: {
    id: string;
    name: string;
    location: string;
  } | null;
};

export type EventoCamera = {
  id: string;
  alunoId: string;
  cameraId: string;
  horario: string;
  tipo: "Entrou" | "Saiu" | "Desconhecido";
  reconhecido: boolean;
  confianca?: number;
  snapshotUrl?: string;
  tenantId?: string;
};

export type Notificacao = {
  id: string;
  tipo: NotificationType;
  alunoId: string;
  responsavelId: string;
  canal: NotificationChannel;
  horario: string;
  status: NotificationStatus;
  tenantId?: string;
};

export type GuardianPortalChild = Aluno & {
  escolaNome: string;
  timeline: Array<{
    horario: string;
    tipo: "Entrou" | "Saiu" | "Sem registro";
    descricao: string;
  }>;
};

export type GuardianPortal = {
  guardian: Responsavel;
  children: GuardianPortalChild[];
  recentNotifications: Notificacao[];
  latestEvent?: EventoCamera;
};

export type AppSettings = {
  id?: string;
  tenantId?: string;
  notifications: {
    entradaAluno: boolean;
    saidaAluno: boolean;
    atraso: boolean;
    ausencia: boolean;
    whatsapp: boolean;
    push: boolean;
  };
  recognition: {
    confidenceThreshold: number;
    analysisFps: number;
    saveFrames: boolean;
    detectMasks: boolean;
  };
  security: {
    twoFactor: boolean;
    auditLog: boolean;
  };
  dataRetentionDays: number;
  logRetentionDays: number;
};

export type DashboardEntryPoint = {
  hora: string;
  entradas: number;
};

export type ClassAttendance = {
  turma: string;
  escola: string;
  total: number;
  presentes: number;
  pct: number;
};

export type DashboardData = {
  resumo: {
    escolas: number;
    alunos: number;
    presentesHoje: number;
    ausentesHoje: number;
    camerasAtivas: number;
    notificacoesPendentes: number;
  };
  escolas: Escola[];
  alunos: Aluno[];
  eventosHoje: EventoCamera[];
  entradasPorHora: DashboardEntryPoint[];
  cameras: Camera[];
  notificacoes: Notificacao[];
  classAttendance: ClassAttendance[];
};

export type AuthUser = {
  id: string;
  nome: string;
  email: string;
  role: UserRole;
  tenantId: string;
  tenantNome?: string;
  avatar?: string;
  schoolId?: string;
  responsibleId?: string;
};

export type AuthSession = {
  user: AuthUser;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
};

export type LoginPayload = {
  email: string;
  password: string;
};

export type RegisterPayload = {
  nome: string;
  email: string;
  password: string;
  tenantName: string;
};

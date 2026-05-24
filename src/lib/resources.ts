import { apiRequest, unwrapItem, unwrapList } from "@/lib/api";
import type {
  Aluno,
  BiometricRecognitionReference,
  BiometricRecognitionEvent,
  AppSettings,
  AuthSession,
  Camera,
  CameraDiscoveryCandidate,
  DashboardData,
  Escola,
  EventoCamera,
  GuardianPortal,
  LoginPayload,
  Notificacao,
  RegisterPayload,
  Responsavel,
  Turma,
  StudentPresence,
} from "@/lib/domain";

export const authKeys = {
  session: ["auth", "session"] as const,
};

export const resourceKeys = {
  schools: (tenantId?: string | null) => ["schools", tenantId ?? "global"] as const,
  turmas: (tenantId?: string | null) => ["turmas", tenantId ?? "global"] as const,
  responsibles: (tenantId?: string | null) => ["responsibles", tenantId ?? "global"] as const,
  students: (tenantId?: string | null) => ["students", tenantId ?? "global"] as const,
  cameras: (tenantId?: string | null) => ["cameras", tenantId ?? "global"] as const,
  cameraEvents: (tenantId?: string | null) => ["camera-events", tenantId ?? "global"] as const,
  biometricReferences: (tenantId?: string | null) => ["biometric-references", tenantId ?? "global"] as const,
  notifications: (tenantId?: string | null) => ["notifications", tenantId ?? "global"] as const,
  settings: (tenantId?: string | null) => ["settings", tenantId ?? "global"] as const,
  guardianPortal: (tenantId?: string | null) => ["guardian-portal", tenantId ?? "global"] as const,
  dashboard: (tenantId?: string | null) => ["dashboard", tenantId ?? "global"] as const,
} as const;

export async function login(payload: LoginPayload) {
  const response = await apiRequest<unknown>("/auth/login", {
    method: "POST",
    body: payload,
  });
  return unwrapAuthSession(response);
}

export async function register(payload: RegisterPayload) {
  const response = await apiRequest<unknown>("/auth/register", {
    method: "POST",
    body: {
      tenantName: payload.tenantName,
      name: payload.nome,
      email: payload.email,
      password: payload.password,
    },
  });
  return unwrapAuthSession(response);
}

export async function logout() {
  await apiRequest<void>("/auth/logout", {
    method: "POST",
  });
}

export async function getSession() {
  try {
    const response = await apiRequest<unknown>("/auth/me");
    return unwrapAuthSession(response);
  } catch (error) {
    if (error instanceof Error && "status" in error && (error as { status?: number }).status === 401) {
      return null;
    }
    throw error;
  }
}

export async function listSchools() {
  return unwrapList<Escola>(await apiRequest<unknown>("/schools"));
}

export async function getDashboard() {
  return unwrapItem<DashboardData>(await apiRequest<unknown>("/dashboard"));
}

export async function createSchool(payload: Partial<Escola>) {
  return unwrapItem<Escola>(
    await apiRequest<unknown>("/schools", {
      method: "POST",
      body: payload,
    }),
  );
}

export async function updateSchool(id: string, payload: Partial<Escola>) {
  return unwrapItem<Escola>(
    await apiRequest<unknown>(`/schools/${id}`, {
      method: "PATCH",
      body: payload,
    }),
  );
}

export async function deleteSchool(id: string) {
  await apiRequest<void>(`/schools/${id}`, {
    method: "DELETE",
  });
}

export async function listTurmas(filters?: { escolaId?: string; turno?: string; q?: string; ativa?: string }) {
  return unwrapList<Turma>(await apiRequest<unknown>("/turmas", { params: filters }));
}

export async function createTurma(payload: Partial<Turma>) {
  return unwrapItem<Turma>(
    await apiRequest<unknown>("/turmas", {
      method: "POST",
      body: payload,
    }),
  );
}

export async function updateTurma(id: string, payload: Partial<Turma>) {
  return unwrapItem<Turma>(
    await apiRequest<unknown>(`/turmas/${id}`, {
      method: "PATCH",
      body: payload,
    }),
  );
}

export async function deleteTurma(id: string) {
  await apiRequest<void>(`/turmas/${id}`, {
    method: "DELETE",
  });
}

export async function listResponsibles() {
  return unwrapList<Responsavel>(await apiRequest<unknown>("/responsibles"));
}

export async function createResponsible(payload: Partial<Responsavel> & { password?: string }) {
  return unwrapItem<Responsavel>(
    await apiRequest<unknown>("/responsibles", {
      method: "POST",
      body: payload,
    }),
  );
}

export async function updateResponsible(id: string, payload: Partial<Responsavel> & { password?: string }) {
  return unwrapItem<Responsavel>(
    await apiRequest<unknown>(`/responsibles/${id}`, {
      method: "PATCH",
      body: payload,
    }),
  );
}

export async function deleteResponsible(id: string) {
  await apiRequest<void>(`/responsibles/${id}`, {
    method: "DELETE",
  });
}

export async function listStudents() {
  return unwrapList<Aluno>(await apiRequest<unknown>("/students"));
}

export async function createStudent(payload: FormData) {
  return unwrapItem<Aluno>(
    await apiRequest<unknown>("/students", {
      method: "POST",
      body: payload,
    }),
  );
}

export async function updateStudent(id: string, payload: FormData) {
  return unwrapItem<Aluno>(
    await apiRequest<unknown>(`/students/${id}`, {
      method: "PATCH",
      body: payload,
    }),
  );
}

export async function deleteStudent(id: string) {
  await apiRequest<void>(`/students/${id}`, {
    method: "DELETE",
  });
}

export async function listPresence(filters?: { schoolId?: string; date?: string; turma?: string }) {
  return unwrapList<Aluno>(
    await apiRequest<unknown>("/presence", {
      params: filters,
    }),
  );
}

export async function updatePresence(
  studentId: string,
  payload: { presencaHoje: StudentPresence; horarioEntrada?: string; horarioSaida?: string },
) {
  return unwrapItem<Aluno>(
    await apiRequest<unknown>(`/presence/${studentId}`, {
      method: "PATCH",
      body: payload,
    }),
  );
}

export async function listCameras() {
  return unwrapList<Camera>(await apiRequest<unknown>("/cameras"));
}

export async function discoverCameras() {
  const response = await apiRequest<unknown>("/cameras/discover");
  if (response && typeof response === "object" && Array.isArray((response as Record<string, unknown>).cameras)) {
    return (response as { cameras: CameraDiscoveryCandidate[] }).cameras;
  }
  return unwrapList<CameraDiscoveryCandidate>(response);
}

export async function createCamera(payload: Partial<Camera>) {
  return unwrapItem<Camera>(
    await apiRequest<unknown>("/cameras", {
      method: "POST",
      body: payload,
    }),
  );
}

export async function ensureDeviceCameraSource(schoolId: string) {
  return unwrapItem<Camera>(
    await apiRequest<unknown>("/cameras/device-source", {
      method: "POST",
      body: { escolaId: schoolId },
    }),
  );
}

export async function updateCamera(id: string, payload: Partial<Camera>) {
  return unwrapItem<Camera>(
    await apiRequest<unknown>(`/cameras/${id}`, {
      method: "PATCH",
      body: payload,
    }),
  );
}

export async function deleteCamera(id: string) {
  await apiRequest<void>(`/cameras/${id}`, {
    method: "DELETE",
  });
}

export async function listCameraEvents(date?: string) {
  return unwrapList<EventoCamera>(
    await apiRequest<unknown>("/camera-events", {
      params: { date },
    }),
  );
}

export async function registerCameraRecognition(payload: {
  cameraId: string;
  schoolId?: string;
  imagemBase64: string;
  expectedStudentId?: string;
  direcao?: "ENTRY" | "EXIT" | "UNKNOWN";
  reconhecidoEm?: string;
  metadata?: Record<string, unknown>;
}) {
  return unwrapItem<Record<string, unknown>>(
    await apiRequest<unknown>("/camera-events/reconhecer", {
      method: "POST",
      body: payload,
    }),
  );
}

export async function listBiometricReferences() {
  return unwrapList<BiometricRecognitionReference>(await apiRequest<unknown>("/biometria/referencias"));
}

export async function listBiometricEvents(filters?: {
  schoolId?: string;
  cameraId?: string;
  alunoId?: string;
  data?: string;
  matchStatus?: "MATCHED" | "REVIEW_REQUIRED" | "UNMATCHED";
}) {
  return unwrapList<BiometricRecognitionEvent>(
    await apiRequest<unknown>("/biometria/eventos", {
      params: filters,
    }),
  );
}

export async function listNotifications(filters?: { tipo?: string; status?: string }) {
  return unwrapList<Notificacao>(
    await apiRequest<unknown>("/notifications", {
      params: filters,
    }),
  );
}

export async function getGuardianPortal() {
  return unwrapItem<GuardianPortal>(await apiRequest<unknown>("/guardian-portal"));
}

export async function resendNotification(id: string) {
  await apiRequest<void>(`/notifications/${id}/resend`, {
    method: "POST",
  });
}

export async function getSettings() {
  const response = await apiRequest<unknown>("/settings");
  return unwrapSettings(response);
}

// ─── Gateways (PC desktop da escola) ───────────────────────────────────────
export type GatewayDTO = {
  id: string;
  name: string;
  schoolId?: string | null;
  hostname?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  status: "PAIRED" | "ACTIVE" | "REVOKED";
  lastSeenAt?: string | null;
  createdAt: string;
  school?: { id: string; name: string } | null;
};

export async function listGateways(): Promise<GatewayDTO[]> {
  const response = (await apiRequest<unknown>("/gateways")) as { gateways?: GatewayDTO[] };
  return response.gateways ?? [];
}

export async function createGatewayPairingCode(input: {
  name: string;
  schoolId?: string;
}): Promise<{ code: string; expiresAt: string }> {
  return (await apiRequest<unknown>("/gateways/pairing-code", {
    method: "POST",
    body: input,
  })) as { code: string; expiresAt: string };
}

export async function revokeGateway(id: string): Promise<void> {
  await apiRequest<void>(`/gateways/${id}`, { method: "DELETE" });
}

export async function updateSettings(payload: AppSettings) {
  return unwrapSettings(
    await apiRequest<unknown>("/settings", {
      method: "PUT",
      body: {
        notifications: {
          notifyEntry: payload.notifications.entradaAluno,
          notifyExit: payload.notifications.saidaAluno,
          notifyLate: payload.notifications.atraso,
          notifyAbsence: payload.notifications.ausencia,
          whatsapp: payload.notifications.whatsapp,
          push: payload.notifications.push,
        },
        recognition: {
          confidenceThreshold: payload.recognition.confidenceThreshold,
          framesPerSecond: payload.recognition.analysisFps,
          saveFrames: payload.recognition.saveFrames,
          detectMasks: payload.recognition.detectMasks,
        },
        security: payload.security,
        retention: {
          recordingsDays: payload.dataRetentionDays,
          logsDays: payload.logRetentionDays,
        },
      },
    }),
  );
}

function unwrapAuthSession(payload: unknown) {
  const root =
    payload && typeof payload === "object" && "data" in payload
      ? (payload as Record<string, unknown>).data
      : payload;

  if (!root || typeof root !== "object") {
    throw new Error("Sessão inválida retornada pela API");
  }

  const value = root as Record<string, unknown>;
  const userRecord = (value.user ?? value.account ?? value.profile ?? value) as Record<string, unknown>;
  const token = value.accessToken ?? value.token ?? value.jwt;
  const refreshToken = value.refreshToken ?? value.refresh ?? value.refresh_token;
  const expiresAt = value.expiresAt ?? value.expires_at ?? value.expiration;

  const user = {
    id: String(userRecord.id ?? userRecord.userId ?? ""),
    nome: String(userRecord.nome ?? userRecord.name ?? ""),
    email: String(userRecord.email ?? ""),
    role: String(userRecord.role ?? "admin") as AuthSession["user"]["role"],
    tenantId: String(
      userRecord.tenantId ?? userRecord.organizationId ?? userRecord.workspaceId ?? value.tenantId ?? value.organizationId ?? "default",
    ),
    tenantNome: String(userRecord.tenantNome ?? userRecord.tenantName ?? value.tenantNome ?? value.tenantName ?? ""),
    avatar: String(userRecord.avatar ?? userRecord.avatarUrl ?? userRecord.photo ?? ""),
    schoolId: String(userRecord.schoolId ?? userRecord.escolaId ?? ""),
    responsibleId: String(userRecord.responsibleId ?? userRecord.responsavelId ?? ""),
  };

  if (!user.id || !user.nome || !user.email) {
    throw new Error("Dados de usuário inválidos retornados pela API");
  }

  return {
    user: {
      ...user,
      tenantNome: user.tenantNome || undefined,
      avatar: user.avatar || undefined,
      schoolId: user.schoolId || undefined,
      responsibleId: user.responsibleId || undefined,
    },
    accessToken: typeof token === "string" && token ? token : undefined,
    refreshToken: typeof refreshToken === "string" && refreshToken ? refreshToken : undefined,
    expiresAt: typeof expiresAt === "string" && expiresAt ? expiresAt : undefined,
  } satisfies AuthSession;
}

function unwrapSettings(payload: unknown): AppSettings {
  const record = unwrapItem<Record<string, unknown>>(payload);
  if (!record || typeof record !== "object") {
    throw new Error("Configurações inválidas retornadas pela API");
  }

  const notifications = (record.notifications ?? {}) as Record<string, unknown>;
  const recognition = (record.recognition ?? {}) as Record<string, unknown>;
  const security = (record.security ?? {}) as Record<string, unknown>;

  return {
    id: String(record.id ?? ""),
    tenantId: String(record.tenantId ?? ""),
    notifications: {
      entradaAluno: Boolean(notifications.entradaAluno ?? notifications.entrada ?? true),
      saidaAluno: Boolean(notifications.saidaAluno ?? notifications.saida ?? true),
      atraso: Boolean(notifications.atraso ?? true),
      ausencia: Boolean(notifications.ausencia ?? true),
      whatsapp: Boolean(notifications.whatsapp ?? true),
      push: Boolean(notifications.push ?? notifications.pwa ?? true),
    },
    recognition: {
      confidenceThreshold: Number(recognition.confidenceThreshold ?? recognition.threshold ?? 85),
      analysisFps: Number(recognition.analysisFps ?? recognition.fps ?? 15),
      saveFrames: Boolean(recognition.saveFrames ?? true),
      detectMasks: Boolean(recognition.detectMasks ?? false),
    },
    security: {
      twoFactor: Boolean(security.twoFactor ?? true),
      auditLog: Boolean(security.auditLog ?? true),
    },
    dataRetentionDays: Number(record.dataRetentionDays ?? record.retentionDays ?? 30),
    logRetentionDays: Number(record.logRetentionDays ?? record.logsRetentionDays ?? 90),
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Camera as CameraIcon,
  CameraOff,
  CheckCircle2,
  Clock,
  Loader2,
  Maximize2,
  MessageCircle,
  Pencil,
  Plus,
  ScanFace,
  Settings,
  Trash2,
  Wifi,
  WifiOff,
  XCircle,
  Zap,
} from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTenantResourceKeyFactory } from "@/context/auth-context";
import { type BiometricRecognitionReference, type Camera } from "@/lib/domain";
import { getFaceApiEngine, type FaceApiModule } from "@/lib/face-api-engine";
import {
  deleteCamera,
  listBiometricEvents,
  listBiometricReferences,
  listCameraEvents,
  listCameras,
  listSchools,
  listStudents,
  listResponsibles,
  registerCameraRecognition,
} from "@/lib/resources";
import { formatWhatsAppLink } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type FaceMatchStatus = "MATCHED" | "REVIEW_REQUIRED" | "UNMATCHED";

type LiveFaceDetection = {
  detection: { box: { x: number; y: number; width: number; height: number }; score: number };
  landmarks: { positions: Array<{ x: number; y: number; z?: number }> };
  descriptor: ArrayLike<number>;
};

type RecognitionSnapshot = {
  faceIndex: number;
  label: string;
  identityName: string | null;
  identityKey: string | null;
  studentId: string | null;
  confidence: number;
  matchStatus: FaceMatchStatus;
  reviewReason?: string | null;
  distance?: number | null;
};

type LoadedRecognitionReference = {
  identityId: string;
  studentId: string | null;
  schoolId: string;
  displayName: string;
  schoolName: string | null;
  studentName: string | null;
  descriptors: Float32Array[];
};

type CamerasMode = "test" | "guard";
type ViewTab = "monitor" | "live";

// ─── Constants ────────────────────────────────────────────────────────────────

const DETECTION_INTERVAL_MS = 180;
const MAX_FACES = 8;
const FACE_API_DESCRIPTOR_SIZE = 128;
const LEGACY_DESCRIPTOR_SIZE = 24;
const FACE_API_MATCH_DISTANCE_THRESHOLD = 0.6;
const FACE_API_REVIEW_DISTANCE_THRESHOLD = 0.75;
const LEGACY_MATCH_DISTANCE_THRESHOLD = 0.5;
const LEGACY_REVIEW_DISTANCE_THRESHOLD = 0.7;
const MIN_DISTANCE_GAP = 0.05;
const RECOGNITION_SUBMIT_COOLDOWN_MS = 15_000;
const RECOGNITION_CROP_PADDING_RATIO = 0.18;
const RECOGNITION_EXPORT_SIZE = 320;
const FACE_API_ANALYSIS_OPTIONS = { inputSize: 512 as const, scoreThreshold: 0.3 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeDescriptor(vector: ArrayLike<number> | null | undefined) {
  if (!vector || typeof vector.length !== "number" || vector.length === 0) return new Float32Array();
  const values = Array.from(vector, (v) => Number(v) || 0);
  const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  if (!Number.isFinite(magnitude) || magnitude <= 0) return new Float32Array(values);
  return new Float32Array(values.map((v) => v / magnitude));
}

function bestTemplateDistance(descriptor: Float32Array, templates: Float32Array[]) {
  if (!descriptor.length || !templates.length) return Number.POSITIVE_INFINITY;
  return templates.reduce((best, t) => {
    const d = euclideanDistance(descriptor, t);
    return d < best ? d : best;
  }, Number.POSITIVE_INFINITY);
}

function euclideanDistance(left: ArrayLike<number>, right: ArrayLike<number>) {
  const size = Math.min(left.length || 0, right.length || 0);
  if (!size) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const d = (Number(left[i]) || 0) - (Number(right[i]) || 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function createRecognitionDecision(family: "face-api" | "legacy", descriptor: Float32Array, references: LoadedRecognitionReference[]) {
  const matchThreshold = family === "face-api" ? FACE_API_MATCH_DISTANCE_THRESHOLD : LEGACY_MATCH_DISTANCE_THRESHOLD;
  const reviewThreshold = family === "face-api" ? FACE_API_REVIEW_DISTANCE_THRESHOLD : LEGACY_REVIEW_DISTANCE_THRESHOLD;
  const empty = { identityKey: null, identityName: null, studentId: null, distance: Number.POSITIVE_INFINITY, secondBestDistance: Number.POSITIVE_INFINITY, confidence: 0, matchStatus: "UNMATCHED" as const, reviewReason: null as string | null, family };

  if (!references.length || !descriptor.length) return empty;

  const ranked = references
    .map((ref) => {
      const templates = ref.descriptors.filter((v) => family === "face-api" ? v.length === FACE_API_DESCRIPTOR_SIZE : v.length !== FACE_API_DESCRIPTOR_SIZE);
      return { identityKey: ref.identityId, identityName: ref.displayName, studentId: ref.studentId, distance: bestTemplateDistance(descriptor, templates) };
    })
    .filter((c) => Number.isFinite(c.distance))
    .sort((a, b) => a.distance - b.distance);

  const best = ranked[0];
  const second = ranked[1];
  if (!best) return empty;

  const secondBest = second?.distance ?? Number.POSITIVE_INFINITY;
  const gap = secondBest - best.distance;
  const confidence = clamp(Number.isFinite(best.distance) ? 1 - best.distance : 0, 0, 1);

  if (best.distance <= matchThreshold && gap >= MIN_DISTANCE_GAP) {
    return { ...best, secondBestDistance: secondBest, confidence, matchStatus: "MATCHED" as const, reviewReason: null as string | null, family };
  }
  if (best.distance <= reviewThreshold) {
    return { ...best, secondBestDistance: secondBest, confidence, matchStatus: "REVIEW_REQUIRED" as const, reviewReason: gap < MIN_DISTANCE_GAP ? "Correspondência ambígua." : `Distância ${best.distance.toFixed(2)}.`, family };
  }
  return { ...best, secondBestDistance: secondBest, confidence, matchStatus: "UNMATCHED" as const, reviewReason: null as string | null, family };
}

function pickBetterRecognition(
  current: ReturnType<typeof createRecognitionDecision> | null,
  previous: ReturnType<typeof createRecognitionDecision> | null,
) {
  if (!current) return previous;
  if (!previous) return current;
  if (previous.family === "face-api" && previous.matchStatus !== "UNMATCHED") return previous;
  if (current.family === "face-api" && current.matchStatus !== "UNMATCHED") return current;
  const rank = { MATCHED: 3, REVIEW_REQUIRED: 2, UNMATCHED: 1 } as const;
  if (rank[current.matchStatus] !== rank[previous.matchStatus]) return rank[current.matchStatus] > rank[previous.matchStatus] ? current : previous;
  return current.distance <= previous.distance ? current : previous;
}

function buildLegacyDescriptorFromVideo(video: HTMLVideoElement, box: { x: number; y: number; width: number; height: number }, canvas: HTMLCanvasElement | null) {
  if (!canvas || !video.videoWidth || !video.videoHeight) return new Float32Array();
  const ctx = canvas.getContext("2d");
  if (!ctx) return new Float32Array();
  const sx = clamp(Math.floor(box.x), 0, video.videoWidth - 1);
  const sy = clamp(Math.floor(box.y), 0, video.videoHeight - 1);
  const sw = Math.max(1, Math.min(Math.ceil(box.width), video.videoWidth - sx));
  const sh = Math.max(1, Math.min(Math.ceil(box.height), video.videoHeight - sy));
  canvas.width = LEGACY_DESCRIPTOR_SIZE;
  canvas.height = LEGACY_DESCRIPTOR_SIZE;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const values: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    values.push(((data[i] ?? 0) * 0.299 + (data[i + 1] ?? 0) * 0.587 + (data[i + 2] ?? 0) * 0.114) / 255 - 0.5);
  }
  return normalizeDescriptor(values);
}

function captureRecognitionCrop(video: HTMLVideoElement, box: { x: number; y: number; width: number; height: number }, canvas: HTMLCanvasElement | null) {
  if (!canvas || !video.videoWidth || !video.videoHeight) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const px = box.width * RECOGNITION_CROP_PADDING_RATIO;
  const py = box.height * RECOGNITION_CROP_PADDING_RATIO;
  const sx = clamp(Math.floor(box.x - px), 0, video.videoWidth - 1);
  const sy = clamp(Math.floor(box.y - py), 0, video.videoHeight - 1);
  const sw = Math.max(1, Math.min(Math.ceil(box.width + px * 2), video.videoWidth - sx));
  const sh = Math.max(1, Math.min(Math.ceil(box.height + py * 2), video.videoHeight - sy));
  canvas.width = RECOGNITION_EXPORT_SIZE;
  canvas.height = RECOGNITION_EXPORT_SIZE;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

function getTone(matchStatus: FaceMatchStatus) {
  if (matchStatus === "MATCHED") return { border: "border-emerald-300", fill: "bg-emerald-500/85", text: "text-emerald-50", box: "#10b981" };
  if (matchStatus === "REVIEW_REQUIRED") return { border: "border-amber-300", fill: "bg-amber-500/85", text: "text-amber-50", box: "#f59e0b" };
  return { border: "border-rose-300", fill: "bg-rose-500/85", text: "text-rose-50", box: "#f43f5e" };
}

function buildRecognitionReferences(items: BiometricRecognitionReference[]): LoadedRecognitionReference[] {
  return items.flatMap((item) => {
    const descriptors = (item.embeddings ?? [])
      .filter((e) => e?.isActive !== false && Array.isArray(e.vector) && e.vector.length > 0)
      .map((e) => normalizeDescriptor(e.vector))
      .filter((v) => v.length > 0);
    if (!descriptors.length) return [];
    return [{ identityId: item.id, studentId: item.studentId ?? item.student?.id ?? null, schoolId: item.schoolId, displayName: item.student?.nome?.trim() || item.label?.trim() || item.id, schoolName: item.school?.nome?.trim() || null, studentName: item.student?.nome?.trim() || null, descriptors }];
  });
}

function dedupeFrameMatches(snapshots: RecognitionSnapshot[]) {
  const strongest = new Map<string, { index: number; distance: number }>();
  snapshots.forEach((s, i) => {
    if (s.matchStatus !== "MATCHED" || !s.identityKey) return;
    const d = s.distance ?? Number.POSITIVE_INFINITY;
    const cur = strongest.get(s.identityKey);
    if (!cur || d < cur.distance) strongest.set(s.identityKey, { index: i, distance: d });
  });
  return snapshots.map((s, i) => {
    if (s.matchStatus !== "MATCHED" || !s.identityKey) return s;
    const top = strongest.get(s.identityKey);
    if (!top || top.index === i) return s;
    return { ...s, label: `Desconhecido ${s.faceIndex}`, identityName: null, identityKey: null, matchStatus: "UNMATCHED" as const, reviewReason: "Outra face teve correspondência melhor." };
  });
}

function clearOverlay(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = 1; canvas.height = 1; ctx.clearRect(0, 0, 1, 1);
}

function drawNativeOverlay(faceapi: FaceApiModule, video: HTMLVideoElement, canvas: HTMLCanvasElement, detections: LiveFaceDetection[], snapshots: RecognitionSnapshot[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx || !video.videoWidth || !video.videoHeight) return;
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  detections.forEach((det, i) => {
    const snap = snapshots[i];
    const tone = getTone(snap?.matchStatus ?? "UNMATCHED");
    const label = snap?.identityName?.trim() || snap?.label || `Desconhecido ${i + 1}`;
    new faceapi.draw.DrawBox(det.detection.box, { label, boxColor: tone.box, lineWidth: 3, drawLabelOptions: { backgroundColor: "rgba(15,23,42,0.92)", fontColor: "#fff", padding: 6 } }).draw(ctx);
    new faceapi.draw.DrawFaceLandmarks(det.landmarks as never).draw(ctx);
    if (snap?.reviewReason) {
      const reason = snap.reviewReason;
      const { box } = det.detection;
      const y = box.y + box.height + 10;
      ctx.save();
      ctx.font = '600 11px ui-sans-serif,system-ui,sans-serif';
      ctx.fillStyle = tone.fill;
      const tw = Math.min(ctx.measureText(reason).width + 20, canvas.width - box.x);
      ctx.fillRect(box.x, y, Math.max(tw, 96), 22);
      ctx.fillStyle = "#fff";
      ctx.fillText(reason, box.x + 10, y + 14);
      ctx.restore();
    }
  });
}

function cameraRuntimeLabel(status?: string) {
  switch (status) {
    case "ONLINE": return { label: "ONLINE", className: "text-secondary" };
    case "DEGRADED": return { label: "DEGRADADA", className: "text-warning" };
    case "ERROR": return { label: "ERRO", className: "text-destructive" };
    case "OFFLINE": return { label: "OFFLINE", className: "text-muted-foreground" };
    default: return { label: "SEM GATEWAY", className: "text-muted-foreground" };
  }
}

function HealthIcon({ status }: { status?: string }) {
  switch (status) {
    case "ONLINE": return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    case "DEGRADED": return <AlertTriangle className="h-4 w-4 text-amber-400" />;
    case "ERROR": return <XCircle className="h-4 w-4 text-rose-400" />;
    case "OFFLINE": return <WifiOff className="h-4 w-4 text-muted-foreground" />;
    default: return <Wifi className="h-4 w-4 text-muted-foreground/50" />;
  }
}

function timeAgo(iso?: string) {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

// ─── Monitor Tab ──────────────────────────────────────────────────────────────

function MonitorTab() {
  const keys = useTenantResourceKeyFactory();
  const queryClient = useQueryClient();
  const now = useNow();

  const camerasQuery = useQuery({ queryKey: keys.cameras, queryFn: listCameras, refetchInterval: 30_000 });
  const schoolsQuery = useQuery({ queryKey: keys.schools, queryFn: listSchools });
  const biometricReferencesQuery = useQuery({ queryKey: keys.biometricReferences, queryFn: listBiometricReferences, staleTime: 60_000 });
  const eventsQuery = useQuery({ queryKey: [...keys.cameraEvents, now.toISOString().slice(0, 10)] as const, queryFn: () => listCameraEvents(now.toISOString().slice(0, 10)), refetchInterval: 15_000 });
  const biometricEventsQuery = useQuery({ queryKey: [...keys.cameraEvents, "biometric", now.toISOString().slice(0, 10)] as const, queryFn: () => listBiometricEvents({ data: now.toISOString().slice(0, 10) }), refetchInterval: 15_000 });

  const deleteMutation = useMutation({
    mutationFn: deleteCamera,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: keys.cameras }); toast.success("Câmera removida"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao remover"),
  });

  const cameras = camerasQuery.data ?? [];
  const schools = schoolsQuery.data ?? [];
  const references = biometricReferencesQuery.data ?? [];
  const events = eventsQuery.data ?? [];
  const biometricEvents = biometricEventsQuery.data ?? [];

  const onlineCount = cameras.filter((c) => c.operacional?.status === "ONLINE").length;
  const offlineCount = cameras.filter((c) => !c.operacional?.status || c.operacional.status === "OFFLINE").length;
  const degradedCount = cameras.filter((c) => c.operacional?.status === "DEGRADED" || c.operacional?.status === "ERROR").length;
  const totalDetections = biometricEvents.length;
  const matchedDetections = biometricEvents.filter((e) => e.matchStatus === "MATCHED").length;
  const reviewDetections = biometricEvents.filter((e) => e.matchStatus === "REVIEW_REQUIRED").length;

  return (
    <div className="space-y-4">
      {/* Resumo de saúde */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "ONLINE", value: onlineCount, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30" },
          { label: "OFFLINE", value: offlineCount, color: "text-muted-foreground", bg: "bg-background/40 border-border" },
          { label: "COM ALERTA", value: degradedCount, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" },
          { label: "TOTAL CÂMERAS", value: cameras.length, color: "text-primary", bg: "bg-primary/10 border-primary/30" },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={cn("rounded-lg border p-4", bg)}>
            <div className="text-[10px] font-display tracking-widest text-muted-foreground">{label}</div>
            <div className={cn("font-display text-3xl font-bold mt-1", color)}>{value}</div>
          </div>
        ))}
      </div>

      {/* Métricas de detecção hoje */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="font-display font-semibold tracking-wide text-sm">DETECÇÕES HOJE</h3>
          <span className="text-[10px] text-muted-foreground ml-auto">{now.toLocaleDateString("pt-BR")}</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-primary/15 bg-background/40 p-3 text-center">
            <div className="text-[10px] font-display tracking-widest text-muted-foreground">TOTAL</div>
            <div className="font-display text-2xl font-bold text-primary">{totalDetections}</div>
          </div>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
            <div className="text-[10px] font-display tracking-widest text-muted-foreground">RECONHECIDOS</div>
            <div className="font-display text-2xl font-bold text-emerald-400">{matchedDetections}</div>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-center">
            <div className="text-[10px] font-display tracking-widest text-muted-foreground">EM REVISÃO</div>
            <div className="font-display text-2xl font-bold text-amber-400">{reviewDetections}</div>
          </div>
        </div>
        {totalDetections > 0 && (
          <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-secondary transition-all" style={{ width: `${Math.round((matchedDetections / totalDetections) * 100)}%` }} />
          </div>
        )}
        <div className="mt-2 text-xs text-muted-foreground text-right">
          {totalDetections > 0 ? `${Math.round((matchedDetections / totalDetections) * 100)}% taxa de reconhecimento` : "Nenhuma detecção registrada hoje"}
        </div>
      </div>

      {/* Lista de câmeras com saúde */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CameraIcon className="h-4 w-4 text-primary" />
            <h3 className="font-display font-semibold tracking-wide text-sm">CÂMERAS CADASTRADAS</h3>
          </div>
          <Link to="/cameras/cadastro">
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 text-xs">
              <Plus className="h-3 w-3 mr-1" />
              Nova Câmera
            </Button>
          </Link>
        </div>

        {camerasQuery.isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando câmeras...
          </div>
        ) : cameras.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-sm gap-2">
            <CameraIcon className="h-8 w-8 opacity-30" />
            <span>Nenhuma câmera cadastrada</span>
            <Link to="/cameras/cadastro">
              <Button size="sm" variant="outline">Cadastrar primeira câmera</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {cameras.map((camera) => {
              const school = schools.find((s) => s.id === camera.escolaId);
              const runtime = cameraRuntimeLabel(camera.operacional?.status);
              const camRefs = references.filter((r) => r.schoolId === camera.escolaId);
              const camEvents = biometricEvents.filter((e) => e.cameraId === camera.id);
              const camMatched = camEvents.filter((e) => e.matchStatus === "MATCHED").length;

              return (
                <div key={camera.id} className="rounded-lg border border-primary/10 bg-background/40 p-4 hover:border-primary/30 transition-colors">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      <HealthIcon status={camera.operacional?.status} />
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate">{camera.nome}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {school?.nome ?? "Escola não vinculada"} • {camera.localizacao || "Sem localização"}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("text-[10px] font-display tracking-widest font-semibold", runtime.className)}>
                        {runtime.label}
                      </span>
                      <StatusBadge variant={camera.status === "Ativa" ? "ok" : camera.status === "Manutenção" ? "manutencao" : "inativo"}>
                        {camera.status}
                      </StatusBadge>
                      <Link to="/cameras/cadastro" state={{ editCamera: camera }}>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Remover"
                        onClick={() => { if (window.confirm(`Remover ${camera.nome}?`)) deleteMutation.mutate(camera.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {/* Métricas inline */}
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                    <div className="rounded border border-primary/10 bg-background/60 px-2 py-1.5">
                      <div className="text-muted-foreground tracking-wide">TIPO</div>
                      <div className="font-semibold text-foreground">{camera.tipo}</div>
                    </div>
                    <div className="rounded border border-primary/10 bg-background/60 px-2 py-1.5">
                      <div className="text-muted-foreground tracking-wide">FPS</div>
                      <div className="font-semibold text-foreground flex items-center gap-1">
                        {camera.operacional?.fpsMedido != null ? (
                          <>
                            <span className="text-emerald-400">{camera.operacional.fpsMedido}</span>
                            <span className="text-muted-foreground">/ {camera.fps}</span>
                          </>
                        ) : camera.fps}
                      </div>
                    </div>
                    <div className="rounded border border-primary/10 bg-background/60 px-2 py-1.5">
                      <div className="text-muted-foreground tracking-wide">BIOMETRIAS</div>
                      <div className="font-semibold text-foreground">{camRefs.length} identidade(s)</div>
                    </div>
                    <div className="rounded border border-primary/10 bg-background/60 px-2 py-1.5">
                      <div className="text-muted-foreground tracking-wide">DETECÇÕES HOJE</div>
                      <div className="font-semibold text-foreground">{camMatched} / {camEvents.length}</div>
                    </div>
                  </div>

                  {/* Timestamps de saúde */}
                  {camera.operacional && (
                    <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                      {camera.operacional.ultimoHeartbeat && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> Heartbeat: {timeAgo(camera.operacional.ultimoHeartbeat)}
                        </span>
                      )}
                      {camera.operacional.ultimoFrame && (
                        <span className="flex items-center gap-1">
                          <Zap className="h-3 w-3" /> Último frame: {timeAgo(camera.operacional.ultimoFrame)}
                        </span>
                      )}
                      {camera.operacional.ultimoErro && (
                        <span className="flex items-center gap-1 text-rose-400">
                          <XCircle className="h-3 w-3" /> {camera.operacional.ultimoErro}
                        </span>
                      )}
                      {camera.operacional.gatewayId && (
                        <span className="flex items-center gap-1">
                          <Wifi className="h-3 w-3" /> Gateway: {camera.operacional.gatewayId}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Últimos eventos do dia */}
      {events.length > 0 && (
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="font-display font-semibold tracking-wide text-sm">ÚLTIMOS EVENTOS DO DIA</h3>
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {events.slice(0, 20).map((event) => (
              <div key={event.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-primary/10 bg-background/40 text-xs">
                <StatusBadge variant={event.tipo === "Entrou" ? "presente" : "saiu"}>{event.tipo}</StatusBadge>
                <span className="text-muted-foreground">{event.horario}</span>
                <span className={cn("ml-auto text-[10px]", event.reconhecido ? "text-emerald-400" : "text-muted-foreground")}>
                  {event.reconhecido ? `${Math.round((event.confianca ?? 0) * 100)}% confiança` : "Não identificado"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Live Tab (câmera ao vivo com reconhecimento) ─────────────────────────────

function LiveTab({ mode }: { mode: CamerasMode }) {
  const now = useNow();
  const keys = useTenantResourceKeyFactory();
  const queryClient = useQueryClient();
  const [cameraId, setCameraId] = useState<string>("");
  const [escolaExpand, setEscolaExpand] = useState<string>("");
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [faces, setFaces] = useState<RecognitionSnapshot[]>([]);
  const [lastModelName, setLastModelName] = useState("face-api.js");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastAnalysisAtRef = useRef(0);
  const inFlightRef = useRef(false);
  const cameraActiveRef = useRef(false);
  const faceApiRef = useRef<FaceApiModule | null>(null);
  const legacyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const submissionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recognitionReferencesRef = useRef<LoadedRecognitionReference[]>([]);
  const recognitionCooldownRef = useRef<Map<string, number>>(new Map());
  const recognitionInFlightRef = useRef<Set<string>>(new Set());
  const autoStartedCameraIdRef = useRef<string | null>(null);
  const activeRecognitionContextRef = useRef<{ cameraId: string | null; schoolId: string | null }>({ cameraId: null, schoolId: null });

  const schoolsQuery = useQuery({ queryKey: keys.schools, queryFn: listSchools });
  const camerasQuery = useQuery({ queryKey: keys.cameras, queryFn: listCameras });
  const studentsQuery = useQuery({ queryKey: keys.students, queryFn: listStudents });
  const responsiblesQuery = useQuery({ queryKey: keys.responsibles, queryFn: listResponsibles });
  const biometricReferencesQuery = useQuery({ queryKey: keys.biometricReferences, queryFn: listBiometricReferences, staleTime: 300_000 });
  const eventsQuery = useQuery({ queryKey: [...keys.cameraEvents, now.toISOString().slice(0, 10)] as const, queryFn: () => listCameraEvents(now.toISOString().slice(0, 10)) });

  useEffect(() => { if (!cameraId && camerasQuery.data?.[0]?.id) setCameraId(camerasQuery.data[0].id); }, [cameraId, camerasQuery.data]);
  useEffect(() => { if (!escolaExpand && schoolsQuery.data?.[0]?.id) setEscolaExpand(schoolsQuery.data[0].id); }, [escolaExpand, schoolsQuery.data]);

  const recognitionReferences = useMemo(() => buildRecognitionReferences(biometricReferencesQuery.data ?? []), [biometricReferencesQuery.data]);

  const scopedRecognitionReferences = useMemo(() => {
    const activeSchoolId = (camerasQuery.data?.find((c) => c.id === cameraId) ?? camerasQuery.data?.[0])?.escolaId;
    return activeSchoolId ? recognitionReferences.filter((r) => r.schoolId === activeSchoolId) : recognitionReferences;
  }, [cameraId, camerasQuery.data, recognitionReferences]);

  useEffect(() => { recognitionReferencesRef.current = scopedRecognitionReferences; }, [scopedRecognitionReferences]);

  const referenceCount = scopedRecognitionReferences.length;
  const templateCount = useMemo(() => scopedRecognitionReferences.reduce((sum, r) => sum + r.descriptors.length, 0), [scopedRecognitionReferences]);

  const referenceMessage = useMemo(() => {
    if (biometricReferencesQuery.isLoading) return "Carregando biometrias...";
    if (biometricReferencesQuery.isError) return "Falha ao carregar referências biométricas.";
    if (!referenceCount) return 'Nenhuma biometria cadastrada. Rostos ficarão como "Desconhecido".';
    return `${referenceCount} identidade(s) prontas para reconhecimento (${templateCount} template(s)).`;
  }, [biometricReferencesQuery.isError, biometricReferencesQuery.isLoading, referenceCount, templateCount]);

  const camera = camerasQuery.data?.find((c) => c.id === cameraId) ?? camerasQuery.data?.[0];
  const runtime = cameraRuntimeLabel(camera?.operacional?.status);
  const escola = schoolsQuery.data?.find((s) => s.id === camera?.escolaId);

  useEffect(() => { activeRecognitionContextRef.current = { cameraId: camera?.id ?? null, schoolId: camera?.escolaId ?? escola?.id ?? null }; }, [camera?.escolaId, camera?.id, escola?.id]);

  const ausentes = useMemo(() => studentsQuery.data?.filter((s) => s.escolaId === escolaExpand && s.presencaHoje === "ausente") ?? [], [escolaExpand, studentsQuery.data]);
  const turmasEsc = useMemo(() => Array.from(new Set((studentsQuery.data ?? []).filter((s) => s.escolaId === escolaExpand).map((s) => s.turma))), [escolaExpand, studentsQuery.data]);
  const latestEvents = eventsQuery.data ?? [];
  const matchedFacesCount = faces.filter((f) => f.matchStatus === "MATCHED").length;
  const reviewFacesCount = faces.filter((f) => f.matchStatus === "REVIEW_REQUIRED").length;
  const unknownFacesCount = faces.filter((f) => f.matchStatus === "UNMATCHED").length;

  const stopAnimationLoop = useCallback(() => {
    if (animationFrameRef.current !== null) { window.cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null; }
  }, []);

  const resetLiveState = useCallback(() => {
    stopAnimationLoop();
    inFlightRef.current = false; lastAnalysisAtRef.current = 0; cameraActiveRef.current = false; autoStartedCameraIdRef.current = null;
    setAnalyzing(false); setCameraActive(false); setFaces([]); setLastModelName("face-api.js");
    clearOverlay(canvasRef.current);
  }, [stopAnimationLoop]);

  const stopCamera = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    resetLiveState();
  }, [resetLiveState]);

  const ensureRecognitionReferences = useCallback(async (schoolId?: string | null) => {
    if (recognitionReferencesRef.current.length > 0) return recognitionReferencesRef.current;
    try {
      const response = await biometricReferencesQuery.refetch();
      const built = buildRecognitionReferences(response.data ?? []);
      const activeSchoolId = schoolId ?? activeRecognitionContextRef.current.schoolId;
      const scoped = activeSchoolId ? built.filter((r) => r.schoolId === activeSchoolId) : built;
      recognitionReferencesRef.current = scoped;
      return scoped;
    } catch { return recognitionReferencesRef.current; }
  }, [biometricReferencesQuery]);

  const persistMatchedRecognitions = useCallback(async (params: { video: HTMLVideoElement; detections: LiveFaceDetection[]; snapshots: RecognitionSnapshot[] }) => {
    const { cameraId: activeCameraId, schoolId: activeSchoolId } = activeRecognitionContextRef.current;
    if (!activeCameraId || !activeSchoolId) return;
    const matchedPairs = params.snapshots.map((s, i) => ({ snapshot: s, detection: params.detections[i] }))
      .filter((e): e is { snapshot: RecognitionSnapshot; detection: LiveFaceDetection } => Boolean(e.detection) && e.snapshot.matchStatus === "MATCHED" && Boolean(e.snapshot.identityKey));
    if (!matchedPairs.length) return;
    const results = await Promise.allSettled(matchedPairs.map(async ({ snapshot, detection }) => {
      const key = snapshot.identityKey!;
      const now = Date.now();
      if (recognitionInFlightRef.current.has(key) || now - (recognitionCooldownRef.current.get(key) ?? 0) < RECOGNITION_SUBMIT_COOLDOWN_MS) return false;
      const imagemBase64 = captureRecognitionCrop(params.video, detection.detection.box, submissionCanvasRef.current);
      if (!imagemBase64) return false;
      recognitionInFlightRef.current.add(key);
      try {
        const res = await registerCameraRecognition({ cameraId: activeCameraId, schoolId: activeSchoolId, imagemBase64, expectedStudentId: snapshot.studentId ?? undefined, direcao: "ENTRY", reconhecidoEm: new Date().toISOString(), metadata: { source: "cameras-live", localIdentityKey: key, localStudentId: snapshot.studentId, localConfidence: snapshot.confidence } });
        recognitionCooldownRef.current.set(key, Date.now());
        return res;
      } catch { return false; } finally { recognitionInFlightRef.current.delete(key); }
    }));
    if (results.some((r) => r.status === "fulfilled" && Boolean(r.value) && (r.value as Record<string, unknown>).duplicate !== true)) {
      await Promise.all([queryClient.invalidateQueries({ queryKey: keys.students }), queryClient.invalidateQueries({ queryKey: keys.cameraEvents })]);
    }
  }, [keys.cameraEvents, keys.students, queryClient]);

  const runFrameAnalysis = useCallback(async () => {
    if (inFlightRef.current) return;
    const video = videoRef.current; const canvas = canvasRef.current; const faceapi = faceApiRef.current;
    if (!video || !canvas || !faceapi || video.readyState < 2) return;
    inFlightRef.current = true; setAnalyzing(true);
    try {
      const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions(FACE_API_ANALYSIS_OPTIONS)).withFaceLandmarks().withFaceDescriptors();
      const ordered = [...detections].sort((a, b) => a.detection.box.x - b.detection.box.x).slice(0, MAX_FACES) as LiveFaceDetection[];
      if (!ordered.length) { setFaces([]); setStatusMessage("Nenhum rosto detectado."); clearOverlay(canvas); return; }
      const refs = recognitionReferencesRef.current;
      const hasFaceApi = refs.some((r) => r.descriptors.some((v) => v.length === FACE_API_DESCRIPTOR_SIZE));
      const hasLegacy = refs.some((r) => r.descriptors.some((v) => v.length !== FACE_API_DESCRIPTOR_SIZE));
      const snapshots = dedupeFrameMatches(ordered.map((det, i) => {
        const norm = normalizeDescriptor(det.descriptor);
        const fa = createRecognitionDecision("face-api", norm, refs);
        const leg = hasLegacy ? createRecognitionDecision("legacy", buildLegacyDescriptorFromVideo(video, det.detection.box, legacyCanvasRef.current), refs) : null;
        const rec = pickBetterRecognition(leg, fa) ?? fa;
        const conf = Number.isFinite(rec.distance) ? clamp(1 - rec.distance, 0, 1) : 0;
        if (rec.matchStatus === "MATCHED" && rec.identityName) return { faceIndex: i + 1, label: rec.identityName, identityName: rec.identityName, identityKey: rec.identityKey, studentId: rec.studentId, confidence: conf, matchStatus: "MATCHED" as const, reviewReason: null, distance: rec.distance } satisfies RecognitionSnapshot;
        if (rec.matchStatus === "REVIEW_REQUIRED") return { faceIndex: i + 1, label: rec.identityName ? `Revisão: ${rec.identityName}` : `Desconhecido ${i + 1}`, identityName: rec.identityName, identityKey: rec.identityKey, studentId: rec.studentId, confidence: conf, matchStatus: "REVIEW_REQUIRED" as const, reviewReason: rec.reviewReason, distance: rec.distance } satisfies RecognitionSnapshot;
        return { faceIndex: i + 1, label: `Desconhecido ${i + 1}`, identityName: null, identityKey: null, studentId: null, confidence: conf, matchStatus: "UNMATCHED" as const, reviewReason: null, distance: rec.distance } satisfies RecognitionSnapshot;
      }));
      setFaces(snapshots); setLastModelName(hasFaceApi ? "face-api.js" : hasLegacy ? "legacy-grayscale" : "face-api.js");
      const m = snapshots.filter((s) => s.matchStatus === "MATCHED").length;
      const r = snapshots.filter((s) => s.matchStatus === "REVIEW_REQUIRED").length;
      const u = snapshots.filter((s) => s.matchStatus === "UNMATCHED").length;
      setStatusMessage(refs.length ? `${snapshots.length} rosto(s). ${m} reconhecido(s), ${r} em revisão, ${u} desconhecido(s).` : `${snapshots.length} rosto(s) detectado(s). Cadastre biometrias para identificação.`);
      drawNativeOverlay(faceapi, video, canvas, ordered, snapshots);
      void persistMatchedRecognitions({ video, detections: ordered, snapshots });
    } catch (e) { console.error("Erro na análise:", e); setError("Falha ao analisar o vídeo."); setFaces([]); clearOverlay(canvas); }
    finally { setAnalyzing(false); inFlightRef.current = false; }
  }, [persistMatchedRecognitions]);

  const startAnimationLoop = useCallback(() => {
    const tick = (ts: number) => {
      if (!cameraActiveRef.current) return;
      if (ts - lastAnalysisAtRef.current >= DETECTION_INTERVAL_MS) { lastAnalysisAtRef.current = ts; void runFrameAnalysis(); }
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };
    stopAnimationLoop(); animationFrameRef.current = window.requestAnimationFrame(tick);
  }, [runFrameAnalysis, stopAnimationLoop]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setError("Câmera não suportada neste dispositivo."); return; }
    if (typeof window !== "undefined" && !window.isSecureContext && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") { setError("A câmera só funciona em HTTPS ou localhost."); return; }
    try {
      setCameraLoading(true); setError(null); stopCamera(); setStatusMessage("Preparando câmera...");
      const fallbackSchoolId = camera?.escolaId ?? escolaExpand ?? schoolsQuery.data?.[0]?.id ?? null;
      if (!fallbackSchoolId) { setError("Selecione ou cadastre uma escola."); return; }
      const resolvedCamera = camera ?? null;
      if (!resolvedCamera) { setError("Nenhuma câmera encontrada."); return; }
      activeRecognitionContextRef.current = { cameraId: resolvedCamera.id, schoolId: resolvedCamera.escolaId };
      recognitionReferencesRef.current = [];
      setCameraId(resolvedCamera.id);
      await queryClient.invalidateQueries({ queryKey: keys.cameras });
      const [faceApiEngine, stream, refs] = await Promise.all([
        getFaceApiEngine(),
        navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }),
        ensureRecognitionReferences(resolvedCamera.escolaId),
      ]);
      if (!faceApiEngine) { setError("Motor face-api.js não pôde ser carregado."); stopCamera(); return; }
      faceApiRef.current = faceApiEngine.faceapi; recognitionReferencesRef.current = refs; streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
      cameraActiveRef.current = true; autoStartedCameraIdRef.current = resolvedCamera.id; setCameraActive(true);
      setStatusMessage(refs.length ? `${refs.length} identidade(s) carregada(s).` : 'Câmera iniciada. Rostos sem cadastro aparecerão como "Desconhecido".');
      startAnimationLoop(); void runFrameAnalysis();
    } catch (e) { console.error("Erro ao iniciar câmera:", e); setError("Não foi possível iniciar a câmera. Verifique a permissão."); stopCamera(); }
    finally { setCameraLoading(false); }
  }, [camera, escolaExpand, ensureRecognitionReferences, keys.cameras, queryClient, runFrameAnalysis, schoolsQuery.data, startAnimationLoop, stopCamera]);

  // Auto-start no modo guard
  useEffect(() => {
    if (mode !== "guard" || !camera?.id || cameraLoading || cameraActive) return;
    if (autoStartedCameraIdRef.current === camera.id) return;
    setError(null); void startCamera();
  }, [camera?.id, cameraActive, cameraLoading, mode, startCamera]);

  useEffect(() => () => { stopCamera(); }, [stopCamera]);
  useEffect(() => { if (!cameraActive) clearOverlay(canvasRef.current); }, [cameraActive]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 glass-card p-4">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Select value={camera?.id ?? ""} onValueChange={setCameraId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Selecione uma câmera" />
              </SelectTrigger>
              <SelectContent>
                {camerasQuery.data?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground hidden md:inline">{escola?.nome || "—"}</span>
          </div>
          <div className="flex items-center gap-3 text-xs font-display tracking-widest">
            <span className={runtime.className}>{runtime.label}</span>
            {camera?.operacional?.fpsMedido != null && <span className="text-secondary">{camera.operacional.fpsMedido} FPS REAL</span>}
            <span className="text-secondary">{camera?.fps ?? 0} FPS</span>
            <span className="text-primary">{camera?.resolucao ?? "—"}</span>
            <span className="font-bold text-primary text-lg text-glow">{now.toLocaleTimeString("pt-BR")}</span>
          </div>
        </div>

        <div className="relative aspect-video bg-background border border-primary/30 rounded-lg overflow-hidden tech-grid scanline">
          <video ref={videoRef} autoPlay muted playsInline className={cn("absolute inset-0 z-10 h-full w-full object-cover scale-x-[-1] transition-opacity duration-300", cameraActive ? "opacity-100" : "opacity-0")} />
          <canvas ref={canvasRef} className={cn("absolute inset-0 z-20 h-full w-full pointer-events-none scale-x-[-1] transition-opacity duration-300", cameraActive ? "opacity-100" : "opacity-0")} />
          <canvas ref={legacyCanvasRef} className="hidden" aria-hidden="true" />
          <canvas ref={submissionCanvasRef} className="hidden" aria-hidden="true" />

          {cameraActive ? (
            <>
              <div className="absolute inset-0 z-30 bg-gradient-to-b from-black/10 via-transparent to-black/35" />
              <div className="absolute top-3 left-3 z-40 flex items-center gap-1.5 bg-secondary/20 border border-secondary/50 px-2 py-1 rounded text-xs font-display tracking-wider">
                <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse-soft" /> AO VIVO
              </div>
              <div className="absolute top-3 right-3 z-40 flex items-center gap-2 rounded border border-primary/30 bg-background/60 px-2 py-1 text-xs font-mono text-primary backdrop-blur-sm">
                <ScanFace className="h-3.5 w-3.5" /> {lastModelName} {analyzing && <Loader2 className="h-3.5 w-3.5 animate-spin text-secondary" />}
              </div>
              <div className="absolute bottom-3 left-3 right-3 z-40 rounded-lg border px-3 py-2 text-xs backdrop-blur-sm border-sky-200 bg-sky-50 text-sky-700">{statusMessage}</div>
            </>
          ) : (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 px-4 text-center">
              {mode === "guard" ? (
                <>
                  <Loader2 className="h-12 w-12 text-primary/60 animate-spin" />
                  <span className="font-display tracking-widest text-primary/80 text-sm">{cameraLoading ? "INICIANDO VIGIA" : "AGUARDANDO CÂMERA"}</span>
                  <p className="max-w-sm text-xs text-muted-foreground">{cameraLoading ? "Carregando modelos de reconhecimento facial..." : "Selecione uma câmera no seletor acima."}</p>
                </>
              ) : (
                <>
                  <CameraIcon className="h-12 w-12 text-primary/60" />
                  <span className="font-display tracking-widest text-primary/80 text-sm">{cameraLoading ? "ABRINDO CÂMERA" : "AO VIVO"}</span>
                  <p className="max-w-sm text-xs text-muted-foreground">{cameraLoading ? "Preparando reconhecimento facial..." : "Clique em iniciar para abrir a câmera."}</p>
                  <Button onClick={startCamera} className="bg-primary text-primary-foreground hover:bg-primary/90" type="button" disabled={cameraLoading}>
                    <CameraIcon className="h-4 w-4 mr-1" /> {cameraLoading ? "Abrindo..." : "Iniciar câmera ao vivo"}
                  </Button>
                </>
              )}
            </div>
          )}

          <button type="button" className="absolute bottom-3 right-3 z-50 p-2 bg-background/60 backdrop-blur border border-primary/30 rounded hover:bg-primary/20" title="Expandir">
            <Maximize2 className="h-4 w-4 text-primary" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-3">
          <div className="rounded-lg border border-primary/15 bg-background/40 p-2">
            <div className="text-[10px] font-display tracking-widest text-muted-foreground">DETECÇÕES</div>
            <div className="font-display text-xl font-bold text-primary">{faces.length}</div>
          </div>
          <div className="rounded-lg border border-secondary/30 bg-secondary/10 p-2">
            <div className="text-[10px] font-display tracking-widest text-muted-foreground">RECONHECIDOS</div>
            <div className="font-display text-xl font-bold text-secondary">{matchedFacesCount}</div>
          </div>
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-2">
            <div className="text-[10px] font-display tracking-widest text-muted-foreground">EM REVISÃO</div>
            <div className="font-display text-xl font-bold text-warning">{reviewFacesCount || unknownFacesCount}</div>
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-dashed border-border bg-background/50 px-4 py-3 text-xs text-muted-foreground">{referenceMessage}</div>

        <div className="flex flex-wrap items-center gap-3 mt-3">
          {mode === "guard" ? (
            cameraActive ? (
              <Button type="button" variant="outline" onClick={stopCamera}><CameraOff className="mr-2 h-4 w-4" /> Parar vigia</Button>
            ) : (
              <Button type="button" onClick={startCamera} disabled={cameraLoading}>
                {cameraLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CameraIcon className="mr-2 h-4 w-4" />}
                {cameraLoading ? "Iniciando..." : "Reiniciar vigia"}
              </Button>
            )
          ) : (
            <>
              {!cameraActive ? (
                <Button type="button" onClick={startCamera} disabled={cameraLoading}>
                  {cameraLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CameraIcon className="mr-2 h-4 w-4" />}
                  Iniciar câmera ao vivo
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={stopCamera}><CameraOff className="mr-2 h-4 w-4" /> Parar câmera</Button>
              )}
              <Button type="button" variant="outline" onClick={() => { setError(null); stopCamera(); setFaces([]); }}>
                <Loader2 className="mr-2 h-4 w-4" /> Reiniciar
              </Button>
            </>
          )}
        </div>

        {error && <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      </div>

      {/* Painel lateral: atividade em tempo real */}
      <div className="glass-card p-4 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-semibold tracking-wide">ATIVIDADE EM TEMPO REAL</h3>
          <span className="h-2 w-2 rounded-full bg-secondary animate-pulse-soft" />
        </div>
        <ul className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
          {latestEvents.map((event) => {
            const student = studentsQuery.data?.find((s) => s.id === event.alunoId);
            const responsible = responsiblesQuery.data?.find((r) => r.id === student?.responsavelPrincipalId);
            if (!student || !responsible) return null;
            const message = `Olá ${responsible.nome}, seu(sua) filho(a) ${student.nome.split(" ")[0]} ${event.tipo === "Entrou" ? "entrou na" : "saiu da"} escola às ${event.horario}.`;
            const link = formatWhatsAppLink(responsible.whatsapp, message);
            return (
              <li key={event.id} className="flex items-center gap-3 p-2 rounded-lg border border-primary/10 bg-background/40 hover:border-primary/30">
                <div className="relative">
                  <img src={student.foto} className="h-10 w-10 rounded-full bg-muted border border-primary/30 object-cover" />
                  <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-secondary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{student.nome}</div>
                  <div className="text-[11px] text-muted-foreground">{student.turma} • {event.horario}</div>
                </div>
                <StatusBadge variant={event.tipo === "Entrou" ? "presente" : "saiu"}>{event.tipo}</StatusBadge>
                <a href={link} target="_blank" rel="noreferrer" className="p-2 rounded-md bg-secondary/15 border border-secondary/40 hover:bg-secondary/25 text-secondary" title="Notificar via WhatsApp">
                  <MessageCircle className="h-4 w-4" />
                </a>
              </li>
            );
          })}
          {eventsQuery.isLoading && <li className="text-sm text-muted-foreground">Carregando atividades...</li>}
        </ul>

        {/* Monitor de turmas */}
        <div className="mt-4 pt-4 border-t border-primary/10">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-display text-xs font-semibold tracking-wide">TURMAS</h4>
            <Select value={escolaExpand} onValueChange={setEscolaExpand}>
              <SelectTrigger className="h-7 w-36 text-xs"><SelectValue placeholder="Escola" /></SelectTrigger>
              <SelectContent>
                {schoolsQuery.data?.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {turmasEsc.map((turma) => {
              const list = (studentsQuery.data ?? []).filter((s) => s.escolaId === escolaExpand && s.turma === turma);
              const present = list.filter((s) => s.presencaHoje !== "ausente").length;
              const pct = list.length > 0 ? Math.round((present / list.length) * 100) : 0;
              return (
                <div key={turma} className="rounded border border-primary/10 bg-background/40 px-3 py-2">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-semibold">{turma}</span>
                    <span className="text-primary font-bold">{pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-primary to-secondary" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{present}/{list.length} presentes</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CamerasView principal ────────────────────────────────────────────────────

export function CamerasView({ mode = "test" }: { mode?: CamerasMode }) {
  const [tab, setTab] = useState<ViewTab>(mode === "guard" ? "live" : "monitor");

  if (mode === "guard") {
    return <LiveTab mode="guard" />;
  }

  return (
    <>
      <PageHeader
        title="Câmeras & Portões"
        subtitle="Monitoramento, saúde e gerenciamento das câmeras"
        breadcrumb={[{ label: "Início", href: "/" }, { label: "Câmeras" }]}
        actions={
          <Link to="/cameras/cadastro">
            <Button variant="outline">
              <Settings className="h-4 w-4 mr-1" />
              Cadastrar Câmera
            </Button>
          </Link>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-primary/10">
        {([
          { value: "monitor", label: "Monitoramento & Saúde" },
          { value: "live", label: "Câmera ao Vivo" },
        ] as { value: ViewTab; label: string }[]).map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "px-4 py-2.5 text-sm font-display tracking-wide transition-colors border-b-2 -mb-px",
              tab === value
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "monitor" ? <MonitorTab /> : <LiveTab mode="test" />}
    </>
  );
}

export default function Cameras() {
  return <CamerasView mode="test" />;
}

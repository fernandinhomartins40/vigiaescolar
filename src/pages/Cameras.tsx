import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Hls from "hls.js";
import {
  Activity,
  AlertTriangle,
  Camera as CameraIcon,
  CameraOff,
  CheckCircle2,
  Clock,
  Laptop,
  Loader2,
  Maximize2,
  MessageCircle,
  Network,
  Pencil,
  Play,
  Plus,
  Radar,
  RefreshCw,
  ScanFace,
  Settings,
  Square,
  Trash2,
  Wifi,
  WifiOff,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useTenantResourceKeyFactory } from "@/context/auth-context";
import { type BiometricRecognitionReference, type Camera, type CameraDiscoveryCandidate } from "@/lib/domain";
import { getFaceApiEngine, type FaceApiModule } from "@/lib/face-api-engine";
import {
  createCamera,
  deleteCamera,
  discoverCameras,
  ensureDeviceCameraSource,
  listBiometricEvents,
  listBiometricReferences,
  listCameraEvents,
  listCameras,
  listSchools,
  listStudents,
  listResponsibles,
  registerCameraRecognition,
  updateCamera,
} from "@/lib/resources";
import { formatWhatsAppLink } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

// ─── Camera form types (inline drawer) ───────────────────────────────────────

type NetworkProfile = "manual" | "xm-h264dvr";

type CameraForm = {
  id?: string;
  nome: string;
  escolaId: string;
  localizacao: string;
  tipo: Camera["tipo"];
  url: string;
  porta: number;
  perfilRede: NetworkProfile;
  canal: number;
  stream: "main" | "sub";
  resolucao: Camera["resolucao"];
  fps: number;
  status: Camera["status"];
  usuario: string;
  senha: string;
};

const emptyCameraForm: CameraForm = {
  nome: "", escolaId: "", localizacao: "", tipo: "USB", url: "", porta: 554,
  perfilRede: "manual", canal: 1, stream: "main", resolucao: "1080p", fps: 30,
  status: "Ativa", usuario: "", senha: "",
};

const CAMERA_TYPES_DEF = [
  { value: "USB" as const, label: "Webcam / Dispositivo", description: "Câmera conectada a este navegador", icon: Laptop },
  { value: "IP" as const, label: "Câmera IP", description: "Câmera de rede com endereço IP", icon: Wifi },
  { value: "RTSP" as const, label: "RTSP / NVR", description: "Stream RTSP de DVR, NVR ou câmera profissional", icon: Network },
];

const NETWORK_PROFILES_DEF = [
  { value: "manual" as const, label: "Manual / genérico", description: "Use uma URL RTSP ou HTTP do fabricante" },
  { value: "xm-h264dvr" as const, label: "H264DVR / XM / iCSee", description: "Perfil para câmeras Wi-Fi com VideoPlayTool" },
];

function stripProtocol(value: string) {
  return value.trim().replace(/^[a-z]+:\/\//i, "").split("/")[0].split("@").pop() ?? "";
}

function buildNetworkUrl(form: CameraForm) {
  const rawUrl = form.url.trim();
  if (form.tipo !== "RTSP" || form.perfilRede !== "xm-h264dvr") return rawUrl;
  const host = stripProtocol(rawUrl).split(":")[0];
  if (!host) return rawUrl;
  const port = Number(form.porta || 554);
  const channel = Number(form.canal || 1);
  const stream = form.stream === "sub" ? 1 : 0;
  return `rtsp://${host}:${port}/user={username}_password={password}_channel=${channel}_stream=${stream}.sdp?real_stream`;
}

function inferNetworkProfile(url: string): Pick<CameraForm, "perfilRede" | "canal" | "stream"> {
  const match = url.match(/_channel=(\d+)_stream=(\d+)/i);
  if (!match) return { perfilRede: "manual", canal: 1, stream: "main" };
  return { perfilRede: "xm-h264dvr", canal: Number(match[1]) || 1, stream: match[2] === "1" ? "sub" : "main" };
}

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

// Estado de execução de uma câmera USB
type CameraRunState = "idle" | "loading" | "active" | "error";

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

// ─── Hook: câmera USB ao vivo ─────────────────────────────────────────────────

function useLiveCamera(camera: Camera | undefined, references: LoadedRecognitionReference[], queryClient: ReturnType<typeof useQueryClient>, keys: ReturnType<typeof useTenantResourceKeyFactory>) {
  const [state, setState] = useState<CameraRunState>("idle");
  const [faces, setFaces] = useState<RecognitionSnapshot[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [lastModelName, setLastModelName] = useState("face-api.js");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const legacyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const submissionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastAnalysisAtRef = useRef(0);
  const inFlightRef = useRef(false);
  const activeRef = useRef(false);
  const faceApiRef = useRef<FaceApiModule | null>(null);
  const refsRef = useRef<LoadedRecognitionReference[]>([]);
  const cooldownRef = useRef<Map<string, number>>(new Map());
  const inFlightRecRef = useRef<Set<string>>(new Set());

  useEffect(() => { refsRef.current = references; }, [references]);

  const stopStream = useCallback(() => {
    if (animationFrameRef.current !== null) { window.cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null; }
    activeRef.current = false;
    const stream = streamRef.current; streamRef.current = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    hlsRef.current?.destroy();
    hlsRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
    }
    inFlightRef.current = false; lastAnalysisAtRef.current = 0;
    clearOverlay(canvasRef.current);
    setAnalyzing(false); setFaces([]); setStatusMessage(""); setErrorMessage(null);
  }, []);

  const persistMatches = useCallback(async (video: HTMLVideoElement, detections: LiveFaceDetection[], snapshots: RecognitionSnapshot[]) => {
    if (!camera?.id || !camera?.escolaId) return;
    const pairs = snapshots.map((s, i) => ({ s, d: detections[i] })).filter(({ s, d }) => Boolean(d) && s.matchStatus === "MATCHED" && Boolean(s.identityKey));
    if (!pairs.length) return;
    await Promise.allSettled(pairs.map(async ({ s, d }) => {
      const key = s.identityKey!;
      const now = Date.now();
      if (inFlightRecRef.current.has(key) || now - (cooldownRef.current.get(key) ?? 0) < RECOGNITION_SUBMIT_COOLDOWN_MS) return;
      const crop = captureRecognitionCrop(video, d.detection.box, submissionCanvasRef.current);
      if (!crop) return;
      inFlightRecRef.current.add(key);
      try {
        const res = await registerCameraRecognition({ cameraId: camera.id, schoolId: camera.escolaId, imagemBase64: crop, expectedStudentId: s.studentId ?? undefined, direcao: "ENTRY", reconhecidoEm: new Date().toISOString(), metadata: { source: "cameras-monitor", localIdentityKey: key } });
        cooldownRef.current.set(key, Date.now());
        return res;
      } finally { inFlightRecRef.current.delete(key); }
    }));
    await Promise.all([queryClient.invalidateQueries({ queryKey: keys.students }), queryClient.invalidateQueries({ queryKey: keys.cameraEvents })]);
  }, [camera?.escolaId, camera?.id, keys.cameraEvents, keys.students, queryClient]);

  const runFrame = useCallback(async () => {
    if (inFlightRef.current) return;
    const video = videoRef.current; const canvas = canvasRef.current; const faceapi = faceApiRef.current;
    if (!video || !canvas || !faceapi || video.readyState < 2) return;
    inFlightRef.current = true; setAnalyzing(true);
    try {
      const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions(FACE_API_ANALYSIS_OPTIONS)).withFaceLandmarks().withFaceDescriptors();
      const ordered = [...detections].sort((a, b) => a.detection.box.x - b.detection.box.x).slice(0, MAX_FACES) as LiveFaceDetection[];
      if (!ordered.length) { setFaces([]); setStatusMessage("Nenhum rosto detectado."); clearOverlay(canvas); return; }
      const refs = refsRef.current;
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
      setFaces(snapshots);
      setLastModelName(hasFaceApi ? "face-api.js" : hasLegacy ? "legacy-grayscale" : "face-api.js");
      const m = snapshots.filter((s) => s.matchStatus === "MATCHED").length;
      const r = snapshots.filter((s) => s.matchStatus === "REVIEW_REQUIRED").length;
      const u = snapshots.filter((s) => s.matchStatus === "UNMATCHED").length;
      setStatusMessage(refs.length ? `${snapshots.length} rosto(s): ${m} reconhecido(s), ${r} revisão, ${u} desconhecido(s).` : `${snapshots.length} rosto(s) detectado(s).`);
      drawNativeOverlay(faceapi, video, canvas, ordered, snapshots);
      void persistMatches(video, ordered, snapshots);
    } catch (e) { console.error("Erro na análise:", e); }
    finally { setAnalyzing(false); inFlightRef.current = false; }
  }, [persistMatches]);

  const startLoop = useCallback(() => {
    const tick = (ts: number) => {
      if (!activeRef.current) return;
      if (ts - lastAnalysisAtRef.current >= DETECTION_INTERVAL_MS) { lastAnalysisAtRef.current = ts; void runFrame(); }
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = window.requestAnimationFrame(tick);
  }, [runFrame]);

  const start = useCallback(async () => {
    if (!camera) { setErrorMessage("Câmera não encontrada."); return; }
    const isNetworkCamera = camera.tipo !== "USB" && camera.url !== "device://live";
    if (!isNetworkCamera && !navigator.mediaDevices?.getUserMedia) { setErrorMessage("Câmera não suportada neste dispositivo."); return; }
    if (typeof window !== "undefined" && !window.isSecureContext && window.location.hostname !== "localhost") {
      setErrorMessage("A câmera só funciona em HTTPS ou localhost."); return;
    }
    setState("loading"); setErrorMessage(null);
    stopStream();
    try {
      const faceApiEngine = await getFaceApiEngine();
      if (!faceApiEngine) { setErrorMessage("Motor face-api.js não pôde ser carregado."); setState("error"); return; }
      faceApiRef.current = faceApiEngine.faceapi;

      const video = videoRef.current;
      if (!video) throw new Error("Elemento de vídeo indisponível.");

      if (isNetworkCamera) {
        const liveUrl = camera.liveUrl ?? camera.url;
        if (!liveUrl.includes(".m3u8")) {
          throw new Error("Esta câmera ainda não possui stream ao vivo publicado pelo gateway.");
        }

        if (Hls.isSupported()) {
          const hls = new Hls({ lowLatencyMode: true, backBufferLength: 15 });
          hlsRef.current = hls;
          await new Promise<void>((resolve, reject) => {
            hls.once(Hls.Events.MANIFEST_PARSED, () => resolve());
            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (data.fatal) reject(new Error(`Falha HLS: ${data.details}`));
            });
            hls.loadSource(liveUrl);
            hls.attachMedia(video);
          });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = liveUrl;
        } else {
          throw new Error("Navegador sem suporte a vídeo HLS.");
        }
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        streamRef.current = stream;
        video.srcObject = stream;
      }

      await video.play().catch(() => undefined);
      activeRef.current = true;
      setState("active");
      const refCount = refsRef.current.length;
      setStatusMessage(refCount ? `${refCount} identidade(s) carregada(s). Iniciando detecção...` : 'Câmera ativa. Rostos sem cadastro = "Desconhecido".');
      startLoop(); void runFrame();
    } catch (e) {
      console.error("Erro ao iniciar câmera:", e);
      setErrorMessage(e instanceof Error ? e.message : "Não foi possível iniciar o vídeo ao vivo.");
      setState("error");
      stopStream();
    }
  }, [camera, runFrame, startLoop, stopStream]);

  const stop = useCallback(() => {
    stopStream();
    setState("idle");
  }, [stopStream]);

  const restart = useCallback(() => {
    stop();
    setTimeout(() => void start(), 100);
  }, [start, stop]);

  // Cleanup ao desmontar
  useEffect(() => () => stopStream(), [stopStream]);

  return { state, faces, statusMessage, errorMessage, analyzing, lastModelName, videoRef, canvasRef, legacyCanvasRef, submissionCanvasRef, start, stop, restart };
}

// ─── Inline camera drawer ────────────────────────────────────────────────────

function CameraDrawer({ open, onClose, editCamera, queryClient, keys, schools }: {
  open: boolean;
  onClose: () => void;
  editCamera?: Camera | null;
  queryClient: ReturnType<typeof useQueryClient>;
  keys: ReturnType<typeof useTenantResourceKeyFactory>;
  schools: { id: string; nome: string }[];
}) {
  const [form, setForm] = useState<CameraForm>(emptyCameraForm);
  const [discoveredCameras, setDiscoveredCameras] = useState<CameraDiscoveryCandidate[]>([]);

  useEffect(() => {
    if (editCamera) {
      const profile = inferNetworkProfile(editCamera.url);
      setForm({
        id: editCamera.id, nome: editCamera.nome, escolaId: editCamera.escolaId,
        localizacao: editCamera.localizacao, tipo: editCamera.tipo,
        url: profile.perfilRede === "xm-h264dvr" ? stripProtocol(editCamera.url).split(":")[0] : editCamera.url,
        porta: Number((editCamera.url.split(":").slice(-1)[0] || "554").split("/")[0]) || 554,
        perfilRede: profile.perfilRede, canal: profile.canal, stream: profile.stream,
        resolucao: editCamera.resolucao, fps: editCamera.fps, status: editCamera.status,
        usuario: editCamera.usuario ?? "", senha: editCamera.senha ?? "",
      });
    } else {
      setForm(emptyCameraForm);
    }
    setDiscoveredCameras([]);
  }, [editCamera, open]);

  const createMutation = useMutation({
    mutationFn: createCamera,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: keys.cameras }); toast.success("Câmera cadastrada"); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao cadastrar câmera"),
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: CameraForm) => {
      if (!payload.id) throw new Error("ID inválido");
      return updateCamera(payload.id, payload);
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: keys.cameras }); toast.success("Câmera atualizada"); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar câmera"),
  });

  const ensureDeviceMutation = useMutation({
    mutationFn: async (payload: CameraForm) => {
      if (!payload.escolaId) throw new Error("Selecione a escola");
      const deviceCamera = await ensureDeviceCameraSource(payload.escolaId);
      return updateCamera(deviceCamera.id, { nome: payload.nome || "Câmera do dispositivo", escolaId: payload.escolaId, localizacao: "Dispositivo local", tipo: "USB", url: "device://live", resolucao: payload.resolucao, fps: 30, status: payload.status });
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: keys.cameras }); toast.success("Câmera do dispositivo cadastrada"); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao cadastrar câmera"),
  });

  const discoverMutation = useMutation({
    mutationFn: discoverCameras,
    onSuccess: (cameras) => {
      setDiscoveredCameras(cameras);
      if (cameras.length === 0) { toast.info("Nenhuma câmera encontrada na rede local"); return; }
      toast.success(`${cameras.length} dispositivo(s) encontrado(s)`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao buscar câmeras"),
  });

  const isPending = createMutation.isPending || updateMutation.isPending || ensureDeviceMutation.isPending;
  const isDevice = form.tipo === "USB";
  const isNetwork = form.tipo === "IP" || form.tipo === "RTSP";
  const resolvedStreamUrl = isDevice ? "device://live" : buildNetworkUrl(form);

  const setTipo = (tipo: Camera["tipo"]) => {
    setForm({ ...emptyCameraForm, escolaId: form.escolaId, tipo, nome: tipo === "USB" ? "Câmera do dispositivo" : "", porta: tipo === "RTSP" ? 554 : tipo === "IP" ? 80 : 554, perfilRede: tipo === "RTSP" ? "xm-h264dvr" : "manual", canal: 1, stream: "main" });
  };

  const selectDiscoveredCamera = (camera: CameraDiscoveryCandidate) => {
    const rtspPort = camera.ports.includes(554) ? 554 : camera.ports.includes(8554) ? 8554 : 554;
    const profile: NetworkProfile = camera.profile === "xm-h264dvr" ? "xm-h264dvr" : "manual";
    setForm({ ...form, tipo: camera.profile === "ip" ? "IP" : "RTSP", perfilRede: profile, url: camera.ip, porta: rtspPort, canal: 1, stream: "main", usuario: form.usuario || (profile === "xm-h264dvr" ? "yura" : ""), localizacao: form.localizacao || "Câmera encontrada na rede" });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.nome.trim() || !form.escolaId) { toast.error("Preencha o nome e a escola"); return; }
    if (isNetwork && !resolvedStreamUrl.trim()) { toast.error("Informe a URL ou endereço IP"); return; }
    if (form.perfilRede === "xm-h264dvr" && (!form.usuario.trim() || !form.senha.trim())) { toast.error("Informe usuário e senha para H264DVR / XM / iCSee"); return; }
    if (form.id) { updateMutation.mutate({ ...form, url: resolvedStreamUrl, fps: Number(form.fps || 30) }); return; }
    if (isDevice) { ensureDeviceMutation.mutate(form); return; }
    createMutation.mutate({ ...form, url: resolvedStreamUrl, fps: Number(form.fps || 30) });
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{form.id ? "Editar Câmera" : "Nova Câmera"}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="mt-4 space-y-5">
          {/* Tipo */}
          <div>
            <Label className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3 block">Tipo de câmera</Label>
            <div className="grid grid-cols-3 gap-2">
              {CAMERA_TYPES_DEF.map(({ value, label, description, icon: Icon }) => (
                <button key={value} type="button" onClick={() => setTipo(value)}
                  className={cn("flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-all text-sm",
                    form.tipo === value ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/40")}>
                  <Icon className={cn("h-4 w-4", form.tipo === value ? "text-primary" : "text-muted-foreground")} />
                  <div className={cn("font-semibold text-xs", form.tipo === value ? "text-primary" : "")}>{label}</div>
                  <div className="text-[10px] text-muted-foreground leading-tight">{description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Campos comuns */}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <Label>Nome / Identificação *</Label>
              <Input placeholder={isDevice ? "Ex: Webcam Recepção" : "Ex: Portão Principal"} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div>
              <Label>Escola vinculada *</Label>
              <Select value={form.escolaId} onValueChange={(v) => setForm({ ...form, escolaId: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione a escola" /></SelectTrigger>
                <SelectContent>{schools.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Resolução</Label>
                <Select value={form.resolucao} onValueChange={(v) => setForm({ ...form, resolucao: v as Camera["resolucao"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["720p", "1080p", "4K"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as Camera["status"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["Ativa", "Inativa", "Manutenção"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Rede */}
          {isNetwork && (
            <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Configuração de rede</p>
              <Button type="button" variant="outline" size="sm" onClick={() => discoverMutation.mutate()} disabled={discoverMutation.isPending}>
                {discoverMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Radar className="h-3.5 w-3.5 mr-1" />}
                Buscar na rede
              </Button>
              {discoveredCameras.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {discoveredCameras.map((cam) => (
                    <button key={cam.ip} type="button" onClick={() => selectDiscoveredCamera(cam)}
                      className="rounded border border-primary/20 bg-background p-2 text-left hover:border-primary/60 transition-colors">
                      <div className="text-sm font-medium">{cam.ip}</div>
                      <div className="text-[11px] text-muted-foreground">{cam.label} · {cam.ports.join(", ")}</div>
                    </button>
                  ))}
                </div>
              )}
              {form.tipo === "RTSP" && (
                <div>
                  <Label>Perfil de conexão</Label>
                  <Select value={form.perfilRede} onValueChange={(v) => setForm({ ...form, perfilRede: v as NetworkProfile })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{NETWORK_PROFILES_DEF.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground mt-1">{NETWORK_PROFILES_DEF.find((p) => p.value === form.perfilRede)?.description}</p>
                </div>
              )}
              <div>
                <Label>{form.perfilRede === "xm-h264dvr" ? "IP da câmera *" : form.tipo === "RTSP" ? "URL RTSP *" : "Endereço IP / URL *"}</Label>
                <Input placeholder={form.perfilRede === "xm-h264dvr" ? "192.168.0.106" : form.tipo === "RTSP" ? "rtsp://192.168.0.10:554/stream" : "192.168.0.10"} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Porta</Label>
                  <Input type="number" value={form.porta} onChange={(e) => setForm({ ...form, porta: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>FPS</Label>
                  <Input type="number" value={form.fps} onChange={(e) => setForm({ ...form, fps: Number(e.target.value) })} />
                </div>
              </div>
              {form.perfilRede === "xm-h264dvr" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Canal</Label>
                    <Input type="number" min={1} value={form.canal} onChange={(e) => setForm({ ...form, canal: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label>Stream</Label>
                    <Select value={form.stream} onValueChange={(v) => setForm({ ...form, stream: v as "main" | "sub" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="main">Principal</SelectItem><SelectItem value="sub">Substream</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Usuário</Label>
                    <Input placeholder="admin" value={form.usuario} onChange={(e) => setForm({ ...form, usuario: e.target.value })} />
                  </div>
                  <div>
                    <Label>Senha</Label>
                    <Input type="password" placeholder="••••••••" value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} />
                  </div>
                </div>
              )}
              {form.tipo === "IP" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Usuário</Label>
                    <Input placeholder="admin" value={form.usuario} onChange={(e) => setForm({ ...form, usuario: e.target.value })} />
                  </div>
                  <div>
                    <Label>Senha</Label>
                    <Input type="password" placeholder="••••••••" value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} />
                  </div>
                </div>
              )}
              <div>
                <Label>Localização</Label>
                <Input placeholder="Ex: Entrada principal lado norte" value={form.localizacao} onChange={(e) => setForm({ ...form, localizacao: e.target.value })} />
              </div>
            </div>
          )}

          {isDevice && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
              A webcam deste dispositivo será usada como fonte ao vivo para reconhecimento facial.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="outline" type="button" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {form.id ? "Salvar Alterações" : isDevice ? "Cadastrar Webcam" : "Cadastrar Câmera"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ─── Câmera USB inline card ───────────────────────────────────────────────────

function UsbCameraCard({ camera, references, queryClient, keys, camEvents, school, autoStart, onEdit }: {
  camera: Camera;
  references: LoadedRecognitionReference[];
  queryClient: ReturnType<typeof useQueryClient>;
  keys: ReturnType<typeof useTenantResourceKeyFactory>;
  camEvents: { matchStatus: string }[];
  school: { nome: string } | undefined;
  autoStart: boolean;
  onEdit: (camera: Camera) => void;
}) {
  const live = useLiveCamera(camera, references, queryClient, keys);
  const hasStarted = useRef(false);

  // Auto-start quando câmera está ativa e autoStart=true
  useEffect(() => {
    if (!autoStart || hasStarted.current || camera.status !== "Ativa") return;
    hasStarted.current = true;
    void live.start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, camera.status]);

  const deleteMutation = useMutation({
    mutationFn: deleteCamera,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: keys.cameras }); toast.success("Câmera removida"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao remover"),
  });

  const camMatched = camEvents.filter((e) => e.matchStatus === "MATCHED").length;
  const isActive = live.state === "active";
  const isLoading = live.state === "loading";

  return (
    <div className={cn("rounded-lg border bg-background p-4 transition-colors", isActive ? "border-green-300" : "border-border hover:border-primary/40")}>
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          {isActive ? (
            <span className="flex h-4 w-4 items-center justify-center"><span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /></span>
          ) : (
            <CameraIcon className="h-4 w-4 text-muted-foreground/50" />
          )}
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{camera.nome}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {school?.nome ?? "Escola não vinculada"} • Webcam/USB
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isActive && (
            <span className="text-[10px] font-semibold tracking-widest text-green-700 uppercase">Ao Vivo</span>
          )}
          {isLoading && (
            <span className="text-[10px] font-semibold tracking-widest text-amber-700 flex items-center gap-1 uppercase">
              <Loader2 className="h-3 w-3 animate-spin" /> Iniciando
            </span>
          )}
          <StatusBadge variant={camera.status === "Ativa" ? "ok" : camera.status === "Manutenção" ? "manutencao" : "inativo"}>
            {camera.status}
          </StatusBadge>

          {/* Controles */}
          {!isActive && !isLoading && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => void live.start()} title="Iniciar câmera">
              <Play className="h-3 w-3" /> Iniciar
            </Button>
          )}
          {isActive && (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-rose-500/40 text-rose-400 hover:bg-rose-500/10" onClick={live.stop} title="Parar câmera">
                <Square className="h-3 w-3" /> Parar
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={live.restart} title="Reiniciar câmera">
                <RefreshCw className="h-3 w-3" /> Reiniciar
              </Button>
            </>
          )}
          {live.state === "error" && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-amber-500/40 text-amber-400 hover:bg-amber-500/10" onClick={() => void live.start()} title="Tentar novamente">
              <RefreshCw className="h-3 w-3" /> Tentar
            </Button>
          )}

          <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar" onClick={() => onEdit(camera)}><Pencil className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Remover"
            onClick={() => { if (window.confirm(`Remover ${camera.nome}?`)) deleteMutation.mutate(camera.id); }}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </div>

      {/* Vídeo ao vivo */}
      {(isActive || isLoading) && (
        <div className="mt-3 relative aspect-video bg-black rounded-lg overflow-hidden border border-border">
          <video ref={live.videoRef} autoPlay muted playsInline
            className={cn("absolute inset-0 z-10 h-full w-full object-cover scale-x-[-1] transition-opacity duration-300", isActive ? "opacity-100" : "opacity-0")} />
          <canvas ref={live.canvasRef}
            className={cn("absolute inset-0 z-20 h-full w-full pointer-events-none scale-x-[-1] transition-opacity duration-300", isActive ? "opacity-100" : "opacity-0")} />
          <canvas ref={live.legacyCanvasRef} className="hidden" aria-hidden="true" />
          <canvas ref={live.submissionCanvasRef} className="hidden" aria-hidden="true" />

          {isActive && (
            <>
              <div className="absolute inset-0 z-30 bg-gradient-to-b from-black/10 via-transparent to-black/35" />
              <div className="absolute top-2 left-2 z-40 flex items-center gap-1.5 bg-secondary/20 border border-secondary/50 px-2 py-1 rounded text-[10px] font-display tracking-wider">
                <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse-soft" /> AO VIVO
              </div>
              <div className="absolute top-2 right-2 z-40 flex items-center gap-1.5 rounded border border-primary/30 bg-background/60 px-2 py-1 text-[10px] font-mono text-primary backdrop-blur-sm">
                <ScanFace className="h-3 w-3" /> {live.lastModelName}
                {live.analyzing && <Loader2 className="h-3 w-3 animate-spin text-secondary" />}
              </div>
              {live.statusMessage && (
                <div className="absolute bottom-2 left-2 right-2 z-40 rounded border border-sky-200 bg-sky-50/90 px-2 py-1 text-[10px] text-sky-700 backdrop-blur-sm">
                  {live.statusMessage}
                </div>
              )}
            </>
          )}
          {isLoading && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2">
              <Loader2 className="h-8 w-8 text-primary/60 animate-spin" />
              <span className="font-display tracking-widest text-primary/80 text-xs">INICIANDO...</span>
            </div>
          )}
        </div>
      )}

      {/* Erro */}
      {live.errorMessage && (
        <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{live.errorMessage}</div>
      )}

      {/* Métricas */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <div className="rounded border border-border bg-muted/30 px-2 py-1.5">
          <div className="text-muted-foreground">Detecções hoje</div>
          <div className="font-semibold text-foreground">{camMatched} / {camEvents.length}</div>
        </div>
        <div className="rounded border border-border bg-muted/30 px-2 py-1.5">
          <div className="text-muted-foreground">Resolução</div>
          <div className="font-semibold text-foreground">{camera.resolucao}</div>
        </div>
        <div className="rounded border border-border bg-muted/30 px-2 py-1.5">
          <div className="text-muted-foreground">Rostos ativos</div>
          <div className="font-semibold text-primary">{live.faces.length}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Câmera IP/RTSP card (gerida pelo gateway) ────────────────────────────────

function NetworkCameraCard({ camera, school, camEvents, queryClient, keys, onEdit }: {
  camera: Camera;
  school: { nome: string } | undefined;
  camEvents: { matchStatus: string }[];
  queryClient: ReturnType<typeof useQueryClient>;
  keys: ReturnType<typeof useTenantResourceKeyFactory>;
  onEdit: (camera: Camera) => void;
}) {
  const runtime = cameraRuntimeLabel(camera.operacional?.status);
  const camMatched = camEvents.filter((e) => e.matchStatus === "MATCHED").length;

  const deleteMutation = useMutation({
    mutationFn: deleteCamera,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: keys.cameras }); toast.success("Câmera removida"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao remover"),
  });

  return (
    <div className="rounded-lg border border-border bg-background p-4 hover:border-primary/40 transition-colors">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <HealthIcon status={camera.operacional?.status} />
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{camera.nome}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {school?.nome ?? "Escola não vinculada"} • {camera.tipo} • {camera.localizacao || "Sem localização"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("text-[10px] font-display tracking-widest font-semibold", runtime.className)}>{runtime.label}</span>
          <StatusBadge variant={camera.status === "Ativa" ? "ok" : camera.status === "Manutenção" ? "manutencao" : "inativo"}>
            {camera.status}
          </StatusBadge>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar" onClick={() => onEdit(camera)}><Pencil className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Remover"
            onClick={() => { if (window.confirm(`Remover ${camera.nome}?`)) deleteMutation.mutate(camera.id); }}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <div className="rounded border border-border bg-muted/30 px-2 py-1.5">
          <div className="text-muted-foreground">Tipo</div>
          <div className="font-semibold text-foreground">{camera.tipo}</div>
        </div>
        <div className="rounded border border-border bg-muted/30 px-2 py-1.5">
          <div className="text-muted-foreground">FPS</div>
          <div className="font-semibold flex items-center gap-1">
            {camera.operacional?.fpsMedido != null ? (
              <><span className="text-green-700">{camera.operacional.fpsMedido}</span><span className="text-muted-foreground">/ {camera.fps}</span></>
            ) : camera.fps}
          </div>
        </div>
        <div className="rounded border border-border bg-muted/30 px-2 py-1.5">
          <div className="text-muted-foreground">Detecções hoje</div>
          <div className="font-semibold text-foreground">{camMatched} / {camEvents.length}</div>
        </div>
        <div className="rounded border border-border bg-muted/30 px-2 py-1.5">
          <div className="text-muted-foreground">Gateway</div>
          <div className="font-semibold truncate text-foreground">{camera.operacional?.gatewayId ?? "—"}</div>
        </div>
      </div>

      {camera.operacional && (
        <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
          {camera.operacional.ultimoHeartbeat && (
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Heartbeat: {timeAgo(camera.operacional.ultimoHeartbeat)}</span>
          )}
          {camera.operacional.ultimoFrame && (
            <span className="flex items-center gap-1"><Zap className="h-3 w-3" /> Último frame: {timeAgo(camera.operacional.ultimoFrame)}</span>
          )}
          {camera.operacional.ultimoErro && (
            <span className="flex items-center gap-1 text-rose-400"><XCircle className="h-3 w-3" /> {camera.operacional.ultimoErro}</span>
          )}
        </div>
      )}

      {(!camera.operacional || camera.operacional.status === "OFFLINE" || camera.operacional.status === "ERROR") && (
        <div className="mt-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-400 flex items-center gap-2">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Câmera gerida pelo Camera Gateway. Verifique se o gateway está em execução e a câmera está acessível.
        </div>
      )}
    </div>
  );
}

// ─── Monitor Tab ──────────────────────────────────────────────────────────────

function MonitorTab() {
  const keys = useTenantResourceKeyFactory();
  const queryClient = useQueryClient();
  const now = useNow();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editCamera, setEditCamera] = useState<Camera | null>(null);

  const camerasQuery = useQuery({ queryKey: keys.cameras, queryFn: listCameras, refetchInterval: 30_000 });
  const schoolsQuery = useQuery({ queryKey: keys.schools, queryFn: listSchools });
  const biometricReferencesQuery = useQuery({ queryKey: keys.biometricReferences, queryFn: listBiometricReferences, staleTime: 60_000 });
  const biometricEventsQuery = useQuery({ queryKey: [...keys.cameraEvents, "biometric", now.toISOString().slice(0, 10)] as const, queryFn: () => listBiometricEvents({ data: now.toISOString().slice(0, 10) }), refetchInterval: 15_000 });

  const cameras = camerasQuery.data ?? [];
  const schools = schoolsQuery.data ?? [];
  const biometricEvents = biometricEventsQuery.data ?? [];
  const references = useMemo(() => buildRecognitionReferences(biometricReferencesQuery.data ?? []), [biometricReferencesQuery.data]);

  const openNew = () => { setEditCamera(null); setDrawerOpen(true); };
  const openEdit = (camera: Camera) => { setEditCamera(camera); setDrawerOpen(true); };

  const usbCameras = cameras.filter((c) => c.tipo === "USB" || c.url === "device://live");
  const networkCameras = cameras.filter((c) => c.tipo !== "USB" && c.url !== "device://live");

  const onlineCount = cameras.filter((c) => c.operacional?.status === "ONLINE").length;
  const offlineCount = cameras.filter((c) => !c.operacional?.status || c.operacional.status === "OFFLINE").length;
  const degradedCount = cameras.filter((c) => c.operacional?.status === "DEGRADED" || c.operacional?.status === "ERROR").length;
  const totalDetections = biometricEvents.length;
  const matchedDetections = biometricEvents.filter((e) => e.matchStatus === "MATCHED").length;
  const reviewDetections = biometricEvents.filter((e) => e.matchStatus === "REVIEW_REQUIRED").length;

  return (
    <div className="space-y-4">
      <CameraDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} editCamera={editCamera} queryClient={queryClient} keys={keys} schools={schools} />

      {/* Resumo de saúde */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Online", value: onlineCount, color: "text-green-700", bg: "bg-green-50 border-green-200" },
          { label: "Offline", value: offlineCount, color: "text-muted-foreground", bg: "bg-muted border-border" },
          { label: "Com alerta", value: degradedCount, color: "text-amber-700", bg: "bg-amber-50 border-amber-200" },
          { label: "Total câmeras", value: cameras.length, color: "text-primary", bg: "bg-primary/10 border-primary/30" },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={cn("rounded-lg border p-4", bg)}>
            <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{label}</div>
            <div className={cn("text-3xl font-bold mt-1", color)}>{value}</div>
          </div>
        ))}
      </div>

      {/* Métricas de detecção hoje */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm text-foreground">Detecções Hoje</h3>
          <span className="text-[10px] text-muted-foreground ml-auto">{now.toLocaleDateString("pt-BR")}</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
            <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Total</div>
            <div className="text-2xl font-bold text-primary">{totalDetections}</div>
          </div>
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-center">
            <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Reconhecidos</div>
            <div className="text-2xl font-bold text-green-700">{matchedDetections}</div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
            <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Em Revisão</div>
            <div className="text-2xl font-bold text-amber-700">{reviewDetections}</div>
          </div>
        </div>
        {totalDetections > 0 && (
          <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round((matchedDetections / totalDetections) * 100)}%` }} />
          </div>
        )}
        <div className="mt-2 text-xs text-muted-foreground text-right">
          {totalDetections > 0 ? `${Math.round((matchedDetections / totalDetections) * 100)}% taxa de reconhecimento` : "Nenhuma detecção registrada hoje"}
        </div>
      </div>

      {/* Câmeras USB / Dispositivo */}
      {usbCameras.length > 0 && (
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CameraIcon className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm text-foreground">Câmeras do Dispositivo</h3>
              <span className="text-[10px] text-muted-foreground">(webcam / USB)</span>
            </div>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openNew}>
              <Plus className="h-3 w-3 mr-1" /> Nova
            </Button>
          </div>
          <div className="space-y-3">
            {usbCameras.map((camera) => {
              const school = schools.find((s) => s.id === camera.escolaId);
              const camRefs = references.filter((r) => r.schoolId === camera.escolaId);
              const camEvents = biometricEvents.filter((e) => e.cameraId === camera.id);
              return (
                <UsbCameraCard
                  key={camera.id}
                  camera={camera}
                  references={camRefs}
                  queryClient={queryClient}
                  keys={keys}
                  camEvents={camEvents}
                  school={school}
                  autoStart={camera.status === "Ativa"}
                  onEdit={openEdit}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Câmeras IP / RTSP */}
      {networkCameras.length > 0 && (
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Wifi className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm text-foreground">Câmeras de Rede</h3>
              <span className="text-[10px] text-muted-foreground">(IP / RTSP / NVR)</span>
            </div>
          </div>
          <div className="space-y-3">
            {networkCameras.map((camera) => {
              const school = schools.find((s) => s.id === camera.escolaId);
              const camEvents = biometricEvents.filter((e) => e.cameraId === camera.id);
              return (
                <NetworkCameraCard
                  key={camera.id}
                  camera={camera}
                  school={school}
                  camEvents={camEvents}
                  queryClient={queryClient}
                  keys={keys}
                  onEdit={openEdit}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Estado vazio */}
      {camerasQuery.isLoading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando câmeras...
        </div>
      ) : cameras.length === 0 ? (
        <div className="glass-card p-8 flex flex-col items-center justify-center text-muted-foreground text-sm gap-3">
          <CameraIcon className="h-12 w-12 opacity-30" />
          <span>Nenhuma câmera cadastrada</span>
          <Button size="sm" variant="outline" onClick={openNew}>Cadastrar primeira câmera</Button>
        </div>
      ) : null}
    </div>
  );
}

// ─── Live Tab (câmera ao vivo com reconhecimento — aba separada) ──────────────

function LiveTab({ mode }: { mode: CamerasMode }) {
  const now = useNow();
  const keys = useTenantResourceKeyFactory();
  const queryClient = useQueryClient();
  const [cameraId, setCameraId] = useState<string>("");
  const [escolaExpand, setEscolaExpand] = useState<string>("");

  const schoolsQuery = useQuery({ queryKey: keys.schools, queryFn: listSchools });
  const camerasQuery = useQuery({ queryKey: keys.cameras, queryFn: listCameras });
  const studentsQuery = useQuery({ queryKey: keys.students, queryFn: listStudents });
  const responsiblesQuery = useQuery({ queryKey: keys.responsibles, queryFn: listResponsibles });
  const biometricReferencesQuery = useQuery({ queryKey: keys.biometricReferences, queryFn: listBiometricReferences, staleTime: 300_000 });
  const eventsQuery = useQuery({ queryKey: [...keys.cameraEvents, now.toISOString().slice(0, 10)] as const, queryFn: () => listCameraEvents(now.toISOString().slice(0, 10)) });

  useEffect(() => { if (!cameraId && camerasQuery.data?.[0]?.id) setCameraId(camerasQuery.data[0].id); }, [cameraId, camerasQuery.data]);
  useEffect(() => { if (!escolaExpand && schoolsQuery.data?.[0]?.id) setEscolaExpand(schoolsQuery.data[0].id); }, [escolaExpand, schoolsQuery.data]);

  const references = useMemo(() => buildRecognitionReferences(biometricReferencesQuery.data ?? []), [biometricReferencesQuery.data]);
  const camera = camerasQuery.data?.find((c) => c.id === cameraId) ?? camerasQuery.data?.[0];
  const escola = schoolsQuery.data?.find((s) => s.id === camera?.escolaId);
  const camRefs = useMemo(() => camera ? references.filter((r) => r.schoolId === camera.escolaId) : references, [camera, references]);

  const live = useLiveCamera(camera, camRefs, queryClient, keys);
  const runtime = cameraRuntimeLabel(camera?.operacional?.status);

  const hasAutoStarted = useRef(false);
  useEffect(() => {
    if (mode !== "guard" || !camera?.id || hasAutoStarted.current) return;
    hasAutoStarted.current = true;
    void live.start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera?.id, mode]);

  const matchedFacesCount = live.faces.filter((f) => f.matchStatus === "MATCHED").length;
  const reviewFacesCount = live.faces.filter((f) => f.matchStatus === "REVIEW_REQUIRED").length;
  const unknownFacesCount = live.faces.filter((f) => f.matchStatus === "UNMATCHED").length;

  const referenceCount = camRefs.length;
  const templateCount = useMemo(() => camRefs.reduce((sum, r) => sum + r.descriptors.length, 0), [camRefs]);
  const referenceMessage = useMemo(() => {
    if (biometricReferencesQuery.isLoading) return "Carregando biometrias...";
    if (biometricReferencesQuery.isError) return "Falha ao carregar referências.";
    if (!referenceCount) return 'Nenhuma biometria cadastrada. Rostos = "Desconhecido".';
    return `${referenceCount} identidade(s) prontas (${templateCount} template(s)).`;
  }, [biometricReferencesQuery.isError, biometricReferencesQuery.isLoading, referenceCount, templateCount]);

  const latestEvents = eventsQuery.data ?? [];
  const ausentes = useMemo(() => studentsQuery.data?.filter((s) => s.escolaId === escolaExpand && s.presencaHoje === "ausente") ?? [], [escolaExpand, studentsQuery.data]);
  const turmasEsc = useMemo(() => Array.from(new Set((studentsQuery.data ?? []).filter((s) => s.escolaId === escolaExpand).map((s) => s.turma))), [escolaExpand, studentsQuery.data]);

  const isActive = live.state === "active";
  const isLoading = live.state === "loading";
  const mirrorVideo = camera?.tipo === "USB" || camera?.url === "device://live";

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
            <span className="font-bold text-foreground text-lg">{now.toLocaleTimeString("pt-BR")}</span>
          </div>
        </div>

        <div className="relative aspect-video bg-black rounded-lg overflow-hidden border border-border">
          <video ref={live.videoRef} autoPlay muted playsInline className={cn("absolute inset-0 z-10 h-full w-full object-cover transition-opacity duration-300", mirrorVideo && "scale-x-[-1]", isActive ? "opacity-100" : "opacity-0")} />
          <canvas ref={live.canvasRef} className={cn("absolute inset-0 z-20 h-full w-full pointer-events-none transition-opacity duration-300", mirrorVideo && "scale-x-[-1]", isActive ? "opacity-100" : "opacity-0")} />
          <canvas ref={live.legacyCanvasRef} className="hidden" aria-hidden="true" />
          <canvas ref={live.submissionCanvasRef} className="hidden" aria-hidden="true" />

          {isActive ? (
            <>
              <div className="absolute inset-0 z-30 bg-gradient-to-b from-black/10 via-transparent to-black/35" />
              <div className="absolute top-3 left-3 z-40 flex items-center gap-1.5 bg-secondary/20 border border-secondary/50 px-2 py-1 rounded text-xs font-display tracking-wider">
                <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse-soft" /> AO VIVO
              </div>
              <div className="absolute top-3 right-3 z-40 flex items-center gap-2 rounded border border-primary/30 bg-background/60 px-2 py-1 text-xs font-mono text-primary backdrop-blur-sm">
                <ScanFace className="h-3.5 w-3.5" /> {live.lastModelName} {live.analyzing && <Loader2 className="h-3.5 w-3.5 animate-spin text-secondary" />}
              </div>
              {live.statusMessage && (
                <div className="absolute bottom-3 left-3 right-3 z-40 rounded-lg border px-3 py-2 text-xs backdrop-blur-sm border-sky-200 bg-sky-50 text-sky-700">{live.statusMessage}</div>
              )}
            </>
          ) : (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 px-4 text-center">
              {isLoading ? (
                <>
                  <Loader2 className="h-12 w-12 text-primary/60 animate-spin" />
                  <span className="font-display tracking-widest text-primary/80 text-sm">INICIANDO CÂMERA</span>
                  <p className="max-w-sm text-xs text-muted-foreground">Carregando modelos de reconhecimento facial...</p>
                </>
              ) : (
                <>
                  <CameraIcon className="h-12 w-12 text-primary/60" />
                  <span className="font-display tracking-widest text-primary/80 text-sm">CÂMERA PARADA</span>
                  <Button onClick={() => void live.start()} className="bg-primary text-primary-foreground hover:bg-primary/90" type="button">
                    <Play className="h-4 w-4 mr-1" /> Iniciar câmera
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
          <div className="rounded-lg border border-border bg-muted/30 p-2">
            <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Detecções</div>
            <div className="text-xl font-bold text-primary">{live.faces.length}</div>
          </div>
          <div className="rounded-lg border border-green-200 bg-green-50 p-2">
            <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Reconhecidos</div>
            <div className="text-xl font-bold text-green-700">{matchedFacesCount}</div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
            <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Em Revisão</div>
            <div className="text-xl font-bold text-amber-700">{reviewFacesCount || unknownFacesCount}</div>
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-dashed border-border bg-background/50 px-4 py-3 text-xs text-muted-foreground">{referenceMessage}</div>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          {!isActive && !isLoading && (
            <Button type="button" onClick={() => void live.start()}>
              <Play className="mr-2 h-4 w-4" /> Iniciar câmera
            </Button>
          )}
          {isActive && (
            <>
              <Button type="button" variant="outline" onClick={live.stop} className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10">
                <Square className="mr-2 h-4 w-4" /> Parar
              </Button>
              <Button type="button" variant="outline" onClick={live.restart}>
                <RefreshCw className="mr-2 h-4 w-4" /> Reiniciar
              </Button>
            </>
          )}
          {isLoading && (
            <Button type="button" variant="outline" disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Iniciando...
            </Button>
          )}
        </div>

        {live.errorMessage && (
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{live.errorMessage}</div>
        )}
      </div>

      {/* Painel lateral: atividade em tempo real */}
      <div className="glass-card p-4 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-foreground">Atividade em Tempo Real</h3>
          <span className="h-2 w-2 rounded-full bg-primary animate-pulse-soft" />
        </div>
        <ul className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
          {latestEvents.map((event) => {
            const student = studentsQuery.data?.find((s) => s.id === event.alunoId);
            const responsible = responsiblesQuery.data?.find((r) => r.id === student?.responsavelPrincipalId);
            if (!student || !responsible) return null;
            const message = `Olá ${responsible.nome}, seu(sua) filho(a) ${student.nome.split(" ")[0]} ${event.tipo === "Entrou" ? "entrou na" : "saiu da"} escola às ${event.horario}.`;
            const link = formatWhatsAppLink(responsible.whatsapp, message);
            return (
              <li key={event.id} className="flex items-center gap-3 p-2 rounded-lg border border-border bg-background hover:border-primary/40 transition-colors">
                <div className="relative">
                  <img src={student.foto} alt={student.nome} className="h-10 w-10 rounded-full bg-muted border border-border object-cover" />
                  <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{student.nome}</div>
                  <div className="text-[11px] text-muted-foreground">{student.turma} • {event.horario}</div>
                </div>
                <StatusBadge variant={event.tipo === "Entrou" ? "presente" : "saiu"}>{event.tipo}</StatusBadge>
                <a href={link} target="_blank" rel="noreferrer" className="p-2 rounded-md bg-green-50 border border-green-200 hover:bg-green-100 text-green-700" title="Notificar via WhatsApp">
                  <MessageCircle className="h-4 w-4" />
                </a>
              </li>
            );
          })}
          {eventsQuery.isLoading && <li className="text-sm text-muted-foreground">Carregando atividades...</li>}
        </ul>

        <div className="mt-4 pt-4 border-t border-border">
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
                <div key={turma} className="rounded border border-border bg-background px-3 py-2">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-semibold">{turma}</span>
                    <span className="text-primary font-bold">{pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
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
      />

      <div className="flex gap-1 mb-4 border-b border-border">
        {([
          { value: "monitor", label: "Monitoramento & Saúde" },
          { value: "live", label: "Vídeo ao Vivo" },
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

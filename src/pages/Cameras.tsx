import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Camera as CameraIcon,
  CameraOff,
  Loader2,
  Maximize2,
  MessageCircle,
  ScanFace,
  Settings,
} from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTenantResourceKeyFactory } from "@/context/auth-context";
import { type BiometricRecognitionReference } from "@/lib/domain";
import { getFaceApiEngine, type FaceApiModule } from "@/lib/face-api-engine";
import {
  listBiometricReferences,
  listCameraEvents,
  listCameras,
  listResponsibles,
  listSchools,
  listStudents,
  ensureDeviceCameraSource,
  registerCameraRecognition,
} from "@/lib/resources";
import { formatWhatsAppLink } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

type FaceMatchStatus = "MATCHED" | "REVIEW_REQUIRED" | "UNMATCHED";

type LiveFaceDetection = {
  detection: {
    box: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    score: number;
  };
  landmarks: {
    positions: Array<{ x: number; y: number; z?: number }>;
  };
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

type FeedbackTone = "neutral" | "warning" | "success";

type LoadedRecognitionReference = {
  identityId: string;
  studentId: string | null;
  schoolId: string;
  displayName: string;
  schoolName: string | null;
  studentName: string | null;
  descriptors: Float32Array[];
};

const DETECTION_INTERVAL_MS = 180;
const MAX_FACES = 8;
const FACE_API_DESCRIPTOR_SIZE = 128;
const LEGACY_DESCRIPTOR_SIZE = 24;
const FACE_API_MATCH_DISTANCE_THRESHOLD = 0.6;
const FACE_API_REVIEW_DISTANCE_THRESHOLD = 0.75;
const LEGACY_MATCH_DISTANCE_THRESHOLD = 0.5;
const LEGACY_REVIEW_DISTANCE_THRESHOLD = 0.7;
const MATCH_DISTANCE_THRESHOLD = FACE_API_MATCH_DISTANCE_THRESHOLD;
const REVIEW_DISTANCE_THRESHOLD = FACE_API_REVIEW_DISTANCE_THRESHOLD;
const MIN_DISTANCE_GAP = 0.05;
const RECOGNITION_SUBMIT_COOLDOWN_MS = 15_000;
const RECOGNITION_CROP_PADDING_RATIO = 0.18;
const RECOGNITION_EXPORT_SIZE = 320;
const FACE_API_ANALYSIS_OPTIONS = {
  inputSize: 512 as const,
  scoreThreshold: 0.3,
};

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
  if (!vector || typeof vector.length !== "number" || vector.length === 0) {
    return new Float32Array();
  }

  const values = Array.from(vector, (value) => Number(value) || 0);
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));

  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    return new Float32Array(values);
  }

  return new Float32Array(values.map((value) => value / magnitude));
}

function bestTemplateDistance(descriptor: Float32Array, templates: Float32Array[]) {
  if (!descriptor.length || !templates.length) {
    return Number.POSITIVE_INFINITY;
  }

  return templates.reduce((bestDistance, template) => {
    const currentDistance = euclideanDistance(descriptor, template);
    return currentDistance < bestDistance ? currentDistance : bestDistance;
  }, Number.POSITIVE_INFINITY);
}

function euclideanDistance(left: ArrayLike<number>, right: ArrayLike<number>) {
  const size = Math.min(left.length || 0, right.length || 0);
  if (!size) {
    return Number.POSITIVE_INFINITY;
  }

  let sum = 0;
  for (let index = 0; index < size; index += 1) {
    const delta = (Number(left[index]) || 0) - (Number(right[index]) || 0);
    sum += delta * delta;
  }

  return Math.sqrt(sum);
}

function createRecognitionDecision(
  family: "face-api" | "legacy",
  descriptor: Float32Array,
  references: LoadedRecognitionReference[],
) {
  const matchThreshold = family === "face-api" ? FACE_API_MATCH_DISTANCE_THRESHOLD : LEGACY_MATCH_DISTANCE_THRESHOLD;
  const reviewThreshold = family === "face-api" ? FACE_API_REVIEW_DISTANCE_THRESHOLD : LEGACY_REVIEW_DISTANCE_THRESHOLD;

  if (!references.length || !descriptor.length) {
    return {
      identityKey: null,
      identityName: null,
      studentId: null,
      distance: Number.POSITIVE_INFINITY,
      secondBestDistance: Number.POSITIVE_INFINITY,
      confidence: 0,
      matchStatus: "UNMATCHED" as const,
      reviewReason: null as string | null,
      family,
    };
  }

  const rankedCandidates = references
    .map((reference) => {
      const templates = reference.descriptors.filter((vector) =>
        family === "face-api" ? vector.length === FACE_API_DESCRIPTOR_SIZE : vector.length !== FACE_API_DESCRIPTOR_SIZE,
      );
      const distance = bestTemplateDistance(descriptor, templates);

      return {
        identityKey: reference.identityId,
        identityName: reference.displayName,
        studentId: reference.studentId,
        distance,
      };
    })
    .filter((candidate) => Number.isFinite(candidate.distance))
    .sort((left, right) => left.distance - right.distance);

  const bestCandidate = rankedCandidates[0];
  const secondCandidate = rankedCandidates[1];

  if (!bestCandidate) {
    return {
      identityKey: null,
      identityName: null,
      studentId: null,
      distance: Number.POSITIVE_INFINITY,
      secondBestDistance: Number.POSITIVE_INFINITY,
      confidence: 0,
      matchStatus: "UNMATCHED" as const,
      reviewReason: null as string | null,
      family,
    };
  }

  const secondBestDistance = secondCandidate?.distance ?? Number.POSITIVE_INFINITY;
  const distanceGap = secondBestDistance - bestCandidate.distance;
  const confidence = clamp(Number.isFinite(bestCandidate.distance) ? 1 - bestCandidate.distance : 0, 0, 1);

  if (bestCandidate.distance <= matchThreshold && distanceGap >= MIN_DISTANCE_GAP) {
    return {
      identityKey: bestCandidate.identityKey,
      identityName: bestCandidate.identityName,
      studentId: bestCandidate.studentId,
      distance: bestCandidate.distance,
      secondBestDistance,
      confidence,
      matchStatus: "MATCHED" as const,
      reviewReason: null as string | null,
      family,
    };
  }

  if (bestCandidate.distance <= reviewThreshold) {
    return {
      identityKey: bestCandidate.identityKey,
      identityName: bestCandidate.identityName,
      studentId: bestCandidate.studentId,
      distance: bestCandidate.distance,
      secondBestDistance,
      confidence,
      matchStatus: "REVIEW_REQUIRED" as const,
      reviewReason:
        distanceGap < MIN_DISTANCE_GAP
          ? "Correspondência ambígua entre biometrias próximas."
          : `Distância de comparação ${bestCandidate.distance.toFixed(2)}.`,
      family,
    };
  }

  return {
    identityKey: null,
    identityName: null,
    studentId: null,
    distance: bestCandidate.distance,
    secondBestDistance,
    confidence,
    matchStatus: "UNMATCHED" as const,
    reviewReason: null as string | null,
    family,
  };
}

function pickBetterRecognition(
  current:
    | ReturnType<typeof createRecognitionDecision>
    | null,
  previous:
    | ReturnType<typeof createRecognitionDecision>
    | null,
) {
  if (!current) {
    return previous;
  }

  if (!previous) {
    return current;
  }

  if (previous.family === "face-api" && previous.matchStatus !== "UNMATCHED") {
    return previous;
  }

  if (current.family === "face-api" && current.matchStatus !== "UNMATCHED") {
    return current;
  }

  const ranking = {
    MATCHED: 3,
    REVIEW_REQUIRED: 2,
    UNMATCHED: 1,
  } as const;

  const currentScore = ranking[current.matchStatus];
  const previousScore = ranking[previous.matchStatus];

  if (currentScore !== previousScore) {
    return currentScore > previousScore ? current : previous;
  }

  return current.distance <= previous.distance ? current : previous;
}

function buildLegacyDescriptorFromVideo(
  video: HTMLVideoElement,
  box: { x: number; y: number; width: number; height: number },
  canvas: HTMLCanvasElement | null,
) {
  if (!canvas || !video.videoWidth || !video.videoHeight) {
    return new Float32Array();
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return new Float32Array();
  }

  const sourceX = clamp(Math.floor(box.x), 0, Math.max(video.videoWidth - 1, 0));
  const sourceY = clamp(Math.floor(box.y), 0, Math.max(video.videoHeight - 1, 0));
  const sourceWidth = Math.max(1, Math.min(Math.ceil(box.width), video.videoWidth - sourceX));
  const sourceHeight = Math.max(1, Math.min(Math.ceil(box.height), video.videoHeight - sourceY));

  canvas.width = LEGACY_DESCRIPTOR_SIZE;
  canvas.height = LEGACY_DESCRIPTOR_SIZE;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const values: number[] = [];

  for (let index = 0; index < imageData.length; index += 4) {
    const red = imageData[index] ?? 0;
    const green = imageData[index + 1] ?? 0;
    const blue = imageData[index + 2] ?? 0;
    const gray = (red * 0.299 + green * 0.587 + blue * 0.114) / 255 - 0.5;
    values.push(gray);
  }

  return normalizeDescriptor(values);
}

function captureRecognitionCrop(
  video: HTMLVideoElement,
  box: { x: number; y: number; width: number; height: number },
  canvas: HTMLCanvasElement | null,
) {
  if (!canvas || !video.videoWidth || !video.videoHeight) {
    return null;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  const paddingX = box.width * RECOGNITION_CROP_PADDING_RATIO;
  const paddingY = box.height * RECOGNITION_CROP_PADDING_RATIO;
  const sourceX = clamp(Math.floor(box.x - paddingX), 0, Math.max(video.videoWidth - 1, 0));
  const sourceY = clamp(Math.floor(box.y - paddingY), 0, Math.max(video.videoHeight - 1, 0));
  const sourceWidth = Math.max(1, Math.min(Math.ceil(box.width + paddingX * 2), video.videoWidth - sourceX));
  const sourceHeight = Math.max(1, Math.min(Math.ceil(box.height + paddingY * 2), video.videoHeight - sourceY));

  canvas.width = RECOGNITION_EXPORT_SIZE;
  canvas.height = RECOGNITION_EXPORT_SIZE;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/jpeg", 0.92);
}

function getTone(matchStatus: FaceMatchStatus) {
  if (matchStatus === "MATCHED") {
    return {
      border: "border-emerald-300",
      fill: "bg-emerald-500/85",
      text: "text-emerald-50",
      chip: "border-emerald-200 bg-emerald-100 text-emerald-800",
      box: "#10b981",
    };
  }

  if (matchStatus === "REVIEW_REQUIRED") {
    return {
      border: "border-amber-300",
      fill: "bg-amber-500/85",
      text: "text-amber-50",
      chip: "border-amber-200 bg-amber-100 text-amber-800",
      box: "#f59e0b",
    };
  }

  return {
    border: "border-rose-300",
    fill: "bg-rose-500/85",
    text: "text-rose-50",
    chip: "border-rose-200 bg-rose-100 text-rose-800",
    box: "#f43f5e",
  };
}

function buildRecognitionReferences(items: BiometricRecognitionReference[]): LoadedRecognitionReference[] {
  const references: LoadedRecognitionReference[] = [];

  for (const item of items) {
    const descriptors = (item.embeddings ?? [])
      .filter((embedding) => embedding?.isActive !== false && Array.isArray(embedding.vector) && embedding.vector.length > 0)
      .map((embedding) => normalizeDescriptor(embedding.vector))
      .filter((vector) => vector.length > 0);

    if (!descriptors.length) {
      continue;
    }

    references.push({
      identityId: item.id,
      studentId: item.studentId ?? item.student?.id ?? null,
      schoolId: item.schoolId,
      displayName: item.student?.nome?.trim() || item.label?.trim() || item.id,
      schoolName: item.school?.nome?.trim() || null,
      studentName: item.student?.nome?.trim() || null,
      descriptors,
    });
  }

  return references;
}

function scoreDescriptorAgainstReferences(descriptor: Float32Array, references: LoadedRecognitionReference[]) {
  if (!references.length || !descriptor.length) {
    return {
      identityKey: null,
      identityName: null,
      distance: Number.POSITIVE_INFINITY,
      secondBestDistance: Number.POSITIVE_INFINITY,
      confidence: 0,
      matchStatus: "UNMATCHED" as const,
      reviewReason: null as string | null,
    };
  }

  const rankedCandidates = references
    .map((reference) => {
      const distance = reference.descriptors.reduce((bestDistance, template) => {
        const currentDistance = euclideanDistance(descriptor, template);
        return currentDistance < bestDistance ? currentDistance : bestDistance;
      }, Number.POSITIVE_INFINITY);

      return {
        identityKey: reference.identityId,
        identityName: reference.displayName,
        distance,
      };
    })
    .filter((candidate) => Number.isFinite(candidate.distance))
    .sort((left, right) => left.distance - right.distance);

  const bestCandidate = rankedCandidates[0];
  const secondCandidate = rankedCandidates[1];

  if (!bestCandidate) {
    return {
      identityKey: null,
      identityName: null,
      distance: Number.POSITIVE_INFINITY,
      secondBestDistance: Number.POSITIVE_INFINITY,
      confidence: 0,
      matchStatus: "UNMATCHED" as const,
      reviewReason: null as string | null,
    };
  }

  const secondBestDistance = secondCandidate?.distance ?? Number.POSITIVE_INFINITY;
  const distanceGap = secondBestDistance - bestCandidate.distance;
  const confidence = clamp(Number.isFinite(bestCandidate.distance) ? 1 - bestCandidate.distance : 0, 0, 1);

  if (bestCandidate.distance <= MATCH_DISTANCE_THRESHOLD && distanceGap >= MIN_DISTANCE_GAP) {
    return {
      identityKey: bestCandidate.identityKey,
      identityName: bestCandidate.identityName,
      distance: bestCandidate.distance,
      secondBestDistance,
      confidence,
      matchStatus: "MATCHED" as const,
      reviewReason: null as string | null,
    };
  }

  if (bestCandidate.distance <= REVIEW_DISTANCE_THRESHOLD) {
    return {
      identityKey: bestCandidate.identityKey,
      identityName: bestCandidate.identityName,
      distance: bestCandidate.distance,
      secondBestDistance,
      confidence,
      matchStatus: "REVIEW_REQUIRED" as const,
      reviewReason:
        distanceGap < MIN_DISTANCE_GAP
          ? "Correspondência ambígua entre biometrias próximas."
          : `Distância de comparação ${bestCandidate.distance.toFixed(2)}.`,
    };
  }

  return {
    identityKey: null,
    identityName: null,
    distance: bestCandidate.distance,
    secondBestDistance,
    confidence,
    matchStatus: "UNMATCHED" as const,
    reviewReason: null as string | null,
  };
}

function dedupeFrameMatches(snapshots: RecognitionSnapshot[]) {
  const strongestMatchByIdentity = new Map<string, { index: number; distance: number }>();

  snapshots.forEach((snapshot, index) => {
    if (snapshot.matchStatus !== "MATCHED" || !snapshot.identityKey) {
      return;
    }

    const distance = snapshot.distance ?? Number.POSITIVE_INFINITY;
    const currentStrongest = strongestMatchByIdentity.get(snapshot.identityKey);

    if (!currentStrongest || distance < currentStrongest.distance) {
      strongestMatchByIdentity.set(snapshot.identityKey, { index, distance });
    }
  });

  return snapshots.map((snapshot, index) => {
    if (snapshot.matchStatus !== "MATCHED" || !snapshot.identityKey) {
      return snapshot;
    }

    const strongest = strongestMatchByIdentity.get(snapshot.identityKey);
    if (!strongest || strongest.index === index) {
      return snapshot;
    }

    return {
      ...snapshot,
      label: `Desconhecido ${snapshot.faceIndex}`,
      identityName: null,
      identityKey: null,
      matchStatus: "UNMATCHED" as const,
      reviewReason: "Outra face no quadro teve correspondência melhor para esta identidade.",
    };
  });
}

function clearOverlay(canvas: HTMLCanvasElement | null) {
  if (!canvas) {
    return;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  canvas.width = 1;
  canvas.height = 1;
  context.clearRect(0, 0, 1, 1);
}

function drawNativeOverlay(
  faceapi: FaceApiModule,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  detections: LiveFaceDetection[],
  snapshots: RecognitionSnapshot[],
) {
  const context = canvas.getContext("2d");
  if (!context || !video.videoWidth || !video.videoHeight) {
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  context.clearRect(0, 0, canvas.width, canvas.height);

  detections.forEach((detection, index) => {
    const snapshot = snapshots[index];
    const tone = getTone(snapshot?.matchStatus ?? "UNMATCHED");
    const label =
      snapshot?.identityName?.trim() ||
      snapshot?.label ||
      `Desconhecido ${index + 1}`;

    new faceapi.draw.DrawBox(detection.detection.box, {
      label,
      boxColor: tone.box,
      lineWidth: 3,
      drawLabelOptions: {
        backgroundColor: "rgba(15, 23, 42, 0.92)",
        fontColor: "#ffffff",
        padding: 6,
      },
    }).draw(context);

    new faceapi.draw.DrawFaceLandmarks(detection.landmarks as never).draw(context);

    if (snapshot?.reviewReason) {
      const reason = snapshot.reviewReason;
      const box = detection.detection.box;
      const y = box.y + box.height + 10;

      context.save();
      context.font = '600 11px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      context.fillStyle = tone.fill;
      const textWidth = Math.min(context.measureText(reason).width + 20, canvas.width - box.x);
      context.fillRect(box.x, y, Math.max(textWidth, 96), 22);
      context.fillStyle = "#fff";
      context.fillText(reason, box.x + 10, y + 14);
      context.restore();
    }
  });
}

type CamerasMode = "test" | "guard";

function cameraRuntimeLabel(status?: string) {
  switch (status) {
    case "ONLINE":
      return { label: "ONLINE", className: "text-secondary" };
    case "DEGRADED":
      return { label: "DEGRADADA", className: "text-warning" };
    case "ERROR":
      return { label: "ERRO", className: "text-destructive" };
    case "OFFLINE":
      return { label: "OFFLINE", className: "text-muted-foreground" };
    default:
      return { label: "SEM GATEWAY", className: "text-muted-foreground" };
  }
}

export function CamerasView({ mode = "test" }: { mode?: CamerasMode }) {
  const now = useNow();
  const keys = useTenantResourceKeyFactory();
  const queryClient = useQueryClient();
  const [cameraId, setCameraId] = useState<string>("");
  const [escolaExpand, setEscolaExpand] = useState<string>("");
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Abra a câmera do dispositivo para detectar múltiplos rostos em tempo real.");
  const [error, setError] = useState<string | null>(null);
  const [faces, setFaces] = useState<RecognitionSnapshot[]>([]);
  const [lastModelName, setLastModelName] = useState("face-api.js");

  useEffect(() => {
    if (!cameraActive && !cameraLoading) {
      setStatusMessage(
        mode === "guard"
          ? "Iniciando monitoramento automático..."
          : "Abra a câmera do dispositivo para detectar múltiplos rostos em tempo real.",
      );
    }
  }, [cameraActive, cameraLoading, mode]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastAnalysisAtRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const inFlightRef = useRef(false);
  const cameraActiveRef = useRef(false);
  const faceApiRef = useRef<FaceApiModule | null>(null);
  const legacyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const submissionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recognitionReferencesRef = useRef<LoadedRecognitionReference[]>([]);
  const recognitionCooldownRef = useRef<Map<string, number>>(new Map());
  const recognitionInFlightRef = useRef<Set<string>>(new Set());
  const autoStartedCameraIdRef = useRef<string | null>(null);
  const activeRecognitionContextRef = useRef<{ cameraId: string | null; schoolId: string | null }>({
    cameraId: null,
    schoolId: null,
  });

  const schoolsQuery = useQuery({
    queryKey: keys.schools,
    queryFn: listSchools,
  });

  const camerasQuery = useQuery({
    queryKey: keys.cameras,
    queryFn: listCameras,
  });

  const studentsQuery = useQuery({
    queryKey: keys.students,
    queryFn: listStudents,
  });

  const responsiblesQuery = useQuery({
    queryKey: keys.responsibles,
    queryFn: listResponsibles,
  });

  const biometricReferencesQuery = useQuery({
    queryKey: keys.biometricReferences,
    queryFn: listBiometricReferences,
    staleTime: 1000 * 60 * 5,
  });

  const eventsQuery = useQuery({
    queryKey: [...keys.cameraEvents, new Date().toISOString().slice(0, 10)] as const,
    queryFn: () => listCameraEvents(new Date().toISOString().slice(0, 10)),
  });

  useEffect(() => {
    if (!cameraId && camerasQuery.data?.[0]?.id) {
      setCameraId(camerasQuery.data[0].id);
    }
  }, [cameraId, camerasQuery.data]);

  useEffect(() => {
    if (!escolaExpand && schoolsQuery.data?.[0]?.id) {
      setEscolaExpand(schoolsQuery.data[0].id);
    }
  }, [escolaExpand, schoolsQuery.data]);

  const recognitionReferences = useMemo(
    () => buildRecognitionReferences(biometricReferencesQuery.data ?? []),
    [biometricReferencesQuery.data],
  );

  const scopedRecognitionReferences = useMemo(() => {
    const activeSchoolId = (camerasQuery.data?.find((item) => item.id === cameraId) ?? camerasQuery.data?.[0])?.escolaId;

    return activeSchoolId
      ? recognitionReferences.filter((reference) => reference.schoolId === activeSchoolId)
      : recognitionReferences;
  }, [cameraId, camerasQuery.data, recognitionReferences]);

  useEffect(() => {
    recognitionReferencesRef.current = scopedRecognitionReferences;
  }, [scopedRecognitionReferences]);

  const referenceCount = scopedRecognitionReferences.length;
  const templateCount = useMemo(
    () => scopedRecognitionReferences.reduce((sum, reference) => sum + reference.descriptors.length, 0),
    [scopedRecognitionReferences],
  );

  const referenceMessage = useMemo(() => {
    if (biometricReferencesQuery.isLoading) {
      return "Carregando biometrias cadastradas...";
    }

    if (biometricReferencesQuery.isError) {
      return "Falha ao carregar as referências biométricas.";
    }

    if (!referenceCount) {
      return 'Nenhuma biometria cadastrada. Rostos sem cadastro ficarão como "Desconhecido".';
    }

    return `${referenceCount} identidade(s) pronta(s) para reconhecimento nativo (${templateCount} template(s)).`;
  }, [biometricReferencesQuery.isError, biometricReferencesQuery.isLoading, referenceCount, templateCount]);

  const camera = camerasQuery.data?.find((item) => item.id === cameraId) ?? camerasQuery.data?.[0];
  const runtime = cameraRuntimeLabel(camera?.operacional?.status);
  const escola = schoolsQuery.data?.find((item) => item.id === camera?.escolaId);

  useEffect(() => {
    activeRecognitionContextRef.current = {
      cameraId: camera?.id ?? null,
      schoolId: camera?.escolaId ?? escola?.id ?? null,
    };
  }, [camera?.escolaId, camera?.id, escola?.id]);

  const ausentes = useMemo(
    () => studentsQuery.data?.filter((student) => student.escolaId === escolaExpand && student.presencaHoje === "ausente") ?? [],
    [escolaExpand, studentsQuery.data],
  );

  const turmasEsc = useMemo(
    () => Array.from(new Set((studentsQuery.data ?? []).filter((student) => student.escolaId === escolaExpand).map((student) => student.turma))),
    [escolaExpand, studentsQuery.data],
  );

  const latestEvents = eventsQuery.data ?? [];

  const matchedFacesCount = faces.filter((face) => face.matchStatus === "MATCHED").length;
  const reviewFacesCount = faces.filter((face) => face.matchStatus === "REVIEW_REQUIRED").length;
  const unknownFacesCount = faces.filter((face) => face.matchStatus === "UNMATCHED").length;

  const stopAnimationLoop = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const resetLiveState = useCallback(() => {
    stopAnimationLoop();
    inFlightRef.current = false;
    lastAnalysisAtRef.current = 0;
    lastVideoTimeRef.current = -1;
    cameraActiveRef.current = false;
    autoStartedCameraIdRef.current = null;
    setAnalyzing(false);
    setCameraActive(false);
    setFaces([]);
    setLastModelName("face-api.js");
    clearOverlay(canvasRef.current);
  }, [stopAnimationLoop]);

  const stopCamera = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    resetLiveState();
  }, [resetLiveState]);

  const ensureRecognitionReferences = useCallback(async (schoolId?: string | null) => {
    if (recognitionReferencesRef.current.length > 0) {
      return recognitionReferencesRef.current;
    }

    try {
      const response = await biometricReferencesQuery.refetch();
      const built = buildRecognitionReferences(response.data ?? []);
      const activeSchoolId = schoolId ?? activeRecognitionContextRef.current.schoolId;
      const scoped = activeSchoolId ? built.filter((reference) => reference.schoolId === activeSchoolId) : built;
      recognitionReferencesRef.current = scoped;
      return scoped;
    } catch (fetchError) {
      console.error("Falha ao carregar referências biométricas:", fetchError);
      return recognitionReferencesRef.current;
    }
  }, [biometricReferencesQuery]);

  const persistMatchedRecognitions = useCallback(
    async (params: {
      video: HTMLVideoElement;
      detections: LiveFaceDetection[];
      snapshots: RecognitionSnapshot[];
    }) => {
      const { cameraId: activeCameraId, schoolId: activeSchoolId } = activeRecognitionContextRef.current;

      if (!activeCameraId || !activeSchoolId) {
        return;
      }

      const matchedPairs = params.snapshots
        .map((snapshot, index) => ({
          snapshot,
          detection: params.detections[index],
        }))
        .filter(
          (entry): entry is { snapshot: RecognitionSnapshot; detection: LiveFaceDetection } =>
            Boolean(entry.detection) && entry.snapshot.matchStatus === "MATCHED" && Boolean(entry.snapshot.identityKey),
        );

      if (!matchedPairs.length) {
        return;
      }

      const results = await Promise.allSettled(
        matchedPairs.map(async ({ snapshot, detection }) => {
          const identityKey = snapshot.identityKey!;
          const now = Date.now();
          const lastSubmittedAt = recognitionCooldownRef.current.get(identityKey) ?? 0;

          if (
            recognitionInFlightRef.current.has(identityKey) ||
            now - lastSubmittedAt < RECOGNITION_SUBMIT_COOLDOWN_MS
          ) {
            return false;
          }

          const imagemBase64 = captureRecognitionCrop(
            params.video,
            detection.detection.box,
            submissionCanvasRef.current,
          );

          if (!imagemBase64) {
            return false;
          }

          recognitionInFlightRef.current.add(identityKey);

          try {
            const response = await registerCameraRecognition({
              cameraId: activeCameraId,
              schoolId: activeSchoolId,
              imagemBase64,
              expectedStudentId: snapshot.studentId ?? undefined,
              direcao: "ENTRY",
              reconhecidoEm: new Date().toISOString(),
              metadata: {
                source: "cameras-live-page",
                localIdentityKey: snapshot.identityKey,
                localStudentId: snapshot.studentId,
                localIdentityName: snapshot.identityName,
                localConfidence: snapshot.confidence,
              },
            });

            recognitionCooldownRef.current.set(identityKey, Date.now());
            return response;
          } catch (submitError) {
            console.error("Falha ao persistir reconhecimento da câmera.", submitError);
            return false;
          } finally {
            recognitionInFlightRef.current.delete(identityKey);
          }
        }),
      );

      const persistedRecognition = results.some(
        (result) =>
          result.status === "fulfilled" &&
          Boolean(result.value) &&
          (result.value as Record<string, unknown>).duplicate !== true,
      );

      if (persistedRecognition) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: keys.students }),
          queryClient.invalidateQueries({ queryKey: keys.cameraEvents }),
        ]);
      }
    },
    [keys.cameraEvents, keys.students, queryClient],
  );

  const runFrameAnalysis = useCallback(async () => {
    if (inFlightRef.current) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const faceapi = faceApiRef.current;

    if (!video || !canvas || !faceapi || video.readyState < 2) {
      return;
    }

    inFlightRef.current = true;
    setAnalyzing(true);

    try {
      const detections = await faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions(FACE_API_ANALYSIS_OPTIONS))
        .withFaceLandmarks()
        .withFaceDescriptors();

      const orderedDetections = [...detections]
        .sort((left, right) => left.detection.box.x - right.detection.box.x)
        .slice(0, MAX_FACES) as LiveFaceDetection[];

      if (!orderedDetections.length) {
        setFaces([]);
        setLastModelName("face-api.js");
        setStatusMessage("Nenhum rosto detectado. Posicione pessoas no enquadramento para iniciar a leitura.");
        clearOverlay(canvas);
        return;
      }

      const references = recognitionReferencesRef.current;
      const hasFaceApiReferences = references.some((reference) =>
        reference.descriptors.some((vector) => vector.length === FACE_API_DESCRIPTOR_SIZE),
      );
      const hasLegacyReferences = references.some((reference) =>
        reference.descriptors.some((vector) => vector.length !== FACE_API_DESCRIPTOR_SIZE),
      );
      const snapshots = dedupeFrameMatches(
        orderedDetections.map((detection, index) => {
          const normalizedDescriptor = normalizeDescriptor(detection.descriptor);
          const faceApiRecognition = createRecognitionDecision("face-api", normalizedDescriptor, references);
          const legacyDescriptor = hasLegacyReferences
            ? buildLegacyDescriptorFromVideo(video, detection.detection.box, legacyCanvasRef.current)
            : new Float32Array();
          const legacyRecognition = hasLegacyReferences
            ? createRecognitionDecision("legacy", legacyDescriptor, references)
            : null;
          const recognition = pickBetterRecognition(legacyRecognition, faceApiRecognition) ?? faceApiRecognition;
          const confidence = Number.isFinite(recognition.distance) ? clamp(1 - recognition.distance, 0, 1) : 0;

          if (recognition.matchStatus === "MATCHED" && recognition.identityName) {
            return {
              faceIndex: index + 1,
              label: recognition.identityName,
              identityName: recognition.identityName,
              identityKey: recognition.identityKey,
              studentId: recognition.studentId,
              confidence,
              matchStatus: recognition.matchStatus,
              reviewReason: null,
              distance: recognition.distance,
            } satisfies RecognitionSnapshot;
          }

          if (recognition.matchStatus === "REVIEW_REQUIRED") {
            return {
              faceIndex: index + 1,
              label: recognition.identityName ? `Revisão: ${recognition.identityName}` : `Desconhecido ${index + 1}`,
              identityName: recognition.identityName,
              identityKey: recognition.identityKey,
              studentId: recognition.studentId,
              confidence,
              matchStatus: recognition.matchStatus,
              reviewReason: recognition.reviewReason,
              distance: recognition.distance,
            } satisfies RecognitionSnapshot;
          }

          return {
            faceIndex: index + 1,
            label: `Desconhecido ${index + 1}`,
            identityName: null,
            identityKey: null,
            studentId: null,
            confidence,
            matchStatus: recognition.matchStatus,
            reviewReason: null,
            distance: recognition.distance,
          } satisfies RecognitionSnapshot;
        }),
      );

      setFaces(snapshots);
      setLastModelName(hasFaceApiReferences ? "face-api.js" : hasLegacyReferences ? "legacy-grayscale" : "face-api.js");

      const matched = snapshots.filter((snapshot) => snapshot.matchStatus === "MATCHED").length;
      const review = snapshots.filter((snapshot) => snapshot.matchStatus === "REVIEW_REQUIRED").length;
      const unknown = snapshots.filter((snapshot) => snapshot.matchStatus === "UNMATCHED").length;

      if (references.length) {
        setStatusMessage(
          `${snapshots.length} rosto(s) detectados. ${matched} reconhecido(s), ${review} em revisão e ${unknown} sem correspondência.`,
        );
      } else {
        setStatusMessage(
          `${snapshots.length} rosto(s) detectados. Carregue biometrias para habilitar a identificação automática; os demais aparecerão como "Desconhecido".`,
        );
      }

      drawNativeOverlay(faceapi, video, canvas, orderedDetections, snapshots);
      void persistMatchedRecognitions({
        video,
        detections: orderedDetections,
        snapshots,
      });
    } catch (analysisError) {
      console.error("Erro ao analisar múltiplos rostos:", analysisError);
      setError("Não foi possível executar o teste de múltiplos rostos.");
      setStatusMessage("Falha ao analisar o vídeo ao vivo.");
      setFaces([]);
      clearOverlay(canvas);
    } finally {
      setAnalyzing(false);
      inFlightRef.current = false;
    }
  }, [persistMatchedRecognitions]);

  const startAnimationLoop = useCallback(() => {
    const tick = (timestamp: number) => {
      if (!cameraActiveRef.current) {
        return;
      }

      if (timestamp - lastAnalysisAtRef.current >= DETECTION_INTERVAL_MS) {
        lastAnalysisAtRef.current = timestamp;
        void runFrameAnalysis();
      }

      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    stopAnimationLoop();
    animationFrameRef.current = window.requestAnimationFrame(tick);
  }, [runFrameAnalysis, stopAnimationLoop]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este dispositivo não oferece suporte à câmera pelo navegador.");
      return;
    }

    if (
      typeof window !== "undefined" &&
      !window.isSecureContext &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      setError("A câmera só funciona em localhost ou em HTTPS.");
      return;
    }

    try {
      setCameraLoading(true);
      setError(null);
      stopCamera();
      setStatusMessage("Preparando a câmera do dispositivo...");

      const fallbackSchoolId = camera?.escolaId ?? escolaExpand ?? schoolsQuery.data?.[0]?.id ?? null;
      if (!fallbackSchoolId) {
        setError("Selecione ou cadastre uma escola antes de iniciar a câmera do dispositivo.");
        return;
      }

      const resolvedCamera =
        mode === "guard"
          ? camera ?? await ensureDeviceCameraSource(fallbackSchoolId)
          : camera?.escolaId === fallbackSchoolId
            ? camera
            : await ensureDeviceCameraSource(fallbackSchoolId);

      if (!resolvedCamera) {
        setError("Nenhuma câmera válida foi encontrada para iniciar o monitoramento.");
        return;
      }

      activeRecognitionContextRef.current = {
        cameraId: resolvedCamera.id,
        schoolId: resolvedCamera.escolaId,
      };
      recognitionReferencesRef.current = [];
      setCameraId(resolvedCamera.id);
      await queryClient.invalidateQueries({ queryKey: keys.cameras });

      const [faceApiEngine, stream, references] = await Promise.all([
        getFaceApiEngine(),
        navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "user" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            aspectRatio: { ideal: 16 / 9 },
          },
          audio: false,
        }),
        ensureRecognitionReferences(resolvedCamera.escolaId),
      ]);

      if (!faceApiEngine) {
        setError("O motor face-api.js não pôde ser carregado.");
        stopCamera();
        return;
      }

      faceApiRef.current = faceApiEngine.faceapi;
      recognitionReferencesRef.current = references;
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }

      cameraActiveRef.current = true;
      autoStartedCameraIdRef.current = resolvedCamera.id;
      setCameraActive(true);
      setStatusMessage(
        references.length
          ? `${references.length} identidade(s) biométrica(s) carregada(s) para identificação em tempo real.`
          : 'Câmera iniciada. Rostos sem cadastro aparecerão como "Desconhecido".',
      );
      startAnimationLoop();
      void runFrameAnalysis();
    } catch (startError) {
      console.error("Erro ao iniciar a câmera:", startError);
      setError("Não foi possível iniciar a câmera. Verifique a permissão do navegador.");
      stopCamera();
    } finally {
      setCameraLoading(false);
    }
  }, [camera, escolaExpand, ensureRecognitionReferences, keys.cameras, mode, queryClient, runFrameAnalysis, schoolsQuery.data, startAnimationLoop, stopCamera]);

  useEffect(() => {
    if (mode !== "guard" || !camera?.id || cameraLoading || cameraActive) {
      return;
    }

    if (autoStartedCameraIdRef.current === camera.id) {
      return;
    }

    setError(null);
    void startCamera();
  }, [camera?.id, cameraActive, cameraLoading, mode, startCamera]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  useEffect(() => {
    if (!cameraActive) {
      clearOverlay(canvasRef.current);
    }
  }, [cameraActive]);

  return (
    <>
      <PageHeader
        title={mode === "guard" ? "Vigia Operacional" : "Câmeras & Portões"}
        subtitle={
          mode === "guard"
            ? "Monitoramento contínuo com reconhecimento facial automático"
            : "Teste ao vivo com detecção e identificação multi-rosto via face-api.js"
        }
        breadcrumb={[{ label: "Início", href: "/" }, { label: mode === "guard" ? "Vigia" : "Câmeras" }]}
        actions={
          <Link to="/cameras/cadastro">
            <Button variant="outline">
              <Settings className="h-4 w-4 mr-1" />
              Cadastrar Câmera
            </Button>
          </Link>
        }
      />

      {ausentes.length > 0 && (
        <div className="glass-card border-destructive/50 bg-destructive/10 p-4 mb-4 flex items-center gap-3 animate-pulse-soft">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
          <div className="text-sm">
            <span className="font-display font-bold text-destructive tracking-wide">{ausentes.length} aluno(s) ainda não chegaram</span>
            <span className="text-muted-foreground ml-2">— Aula começa em breve</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <div className="xl:col-span-2 glass-card p-4">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Select value={camera?.id ?? ""} onValueChange={setCameraId}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Selecione uma câmera" />
                </SelectTrigger>
                <SelectContent>
                  {camerasQuery.data?.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground hidden md:inline">{escola?.nome || "Câmera sem escola vinculada"}</span>
            </div>
            <div className="flex items-center gap-3 text-xs font-display tracking-widest">
              <span className={runtime.className}>{runtime.label}</span>
              {camera?.operacional?.fpsMedido !== undefined && (
                <span className="text-secondary">{camera.operacional.fpsMedido} FPS REAL</span>
              )}
              <span className="text-secondary">{camera?.fps ?? 0} FPS</span>
              <span className="text-primary">{camera?.resolucao ?? "—"}</span>
              <span className="font-bold text-primary text-lg text-glow">{now.toLocaleTimeString("pt-BR")}</span>
            </div>
          </div>

          <div className="relative aspect-video bg-background border border-primary/30 rounded-lg overflow-hidden tech-grid scanline">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className={cn(
                "absolute inset-0 z-10 h-full w-full object-cover scale-x-[-1] transition-opacity duration-300",
                cameraActive ? "opacity-100" : "opacity-0",
              )}
            />
            <canvas
              ref={canvasRef}
              className={cn(
                "absolute inset-0 z-20 h-full w-full pointer-events-none scale-x-[-1] transition-opacity duration-300",
                cameraActive ? "opacity-100" : "opacity-0",
              )}
            />
            <canvas ref={legacyCanvasRef} className="hidden" aria-hidden="true" />
            <canvas ref={submissionCanvasRef} className="hidden" aria-hidden="true" />

            {cameraActive ? (
              <>
                <div className="absolute inset-0 z-30 bg-gradient-to-b from-black/10 via-transparent to-black/35" />
                <div className="absolute top-3 left-3 z-40 flex items-center gap-1.5 bg-secondary/20 border border-secondary/50 px-2 py-1 rounded text-xs font-display tracking-wider">
                  <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse-soft" />
                  AO VIVO
                </div>
                <div className="absolute top-3 right-3 z-40 flex items-center gap-2 rounded border border-primary/30 bg-background/60 px-2 py-1 text-xs font-mono text-primary backdrop-blur-sm">
                  <ScanFace className="h-3.5 w-3.5" />
                  {lastModelName}
                  {analyzing && <Loader2 className="h-3.5 w-3.5 animate-spin text-secondary" />}
                </div>
                <div className="absolute bottom-3 left-3 right-3 z-40 rounded-lg border px-3 py-2 text-xs backdrop-blur-sm border-sky-200 bg-sky-50 text-sky-700">
                  {statusMessage}
                </div>
              </>
            ) : (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 px-4 text-center">
                {mode === "guard" ? (
                  <>
                    <Loader2 className="h-12 w-12 text-primary/60 animate-spin" />
                    <span className="font-display tracking-widest text-primary/80 text-sm">
                      {cameraLoading ? "INICIANDO VIGIA" : "AGUARDANDO CÂMERA"}
                    </span>
                    <p className="max-w-sm text-xs text-muted-foreground">
                      {cameraLoading
                        ? "Carregando modelos de reconhecimento facial..."
                        : "Selecione uma câmera cadastrada no seletor acima."}
                    </p>
                  </>
                ) : (
                  <>
                    <CameraIcon className="h-12 w-12 text-primary/60" />
                    <span className="font-display tracking-widest text-primary/80 text-sm">
                      {cameraLoading ? "ABRINDO CÂMERA" : "SESSÃO AO VIVO"}
                    </span>
                    <p className="max-w-sm text-xs text-muted-foreground">
                      {cameraLoading
                        ? "Preparando o reconhecimento facial..."
                        : "Abra a câmera do dispositivo para detectar, rotular e acompanhar vários rostos simultaneamente."}
                    </p>
                    <Button
                      onClick={startCamera}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                      type="button"
                      disabled={cameraLoading}
                    >
                      <CameraIcon className="h-4 w-4 mr-1" />
                      {cameraLoading ? "Abrindo câmera..." : "Iniciar teste ao vivo"}
                    </Button>
                  </>
                )}
              </div>
            )}

            <button
              type="button"
              className="absolute bottom-3 right-3 z-50 p-2 bg-background/60 backdrop-blur border border-primary/30 rounded hover:bg-primary/20"
              title="Expandir visualização"
            >
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

          <div className="mt-3 rounded-lg border border-dashed border-border bg-background/50 px-4 py-3 text-xs text-muted-foreground">
            {referenceMessage}
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-3">
            {mode === "guard" ? (
              cameraActive ? (
                <Button type="button" variant="outline" onClick={stopCamera}>
                  <CameraOff className="mr-2 h-4 w-4" />
                  Parar vigia
                </Button>
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
                    Iniciar teste ao vivo
                  </Button>
                ) : (
                  <Button type="button" variant="outline" onClick={stopCamera}>
                    <CameraOff className="mr-2 h-4 w-4" />
                    Parar câmera
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setError(null);
                    stopCamera();
                    setFaces([]);
                  }}
                >
                  <Loader2 className="mr-2 h-4 w-4" />
                  Reiniciar teste
                </Button>
              </>
            )}
          </div>

          {error && (
            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}
        </div>

        <div className="glass-card p-4 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold tracking-wide">ATIVIDADE EM TEMPO REAL</h3>
            <span className="h-2 w-2 rounded-full bg-secondary animate-pulse-soft" />
          </div>
          <ul className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
            {latestEvents.map((event) => {
              const student = studentsQuery.data?.find((item) => item.id === event.alunoId);
              const responsible = responsiblesQuery.data?.find((item) => item.id === student?.responsavelPrincipalId);
              if (!student || !responsible) {
                return null;
              }

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
                    <div className="text-[11px] text-muted-foreground">
                      {student.turma} • {event.horario}
                    </div>
                  </div>
                  <StatusBadge variant={event.tipo === "Entrou" ? "presente" : "saiu"}>{event.tipo}</StatusBadge>
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 rounded-md bg-secondary/15 border border-secondary/40 hover:bg-secondary/25 text-secondary"
                    title="Notificar via WhatsApp"
                  >
                    <MessageCircle className="h-4 w-4" />
                  </a>
                </li>
              );
            })}
            {eventsQuery.isLoading && <li className="text-sm text-muted-foreground">Carregando atividades...</li>}
          </ul>
        </div>
      </div>

      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div>
            <h3 className="font-display font-semibold tracking-wide">MONITOR DE TURMAS</h3>
            <p className="text-xs text-muted-foreground">Status de presença por turma</p>
          </div>
          <Select value={escolaExpand} onValueChange={setEscolaExpand}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Selecione uma escola" />
            </SelectTrigger>
            <SelectContent>
              {schoolsQuery.data?.map((school) => (
                <SelectItem key={school.id} value={school.id}>
                  {school.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {turmasEsc.map((turma) => {
            const list = (studentsQuery.data ?? []).filter((student) => student.escolaId === escolaExpand && student.turma === turma);
            const present = list.filter((student) => student.presencaHoje !== "ausente").length;
            const pct = list.length > 0 ? Math.round((present / list.length) * 100) : 0;

            return (
              <div key={turma} className="rounded-lg border border-primary/20 bg-background/40 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-display font-semibold tracking-wide">{turma}</span>
                  <StatusBadge variant={pct >= 80 ? "ok" : pct >= 60 ? "atencao" : "alerta"} />
                </div>
                <div className="flex items-end justify-between mb-2 text-sm">
                  <span className="text-muted-foreground">
                    {present}/{list.length} presentes
                  </span>
                  <span className="font-display font-bold text-primary text-lg">{pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden mb-3">
                  <div className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
                  {list.map((student) => {
                    const borderColor =
                      student.presencaHoje === "ausente"
                        ? "border-destructive"
                        : student.presencaHoje === "atrasado"
                          ? "border-warning"
                          : "border-secondary";
                    const responsible = responsiblesQuery.data?.find((item) => item.id === student.responsavelPrincipalId);
                    const link = responsible
                      ? formatWhatsAppLink(
                          responsible.whatsapp,
                          `Olá ${responsible.nome}, ${student.nome.split(" ")[0]} ainda não chegou na escola.`,
                        )
                      : undefined;

                    return (
                      <div key={student.id} className="relative group" title={`${student.nome} • ${student.presencaHoje}`}>
                        <img
                          src={student.foto}
                          className={cn("h-12 w-12 rounded-full border-2 bg-muted object-cover", borderColor, student.presencaHoje === "ausente" && "grayscale")}
                        />
                        {student.presencaHoje === "presente" && student.horarioEntrada && (
                          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-display tracking-wide bg-secondary text-secondary-foreground rounded px-1">
                            {student.horarioEntrada}
                          </span>
                        )}
                        {student.presencaHoje === "ausente" && link && (
                          <a
                            href={link}
                            target="_blank"
                            rel="noreferrer"
                            className="absolute -top-1 -right-1 bg-secondary text-secondary-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition"
                            title="Notificar via WhatsApp"
                          >
                            <MessageCircle className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default function Cameras() {
  return <CamerasView mode="test" />;
}

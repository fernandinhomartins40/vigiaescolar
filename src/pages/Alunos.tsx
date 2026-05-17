import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useTenantResourceKeyFactory } from "@/context/auth-context";
import {
  ALIGN_DURATION_MS,
  FACE_SIZE_MAX_RATIO,
  FACE_SIZE_MIN_RATIO,
  HOLD_DURATION_MS,
  buildCaptureMetadata,
  createFaceChallengeState,
  createSessionId,
  getFaceMetrics,
  isCentered,
  isStable,
  type FaceCaptureSessionMetadata,
  type FaceChallengeState,
  type FaceMetrics,
} from "@/lib/face-biometrics";
import { analyzeFaceApiFrame, getFaceApiEngine } from "@/lib/face-api-engine";
import type { Aluno, StudentPresence, Turma } from "@/lib/domain";
import { createStudent, deleteStudent, listResponsibles, listSchools, listStudents, listTurmas, updateStudent } from "@/lib/resources";

type StudentForm = {
  id?: string;
  nome: string;
  dataNascimento: string;
  matricula: string;
  escolaId: string;
  turmaId: string;
  turno: Aluno["turno"];
  ativo: boolean;
  responsibleIds: string[];
  principalId: string | null;
  photoFile: File | null;
  photoPreview: string | null;
  biometricFiles: File[];
  biometricPreviews: string[];
  biometricMetadata: FaceCaptureSessionMetadata | null;
  biometricStatus: string;
};

type BiometricCameraState = "idle" | "loading" | "active" | "error";

type BiometricFeedbackTone = "neutral" | "warning" | "success";

const emptyForm: StudentForm = {
  nome: "",
  dataNascimento: "",
  matricula: "",
  escolaId: "",
  turmaId: "",
  turno: "Manhã",
  ativo: true,
  responsibleIds: [],
  principalId: null,
  photoFile: null,
  photoPreview: null,
  biometricFiles: [],
  biometricPreviews: [],
  biometricMetadata: null,
  biometricStatus: "Inicie uma sessão ao vivo",
};

export default function Alunos() {
  const queryClient = useQueryClient();
  const keys = useTenantResourceKeyFactory();
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const biometricVideoRef = useRef<HTMLVideoElement | null>(null);
  const biometricCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const biometricCameraStreamRef = useRef<MediaStream | null>(null);
  const biometricAnalysisFrameRef = useRef<number | null>(null);
  const biometricLastVideoTimeRef = useRef(-1);
  const biometricLastAnalysisAtRef = useRef(0);
  const biometricHoldSinceRef = useRef<number | null>(null);
  const biometricPreviousMetricsRef = useRef<FaceMetrics | null>(null);
  const biometricSessionIdRef = useRef(createSessionId());
  const biometricCaptureDoneRef = useRef(false);
  const biometricChallengeStateRef = useRef<FaceChallengeState>(createFaceChallengeState());
  const biometricPreviewUrlsRef = useRef<string[]>([]);
  const biometricFeedbackRef = useRef("");
  const biometricFeedbackToneRef = useRef<BiometricFeedbackTone>("neutral");
  const [escolaFilter, setEscolaFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<StudentForm>(emptyForm);
  const [biometricCameraState, setBiometricCameraState] = useState<BiometricCameraState>("idle");
  const [biometricLiveFeedback, setBiometricLiveFeedback] = useState("Abra a câmera e mantenha apenas uma pessoa no enquadramento.");
  const [biometricFeedbackTone, setBiometricFeedbackTone] = useState<BiometricFeedbackTone>("neutral");
  const [biometricLiveMetrics, setBiometricLiveMetrics] = useState<FaceMetrics | null>(null);

  const studentsQuery = useQuery({
    queryKey: keys.students,
    queryFn: listStudents,
  });

  const schoolsQuery = useQuery({
    queryKey: keys.schools,
    queryFn: listSchools,
  });

  const responsiblesQuery = useQuery({
    queryKey: keys.responsibles,
    queryFn: listResponsibles,
  });

  const turmasQuery = useQuery({
    queryKey: keys.turmas,
    queryFn: listTurmas,
  });

  const createMutation = useMutation({
    mutationFn: createStudent,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.students });
      await queryClient.invalidateQueries({ queryKey: keys.turmas });
      toast.success("Aluno cadastrado com sucesso");
      closeDialog();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao cadastrar aluno"),
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: StudentForm) => {
      if (!payload.id) {
        throw new Error("Aluno inválido para atualização");
      }
      return updateStudent(payload.id, buildStudentPayload(payload));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.students });
      await queryClient.invalidateQueries({ queryKey: keys.turmas });
      toast.success("Aluno atualizado com sucesso");
      closeDialog();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao atualizar aluno"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteStudent,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.students });
      await queryClient.invalidateQueries({ queryKey: keys.turmas });
      toast.success("Aluno removido");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Falha ao remover aluno"),
  });

  const filtered = useMemo(() => {
    const students = studentsQuery.data ?? [];
    return students.filter(
      (student) =>
        (escolaFilter === "all" || student.escolaId === escolaFilter) &&
        student.nome.toLowerCase().includes(search.toLowerCase()),
    );
  }, [escolaFilter, search, studentsQuery.data]);

  const schoolsById = useMemo(() => new Map((schoolsQuery.data ?? []).map((school) => [school.id, school])), [schoolsQuery.data]);
  const responsiblesById = useMemo(() => new Map((responsiblesQuery.data ?? []).map((responsible) => [responsible.id, responsible])), [
    responsiblesQuery.data,
  ]);
  const turmasById = useMemo(() => new Map((turmasQuery.data ?? []).map((turma) => [turma.id, turma])), [turmasQuery.data]);
  const turmasBySchoolAndShift = useMemo(() => {
    const map = new Map<string, Turma[]>();

    for (const turma of turmasQuery.data ?? []) {
      if (!turma.ativa) {
        continue;
      }

      const key = `${turma.escolaId}::${turma.turno}`;
      const classes = map.get(key) ?? [];
      if (!classes.some((item) => item.id === turma.id)) {
        classes.push(turma);
      }
      map.set(key, classes);
    }

    for (const classes of map.values()) {
      classes.sort((left, right) => left.nome.localeCompare(right.nome, "pt-BR", { numeric: true, sensitivity: "base" }));
    }

    return map;
  }, [turmasQuery.data]);
  const availableTurmas = useMemo(() => {
    const key = `${form.escolaId}::${form.turno}`;
    const classes = [...(turmasBySchoolAndShift.get(key) ?? [])];
    const currentTurma = form.turmaId ? turmasById.get(form.turmaId) : undefined;

    if (currentTurma && !classes.some((item) => item.id === currentTurma.id)) {
      classes.push(currentTurma);
    }

    return classes.sort((left, right) => left.nome.localeCompare(right.nome, "pt-BR", { numeric: true, sensitivity: "base" }));
  }, [form.escolaId, form.turno, form.turmaId, turmasById, turmasBySchoolAndShift]);

  const biometricStatusVariant = form.biometricFiles.length > 0 || form.biometricStatus === "Biometria cadastrada" ? "ok" : "atencao";
  const biometricFeedbackToneClass =
    biometricFeedbackTone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : biometricFeedbackTone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-sky-200 bg-sky-50 text-sky-700";

  const clearGeneratedPreviews = useCallback(() => {
    for (const url of biometricPreviewUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    biometricPreviewUrlsRef.current = [];
  }, []);

  const syncBiometricFeedback = useCallback((message: string, tone: BiometricFeedbackTone) => {
    if (biometricFeedbackRef.current !== message) {
      biometricFeedbackRef.current = message;
      setBiometricLiveFeedback(message);
    }

    if (biometricFeedbackToneRef.current !== tone) {
      biometricFeedbackToneRef.current = tone;
      setBiometricFeedbackTone(tone);
    }
  }, []);

  const clearBiometricCapture = useCallback(() => {
    setForm((current) => ({
      ...current,
      biometricFiles: [],
      biometricPreviews: [],
      biometricMetadata: null,
      biometricStatus: "Inicie uma sessão ao vivo",
    }));
    setBiometricLiveMetrics(null);
    biometricSessionIdRef.current = createSessionId();
    biometricCaptureDoneRef.current = false;
    biometricChallengeStateRef.current = createFaceChallengeState();
    biometricHoldSinceRef.current = null;
    biometricPreviousMetricsRef.current = null;
    syncBiometricFeedback("Abra a câmera e mantenha apenas uma pessoa no enquadramento.", "neutral");
  }, [syncBiometricFeedback]);

  const stopBiometricCamera = useCallback(() => {
    if (biometricAnalysisFrameRef.current !== null) {
      window.cancelAnimationFrame(biometricAnalysisFrameRef.current);
      biometricAnalysisFrameRef.current = null;
    }

    biometricLastVideoTimeRef.current = -1;
    biometricLastAnalysisAtRef.current = 0;
    biometricHoldSinceRef.current = null;
    biometricPreviousMetricsRef.current = null;
    biometricChallengeStateRef.current = createFaceChallengeState();

    const stream = biometricCameraStreamRef.current;
    biometricCameraStreamRef.current = null;

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    setBiometricCameraState("idle");

    const video = biometricVideoRef.current;
    if (video) {
      video.srcObject = null;
    }
  }, []);

  const finalizeBiometricCapture = useCallback(
    (input: {
      metrics: FaceMetrics;
      embedding: number[] | null;
      detectedFacesCount: number;
      modelProvider: string;
      modelVersion: string;
    }) => {
      if (biometricCaptureDoneRef.current) {
        return;
      }

      const video = biometricVideoRef.current;
      const canvas = biometricCanvasRef.current;
      const stream = biometricCameraStreamRef.current;

      if (!video || !canvas || !stream) {
        return;
      }

      const context = canvas.getContext("2d");
      if (!context) {
        toast.error("Não foi possível processar a biometria facial ao vivo.");
        return;
      }

      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;
      canvas.width = width;
      canvas.height = height;
      context.drawImage(video, 0, 0, width, height);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.94);
      const file = dataUrlToFile(dataUrl, `biometria-${Date.now()}.jpg`);
      const challengeState = biometricChallengeStateRef.current;
      if (!challengeState.completedSteps.includes("hold_still")) {
        challengeState.completedSteps = [...challengeState.completedSteps, "hold_still"];
      }
      const metadata = buildCaptureMetadata({
        sessionId: biometricSessionIdRef.current,
        metrics: input.metrics,
        embedding: input.embedding,
        detectedFacesCount: input.detectedFacesCount,
        modelProvider: input.modelProvider,
        modelVersion: input.modelVersion,
        challengeState,
      });

      biometricCaptureDoneRef.current = true;
      setForm((current) => ({
        ...current,
        biometricFiles: [file],
        biometricPreviews: [dataUrl],
        biometricMetadata: metadata,
        biometricStatus: "Biometria cadastrada",
      }));
      syncBiometricFeedback("Sessão concluída. O melhor quadro foi selecionado automaticamente.", "success");
      setBiometricLiveMetrics(input.metrics);
      stopBiometricCamera();
    },
    [stopBiometricCamera, syncBiometricFeedback],
  );

  const openBiometricCamera = useCallback(async () => {
    if (biometricCameraStreamRef.current) {
      setBiometricCameraState("active");
      return true;
    }

    if (
      typeof window !== "undefined" &&
      !window.isSecureContext &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      setBiometricCameraState("error");
      toast.error("A câmera só funciona em localhost ou em HTTPS");
      return false;
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setBiometricCameraState("error");
      toast.error("Seu navegador não suporta câmera ao vivo. Use um navegador compatível.");
      return false;
    }

    setBiometricCameraState("loading");

    try {
      stopBiometricCamera();
      clearBiometricCapture();
      syncBiometricFeedback("Preparando o reconhecimento facial...", "neutral");

      const [faceApiEngine, stream] = await Promise.all([
        getFaceApiEngine(),
        navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "user" },
            width: { ideal: 720 },
            height: { ideal: 1280 },
            aspectRatio: { ideal: 9 / 16 },
          },
          audio: false,
        }),
      ]);

      if (!faceApiEngine) {
        setBiometricCameraState("error");
        toast.error("O motor de reconhecimento facial não pôde ser carregado.");
        return false;
      }

      biometricCameraStreamRef.current = stream;
      biometricLastAnalysisAtRef.current = 0;
      biometricLastVideoTimeRef.current = -1;
      biometricSessionIdRef.current = createSessionId();
      biometricChallengeStateRef.current = createFaceChallengeState();

      if (biometricVideoRef.current) {
        biometricVideoRef.current.srcObject = stream;
        await biometricVideoRef.current.play().catch(() => undefined);
      }

      setBiometricCameraState("active");
      setForm((current) => ({
        ...current,
        biometricStatus: "Sessão ao vivo em andamento",
      }));
      syncBiometricFeedback("Centralize o rosto na moldura e aguarde a captura automática.", "neutral");
      return true;
    } catch (error) {
      console.error("Erro ao iniciar a biometria facial ao vivo:", error);
      setBiometricCameraState("error");
      toast.error(error instanceof Error && error.message ? error.message : "Não foi possível abrir a câmera frontal");
      stopBiometricCamera();
      return false;
    }
  }, [clearBiometricCapture, stopBiometricCamera, syncBiometricFeedback]);

  const startBiometricSession = useCallback(async () => {
    if (biometricCameraState === "loading") {
      return false;
    }

    const started = await openBiometricCamera();
    if (!started) {
      return false;
    }

    toast.info("Sessão biométrica ao vivo iniciada");
    return true;
  }, [biometricCameraState, openBiometricCamera]);

  const handleBiometricPrimaryAction = useCallback(async () => {
    if (biometricCameraState === "active") {
      syncBiometricFeedback("Sessão interrompida. Você pode iniciar novamente quando quiser.", "warning");
      setForm((current) => ({
        ...current,
        biometricStatus: current.biometricFiles.length > 0 ? "Biometria cadastrada" : "Sessão interrompida",
      }));
      stopBiometricCamera();
      toast.info("Sessão biométrica encerrada");
      return;
    }

    await startBiometricSession();
  }, [biometricCameraState, startBiometricSession, stopBiometricCamera, syncBiometricFeedback]);

  const handleBiometricClear = useCallback(() => {
    stopBiometricCamera();
    clearBiometricCapture();
    toast.info("Biometria limpa");
  }, [clearBiometricCapture, stopBiometricCamera]);

  const evaluateBiometricSession = useCallback(
    (
      input: {
        metrics: FaceMetrics;
        embedding: number[] | null;
        detectedFacesCount: number;
        modelProvider: string;
        modelVersion: string;
      },
      timestamp: number,
    ) => {
      const challengeState = biometricChallengeStateRef.current;
      const metrics = input.metrics;
      const centered = isCentered(metrics);
      const stable = isStable(metrics, biometricPreviousMetricsRef.current);

      challengeState.faceDetections += 1;
      challengeState.maxFacesDetected = Math.max(challengeState.maxFacesDetected, input.detectedFacesCount);
      challengeState.minYawScore = Math.min(challengeState.minYawScore, metrics.yawScore);
      challengeState.maxYawScore = Math.max(challengeState.maxYawScore, metrics.yawScore);
      challengeState.minSizeRatio = Math.min(challengeState.minSizeRatio, metrics.sizeRatio);
      challengeState.maxSizeRatio = Math.max(challengeState.maxSizeRatio, metrics.sizeRatio);
      setBiometricLiveMetrics(metrics);

      if (input.detectedFacesCount > 1) {
        biometricHoldSinceRef.current = null;
        challengeState.stableMs = 0;
        biometricPreviousMetricsRef.current = metrics;
        syncBiometricFeedback("Há mais de um rosto no quadro. Deixe apenas uma pessoa na câmera.", "warning");
        return;
      }

      if (!centered) {
        biometricHoldSinceRef.current = null;
        challengeState.stableMs = 0;
        biometricPreviousMetricsRef.current = metrics;
        syncBiometricFeedback("Centralize o rosto na moldura.", "warning");
        return;
      }

      const faceTooFar = metrics.sizeRatio < FACE_SIZE_MIN_RATIO;
      const faceTooClose = metrics.sizeRatio > FACE_SIZE_MAX_RATIO;
      const lookingAway = Math.abs(metrics.yawScore) > 0.18;

      if (faceTooFar || faceTooClose) {
        biometricHoldSinceRef.current = null;
        challengeState.stableMs = 0;
        biometricPreviousMetricsRef.current = metrics;
        syncBiometricFeedback(
          faceTooFar
            ? "Aproxime um pouco mais o rosto da câmera."
            : "Afaste só um pouco o rosto para caber melhor na moldura.",
          "warning",
        );
        return;
      }

      if (lookingAway) {
        biometricHoldSinceRef.current = null;
        challengeState.stableMs = 0;
        biometricPreviousMetricsRef.current = metrics;
        syncBiometricFeedback("Olhe de frente para a câmera.", "warning");
        return;
      }

      if (!challengeState.completedSteps.includes("align")) {
        if (biometricHoldSinceRef.current === null) {
          biometricHoldSinceRef.current = timestamp;
        }

        const elapsed = timestamp - biometricHoldSinceRef.current;
        syncBiometricFeedback(
          elapsed >= ALIGN_DURATION_MS
            ? "Enquadramento confirmado. Capturando automaticamente..."
            : "Mantenha o rosto estável por um instante.",
          "neutral",
        );

        if (elapsed >= ALIGN_DURATION_MS) {
          challengeState.completedSteps = [...challengeState.completedSteps, "align"];
        }

        biometricPreviousMetricsRef.current = metrics;
        return;
      }

      if (!stable) {
        biometricHoldSinceRef.current = null;
        challengeState.stableMs = 0;
        biometricPreviousMetricsRef.current = metrics;
        syncBiometricFeedback("Mantenha o rosto estável por um instante.", "warning");
        return;
      }

      if (biometricHoldSinceRef.current === null) {
        biometricHoldSinceRef.current = timestamp;
      }

      challengeState.stableMs = timestamp - biometricHoldSinceRef.current;
      syncBiometricFeedback("Capturando automaticamente o melhor quadro...", "success");

      if (challengeState.stableMs >= HOLD_DURATION_MS) {
        finalizeBiometricCapture(input);
        return;
      }

      biometricPreviousMetricsRef.current = metrics;
    },
    [finalizeBiometricCapture, syncBiometricFeedback],
  );

  useEffect(() => {
    if (open && step === 3) {
      return;
    }

    stopBiometricCamera();
  }, [open, step, stopBiometricCamera]);

  useEffect(() => {
    return () => {
      stopBiometricCamera();
      clearGeneratedPreviews();
    };
  }, [clearGeneratedPreviews, stopBiometricCamera]);

  useEffect(() => {
    if (biometricCameraState !== "active") {
      if (biometricAnalysisFrameRef.current !== null) {
        window.cancelAnimationFrame(biometricAnalysisFrameRef.current);
        biometricAnalysisFrameRef.current = null;
      }
      return;
    }

    const analyze = async () => {
      if (biometricCameraState !== "active" || biometricCaptureDoneRef.current) {
        return;
      }

      const video = biometricVideoRef.current;
      const now = performance.now();

      if (now - biometricLastAnalysisAtRef.current < 180) {
        biometricAnalysisFrameRef.current = window.requestAnimationFrame(() => {
          void analyze();
        });
        return;
      }

      biometricLastAnalysisAtRef.current = now;

      if (video && video.readyState >= 2 && video.currentTime !== biometricLastVideoTimeRef.current) {
        biometricLastVideoTimeRef.current = video.currentTime;

        try {
          const analysis = await analyzeFaceApiFrame(video);

          if (!analysis?.selectedFace) {
            biometricHoldSinceRef.current = null;
            biometricPreviousMetricsRef.current = null;
            biometricChallengeStateRef.current.stableMs = 0;
            biometricChallengeStateRef.current.maxFacesDetected = Math.max(
              biometricChallengeStateRef.current.maxFacesDetected,
              analysis?.detectedFacesCount || 0,
            );
            setBiometricLiveMetrics(null);
            syncBiometricFeedback("Ajuste o rosto para continuar a captura.", "warning");
          } else {
            const metrics = getFaceMetrics(analysis.selectedFace.landmarks);
            if (metrics) {
              evaluateBiometricSession(
                {
                  metrics,
                  embedding: analysis.selectedFace.descriptor,
                  detectedFacesCount: analysis.detectedFacesCount,
                  modelProvider: analysis.provider,
                  modelVersion: analysis.modelVersion,
                },
                performance.now(),
              );
            }
          }
        } catch (error) {
          console.error("Falha durante a análise facial ao vivo.", error);
          setBiometricCameraState("error");
          toast.error("Falha ao processar a biometria facial ao vivo.");
          stopBiometricCamera();
          return;
        }
      }

      biometricAnalysisFrameRef.current = window.requestAnimationFrame(() => {
        void analyze();
      });
    };

    biometricAnalysisFrameRef.current = window.requestAnimationFrame(() => {
      void analyze();
    });

    return () => {
      if (biometricAnalysisFrameRef.current !== null) {
        window.cancelAnimationFrame(biometricAnalysisFrameRef.current);
        biometricAnalysisFrameRef.current = null;
      }
    };
  }, [biometricCameraState, evaluateBiometricSession, stopBiometricCamera, syncBiometricFeedback]);

  function closeDialog() {
    stopBiometricCamera();
    clearGeneratedPreviews();
    clearBiometricCapture();
    setOpen(false);
    setStep(1);
    setForm(emptyForm);
  }

  function openCreate() {
    clearBiometricCapture();
    setForm(emptyForm);
    setStep(1);
    setOpen(true);
  }

  function openEdit(student: Aluno) {
    clearBiometricCapture();
    setForm({
      id: student.id,
      nome: student.nome,
      dataNascimento: student.dataNascimento,
      matricula: student.matricula,
      escolaId: student.escolaId,
      turmaId: student.turmaId ?? "",
      turno: student.turno,
      ativo: student.ativo,
      responsibleIds: [...student.responsaveisIds],
      principalId: student.responsavelPrincipalId,
      photoFile: null,
      photoPreview: student.foto,
      biometricFiles: [],
      biometricPreviews: [],
      biometricMetadata: null,
      biometricStatus: student.biometriaAtiva ? "Biometria cadastrada" : "Biometria não cadastrada",
    });
    setStep(1);
    setOpen(true);
  }

  function capturePhoto() {
    photoInputRef.current?.click();
  }

  function handlePhotoChange(file?: File) {
    if (!file) return;
    const preview = URL.createObjectURL(file);
    biometricPreviewUrlsRef.current.push(preview);
    setForm((current) => ({
      ...current,
      photoFile: file,
      photoPreview: preview,
    }));
  }

  function validateStep(currentStep: number) {
    if (currentStep === 1) {
      if (!form.nome || !form.matricula || !form.escolaId || !form.turmaId || !form.dataNascimento) {
        toast.error("Preencha os dados básicos do aluno");
        return false;
      }
      if (availableTurmas.length === 0) {
        toast.error("Essa escola ainda não tem turmas cadastradas");
        return false;
      }
    }

    if (currentStep === 2) {
      if (form.responsibleIds.length === 0) {
        toast.error("Vincule ao menos um responsável");
        return false;
      }
      if (!form.principalId) {
        toast.error("Defina um responsável principal");
        return false;
      }
    }

    return true;
  }

  function handleFinalize() {
    if (!form.id && !validateStep(3)) {
      return;
    }

    if (!form.id && form.biometricFiles.length === 0) {
      toast.error("Capture a biometria ao vivo antes de finalizar");
      return;
    }

    stopBiometricCamera();

    if (form.id) {
      updateMutation.mutate(form);
      return;
    }

    createMutation.mutate(buildStudentPayload(form));
  }

  function buildStudentCardImage(student: Aluno) {
    return student.foto || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(student.nome)}`;
  }

  return (
    <>
      <PageHeader
        title="Alunos"
        subtitle="Cadastro com vinculação de responsáveis e biometria facial"
        breadcrumb={[{ label: "Início", href: "/" }, { label: "Alunos" }]}
        actions={
          <Button onClick={openCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4 mr-1" /> Novo Aluno
          </Button>
        }
      />

      <div className="glass-card p-4 mb-4 flex flex-col md:flex-row gap-3">
        <div className="flex items-center gap-2 flex-1">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar aluno..."
            className="border-0 bg-transparent focus-visible:ring-0"
          />
        </div>
        <Select value={escolaFilter} onValueChange={setEscolaFilter}>
          <SelectTrigger className="w-full md:w-64">
            <SelectValue placeholder="Todas as escolas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as escolas</SelectItem>
            {schoolsQuery.data?.map((school) => (
              <SelectItem key={school.id} value={school.id}>
                {school.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((student) => {
          const school = schoolsById.get(student.escolaId);
          return (
            <div key={student.id} className="glass-card p-4 hover:border-primary/40 transition group relative">
              <div className="absolute right-3 top-3 flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => openEdit(student)} title="Editar aluno">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (window.confirm(`Remover ${student.nome}?`)) {
                      deleteMutation.mutate(student.id);
                    }
                  }}
                  title="Remover aluno"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
              <div className="flex items-center gap-3 pr-16">
                <div className="relative">
                  <img src={buildStudentCardImage(student)} alt="" className="h-14 w-14 rounded-full border-2 border-primary/40 bg-muted object-cover" />
                  {student.biometriaAtiva && (
                    <span title="Biometria ativa" className="absolute -bottom-1 -right-1 bg-secondary text-secondary-foreground rounded-full p-0.5">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display font-semibold truncate">{student.nome}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {student.turma} • {school?.nome.split(" ")[0] || "Escola"}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[11px] font-mono text-muted-foreground">Mat. {student.matricula}</span>
                <StatusBadge variant={student.presencaHoje as StudentPresence} />
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="glass-card p-12 text-center text-muted-foreground mt-4">
          <GraduationCap className="h-10 w-10 mx-auto mb-2 opacity-40" />
          Nenhum aluno encontrado.
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) {
            closeDialog();
          } else {
            setOpen(true);
          }
        }}
      >
        <DialogContent className="max-w-3xl glass-card max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display tracking-wide text-xl">{form.id ? "Editar Aluno" : "Novo Aluno"}</DialogTitle>
            <div className="flex items-center gap-2 mt-3">
              {[1, 2, 3].map((currentStep) => (
                <div key={currentStep} className="flex items-center gap-2 flex-1">
                  <div
                    className={cn(
                      "h-8 w-8 rounded-full border-2 flex items-center justify-center font-display font-bold text-sm",
                      step >= currentStep ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground",
                    )}
                  >
                    {step > currentStep ? <Check className="h-4 w-4" /> : currentStep}
                  </div>
                  <span
                    className={cn(
                      "text-xs font-display tracking-wide hidden sm:block",
                      step >= currentStep ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {currentStep === 1 ? "DADOS" : currentStep === 2 ? "RESPONSÁVEIS" : "BIOMETRIA"}
                  </span>
                  {currentStep < 3 && <div className={cn("flex-1 h-px", step > currentStep ? "bg-primary" : "bg-border")} />}
                </div>
              ))}
            </div>
          </DialogHeader>

          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="user"
            className="hidden"
            onChange={(event) => {
              handlePhotoChange(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <canvas ref={biometricCanvasRef} className="hidden" aria-hidden="true" />

          {step === 1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2 flex items-center gap-4">
                <div className="h-20 w-20 rounded-full border-2 border-dashed border-primary/30 bg-muted flex items-center justify-center overflow-hidden">
                  {form.photoPreview ? (
                    <img src={form.photoPreview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Camera className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <Button variant="outline" type="button" onClick={capturePhoto}>
                  Upload Foto
                </Button>
              </div>
              <div className="md:col-span-2">
                <Label>Nome completo *</Label>
                <Input value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} />
              </div>
              <div>
                <Label>Data de nascimento *</Label>
                <Input type="date" value={form.dataNascimento} onChange={(event) => setForm({ ...form, dataNascimento: event.target.value })} />
              </div>
              <div>
                <Label>Matrícula *</Label>
                <Input value={form.matricula} onChange={(event) => setForm({ ...form, matricula: event.target.value })} placeholder="20250000" />
              </div>
              <div>
                <Label>Escola *</Label>
                <Select
                  value={form.escolaId}
                  onValueChange={(value) =>
                    setForm({
                      ...form,
                      escolaId: value,
                      turmaId: "",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
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
              <div>
                <Label>Turma *</Label>
                <Select
                  value={form.turmaId}
                  onValueChange={(value) => {
                    const selectedTurma = turmasById.get(value);
                    setForm({
                      ...form,
                      turmaId: value,
                      turno: selectedTurma?.turno ?? form.turno,
                    });
                  }}
                  disabled={!form.escolaId || availableTurmas.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        !form.escolaId
                          ? "Selecione a escola primeiro"
                          : availableTurmas.length === 0
                            ? "Nenhuma turma cadastrada"
                            : "Selecione a turma"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTurmas.map((turma) => (
                      <SelectItem key={turma.id} value={turma.id}>
                        {turma.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.escolaId && availableTurmas.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Cadastre turmas para essa escola e esse turno em{" "}
                    <Link to="/turmas" className="text-primary hover:underline">
                      Turmas
                    </Link>
                    .
                  </p>
                )}
              </div>
              <div>
                <Label>Turno</Label>
                <Select
                  value={form.turno}
                  onValueChange={(value) =>
                    setForm({
                      ...form,
                      turno: value as Aluno["turno"],
                      turmaId: "",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Manhã", "Tarde", "Integral"].map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.ativo ? "Ativo" : "Inativo"} onValueChange={(value) => setForm({ ...form, ativo: value === "Ativo" })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Ativo", "Transferido", "Inativo"].map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <Label>Buscar responsável já cadastrado</Label>
              <Input placeholder="Digite o nome..." className="mb-3" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
                {responsiblesQuery.data?.map((responsible) => {
                  const selected = form.responsibleIds.includes(responsible.id);
                  const isPrimary = form.principalId === responsible.id;

                  return (
                    <button
                      type="button"
                      key={responsible.id}
                      onClick={() => {
                        const responsibleIds = selected
                          ? form.responsibleIds.filter((id) => id !== responsible.id)
                          : [...form.responsibleIds, responsible.id];
                        setForm({
                          ...form,
                          responsibleIds,
                          principalId: isPrimary ? responsibleIds[0] ?? null : form.principalId,
                        });
                      }}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border transition text-left",
                        selected ? "border-primary bg-primary/10" : "border-border bg-background/40 hover:border-primary/40",
                      )}
                    >
                      <img src={responsible.foto} className="h-10 w-10 rounded-full bg-muted border border-primary/30 object-cover" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{responsible.nome}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {responsible.parentesco} • {responsible.whatsapp}
                        </div>
                      </div>
                      {selected && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setForm({ ...form, principalId: responsible.id });
                          }}
                          title="Definir como principal"
                        >
                          <Star className={cn("h-5 w-5", form.principalId === responsible.id ? "fill-warning text-warning" : "text-muted-foreground")} />
                        </button>
                      )}
                    </button>
                  );
                })}
              </div>
              {form.responsibleIds.length === 0 && <p className="text-xs text-muted-foreground mt-2">Selecione no mínimo 1 responsável.</p>}
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="relative aspect-video bg-black rounded-lg overflow-hidden border border-border mb-4">
                <video
                  ref={biometricVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className={cn(
                    "absolute inset-0 z-20 h-full w-full object-cover transition-opacity duration-300",
                    biometricCameraState === "active" ? "opacity-100" : "opacity-0",
                  )}
                />
                {biometricCameraState === "active" ? (
                  <>
                    <div className="absolute inset-0 z-20 bg-gradient-to-b from-black/10 via-transparent to-black/35" />
                    <div className="absolute inset-0 z-20 flex items-center justify-center">
                      <div
                        className={cn(
                          "w-40 h-52 border-2 border-dashed rounded-[50%] transition-colors",
                          biometricFeedbackTone === "success"
                            ? "border-emerald-300"
                            : biometricFeedbackTone === "warning"
                              ? "border-amber-300"
                              : "border-primary/70",
                        )}
                      />
                    </div>
                    <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 bg-secondary/20 border border-secondary/50 px-2 py-1 rounded text-xs font-display tracking-wider">
                      <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse-soft" /> AO VIVO
                    </div>
                    <div className={cn("absolute bottom-3 left-3 right-3 z-20 rounded-lg border px-3 py-2 text-xs backdrop-blur-sm", biometricFeedbackToneClass)}>
                      {biometricLiveFeedback}
                    </div>
                  </>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
                    <Camera className="h-12 w-12 text-primary/60" />
                    <span className="font-display tracking-widest text-primary/80 text-sm">
                      {biometricCameraState === "loading"
                        ? "ABRINDO CÂMERA"
                        : biometricCameraState === "error"
                          ? "FALHA NA CÂMERA"
                          : "SESSÃO AO VIVO"}
                    </span>
                    <p className="max-w-sm text-xs text-muted-foreground">
                      {biometricCameraState === "loading"
                        ? "Preparando o reconhecimento facial..."
                        : biometricLiveFeedback}
                    </p>
                  </div>
                )}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-52 border-2 border-dashed border-primary/70 rounded-[50%] pointer-events-none" />
                <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-destructive/20 border border-destructive/50 px-2 py-1 rounded text-xs font-display tracking-wider">
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse-soft" />
                  {biometricCameraState === "active"
                    ? "AO VIVO"
                    : biometricCameraState === "loading"
                      ? "CARREGANDO"
                      : biometricCameraState === "error"
                        ? "ERRO"
                        : "AGUARDANDO SESSÃO"}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {[
                  {
                    label: "Qualidade",
                    value: form.biometricMetadata
                      ? `${Math.round(form.biometricMetadata.qualityScore * 100)}%`
                      : biometricCameraState === "active"
                        ? "Analisando..."
                        : "—",
                  },
                  {
                    label: "Presença",
                    value: form.biometricMetadata
                      ? `${Math.round(form.biometricMetadata.livenessScore * 100)}%`
                      : biometricCameraState === "active"
                        ? "Ao vivo"
                        : "—",
                  },
                  {
                    label: "Rostos",
                    value: form.biometricMetadata
                      ? String(form.biometricMetadata.detectedFacesCount)
                      : biometricCameraState === "active"
                        ? String(Math.max(biometricLiveMetrics ? 1 : 0, biometricChallengeStateRef.current.maxFacesDetected))
                        : "—",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex flex-col gap-1 rounded-md border border-secondary/30 bg-secondary/10 p-2 text-xs text-secondary"
                  >
                    <span className="font-display text-[10px] uppercase tracking-wider">{item.label}</span>
                    <span className="font-medium text-foreground">{item.value}</span>
                  </div>
                ))}
              </div>
              {biometricCameraState === "error" && (
                <p className="text-xs text-destructive mb-3">
                  A câmera não pôde ser aberta. Verifique as permissões do navegador e confirme que está em localhost ou HTTPS.
                </p>
              )}
              <div className="rounded-lg border border-dashed border-border bg-background/50 px-4 py-3 text-xs text-muted-foreground mb-4">
                {form.biometricFiles.length > 0
                  ? "A biometria foi capturada a partir da sessão ao vivo e está pronta para salvar."
                  : biometricLiveFeedback}
              </div>
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <Button
                  onClick={handleBiometricPrimaryAction}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                  type="button"
                  disabled={biometricCameraState === "loading"}
                >
                  <Camera className="h-4 w-4 mr-1" />
                  {biometricCameraState === "active"
                    ? "Encerrar sessão ao vivo"
                    : biometricCameraState === "loading"
                      ? "Abrindo câmera..."
                      : biometricCameraState === "error"
                        ? "Tentar iniciar sessão"
                        : form.biometricFiles.length > 0
                          ? "Refazer sessão ao vivo"
                          : "Iniciar sessão ao vivo"}
                </Button>
                {form.biometricFiles.length > 0 && (
                  <Button variant="outline" type="button" onClick={handleBiometricClear}>
                    Limpar biometria
                  </Button>
                )}
                <span className="text-xs text-muted-foreground">
                  {form.biometricFiles.length > 0 ? "1 captura real da sessão" : biometricLiveFeedback}
                </span>
                <StatusBadge variant={biometricStatusVariant}>
                  {form.biometricStatus}
                </StatusBadge>
              </div>
              {form.biometricMetadata && (
                <div className="mb-4 rounded-xl border border-primary/10 bg-background/60 px-4 py-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Resumo da sessão</p>
                  <p className="mt-1">
                    Qualidade {Math.round(form.biometricMetadata.qualityScore * 100)}% • Presença{" "}
                    {Math.round(form.biometricMetadata.livenessScore * 100)}% • Rostos{" "}
                    {form.biometricMetadata.detectedFacesCount}
                  </p>
                </div>
              )}
              <Button
                disabled={!form.id && form.biometricFiles.length === 0}
                className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/90 disabled:opacity-50"
                type="button"
                onClick={handleFinalize}
              >
                {form.id ? "Salvar Alterações" : "Finalizar Cadastro"}
              </Button>
            </div>
          )}

          <DialogFooter className="gap-2">
            {step > 1 && (
              <Button variant="outline" onClick={() => setStep((current) => current - 1)}>
                <ChevronLeft className="h-4 w-4" />
                Voltar
              </Button>
            )}
            {step < 3 && (
              <Button
                onClick={() => {
                  if (!validateStep(step)) {
                    return;
                  }
                  setStep((current) => current + 1);
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                type="button"
              >
                Próximo
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
            {step === 3 && (
              <Button onClick={handleFinalize} className="bg-secondary text-secondary-foreground hover:bg-secondary/90 " type="button">
                {form.id ? "Salvar Alterações" : "Finalizar Cadastro"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function buildStudentPayload(form: StudentForm) {
  const payload = new FormData();

  payload.append("nome", form.nome);
  payload.append("dataNascimento", form.dataNascimento);
  payload.append("matricula", form.matricula);
  payload.append("escolaId", form.escolaId);
  payload.append("turmaId", form.turmaId);
  payload.append("turno", form.turno);
  payload.append("ativo", String(form.ativo));
  payload.append("responsaveisIds", JSON.stringify(form.responsibleIds));
  payload.append("responsavelPrincipalId", form.principalId || form.responsibleIds[0] || "");

  if (form.photoFile) {
    payload.append("foto", form.photoFile);
  }

  form.biometricFiles.forEach((file) => payload.append("biometriaFotos", file));
  if (form.biometricMetadata) {
    payload.append("biometriaMeta", JSON.stringify(form.biometricMetadata));
  }

  return payload;
}

function dataUrlToFile(dataUrl: string, filename: string) {
  const [header, base64Data] = dataUrl.split(",");
  const mimeMatch = header?.match(/data:(.*?);base64/);
  const mimeType = mimeMatch?.[1] || "image/jpeg";
  const binary = atob(base64Data || "");
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], filename, { type: mimeType });
}

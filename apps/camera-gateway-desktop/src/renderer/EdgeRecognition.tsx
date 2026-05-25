import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import * as faceapi from "face-api.js";
import * as tf from "@tensorflow/tfjs";
import type { DiscoveredCameraDTO, EdgeRecognitionEventDTO, EdgeReferenceDTO, EdgeSyncStateDTO } from "../shared/types";

type MatchStatus = "MATCHED" | "REVIEW_REQUIRED" | "UNMATCHED";

type LoadedReference = {
  identityId: string;
  studentId: string | null;
  schoolId: string;
  displayName: string;
  descriptors: Float32Array[];
};

type Match = {
  label: string;
  identityId: string | null;
  studentId: string | null;
  schoolId: string | null;
  confidence: number;
  distance: number | null;
  status: MatchStatus;
};

const MODEL_BASE_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js-models@master";
const FACE_API_DESCRIPTOR_SIZE = 128;
const MATCH_DISTANCE_THRESHOLD = 0.6;
const REVIEW_DISTANCE_THRESHOLD = 0.75;
const MIN_DISTANCE_GAP = 0.05;
const EVENT_COOLDOWN_MS = 180_000;

let modelPromise: Promise<boolean> | null = null;

function normalizeDescriptor(vector: ArrayLike<number> | null | undefined) {
  if (!vector || typeof vector.length !== "number" || vector.length === 0) return new Float32Array();
  const values = Array.from(vector, (v) => Number(v) || 0);
  const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  if (!Number.isFinite(magnitude) || magnitude <= 0) return new Float32Array(values);
  return new Float32Array(values.map((v) => v / magnitude));
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

async function loadModels() {
  if (!modelPromise) {
    modelPromise = (async () => {
      try {
        try {
          await tf.setBackend("webgl");
        } catch {
          await tf.setBackend("cpu");
        }
        await tf.ready();
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(`${MODEL_BASE_URL}/tiny_face_detector`),
          faceapi.nets.faceLandmark68Net.loadFromUri(`${MODEL_BASE_URL}/face_landmark_68`),
          faceapi.nets.faceRecognitionNet.loadFromUri(`${MODEL_BASE_URL}/face_recognition`),
        ]);
        return true;
      } catch (error) {
        console.warn("[edge-ui] falha ao carregar face-api.js", error);
        return false;
      }
    })();
  }
  return modelPromise;
}

function buildReferences(items: EdgeReferenceDTO[]): LoadedReference[] {
  return items.flatMap((item) => {
    const descriptors = (item.embeddings ?? [])
      .filter((embedding) => embedding.isActive !== false && Array.isArray(embedding.vector))
      .map((embedding) => normalizeDescriptor(embedding.vector))
      .filter((descriptor) => descriptor.length === FACE_API_DESCRIPTOR_SIZE);
    if (descriptors.length === 0) return [];
    return [{
      identityId: item.id,
      studentId: item.studentId ?? item.student?.id ?? null,
      schoolId: item.schoolId,
      displayName: item.student?.nome?.trim() || item.label,
      descriptors,
    }];
  });
}

function chooseMatch(descriptor: Float32Array, references: LoadedReference[]): Match {
  const ranked = references
    .map((reference) => ({
      reference,
      distance: reference.descriptors.reduce((best, template) => {
        const distance = euclideanDistance(descriptor, template);
        return distance < best ? distance : best;
      }, Number.POSITIVE_INFINITY),
    }))
    .filter((candidate) => Number.isFinite(candidate.distance))
    .sort((left, right) => left.distance - right.distance);

  const best = ranked[0];
  if (!best) {
    return { label: "Desconhecido", identityId: null, studentId: null, schoolId: null, confidence: 0, distance: null, status: "UNMATCHED" };
  }

  const secondDistance = ranked[1]?.distance ?? Number.POSITIVE_INFINITY;
  const gap = secondDistance - best.distance;
  const confidence = Math.max(0, Math.min(1, 1 - best.distance));
  const base = {
    label: best.reference.displayName,
    identityId: best.reference.identityId,
    studentId: best.reference.studentId,
    schoolId: best.reference.schoolId,
    confidence,
    distance: best.distance,
  };

  if (best.distance <= MATCH_DISTANCE_THRESHOLD && gap >= MIN_DISTANCE_GAP) {
    return { ...base, status: "MATCHED" };
  }
  if (best.distance <= REVIEW_DISTANCE_THRESHOLD) {
    return { ...base, status: "REVIEW_REQUIRED" };
  }
  return { label: "Desconhecido", identityId: null, studentId: null, schoolId: null, confidence, distance: best.distance, status: "UNMATCHED" };
}

function findEdgeCamera(edge: EdgeSyncStateDTO, camera: DiscoveredCameraDTO | null) {
  if (!camera) return null;
  return edge.cameras.find((item) => item.serialNumber === camera.serialNumber) ?? null;
}

function attachHls(video: HTMLVideoElement, url: string): Hls | null {
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;

  if (Hls.isSupported()) {
    const hls = new Hls({
      lowLatencyMode: true,
      backBufferLength: 10,
      // Reduz retentativas iniciais para que erros de stream apareçam mais rápido
      manifestLoadingMaxRetry: 3,
      levelLoadingMaxRetry: 3,
      fragLoadingMaxRetry: 3,
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => undefined);
    });
    return hls;
  }

  // Fallback nativo (Safari / Electron com suporte HLS built-in)
  video.src = url;
  video.play().catch(() => undefined);
  return null;
}

export function EdgeRecognition({ cameras, edge }: { cameras: DiscoveredCameraDTO[]; edge: EdgeSyncStateDTO }) {
  const [selectedSerial, setSelectedSerial] = useState("");
  const [message, setMessage] = useState("Aguardando câmera local.");
  const [matches, setMatches] = useState<Match[]>([]);
  const [recognizing, setRecognizing] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const timerRef = useRef<number | null>(null);
  const analyzingRef = useRef(false);
  const cooldownRef = useRef<Map<string, number>>(new Map());
  const currentUrlRef = useRef<string | null>(null);

  const selectedCamera = useMemo(() => {
    if (!cameras.length) return null;
    return cameras.find((camera) => camera.serialNumber === selectedSerial) ?? cameras[0];
  }, [cameras, selectedSerial]);

  const selectedEdgeCamera = useMemo(() => findEdgeCamera(edge, selectedCamera), [edge, selectedCamera]);
  const references = useMemo(() => buildReferences(edge.references), [edge.references]);
  const analysisIntervalMs = Math.max(250, Math.floor(1000 / Math.max(1, edge.settings.framesPerSecond || 2)));

  useEffect(() => {
    if (!selectedSerial && cameras[0]) setSelectedSerial(cameras[0].serialNumber);
  }, [cameras, selectedSerial]);

  useEffect(() => {
    loadModels().then((ok) => {
      setModelsReady(ok);
      if (!ok) setMessage("Falha ao carregar modelos locais.");
    });
  }, []);

  // Inicia/reinicia o stream de vídeo sempre que a URL da câmera muda
  useEffect(() => {
    const url = selectedCamera?.localLiveUrl ?? null;
    if (url === currentUrlRef.current) return;
    currentUrlRef.current = url;

    // Limpa stream anterior
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    setMatches([]);
    setStreamError(null);
    setRecognizing(false);

    if (!url || !video) {
      setMessage(selectedCamera ? "Relay de vídeo aguardando... Aguarde o go2rtc iniciar." : "Aguardando câmera local.");
      return;
    }

    setMessage("Conectando ao stream de vídeo...");

    const hls = attachHls(video, url);
    hlsRef.current = hls;

    if (hls) {
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          const msg = `Erro no stream: ${data.type} — ${data.details}`;
          console.warn("[edge-video]", msg);
          setStreamError(msg);
          setMessage("Falha no stream. Verifique se a câmera está acessível na rede.");
        }
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStreamError(null);
        setMessage("Vídeo ao vivo conectado.");
      });
    }

    video.addEventListener("playing", onPlaying, { once: true });
    function onPlaying() {
      setMessage(modelsReady ? "Vídeo ao vivo. Clique em Iniciar reconhecimento." : "Vídeo ao vivo. Carregando modelos...");
    }
  }, [selectedCamera?.localLiveUrl]);

  const stopRecognition = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
    setMatches([]);
    setRecognizing(false);
  }, []);

  const sendMatch = useCallback(async (match: Match) => {
    if (!selectedEdgeCamera || match.status !== "MATCHED" || !match.identityId || !match.studentId || !match.schoolId) return;
    const now = Date.now();
    const last = cooldownRef.current.get(match.identityId) ?? 0;
    if (now - last < EVENT_COOLDOWN_MS) return;
    cooldownRef.current.set(match.identityId, now);

    const payload: EdgeRecognitionEventDTO = {
      cameraId: selectedEdgeCamera.id,
      schoolId: selectedEdgeCamera.schoolId,
      identityId: match.identityId,
      studentId: match.studentId,
      matchStatus: match.status,
      confidence: match.confidence,
      recognizedAt: new Date().toISOString(),
      direction: "ENTRY",
      modelName: "face-api.js",
      modelVersion: "0.22.2",
      distance: match.distance,
      metadata: {
        source: "desktop-edge-local",
        cameraSerial: selectedEdgeCamera.serialNumber,
      },
    };
    const result = await window.gateway.submitEdgeRecognition(payload);
    setMessage(result.queued ? `${match.label} reconhecido; evento salvo para sincronizar.` : `${match.label} reconhecido e enviado.`);
  }, [selectedEdgeCamera]);

  const analyze = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !modelsReady || analyzingRef.current || video.readyState < 2) return;
    analyzingRef.current = true;
    try {
      const detections = await faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 }))
        .withFaceLandmarks()
        .withFaceDescriptors();
      const nextMatches = detections.slice(0, 8).map((detection) => chooseMatch(normalizeDescriptor(detection.descriptor), references));
      setMatches(nextMatches);
      setMessage(
        references.length === 0
          ? "Sem referências sincronizadas."
          : nextMatches.length
            ? `${nextMatches.length} rosto(s), ${nextMatches.filter((m) => m.status === "MATCHED").length} reconhecido(s).`
            : "Nenhum rosto detectado.",
      );
      for (const match of nextMatches) {
        void sendMatch(match);
      }
      const ctx = canvas.getContext("2d");
      if (ctx) {
        canvas.width = video.videoWidth || 1;
        canvas.height = video.videoHeight || 1;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        detections.slice(0, 8).forEach((detection, index) => {
          const match = nextMatches[index];
          const box = detection.detection.box;
          ctx.strokeStyle = match?.status === "MATCHED" ? "#10b981" : match?.status === "REVIEW_REQUIRED" ? "#f59e0b" : "#f43f5e";
          ctx.lineWidth = 3;
          ctx.strokeRect(box.x, box.y, box.width, box.height);
          ctx.fillStyle = "rgba(15,23,42,0.88)";
          ctx.fillRect(box.x, Math.max(0, box.y - 28), Math.max(120, box.width), 24);
          ctx.fillStyle = "#fff";
          ctx.font = "600 13px system-ui";
          ctx.fillText(match?.label ?? "Desconhecido", box.x + 8, Math.max(16, box.y - 10));
        });
      }
    } finally {
      analyzingRef.current = false;
    }
  }, [modelsReady, references, sendMatch]);

  const startRecognition = useCallback(async () => {
    if (!selectedCamera?.localLiveUrl) {
      setMessage("Stream local ainda não foi configurado.");
      return;
    }
    if (!modelsReady) {
      setMessage("Modelos locais ainda carregando.");
      return;
    }
    if (!selectedEdgeCamera) {
      setMessage("Câmera ainda não sincronizada com a API. Clique em 'Sincronizar faces'.");
      return;
    }

    stopRecognition();
    timerRef.current = window.setInterval(() => void analyze(), analysisIntervalMs);
    setRecognizing(true);
    setMessage("Reconhecimento local em execução.");
  }, [analysisIntervalMs, analyze, modelsReady, selectedCamera, selectedEdgeCamera, stopRecognition]);

  // Para reconhecimento ao destruir
  useEffect(() => () => {
    stopRecognition();
    hlsRef.current?.destroy();
  }, [stopRecognition]);

  if (cameras.length === 0) {
    return (
      <div className="card">
        <h2>Reconhecimento local</h2>
        <p>Nenhuma câmera local detectada ainda.</p>
      </div>
    );
  }

  const hasStream = !!selectedCamera?.localLiveUrl;

  return (
    <div className="card edge-card">
      <h2>Reconhecimento facial local</h2>
      <p>
        Vídeo e processamento rodam neste PC. A VPS recebe apenas eventos de entrada/saída.
        Referências sincronizadas: {references.length}.
      </p>
      <div className="row edge-toolbar">
        <select
          aria-label="Câmera"
          value={selectedCamera?.serialNumber ?? ""}
          onChange={(event) => setSelectedSerial(event.target.value)}
        >
          {cameras.map((camera) => (
            <option key={camera.serialNumber} value={camera.serialNumber}>
              {camera.deviceModel || "Câmera"} — {camera.ip}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-primary"
          disabled={recognizing || !modelsReady || !hasStream || !selectedEdgeCamera}
          onClick={startRecognition}
          title={
            !hasStream ? "Aguardando relay de vídeo" :
            !selectedEdgeCamera ? "Câmera não sincronizada com a API" :
            !modelsReady ? "Carregando modelos de IA" : ""
          }
        >
          Iniciar reconhecimento
        </button>
        <button type="button" className="btn-secondary" disabled={!recognizing} onClick={stopRecognition}>Parar</button>
      </div>
      <div className="edge-video-wrap">
        <video ref={videoRef} className="edge-video" muted playsInline />
        <canvas ref={canvasRef} className="edge-overlay" />
        {!hasStream && (
          <div className="edge-no-stream">
            <span>⏳ Aguardando relay de vídeo (go2rtc)…</span>
          </div>
        )}
        {hasStream && streamError && (
          <div className="edge-no-stream edge-stream-error">
            <span>⚠️ {streamError}</span>
          </div>
        )}
      </div>
      <p className="edge-message">{message}</p>
      {matches.length > 0 && (
        <div className="edge-matches">
          {matches.map((match, index) => (
            <span key={`${match.identityId ?? "unknown"}-${index}`} className={`status-badge ${match.status === "MATCHED" ? "online" : "offline"}`}>
              {match.label} {(match.confidence * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

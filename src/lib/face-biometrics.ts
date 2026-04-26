export type FacePoint = {
  x: number;
  y: number;
  z?: number;
};

export type FaceSessionStep = "align" | "hold_still" | "completed";

export interface FaceMetrics {
  centerOffsetX: number;
  centerOffsetY: number;
  sizeRatio: number;
  widthRatio: number;
  heightRatio: number;
  yawScore: number;
}

export interface FaceChallengeState {
  completedSteps: FaceSessionStep[];
  stableMs: number;
  faceDetections: number;
  maxFacesDetected: number;
  minYawScore: number;
  maxYawScore: number;
  minSizeRatio: number;
  maxSizeRatio: number;
}

export interface FaceCaptureSessionMetadata {
  captureMode: "LIVE_GUIDED_VIDEO";
  sessionId: string;
  completedAt: string;
  qualityScore: number;
  livenessScore: number;
  completedSteps: FaceSessionStep[];
  modelProvider: string;
  modelVersion: string;
  embedding: number[] | null;
  detectedFacesCount: number;
  analysisMode: "face-api.js";
  metrics: {
    centerOffsetX: number;
    centerOffsetY: number;
    sizeRatio: number;
    yawScore: number;
    stabilityScore: number;
  };
  hints: string[];
}

export const ALIGN_DURATION_MS = 300;
export const HOLD_DURATION_MS = 650;

const TARGET_CENTER_X = 0.5;
const TARGET_CENTER_Y = 0.47;
export const FACE_SIZE_MIN_RATIO = 0.16;
export const FACE_SIZE_TARGET_RATIO = 0.38;
export const FACE_SIZE_MAX_RATIO = 0.54;

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function roundScore(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function createSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `face-session-${Date.now()}`;
}

export function createFaceChallengeState(): FaceChallengeState {
  return {
    completedSteps: [],
    stableMs: 0,
    faceDetections: 0,
    maxFacesDetected: 0,
    minYawScore: 1,
    maxYawScore: -1,
    minSizeRatio: 1,
    maxSizeRatio: 0,
  };
}

export function averagePoint(points: FacePoint[]) {
  if (!points.length) {
    return null;
  }

  const total = points.reduce<{ x: number; y: number; z: number }>(
    (accumulator, point) => ({
      x: accumulator.x + point.x,
      y: accumulator.y + point.y,
      z: accumulator.z + (point.z ?? 0),
    }),
    { x: 0, y: 0, z: 0 },
  );

  return {
    x: total.x / points.length,
    y: total.y / points.length,
    z: total.z / points.length,
  };
}

export function getFaceMetrics(landmarks: FacePoint[]): FaceMetrics | null {
  if (!landmarks.length) {
    return null;
  }

  const leftEyeOuter = averagePoint(landmarks.slice(36, 42));
  const rightEyeOuter = averagePoint(landmarks.slice(42, 48));
  const noseTip = landmarks[30] || averagePoint(landmarks.slice(27, 36));

  if (!leftEyeOuter || !rightEyeOuter || !noseTip) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of landmarks) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  const widthRatio = Math.max(maxX - minX, 0);
  const heightRatio = Math.max(maxY - minY, 0);
  const centerX = minX + widthRatio / 2;
  const centerY = minY + heightRatio / 2;
  const sizeRatio = Math.max(widthRatio, heightRatio);
  const eyeMidX = (leftEyeOuter.x + rightEyeOuter.x) / 2;
  const yawScore = clamp((noseTip.x - eyeMidX) / Math.max(widthRatio, 0.001), -1, 1);

  return {
    centerOffsetX: centerX - TARGET_CENTER_X,
    centerOffsetY: centerY - TARGET_CENTER_Y,
    sizeRatio,
    widthRatio,
    heightRatio,
    yawScore,
  };
}

export function isCentered(metrics: FaceMetrics) {
  return Math.abs(metrics.centerOffsetX) <= 0.09 && Math.abs(metrics.centerOffsetY) <= 0.11;
}

export function isStable(metrics: FaceMetrics, previousMetrics: FaceMetrics | null) {
  if (!previousMetrics) {
    return false;
  }

  const variation =
    Math.abs(metrics.centerOffsetX - previousMetrics.centerOffsetX) +
    Math.abs(metrics.centerOffsetY - previousMetrics.centerOffsetY) +
    Math.abs(metrics.sizeRatio - previousMetrics.sizeRatio);

  return variation <= 0.03;
}

export function buildQualityScore(metrics: FaceMetrics, stabilityScore: number) {
  const centerDistance = Math.sqrt(
    metrics.centerOffsetX * metrics.centerOffsetX + metrics.centerOffsetY * metrics.centerOffsetY,
  );
  const centeredScore = 1 - clamp(centerDistance / 0.18, 0, 1);
  const sizeScore = 1 - clamp(Math.abs(metrics.sizeRatio - FACE_SIZE_TARGET_RATIO) / 0.24, 0, 1);

  return roundScore(centeredScore * 0.45 + sizeScore * 0.35 + stabilityScore * 0.2);
}

export function buildLivenessScore(challengeState: FaceChallengeState, stabilityScore: number) {
  const seenFramesScore = clamp(challengeState.faceDetections / 26, 0, 1) * 0.35;
  const yawVariation = Math.abs(challengeState.maxYawScore - challengeState.minYawScore);
  const sizeVariation = Math.abs(challengeState.maxSizeRatio - challengeState.minSizeRatio);
  const subtleMotionScore = clamp(yawVariation * 2.4 + sizeVariation * 1.8, 0, 1) * 0.25;
  const stabilityContribution = stabilityScore * 0.25;
  const sustainedSessionScore = clamp(challengeState.stableMs / HOLD_DURATION_MS, 0, 1) * 0.15;

  return roundScore(
    clamp(seenFramesScore + subtleMotionScore + stabilityContribution + sustainedSessionScore, 0, 1),
  );
}

export function getStepLabel(step: FaceSessionStep) {
  if (step === "align") return "Centralizar";
  if (step === "hold_still") return "Validar";
  return "Pronto";
}

export function isStepCompleted(currentStep: FaceSessionStep, targetStep: FaceSessionStep) {
  const order: FaceSessionStep[] = ["align", "hold_still", "completed"];
  return order.indexOf(currentStep) > order.indexOf(targetStep);
}

export function buildCaptureMetadata(input: {
  sessionId: string;
  metrics: FaceMetrics;
  embedding: number[] | null;
  detectedFacesCount: number;
  modelProvider: string;
  modelVersion: string;
  challengeState: FaceChallengeState;
}): FaceCaptureSessionMetadata {
  const stabilityScore = clamp(input.challengeState.stableMs / HOLD_DURATION_MS, 0, 1);

  return {
    captureMode: "LIVE_GUIDED_VIDEO",
    sessionId: input.sessionId,
    completedAt: new Date().toISOString(),
    qualityScore: buildQualityScore(input.metrics, stabilityScore),
    livenessScore: buildLivenessScore(input.challengeState, stabilityScore),
    completedSteps: [...input.challengeState.completedSteps],
    modelProvider: input.modelProvider,
    modelVersion: input.modelVersion,
    embedding: input.embedding,
    detectedFacesCount: input.detectedFacesCount,
    analysisMode: "face-api.js",
    metrics: {
      centerOffsetX: roundScore(input.metrics.centerOffsetX),
      centerOffsetY: roundScore(input.metrics.centerOffsetY),
      sizeRatio: roundScore(input.metrics.sizeRatio),
      yawScore: roundScore(input.metrics.yawScore),
      stabilityScore: roundScore(stabilityScore),
    },
    hints: [
      "video-ao-vivo",
      "moldura-oval",
      "captura-automatica",
      "validacao-estavel",
      input.detectedFacesCount > 1 ? "multiplos-rostos-detectados" : "um-rosto-detectado",
    ],
  };
}

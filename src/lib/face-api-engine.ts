"use client";

import type { FacePoint } from "@/lib/face-biometrics";

export type FaceApiModule = typeof import("face-api.js");

export interface FaceApiFaceAnalysis {
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  score: number;
  landmarks: FacePoint[];
  descriptor: number[] | null;
}

export interface FaceApiFrameAnalysis {
  provider: "face-api.js";
  modelName: string;
  modelVersion: string;
  faces: FaceApiFaceAnalysis[];
  selectedFace: FaceApiFaceAnalysis | null;
  detectedFacesCount: number;
}

export interface FaceApiFrameAnalysisOptions {
  inputSize?: 160 | 224 | 320 | 416 | 512;
  scoreThreshold?: number;
}

interface FaceApiEngine {
  faceapi: FaceApiModule;
}

const FACE_API_MODEL_NAME = "face-api.js";
const FACE_API_MODEL_VERSION = "0.22.2";
const DEFAULT_ANALYSIS_INPUT_SIZE = 416;
const DEFAULT_ANALYSIS_SCORE_THRESHOLD = 0.35;
const DEFAULT_FACE_API_MODEL_BASE_URL =
  (import.meta.env.VITE_FACE_API_MODELS_URL as string | undefined)?.replace(/\/$/, "") ||
  "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js-models@master";

let enginePromise: Promise<FaceApiEngine | null> | null = null;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeDescriptorVector(vector: ArrayLike<number> | null | undefined) {
  if (!vector || typeof vector.length !== "number" || vector.length === 0) {
    return [] as number[];
  }

  const values = Array.from(vector, (value) => Number(value) || 0);
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));

  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    return values;
  }

  return values.map((value) => value / magnitude);
}

async function ensureBackend(tf: typeof import("@tensorflow/tfjs")) {
  const currentBackend = tf.getBackend();

  if (currentBackend !== "webgl") {
    try {
      await tf.setBackend("webgl");
    } catch {
      await tf.setBackend("cpu");
    }
  }

  await tf.ready();
}

function normalizePoint(point: { x: number; y: number; z?: number }, width: number, height: number): FacePoint {
  return {
    x: clamp(point.x / Math.max(width, 1), 0, 1),
    y: clamp(point.y / Math.max(height, 1), 0, 1),
    z: typeof point.z === "number" ? point.z : undefined,
  };
}

function extractLandmarks(
  landmarks: {
    positions: Array<{ x: number; y: number; z?: number }>;
  },
  width: number,
  height: number,
) {
  return landmarks.positions.map((point) => normalizePoint(point, width, height));
}

function scoreDetectedFace(
  face: {
    detection: {
      box: { x: number; y: number; width: number; height: number };
      score: number;
    };
  },
  width: number,
  height: number,
) {
  const box = face.detection.box;
  const centerX = (box.x + box.width / 2) / Math.max(width, 1);
  const centerY = (box.y + box.height / 2) / Math.max(height, 1);
  const area = (box.width * box.height) / Math.max(width * height, 1);
  const centerDistance = Math.sqrt((centerX - 0.5) ** 2 + (centerY - 0.47) ** 2);

  return (
    face.detection.score * 0.52 +
    clamp(area / 0.28, 0, 1) * 0.28 +
    (1 - clamp(centerDistance / 0.35, 0, 1)) * 0.2
  );
}

async function loadFaceApiEngine(): Promise<FaceApiEngine | null> {
  try {
    const [faceapi, tf] = await Promise.all([import("face-api.js"), import("@tensorflow/tfjs")]);

    await ensureBackend(tf);

    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(`${DEFAULT_FACE_API_MODEL_BASE_URL}/tiny_face_detector`),
      faceapi.nets.faceLandmark68Net.loadFromUri(`${DEFAULT_FACE_API_MODEL_BASE_URL}/face_landmark_68`),
      faceapi.nets.faceRecognitionNet.loadFromUri(`${DEFAULT_FACE_API_MODEL_BASE_URL}/face_recognition`),
    ]);

    return { faceapi };
  } catch (error) {
    console.warn("Falha ao carregar o motor face-api.js.", error);
    return null;
  }
}

export async function getFaceApiEngine() {
  if (!enginePromise) {
    enginePromise = loadFaceApiEngine();
  }

  return enginePromise;
}

export async function analyzeFaceApiFrame(
  video: HTMLVideoElement,
  options: FaceApiFrameAnalysisOptions = {},
): Promise<FaceApiFrameAnalysis | null> {
  const engine = await getFaceApiEngine();

  if (!engine) {
    return null;
  }

  if (!video.videoWidth || !video.videoHeight) {
    return null;
  }

  const detections = await engine.faceapi
    .detectAllFaces(
      video,
      new engine.faceapi.TinyFaceDetectorOptions({
        inputSize: options.inputSize || DEFAULT_ANALYSIS_INPUT_SIZE,
        scoreThreshold: options.scoreThreshold ?? DEFAULT_ANALYSIS_SCORE_THRESHOLD,
      }),
    )
    .withFaceLandmarks()
    .withFaceDescriptors();

  const faces = detections.map((detection) => ({
    box: {
      x: detection.detection.box.x,
      y: detection.detection.box.y,
      width: detection.detection.box.width,
      height: detection.detection.box.height,
    },
    score: detection.detection.score,
    landmarks: extractLandmarks(detection.landmarks, video.videoWidth, video.videoHeight),
    descriptor: normalizeDescriptorVector(detection.descriptor || []),
  }));

  if (!faces.length) {
    return {
      provider: "face-api.js",
      modelName: FACE_API_MODEL_NAME,
      modelVersion: FACE_API_MODEL_VERSION,
      faces: [],
      selectedFace: null,
      detectedFacesCount: 0,
    };
  }

  const selectedFace =
    faces
      .map((face) => ({
        face,
        score: scoreDetectedFace(
          {
            detection: {
              box: face.box,
              score: face.score,
            },
          },
          video.videoWidth,
          video.videoHeight,
        ),
      }))
      .sort((left, right) => right.score - left.score)[0]?.face || null;

  return {
    provider: "face-api.js",
    modelName: FACE_API_MODEL_NAME,
    modelVersion: FACE_API_MODEL_VERSION,
    faces,
    selectedFace,
    detectedFacesCount: faces.length,
  };
}

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { badRequest } from "../../lib/http";

export type StoredBiometricImage = {
  absolutePath: string;
  relativePath: string;
  publicPath: string;
};

const uploadRoot = path.resolve(process.cwd(), "uploads");
const faceUploadRoot = path.join(uploadRoot, "face-platform");
const publicPrefix = "/api/biometria/uploads/face-platform";

const imageExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".heic",
  ".heif",
  ".avif",
  ".svg",
]);

const mimeToExtension: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
};

export type BiometricUploadFile = {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

function safeSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "_") || "unknown";
}

function isLikelyImageFile(file: BiometricUploadFile) {
  if (file.type.toLowerCase().startsWith("image/")) {
    return true;
  }

  return imageExtensions.has(path.extname(file.name || "").toLowerCase());
}

function resolveImageExtension(file: BiometricUploadFile) {
  const extension = path.extname(file.name || "").toLowerCase();
  if (imageExtensions.has(extension)) {
    return extension;
  }

  return mimeToExtension[file.type.toLowerCase()] ?? ".jpg";
}

function ensureDirectory(dirPath: string) {
  return fs.mkdir(dirPath, { recursive: true });
}

function buildPublicPath(relativePath: string) {
  return `${publicPrefix}/${relativePath}`.replace(/\\/g, "/");
}

export function getBiometricUploadRoot() {
  return faceUploadRoot;
}

export class BiometricStorageService {
  async persistBase64Image(category: string, imageBase64: string) {
    const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    const mimeType = match?.[1] ?? "image/png";
    const base64 = match?.[2] ?? imageBase64;
    const buffer = Buffer.from(base64, "base64");
    return this.persistBufferImage(category, buffer, mimeType);
  }

  async persistBufferImage(category: string, imageBuffer: Buffer, mimeType = "image/png") {
    const extension = mimeToExtension[mimeType.toLowerCase()] ?? ".png";
    const folder = path.join(faceUploadRoot, safeSegment(category), new Date().toISOString().slice(0, 10));
    const filename = `${Date.now()}-${crypto.randomUUID()}${extension}`;
    const absolutePath = path.join(folder, filename);

    await ensureDirectory(folder);
    await fs.writeFile(absolutePath, imageBuffer);

    const relativePath = path.relative(faceUploadRoot, absolutePath).split(path.sep).join("/");

    return {
      absolutePath,
      relativePath,
      publicPath: buildPublicPath(relativePath),
    } satisfies StoredBiometricImage;
  }

  async persistUploadFile(category: string, file: BiometricUploadFile) {
    if (!isLikelyImageFile(file)) {
      throw badRequest("Envie apenas arquivos de imagem");
    }

    if (file.size <= 0) {
      throw badRequest("Arquivo de imagem vazio");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const extension = resolveImageExtension(file);
    const folder = path.join(faceUploadRoot, safeSegment(category), new Date().toISOString().slice(0, 10));
    const filename = `${Date.now()}-${crypto.randomUUID()}${extension}`;
    const absolutePath = path.join(folder, filename);

    await ensureDirectory(folder);
    await fs.writeFile(absolutePath, buffer);

    const relativePath = path.relative(faceUploadRoot, absolutePath).split(path.sep).join("/");

    return {
      absolutePath,
      relativePath,
      publicPath: buildPublicPath(relativePath),
    } satisfies StoredBiometricImage;
  }

  async deleteRelativePath(relativePath: string) {
    if (!relativePath) {
      return;
    }

    const absolutePath = path.resolve(faceUploadRoot, relativePath);
    const normalizedRoot = path.resolve(faceUploadRoot);

    if (!absolutePath.startsWith(normalizedRoot)) {
      throw badRequest("Caminho de storage facial fora da raiz configurada.");
    }

    await fs.rm(absolutePath, { force: true, recursive: true });
  }
}

export const biometricStorage = new BiometricStorageService();

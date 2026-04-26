import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { Request } from "express";
import { badRequest } from "./http";

const uploadRoot = path.resolve(__dirname, "../../uploads");
const studentUploadRoot = path.join(uploadRoot, "students");
const studentUploadPublicPrefix = "/api/alunos/uploads";

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

export type StudentUploadPayload = {
  fields: Record<string, unknown>;
  photoFile?: UploadFile;
  biometricFiles: UploadFile[];
};

export type UploadFile = {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

type SaveStudentUploadParams = {
  req: Request;
  tenantId: string;
  studentId: string;
  kind: "photo" | "biometric";
  file: UploadFile;
};

function toHeaders(headers: Request["headers"]) {
  const result = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        result.append(key, item);
      }
      continue;
    }

    result.set(key, value);
  }

  return result;
}

function safeSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "_") || "unknown";
}

function isUploadFile(value: unknown): value is UploadFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    "type" in value &&
    "size" in value &&
    "arrayBuffer" in value &&
    typeof (value as UploadFile).arrayBuffer === "function"
  );
}

function isLikelyImageFile(file: UploadFile) {
  if (file.type.toLowerCase().startsWith("image/")) {
    return true;
  }

  const extension = path.extname(file.name || "").toLowerCase();
  return imageExtensions.has(extension);
}

function resolveImageExtension(file: UploadFile) {
  const extension = path.extname(file.name || "").toLowerCase();
  if (imageExtensions.has(extension)) {
    return extension;
  }

  return mimeToExtension[file.type.toLowerCase()] ?? ".jpg";
}

function buildPublicUrl(req: Request, publicPath: string) {
  const host = req.get("host") ?? "localhost:3001";
  const origin = `${req.protocol}://${host}`;
  return new URL(publicPath, `${origin}`).toString();
}

async function ensureUploadRoot() {
  await fs.mkdir(uploadRoot, { recursive: true });
}

function studentDirectory(tenantId: string, studentId: string, kind: "photo" | "biometric") {
  return path.join(
    studentUploadRoot,
    safeSegment(tenantId),
    safeSegment(studentId),
    kind === "photo" ? "photo" : "biometrics",
  );
}

export function getUploadRoot() {
  return uploadRoot;
}

export function isMultipartRequest(req: Request) {
  return String(req.headers["content-type"] ?? "").toLowerCase().includes("multipart/form-data");
}

export async function readMultipartFormData(req: Request) {
  const request = new Request(new URL(req.originalUrl ?? req.url ?? "/", "http://localhost"), {
    method: req.method,
    headers: toHeaders(req.headers),
    body: Readable.toWeb(req as unknown as Readable),
    duplex: "half",
  });

  return request.formData();
}

export async function readStudentUploadPayload(req: Request): Promise<StudentUploadPayload> {
  if (!isMultipartRequest(req)) {
    return {
      fields: (req.body ?? {}) as Record<string, unknown>,
      biometricFiles: [],
    };
  }

  const formData = await readMultipartFormData(req);
  const photoEntry = formData.get("foto");
  const photoFile = isUploadFile(photoEntry) ? photoEntry : undefined;
  const fields: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    if (key === "foto" && photoFile) {
      continue;
    }

    if (key === "biometriaFotos" || value instanceof File) {
      continue;
    }

    const current = fields[key];
    if (current === undefined) {
      fields[key] = value;
      continue;
    }

    if (Array.isArray(current)) {
      current.push(value);
      continue;
    }

    fields[key] = [current, value];
  }

  const biometricFiles: UploadFile[] = [];
  for (const entry of formData.getAll("biometriaFotos")) {
    if (isUploadFile(entry)) {
      biometricFiles.push(entry);
    }
  }

  return { fields, photoFile, biometricFiles };
}

export async function saveStudentUploadFile(params: SaveStudentUploadParams) {
  if (!isLikelyImageFile(params.file)) {
    throw badRequest("Envie apenas arquivos de imagem");
  }

  if (params.file.size <= 0) {
    throw badRequest("Arquivo de imagem vazio");
  }

  await ensureUploadRoot();

  const directory = studentDirectory(params.tenantId, params.studentId, params.kind);
  await fs.mkdir(directory, { recursive: true });

  const filename = `${params.kind}-${Date.now()}-${crypto.randomUUID()}${resolveImageExtension(params.file)}`;
  const absolutePath = path.join(directory, filename);
  await fs.writeFile(absolutePath, Buffer.from(await params.file.arrayBuffer()));

  const relativePath = path.relative(uploadRoot, absolutePath).split(path.sep).join("/");
  const publicPath = `${studentUploadPublicPrefix}/${relativePath}`;

  return {
    absolutePath,
    relativePath,
    publicPath,
    publicUrl: buildPublicUrl(params.req, publicPath),
  };
}

export async function removePathIfExists(targetPath: string) {
  await fs.rm(targetPath, { recursive: true, force: true });
}

export async function removeStudentUploadDirectory(tenantId: string, studentId: string) {
  const directory = path.join(studentUploadRoot, safeSegment(tenantId), safeSegment(studentId));
  await removePathIfExists(directory);
}

export async function removeUploadedAssetByPublicUrl(publicUrl: string) {
  if (!publicUrl) {
    return;
  }

  try {
    const pathname = new URL(publicUrl, "http://localhost").pathname;
    const prefix = `${studentUploadPublicPrefix}/`;
    if (!pathname.startsWith(prefix)) {
      return;
    }

    const relativePath = pathname.slice(prefix.length);
    const absolutePath = path.join(uploadRoot, relativePath.split("/").join(path.sep));
    await removePathIfExists(absolutePath);
  } catch {
    // Ignore malformed URLs or cleanup errors.
  }
}

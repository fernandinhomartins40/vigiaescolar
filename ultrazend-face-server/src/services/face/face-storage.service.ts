import fs from 'fs/promises';
import path from 'path';

const DEFAULT_STORAGE_ROOT = path.join(process.cwd(), 'uploads', 'face-platform');

function normalizeBase64Image(input: string) {
  const match = input.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (match) {
    return {
      mimeType: match[1],
      buffer: Buffer.from(match[2], 'base64'),
    };
  }

  return {
    mimeType: 'image/png',
    buffer: Buffer.from(input, 'base64'),
  };
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  return 'png';
}

async function ensureDirectory(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

function resolveStoragePath(storageRoot: string, relativePath: string) {
  const normalizedRoot = path.resolve(storageRoot);
  const absolutePath = path.resolve(normalizedRoot, relativePath);
  const relativeToRoot = path.relative(normalizedRoot, absolutePath);

  if (
    relativeToRoot === '' ||
    (!relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot))
  ) {
    return absolutePath;
  }

  throw new Error('Caminho de storage facial fora da raiz configurada.');
}

function sanitizePathSegment(value: string) {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!normalized) {
    throw new Error('Caminho de storage facial fora da raiz configurada.');
  }

  return normalized;
}

export class FaceStorageService {
  private readonly storageRoot: string;
  private readonly publicBaseUrl: string;

  constructor() {
    this.storageRoot = process.env.FACE_PLATFORM_STORAGE_PATH || DEFAULT_STORAGE_ROOT;
    this.publicBaseUrl = (process.env.FACE_PLATFORM_PUBLIC_URL || '').replace(/\/$/, '');
  }

  public async persistBase64Image(
    category: 'enrollments' | 'events',
    imageBase64: string,
    tenantId?: string,
  ): Promise<string> {
    const { mimeType, buffer } = normalizeBase64Image(imageBase64);
    const extension = extensionFromMimeType(mimeType);
    const folder = tenantId
      ? path.join(
          this.storageRoot,
          'tenants',
          sanitizePathSegment(tenantId),
          category,
          new Date().toISOString().slice(0, 10),
        )
      : path.join(this.storageRoot, category, new Date().toISOString().slice(0, 10));
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
    const absolutePath = path.join(folder, fileName);

    await ensureDirectory(folder);
    await fs.writeFile(absolutePath, buffer);

    return path.relative(this.storageRoot, absolutePath).replace(/\\/g, '/');
  }

  public buildPublicPath(relativePath: string | null | undefined): string | null {
    if (!relativePath) {
      return null;
    }

    const pathSuffix = `/uploads/face-platform/${relativePath}`.replace(/\\/g, '/');
    return this.publicBaseUrl ? `${this.publicBaseUrl}${pathSuffix}` : pathSuffix;
  }

  public async deleteRelativePath(relativePath: string | null | undefined): Promise<void> {
    if (!relativePath) {
      return;
    }

    const absolutePath = resolveStoragePath(this.storageRoot, relativePath);
    await fs.rm(absolutePath, { force: true });
  }
}

export default new FaceStorageService();

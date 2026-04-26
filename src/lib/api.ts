export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") || "/api";
const TOKEN_KEY = "vigiaescolar:token";
const TENANT_KEY = "vigiaescolar:tenant";

function storage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

export function getStoredToken() {
  return storage()?.getItem(TOKEN_KEY) || null;
}

export function setStoredToken(token: string | null) {
  const store = storage();
  if (!store) return;
  if (token) {
    store.setItem(TOKEN_KEY, token);
  } else {
    store.removeItem(TOKEN_KEY);
  }
}

export function getStoredTenantId() {
  return storage()?.getItem(TENANT_KEY) || null;
}

export function setStoredTenantId(tenantId: string | null) {
  const store = storage();
  if (!store) return;
  if (tenantId) {
    store.setItem(TENANT_KEY, tenantId);
  } else {
    store.removeItem(TENANT_KEY);
  }
}

export function clearAuthStorage() {
  setStoredToken(null);
  setStoredTenantId(null);
}

function toUrl(path: string, params?: Record<string, string | number | boolean | null | undefined>) {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const url = new URL(path.startsWith("http") ? path : `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`, origin);

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") return;
    url.searchParams.set(key, String(value));
  });

  return url.toString();
}

async function readPayload(response: Response) {
  const text = await response.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function serializeBody(body: unknown, headers: Headers) {
  if (body === undefined) return undefined;
  if (body instanceof FormData || body instanceof Blob || body instanceof ArrayBuffer) return body;
  if (typeof body === "string") return body;

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return JSON.stringify(body);
}

function errorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  const message = record.message || record.error || record.detail || record.title;
  return typeof message === "string" && message.trim() ? message : fallback;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { params?: Record<string, string | number | boolean | null | undefined> } = {},
) {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");

  const token = getStoredToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const tenantId = getStoredTenantId();
  if (tenantId && !headers.has("X-Tenant-Id")) {
    headers.set("X-Tenant-Id", tenantId);
  }

  const response = await fetch(toUrl(path, options.params), {
    ...options,
    credentials: "include",
    headers,
    body: serializeBody(options.body, headers),
  });

  const payload = await readPayload(response);

  if (!response.ok) {
    throw new ApiError(response.status, errorMessage(payload, response.statusText || "Falha na requisição"), payload);
  }

  return payload as T;
}

function extractRecord(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  return (
    record.data ??
    record.item ??
    record.result ??
    record.record ??
    record.user ??
    record.session ??
    record.profile ??
    payload
  );
}

export function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }

  const record = extractRecord(payload);
  if (Array.isArray(record)) {
    return record as T[];
  }

  if (record && typeof record === "object") {
    const nested = record as Record<string, unknown>;
    for (const key of ["items", "results", "records", "rows", "list"]) {
      const value = nested[key];
      if (Array.isArray(value)) {
        return value as T[];
      }
    }
  }

  return [];
}

export function unwrapItem<T>(payload: unknown): T {
  return extractRecord(payload) as T;
}

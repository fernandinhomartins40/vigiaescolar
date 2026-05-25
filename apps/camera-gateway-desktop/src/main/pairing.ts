/**
 * Pareamento gateway <-> tenant na VPS.
 *
 * Fluxo:
 *  1. Admin clica em "Adicionar gateway" no painel web → backend gera código
 *     de 6 dígitos válido por 10 minutos, associado ao tenant.
 *  2. Técnico abre o gateway desktop, digita o código.
 *  3. Gateway chama POST /api/gateways/pair { code, machineInfo }.
 *  4. Backend valida o código, cria registro Gateway no banco, devolve
 *     { gatewayId, gatewayToken, gatewayName, schoolName }.
 *  5. Gateway persiste localmente — daqui em diante usa Bearer <token>
 *     em todas as chamadas pra API.
 */
import os from "node:os";
import { app } from "electron";
import { config, saveConfig } from "./config";

export type PairResult = {
  gatewayId: string;
  gatewayName: string;
  schoolId?: string;
  schoolName?: string;
};

export async function pairWithServer(code: string): Promise<PairResult> {
  const clean = code.replace(/\D/g, "");
  if (clean.length !== 6) {
    throw new Error("Código de pareamento inválido (deve ter 6 dígitos).");
  }

  const apiBase = config.get("apiBaseUrl");
  const machineInfo = {
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
  };

  const response = await fetch(`${apiBase}/gateways/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: clean, machineInfo }),
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }

  const data = (await response.json()) as {
    gatewayId: string;
    gatewayToken: string;
    gatewayName: string;
    schoolId?: string;
    schoolName?: string;
  };

  saveConfig({
    gatewayId: data.gatewayId,
    gatewayToken: data.gatewayToken,
    gatewayName: data.gatewayName,
    schoolId: data.schoolId,
    schoolName: data.schoolName,
  });

  return {
    gatewayId: data.gatewayId,
    gatewayName: data.gatewayName,
    schoolId: data.schoolId,
    schoolName: data.schoolName,
  };
}

export function getGatewayToken(): string | undefined {
  return config.get("gatewayToken");
}

export function getApiBase(): string {
  return config.get("apiBaseUrl");
}

/** Helper para todas as chamadas autenticadas à API VigiaEscolar pelo gateway. */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = config.get("gatewayToken");
  if (!token) throw new Error("Gateway não está pareado.");
  const apiBase = config.get("apiBaseUrl");
  const url = `${apiBase}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...((init.body && !(init.body instanceof FormData))
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`API ${path} respondeu ${response.status}`);
  }
  return (await response.json()) as T;
}

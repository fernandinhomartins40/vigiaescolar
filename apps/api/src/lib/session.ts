import type { Response } from "express";
import { env, sessionTtlMs, isProduction } from "../config/env";
import { SESSION_COOKIE_NAME } from "./security";

const cookieBaseOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax" as const,
  path: "/",
};

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    ...cookieBaseOptions,
    expires: expiresAt,
    maxAge: sessionTtlMs,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE_NAME, cookieBaseOptions);
}

export function sessionExpiresAt() {
  return new Date(Date.now() + sessionTtlMs);
}

export const sessionCookieName = env.SESSION_COOKIE_NAME;

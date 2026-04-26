import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { unauthorized } from "../lib/http";
import { clearSessionCookie } from "../lib/session";
import { hashToken, SESSION_COOKIE_NAME } from "../lib/security";

function readCookieSessionToken(req: Request) {
  const rawCookies = req.headers.cookie;
  if (!rawCookies) return undefined;

  const match = rawCookies
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`));

  if (!match) return undefined;
  return decodeURIComponent(match.slice(SESSION_COOKIE_NAME.length + 1));
}

export function readSessionTokens(req: Request) {
  const tokens = new Set<string>();

  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (token) {
      tokens.add(token);
    }
  }

  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE_NAME] ?? readCookieSessionToken(req);
  if (cookieToken) {
    tokens.add(cookieToken);
  }

  return Array.from(tokens);
}

export const loadSession: RequestHandler = async (req, res, next) => {
  const tokens = readSessionTokens(req);
  if (tokens.length === 0) {
    return next();
  }

  for (const token of tokens) {
    const tokenHash = hashToken(token);
    const session = await prisma.session.findUnique({
      where: { tokenHash },
      include: {
        user: true,
        tenant: true,
      },
    });

    if (!session) {
      continue;
    }

    const now = new Date();
    if (session.revokedAt || session.expiresAt <= now) {
      await prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: session.revokedAt ?? now },
      });
      clearSessionCookie(res);
      continue;
    }

    await prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: now },
    });

    req.auth = {
      sessionId: session.id,
      sessionToken: token,
      userId: session.userId,
      userEmail: session.user.email,
      userName: session.user.name,
      tenantId: session.tenantId,
      tenantName: session.tenant.name,
      tenantSlug: session.tenant.slug,
      role: session.user.role,
      sessionExpiresAt: session.expiresAt,
    };

    return next();
  }

  clearSessionCookie(res);
  return next();
};

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) {
    return next(unauthorized());
  }

  return next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(unauthorized());
    }

    if (!roles.includes(req.auth.role)) {
      return next(unauthorized("Permissão insuficiente"));
    }

    return next();
  };
}

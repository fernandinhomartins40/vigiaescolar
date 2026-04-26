import { UserRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { badRequest, conflict, asyncHandler, unauthorized } from "../lib/http";
import { prisma } from "../lib/prisma";
import { clearSessionCookie, sessionExpiresAt, setSessionCookie } from "../lib/session";
import { avatarUrl, createSessionToken, hashPassword, hashToken, slugify, verifyPassword } from "../lib/security";
import { toAuthResponseDTO } from "../lib/serializers";
import { readSessionTokens, requireAuth } from "../middleware/auth";

const router = Router();

const registerSchema = z
  .object({
    tenantName: z.string().trim().min(3),
    tenantSlug: z.string().trim().min(3).optional(),
    name: z.string().trim().min(3).optional(),
    nome: z.string().trim().min(3).optional(),
    email: z.string().trim().email(),
    password: z.string().min(8),
  })
  .refine((data) => Boolean(data.name?.trim() || data.nome?.trim()), {
    message: "Informe seu nome",
    path: ["name"],
  })
  .transform((data) => ({
    tenantName: data.tenantName,
    tenantSlug: data.tenantSlug,
    name: data.name?.trim() || data.nome?.trim() || "",
    email: data.email,
    password: data.password,
  }));

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
});

async function createSession(userId: string, tenantId: string, reqHeaders: { userAgent?: string; ipAddress?: string }) {
  const token = createSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = sessionExpiresAt();

  const session = await prisma.session.create({
    data: {
      userId,
      tenantId,
      tokenHash,
      expiresAt,
      lastUsedAt: new Date(),
      userAgent: reqHeaders.userAgent,
      ipAddress: reqHeaders.ipAddress,
    },
  });

  return { token, session };
}

async function buildAuthResponse(params: {
  user: {
    id: string;
    tenantId: string;
    name: string;
    email: string;
    role: UserRole;
    avatarUrl: string | null;
    isActive: boolean;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    isActive: boolean;
  };
  session: {
    id: string;
    expiresAt: Date;
    lastUsedAt: Date | null;
  };
  accessToken?: string;
}) {
  const guardian =
    params.user.role === UserRole.GUARDIAN
      ? await prisma.guardian.findFirst({
          where: {
            tenantId: params.user.tenantId,
            email: params.user.email,
          },
          select: { id: true },
        })
      : null;

  return toAuthResponseDTO({
    user: {
      ...params.user,
      tenantName: params.tenant.name,
      avatarUrl: params.user.avatarUrl ?? avatarUrl(params.user.name),
      responsibleId: guardian?.id,
    },
    tenant: params.tenant,
    session: params.session,
    accessToken: params.accessToken,
  });
}

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const email = body.email.toLowerCase();
    const slug = body.tenantSlug ? slugify(body.tenantSlug) : slugify(body.tenantName);

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw conflict("E-mail já cadastrado");
    }

    const existingTenant = await prisma.tenant.findUnique({ where: { slug } });
    if (existingTenant) {
      throw conflict("Slug do tenant já em uso");
    }

    const passwordHash = await hashPassword(body.password);

    const tenant = await prisma.tenant.create({
      data: {
        name: body.tenantName,
        slug,
        settings: {
          create: {},
        },
      },
    });

    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: body.name,
        email,
        passwordHash,
        role: UserRole.OWNER,
        avatarUrl: avatarUrl(body.name),
      },
    });

    const { token, session } = await createSession(user.id, tenant.id, {
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });

    setSessionCookie(res, token, session.expiresAt);

    res.status(201).json(
      await buildAuthResponse({
        user,
        tenant,
        session,
        accessToken: token,
      }),
    );
  }),
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const email = body.email.toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        tenant: true,
      },
    });

    if (!user || !user.isActive) {
      throw unauthorized("Credenciais inválidas");
    }

    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) {
      throw unauthorized("Credenciais inválidas");
    }

    const { token, session } = await createSession(user.id, user.tenantId, {
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });

    setSessionCookie(res, token, session.expiresAt);

    res.json(
      await buildAuthResponse({
        user,
        tenant: user.tenant,
        session,
        accessToken: token,
      }),
    );
  }),
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const tokens = readSessionTokens(req);
    for (const token of tokens) {
      await prisma.session.updateMany({
        where: {
          tokenHash: hashToken(token),
        },
        data: {
          revokedAt: new Date(),
        },
      });
    }

    clearSessionCookie(res);
    res.status(204).send();
  }),
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [user, tenant, session] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.auth!.userId },
      }),
      prisma.tenant.findUnique({
        where: { id: req.auth!.tenantId },
      }),
      prisma.session.findUnique({
        where: { id: req.auth!.sessionId },
      }),
    ]);

    if (!user || !tenant || !session) {
      throw badRequest("Sessão inválida");
    }

    res.json(
      await buildAuthResponse({
        user,
        tenant,
        session,
        accessToken: req.auth!.sessionToken,
      }),
    );
  }),
);

export default router;

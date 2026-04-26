import type { UserRole } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      auth?: {
      sessionId: string;
      sessionToken: string;
      userId: string;
      userEmail: string;
        userName: string;
        tenantId: string;
        tenantName: string;
        tenantSlug: string;
        role: UserRole;
        sessionExpiresAt: Date;
      };
    }
  }
}

export {};

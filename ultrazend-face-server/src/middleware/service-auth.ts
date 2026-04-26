import type { NextFunction, Request, Response } from 'express';

export interface ServiceAuthContext {
  tenantId: string;
  userId?: string;
  userName?: string;
}

export interface AuthenticatedServiceRequest extends Request {
  serviceAuth?: ServiceAuthContext;
}

function extractHeaderString(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const candidate = value.find((item) => typeof item === 'string' && item.trim());
    return typeof candidate === 'string' ? candidate.trim() : undefined;
  }

  return undefined;
}

function resolveTenantId(req: Request) {
  const headerTenantId =
    extractHeaderString(req.headers['x-tenant-id']) ||
    extractHeaderString(req.headers['x-tenant']);
  const municipioTenantId = extractHeaderString(req.headers['x-municipio-id']);

  if (
    headerTenantId &&
    municipioTenantId &&
    headerTenantId !== municipioTenantId
  ) {
    return {
      mismatch: {
        headerTenantId,
        municipioTenantId,
      },
    };
  }

  return {
    tenantId: headerTenantId || municipioTenantId,
  };
}

export function serviceAuthMiddleware(
  req: AuthenticatedServiceRequest,
  res: Response,
  next: NextFunction,
) {
  const token = req.headers.authorization?.replace('Bearer ', '').trim();
  const expectedToken = process.env.FACE_PLATFORM_SERVICE_TOKEN?.trim();

  if (!expectedToken) {
    return res.status(500).json({ error: 'FACE_PLATFORM_SERVICE_TOKEN is not configured' });
  }

  if (!token) {
    return res.status(401).json({ error: 'Service token required' });
  }

  if (token !== expectedToken) {
    return res.status(401).json({ error: 'Invalid service token' });
  }

  const tenantResolution = resolveTenantId(req);
  if (tenantResolution.mismatch) {
    return res.status(400).json({
      error: 'Conflicting tenant context',
      details: tenantResolution.mismatch,
    });
  }

  if (!tenantResolution.tenantId) {
    return res.status(400).json({ error: 'Tenant context is required' });
  }

  req.serviceAuth = {
    tenantId: tenantResolution.tenantId,
    userId:
      extractHeaderString(req.headers['x-user-id']) ||
      extractHeaderString(req.headers['x-user']) ||
      extractHeaderString(req.headers['x-actor-id']),
    userName: extractHeaderString(req.headers['x-user-name']),
  };

  next();
}

export default serviceAuthMiddleware;

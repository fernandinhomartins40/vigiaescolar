import type { NextFunction, Request, Response } from "express";
import { unauthorized } from "../lib/http";

function readBearerToken(req: Request) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return "";
  }

  return authorization.slice("Bearer ".length).trim();
}

export function requireCameraGatewayService(req: Request, _res: Response, next: NextFunction) {
  const expectedToken =
    process.env.CAMERA_GATEWAY_SERVICE_TOKEN?.trim() ||
    process.env.FACE_PLATFORM_SERVICE_TOKEN?.trim() ||
    "";

  if (!expectedToken) {
    return next(unauthorized("CAMERA_GATEWAY_SERVICE_TOKEN nao configurado"));
  }

  const token = readBearerToken(req);
  if (!token || token !== expectedToken) {
    return next(unauthorized("Token de gateway invalido"));
  }

  return next();
}

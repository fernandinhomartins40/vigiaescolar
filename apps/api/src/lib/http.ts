import type { NextFunction, Request, RequestHandler, Response } from "express";

export class AppError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, message: string, code = "APP_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function badRequest(message: string, code = "BAD_REQUEST") {
  return new AppError(400, message, code);
}

export function unauthorized(message = "Não autenticado") {
  return new AppError(401, message, "UNAUTHORIZED");
}

export function forbidden(message = "Acesso negado") {
  return new AppError(403, message, "FORBIDDEN");
}

export function notFound(message = "Recurso não encontrado") {
  return new AppError(404, message, "NOT_FOUND");
}

export function conflict(message: string) {
  return new AppError(409, message, "CONFLICT");
}

export function asyncHandler(handler: RequestHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

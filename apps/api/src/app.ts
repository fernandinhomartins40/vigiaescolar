import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { env, corsOrigins } from "./config/env";
import { loadSession } from "./middleware/auth";
import { errorHandler } from "./middleware/error";
import { AppError, notFound } from "./lib/http";
import authRoutes from "./routes/auth";
import schoolRoutes from "./routes/schools";
import classRoutes from "./routes/classes";
import guardianRoutes from "./routes/guardians";
import studentRoutes from "./routes/students";
import cameraRoutes from "./routes/cameras";
import cameraEventsRoutes from "./routes/camera-events";
import biometricsRoutes from "./routes/biometrics";
import notificationRoutes from "./routes/notifications";
import attendanceRoutes from "./routes/attendance";
import presenceRoutes from "./routes/presence";
import settingsRoutes from "./routes/settings";
import dashboardRoutes from "./routes/dashboard";
import internalCameraGatewayRoutes from "./routes/internal-camera-gateway";
import guardianPortalRoutes from "./routes/guardian-portal";
import { getBiometricUploadRoot } from "./services/biometrics/storage";

export function createApp() {
  const app = express();

  app.set("trust proxy", env.TRUST_PROXY);

  app.use(
    helmet({
      crossOriginResourcePolicy: false,
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || corsOrigins.includes(origin)) {
          return callback(null, true);
        }

        return callback(new AppError(403, "Origem não permitida", "CORS_FORBIDDEN"));
      },
      credentials: true,
    }),
  );

  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(loadSession);

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "vigiaescolar-api",
    });
  });

  app.use("/api/biometria/uploads/face-platform", express.static(getBiometricUploadRoot(), { index: false }));
  app.use("/api/biometrics/uploads/face-platform", express.static(getBiometricUploadRoot(), { index: false }));

  app.use("/api/auth", authRoutes);
  app.use("/api/schools", schoolRoutes);
  app.use("/api/escolas", schoolRoutes);
  app.use("/api/classes", classRoutes);
  app.use("/api/turmas", classRoutes);
  app.use("/api/guardians", guardianRoutes);
  app.use("/api/responsibles", guardianRoutes);
  app.use("/api/responsaveis", guardianRoutes);
  app.use("/api/students", studentRoutes);
  app.use("/api/alunos", studentRoutes);
  app.use("/api/cameras", cameraRoutes);
  app.use("/api/camera-events", cameraEventsRoutes);
  app.use("/api/biometria", biometricsRoutes);
  app.use("/api/biometrics", biometricsRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/notificacoes", notificationRoutes);
  app.use("/api/attendance", attendanceRoutes);
  app.use("/api/presence", presenceRoutes);
  app.use("/api/presenca", presenceRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/configuracoes", settingsRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/guardian-portal", guardianPortalRoutes);
  app.use("/api/portal-responsavel", guardianPortalRoutes);
  app.use("/api/internal/camera-gateway", internalCameraGatewayRoutes);

  app.use("/api", (_req, _res, next) => next(notFound("Rota não encontrada")));
  app.use(errorHandler);

  return app;
}

import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatório"),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:7003"),
  SESSION_COOKIE_NAME: z.string().default("vigiaescolar_session"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
});

export const env = envSchema.parse(process.env);

export const corsOrigins = env.CORS_ORIGINS
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const isProduction = env.NODE_ENV === "production";
export const sessionTtlMs = env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

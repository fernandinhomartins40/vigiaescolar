import { env } from "../config/env";

console.log(
  JSON.stringify(
    {
      ok: true,
      nodeEnv: env.NODE_ENV,
      host: env.HOST,
      port: env.PORT,
      databaseConfigured: Boolean(env.DATABASE_URL),
    },
    null,
    2,
  ),
);

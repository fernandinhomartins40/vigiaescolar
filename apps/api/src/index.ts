import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";

async function bootstrap() {
  const app = createApp();

  const server = app.listen(env.PORT, env.HOST, () => {
    console.log(`API running at http://${env.HOST}:${env.PORT}`);
  });

  const shutdown = async () => {
    server.close();
    await prisma.$disconnect();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});

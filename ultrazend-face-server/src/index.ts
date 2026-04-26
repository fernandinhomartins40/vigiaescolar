import dotenv from 'dotenv';
import { createServer } from 'http';
import ExpressServer from './server/ExpressServer';
import logger from './utils/logger';
import prisma from './utils/prisma';

dotenv.config();

const PORT = Number(process.env.PORT || 9006);
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  try {
    await prisma.$connect();
    logger.info('Database connection established');

    const expressServer = new ExpressServer();
    const httpServer = createServer(expressServer.getApp());

    httpServer.listen(PORT, HOST, () => {
      logger.info(`UltraZend Face Server running on ${HOST}:${PORT}`);
    });

    const gracefulShutdown = async () => {
      logger.info('Shutting down UltraZend Face Server');
      await prisma.$disconnect();
      httpServer.close(() => process.exit(0));
    };

    process.on('SIGTERM', () => {
      void gracefulShutdown();
    });
    process.on('SIGINT', () => {
      void gracefulShutdown();
    });
  } catch (error) {
    logger.error('Failed to start UltraZend Face Server', { error });
    process.exit(1);
  }
}

void start();

import compression from 'compression';
import cors from 'cors';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import serviceAuthMiddleware from '../middleware/service-auth';
import facePlatformRoutes from '../routes/face-platform.routes';
import logger from '../utils/logger';

export class ExpressServer {
  private app: Application;

  constructor() {
    this.app = express();
    this.setupMiddlewares();
    this.setupRoutes();
    this.setupErrorHandlers();
  }

  public getApp() {
    return this.app;
  }

  private setupMiddlewares() {
    this.app.set('trust proxy', 1);

    this.app.use(helmet());
    this.app.use(cors({
      origin: process.env.CORS_ORIGIN || '*',
      credentials: true,
    }));
    this.app.use(express.json({ limit: '20mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '20mb' }));
    this.app.use(compression());

    const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
    this.app.use('/uploads', express.static(uploadDir));

    const limiter = rateLimit({
      windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
      max: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 300),
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use('/api', limiter);

    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      logger.debug(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      next();
    });
  }

  private setupRoutes() {
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        service: 'ultrazend-face-server',
        timestamp: new Date().toISOString(),
      });
    });

    this.app.use('/api/face-platform', serviceAuthMiddleware, facePlatformRoutes);

    this.app.use((_req: Request, res: Response) => {
      res.status(404).json({ error: 'Route not found' });
    });
  }

  private setupErrorHandlers() {
    this.app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
      logger.error('Unhandled express error', { error: error?.message || error });
      res.status(500).json({
        error: 'Internal server error',
      });
    });
  }
}

export default ExpressServer;

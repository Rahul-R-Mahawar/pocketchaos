import cors from 'cors';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { CHAOS_HEADER } from './controllers/proxy.controller';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import {
  createAuthLimiter,
  createEndpointsLimiter,
  createProjectKeyLimiter,
  createProxyLimiter,
} from './middleware/rateLimit';
import { authRouter } from './routes/auth.routes';
import { endpointRouter } from './routes/endpoint.routes';
import { logsRouter } from './routes/logs.routes';
import { mobileRouter } from './routes/mobile.routes';
import { proxyRouter, sandboxProxyResponses } from './routes/proxy.routes';
import { sendSuccess } from './utils/apiResponse';

export interface AppOptions {
  /** Defaults to true. Test suites can switch it off to avoid cross-test 429s. */
  rateLimit?: boolean;
}

export function createApp(options: AppOptions = {}): Express {
  const rateLimited = options.rateLimit ?? true;
  const passThrough: RequestHandler = (_req, _res, next) => next();
  const limit = (factory: () => RequestHandler): RequestHandler => (rateLimited ? factory() : passThrough);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, exposedHeaders: [CHAOS_HEADER] }));

  app.get('/health', (_req, res) => sendSuccess(res, { status: 'ok' }));

  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));
  api.use('/auth', limit(createAuthLimiter), authRouter);
  api.use('/endpoints', limit(createEndpointsLimiter), endpointRouter);
  api.use('/mobile', limit(createProjectKeyLimiter), mobileRouter);
  api.use('/logs', limit(createProjectKeyLimiter), logsRouter);
  app.use('/api', api);

  // Raw bytes for the proxy so any content type (JSON, form, binary) is forwarded unchanged.
  app.use(
    '/proxy',
    sandboxProxyResponses,
    limit(createProxyLimiter),
    express.raw({ type: () => true, limit: '1mb' }),
    proxyRouter,
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

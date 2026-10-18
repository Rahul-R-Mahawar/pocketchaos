import { rateLimit, type Options } from 'express-rate-limit';
import { sendError } from '../utils/apiResponse';

function limiter(windowMs: number, limit: number): ReturnType<typeof rateLimit> {
  const options: Partial<Options> = {
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      sendError(res, 429, 'RATE_LIMITED', 'Too many requests, please slow down');
    },
  };
  return rateLimit(options);
}

/** Login/register: slows down credential stuffing. */
export const createAuthLimiter = () => limiter(15 * 60 * 1000, 30);

/** Authenticated CRUD: bounds DB writes per client while leaving room for dashboard slider drags. */
export const createEndpointsLimiter = () => limiter(60 * 1000, 300);

/** Routes protected only by a projectKey (pairing, logs): makes guessing the 32^6 key space impractical. */
export const createProjectKeyLimiter = () => limiter(60 * 1000, 120);

/** The chaos proxy: generous enough for a mobile batch test run, bounded against floods. */
export const createProxyLimiter = () => limiter(60 * 1000, 600);

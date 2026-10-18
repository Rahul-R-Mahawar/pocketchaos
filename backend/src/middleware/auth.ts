import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

const BEARER_REGEX = /^Bearer\s+(\S+)$/i;
const OBJECT_ID_REGEX = /^[a-f0-9]{24}$/i;

export function signAccessToken(userId: string): string {
  return jwt.sign({}, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = BEARER_REGEX.exec(req.get('authorization') ?? '')?.[1];
  if (!token) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing or malformed Authorization header');
  }

  let payload: string | jwt.JwtPayload;
  try {
    // Pin the algorithm so a token signed with "none" or another alg is never accepted.
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Token has expired, please log in again');
    }
    throw new AppError(401, 'INVALID_TOKEN', 'Invalid token');
  }

  if (typeof payload === 'string' || !payload.sub || !OBJECT_ID_REGEX.test(payload.sub)) {
    throw new AppError(401, 'INVALID_TOKEN', 'Invalid token');
  }

  req.auth = { userId: payload.sub };
  next();
};

/** Typed accessor for handlers mounted behind `requireAuth`. */
export function getAuthUserId(req: Request): string {
  if (!req.auth) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  return req.auth.userId;
}

import type { Response } from 'express';

/**
 * Standard envelope for every PocketChaos-generated response:
 *   success -> { success: true,  data: T,    error: null }
 *   failure -> { success: false, data: null, error: { code, message, details? } }
 * Proxied upstream/mock payloads are the only bodies returned without it.
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResponse<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: ApiErrorBody };

export function successBody<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

export function errorBody(code: string, message: string, details?: unknown): ApiResponse<never> {
  const error: ApiErrorBody = { code, message };
  if (details !== undefined) error.details = details;
  return { success: false, data: null, error };
}

export function sendSuccess<T>(res: Response, data: T, status = 200): void {
  res.status(status).json(successBody(data));
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  res.status(status).json(errorBody(code, message, details));
}

import type { Response } from 'express';

/**
 * Standard envelope for every PocketChaos-generated response (.ai/CONTEXT.md §4):
 *   success -> { success: true,  data: T }
 *   failure -> { success: false, error: { code, message, details: [] } }
 * Proxied upstream/mock payloads and injected chaos faults are the only bodies returned without it.
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details: unknown[];
}

export type ApiResponse<T> = { success: true; data: T } | { success: false; error: ApiErrorBody };

export function successBody<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

export function errorBody(code: string, message: string, details: unknown[] = []): ApiResponse<never> {
  return { success: false, error: { code, message, details } };
}

export function sendSuccess<T>(res: Response, data: T, status = 200): void {
  res.status(status).json(successBody(data));
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details: unknown[] = [],
): void {
  res.status(status).json(errorBody(code, message, details));
}

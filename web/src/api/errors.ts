import { isAxiosError } from 'axios';
import type { ApiFailure, FieldIssue } from './types';

/** Every failed API call surfaces as one of these, whatever went wrong underneath. */
export class ApiError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly details: FieldIssue[];

  constructor(status: number | null, code: string, message: string, details: FieldIssue[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isFailureEnvelope(body: unknown): body is ApiFailure {
  if (typeof body !== 'object' || body === null) return false;
  const { success, error } = body as { success?: unknown; error?: { code?: unknown; message?: unknown } };
  return success === false && typeof error?.code === 'string' && typeof error.message === 'string';
}

function toFieldIssues(details: unknown[]): FieldIssue[] {
  return details.flatMap((detail) => {
    if (typeof detail !== 'object' || detail === null) return [];
    const { path, message, location } = detail as Record<string, unknown>;
    if (typeof message !== 'string') return [];
    return [
      {
        path: typeof path === 'string' ? path : '',
        message,
        ...(location === 'body' || location === 'params' || location === 'query' ? { location } : {}),
      },
    ];
  });
}

export function toApiError(error: unknown, apiBaseUrl?: string): ApiError {
  if (error instanceof ApiError) return error;
  if (isAxiosError(error)) {
    const body: unknown = error.response?.data;
    if (error.response && isFailureEnvelope(body)) {
      return new ApiError(
        error.response.status,
        body.error.code,
        body.error.message,
        toFieldIssues(Array.isArray(body.error.details) ? body.error.details : []),
      );
    }
    if (error.response) {
      return new ApiError(error.response.status, 'UNEXPECTED_RESPONSE', `Unexpected ${error.response.status} response`);
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new ApiError(null, 'TIMEOUT', 'The API took too long to respond. If it was asleep, it may still be starting up: try again in a moment.');
    }
    return new ApiError(
      null,
      'NETWORK_ERROR',
      apiBaseUrl
        ? `Cannot reach the API at ${apiBaseUrl}. Is the backend running and is this origin in CORS_ORIGINS?`
        : 'Cannot reach the API',
    );
  }
  return new ApiError(null, 'UNKNOWN_ERROR', error instanceof Error ? error.message : 'Something went wrong');
}

/** Server-side field errors (VALIDATION_ERROR details) keyed by body field name. */
export function fieldErrorsFrom(error: ApiError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.details) {
    if (issue.location && issue.location !== 'body') continue;
    const field = issue.path.split('.')[0];
    if (field && !(field in fields)) fields[field] = issue.message;
  }
  return fields;
}

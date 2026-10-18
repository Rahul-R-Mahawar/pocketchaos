import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError';
import { sendError } from '../utils/apiResponse';

export function formatZodIssues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

export function isDuplicateKeyError(err: unknown): err is { code: 11000; keyPattern?: Record<string, unknown> } {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

/** body-parser marks its own errors with `type` and an HTTP `status`. */
function isBodyParserError(err: unknown): err is { type: string; status: number } {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { type?: unknown }).type === 'string' &&
    typeof (err as { status?: unknown }).status === 'number'
  );
}

/** http-errors style client errors (e.g. Express' 400 URIError for malformed %-encoding in a route param). */
function getClientErrorStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const { status, statusCode } = err as { status?: unknown; statusCode?: unknown };
  const code = typeof status === 'number' ? status : statusCode;
  return typeof code === 'number' && code >= 400 && code < 500 ? code : undefined;
}

export const notFoundHandler: RequestHandler = (req, res) => {
  sendError(res, 404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.path} does not exist`);
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    sendError(res, err.status, err.code, err.message, err.details);
    return;
  }
  if (err instanceof ZodError) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Request validation failed', formatZodIssues(err));
    return;
  }
  if (isBodyParserError(err)) {
    if (err.type === 'entity.parse.failed') {
      sendError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON');
    } else if (err.type === 'entity.too.large') {
      sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    } else {
      sendError(res, err.status >= 400 && err.status < 500 ? err.status : 400, 'BAD_REQUEST', 'Malformed request body');
    }
    return;
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    sendError(res, 400, 'VALIDATION_ERROR', 'Request validation failed', details);
    return;
  }
  if (err instanceof mongoose.Error.CastError) {
    sendError(res, 400, 'INVALID_VALUE', `Invalid value for ${err.path}`);
    return;
  }
  if (isDuplicateKeyError(err)) {
    sendError(res, 409, 'DUPLICATE_RESOURCE', 'Resource already exists');
    return;
  }
  const clientStatus = getClientErrorStatus(err);
  if (clientStatus !== undefined) {
    // Fixed message: framework error messages can echo raw request input.
    const message = err instanceof URIError ? 'Malformed percent-encoding in URL' : 'Bad request';
    sendError(res, clientStatus, 'BAD_REQUEST', message);
    return;
  }

  console.error('[unhandled error]', err);
  sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong');
};

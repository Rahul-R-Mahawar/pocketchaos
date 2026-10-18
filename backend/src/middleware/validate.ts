import type { RequestHandler } from 'express';
import { z, type ZodType } from 'zod';
import { AppError } from '../utils/AppError';

/**
 * Zod validation middleware (.ai/CONTEXT.md §3.2): runs before the controller, so controllers only ever
 * see validated, normalised input. Mutation routes must pass all three schemas.
 */
export interface RequestSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

/** For a request part a route does not accept at all: any key is rejected. */
export const noInput = z.strictObject({});

/** For GET-style routes that ignore the query string (e.g. cache-busters): accepted, then stripped. */
export const ignoredQuery = z.object({});

export interface ValidationIssue {
  location: keyof RequestSchemas;
  path: string;
  message: string;
}

const LOCATIONS = ['params', 'query', 'body'] as const;

export function validate(schemas: RequestSchemas): RequestHandler {
  return async (req, res, next) => {
    const raw = { params: req.params, query: req.query, body: req.body as unknown };
    const parsed: Partial<Record<keyof RequestSchemas, unknown>> = {};
    const issues: ValidationIssue[] = [];

    for (const location of LOCATIONS) {
      const schema = schemas[location];
      if (!schema) continue;
      const result = await schema.safeParseAsync(raw[location]);
      if (result.success) {
        parsed[location] = result.data;
      } else {
        issues.push(
          ...result.error.issues.map((issue) => ({
            location,
            path: issue.path.map(String).join('.'),
            message: issue.message,
          })),
        );
      }
    }

    if (issues.length > 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', issues);
    }

    if (schemas.body) req.body = parsed.body;
    // Express 5 rebuilds req.query on every access, so normalised params are merged in place and the
    // validated query is exposed on res.locals.
    if (schemas.params) Object.assign(req.params, parsed.params);
    if (schemas.query) res.locals.query = parsed.query;
    next();
  };
}

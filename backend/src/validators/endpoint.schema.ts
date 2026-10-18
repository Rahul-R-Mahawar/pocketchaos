import { z } from 'zod';
import {
  HTTP_METHODS,
  MAX_DELAY_MS,
  MAX_OVERRIDE_STATUS,
  MIN_OVERRIDE_STATUS,
} from '../models/ChaosEndpoint';
import { exceedsDepth } from '../utils/json';
import { normalizeEndpointPath } from '../utils/path';
import { checkExternalUrl } from '../utils/ssrf';

// No coercion anywhere: "500" (string) for a number is a validation error, not a silent fix.
export const chaosConfigSchema = z.strictObject({
  enabled: z.boolean(),
  delayMs: z.number().int().min(0).max(MAX_DELAY_MS),
  failureRate: z.number().min(0).max(100),
  overrideStatusCode: z.number().int().min(MIN_OVERRIDE_STATUS).max(MAX_OVERRIDE_STATUS).nullable(),
  corruptJson: z.boolean(),
});

/** Body of PATCH /api/endpoints/:id/chaos: any subset of chaosConfig fields, at least one. */
export const updateChaosSchema = chaosConfigSchema
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'provide at least one chaosConfig field');

const endpointPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(
    /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/,
    'must start with "/" and contain only URL path characters (no query string or fragment)',
  )
  .transform(normalizeEndpointPath);

const targetUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .superRefine(async (value, ctx) => {
    const result = await checkExternalUrl(value);
    if (!result.safe) {
      ctx.addIssue({ code: 'custom', message: `targetUrl rejected: ${result.reason}` });
    }
  });

// MongoDB rejects documents nested deeper than 100 levels; cap well below that and fail as a 400.
export const MAX_MOCK_JSON_DEPTH = 20;

const mockResponseJsonSchema = z
  .unknown()
  .refine((value) => !exceedsDepth(value, MAX_MOCK_JSON_DEPTH), {
    message: `must not be nested more than ${MAX_MOCK_JSON_DEPTH} levels deep`,
    abort: true,
  })
  .pipe(z.json());

export const createEndpointSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  path: endpointPathSchema,
  method: z.string().trim().toUpperCase().pipe(z.enum(HTTP_METHODS)),
  targetUrl: targetUrlSchema.nullable().optional(),
  mockResponseJson: mockResponseJsonSchema.optional(),
  chaosConfig: chaosConfigSchema.partial().optional(),
});

export type CreateEndpointInput = z.infer<typeof createEndpointSchema>;
export type UpdateChaosInput = z.infer<typeof updateChaosSchema>;

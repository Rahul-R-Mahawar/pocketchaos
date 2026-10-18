import { z } from 'zod';
import { PROJECT_KEY_REGEX } from '../utils/projectKey';

export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/i, 'must be a valid id');

/** Case-insensitive on input (people type it on phones), canonical uppercase afterwards. */
export const projectKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(PROJECT_KEY_REGEX, 'projectKey must be 6 letters or digits');

export const idParamsSchema = z.strictObject({ id: objectIdSchema });
export const projectKeyParamsSchema = z.strictObject({ projectKey: projectKeySchema });

/** ALL /proxy/:projectKey{/*splat}: splat is the matched sub-path as segments (absent for /proxy/KEY). */
export const proxyParamsSchema = z.strictObject({
  projectKey: projectKeySchema,
  splat: z.array(z.string()).optional(),
});

/** Proxied query strings are forwarded upstream as-is; Express' simple parser yields strings or string arrays. */
export const proxyQuerySchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]));

/** express.raw() gives a Buffer when a body was sent, undefined otherwise. Size is capped by the parser. */
export const proxyBodySchema = z.instanceof(Buffer).optional();

export type IdParams = z.infer<typeof idParamsSchema>;
export type ProjectKeyParams = z.infer<typeof projectKeyParamsSchema>;
export type ProxyParams = z.infer<typeof proxyParamsSchema>;

import { z } from 'zod';
import { PROJECT_KEY_REGEX } from '../utils/projectKey';

export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/i, 'must be a valid id');

/** Case-insensitive on input (people type it on phones), canonical uppercase afterwards. */
export const projectKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(PROJECT_KEY_REGEX, 'projectKey must be 6 letters or digits');

export const idParamsSchema = z.object({ id: objectIdSchema });
export const projectKeyParamsSchema = z.object({ projectKey: projectKeySchema });

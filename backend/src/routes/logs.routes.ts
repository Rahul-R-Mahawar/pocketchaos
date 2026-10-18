import { Router } from 'express';
import { listLogs } from '../controllers/logs.controller';
import { ignoredQuery, validate } from '../middleware/validate';
import { projectKeyParamsSchema } from '../validators/common.schema';

export const logsRouter = Router();

logsRouter.get('/:projectKey', validate({ params: projectKeyParamsSchema, query: ignoredQuery }), listLogs);

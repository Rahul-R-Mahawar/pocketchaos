import { Router } from 'express';
import { pairDevice } from '../controllers/mobile.controller';
import { ignoredQuery, validate } from '../middleware/validate';
import { projectKeyParamsSchema } from '../validators/common.schema';

export const mobileRouter = Router();

mobileRouter.get('/pair/:projectKey', validate({ params: projectKeyParamsSchema, query: ignoredQuery }), pairDevice);

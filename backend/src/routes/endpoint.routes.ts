import { Router } from 'express';
import {
  createEndpoint,
  deleteEndpoint,
  listEndpoints,
  updateEndpointChaos,
} from '../controllers/endpoint.controller';
import { requireAuth } from '../middleware/auth';
import { ignoredQuery, noInput, validate } from '../middleware/validate';
import { idParamsSchema } from '../validators/common.schema';
import { createEndpointSchema, updateChaosSchema } from '../validators/endpoint.schema';

export const endpointRouter = Router();

// Authentication runs first, so an anonymous caller gets 401 before any validation detail.
endpointRouter.use(requireAuth);
endpointRouter.get('/', validate({ params: noInput, query: ignoredQuery }), listEndpoints);
endpointRouter.post('/', validate({ body: createEndpointSchema, params: noInput, query: noInput }), createEndpoint);
endpointRouter.patch(
  '/:id/chaos',
  validate({ body: updateChaosSchema, params: idParamsSchema, query: noInput }),
  updateEndpointChaos,
);
endpointRouter.delete('/:id', validate({ params: idParamsSchema, query: ignoredQuery }), deleteEndpoint);

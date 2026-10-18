import { Router } from 'express';
import {
  createEndpoint,
  deleteEndpoint,
  listEndpoints,
  updateEndpointChaos,
} from '../controllers/endpoint.controller';
import { requireAuth } from '../middleware/auth';

export const endpointRouter = Router();

endpointRouter.use(requireAuth);
endpointRouter.get('/', listEndpoints);
endpointRouter.post('/', createEndpoint);
endpointRouter.patch('/:id/chaos', updateEndpointChaos);
endpointRouter.delete('/:id', deleteEndpoint);

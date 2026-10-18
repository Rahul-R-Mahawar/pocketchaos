import { Router } from 'express';
import { pairDevice } from '../controllers/mobile.controller';

export const mobileRouter = Router();

mobileRouter.get('/pair/:projectKey', pairDevice);
